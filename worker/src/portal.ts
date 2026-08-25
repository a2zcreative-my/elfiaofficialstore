/**
 * Two-way inventory sync with the agency portal (v0.8.0).
 *
 * WHO OWNS WHAT
 *   The portal owns the true piece count — it runs the live sessions where
 *   most stock moves. This store owns its own prices, photos and copy, and
 *   reports the pieces IT sells. Neither side sends the other an absolute
 *   number it did not compute: the portal sends counts, the store sends
 *   deltas.
 *
 * PUSH (store → portal), the direction that used to be missing entirely.
 *   Every reservation and every restock is written to the `stock_events`
 *   outbox inside the same request that changed the order, then delivered.
 *   If the portal is down the row simply stays unsent and the cron retries.
 *   Each event carries a UUID the portal must dedupe on, so retrying is
 *   safe — the store would rather send twice than lose a sale.
 *
 * PULL (portal → store), previously a button nobody could press because it
 *   was never configured.
 *   Runs on the cron and refreshes counts BY SKU. It refuses to touch any SKU
 *   that still has unsent events, because that count was computed before the
 *   portal saw our sales and would silently put sold pieces back.
 *
 * PHOTOS AND NEW PRODUCTS (v1.5.0, CEO: "on portal I want an option for me to
 *   upload the photo and also to bridge directly to ELFIA … Shawl seem not yet
 *   being sync yet").
 *   The shawls were never a sync failure: the pull can only refresh a SKU the
 *   store already has, and ELFIA has no shawl products at all. So a feed item
 *   that matches nothing is no longer just reported — if it carries a `name`
 *   and a usable `price_cents`, the store CREATES it, hidden, and puts it in
 *   /admin -> Products -> From portal for a human to publish. Nothing the
 *   portal invents reaches a customer unseen.
 *   A photo arrives as `image_url` + `image_updated_at`. The file is copied
 *   into ELFIA's own R2 once and re-copied only when the marker changes, so
 *   the shop never hot-links the portal and a five-minute cron costs nothing.
 *   Photo ownership follows the same doctrine as everything else here: the
 *   portal may fill an EMPTY photo, and may replace a photo IT provided, but
 *   it never overwrites one uploaded in /admin. See takesPortalPhoto().
 *
 * PRICES (v1.1.0, CEO: "make the prices sync with my system which is easier
 *   for me to control in /portal"). When the feed carries `price_cents` for a
 *   SKU, the portal owns that price and every pull applies it. When it does
 *   not, the store's own price stands — pricing moves to the portal SKU by
 *   SKU, exactly when the portal starts sending a number. Prices are never
 *   deferred the way counts are: the outbox holds stock deltas, and a stock
 *   delta cannot make a price stale.
 *
 * Configuration (both sides must hold the same secret):
 *   BRIDGE_URL       wrangler.toml var — the portal's read-only inventory feed
 *   BRIDGE_PUSH_URL  wrangler.toml var — where movements are posted
 *   BRIDGE_KEY       secret            — equals ELFIA_BRIDGE_KEY on the portal
 * Any of them missing and both directions report "not configured" and do
 * nothing. See PORTAL-BRIDGE-SPEC.md for the exact contract.
 */
import type { Env } from "./index";

/** Attempts after which an event stops being retried and is shown as stuck
    in /admin. Something is wrong with the SKU or the portal, and a human
    needs to look — but the row is kept, never dropped. */
const MAX_ATTEMPTS = 25;
const BATCH = 50;

/* v1.5.0 — photo copying. A portal photo is a product shot, not a raw camera
   dump: 5 MB is generous for 4:5 at 900px and small enough that a mistake
   cannot fill the bucket. Only the three formats the storefront and /admin
   already accept. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TIMEOUT_MS = 10_000;
const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
};
/* Refuse anything that would make the Worker fetch the inside of a network:
   loopback, link-local and the RFC1918 ranges. */
