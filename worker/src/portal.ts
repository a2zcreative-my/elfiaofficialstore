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
 *   Runs on the cron and refreshes counts BY SKU. It refuses to touch a SKU
 *   whose sales are still IN FLIGHT, because that count was computed before
 *   the portal saw them and would silently put sold pieces back. v1.8.0: only
 *   while in flight — an event past MAX_ATTEMPTS is never retried, and used
 *   to freeze its SKU's shelf forever (the CEO watched two SKUs read SOLD OUT
 *   against a portal count of 20). Given up on = the portal's count wins, and
 *   the stuck row is reported instead of hiding.
 *
 * PHOTOS AND NEW PRODUCTS (v1.5.0, CEO: "on portal I want an option for me to
 *   upload the photo and also to bridge directly to ELFIA … Shawl seem not yet
 *   being sync yet").
 *   The shawls were never a sync failure: the pull can only refresh a SKU the
 *   store already has, and ELFIA has no shawl products at all. So a feed item
 *   that matches nothing is no longer just reported — if it carries a `name`
 *   and a usable `price_cents`, the store CREATES it.
 *   v1.8.0: created LIVE. v1.5.0 parked new SKUs in /admin -> From portal for
 *   a second approval; the feed carries only items the portal has ticked
 *   Publish on, so that gate asked the CEO to approve her own approval and
 *   silently swallowed twelve published shawls. A matched row still sitting
 *   in the old queue is released on the next pull. What guards the shopfront
 *   is upstream: no name or no positive price = reported, never invented.
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

/* v1.8.0 — a slide's focus point, 0-100 per cent. Anything the portal could
   not send properly becomes the middle: a wrong number here would frame a
   customer-facing banner on nothing. */
/* v1.9.0 — the portal's zoom, in per cent. 100 = the whole photo inside the
   hero. NULL when the portal has not sent one (a portal older than its
   0089), which the storefront reads as "fall back to the old crop switch" —
   so an existing slide does not visibly jump the day this ships. */
const zoomPct = (v: unknown): number | null => {
  if (v === undefined || v === null) return null;
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(300, Math.max(100, n));
};

/* v1.11.0 — how tall the cut-out stands, as a per cent of the banner.
   100 = exactly the banner's height (no step-out); the portal's default is
   118. Clamped so a mistyped number cannot push her off the page. */
const cutoutScale = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 118;
  return Math.min(160, Math.max(100, n));
};

const framePct = (v: unknown): number => {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(0, n));
};

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
      v1.8.0: created LIVE — the portal's Publish tick is the decision. */
  created: { sku: string; name: string }[];
  /** v1.8.0 — rows released from the old hidden review queue this pull. */
  published: string[];
  /** v1.8.0 — SKUs with a sale the portal never acknowledged and that is no
      longer being retried. Reported so it is visible; it no longer freezes
      the shelf. */
  stuck_skus: string[];
  /** Photos copied into R2 this pull. */
  photos: number;
  /** Photos that could not be copied, already phrased for a human. */
  photo_errors: string[];
  /** v1.13.0 — delivery numbers the feed CHANGED this pull, phrased for a
      human. Empty when the portal sent none, or sent the same ones again. */
  settings_changed: string[];
  /** v1.21.0 — true when this pull downloaded a newly uploaded catalog
      (PDF + map, cover included) into R2. Read from the sync response by the
      admin surface and the rigs, not from stored state. */
  catalog_synced: boolean;
  /** v1.32.0 — true when this pull downloaded a newly uploaded /catalog
      hover backdrop into R2. */
  backdrop_synced: boolean;
  error?: string;
}

