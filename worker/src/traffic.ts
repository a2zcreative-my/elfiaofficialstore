/**
 * traffic.ts — anonymous visitor traffic (v1.2.0).
 *
 * CEO, 22-08-2026: "I want to have a traffic to see which user that visit my
 * pages" — shown in the agency portal as a Malaysia state map ("ELFIA
 * Traffic"), the way Operations shows orders by state.
 *
 * THE PRIVACY LINE, drawn on purpose (OD-20a in the portal's plan):
 * "which user" is answered with WHERE and HOW MANY, never WHO.
 *   - The storefront beacon sends only the page path and the referrer. No
 *     cookie, no ID in the browser, nothing to consent-manage away.
 *   - Location comes from Cloudflare's own geo fields on the request
 *     (state + city). The IP address is used for two things — the rate
 *     limit bucket and the visitor hash — and is stored in NEITHER.
 *   - The visitor hash is HMAC(day + server key, ip + user-agent), cut to
 *     16 hex chars. The day is inside the KEY, so the same phone hashes
 *     differently tomorrow: unique visitors can be counted within a day,
 *     and nobody — including us — can follow a visitor across days.
 *   - Raw hits live 60 days (OD-22), aggregates for ever. The aggregates
 *     contain no hash at all.
 *
 * WHO READS THIS: the portal, over bridge feed D (GET /bridge/traffic in
 * index.ts, same key and same constant-time check as the orders feed).
 */
import { callerIp, hitLimit } from "./auth";
import type { Env } from "./index";

/* The store keeps Malaysian business days everywhere (order numbers, the
   release cron); traffic days must agree with them. */
const MY_OFFSET_MS = 8 * 3600 * 1000; // Malaysia is UTC+8, no DST
export const trafficDay = (daysAgo = 0): string =>
  new Date(Date.now() + MY_OFFSET_MS - daysAgo * 86_400_000).toISOString().slice(0, 10);

/* Self-declared crawlers. A bot that lies about its user-agent gets through —
   that is fine; this filter is about not counting Google as a customer, not
   about adversaries. An EMPTY user-agent is also treated as a bot: every real
   browser sends one. */
const BOT_RE = /bot|crawl|spider|slurp|preview|scrape|fetch|curl|wget|monitor|check|probe|headless|lighthouse|pingdom|facebookexternal|whatsapp|telegram|python|node-fetch|axios|go-http/i;

/** Daily-rotating anonymous visitor hash. Keyed with a server-side secret so
    the hash cannot be recomputed from public facts; ADMIN_KEY always exists
    on a configured store, with BRIDGE_KEY and a constant as fallbacks so an
    unconfigured store still counts (it just counts less unlinkably). */
async function visitorHash(env: Env, ip: string, ua: string, day: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw", enc.encode(`${day}|${env.ADMIN_KEY ?? env.BRIDGE_KEY ?? "elfia-traffic"}`),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${ip}|${ua}`));
  return [...new Uint8Array(sig)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The page, normalised so the map's "pages" list stays readable: query
    string dropped except `id` (the product page is /p?id=N — dropping id
    would melt every product into one line). Length-capped; junk rejected. */
function cleanPath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/") || raw.startsWith("//")) return null;
  const [path = "/", query = ""] = raw.slice(0, 400).split("?");
  const id = new URLSearchParams(query).get("id");
  const kept = id && /^\d{1,10}$/.test(id) ? `?id=${id}` : "";
  return (path + kept).slice(0, 120);
}

/** External referrer, reduced to its host: "instagram.com" is the useful
    fact; the full URL can carry someone else's tokens, so it is never kept.
    Same-site referrers are navigation, not acquisition — dropped. */
function refHost(raw: unknown, ownHost: string): string | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const host = new URL(raw).host.replace(/^www\./, "");
    return host && host !== ownHost.replace(/^www\./, "") ? host.slice(0, 100) : null;
  } catch { return null; }
}

/** POST /api/v1/t — the beacon. Always answers 204 fast: the storefront must
    never wait on analytics, and a dropped hit is a shrug, not an error. */