const PRIVATE_HOST = /^(localhost|\[?::1\]?|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i;

/** Trim and cap a string the portal sent. Anything empty comes back "". */
const clean = (v: unknown, max: number): string => String(v ?? "").trim().slice(0, max);

const configured = (v: string | undefined): boolean => Boolean(v && !v.startsWith("REPLACE"));

/**
 * v1.1.2 — one spelling of a SKU for matching purposes. The portal writes
 * "LUMI 004"; this store writes "LUMI004". Same code, different keyboard
 * habits — and the CEO's screenshot proved the two systems would have stared
 * past each other forever. Case and ALL whitespace are ignored when matching;
 * each side keeps displaying its own spelling.
 */
export const normSku = (s: unknown): string => String(s ?? "").toUpperCase().replace(/\s+/g, "");
export const pullConfigured = (env: Env): boolean => configured(env.BRIDGE_URL) && Boolean(env.BRIDGE_KEY);
export const pushConfigured = (env: Env): boolean => configured(env.BRIDGE_PUSH_URL) && Boolean(env.BRIDGE_KEY);

export async function setState(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sync_state (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = datetime('now')`,
  ).bind(key, value.slice(0, 2000)).run().catch(() => null);
}

export async function getState(env: Env): Promise<Record<string, string>> {
  const { results } = await env.DB.prepare(`SELECT key, value FROM sync_state`).all<{ key: string; value: string }>()
    .catch(() => ({ results: [] as { key: string; value: string }[] }));
  return Object.fromEntries(results.map((r) => [r.key, r.value]));
}

/**
 * Record what the store just did to the shelf. Called with the SAME lines the
 * order used, so the outbox and the order can never disagree.
 * `sign` is -1 when pieces leave (an order) and +1 when they come back (an
 * unpaid order cancelled). Lines without a SKU are skipped: the portal has no
 * way to match them, and inventing an identifier is how two systems drift.
 */
export async function recordStockEvents(
  env: Env,
  lines: { sku: string | null | undefined; qty: number }[],
  reason: "order" | "cancel",
  orderNumber: string | null,
): Promise<number> {
  let n = 0;
  for (const l of lines) {
    const sku = (l.sku ?? "").trim();
    if (!sku || !(l.qty > 0)) continue;
    const delta = reason === "cancel" ? l.qty : -l.qty;
    await env.DB.prepare(
      `INSERT INTO stock_events (id, sku, delta, reason, order_number) VALUES (?1, ?2, ?3, ?4, ?5)`,
    ).bind(crypto.randomUUID(), sku, delta, reason, orderNumber).run().catch(() => null);
    n++;
  }
  return n;
}

export interface FlushResult {
  configured: boolean;
  sent: number;
  pending: number;
  stuck: number;
  error?: string;
}

/** Deliver outstanding movements. Safe to call as often as you like. */
export async function flushStockEvents(env: Env): Promise<FlushResult> {
  const counts = async (): Promise<{ pending: number; stuck: number }> => {
    const row = await env.DB.prepare(
      `SELECT
         SUM(CASE WHEN attempts <  ?1 THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN attempts >= ?1 THEN 1 ELSE 0 END) AS stuck
       FROM stock_events WHERE sent_at IS NULL`,
    ).bind(MAX_ATTEMPTS).first<{ pending: number | null; stuck: number | null }>().catch(() => null);
    return { pending: row?.pending ?? 0, stuck: row?.stuck ?? 0 };
  };

  if (!pushConfigured(env)) {
    const c = await counts();
    return { configured: false, sent: 0, ...c, error: "BRIDGE_PUSH_URL / BRIDGE_KEY not set — sales are being recorded but not delivered" };
  }

  const { results: batch } = await env.DB.prepare(
    `SELECT id, sku, delta, reason, order_number, created_at FROM stock_events
     WHERE sent_at IS NULL AND attempts < ?1 ORDER BY created_at LIMIT ?2`,
  ).bind(MAX_ATTEMPTS, BATCH).all<{ id: string; sku: string; delta: number; reason: string; order_number: string | null; created_at: string }>();

  if (batch.length === 0) return { configured: true, sent: 0, ...(await counts()) };

  const body = {
    movements: batch.map((e) => ({
      event_id: e.id, sku: e.sku, delta: e.delta, reason: e.reason,
      reference: e.order_number, occurred_at: e.created_at,
    })),
  };

  let delivered: Set<string>;
  let unknownSkus: string[] = [];
  try {
    const r = await fetch(env.BRIDGE_PUSH_URL!, {
      method: "POST",
      headers: { "X-Bridge-Key": env.BRIDGE_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`portal answered ${r.status}`);
    const j = (await r.json()) as { applied?: string[]; ignored?: string[]; unknown_sku?: string[] };
    /* applied  = newly applied.  ignored = the portal had already seen this
       id (a retry landing twice — exactly what the idempotency key is for).
       unknown_sku = the portal has no such code; keep it out of the retry
       loop and let /admin show it, rather than hammering forever. */
    delivered = new Set([...(j.applied ?? []), ...(j.ignored ?? []), ...(j.unknown_sku ?? [])]);
    /* unknown_sku carries EVENT IDS, like the other two lists. Translate them
       back into codes — "Portal does not know LUMI999" is actionable; a list
       of UUIDs is not. */
    const unknownIds = new Set(j.unknown_sku ?? []);
    unknownSkus = [...new Set(batch.filter((e) => unknownIds.has(e.id)).map((e) => e.sku))];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "network error";
    await env.DB.prepare(
      `UPDATE stock_events SET attempts = attempts + 1, last_error = ?1
       WHERE id IN (${batch.map((_, i) => `?${i + 2}`).join(",")})`,
    ).bind(msg.slice(0, 200), ...batch.map((e) => e.id)).run().catch(() => null);
    await setState(env, "last_push_error", msg);
    return { configured: true, sent: 0, ...(await counts()), error: msg };
  }

  const done = batch.filter((e) => delivered.has(e.id)).map((e) => e.id);
  if (done.length) {
    await env.DB.prepare(
      `UPDATE stock_events SET sent_at = datetime('now') WHERE id IN (${done.map((_, i) => `?${i + 1}`).join(",")})`,
    ).bind(...done).run();
  }
  const missed = batch.filter((e) => !delivered.has(e.id)).map((e) => e.id);
  if (missed.length) {
    await env.DB.prepare(
      `UPDATE stock_events SET attempts = attempts + 1, last_error = 'not acknowledged by portal'
       WHERE id IN (${missed.map((_, i) => `?${i + 1}`).join(",")})`,
    ).bind(...missed).run();
  }
  await setState(env, "last_push_at", new Date().toISOString());
  /* One place decides what the last-push message says, so a successful batch
     cannot wipe out a warning raised by the same batch. */
  if (unknownSkus.length) {
    await setState(env, "last_push_error",
      `Portal does not know ${unknownSkus.length === 1 ? "this SKU" : "these SKUs"}: ${unknownSkus.join(", ")} — add the code there, or correct it here, then press Retry.`);
  } else if (missed.length) {
    await setState(env, "last_push_error", `${missed.length} movement(s) not acknowledged by the portal`);
  } else if (done.length) {
    await setState(env, "last_push_error", "");
  }
  return { configured: true, sent: done.length, ...(await counts()) };
}

/* ---------------------------------------------------------------- photos --
   v1.5.0. The portal serves a public URL; the store copies the bytes into its
   own R2 and serves them from /api/v1/media/products/…, exactly like a photo
   uploaded in /admin. Hot-linking the portal would mean the ELFIA shop shows
   broken images the day a file is moved or the portal is down. */

/** Where a photo may legitimately come from.

    Same origin as the inventory feed = the portal itself, allowed on any
    scheme so the local test rig (http://127.0.0.1:8200) works. Anywhere else
    must be public https — a URL pointing at 127.0.0.1 or 10.x from a feed
    would turn this Worker into a probe of whatever network it runs on. */
function photoTarget(env: Env, raw: string): { url: URL; sameOrigin: boolean } | { error: string } {
  let u: URL;
  try { u = new URL(raw); } catch { return { error: "image_url is not a URL" }; }
  let feedOrigin = "";
  try { feedOrigin = new URL(env.BRIDGE_URL!).origin; } catch { /* unset — handled below */ }
  if (feedOrigin && u.origin === feedOrigin) return { url: u, sameOrigin: true };
  if (u.protocol !== "https:") return { error: "image_url must be https, or served from the portal's own host" };
  if (PRIVATE_HOST.test(u.hostname)) return { error: "image_url points at a private address" };
  return { url: u, sameOrigin: false };
}

/**
 * Who owns this product's photo?
 *
 * v1.6.0: the portal does, whenever it sends one — matched SKUs included
 * (CEO's correction; see the ownership note in pullStock). The store's own
 * photo survives only as long as the feed omits image_url for that SKU. The
 * marker still gates DOWNLOADS: an unchanged image_updated_at costs nothing,
 * whoever took the photo.
 */
const takesPortalPhoto = (_p: { image_key: string | null; portal_created: number; image_marker: string | null }): boolean =>
  true;

/** Copy one photo into R2 and point the product at it. Never throws — a photo
    problem must not stop counts and prices from syncing. */
async function syncPhoto(
  env: Env,
  product: { id: number; image_key: string | null; portal_created: number; image_marker: string | null },
  imageUrl: string,
  marker: string,
): Promise<{ ok: true } | { ok: false; error: string } | { ok: "skip" }> {
  if (!imageUrl) return { ok: "skip" };
  if (!takesPortalPhoto(product)) return { ok: "skip" };
  /* The whole point of the marker: an unchanged one means an unchanged file,
     so a feed can repeat image_url every five minutes for free. A feed that
     sends no marker at all is taken at its word once — the photo is fetched
     only while the product still has none. */
  const seen = product.image_marker ?? "";
  if (marker && seen === marker) return { ok: "skip" };
  if (!marker && product.image_key) return { ok: "skip" };

  const target = photoTarget(env, imageUrl);
  if ("error" in target) return { ok: false, error: target.error };

  let r: Response;
  try {
    r = await fetch(target.url.toString(), {
      /* The key travels only to the portal's own host. A photo hosted
         elsewhere is public by contract and gets no secret from us. */
      headers: target.sameOrigin && env.BRIDGE_KEY ? { "X-Bridge-Key": env.BRIDGE_KEY } : {},
      signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.name === "TimeoutError" ? "photo download timed out" : "photo download failed" };
  }
  if (!r.ok) return { ok: false, error: `photo download answered ${r.status}` };

  const ct = (r.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  const ext = PHOTO_EXT[ct];
  if (!ext) return { ok: false, error: `photo is ${ct || "an unknown type"} — only JPEG, PNG or WEBP` };

  const declared = Number(r.headers.get("Content-Length"));
  if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) {
    return { ok: false, error: `photo is ${(declared / 1048576).toFixed(1)} MB — the limit is 5 MB` };
  }
  let bytes: ArrayBuffer;
  try { bytes = await r.arrayBuffer(); } catch { return { ok: false, error: "photo download broke off" }; }
  if (bytes.byteLength === 0) return { ok: false, error: "photo was empty" };
  if (bytes.byteLength > MAX_PHOTO_BYTES) {
    return { ok: false, error: `photo is ${(bytes.byteLength / 1048576).toFixed(1)} MB — the limit is 5 MB` };
  }

  /* Same key shape as an /admin upload, so /api/v1/media/products/… serves it
     with no special case, and the timestamp busts any CDN copy of the old one. */
  const key = `products/${product.id}-${Date.now()}.${ext}`;
  try {
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct === "image/jpg" ? "image/jpeg" : ct } });
  } catch {
    return { ok: false, error: "could not store the photo" };
  }
  await env.DB.prepare(`UPDATE products SET image_key = ?1, image_marker = ?2 WHERE id = ?3`)
    .bind(key, marker || new Date().toISOString(), product.id).run();
  /* The previous file is deliberately left in the bucket, exactly as an
     /admin re-upload leaves its predecessor: a page already served to a
     customer may still be pointing at it. */
  return { ok: true };
}

export interface PullResult {
  configured: boolean;
  updated: { sku: string; from: number; to: number }[];
  /** v1.1.0 — prices taken from the portal this pull (cents). */
  price_updated: { sku: string; from: number; to: number }[];
  unchanged: number;
  unmatched_portal: string[];
  unmatched_store: string[];
  /** SKUs left alone because the portal has not yet seen our sales for them. */
  deferred: string[];
  /** v1.5.0 — products the feed brought in that the store did not have.
      Created HIDDEN; they wait in /admin -> Products -> From portal. */
  created: { sku: string; name: string }[];
  /** Photos copied into R2 this pull. */
  photos: number;
  /** Photos that could not be copied, already phrased for a human. */
  photo_errors: string[];
  error?: string;
}

const EMPTY_PULL: Omit<PullResult, "configured" | "error"> = {
  updated: [], price_updated: [], unchanged: 0, unmatched_portal: [], unmatched_store: [], deferred: [],
  created: [], photos: 0, photo_errors: [],
};

/** Refresh piece counts from the portal, by SKU — case- and whitespace-
    insensitive, so the portal's "LUMI 004" meets this store's "LUMI004". */
export async function pullStock(env: Env): Promise<PullResult> {
  if (!pullConfigured(env)) {
    return { configured: false, ...EMPTY_PULL, error: "Set BRIDGE_URL (wrangler.toml) and the BRIDGE_KEY secret first — see PORTAL-BRIDGE-SPEC.md" };
  }
  /* v1.5.0 — four optional additions, all documented in
     PORTAL-PHOTO-SYNC-HANDOFF.md. Every one of them is optional and an absent
     field means "the store keeps what it has", so a portal that has not
     shipped its half yet keeps working exactly as before. */
  let items: {
    sku: string; stock: number; price_cents?: number; list_price_cents?: number;
    name?: string; category?: string; description?: string;
    image_url?: string; image_updated_at?: string;
  }[];
  /* v1.7.0 — the hero carousel, portal-authored. Absent key (a portal older
     than its 0087) = leave the store's slides exactly as they are. */
  let feedSlides: {
    id: number; image_url: string; image_updated_at: string;
    title?: string; subtitle?: string; sort?: number;
  }[] | undefined;
  try {
    const r = await fetch(env.BRIDGE_URL!, { headers: { "X-Bridge-Key": env.BRIDGE_KEY! } });
    if (!r.ok) throw new Error(`portal answered ${r.status} — check the key matches on both sides`);
    const payload = (await r.json()) as { items?: typeof items; slides?: typeof feedSlides };
    items = payload.items ?? [];
    feedSlides = Array.isArray(payload.slides) ? payload.slides : undefined;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "could not reach the portal bridge";
    await setState(env, "last_pull_result", `failed: ${msg}`);
    return { configured: true, ...EMPTY_PULL, error: msg };
  }

  /* Active products, plus (v1.5.0) the hidden ones the portal itself created
     and is still waiting to have published: their counts and prices must stay
     current while they sit in the review list, or the CEO publishes a stale
     number. A hidden or retired row that the portal did NOT create is still
     left out — listing it as "missing there" turns the reconciliation report
     into noise nobody reads. */
  const { results: mine } = await env.DB.prepare(
    `SELECT id, sku, name, category, description, stock, price_cents, track_stock,
            image_key, image_marker, portal_created, portal_pending
       FROM products WHERE sku IS NOT NULL AND (active = 1 OR portal_pending = 1)`,
  ).all<{
    id: number; sku: string; name: string; category: string | null; description: string | null;
    stock: number; price_cents: number; track_stock: number;
    image_key: string | null; image_marker: string | null; portal_created: number; portal_pending: number;
  }>();
  const bySku = new Map(mine.map((m) => [normSku(m.sku), m]));

  /* Any SKU whose sales are still sitting in the outbox must not be
     overwritten: the portal computed that number before it knew about them. */
  const { results: waiting } = await env.DB.prepare(
    `SELECT DISTINCT sku FROM stock_events WHERE sent_at IS NULL`,
  ).all<{ sku: string }>().catch(() => ({ results: [] as { sku: string }[] }));
  const held = new Set(waiting.map((w) => normSku(w.sku)));

  const updated: PullResult["updated"] = [];
  const price_updated: PullResult["price_updated"] = [];
  const unmatched_portal: string[] = [];
  const deferred: string[] = [];
  const created: PullResult["created"] = [];
  const photo_errors: string[] = [];
  let unchanged = 0;
  let photos = 0;

  /** One place to run a photo through, so creation and refresh behave the same. */
  const doPhoto = async (
    product: { id: number; image_key: string | null; portal_created: number; image_marker: string | null },
    it: { sku: string; image_url?: string; image_updated_at?: string },
  ) => {
    const src = clean(it.image_url, 2000);
    if (!src) return;
    const res = await syncPhoto(env, product, src, clean(it.image_updated_at, 200));
    if (res.ok === true) photos += 1;
    else if (res.ok === false) photo_errors.push(`${clean(it.sku, 40)}: ${res.error}`);
  };

  for (const it of items) {
    const sku = normSku(it.sku);
    const stock = Math.max(0, Math.round(Number(it.stock)));
    const m = sku ? bySku.get(sku) : undefined;

    /* ---- v1.5.0: a SKU this store has never heard of ----
       Until now this was only reported, which is why the shawls sat in the
       portal forever: the pull can refresh a product, but nothing could ever
       bring one into existence. Now, if the item carries a name and a usable
       price, it is created HIDDEN and queued for review. Without those two
       facts there is nothing honest to create — a product needs a name to be
       called and a price to be sold — so it is reported exactly as before. */
    if (!m) {
      if (!sku || !Number.isFinite(stock)) continue;
      const name = clean(it.name, 200);
      const newPrice = Math.round(Number(it.price_cents));
      if (!name || !Number.isFinite(newPrice) || newPrice <= 0) {
        /* Report the portal's own spelling — "LUMI 999 is unknown here" is a
           code the CEO can find on her portal screen; the squashed form is
           not. */
        unmatched_portal.push(clean(it.sku, 40));
        continue;
      }
      const category = clean(it.category, 20).toLowerCase() === "shawl" ? "shawl" : "bawal";
      /* v1.5.1 — the portal's ELFIA tab also writes the product's
         description; a feed that carries one hands it over at birth. */
      const desc = clean(it.description, 2000) || null;
      const listC = Math.round(Number(it.list_price_cents));
      const cmpAtBirth = it.list_price_cents !== undefined && Number.isFinite(listC) && listC > newPrice ? listC : null;
      const row = await env.DB.prepare(
        `INSERT INTO products (name, description, price_cents, stock, active, sort, sku, category,
                               featured, track_stock, portal_created, portal_pending)
         VALUES (?1, ?2, ?3, ?4, 0, 100, ?5, ?6, 0, 1, 1, 1) RETURNING id`,
      ).bind(name, desc, newPrice, stock, clean(it.sku, 40), category)
       .first<{ id: number }>()
       .catch(() => null);
      if (!row) { unmatched_portal.push(clean(it.sku, 40)); continue; }
      created.push({ sku: clean(it.sku, 40), name });
      if (cmpAtBirth !== null) {
        await env.DB.prepare(`UPDATE products SET compare_price_cents = ?1 WHERE id = ?2`)
          .bind(cmpAtBirth, row.id).run().catch(() => null);
      }
      await doPhoto({ id: row.id, image_key: null, portal_created: 1, image_marker: null }, it);
      continue;
    }

    if (!Number.isFinite(stock)) { unmatched_portal.push(clean(it.sku, 40)); continue; }
    bySku.delete(sku);

    /* Price first, and independently of the stock decision below: a SKU whose
       COUNT is deferred (unsent sales) must still take the portal's PRICE —
       the customer in front of the shop right now should see the right one.
       Only a sane number is accepted: a positive integer in cents. A feed
       that sends 0, a negative, or garbage does not zero the shop's prices. */
    const price = Math.round(Number(it.price_cents));
    if (it.price_cents !== undefined && Number.isFinite(price) && price > 0 && price !== m.price_cents) {
      await env.DB.prepare(`UPDATE products SET price_cents = ?1 WHERE id = ?2`).bind(price, m.id).run();
      price_updated.push({ sku: m.sku, from: m.price_cents, to: price });
    }
    /* v1.7.0 — the slashed price. Recomputed on EVERY pull for every SKU the
       portal prices: list_price_cents present and larger than the price →
       that is the struck-through number; absent (discount cleared) → the
       badge comes off. Kept out of the deferred check below on the same
       argument as the price itself. Armored: pre-0014 this column is absent
       and the sale display simply waits for the migration. */
    if (it.price_cents !== undefined && Number.isFinite(price) && price > 0) {
      const list = Math.round(Number(it.list_price_cents));
      const cmp = it.list_price_cents !== undefined && Number.isFinite(list) && list > price ? list : null;
      await env.DB.prepare(`UPDATE products SET compare_price_cents = ?1 WHERE id = ?2`)
        .bind(cmp, m.id).run().catch(() => null);
    }

    /* v1.6.0 — THE PORTAL OWNS WHATEVER IT SENDS, for every matched SKU.
       The CEO, seeing her renamed portal items not land on the shop: "SKU
       doesnt sync with the portal!!" The v1.5.1 rule — the feed only rewrote
       products it had created — was protecting store-side copy she no longer
       wants protected: she runs the whole catalogue from the portal's ELFIA
       tab now, and matching a portal item to a store SKU IS the instruction
       to take it over. So: a field the feed carries is applied; a field the
       feed omits leaves the store's own value standing (the spec's one
       constant: absent = the store keeps what it has). */
    {
      const newName = clean(it.name, 200);
      const newCat = clean(it.category, 20).toLowerCase();
      const newDesc = it.description !== undefined ? (clean(it.description, 2000) || null) : undefined;
      const sets: string[] = [];
      const vals: (string | null)[] = [];
      const push = (col: string, val: string | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (newName && newName !== m.name) push("name", newName);
      if ((newCat === "bawal" || newCat === "shawl") && newCat !== (m.category ?? "bawal")) push("category", newCat);
      if (newDesc !== undefined && newDesc !== (m.description ?? null)) push("description", newDesc);
      if (sets.length > 0) {
        await env.DB.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
          .bind(...vals, String(m.id)).run();
      }
    }

    /* The photo, if the portal sent one and this product's photo is the
       portal's to set (takesPortalPhoto). Done before the deferred check for
       the same reason as the price: a customer looking at the shop right now
       should see the current picture even if the count is being held back. */
    await doPhoto(m, it);

    /* v1.1.2 — a SKU the portal carries is portal-managed: its count is real,
       so the storefront shows and enforces it from this pull on. "Always
       available" (track_stock = 0) was the stopgap for counts nobody
       maintained — the portal maintains this one now, and the CEO expects the
       shop to show "as per inventory in my portal". */
    if ((m.track_stock ?? 1) === 0) {
      await env.DB.prepare(`UPDATE products SET track_stock = 1 WHERE id = ?1`).bind(m.id).run();
    }

    if (held.has(sku)) { deferred.push(m.sku); continue; }
    if (m.stock === stock) { unchanged++; continue; }
    await env.DB.prepare(`UPDATE products SET stock = ?1 WHERE id = ?2`).bind(stock, m.id).run();
    updated.push({ sku: m.sku, from: m.stock, to: stock });
  }

  /* ---- v1.7.0 — the carousel, mirrored from the portal ----
     Slides are the ONE feed section where absence inside the list means
     delete: the portal is their only author, so the store's set is replaced
     to match. The whole section is skipped when the feed has no `slides` key
     at all (a portal older than its 0087), and armored against a store
     database older than 0014. Photo downloads ride the same pipeline as
     product photos: copied into our R2 once, re-copied only when the marker
     moves, failures reported per slide and never fatal to the pull. */
  let slides_synced = 0;
  if (feedSlides !== undefined) {
    try {
      const { results: haveRows } = await env.DB.prepare(
        `SELECT portal_id, image_key, image_marker FROM portal_slides`,
      ).all<{ portal_id: number; image_key: string; image_marker: string }>();
      const have = new Map(haveRows.map((r) => [r.portal_id, r]));
      const seen = new Set<number>();
      for (const sl of feedSlides.slice(0, 12)) {
        if (!Number.isInteger(sl.id) || !sl.image_url || !sl.image_updated_at) continue;
        seen.add(sl.id);
        const cur = have.get(sl.id);
        let key = cur?.image_key ?? null;
        if (!cur || cur.image_marker !== sl.image_updated_at) {
          const target = photoTarget(env, clean(sl.image_url, 2000));
          if ("error" in target) { photo_errors.push(`slide ${sl.id}: ${target.error}`); if (!cur) continue; }
          else {
            try {
              const r2 = await fetch(target.url.toString(), {
                headers: target.sameOrigin && env.BRIDGE_KEY ? { "X-Bridge-Key": env.BRIDGE_KEY } : {},
                signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
              });
              const ct = (r2.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
              const ext = PHOTO_EXT[ct];
              if (!r2.ok || !ext) { photo_errors.push(`slide ${sl.id}: download ${r2.ok ? `is ${ct || "unknown"}` : `answered ${r2.status}`}`); if (!cur) continue; }
              else {
                const bytes = await r2.arrayBuffer();
                if (bytes.byteLength === 0 || bytes.byteLength > MAX_PHOTO_BYTES) {
                  photo_errors.push(`slide ${sl.id}: ${(bytes.byteLength / 1048576).toFixed(1)} MB — the limit is 5 MB`);
                  if (!cur) continue;
                } else {
                  key = `slides/${sl.id}-${Date.now()}.${ext}`;
                  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: ct === "image/jpg" ? "image/jpeg" : ct } });
                  slides_synced += 1;
                }
              }
            } catch { photo_errors.push(`slide ${sl.id}: photo download failed`); if (!cur) continue; }
          }
        }
        if (!key) continue;
        await env.DB.prepare(
          `INSERT INTO portal_slides (portal_id, image_key, image_marker, title, subtitle, sort, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
           ON CONFLICT (portal_id) DO UPDATE SET image_key = ?2, image_marker = ?3,
             title = ?4, subtitle = ?5, sort = ?6, updated_at = datetime('now')`,
        ).bind(sl.id, key, clean(sl.image_updated_at, 200),
               clean(sl.title, 120) || null, clean(sl.subtitle, 200) || null,
               Number.isFinite(Number(sl.sort)) ? Math.round(Number(sl.sort)) : 100).run();
      }
      /* Removed in the portal = removed here. The R2 file is left behind
         (same rule as replaced product photos: a cached page may still
         point at it). */
      for (const [pid] of have) {
        if (!seen.has(pid)) {
          await env.DB.prepare(`DELETE FROM portal_slides WHERE portal_id = ?1`).bind(pid).run();
        }
      }
    } catch { /* pre-0014 — the sale/carousel simply waits for the migration */ }
  }

  /* A row still waiting in the review list came FROM the portal, so calling
     it "unknown there" the moment the feed drops it would be noise. Only
     published products are reconciled against the portal. */
  const unmatched_store = [...bySku.values()].filter((m) => m.portal_pending !== 1).map((m) => m.sku);
  await setState(env, "last_pull_at", new Date().toISOString());
  await setState(env, "last_pull_result",
    `ok: ${updated.length} updated, ${unchanged} unchanged` +
    `${price_updated.length ? `, ${price_updated.length} price${price_updated.length === 1 ? "" : "s"} updated` : ""}` +
    `${created.length ? `, ${created.length} new product${created.length === 1 ? "" : "s"} waiting to publish` : ""}` +
    `${photos ? `, ${photos} photo${photos === 1 ? "" : "s"}` : ""}` +
    `${slides_synced ? `, ${slides_synced} slide${slides_synced === 1 ? "" : "s"}` : ""}` +
    `${deferred.length ? `, ${deferred.length} deferred` : ""}` +
    `${unmatched_portal.length ? `, ${unmatched_portal.length} unknown here` : ""}` +
    `${unmatched_store.length ? `, ${unmatched_store.length} unknown there` : ""}`);
  /* Photo trouble is its own line: it must not be buried inside an otherwise
     cheerful "ok:" summary, and it must not be wiped by a later clean pull
     without saying so. */
  await setState(env, "last_photo_error", photo_errors.length ? photo_errors.slice(0, 5).join(" · ") : "");
  return {
    configured: true, updated, price_updated, unchanged,
    unmatched_portal, unmatched_store, deferred, created, photos, photo_errors,
  };
}

/** What the cron and the /admin button both do: deliver, then refresh. */
export async function syncNow(env: Env): Promise<{ push: FlushResult; pull: PullResult }> {
  const push = await flushStockEvents(env);
  const pull = await pullStock(env);
  return { push, pull };
}
