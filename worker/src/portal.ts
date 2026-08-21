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

const configured = (v: string | undefined): boolean => Boolean(v && !v.startsWith("REPLACE"));
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
  error?: string;
}

const EMPTY_PULL: Omit<PullResult, "configured" | "error"> = {
  updated: [], price_updated: [], unchanged: 0, unmatched_portal: [], unmatched_store: [], deferred: [],
};

/** Refresh piece counts from the portal, by SKU, case-insensitive. */
export async function pullStock(env: Env): Promise<PullResult> {
  if (!pullConfigured(env)) {
    return { configured: false, ...EMPTY_PULL, error: "Set BRIDGE_URL (wrangler.toml) and the BRIDGE_KEY secret first — see PORTAL-BRIDGE-SPEC.md" };
  }
  let items: { sku: string; name?: string; stock: number; price_cents?: number }[];
  try {
    const r = await fetch(env.BRIDGE_URL!, { headers: { "X-Bridge-Key": env.BRIDGE_KEY! } });
    if (!r.ok) throw new Error(`portal answered ${r.status} — check the key matches on both sides`);
    items = ((await r.json()) as { items?: typeof items }).items ?? [];
  } catch (e) {
    const msg = e instanceof Error ? e.message : "could not reach the portal bridge";
    await setState(env, "last_pull_result", `failed: ${msg}`);
    return { configured: true, ...EMPTY_PULL, error: msg };
  }

  /* Active products only. A hidden or retired row is not something the
     portal needs to carry, and listing it as "missing there" turns the
     reconciliation report into noise nobody reads. */
  const { results: mine } = await env.DB.prepare(
    `SELECT id, sku, stock, price_cents FROM products WHERE sku IS NOT NULL AND active = 1`,
  ).all<{ id: number; sku: string; stock: number; price_cents: number }>();
  const bySku = new Map(mine.map((m) => [m.sku.toUpperCase(), m]));

  /* Any SKU whose sales are still sitting in the outbox must not be
     overwritten: the portal computed that number before it knew about them. */
  const { results: waiting } = await env.DB.prepare(
    `SELECT DISTINCT sku FROM stock_events WHERE sent_at IS NULL`,
  ).all<{ sku: string }>().catch(() => ({ results: [] as { sku: string }[] }));
  const held = new Set(waiting.map((w) => w.sku.toUpperCase()));

  const updated: PullResult["updated"] = [];
  const price_updated: PullResult["price_updated"] = [];
  const unmatched_portal: string[] = [];
  const deferred: string[] = [];
  let unchanged = 0;

  for (const it of items) {
    const sku = String(it.sku ?? "").toUpperCase();
    const stock = Math.max(0, Math.round(Number(it.stock)));
    const m = sku ? bySku.get(sku) : undefined;
    if (!m || !Number.isFinite(stock)) { if (sku) unmatched_portal.push(sku); continue; }
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

    if (held.has(sku)) { deferred.push(m.sku); continue; }
    if (m.stock === stock) { unchanged++; continue; }
    await env.DB.prepare(`UPDATE products SET stock = ?1 WHERE id = ?2`).bind(stock, m.id).run();
    updated.push({ sku: m.sku, from: m.stock, to: stock });
  }

  const unmatched_store = [...bySku.values()].map((m) => m.sku);
  await setState(env, "last_pull_at", new Date().toISOString());
  await setState(env, "last_pull_result",
    `ok: ${updated.length} updated, ${unchanged} unchanged` +
    `${price_updated.length ? `, ${price_updated.length} price${price_updated.length === 1 ? "" : "s"} updated` : ""}` +
    `${deferred.length ? `, ${deferred.length} deferred` : ""}` +
    `${unmatched_portal.length ? `, ${unmatched_portal.length} unknown here` : ""}` +
    `${unmatched_store.length ? `, ${unmatched_store.length} unknown there` : ""}`);
  return { configured: true, updated, price_updated, unchanged, unmatched_portal, unmatched_store, deferred };
}

/** What the cron and the /admin button both do: deliver, then refresh. */
export async function syncNow(env: Env): Promise<{ push: FlushResult; pull: PullResult }> {
  const push = await flushStockEvents(env);
  const pull = await pullStock(env);
  return { push, pull };
}