export async function recordHit(request: Request, env: Env, ownHost: string): Promise<Response> {
  const done = new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  const ua = request.headers.get("User-Agent") ?? "";
  if (!ua || BOT_RE.test(ua)) return done;

  const ip = callerIp(request);
  /* One phone reloading in a loop must not flood the table: 60 hits per ten
     minutes per address is far above real browsing and far below abuse. */
  const gate = await hitLimit(env, `t:${ip}`, 60, 10);
  if (!gate.allowed) return done;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const path = cleanPath(body?.p);
  if (!path) return done;

  const cf = (request as Request & { cf?: { country?: string; region?: string; city?: string } }).cf;
  const abroad = (cf?.country ?? "") !== "MY";
  const state = abroad ? "Outside Malaysia" : (cf?.region ?? "Unknown").slice(0, 40);
  const city = (abroad ? cf?.country ?? "" : cf?.city ?? "").slice(0, 60);

  const day = trafficDay();
  const visitor = await visitorHash(env, ip, ua, day);
  await env.DB.prepare(
    `INSERT INTO traffic_hits (day, visitor, state, city, path, referrer)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  ).bind(day, visitor, state, city, path, refHost(body?.r, ownHost)).run().catch(() => null); // pre-0011: no table, no count
  return done;
}

/** Recompute today's and yesterday's aggregates from the raw hits, then
    prune hits past retention. Runs on the 5-minute cron after the inventory
    sync. Yesterday is included because hits keep arriving around midnight
    (a page open at 23:59 beacons at 00:01 with the old day already stamped);
    once a day is older than that it is final and never touched again —
    which is exactly the guarantee the portal's cursor relies on. */
export async function rollupTraffic(env: Env): Promise<void> {
  for (const day of [trafficDay(0), trafficDay(1)]) {
    /* One batch = one transaction: the portal can poll mid-rollup and see
       the old rows or the new rows, never an empty day. */
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM traffic_daily WHERE day = ?1`).bind(day),
      env.DB.prepare(
        `INSERT INTO traffic_daily (day, state, city, path, visits, visitors)
         SELECT day, state, city, path, COUNT(*), COUNT(DISTINCT visitor)
         FROM traffic_hits WHERE day = ?1 GROUP BY state, city, path`,
      ).bind(day),
      /* The whole-day total row (state=city=path=''): the only place a TRUE
         unique-visitor count can live — distinct hashes cannot be summed
         across the per-state rows without double-counting travellers. */
      env.DB.prepare(
        `INSERT INTO traffic_daily (day, state, city, path, visits, visitors)
         SELECT ?1, '', '', '', COUNT(*), COUNT(DISTINCT visitor)
         FROM traffic_hits WHERE day = ?1
         HAVING COUNT(*) > 0`,
      ).bind(day),
    ]).catch(() => null); // pre-0011: tables not there yet, next deploy's cron catches up
  }
  /* OD-22 — 60 days of raw rows, then gone. The aggregates keep the story. */
  await env.DB.prepare(`DELETE FROM traffic_hits WHERE day < ?1`)
    .bind(trafficDay(60)).run().catch(() => null);
}

/** Bridge feed D data (auth lives with the route in index.ts, beside the
    orders feed it copies). `since` is the newest FINAL day the portal has:
    everything after it is returned, today included as a running total the
    portal must overwrite on every poll, never add to. */
export async function trafficFeed(env: Env, since: string | null): Promise<{
  days: unknown[]; final_through: string; running_day: string; store: string;
}> {
  const { results } = await env.DB.prepare(
    `SELECT day, state, city, path, visits, visitors FROM traffic_daily
     ${since ? "WHERE day > ?1" : ""} ORDER BY day, state, city, path LIMIT 2000`,
  ).bind(...(since ? [since] : [])).all().catch(() => ({ results: [] as unknown[] }));
  return { days: results, final_through: trafficDay(1), running_day: trafficDay(0), store: "elfia" };
}