const EMPTY_PULL: Omit<PullResult, "configured" | "error"> = {
  updated: [], price_updated: [], unchanged: 0, unmatched_portal: [], unmatched_store: [], deferred: [],
  created: [], published: [], stuck_skus: [], photos: 0, photo_errors: [], settings_changed: [], catalog_synced: false,
  backdrop_synced: false,
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
    /* v1.8.0 — framing, decided in the portal. Optional: a portal older
       than its 0088 sends neither, and the middle of the photo is then the
       honest answer. */
    focus_x?: number; focus_y?: number; fit?: string; zoom?: number;
    /* v1.11.0 — the cut-out that steps out of the banner. */
    cutout_url?: string; cutout_updated_at?: string;
    cutout_side?: string; cutout_scale?: number;
  }[] | undefined;
  /* v1.13.0 — what delivery costs, decided in the portal (CEO, 26-08: "I
     want to have the authority to update the shipping fees"). Undefined =
     the portal did not send it = the store keeps what it has, which is the
     rule every optional field on this feed already follows. */
  let feedSettings: { shipping_cents?: unknown; free_above_cents?: unknown } | undefined;
  let feedCatalog: { url?: string; map_url?: string; cover_url?: string; updated_at?: string } | undefined;
  /* v1.32.0 — the /catalog hover backdrop, uploaded in the portal. Absent =
     the store keeps what it has (the shipped ELFIA backdrop included). */
  let feedBackdrop: { url?: string; updated_at?: string } | undefined;
  try {
    const r = await fetch(env.BRIDGE_URL!, { headers: { "X-Bridge-Key": env.BRIDGE_KEY! } });
    if (!r.ok) throw new Error(`portal answered ${r.status} — check the key matches on both sides`);
    const payload = (await r.json()) as {
      items?: typeof items; slides?: typeof feedSlides;
      /* v1.13.0 — the delivery numbers, when the portal is new enough to
         send them. Optional like everything else on this feed. */
      settings?: { shipping_cents?: unknown; free_above_cents?: unknown };
      /* v1.21.0 — a catalog the CEO uploaded in the portal: the PDF, the
         label map her browser extracted from it, and a cover image. Absent
         means the store keeps what it has — the shipped catalog included. */
      catalog?: { url?: string; map_url?: string; cover_url?: string; updated_at?: string };
      /* v1.32.0 — the /catalog hover backdrop. */
      backdrop?: { url?: string; updated_at?: string };
    };
    items = payload.items ?? [];
    feedSlides = Array.isArray(payload.slides) ? payload.slides : undefined;
    feedSettings = payload.settings && typeof payload.settings === "object" ? payload.settings : undefined;
    feedCatalog = payload.catalog && typeof payload.catalog === "object" ? payload.catalog : undefined;
    feedBackdrop = payload.backdrop && typeof payload.backdrop === "object" ? payload.backdrop : undefined;
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

  /* A SKU whose sales are still sitting in the outbox must not be
     overwritten: the portal computed that number before it knew about them.
     v1.8.0 — but ONLY while the sale is still genuinely in flight.
     `attempts < MAX_ATTEMPTS` is the whole fix: the push loop stops retrying
     an event at MAX_ATTEMPTS, so a permanently-stuck row used to hold its
     SKU's shelf hostage FOREVER — the pull refused to touch the count, the
     push refused to send it, and the only way out was /admin/sync-retry.
     The CEO hit exactly that on 25-08: the portal said 20, the shop said
     SOLD OUT, and stayed there through two deploys. A given-up event is a
     local guess nobody can deliver; the portal's count is the truth, so it
     is allowed through and the stuck row is reported instead of hiding. */
  const { results: waiting } = await env.DB.prepare(
    `SELECT DISTINCT sku FROM stock_events WHERE sent_at IS NULL AND attempts < ?1`,
  ).bind(MAX_ATTEMPTS).all<{ sku: string }>().catch(() => ({ results: [] as { sku: string }[] }));
  const held = new Set(waiting.map((w) => normSku(w.sku)));

  const { results: givenUp } = await env.DB.prepare(
    `SELECT DISTINCT sku FROM stock_events WHERE sent_at IS NULL AND attempts >= ?1`,
  ).bind(MAX_ATTEMPTS).all<{ sku: string }>().catch(() => ({ results: [] as { sku: string }[] }));
  const stuck_skus = givenUp.map((w) => w.sku);

  const updated: PullResult["updated"] = [];
  const price_updated: PullResult["price_updated"] = [];
  const unmatched_portal: string[] = [];
  const deferred: string[] = [];
  const created: PullResult["created"] = [];
  const published: string[] = [];
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
      /* v1.10.0 — the collection is whatever the portal calls it, in the
         portal's own spelling. The old two-value allow-list ("bawal" or
         anything else means bawal) is gone: the CEO names her own
         collections in the ELFIA tab and the shop groups by what arrives.
         Absent = Bawal, the range this shop started as. */
      const category = clean(it.category, 40) || "bawal";
      /* v1.5.1 — the portal's ELFIA tab also writes the product's
         description; a feed that carries one hands it over at birth. */
      const desc = clean(it.description, 2000) || null;
      const listC = Math.round(Number(it.list_price_cents));
      const cmpAtBirth = it.list_price_cents !== undefined && Number.isFinite(listC) && listC > newPrice ? listC : null;
      /* v1.8.0 — CREATED LIVE, not hidden.
         v1.5.0 parked every new SKU in /admin → From portal for a second
         approval. That gate was mine, not hers, and on 25-08 it silently
         swallowed twelve shawls she had already ticked Publish on: the feed
         carries ONLY items with the portal's publish flag set, so arriving
         here IS the human decision, made by the person whose shop it is.
         Asking her to approve her own approval — in an /admin she cannot
         even open — is not a safety net, it is a dead end.
         What still protects the shopfront is upstream and unchanged: no
         name or no positive price = reported, never invented. */
      const row = await env.DB.prepare(
        `INSERT INTO products (name, description, price_cents, stock, active, sort, sku, category,
                               featured, track_stock, portal_created, portal_pending)
         VALUES (?1, ?2, ?3, ?4, 1, 100, ?5, ?6, 0, 1, 1, 0) RETURNING id`,
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

    /* v1.8.0 — a row still waiting in the old review queue is released the
       moment the portal names it again. This is what clears the backlog the
       hidden-by-default rule built up (twelve published shawls that never
       reached the shop), and it keeps working afterwards: the feed only
       carries portal-published items, so a matched pending row has the
       portal's Publish tick on it right now. Un-ticking it there removes it
       from the feed, and the store's own /admin can still retire it. */
    if (m.portal_pending === 1) {
      await env.DB.prepare(
        `UPDATE products SET active = 1, portal_pending = 0 WHERE id = ?1`,
      ).bind(m.id).run().catch(() => null);
      published.push(m.sku);
    }

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
      const newCat = clean(it.category, 40);
      const newDesc = it.description !== undefined ? (clean(it.description, 2000) || null) : undefined;
      const sets: string[] = [];
      const vals: (string | null)[] = [];
      const push = (col: string, val: string | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
      if (newName && newName !== m.name) push("name", newName);
      /* Any non-empty name is accepted and applied; an empty one means the
         portal said nothing, so the store's value stands (the feed's oldest
         rule). Case and spacing are what the storefront groups on, so
         "Bawal Printed" renamed to "Bawal printed" is not a new shelf. */
      if (newCat && newCat.toLowerCase() !== String(m.category ?? "bawal").toLowerCase()) push("category", newCat);
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
  let framingCols = true; // v1.8.0 — flipped off once if 0015 has not run
  if (feedSlides !== undefined) {
    try {
      const { results: haveRows } = await env.DB.prepare(
        `SELECT portal_id, image_key, image_marker, cutout_key, cutout_marker FROM portal_slides`,
      ).all<{ portal_id: number; image_key: string; image_marker: string;
              cutout_key: string | null; cutout_marker: string | null }>()
        .catch(async () => ({
          /* pre-0017 — the cut-out columns are not there yet. */
          results: (await env.DB.prepare(`SELECT portal_id, image_key, image_marker FROM portal_slides`)
            .all<{ portal_id: number; image_key: string; image_marker: string }>()).results
            .map((r) => ({ ...r, cutout_key: null, cutout_marker: null })),
        }));
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
        /* v1.11.0 — the cut-out rides the same pipeline as every other
           portal image: copied into our own R2 once, re-copied only when
           its marker moves, a failure reported per slide and never fatal.
           It is fetched only when the portal sends BOTH a URL and a marker
           (the serializer sends them together or not at all). */
        let cutKey = cur?.cutout_key ?? null;
        const cutMarker = clean(sl.cutout_updated_at, 200);
        if (sl.cutout_url && cutMarker) {
          if (!cur || cur.cutout_marker !== cutMarker || !cur.cutout_key) {
            const ct = photoTarget(env, clean(sl.cutout_url, 2000));
            if ("error" in ct) photo_errors.push(`slide ${sl.id} cut-out: ${ct.error}`);
            else {
              try {
                const r3 = await fetch(ct.url.toString(), {
                  headers: ct.sameOrigin && env.BRIDGE_KEY ? { "X-Bridge-Key": env.BRIDGE_KEY } : {},
                  signal: AbortSignal.timeout(PHOTO_TIMEOUT_MS),
                });
                const ctype = (r3.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
                const cext = PHOTO_EXT[ctype];
                if (!r3.ok || !cext) {
                  photo_errors.push(`slide ${sl.id} cut-out: download ${r3.ok ? `is ${ctype || "unknown"}` : `answered ${r3.status}`}`);
                } else {
                  const cb = await r3.arrayBuffer();
                  if (cb.byteLength === 0 || cb.byteLength > MAX_PHOTO_BYTES) {
                    photo_errors.push(`slide ${sl.id} cut-out: ${(cb.byteLength / 1048576).toFixed(1)} MB — the limit is 5 MB`);
                  } else {
                    cutKey = `slides/cut-${sl.id}-${Date.now()}.${cext}`;
                    await env.MEDIA.put(cutKey, cb, { httpMetadata: { contentType: ctype === "image/jpg" ? "image/jpeg" : ctype } });
                    slides_synced += 1;
                  }
                }
              } catch { photo_errors.push(`slide ${sl.id} cut-out: download failed`); }
            }
          }
        } else {
          /* The portal removed it — the slide goes back to a plain banner. */
          cutKey = null;
        }

        const marker = clean(sl.image_updated_at, 200);
        const title = clean(sl.title, 120) || null;
        const subtitle = clean(sl.subtitle, 200) || null;
        const sort = Number.isFinite(Number(sl.sort)) ? Math.round(Number(sl.sort)) : 100;
        /* v1.8.0 — framing rides along. Tried wide first and narrow on
           failure: if this worker is published before 0015 runs, a hard
           failure here would take the WHOLE carousel down rather than just
           the new controls, which is not a trade worth making. */
        if (framingCols) {
          try {
            await env.DB.prepare(
              `INSERT INTO portal_slides (portal_id, image_key, image_marker, title, subtitle, sort, focus_x, focus_y, fit, zoom,
                                          cutout_key, cutout_marker, cutout_side, cutout_scale, updated_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, datetime('now'))
               ON CONFLICT (portal_id) DO UPDATE SET image_key = ?2, image_marker = ?3,
                 title = ?4, subtitle = ?5, sort = ?6, focus_x = ?7, focus_y = ?8, fit = ?9,
                 zoom = ?10, cutout_key = ?11, cutout_marker = ?12, cutout_side = ?13,
                 cutout_scale = ?14, updated_at = datetime('now')`,
            ).bind(sl.id, key, marker, title, subtitle, sort,
                   framePct(sl.focus_x), framePct(sl.focus_y),
                   sl.fit === "contain" ? "contain" : "cover",
                   zoomPct(sl.zoom),
                   cutKey, cutKey ? cutMarker : null,
                   sl.cutout_side === "left" ? "left" : "right",
                   cutoutScale(sl.cutout_scale)).run();
            continue;
          } catch { framingCols = false; /* pre-0015 — fall through, once */ }
        }
        await env.DB.prepare(
          `INSERT INTO portal_slides (portal_id, image_key, image_marker, title, subtitle, sort, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
           ON CONFLICT (portal_id) DO UPDATE SET image_key = ?2, image_marker = ?3,
             title = ?4, subtitle = ?5, sort = ?6, updated_at = datetime('now')`,
        ).bind(sl.id, key, marker, title, subtitle, sort).run();
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

  /* ---- what delivery costs (v1.13.0) ----
     The CEO owns these two numbers in the portal now. They are stored in
     sync_state and read by storeConfig(), which falls back to the
     wrangler.toml vars while they are absent.

     Written one at a time and only when they actually change, so the pull
     report says something true rather than "settings updated" on every one
     of the 1,440 pulls a day. A value that does not parse to a sane number
     of sen is IGNORED, not stored: a typo in the portal must not be able to
     make delivery free or charge RM 1,000 for it, and the last good number
     is a better answer than a broken one. */
  const settings_changed: string[] = [];
  if (feedSettings) {
    const current = await getState(env);
    const rm = (c: number) => `RM ${(c / 100).toFixed(2)}`;
    const apply = async (key: "shipping_cents" | "free_above_cents", label: string) => {
      const raw = feedSettings![key];
      if (raw === undefined || raw === null) return;      // absent = keep what we have
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0 || n > 100_000) return;
      const next = String(Math.round(n));
      if (current[key] === next) return;                  // unchanged = say nothing
      await setState(env, key, next);
      settings_changed.push(
        current[key] === undefined
          ? `${label} set to ${rm(Number(next))}`
          : `${label} ${rm(Number(current[key]))} -> ${rm(Number(next))}`);
    };
    await apply("shipping_cents", "delivery");
    await apply("free_above_cents", "free delivery above");
  }

  /* ---- the CEO's uploaded catalog (v1.21.0) ----
     Downloaded like a photo: only when the marker changes, into this
     store's own R2, so the shop never leans on the portal at request time.
     The PDF and its map land TOGETHER or not at all — a new file patched
     with an old map prints prices in the wrong places, which is the one
     failure this feature must never have. */
  let catalog_synced = false;
  if (feedCatalog?.url && feedCatalog.map_url && feedCatalog.updated_at) {
    const current = await getState(env);
    if (current.catalog_marker !== feedCatalog.updated_at) {
      try {
        const [pdfR, mapR, covR] = await Promise.all([
          fetch(feedCatalog.url),
          fetch(feedCatalog.map_url),
          feedCatalog.cover_url ? fetch(feedCatalog.cover_url) : Promise.resolve(null),
        ]);
        if (pdfR.ok && mapR.ok) {
          const pdfBytes = await pdfR.arrayBuffer();
          const mapText = await mapR.text();
          const head = new Uint8Array(pdfBytes.slice(0, 5));
          const isPdf = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
          const mapOk = (() => {
            try {
              const m = JSON.parse(mapText) as { version?: number; sites?: unknown[] };
              return m.version === 1 && Array.isArray(m.sites) && m.sites.length > 0;
            } catch { return false; }
          })();
          if (isPdf && mapOk && pdfBytes.byteLength <= 15_000_000) {
            await env.MEDIA.put("catalog/source.pdf", pdfBytes, { httpMetadata: { contentType: "application/pdf" } });
            await env.MEDIA.put("catalog/map.json", mapText, { httpMetadata: { contentType: "application/json" } });
            if (covR && covR.ok) {
              await env.MEDIA.put("catalog/cover.jpg", await covR.arrayBuffer(), { httpMetadata: { contentType: "image/jpeg" } });
            }
            await setState(env, "catalog_marker", feedCatalog.updated_at);
            catalog_synced = true;
          } else {
            photo_errors.push(`catalog: refused (${isPdf ? "" : "not a PDF"}${!mapOk ? " bad map" : ""})`);
          }
        } else {
          photo_errors.push(`catalog: portal answered ${pdfR.status}/${mapR.status}`);
        }
      } catch (e) {
        photo_errors.push(`catalog: ${e instanceof Error ? e.message : "download failed"}`);
      }
    }
  }

  /* ---- the /catalog hover backdrop (v1.32.0) ----
     Downloaded like the catalog: only when the marker changes, into this
     store's own R2, so /api/v1/tile-backdrop never leans on the portal at
     request time. One image, whole-or-nothing. */
  let backdrop_synced = false;
  if (feedBackdrop?.url && feedBackdrop.updated_at) {
    const current = await getState(env);
    if (current.backdrop_marker !== feedBackdrop.updated_at) {
      try {
        const bdR = await fetch(feedBackdrop.url);
        if (bdR.ok) {
          const ct = (bdR.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
          const bytes = await bdR.arrayBuffer();
          if (["image/jpeg", "image/png", "image/webp"].includes(ct) && bytes.byteLength > 0 && bytes.byteLength <= 6_000_000) {
            await env.MEDIA.put("catalog/backdrop.img", bytes, { httpMetadata: { contentType: ct } });
            await setState(env, "backdrop_marker", feedBackdrop.updated_at);
            backdrop_synced = true;
          } else {
            photo_errors.push(`backdrop: refused (${ct || "no type"}, ${bytes.byteLength} bytes)`);
          }
        } else {
          photo_errors.push(`backdrop: portal answered ${bdR.status}`);
        }
      } catch (e) {
        photo_errors.push(`backdrop: ${e instanceof Error ? e.message : "download failed"}`);
      }
    }
  }

  /* A row still waiting in the review list came FROM the portal, so calling
     it "unknown there" the moment the feed drops it would be noise. Only
     published products are reconciled against the portal. */
  const unmatched_store = [...bySku.values()].filter((m) => m.portal_pending !== 1).map((m) => m.sku);
  await setState(env, "last_pull_at", new Date().toISOString());
  await setState(env, "last_pull_result",
    `ok: ${updated.length} updated, ${unchanged} unchanged` +
    `${price_updated.length ? `, ${price_updated.length} price${price_updated.length === 1 ? "" : "s"} updated` : ""}` +
    `${created.length ? `, ${created.length} new product${created.length === 1 ? "" : "s"} added to the shop` : ""}` +
    `${published.length ? `, ${published.length} released from the old review queue` : ""}` +
    `${stuck_skus.length ? `, ${stuck_skus.length} SKU${stuck_skus.length === 1 ? "" : "s"} with an undelivered sale (count taken from the portal anyway)` : ""}` +
    `${photos ? `, ${photos} photo${photos === 1 ? "" : "s"}` : ""}` +
    `${slides_synced ? `, ${slides_synced} slide${slides_synced === 1 ? "" : "s"}` : ""}` +
    `${settings_changed.length ? `, ${settings_changed.join(", ")}` : ""}` +
    `${catalog_synced ? ", catalog updated" : ""}` +
    `${backdrop_synced ? ", hover backdrop updated" : ""}` +
    `${deferred.length ? `, ${deferred.length} deferred` : ""}` +
    `${unmatched_portal.length ? `, ${unmatched_portal.length} unknown here` : ""}` +
    `${unmatched_store.length ? `, ${unmatched_store.length} unknown there` : ""}`);
  /* Photo trouble is its own line: it must not be buried inside an otherwise
     cheerful "ok:" summary, and it must not be wiped by a later clean pull
     without saying so. */
  await setState(env, "last_photo_error", photo_errors.length ? photo_errors.slice(0, 5).join(" · ") : "");
  return {
    configured: true, updated, price_updated, unchanged,
    unmatched_portal, unmatched_store, deferred, created, published, stuck_skus, photos, photo_errors,
    settings_changed, catalog_synced, backdrop_synced,
  };
}

/** What the cron and the /admin button both do: deliver, then refresh. */
export async function syncNow(env: Env): Promise<{ push: FlushResult; pull: PullResult }> {
  const push = await flushStockEvents(env);
  const pull = await pullStock(env);
  return { push, pull };
}
