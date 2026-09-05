// v1.5.0: notify imported too — the "client gone quiet" cron called it
// without importing it, so every pass threw a silent ReferenceError and the
// feature never fired once.
import { handleStaff, notify, type StaffUser } from "./staff";
import { replayOrRun, purgeIdempotencyKeys, REPLAY_HEADER } from "./outbox"; // v1.105.0 - the outbox, server side
// v1.65.0 — live cards: one counter per topic, bumped where writes land.
import { bumpVersion, topicOf } from "./shared";
// v1.35.0: the ELFIA feed's serialiser lives in its own pure module so the
// bridge-feed guard imports the shipped code, never a copy.
import { serializeBridgeBackdrop, serializeBridgeCatalog, serializeBridgeItems, serializeBridgeSettings, serializeBridgeSlides, type BridgeRow, type SlideRow } from "./bridge-feed";
// v1.36.0–v1.38.0: feeds B and C — movements in, orders pulled, housekeeping.
// v1.43.0: feed D — anonymous traffic aggregates for the ELFIA Traffic map.
import { handleElfiaMovements, pollElfiaOrders, pollElfiaTraffic, bridgeHousekeeping, bridgeHealth } from "./bridge";
import { threadsAuthUrl, threadsCompleteAuth, threadsConfigured, threadsSetupReport, threadsTick } from "./threads";

/**
 * A2Z CREATIVE MARKETING — Admin/API Worker (Phase 3, v0)
 * Static public site stays untouched; this Worker serves /api/v1 on its own route.
 * See API.md, DATABASE.md, SECURITY.md.
 */

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ALLOWED_ORIGIN: string;
  /** v1.29.0 — comma-separated origin list for the domain transition
      (primary FIRST). When set it supersedes ALLOWED_ORIGIN; each entry
      also admits its www./apex twin. */
  ALLOWED_ORIGINS?: string;
  SESSION_PEPPER: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  COMPANY_DOMAIN: string;
  /** v1.29.3 — origins that may submit the PUBLIC enquiry form and nothing
      else. The consultancy site (azoneofficial.com) posts leads into the one
      back office; it can never mint a session or read staff data with this. */
  PUBLIC_FORM_ORIGINS?: string;
  SETUP_TOKEN: string;
  /** v1.31.0 — shared secret for the ELFIA store's stock bridge.
      Optional: unset = the bridge endpoints answer 501 and nothing is
      exposed. Set the SAME value as BRIDGE_KEY on the store's worker. */
  ELFIA_BRIDGE_KEY?: string;
  /** v1.37.0 — the store's orders feed (feed C), e.g.
      https://<store-domain>/api/v1/bridge/orders. A SECRET, not a var —
      the client's domain never enters a committed file (same posture the
      store takes toward ours). Unset = the 5-min poller is silently off. */
  ELFIA_ORDERS_URL?: string;
  /** v1.48.0 — the store's public origin, e.g. https://elfiaofficialstore.my.
      Only used by the ELFIA tab's "Update the shop now" button. Not a secret;
      it lives in wrangler.toml so the button works with no extra setup. */
  ELFIA_STORE_URL?: string;
  /** Shared secret for a relay-based TikTok webhook (Make/Zapier). Optional. */
  TIKTOK_WEBHOOK_SECRET?: string;
  /** TikTok Shop Partner Center app credentials (v1.4.44). */
  TIKTOK_APP_KEY?: string;
  TIKTOK_APP_SECRET?: string;
  /** v1.89.0 — the Meta app behind the Threads workspace. Both are secrets
      (`wrangler secret put`); unset = the Threads tab says so and connects
      nothing. THREADS_TICK_BUDGET is an optional plain var: how many
      subrequests one sync tick may spend (default 24, sized for the free
      Workers plan — raise it on a paid one). */
  THREADS_APP_ID?: string;
  THREADS_APP_SECRET?: string;
  THREADS_TICK_BUDGET?: string;
  /** Web-push (v1.6.0) — generate with `npx web-push generate-vapid-keys`.
      PUBLIC is safe to expose (the browser needs it to subscribe); PRIVATE
      and SUBJECT (a mailto: or https: contact) are secrets. All optional:
      without them push is simply off and in-app + SSE still work. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

import { Role, can, MANDATORY_2FA_ROLES } from "./permissions";
// v1.23.5: the ONE version number — read from the repo root package.json at
// bundle time, so worker and site stamps always come from the same place.
import pkg from "../../package.json";
const WORKER_VERSION: string = (pkg as { version: string }).version;

interface SessionUser {
  id: number;
  email: string;
  name: string;
  role: Role;
  photo_key?: string | null; // v1.4.141: portal header avatar (badge photo)
  requires_2fa?: boolean;
}

/* ---------------- crypto: PBKDF2-SHA256 (WebCrypto-native) ---------------- */
/* Note: SECURITY.md originally specified argon2id; Workers have no native
 * argon2, so we use PBKDF2-SHA256 @ 310k iterations + per-user salt + server
 * pepper. Documented deviation — revisit if a vetted argon2 wasm lib is added. */

/* v1.22.9 (CEO: "why I cant change their password?"): v1.4.280 raised this
   to 310k to match SECURITY.md — but the Cloudflare Workers runtime HARD-CAPS
   PBKDF2 at 100,000 iterations (anti-DoS, cloudflare/workerd#1346) and
   crypto.subtle.deriveBits THROWS above it. Result: since 10-08 every
   password set/change/create 500'd on live. 100k is the platform maximum;
   stored hashes carry their own count, so every existing password still
   verifies. The deviation is documented in SECURITY.md. */
const PBKDF2_ITERATIONS = 100_000;

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(
  password: string,
  saltHex: string,
  pepper: string,
  iterations: number,
): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password + pepper),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const salt = new Uint8Array(
    saltHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)),
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return toHex(bits);
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return toHex(buf);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

/**
 * v1.45.0 (security audit C5) — a real-shaped hash that matches no password,
 * used to make a failed sign-in for an UNKNOWN email cost exactly as much
 * PBKDF2 work as one for a known email with the wrong password. The salt and
 * digest are fixed zeroes: this verifies nothing, it only burns the same
 * time, which is the point. Iterations track the live constant so the two
 * paths never drift apart.
 */
const DUMMY_PASSWORD_HASH = `pbkdf2$${PBKDF2_ITERATIONS}$${"0".repeat(32)}$${"0".repeat(64)}`;

/** Stored format: pbkdf2$<iterations>$<saltHex>$<hashHex> */
export async function createPasswordHash(
  password: string,
  pepper: string,
): Promise<string> {
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt, pepper, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

async function verifyPassword(
  password: string,
  stored: string,
  pepper: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = parseInt(parts[1], 10);
  const salt = parts[2];
  const expected = parts[3];
  if (!salt || !expected || isNaN(iterations)) return false;
  const actual = await hashPassword(password, salt, pepper, iterations);
  // constant-time compare
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) {
    diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/* ---------------- helpers ---------------- */

function json(data: unknown, status = 200, initHeaders: HeadersInit = {}): Response {
  const headers = new Headers(initHeaders);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(data), { status, headers });
}

function errorResponse(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

/** Origins allowed to call the API. v1.29.0 (domain migration): the base is
    ALLOWED_ORIGINS (comma list, primary first — a2zcreative.my during the
    transition) or the legacy single ALLOWED_ORIGIN; every entry also admits
    its www./apex twin (v1.5.0 fix for "sign-in fails on www."). */
function allowedOrigins(env: Env): string[] {
  const bases = (env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN)
    .split(",").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const base of bases) {
    const twin = base.includes("://www.")
      ? base.replace("://www.", "://")
      : base.replace("://", "://www.");
    for (const o of [base, twin]) if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** v1.29.3 — origins allowed to POST the public enquiry form ONLY.
 *
 * The three brands are three separate websites over ONE back office. The
 * consultancy site (azoneofficial.com) needs its contact form to land in the
 * portal's Enquiries tab, but it must never be able to sign anyone in: it is
 * a different legal entity's marketing site, and the blast radius of a
 * compromise there has to stop at "someone submitted a fake lead".
 *
 * So this list is deliberately NOT part of allowedOrigins(): it is consulted
 * at exactly one route (POST /api/v1/enquiries) and for that route's CORS
 * preflight. Same www./apex twinning as the main list. */
function publicFormOrigins(env: Env): string[] {
  const bases = (env.PUBLIC_FORM_ORIGINS ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const out: string[] = [];
  for (const base of bases) {
    const twin = base.includes("://www.")
      ? base.replace("://www.", "://")
      : base.replace("://", "://www.");
    for (const o of [base, twin]) if (!out.includes(o)) out.push(o);
  }
  return out;
}

/** The canonical origin for links WE generate (share links, absolute URLs):
    the first configured origin — https://a2zcreative.my after the switch.
    Old-domain links keep resolving because the old routes stay bound. */
export function primaryOrigin(env: Env): string {
  return (env.ALLOWED_ORIGINS ?? env.ALLOWED_ORIGIN).split(",")[0]!.trim();
}

function corsHeaders(env: Env, request?: Request, allowPublicForm = false): HeadersInit {
  const origins = allowPublicForm ? [...allowedOrigins(env), ...publicFormOrigins(env)] : allowedOrigins(env);
  const reqOrigin = request?.headers.get("Origin");
  const origin = reqOrigin && origins.includes(reqOrigin) ? reqOrigin : origins[0];
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CSRF-Token",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function getCookie(req: Request, name: string): string | null {
  const cookie = req.headers.get("Cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

const SESSION_COOKIE = "azone_session";
const SESSION_TTL_HOURS = 12;

/* v1.28.0 — the newest migration, in ONE place. /api/v1/health/migrations
   compares the ledger tail against this; the EXPECTED_MIGRATIONS list and
   probe set in /health/detail carry the same standing rule: every new
   migration file adds its line here AND there. */
const LATEST_MIGRATION = "0114_outbox";
const OAUTH_STATE_COOKIE = "azone_oauth_state";
const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;


/* ================= Two-factor authentication (TOTP, v1.4.37) =================
   Standard RFC 6238 TOTP: 6 digits, 30-second steps, HMAC-SHA1 — compatible
   with Google Authenticator, Authy, 1Password and Microsoft Authenticator.
   Secrets never leave the server except once, at enrolment. */

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(secret: string): Uint8Array {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of secret.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** The 6-digit code for a given 30s counter. */
async function totpAt(secret: string, counter: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", base32Decode(secret) as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) | (sig[offset + 1] << 16) |
    (sig[offset + 2] << 8) | sig[offset + 3];
  return String(bin % 1_000_000).padStart(6, "0");
}

/** Verify a code, allowing ±1 step (~30s) of clock drift. */
/**
 * Verify a 6-digit code and report WHICH 30-second step it came from, so the
 * caller can record that the step has been spent (see totpVerifyOnce).
 * Returns null when the code matches no step in the window.
 */
async function totpStepOf(secret: string, code: string): Promise<number | null> {
  const clean = (code ?? "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const counter = Math.floor(Date.now() / 30000);
  // One step either side: a phone clock a little fast or slow still works.
  for (const c of [counter - 1, counter, counter + 1]) {
    if (await totpAt(secret, c) === clean) return c;
  }
  return null;
}

async function totpVerify(secret: string, code: string): Promise<boolean> {
  return (await totpStepOf(secret, code)) !== null;
}

/**
 * v1.45.0 (security audit C6) — verify a code and BURN it.
 *
 * A TOTP code stays arithmetically valid for about ninety seconds. Nothing
 * recorded which codes had been used, so a code glimpsed over a shoulder, in
 * a screen share, or in a support screenshot could be replayed for the rest
 * of that window. Each user now remembers the highest step they have already
 * verified (migration 0086) and a code at or below it is refused: every code
 * works exactly once.
 *
 * Armored: on a database that has not run 0086 yet the UPDATE throws, and we
 * fall back to plain verification rather than locking every staff member out
 * of their own account — a missing migration must never become a lockout.
 */
async function totpVerifyOnce(env: Env, userId: number, secret: string, code: string): Promise<boolean> {
  const step = await totpStepOf(secret, code);
  if (step === null) return false;
  try {
    /* One atomic statement decides: the row updates only if this step is
       genuinely newer than the last one spent, so two requests racing with
       the same code cannot both win. */
    const res = await env.DB.prepare(
      `UPDATE users SET totp_last_step = ?2
       WHERE id = ?1 AND (totp_last_step IS NULL OR totp_last_step < ?2)`,
    ).bind(userId, step).run();
    return (res.meta.changes ?? 0) > 0;
  } catch {
    return true; // pre-0086: verified, just not yet replay-protected
  }
}

function randomSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

/** Backup codes: 8 single-use codes, shown once, stored hashed.
    v1.5.0: 10 base32 characters (~50 bits) instead of 8 digits (~27 bits),
    and stored with the PBKDF2 password pipeline instead of bare SHA-256 —
    a leaked twofa_backup_codes table is no longer reversible on a laptop. */
function makeBackupCodes(): string[] {
  const codes: string[] = [];
  for (let i = 0; i < 8; i++) {
    const raw = base32Encode(crypto.getRandomValues(new Uint8Array(7))).slice(0, 10);
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/** Every staff role may (and should) protect their account with 2FA — staff
    accounts hold and populate company data, so integrity demands it for all.
    Only customer accounts are excluded. */
const TWOFA_ELIGIBLE = (role: string) => role !== "customer";

/* ================= TikTok Shop integration (v1.4.44) =================
   TikTok signs webhooks itself — there is no custom header to set — so the
   endpoint verifies TikTok's own signature. Two signing conventions are in
   use across TikTok's platforms, so both are checked:
     A. header "tiktok-signature": HMAC-SHA256(app_secret, app_key + rawBody)
     B. header "tiktok-signature": "t=<ts>,s=<sig>" with
        HMAC-SHA256(app_secret, ts + rawBody)
   Every receipt is logged to webhook_events with its verified flag, so if
   TikTok uses a different string, the real headers are on record to adjust. */

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifyTikTokSignature(env: Env, header: string, rawBody: string): Promise<boolean> {
  if (!env.TIKTOK_APP_SECRET || !env.TIKTOK_APP_KEY || !header) return false;
  const plain = header.trim();
  // Scheme A — plain hex signature.
  if (!plain.includes("=")) {
    const expected = await hmacHex(env.TIKTOK_APP_SECRET, env.TIKTOK_APP_KEY + rawBody);
    return timingSafeEqual(expected, plain);
  }
  // Scheme B — "t=<timestamp>,s=<signature>". v1.5.0: split on the FIRST "="
  // only, so a base64/padded signature value is never truncated.
  const parts = Object.fromEntries(
    plain.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as [string, string];
    }),
  );
  if (!parts.t || !parts.s) return false;
  // Reject stale timestamps (5 minutes) to blunt replay attacks.
  const age = Math.abs(Date.now() / 1000 - Number(parts.t));
  if (!Number.isFinite(age) || age > 300) return false;
  const expected = await hmacHex(env.TIKTOK_APP_SECRET, `${parts.t}${rawBody}`);
  return timingSafeEqual(expected, parts.s);
}



/** v1.7.1: refresh the seller access token using the stored refresh token.
    TikTok Shop access tokens expire (~7 days); the refresh token lasts far
    longer, so this keeps the connection alive without a human re-authorizing.
    Returns null (leaving the old token in place) if refresh fails — e.g. when
    TIKTOK_APP_SECRET is stale, which is the real cause to fix. */
async function refreshTikTokToken(
  env: Env, refreshToken: string,
): Promise<{ access_token: string; refresh_token: string; expire_in: number } | null> {
  if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) return null;
  const url = new URL("https://auth.tiktok-shops.com/api/v2/token/refresh");
  url.searchParams.set("app_key", env.TIKTOK_APP_KEY);
  url.searchParams.set("app_secret", env.TIKTOK_APP_SECRET);
  url.searchParams.set("refresh_token", refreshToken);
  url.searchParams.set("grant_type", "refresh_token");
  try {
    const res = await fetch(url.toString());
    const data = (await res.json().catch(() => null)) as {
      data?: { access_token?: string; refresh_token?: string; access_token_expire_in?: number };
    } | null;
    const tok = data?.data;
    if (!tok?.access_token) return null;
    return {
      access_token: tok.access_token,
      refresh_token: tok.refresh_token ?? refreshToken,
      expire_in: tok.access_token_expire_in ?? 604800,
    };
  } catch {
    return null;
  }
}

/** Stored seller token. v1.7.1: auto-refreshes shortly BEFORE expiry so the
    order sync never dies on "Expired credentials". */
async function tiktokToken(env: Env): Promise<{ access_token: string; shop_cipher: string | null } | null> {
  const row = await env.DB.prepare(
    `SELECT access_token, refresh_token, shop_cipher,
            (expires_at IS NOT NULL AND expires_at <= datetime('now', '+1 day')) AS expiring
     FROM integration_tokens WHERE provider = 'tiktok'`,
  ).first<{ access_token: string; refresh_token: string | null; shop_cipher: string | null; expiring: number }>();
  if (!row) return null;
  if (row.expiring && row.refresh_token) {
    const fresh = await refreshTikTokToken(env, row.refresh_token);
    if (fresh) {
      await env.DB.prepare(
        `UPDATE integration_tokens SET access_token = ?1, refresh_token = ?2,
           expires_at = datetime('now', '+' || ?3 || ' seconds'), updated_at = datetime('now')
         WHERE provider = 'tiktok'`,
      ).bind(fresh.access_token, fresh.refresh_token, String(fresh.expire_in)).run();
      return { access_token: fresh.access_token, shop_cipher: row.shop_cipher };
    }
    // Refresh failed — surface it once (deduped) so the cause is visible.
    await logError(env, "tiktok_token_refresh", "Access token expired and refresh failed — re-authorize the TikTok app, or check that TIKTOK_APP_SECRET matches Partner Center.");
  }
  return { access_token: row.access_token, shop_cipher: row.shop_cipher };
}

/** TikTok Shop API request signing: every call carries app_key, timestamp and
    sign = HMAC-SHA256(app_secret, app_secret + path + sorted(k+v) + body + app_secret).
    access_token and sign itself are excluded from the signed parameter set. */
/* ========== TikTok Shop ANALYTICS — the metric readers (v1.64.0) ==========
 *
 * What the 28-08-2026 probe rounds settled, and what it cost to learn:
 *
 *   1. `version` is PER ENDPOINT, not global. One version for all of them
 *      failed five of eight on 36009004 before TikTok ever looked at this
 *      shop's authorisation.
 *   2. `currency` is effectively REQUIRED. Omit it and the answer is 36009003
 *      "Internal error" — not a missing-parameter message.
 *   3. 36009003 can ALSO be genuinely transient: granularity=1D failed one
 *      round and passed the next with no code change.
 *   4. `shop_lives/overview_performance` answers 36009003 in EVERY shape
 *      tried — with and without `version`, with and without granularity and
 *      account_type. It is the one endpoint that never opens.
 *
 * Point 4 matters more than it looks. /api/v1/live-analytics has always
 * called exactly that endpoint, so the portal's LIVE card has been showing
 * TikTok's internal error since the day it shipped — the probe did not find
 * a new fault, it explained an old one. The answer is not to keep knocking
 * on a door that does not open: the same numbers are read below from
 * `shop_lives/performance` @202509, which does answer, and which returns
 * every live with its own sales_performance and interaction_performance.
 */

/** The version TikTok stamps on each analytics endpoint. NOT a global API
    version — each is the version OF THAT ENDPOINT, taken from TikTok's own
    documentation slugs and then confirmed against this shop. */
const TT_ANALYTICS = {
  shop: "202405",
  products: "202405",
  skus: "202509",
  videos: "202509",   // a 202409 revision also answers; 202509 carries more
  lives: "202509",
} as const;

/** Metrics that mean something when ADDED UP across rows. Rates and averages
    are deliberately absent: summing a click-through rate produces a number
    that looks like data and is nonsense. */
const TT_ADDITIVE = new Set([
  "gmv", "orders", "sku_orders", "units_sold", "items_sold", "views", "likes",
  "comments", "shares", "new_followers", "followers", "impressions",
  "unique_viewers", "customers", "buyers", "unique_buyers", "page_views",
  "product_impressions", "duration", "live_count", "video_count",
]);

/** Pull every additive metric out of a payload whose exact nesting we do not
    control, adding into `into`. TikTok wraps money as {amount, currency} in
    some places and a bare number in others, and moves fields between
    releases; this reads both shapes and ignores what it does not recognise
    rather than guessing. Depth-capped so a freakishly deep or cyclic
    response cannot hang the worker. */
function ttAccumulate(node: unknown, into: Record<string, number>, depth = 0): void {
  if (depth > 6 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const v of node) ttAccumulate(v, into, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    const key = k.toLowerCase();
    if (TT_ADDITIVE.has(key)) {
      let n: number | null = null;
      if (typeof v === "number" && Number.isFinite(v)) n = v;
      else if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) n = Number(v);
      else if (v && typeof v === "object" && "amount" in (v as Record<string, unknown>)) {
        const amt = (v as { amount?: unknown }).amount;
        if (amt !== undefined && amt !== null && Number.isFinite(Number(amt))) n = Number(amt);
      }
      if (n !== null) into[key] = (into[key] ?? 0) + n;
    }
    if (v && typeof v === "object") ttAccumulate(v, into, depth + 1);
  }
}

/** The first array inside a TikTok `data` object — their list endpoints name
    it differently per resource (products, videos, lives …) and the name has
    changed between versions, so the shape is found rather than assumed. */
function ttRows(data: unknown): Record<string, unknown>[] {
  if (!data || typeof data !== "object") return [];
  for (const v of Object.values(data as Record<string, unknown>)) {
    if (Array.isArray(v)) return v.filter((r) => r && typeof r === "object") as Record<string, unknown>[];
  }
  return [];
}

/** One analytics call, carrying its own version and the parameters every one
    of them needs. Returns TikTok's reply, or a plain reason when it refused,
    so the panel can SAY which part is unavailable instead of drawing a zero
    that looks like a real number. */
async function ttAnalytics(
  env: Env, version: string, resource: string, extra: Record<string, string>,
  range: { start_date_ge: string; end_date_lt: string }, suffix = "performance",
): Promise<{ ok: boolean; data?: unknown; why?: string }> {
  /* v1.70.3 — RETRY 36009003. TikTok's own message is "Retry later", and
     my notes have said since round 3 that this code is often transient:
     granularity=1D refused one afternoon and answered the next with no
     code change. That was written down and never acted on, so a shop
     whose totals happened to be refused at the moment somebody opened
     the tab saw four dashes and nothing to do about it.
     One retry, after a pause. Not three: if their aggregation really is
     down, hammering it neither helps them nor us, and the panel is honest
     about a refusal. The pause matters because an immediate retry lands
     inside the same failing moment. */
  let res: { code?: number; message?: string; data?: unknown } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 900));
    res = (await tiktokSignedFetch(env, `/analytics/${version}/${resource}/${suffix}`, {
      version, ...range, currency: "LOCAL", ...extra,
    })) as { code?: number; message?: string; data?: unknown } | null;
    if (res && res.code === 36009003) continue;   // their "retry later"
    break;
  }
  if (!res) return { ok: false, why: "TikTok is not connected — finish the authorisation in Partner Center." };
  if (typeof res.code === "number" && res.code !== 0) {
    const msg = res.message ?? "refused";
    /* Naming 36009003 as theirs is not an excuse — it is the difference
       between the CEO waiting on us and the CEO knowing to wait on TikTok. */
    const theirs = res.code === 36009003
      ? " — their side, not the shop's. Asked twice. The other figures on this card are unaffected."
      : "";
    const scope = /scope|permission|auth|access/i.test(msg)
      ? " — grant the Data & Insights (Analytics) scope in Partner Center, then re-authorize." : "";
    return { ok: false, why: `TikTok: ${msg}${theirs}${scope}` };
  }
  return { ok: true, data: res.data };
}


/** v1.64.1 — the same call across a list of candidate END dates, stopping at
    the first TikTok accepts.
    shop/performance refused `end_date_lt = tomorrow` with 36009003 while the
    list endpoints allowed it. Rather than pick one date and hope, the totals
    ask for the window that has always worked and then reach for the wider
    one, reporting which they got — so "up to yesterday" is a labelled fact
    rather than a silent shortfall. */
async function ttAnalyticsWindow(
  env: Env, version: string, resource: string, extra: Record<string, string>,
  start: string, ends: string[],
): Promise<{ ok: boolean; data?: unknown; why?: string; end?: string }> {
  let last: { ok: boolean; data?: unknown; why?: string } = { ok: false, why: "no window tried" };
  for (const end of ends) {
    last = await ttAnalytics(env, version, resource, extra,
                             { start_date_ge: start, end_date_lt: end });
    if (last.ok) return { ...last, end };
  }
  return last;
}

/** The same call across candidate VERSIONS, stopping at the first that
    answers. Used where a newer version carries a field the older one omits
    (product and SKU names) but may not exist for that resource: 36009004
    names the version, so the fallback is one wasted call, once per cache
    period, in exchange for rows that have a name instead of an id. */
async function ttAnalyticsVersions(
  env: Env, versions: string[], resource: string, extra: Record<string, string>,
  range: { start_date_ge: string; end_date_lt: string },
): Promise<{ ok: boolean; data?: unknown; why?: string }> {
  let last: { ok: boolean; data?: unknown; why?: string } = { ok: false, why: "no version tried" };
  for (const v of versions) {
    last = await ttAnalytics(env, v, resource, extra, range);
    if (last.ok) return last;
  }
  return last;
}

/* ===================== v1.70.2 - TikTok ids survive the JSON parse =======
   THE BUG THIS EXISTS FOR, and it cost three releases.

   TikTok ids are 19-digit snowflakes. `Number.MAX_SAFE_INTEGER` is 16
   digits. The analytics endpoints return ids as JSON NUMBERS, so
   `res.json()` rounds them, silently and irreversibly:

     1736703643101529119  ->  1736703643101529000
     1737184156551578655  ->  1737184156551578600

   Every id ending in 00 in the panel was a corrupted id. Nothing downstream
   could ever match: the catalogue returns its ids as STRINGS, precise, so
   the join compared a real id against a rounded one and found nothing. The
   per-product lookup then asked TikTok for an id that does not exist and got
   "Precondition Required. This operation requires an existing product ID" -
   which is TRUE of the id we sent, and says nothing about the product.

   I read that refusal as "the product was deleted" and shipped a panel that
   told the CEO sixteen live products were gone. The API answered honestly;
   the question had been corrupted before it was asked.

   So the response is parsed from TEXT, with any integer too long to survive
   quoted first. Applied to EVERY TikTok call, not only analytics: order and
   shop ids are snowflakes too, and have been getting the same treatment
   wherever TikTok happened to send them as numbers. */
function ttParse(raw: string): unknown {
  try {
    /* Only integers in VALUE position (after : [ or ,) and only those long
       enough to be unsafe. Digits already inside quotes are preceded by a
       quote, so a string can never match. The trailing delimiter is a
       lookahead so two adjacent ids in an array both match. */
    return JSON.parse(raw.replace(/([:[,]\s*)(-?\d{16,})(?=\s*[,\]}])/g, '$1"$2"'));
  } catch {
    return null;
  }
}

async function tiktokSignedFetch(
  env: Env, path: string, params: Record<string, string>, body?: string, method = "GET",
): Promise<unknown> {
  const tok = await tiktokToken(env);
  if (!tok || !env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) return null;
  const all: Record<string, string> = {
    ...params,
    app_key: env.TIKTOK_APP_KEY,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  if (tok.shop_cipher) all.shop_cipher = tok.shop_cipher;
  const sortedConcat = Object.keys(all).sort().map((k) => k + all[k]).join("");
  const base = env.TIKTOK_APP_SECRET + path + sortedConcat + (body ?? "") + env.TIKTOK_APP_SECRET;
  all.sign = await hmacHex(env.TIKTOK_APP_SECRET, base);
  const url = new URL(`https://open-api.tiktokglobalshop.com${path}`);
  for (const [k, v] of Object.entries(all)) url.searchParams.set(k, v);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers: { "x-tts-access-token": tok.access_token, "Content-Type": "application/json" },
      body: method === "GET" ? undefined : body,
    });
    /* NOT res.json(): see ttParse above. Reading the body as text and
       quoting the oversized integers first is the only way an id survives. */
    return ttParse(await res.text().catch(() => ""));
  } catch {
    return null;
  }
}


/** v1.64.4 — TikTok id -> something a person can read.
    NONE of the analytics endpoints return a product or variant name. They
    return ids, which is how the panel came to show a table of 19-digit
    numbers: correct, verifiable, and useless for deciding what to reorder.
    So the names are fetched separately and joined on.

    v1.64.2 tried two sources and stopped at the first that returned
    ANYTHING. That was the bug in it: a source that answered with one name
    counted as success, the panel stayed full of ids, and — because the
    "could not name these" warning only fired when the map was completely
    empty — it said nothing at all. Silence is the one outcome this panel is
    not allowed to produce.

    So now: three sources, run in order, each one only asked about what is
    still unnamed after the last, and the warning is decided by COVERAGE of
    the ids actually on screen rather than by whether the map is empty.

      1. The catalogue list (POST /product/202309/products/search) — every
         product with its title, every SKU with the sales attributes that
         make up its variant name.
      2. Per-product detail (GET /product/202309/products/{id}) for whatever
         the list did not cover. A handful of calls, not a scan.
      3. Recent orders. Every line item carries product_name and sku_name.
         This needs no product scope at all, and it covers exactly the rows
         the analytics tabs show, because a row is only there if it sold.

    `sources` and `counts` come back in the payload so the diagnostic panel
    can say which one answered and how much it covered. Guessing at this
    twice was enough. */
interface TtNames {
  products: Record<string, string>;   // product id  -> title
  variants: Record<string, string>;   // sku id      -> variant name ("Mocha, Free size")
  skuProduct: Record<string, string>; // sku id      -> its product's title
  sources: string[];                  // which of the three actually contributed
  notes: string[];                    // what each source said when it did not
  /* v1.70.1 — product ids TikTok says no longer exist. Not a failure: the
     product sold and was later deleted from the catalogue. Kept apart so the
     panel can state it as a fact instead of quoting an error. */
  gone: string[];
}

/* v1.64.5: one id from each side, so an id-space mismatch is VISIBLE rather
   than theorised. If the ids the panel wants and the ids a source harvested
   do not even look alike, that is the whole diagnosis in one line. */
function ttSampleId(m: Record<string, string>): string {
  for (const k of Object.keys(m)) return k;
  return "";
}

/* v1.70.2 - the key moves with the fix. Every map cached before this holds
   ROUNDED ids and lives for six hours: leaving the key alone would have
   shipped the fix and then served the bug for the rest of the day. */
const TT_NAMES_KEY = "tiktok_name_map_v2";

/** Pull every product page TikTok will give us. */
async function ttNamesFromCatalogue(env: Env, out: TtNames, status = ""): Promise<string> {
  type TtProd = {
    id?: string | number; title?: string; product_name?: string;
    skus?: { id?: string | number; seller_sku?: string;
             sales_attributes?: { name?: string; value_name?: string }[] }[];
  };
  type TtResp = { code?: number; message?: string;
                  data?: { products?: TtProd[]; next_page_token?: string } } | null;
  let token = "";
  let said = "";
  let found = 0;
  for (let pg = 0; pg < 5; pg++) {
    const res = (await tiktokSignedFetch(
      env, "/product/202309/products/search",
      { page_size: "100", ...(token ? { page_token: token } : {}) },
      /* An empty body is TikTok's "everything I would normally list", and
         it is what the first pass sends. It does NOT include products the
         shop has deleted or deactivated — which is why a product that sold
         last week and was archived on Monday came back nameless. Those get
         a second pass with an explicit status (v1.70.1). */
      JSON.stringify(status ? { status } : {}), "POST",
    )) as TtResp;
    if (!res || (typeof res.code === "number" && res.code !== 0)) {
      if (pg === 0) said = String(res?.message ?? "no response");
      break;
    }
    for (const pr of res.data?.products ?? []) { ttNamesTakeProduct(pr, out); found++; }
    token = res.data?.next_page_token ?? "";
    if (!token) break;
  }
  return said || (found > 0 ? "" : "the catalogue list came back empty");
}

/** One product's detail, for ids the list did not cover. */
async function ttNamesFromDetail(
  env: Env, out: TtNames, ids: string[],
): Promise<{ said: string; gone: string[] }> {
  let said = "";
  /* v1.70.1 — ids TikTok says do not exist any more.
     "Precondition Required. This operation requires an existing product ID"
     is not a fault to report and not something anybody can fix: it means the
     product was deleted from the catalogue after it sold. Collecting them
     separately is what lets the panel say "these are gone" instead of
     pasting an error that reads like a problem with the shop. */
  const gone: string[] = [];
  /* Capped hard: this runs behind a six-hour cache and must never turn into
     a scan of the catalogue one row at a time. */
  for (const id of ids.slice(0, 15)) {
    const res = (await tiktokSignedFetch(env, `/product/202309/products/${id}`, {})) as
      { code?: number; message?: string; data?: Record<string, unknown> } | null;
    if (!res || (typeof res.code === "number" && res.code !== 0)) {
      const msg = String(res?.message ?? "no response");
      if (/precondition|existing product|not exist|not found/i.test(msg)) { gone.push(id); continue; }
      if (!said) said = msg;
      continue;
    }
    if (res.data) ttNamesTakeProduct({ id, ...res.data }, out);
  }
  return { said, gone };
}

/** Names carried by recent orders — no product scope needed. */
async function ttNamesFromOrders(env: Env, out: TtNames): Promise<string> {
  type TtOrd = { line_items?: { sku_id?: string | number; product_id?: string | number;
                                product_name?: string; sku_name?: string }[] };
  type TtResp = { code?: number; message?: string;
                  data?: { orders?: TtOrd[]; next_page_token?: string } } | null;
  const body = JSON.stringify({ create_time_ge: Math.floor(Date.now() / 1000) - 90 * 86400 });
  let token = "";
  let said = "";
  let found = 0;
  /* Six pages / 300 orders, matching the order sync's own depth. The point
     of this source is coverage of everything that SOLD, and stopping at 200
     orders quietly loses the oldest of them. */
  for (let pg = 0; pg < 6; pg++) {
    const res = (await tiktokSignedFetch(
      env, "/order/202309/orders/search",
      { page_size: "50", ...(token ? { page_token: token } : {}) }, body, "POST",
    )) as TtResp;
    if (!res || (typeof res.code === "number" && res.code !== 0)) {
      if (pg === 0) said = String(res?.message ?? "no response");
      break;
    }
    for (const o of res.data?.orders ?? []) {
      for (const li of o.line_items ?? []) {
        const sid = ttIdStr(li.sku_id);
        const pid = ttIdStr(li.product_id);
        const pn = typeof li.product_name === "string" ? li.product_name.trim() : "";
        const sn = typeof li.sku_name === "string" ? li.sku_name.trim() : "";
        if (pn) found++;
        if (sid && sn) out.variants[sid] ??= sn.slice(0, 80);
        if (sid && pn) out.skuProduct[sid] ??= pn.slice(0, 120);
        if (pid && pn) out.products[pid] ??= pn.slice(0, 120);
      }
    }
    token = res.data?.next_page_token ?? "";
    if (!token) break;
  }
  return said || (found > 0 ? "" : "recent orders carried no item names");
}

function ttIdStr(v: unknown): string {
  if (typeof v === "string" && v.trim() !== "") return v.trim();
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return "";
}

/** Fold one catalogue product (from either the list or the detail call). */
function ttNamesTakeProduct(pr: Record<string, unknown>, out: TtNames): void {
  const pid = ttIdStr(pr.id);
  const rawTitle = pr.title ?? pr.product_name;
  const title = typeof rawTitle === "string" ? rawTitle.trim() : "";
  if (pid && title) out.products[pid] = title.slice(0, 120);
  const skus = Array.isArray(pr.skus) ? (pr.skus as Record<string, unknown>[]) : [];
  for (const sk of skus) {
    const sid = ttIdStr(sk.id);
    if (!sid) continue;
    /* A variant name is the sales attributes joined: "Mocha, Free size".
       Falling back to the seller's own SKU code is better than nothing,
       because that is what is written on the shelf. */
    const attrs = Array.isArray(sk.sales_attributes)
      ? (sk.sales_attributes as { value_name?: unknown }[])
          .map((a) => (typeof a.value_name === "string" ? a.value_name.trim() : ""))
          .filter(Boolean)
      : [];
    const seller = typeof sk.seller_sku === "string" ? sk.seller_sku.trim() : "";
    /* v1.70.3 — a product with ONE unnamed SKU has no separate variant
       identity: no colour, no size, no seller code. TikTok sends that SKU
       with an empty sales_attributes, and the old rule stored nothing at
       all, so the Variants tab printed a 19-digit id for it.
       The product's own title is the truthful label there. It repeats what
       the Product column says, which is exactly right when the variant IS
       the product, and is in every case better than a number. */
    const label = attrs.length > 0 ? attrs.join(", ") : seller || title;
    if (label) out.variants[sid] = label.slice(0, 80);
    if (title) out.skuProduct[sid] = title.slice(0, 120);
  }
}

/** The map, built to cover the ids this page is actually going to show.
    Cached six hours — a catalogue changes on the day someone edits it, not
    on the half hour — but a cached map that does not cover the ids in front
    of us is refreshed rather than trusted. */
async function ttNameMap(
  env: Env, fresh: boolean, wantProducts: string[], wantSkus: string[],
): Promise<TtNames> {
  const empty = (): TtNames => ({ products: {}, variants: {}, skuProduct: {}, sources: [], notes: [], gone: [] });
  const covers = (m: TtNames): boolean =>
    wantProducts.every((id) => m.products[id])
    && wantSkus.every((id) => m.variants[id] ?? m.skuProduct[id]);

  if (!fresh) {
    try {
      const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
        .bind(TT_NAMES_KEY).first<{ value: string }>();
      if (row?.value) {
        const c = JSON.parse(row.value) as { at: number; map: TtNames };
        /* A map cached by an EARLIER build has no `gone` (and, on a much
           older one, no `sources`). Reading `.length` off undefined would
           throw a 500 on the first request after every deploy that adds a
           field here — the cache outlives the code that wrote it, so it is
           normalised on the way in rather than trusted. */
        if (c.map) {
          c.map.gone ??= [];
          c.map.notes ??= [];
          c.map.sources ??= [];
        }
        if (Date.now() - c.at < 6 * 3600 * 1000 && c.map?.products && covers(c.map)) return c.map;
      }
    } catch { /* no cache yet */ }
  }

  const out = empty();
  const before = () => Object.keys(out.products).length + Object.keys(out.variants).length;

  let n = before();
  const catalogue = await ttNamesFromCatalogue(env, out);
  if (before() > n) out.sources.push("catalogue");
  if (catalogue) out.notes.push(`catalogue list: ${catalogue}`);

  /* v1.70.1 — the archived shelf.
     The default list is what TikTok would normally show a seller, and it
     leaves out anything deleted or deactivated. A product that sold last
     week and was archived on Monday is therefore absent from it while still
     appearing in the analytics — which is exactly the row that came back
     nameless. These extra passes run ONLY when something is still unnamed,
     so a shop whose catalogue is intact pays nothing for them. */
  if (wantProducts.some((id) => !out.products[id])) {
    for (const status of ["SELLER_DEACTIVATED", "PLATFORM_DEACTIVATED", "FREEZE", "DELETED"]) {
      if (wantProducts.every((id) => out.products[id])) break;
      n = before();
      const extra = await ttNamesFromCatalogue(env, out, status);
      if (before() > n && !out.sources.includes("archived products")) {
        out.sources.push("archived products");
      }
      /* A status this shop has never used answers empty, which is not worth
         telling anyone about. Only a real refusal is noted. */
      if (extra && !/came back empty/.test(extra)) out.notes.push(`${status.toLowerCase()}: ${extra}`);
    }
  }

  const stillUnnamed = wantProducts.filter((id) => !out.products[id]);
  if (stillUnnamed.length > 0) {
    n = before();
    const detail = await ttNamesFromDetail(env, out, stillUnnamed);
    if (before() > n) out.sources.push("product detail");
    out.gone = detail.gone;
    /* Only a REAL problem becomes a note. "This product no longer exists" is
       the answer to the question, not a failure to answer it. */
    if (detail.said) out.notes.push(`product detail: ${detail.said}`);
  }

  if (!covers(out)) {
    n = before();
    const orders = await ttNamesFromOrders(env, out);
    if (before() > n) out.sources.push("orders");
    if (orders) out.notes.push(`orders: ${orders}`);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO system_meta (key, value) VALUES (?1, ?2)
       ON CONFLICT (key) DO UPDATE SET value = ?2`,
    ).bind(TT_NAMES_KEY, JSON.stringify({ at: Date.now(), map: out })).run();
  } catch { /* uncached is fine */ }
  return out;
}

/** Group TikTok line items (one row per unit) into SKU + quantity. */
function groupLineItems(items: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number }[]): { sku: string; name: string; variant: string; qty: number; unit_sale_cents: number | null }[] {
  // v1.4.162: carry the TikTok names too — matching now falls back to the
  // item description when the SKU doesn't line up with inventory.
  // v1.4.166: also carry the ACTUAL per-unit sale price (what the buyer paid
  // after live rebates) — the rebate is computed from it, never typed in.
  const merged = new Map<string, { sku: string; name: string; variant: string; qty: number; saleSum: number; salePriced: number }>();
  for (const li of items) {
    const sku = (li.seller_sku ?? li.sku_id ?? "").trim();
    const variant = (li.sku_name ?? "").trim();
    const name = [li.product_name, li.sku_name].filter(Boolean).join(" ").trim();
    const key = (sku || name).toLowerCase();
    if (!key) continue;
    const saleC = Math.round(Number(li.sale_price ?? NaN) * 100);
    const cur = merged.get(key) ?? { sku, name, variant, qty: 0, saleSum: 0, salePriced: 0 };
    cur.qty += 1;
    if (Number.isFinite(saleC) && saleC >= 0) { cur.saleSum += saleC; cur.salePriced += 1; }
    merged.set(key, cur);
  }
  return [...merged.values()].map((v) => ({
    sku: v.sku, name: v.name, variant: v.variant, qty: v.qty,
    unit_sale_cents: v.salePriced > 0 ? Math.round(v.saleSum / v.salePriced) : null,
  }));
}

/** v1.4.162 (CEO: "sync with TikTok order based on item desc or SKU"):
    resolve a TikTok line to an inventory item —
      1) SKU, case-insensitive + trimmed (was exact-match only)
      2) exact item-name match against the variant (sku_name) or full name
      3) unique-contains: the inventory item's name appears inside the TikTok
         product/variant name AND only ONE inventory item qualifies — a
         multi-hit never deducts, so an ambiguous name can't move the wrong
         stock. Names shorter than 3 chars never contains-match. */
async function matchInventoryItem(env: Env, sku: string, name: string, variant: string):
    Promise<{ id: number; stock: number; name: string; unit_price_cents: number | null; via: "sku" | "name" } | null> {
  if (sku) {
    const bySku = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items WHERE lower(trim(sku)) = lower(trim(?1)) LIMIT 1`,
    ).bind(sku).first<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (bySku) return { ...bySku, via: "sku" };
  }
  for (const cand of [variant, name]) {
    if (!cand) continue;
    const exact = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items WHERE lower(trim(name)) = lower(trim(?1)) LIMIT 1`,
    ).bind(cand).first<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (exact) return { ...exact, via: "name" };
  }
  if (name) {
    const contains = await env.DB.prepare(
      `SELECT id, stock, name, unit_price_cents FROM inventory_items
       WHERE length(trim(name)) >= 3 AND instr(lower(?1), lower(trim(name))) > 0 LIMIT 2`,
    ).bind(name).all<{ id: number; stock: number; name: string; unit_price_cents: number | null }>();
    if (contains.results.length === 1) return { ...contains.results[0]!, via: "name" };
  }
  return null;
}

/** v1.4.166: write a TikTok stock movement with the actual sold price, then
    auto-sync the item's live rebate = list price − sold price (never
    negative; untouched when the order carried no price or no list price is
    set). Tolerant of migrations 0046/0047 not being applied yet. */
async function recordTiktokLine(env: Env, postageId: number, itemId: number, qty: number, unitSaleCents: number | null): Promise<void> {
  try {
    await env.DB.prepare(
      `INSERT INTO postage_items (postage_id, inventory_item_id, qty, unit_sale_cents) VALUES (?1, ?2, ?3, ?4)`,
    ).bind(postageId, itemId, qty, unitSaleCents).run();
  } catch (e) {
    if (!String(e).includes("no such column")) throw e;
    await env.DB.prepare(
      `INSERT INTO postage_items (postage_id, inventory_item_id, qty) VALUES (?1, ?2, ?3)`,
    ).bind(postageId, itemId, qty).run();
  }
  if (unitSaleCents !== null && unitSaleCents >= 0) {
    try {
      await env.DB.prepare(
        `UPDATE inventory_items SET live_rebate_cents = CASE
           WHEN unit_price_cents IS NOT NULL AND unit_price_cents > ?1 THEN unit_price_cents - ?1
           ELSE 0 END
         WHERE id = ?2 AND unit_price_cents IS NOT NULL AND unit_price_cents > 0`,
      ).bind(unitSaleCents, itemId).run();
    } catch { /* 0046 not applied — skip the auto rebate */ }
  }
}

/** The token response does NOT include the shop identifier. Order APIs
    require shop_cipher, which comes from Get Authorized Shops — fetched once
    after authorization and stored beside the token (v1.4.57). */
async function refreshTikTokShopCipher(env: Env): Promise<{ ok: boolean; detail: string }> {
  // The two shops endpoints sit under DIFFERENT scope families; try both so
  // whichever scope is active on the app can supply the cipher (v1.4.61).
  const attempts: string[] = [];
  for (const path of ["/authorization/202309/shops", "/seller/202309/shops"]) {
    const data = (await tiktokSignedFetch(env, path, {})) as {
      code?: number; message?: string;
      data?: {
        shops?: { id?: string; cipher?: string }[];
        shop_list?: { shop_id?: string; shop_cipher?: string; cipher?: string }[];
      };
    } | null;
    if (!data) { attempts.push(`${path}: no response`); continue; }
    const a = data.data?.shops?.[0];
    const b = data.data?.shop_list?.[0];
    const cipher = a?.cipher ?? b?.shop_cipher ?? b?.cipher ?? null;
    const shopId = a?.id ?? b?.shop_id ?? null;
    if (cipher) {
      await env.DB.prepare(
        `UPDATE integration_tokens SET shop_id = ?1, shop_cipher = ?2, updated_at = datetime('now')
         WHERE provider = 'tiktok'`,
      ).bind(shopId, cipher).run();
      return { ok: true, detail: `stored via ${path}` };
    }
    attempts.push(
      typeof data.code === "number" && data.code !== 0
        ? `${path} → TikTok code ${data.code}: ${data.message ?? "no message"}`
        : `${path} → empty shop list (seller authorization may not have completed)`,
    );
  }
  return { ok: false, detail: attempts.join(" · ") };
}

/** Order webhooks carry only an id + status, so the line items are fetched.
    Returns [] when no token is stored yet (order still gets recorded).
    v1.4.71: also surfaces the buyer's CITY (never the street address). */
async function tiktokOrderItems(env: Env, orderId: string): Promise<{ items: ReturnType<typeof groupLineItems>; city: string | null }> {
  const data = (await tiktokSignedFetch(env, "/order/202309/orders", { ids: orderId })) as {
    data?: { orders?: {
      line_items?: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number }[];
      recipient_address?: {
        city?: string; state?: string; district?: string; town?: string;
        district_info?: { address_level_name?: string; address_name?: string }[];
      };
    }[] };
  } | null;
  const order = data?.data?.orders?.[0];
  const ra = order?.recipient_address;
  const city = (
    ra?.city ??
    ra?.district_info?.find((d) => /city|bandar/i.test(d.address_level_name ?? ""))?.address_name ??
    // v1.4.190: some region payloads carry only the FLAT district/town keys
    ra?.district ?? ra?.town ??
    ra?.state ??
    ra?.district_info?.find((d) => /state|negeri|province/i.test(d.address_level_name ?? ""))?.address_name ??
    // v1.4.179: district level, then ANY named area level — still an area,
    // never the street address (privacy rule unchanged).
    ra?.district_info?.find((d) => /district|daerah/i.test(d.address_level_name ?? ""))?.address_name ??
    ra?.district_info?.find((d) => (d.address_name ?? "").trim() !== "")?.address_name ??
    null
  )?.slice(0, 80) ?? null;
  // v1.4.190 diagnostic (privacy-safe: STRUCTURE only, never values): when a
  // location still can't be extracted, record which keys/levels TikTok sent
  // so the unseen regional shape can be added to the chain.
  if (!city) {
    await logError(env, "tiktok_location", `order ${orderId}: ra_keys=[${Object.keys(ra ?? {}).join(",") || "ABSENT"}] district_info=${JSON.stringify(ra?.district_info)}`);
  }
  return { items: groupLineItems(order?.line_items ?? []), city };
}

async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomHex(32);
  // Store only the hash: a leaked sessions table cannot be replayed.
  const tokenHash = await sha256Hex(token);
  try {
    await env.DB.prepare(
      `INSERT INTO sessions (id, user_id, expires_at)
       VALUES (?1, ?2, datetime('now', '+${SESSION_TTL_HOURS} hours'))`,
    )
      .bind(tokenHash, userId)
      .run();
  } catch (e) {
    throw new Error(`session insert for user ${userId}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Opportunistic housekeeping: purge expired sessions. Never fatal.
  try {
    await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run();
  } catch (e) {
    console.error("session housekeeping failed:", e);
  }
  return token;
}

function sessionHeaders(token: string): HeadersInit {
  const csrf = randomHex(16);
  return [
    ["Set-Cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`],
    ["Set-Cookie", `csrf_token=${csrf}; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`]
  ];
}

async function getSessionUser(req: Request, env: Env): Promise<SessionUser | null> {
  const raw = getCookie(req, SESSION_COOKIE);
  if (!raw) return null;
  const token = await sha256Hex(raw);
  /* v1.45.0 (security audit A3) — "has 2FA" means ENABLED, not "has begun
     setting it up". This read used `totp_secret IS NULL`, but POST
     /auth/2fa/setup writes the secret WITHOUT enabling 2FA — so one call to
     setup, abandoned immediately, cleared the "you must enrol" flag for good
     while login (which correctly checks totp_enabled) still issued no
     challenge. The two halves now agree on the same column. */
  const row = await env.DB.prepare(
    `SELECT u.id, u.email, u.name, u.role, u.photo_key,
            CASE WHEN COALESCE(u.totp_enabled, 0) = 1 THEN 0 ELSE 1 END AS missing_2fa
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ?1 AND s.expires_at > datetime('now') AND u.is_active = 1`,
  )
    .bind(token)
    .first<SessionUser & { missing_2fa: 1 | 0 }>();
  if (!row) return null;

  const requires_2fa = row.missing_2fa === 1 && MANDATORY_2FA_ROLES.includes(row.role);
  return { id: row.id, email: row.email, name: row.name, role: row.role, photo_key: row.photo_key, requires_2fa };
}

/**
 * v1.45.0 (security audit A2) — the routes a staff member who still owes the
 * company a second factor may reach.
 *
 * Deliberately minimal: enough to find out they must enrol, to enrol, to
 * prove the code, and to leave. Everything else — every document, every
 * payslip, every customer — waits until 2FA is ON. `/health` and the public
 * routes are exempt because they carry no session at all.
 *
 * Prefix matching, so /auth/2fa/setup, /verify, /enable and any future
 * sibling are covered by one entry rather than a list that rots.
 */
const TWOFA_EXEMPT_PREFIXES = [
  "/api/v1/auth/2fa",       // set up, verify, enable, disable
  "/api/v1/auth/me",        // the client reads requires_2fa from here
  "/api/v1/auth/logout",
  "/api/v1/auth/login",
  "/api/v1/auth/google",    // the sign-in flow itself
  "/api/v1/health",
  "/api/v1/setup",
];

/**
 * Refuse the request when the caller is a mandatory-2FA staff member who has
 * not enabled it. Returns null when the request may proceed.
 *
 * Note what this does NOT do: it never blocks a customer, never blocks an
 * anonymous request (there is no session to judge), and never blocks the
 * enrolment path itself — so nobody can be locked out of fixing it. The
 * response is a 403 the portal already understands (`twofa_required`), which
 * its /auth/me gate turns into the enrolment screen.
 */
async function enforce2fa(request: Request, env: Env, path: string): Promise<Response | null> {
  if (!getCookie(request, SESSION_COOKIE)) return null;              // nothing to judge
  if (TWOFA_EXEMPT_PREFIXES.some((p) => path.startsWith(p))) return null;
  const user = await getSessionUser(request, env);
  if (!user?.requires_2fa) return null;
  return errorResponse(
    "twofa_required",
    "Two-factor authentication is required for your role. Open Profile → Security and finish setting it up.",
    403,
  );
}

const ROLE_RANK: Record<Role, number> = {
  customer: 0,
  live_host: 0,
  editor: 1,
  marketing: 1,
  hr_admin: 1,
  sales_marketing: 1,
  cco: 1,
  coo: 1,
  ceo: 3,
  admin: 3,
  super_admin: 4,
};

/**
 * The content team works in /admin. Staff roles (cco, coo, hr_admin, …) have
 * their own modules in /portal with their own permission sets — rank alone
 * must not leak them into content management. This is the API-side twin of
 * the /admin page gate.
 */
function isContentTeam(user: SessionUser | null): user is SessionUser {
  return !!user && can(user.role, "content_manage");
}

function atLeast(user: SessionUser | null, role: Role): user is SessionUser {
  return !!user && ROLE_RANK[user.role] >= ROLE_RANK[role];
}

/**
 * v1.45.0 (security audit A1) — roles that only a super admin may create,
 * rename into, or reset the password of.
 *
 * Rank is not the whole story. `admin` and `ceo` share rank 3, but they hold
 * DIFFERENT authority: ceo alone can decide claims and commissions and manage
 * accounting. So an admin who could create a ceo — or reset the sitting CEO's
 * password — could simply issue themselves the approvals the permission matrix
 * refuses them, and sign off their own money. coo and cco carry executive
 * views for the same reason. Every one of them is now behind the super-admin
 * door, which is where "grant authority you do not have" belongs.
 *
 * tests/authz-guard.mjs fails the build if a user-management route stops
 * consulting this list.
 */
const PROTECTED_ROLES: string[] = ["super_admin", "admin", "ceo", "coo", "cco"];

async function audit(
  env: Env,
  userId: number | null,
  action: string,
  entity?: string,
  entityId?: string,
  detail?: unknown,
): Promise<void> {
  // The audit trail records actions; it must never take one down (v1.4.69).
  // A failed write (e.g. an FK constraint after a table rebuild) is logged
  // for the operator and swallowed.
  try {
    await env.DB.prepare(
      `INSERT INTO audit_log (user_id, action, entity, entity_id, detail)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(userId, action, entity ?? null, entityId ?? null, detail ? JSON.stringify(detail) : null)
      .run();
  } catch (e) {
    console.error("audit write failed:", action, e);
    await logError(env, "audit", `${action}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** v1.4.72: system error log. Records failures the team would otherwise only
    hear about from staff ("Something went wrong"). NEVER fatal, and the table
    has no foreign keys, so it stays writable even when the database itself is
    the problem. Keeps the newest 500 rows. */
async function logError(env: Env, source: string, message: string, path?: string): Promise<void> {
  try {
    const src = source.slice(0, 40);
    const msg = message.slice(0, 500);
    /* v1.5.0 DEDUPE — the fix for the "22 new system errors since the last
       check" notification flood. The same recurring condition (an order with
       no resolvable city, re-scanned by every 30-minute sync pass; a portal
       tab polling a broken route once a minute) used to write one row per
       occurrence, evicting real errors from the 500-row window and bell-
       spamming management every half hour. An identical source+message seen
       within the last 6 hours is now skipped. */
    const pth = path?.slice(0, 200) ?? null;
    const dup = await env.DB.prepare(
      `SELECT id FROM error_log WHERE source = ?1 AND message = ?2
         AND (path IS ?3 OR path = ?3)
         AND created_at > datetime('now', '-6 hours') LIMIT 1`,
    ).bind(src, msg, pth).first<{ id: number }>();
    if (dup) return;
    await env.DB.prepare(
      `INSERT INTO error_log (source, message, path) VALUES (?1, ?2, ?3)`,
    ).bind(src, msg, pth).run();
    // Trim opportunistically (~5% of writes) instead of scanning the whole
    // table on every insert.
    if (Math.random() < 0.05) {
      await env.DB.prepare(
        `DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 500)`,
      ).run();
    }
  } catch (e) {
    // Before migration 0024 the table doesn't exist — console is the fallback.
    console.error("error_log write failed:", source, message, e);
  }
}

/** v1.4.72: nightly database backup to R2. Dumps every application table as
    JSON to backups/db-YYYY-MM-DD.json (MYT date) and keeps the newest 30 —
    a bad migration or accidental delete is recoverable from any of them.
    Row cap per table guards against a runaway payload; audit_log is the only
    table anywhere near it. */
async function runBackup(env: Env, actorId: number | null): Promise<
  | { ok: true; key: string; tables: number; rows: number; bytes: number }
  | { ok: false; message: string }
> {
  try {
    const { results: tables } = await env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table'
         AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\'
         AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
         AND name != 'd1_migrations'
       ORDER BY name`,
    ).all<{ name: string }>();
    const dump: Record<string, unknown[]> = {};
    let rowCount = 0;
    for (const t of tables) {
      if (!/^[A-Za-z0-9_]+$/.test(t.name)) continue; // defence in depth
      const { results } = await env.DB.prepare(`SELECT * FROM "${t.name}" LIMIT 50000`).all();
      dump[t.name] = results;
      rowCount += results.length;
    }
    const mytDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    // v1.4.76: gzip the dump (R2 free tier) — JSON compresses ~85–90%.
    const key = `backups/db-${mytDate}.json.gz`;
    const raw = JSON.stringify({ generated_at: new Date().toISOString(), database: "azoneofficial", tables: dump });
    const gzipped = new Response(
      new Blob([raw]).stream().pipeThrough(new CompressionStream("gzip")),
    );
    const body = await gzipped.arrayBuffer();
    await env.MEDIA.put(key, body, { httpMetadata: { contentType: "application/gzip" } });
    // Retention: keep the newest 30 backup objects.
    const listed = await env.MEDIA.list({ prefix: "backups/" });
    const sorted = listed.objects.sort((a, b) => b.key.localeCompare(a.key));
    for (const stale of sorted.slice(30)) await env.MEDIA.delete(stale.key);
    await audit(env, actorId, "system.backup", "r2", key, { tables: tables.length, rows: rowCount, bytes: body.byteLength, raw_bytes: raw.length, source: actorId ? "manual" : "cron" });
    return { ok: true, key, tables: tables.length, rows: rowCount, bytes: body.byteLength };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await logError(env, "backup", msg);
    return { ok: false, message: msg };
  }
}

/* ---------------- rate limiting (fixed window, D1-backed) ----------------- */

async function checkRateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  // returns true if the request is allowed. v1.5.0: single atomic upsert —
  // the old read-then-write pair could be raced past under concurrency.
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN datetime(window_start, '+' || ?2 || ' seconds') > datetime('now')
                    THEN count + 1 ELSE 1 END,
       window_start = CASE WHEN datetime(window_start, '+' || ?2 || ' seconds') > datetime('now')
                    THEN window_start ELSE datetime('now') END
     RETURNING count`,
  )
    .bind(key, windowSeconds)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= limit;
}

/** v1.5.0: read-only limit check — has this key already exceeded the limit?
    Used with bumpRateLimit so only FAILED attempts consume login budget:
    successful sign-ins no longer lock the office NAT out (the old behaviour
    behind "the CCO can't sign back in after logout"). */
async function isRateLimited(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT count FROM rate_limits
     WHERE key = ?1 AND datetime(window_start, '+' || ?2 || ' seconds') > datetime('now')`,
  ).bind(key, windowSeconds).first<{ count: number }>();
  return (row?.count ?? 0) >= limit;
}

/** Record one failed attempt against a key (atomic, window-aware). */
async function bumpRateLimit(env: Env, key: string, windowSeconds: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO rate_limits (key, count, window_start) VALUES (?1, 1, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN datetime(window_start, '+' || ?2 || ' seconds') > datetime('now')
                    THEN count + 1 ELSE 1 END,
       window_start = CASE WHEN datetime(window_start, '+' || ?2 || ' seconds') > datetime('now')
                    THEN window_start ELSE datetime('now') END`,
  ).bind(key, windowSeconds).run();
}

/** Clear a rate-limit key (called after a successful sign-in). */
async function resetRateLimit(env: Env, key: string): Promise<void> {
  try {
    await env.DB.prepare(`DELETE FROM rate_limits WHERE key = ?1`).bind(key).run();
  } catch { /* never fatal */ }
}

function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/* ---------------- generic CRUD config (whitelisted columns per table) ----- */

interface CrudConfig {
  table: string;
  columns: readonly string[];   // writable columns
  required: readonly string[];
  orderBy: string;
}

const CRUD: Record<string, CrudConfig> = {
  products: {
    table: "products",
    columns: ["slug", "name", "category", "description", "price_cents", "inventory", "is_featured", "is_visible", "seo_title", "seo_description"],
    required: ["slug", "name"],
    orderBy: "created_at DESC",
  },
  posts: {
    table: "posts",
    columns: ["slug", "title", "excerpt", "body", "status", "publish_at", "category", "tags", "featured_media_id", "seo_title", "seo_description", "author_id"],
    required: ["slug", "title", "body"],
    orderBy: "created_at DESC",
  },
  portfolio: {
    table: "portfolio_items",
    columns: ["client", "summary", "result", "is_published"],
    required: ["client"],
    orderBy: "created_at DESC",
  },
  testimonials: {
    table: "testimonials",
    columns: ["author", "company", "position", "review", "rating", "photo_media_id", "is_published"],
    required: ["author", "review"],
    orderBy: "id DESC",
  },
};

/* ---------------- validation (minimal, replace with zod when bundling) ---- */

function isNonEmptyString(v: unknown, max = 500): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

/* ---------------- router ---------------- */

/** One sync pass: pull the last 30 days of TikTok orders and reconcile them
    into postage + inventory. Shared by the manual Sync button and the cron
    schedule (v1.4.66) — actorId is null for scheduled runs. */
async function runTikTokSync(env: Env, actorId: number | null): Promise<
  | { ok: true; imported: number; skipped: number; retried: number; total_from_tiktok: number; problems: string[] }
  | { ok: false; code: string; message: string; status: number }
> {
  if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
    return { ok: false, code: "not_configured", message: "Set TIKTOK_APP_KEY and TIKTOK_APP_SECRET first", status: 503 };
  }
  const tokNow = await tiktokToken(env);
  if (!tokNow) {
    return { ok: false, code: "not_authorized", message: "Authorize the app first: publish it in Partner Center and complete shop authorization via the redirect URL", status: 409 };
  }
  if (!tokNow.shop_cipher) {
    const cipherRes = await refreshTikTokShopCipher(env);
    if (!cipherRes.ok) {
      return { ok: false, code: "no_shop_cipher", message: `Could not resolve the authorized shop — ${cipherRes.detail}`, status: 502 };
    }
  }
  const listBody = JSON.stringify({ create_time_ge: Math.floor(Date.now() / 1000) - 30 * 86400 });
  type TtSearchOrder = {
    id?: string; status?: string; tracking_number?: string;
    packages?: { tracking_number?: string }[];
    line_items?: { seller_sku?: string; sku_id?: string; product_name?: string; sku_name?: string; sale_price?: string | number; tracking_number?: string }[];
    recipient_address?: {
      city?: string; state?: string; district?: string; town?: string;
      district_info?: { address_level_name?: string; address_name?: string }[];
    };
    payment?: { total_amount?: string | number; currency?: string };
  };
  type TtSearchResp = { code?: number; message?: string; data?: { orders?: TtSearchOrder[]; next_page_token?: string } } | null;
  /* v1.23.8 (CEO: "TikTok order show preparing while it is already
     completed"): the search used to fetch ONE page of 50 — once the shop
     had more than 50 orders inside the 30-day window, older orders never
     got their status refreshed and sat on "Preparing" forever. The sync now
     follows next_page_token (up to 6 pages / 300 orders per pass). */
  const orders: TtSearchOrder[] = [];
  let pageToken = "";
  for (let pg = 0; pg < 6; pg++) {
    const data = (await tiktokSignedFetch(
      env, "/order/202309/orders/search",
      { page_size: "50", ...(pageToken ? { page_token: pageToken } : {}) },
      listBody, "POST",
    )) as TtSearchResp;
    if (!data || (typeof data.code === "number" && data.code !== 0)) {
      if (pg > 0) break; // later pages failing must not discard the pass
      // v1.7.2: an EXPIRED / unauthorized token is a known "please reconnect"
      // state, not a system fault — return not_authorized so the 30-minute cron
      // stays quiet (no error-log entry, no bell/push spam) and the UI shows a
      // clear "reconnect TikTok" message instead of a red API error every pass.
      const msg = String(data?.message ?? "").toLowerCase();
      const authExpired =
        data?.code === 105000 || data?.code === 105002 ||
        /expired|access[_\s-]?token|x-tts-access-token|unauthor|credential|invalid.*token|token.*invalid/.test(msg);
      if (authExpired) {
        return { ok: false, code: "not_authorized", message: "TikTok sign-in has expired - re-authorize from the TikTok Partner Center and make sure TIKTOK_APP_SECRET matches.", status: 401 };
      }
      return { ok: false, code: "tiktok_error", message: `TikTok API error: ${data?.message ?? "no response"} — check that the order scopes are active`, status: 502 };
    }
    orders.push(...(data.data?.orders ?? []));
    pageToken = data.data?.next_page_token ?? "";
    if (!pageToken || (data.data?.orders ?? []).length === 0) break;
  }
  let imported = 0, skipped = 0, retried = 0; // retried: v1.4.168 backfilled deductions
  const problems: string[] = [];
  for (const o of orders) {
    const orderId = String(o.id ?? "").trim();
    if (!orderId) continue;
    const orderRef = `TT-${orderId.slice(0, 64)}`;
    const exists = await env.DB.prepare(
      `SELECT id, tracking_no, status, restocked FROM postage_records WHERE order_ref = ?1`,
    ).bind(orderRef).first<{ id: number; tracking_no: string | null; status: string; restocked: number | null }>();
    const stNow = String(o.status ?? "").toLowerCase();
    // v1.5.0: returned/cancelled states used to fall through to "preparing",
    // which also made the downstream `uiNow !== "returned"` guard dead code.
    // v1.23.8: an order whose status field is MISSING from the response no
    // longer regresses to "preparing" — null means "leave status untouched".
    const uiNow =
      !stNow ? null
      : stNow.includes("return") || stNow.includes("cancel") || stNow.includes("refund") ? "returned"
      : stNow.includes("deliver") || stNow.includes("complete") ? "delivered"
      : stNow.includes("ship") || stNow.includes("transit") ? "shipped"
      : "preparing";
    const trackNow =
      o.tracking_number ??
      o.packages?.find((pk) => pk.tracking_number)?.tracking_number ??
      o.line_items?.find((li) => li.tracking_number)?.tracking_number ??
      null;
    // City only — deliberately never the street address (privacy: staff need
    // rough destination, not the buyer's home). Response shapes vary, so try
    // the flat field first, then the district_info levels.
    const ra = o.recipient_address;
    const cityNow = (
      ra?.city ??
      ra?.district_info?.find((d) => /city|bandar/i.test(d.address_level_name ?? ""))?.address_name ??
      // v1.4.190: some region payloads carry only the FLAT district/town keys
      ra?.district ?? ra?.town ??
      ra?.state ??
      ra?.district_info?.find((d) => /state|negeri|province/i.test(d.address_level_name ?? ""))?.address_name ??
      // v1.4.179 (CEO: "why there is a missing location?"): some orders carry
      // neither a flat city nor a state — fall through to the district level,
      // then to ANY named area level TikTok sent. Still an area, never the
      // street address (privacy rule unchanged).
      ra?.district_info?.find((d) => /district|daerah/i.test(d.address_level_name ?? ""))?.address_name ??
      ra?.district_info?.find((d) => (d.address_name ?? "").trim() !== "")?.address_name ??
      null
    )?.slice(0, 80) ?? null;
    // v1.4.190 diagnostic (privacy-safe: STRUCTURE only, never values).
    // v1.5.0: only on FIRST import. This sat above the `exists` early-skip,
    // so every cityless order re-logged on every 30-minute sync pass forever
    // — the main source of the error-notification flood.
    if (!cityNow && !exists) {
      await logError(env, "tiktok_location", `order ${orderId}: ra_keys=[${Object.keys(ra ?? {}).join(",") || "ABSENT"}] district_info=${JSON.stringify(ra?.district_info)}`);
    }
    // v1.4.75: order amount in cents for the revenue dashboard. TikTok sends
    // the total as a decimal string; parse defensively, reject nonsense.
    const paidRaw = Number(o.payment?.total_amount);
    const amountNow = Number.isFinite(paidRaw) && paidRaw >= 0 ? Math.round(paidRaw * 100) : null;
    if (exists) {
      // Already imported: keep its shipping status and tracking current.
      // v1.23.8: COALESCE — a missing status in TikTok's response keeps the
      // record's current status instead of knocking it back to "preparing".
      await env.DB.prepare(
        `UPDATE postage_records SET status = COALESCE(?1, status), tracking_no = COALESCE(tracking_no, ?2),
           buyer_city = COALESCE(buyer_city, ?3),
           order_amount_cents = COALESCE(order_amount_cents, ?4),
           updated_at = datetime('now') WHERE id = ?5 AND status != 'returned'`,
      ).bind(uiNow, trackNow, cityNow, amountNow, exists.id).run();
      /* v1.4.168 (CEO: 11 orders stuck on "No stock movement recorded"):
         deduction used to run ONLY on first import — an order that arrived
         before its inventory item existed (or whose SKU/name matched
         nothing) never moved stock, even after the item was fixed. Every
         sync now RETRIES the deduction for movement-less orders against
         CURRENT inventory — so fixing a SKU/name or adding the item heals
         past orders on the next sync (manual button or 30-min cron), with
         the sold price captured and the rebate auto-synced as usual.
         Returned/restocked orders are excluded; same all-or-nothing
         shortage rule as first import. */
      if (exists.status !== "returned" && !exists.restocked && uiNow !== "returned") {
        const moved = await env.DB.prepare(
          `SELECT COUNT(*) AS n FROM postage_items WHERE postage_id = ?1`,
        ).bind(exists.id).first<{ n: number }>();
        if ((moved?.n ?? 0) === 0) {
          const rLines = groupLineItems(o.line_items ?? []);
          const rResolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
          const rUnknown: string[] = [];
          const rShortages: string[] = [];
          const rNameMatched: string[] = [];
          for (const l of rLines) {
            const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
            if (!item) { rUnknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
            if (item.via === "name") rNameMatched.push(item.name);
            if (item.stock < l.qty) rShortages.push(`${item.name}: ${item.stock} < ${l.qty}`);
            rResolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
          }
          if (rShortages.length === 0 && rResolved.length > 0) {
            for (const l of rResolved) {
              const upd = await env.DB.prepare(
                `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
              ).bind(l.qty, l.id).run();
              if (upd.meta.changes) {
                await recordTiktokLine(env, exists.id, l.id, l.qty, l.unit_sale_cents);
                await env.DB.prepare(
                  `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
                ).bind(l.id).run();
                await audit(env, actorId, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: "tiktok_retry" });
              }
            }
            const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
            const stamp = `${String(mytNow.getUTCDate()).padStart(2, "0")}-${String(mytNow.getUTCMonth() + 1).padStart(2, "0")} ${String(mytNow.getUTCHours()).padStart(2, "0")}:${String(mytNow.getUTCMinutes()).padStart(2, "0")} MYT`;
            const rNotes = ["TikTok order (synced)", `✔ stock deducted on retry ${stamp}`];
            if (rNameMatched.length) rNotes.push(`matched by item name: ${rNameMatched.join(", ")}`);
            if (rUnknown.length) rNotes.push(`not in inventory (SKU or name): ${rUnknown.join(", ")}`);
            await env.DB.prepare(
              `UPDATE postage_records SET note = ?1, updated_at = datetime('now') WHERE id = ?2`,
            ).bind(rNotes.join(" · "), exists.id).run();
            retried += 1;
          } else if (rLines.length > 0) {
            // Still can't deduct — refresh the reason so the CEO sees the
            // CURRENT blocker (fixing one SKU updates the list next sync).
            const rNotes = ["TikTok order (synced)"];
            if (rUnknown.length) rNotes.push(`not in inventory (SKU or name): ${rUnknown.join(", ")}`);
            if (rShortages.length) rNotes.push(`NOT deducted — ${rShortages.join("; ")}`);
            await env.DB.prepare(
              `UPDATE postage_records SET note = ?1, updated_at = datetime('now') WHERE id = ?2`,
            ).bind(rNotes.join(" · "), exists.id).run();
          }
        }
      }
      skipped += 1;
      continue;
    }
    const lines = groupLineItems(o.line_items ?? []);
    const resolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
    const unknown: string[] = [];
    const shortages: string[] = [];
    const nameMatched: string[] = [];
    for (const l of lines) {
      // v1.4.162: SKU first, item-name fallback (see matchInventoryItem)
      const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
      if (!item) { unknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
      if (item.via === "name") nameMatched.push(item.name);
      if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} < ${l.qty}`);
      resolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
    }
    // v1.5.0: never deduct stock for an order that is already returned/cancelled.
    const canDeduct = shortages.length === 0 && resolved.length > 0 && uiNow !== "returned";
    const notes = ["TikTok order (synced)"];
    if (nameMatched.length) notes.push(`matched by item name: ${nameMatched.join(", ")}`);
    if (unknown.length) notes.push(`not in inventory (SKU or name): ${unknown.join(", ")}`);
    if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);
    const rec = await env.DB.prepare(
      `INSERT INTO postage_records (order_ref, courier, tracking_no, buyer_city, order_amount_cents, status, note, updated_by)
       VALUES (?1, 'TikTok', ?2, ?3, ?4, ?5, ?6, NULL) RETURNING id`,
    ).bind(orderRef, trackNow, cityNow, amountNow, uiNow ?? "preparing", notes.join(" · ")).first<{ id: number }>();
    if (canDeduct) {
      for (const l of resolved) {
        const upd = await env.DB.prepare(
          `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
        ).bind(l.qty, l.id).run();
        if (upd.meta.changes) {
          // v1.4.166: movement carries the actual sold price; rebate auto-syncs
          await recordTiktokLine(env, rec!.id, l.id, l.qty, l.unit_sale_cents);
          await env.DB.prepare(
            `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
          ).bind(l.id).run();
          await audit(env, actorId, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: actorId ? "tiktok_sync" : "tiktok_cron" });
        }
      }
    }
    if (unknown.length) problems.push(`${orderRef}: unmatched ${unknown.join(", ")}`);
    imported += 1;
  }
  if (imported > 0 || retried > 0 || actorId) {
    await audit(env, actorId, "tiktok.sync", undefined, undefined, { imported, skipped, retried, source: actorId ? "manual" : "cron" });
  }
  return { ok: true, imported, skipped, retried, total_from_tiktok: orders.length, problems };
}

export default {
  /** Crons: every 30 min = TikTok sync (v1.4.66); daily 19:20 UTC
      (03:20 MYT) = database backup to R2 (v1.4.72). Real sync failures land
      in the error log — "not configured / not authorized" are expected until
      the TikTok setup completes and stay silent. */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    // v1.37.0: the ELFIA orders poller gets its OWN 5-minute trigger — a web
    // order should not wait half an hour, and a bridge failure must never be
    // able to swallow the 30-min chain (clock-out reminders, TikTok sync).
    // It returns immediately, so 5-minute firings never fall through into
    // the 30-min work below.
    if (event.cron === "*/5 * * * *") {
      await pollElfiaOrders(env);
      /* The cron does not pass through the staff dispatch, so the topics it
         writes are bumped by hand. A web order that lands while the ops map
         is open should move the map, not wait for somebody to reload. */
      await bumpVersion(env, "orders");
      await bumpVersion(env, "web-orders");
      // v1.43.0: traffic aggregates ride the same tick, after orders — money
      // first, map second; pollElfiaTraffic catches everything it throws, so
      // a traffic failure can never mark the orders pull as failed.
      await pollElfiaTraffic(env);
      await bumpVersion(env, "web-traffic");
      return;
    }
    if (event.cron === "20 19 * * *") {
      await runBackup(env, null);
      return;
    }
    if (event.cron === "0 1 * * *") {
      // v1.4.101: 09:00 MYT — birthday announcements so the team can prepare
      // the celebration. Notifies every active staff member.
      try {
        const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(5, 10); // MM-DD MYT
        const { results: bdays } = await env.DB.prepare(
          `SELECT id, name FROM users WHERE is_active = 1 AND birthday IS NOT NULL
           AND substr(birthday, 6, 5) = ?1 AND role NOT IN ('customer')`,
        ).bind(today).all<{ id: number; name: string }>();
        if (bdays.length > 0) {
          const { results: staff } = await env.DB.prepare(
            `SELECT id FROM users WHERE is_active = 1 AND role NOT IN ('customer')`,
          ).all<{ id: number }>();
          for (const b of bdays) {
            for (const st of staff) {
              await env.DB.prepare(
                `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'birthday', ?2, ?3)`,
              ).bind(st.id, `🎂 Today is ${b.name}'s birthday — wish them well!`, `birthday:${b.id}`).run();
            }
          }
        }
      } catch (e) {
        await logError(env, "birthday_cron", e instanceof Error ? e.message : String(e));
      }

      /* v1.68.1 — TODAY'S SCHEDULED WORK, at 09:00 MYT.
         The CEO, 28-08-2026: "there is no alert notification appear after
         task assigned." The immediate bell was one half of that, and this is
         the half that matters more.

         A roster earns its keep by telling somebody what today holds. Booking
         six days in September and hearing nothing on any of those mornings is
         a diary that only the person who wrote it ever reads.

         Why HERE and not the 30-minute pass: the 30-minute cron would first
         notice "today" at about ten past midnight, and a list of the day's
         work delivered at 00:10 is worse than no list at all. This block runs
         at 09:00 MYT, which is when someone can act on it.

         One message per person, not one per block: three chips on a Wednesday
         is one working day, and three bells for it is how a bell gets muted.
         Deduped through the same task_events row the other task sweeps use,
         so a redeploy or a second pass can never double-bell anyone. */
      try {
        const dayS = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
        const { results: due } = await env.DB.prepare(
          `SELECT b.id, b.task_id, b.user_id, b.start_time, b.end_time, t.title
           FROM task_blocks b JOIN tasks t ON t.id = b.task_id
           WHERE b.block_date = ?1 AND b.done_at IS NULL AND t.status != 'completed'
             AND NOT EXISTS (SELECT 1 FROM task_events e
                             WHERE e.task_id = b.task_id AND e.kind = 'block_today' AND e.on_date = ?1)
           ORDER BY b.user_id, b.start_time LIMIT 120`,
        ).bind(dayS).all<{ id: number; task_id: number; user_id: number;
                           start_time: string; end_time: string | null; title: string }>();
        const byUser = new Map<number, typeof due>();
        for (const b of due) {
          const list = byUser.get(b.user_id) ?? [];
          list.push(b);
          byUser.set(b.user_id, list);
        }
        for (const [uid, list] of byUser) {
          const lines = list
            .map((b) => `${b.start_time}${b.end_time ? `-${b.end_time}` : ""} ${b.title}`)
            .join(" · ");
          await notify(env, uid, "task",
            `🗓️ Today: ${lines}. Tick each one off on the roster as it is done.`,
            `blocks:${uid}:${dayS}`);
        }
        /* The dedupe row is written per TASK, after the person has been told,
           so a failure above means they are told on the next pass rather than
           silently skipped. */
        for (const tid of new Set(due.map((b) => b.task_id))) {
          await env.DB.prepare(
            `INSERT INTO task_events (task_id, kind, on_date) VALUES (?1, 'block_today', ?2)`,
          ).bind(tid, dayS).run();
        }
      } catch { /* pre-0095/0096 - no blocks to remind anyone about */ }
      return;
    }
    /* v1.9.1 CLOCK-OUT REMINDERS (CEO: "how to remind them to clock out").
       Every 30-min pass after 18:30 MYT: anyone with today's clock-in but no
       clock-out gets a bell + web push. Runs BEFORE the TikTok sync so a
       sync crash can never swallow a reminder pass. Two stages, each once
       per day (the notification ref row is the dedupe):
         stage 1 ≥18:30 — gentle nudge; SKIPS staff currently inside an OT
                          window (ot_in without ot_out in ot_records —
                          they're working late on purpose, don't nag them
                          mid-overtime);
         stage 2 ≥22:00 — firmer reminder, OT or not: at 10 pm an open shift
                          is almost always a forgotten punch-out.
       After midnight MYT "today" rolls over, so reminders stop by themselves. */
    try {
      const mytR = new Date(Date.now() + 8 * 3600 * 1000);
      const minsR = mytR.getUTCHours() * 60 + mytR.getUTCMinutes();
      const todayR = mytR.toISOString().slice(0, 10);
      if (minsR >= 18 * 60 + 30) {
        const stage = minsR >= 22 * 60 ? 2 : 1;
        const refR = `clockout${stage}:${todayR}`;
        /* Review fix: OT punches live in ot_records, NOT attendance_records
           (its CHECK constraint doesn't even allow ot_* types) — counting
           them in the wrong table made the skip a no-op. */
        const otSkip = stage === 1
          ? `AND (SELECT COUNT(*) FROM ot_records oi WHERE oi.user_id = u.id AND oi.type = 'ot_in'  AND date(oi.created_at, '+8 hours') = ?1)
             <= (SELECT COUNT(*) FROM ot_records oo WHERE oo.user_id = u.id AND oo.type = 'ot_out' AND date(oo.created_at, '+8 hours') = ?1)`
          : "";
        const { results: openShifts } = await env.DB.prepare(
          `SELECT u.id FROM users u
           WHERE u.is_active = 1 AND u.role NOT IN ('customer', 'super_admin', 'admin')
             AND EXISTS (SELECT 1 FROM attendance_records ai WHERE ai.user_id = u.id AND ai.type = 'clock_in'  AND date(ai.created_at, '+8 hours') = ?1)
             AND NOT EXISTS (SELECT 1 FROM attendance_records ao WHERE ao.user_id = u.id AND ao.type = 'clock_out' AND date(ao.created_at, '+8 hours') = ?1)
             AND NOT EXISTS (SELECT 1 FROM notifications nr WHERE nr.user_id = u.id AND nr.ref = ?2)
             ${otSkip}
           LIMIT 200`,
        ).bind(todayR, refR).all<{ id: number }>();
        for (const s of openShifts) {
          await notify(
            env, s.id, "attendance",
            stage === 1
              ? "⏰ Still clocked in — remember to tap Clock out before you leave the office."
              : "🌙 It's past 10 pm and you're still clocked in. At the office? Tap Clock out now. Already home? Ask HR/admin for a manual clock-out so today's attendance stays accurate.",
            refR,
          );
        }
      }
    } catch (e) {
      if (!String(e).includes("no such")) console.error("clockout_cron", e);
    }
    const res = await runTikTokSync(env, null);
    if (!res.ok && res.code !== "not_configured" && res.code !== "not_authorized") {
      await logError(env, "tiktok_cron", res.message);
    }
    /* v1.89.0 — one tick of Threads work; since v1.99.0 that is two things:
       tokens due for refresh, and the week's-edge purge (found posts older
       than 7 days, search records older than 8, removed topics). Budgeted,
       so it can never eat the invocation; caught, so it can never take the
       low-stock sweep below down with it. */
    try {
      const t = await threadsTick(env);
      if (t.errors.length) await logError(env, "threads_cron", t.errors.slice(0, 3).join(" | "));
    } catch (e) {
      await logError(env, "threads_cron", e instanceof Error ? e.message : String(e));
    }
    /* v1.4.191 LOW-STOCK SWEEP (CEO gap list): after every sync, alert on
       items at ≤5 units — protects lives from selling out mid-stream. The
       low_alerted column stops repeats; recovery above 5 resets it. Covers
       TikTok deductions; manual movements alert instantly in staff.ts. */
    try {
      const { results: lowItems } = await env.DB.prepare(
        `SELECT id, sku, name, stock, low_alerted FROM inventory_items
         WHERE stock <= 5 AND (low_alerted IS NULL OR stock < low_alerted)`,
      ).all<{ id: number; sku: string; name: string; stock: number; low_alerted: number | null }>();
      if (lowItems.length > 0) {
        const { results: alertStaff } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
        ).all<{ id: number }>();
        for (const it of lowItems) {
          const msg = it.stock <= 0 ? `🛑 OUT OF STOCK: ${it.sku} ${it.name}` : `⚠ Low stock: ${it.sku} ${it.name} — ${it.stock} left`;
          for (const st of alertStaff) {
            await env.DB.prepare(
              `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'stock', ?2, ?3)`,
            ).bind(st.id, msg, `stock:${it.id}`).run();
          }
          await env.DB.prepare(`UPDATE inventory_items SET low_alerted = ?1 WHERE id = ?2`).bind(it.stock, it.id).run();
        }
      }
      await env.DB.prepare(`UPDATE inventory_items SET low_alerted = NULL WHERE stock > 5 AND low_alerted IS NOT NULL`).run();
    } catch (e) {
      if (!String(e).includes("no such column")) await logError(env, "lowstock_cron", e instanceof Error ? e.message : String(e));
    }
    /* v1.38.0 (IMPLEMENTATION-PLAN.md S-2): the prospects follow-up reminder
       is GONE — the Pipeline tab it pointed people at was deleted in v1.21.0
       ("Sales pipeline is really needed?? I dont think so"), so for months
       this block bell-notified staff toward a screen that does not exist. A
       notification that leads nowhere trains people to ignore notifications.
       The prospects TABLE keeps its data (append-only rule); the reminder
       returns with Track C-2, pointing at a tab that exists — and only after
       the CEO signs off on rebuilding the pipeline at all. */
    /* v1.5.0 housekeeping: expired 2FA challenges and stale rate-limit rows
       used to accumulate forever. v1.38.0: + bridge_events retention (applied
       events older than 400 days; unknown_sku rows are kept — each one is an
       unresolved business problem). */
    try {
      await env.DB.prepare(`DELETE FROM twofa_challenges WHERE expires_at <= datetime('now')`).run();
      await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start <= datetime('now', '-1 day')`).run();
      await purgeIdempotencyKeys(env); // v1.105.0 - a week is longer than any phone keeps its queue
    } catch { /* pre-migration — silent */ }
    await bridgeHousekeeping(env);
    /* v1.42.0 (CEO: "everyone is alert on their task and the task being
       track properly") — three task sweeps per 30-min pass, each firing at
       most once per task per day (deduped by a task_events row, so a redeploy
       or a second pass can never double-bell anyone):
       1. OVERDUE — deadline passed, not closed → both the assignee and the
          assigner hear it, every day until it moves.
       2. DUE today/tomorrow → the assignee is reminded before it is late,
          not after.
       3. UNACKNOWLEDGED — assigned by someone else, older than a day, never
          acknowledged → nudge the assignee, tell the assigner. A task nobody
          confirmed seeing is not "assigned" in any real sense.
       Armored: pre-0083 the whole block is silent. */
    try {
      const todayT = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const tomorrowT = new Date(Date.now() + 32 * 3600 * 1000).toISOString().slice(0, 10);
      const { results: overdueT } = await env.DB.prepare(
        `SELECT t.id, t.title, t.deadline, t.assigned_to, t.created_by FROM tasks t
         WHERE t.status != 'completed' AND t.deadline IS NOT NULL AND t.deadline < ?1
           AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'overdue_alert' AND e.on_date = ?1)
         LIMIT 25`,
      ).bind(todayT).all<{ id: number; title: string; deadline: string; assigned_to: number; created_by: number | null }>();
      for (const t of overdueT) {
        await notify(env, t.assigned_to, "task", `⏰ OVERDUE: ${t.title} — was due ${t.deadline}. Update it on the Tasks tab now.`, `task:${t.id}:od:${todayT}`);
        if (t.created_by && t.created_by !== t.assigned_to) {
          await notify(env, t.created_by, "task", `⏰ Task you assigned is OVERDUE: ${t.title} (was due ${t.deadline})`, `task:${t.id}:odc:${todayT}`);
        }
        await env.DB.prepare(`INSERT INTO task_events (task_id, kind, on_date) VALUES (?1, 'overdue_alert', ?2)`).bind(t.id, todayT).run();
      }
      const { results: dueT } = await env.DB.prepare(
        `SELECT t.id, t.title, t.deadline, t.assigned_to FROM tasks t
         WHERE t.status != 'completed' AND t.deadline IN (?1, ?2)
           AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'due_reminder' AND e.on_date = ?1)
         LIMIT 25`,
      ).bind(todayT, tomorrowT).all<{ id: number; title: string; deadline: string; assigned_to: number }>();
      for (const t of dueT) {
        const when = t.deadline === todayT ? "TODAY" : "tomorrow";
        await notify(env, t.assigned_to, "task", `⏳ Due ${when}: ${t.title}`, `task:${t.id}:due:${todayT}`);
        await env.DB.prepare(`INSERT INTO task_events (task_id, kind, on_date) VALUES (?1, 'due_reminder', ?2)`).bind(t.id, todayT).run();
      }
      const { results: unackT } = await env.DB.prepare(
        `SELECT t.id, t.title, t.assigned_to, t.created_by FROM tasks t
         WHERE t.status = 'open' AND t.created_by IS NOT NULL AND t.created_by != t.assigned_to
           AND t.created_at < datetime('now', '-1 day')
           AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'ack')
           AND NOT EXISTS (SELECT 1 FROM task_events e WHERE e.task_id = t.id AND e.kind = 'ack_nudge' AND e.on_date = ?1)
         LIMIT 25`,
      ).bind(todayT).all<{ id: number; title: string; assigned_to: number; created_by: number }>();
      for (const t of unackT) {
        await notify(env, t.assigned_to, "task", `👋 Please acknowledge your task: ${t.title} — press Acknowledge on the Tasks tab so your assigner knows you have seen it.`, `task:${t.id}:nudge:${todayT}`);
        await notify(env, t.created_by, "task", `⚠ Not yet acknowledged: ${t.title}`, `task:${t.id}:nudgec:${todayT}`);
        await env.DB.prepare(`INSERT INTO task_events (task_id, kind, on_date) VALUES (?1, 'ack_nudge', ?2)`).bind(t.id, todayT).run();
      }
    } catch { /* pre-0083 — silent until migrated */ }
    /* v1.4.265 (CEO: "Errors are logged but nobody is told"): every 30-min
       cron pass checks whether error_log grew since the last pass and bell-
       notifies super_admin + ceo. A watermark in system_meta stops repeats —
       the same errors never alert twice, only NEW ones do. This is what would
       have surfaced the webhook signature failures weeks earlier: 44 retries
       were sitting in the log with nobody looking. */
    /* v1.4.273 idea 5: CLIENT GONE QUIET — a client with sessions on record
       but none in the last 14 days gets one bell to sales+CEO. Churn caught
       at day 14 is recoverable; churn noticed at invoice time is not. A new
       booking clears the flag (see POST /live-sessions); otherwise it
       re-arms itself after another 14 days. */
    try {
      const todayQ = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
      const { results: quiet } = await env.DB.prepare(
        `SELECT c.id, c.company, MAX(s.session_date) AS last_live FROM customers c
         JOIN live_sessions s ON s.client_id = c.id AND s.status != 'cancelled'
         WHERE c.company != 'Walk-in Customer'
         GROUP BY c.id
         HAVING last_live < date('now', '+8 hours', '-14 days')
            AND (c.quiet_alerted_on IS NULL OR c.quiet_alerted_on < date('now', '+8 hours', '-14 days'))
         LIMIT 10`,
      ).all<{ id: number; company: string; last_live: string }>();
      if (quiet.length) {
        const { results: salesUsers } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'ceo')`,
        ).all<{ id: number }>();
        for (const q of quiet) {
          for (const u of salesUsers) {
            await notify(env, u.id, "sales", `😶 ${q.company} has gone quiet — no live since ${q.last_live.split("-").reverse().join("-")}. Time to book them.`, `quiet:${q.id}:${todayQ}`);
          }
          await env.DB.prepare(`UPDATE customers SET quiet_alerted_on = ?1 WHERE id = ?2`).bind(todayQ, q.id).run();
        }
      }
    } catch { /* pre-0067 or pre-0056 — silent until migrated */ }

    try {
      const wm = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'error_alert_watermark'`)
        .first<{ value: string }>();
      const lastId = wm ? Number(wm.value) || 0 : 0;
      const agg = await env.DB.prepare(
        `SELECT COUNT(*) AS n, MAX(id) AS max_id FROM error_log WHERE id > ?1`,
      ).bind(lastId).first<{ n: number; max_id: number | null }>();
      if (agg && agg.n > 0 && agg.max_id) {
        const srcs = await env.DB.prepare(
          `SELECT source, COUNT(*) AS c FROM error_log WHERE id > ?1 GROUP BY source ORDER BY c DESC LIMIT 3`,
        ).bind(lastId).all<{ source: string; c: number }>();
        const what = srcs.results.map((s) => `${s.source} ×${s.c}`).join(", ");
        const { results: admins } = await env.DB.prepare(
          `SELECT id FROM users WHERE is_active = 1 AND role IN ('super_admin', 'ceo')`,
        ).all<{ id: number }>();
        for (const a of admins) {
          await env.DB.prepare(
            `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'system', ?2, ?3)`,
          ).bind(a.id, `⚠ ${agg.n} new system error${agg.n === 1 ? "" : "s"} since the last check (${what}) — see /admin → Audit → System health`, `errors:${agg.max_id}`).run();
        }
        await env.DB.prepare(
          `INSERT INTO system_meta (key, value) VALUES ('error_alert_watermark', ?1)
           ON CONFLICT(key) DO UPDATE SET value = ?1`,
        ).bind(String(agg.max_id)).run();
      } else if (agg && agg.max_id && lastId === 0) {
        // first ever pass: set the watermark without alerting on history
        await env.DB.prepare(
          `INSERT INTO system_meta (key, value) VALUES ('error_alert_watermark', ?1)
           ON CONFLICT(key) DO UPDATE SET value = ?1`,
        ).bind(String(agg.max_id)).run();
      }
    } catch (e) {
      if (!String(e).includes("no such")) console.error("error_alert_cron", e);
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    /* v1.29.3 — the ONE cross-site door: the public enquiry form, so the
       consultancy site's contact page can drop a lead into the portal. Scoped
       to this exact path and to POST/OPTIONS; everything else on the API
       stays single-origin. */
    const publicFormRoute =
      path === "/api/v1/enquiries" && (request.method === "POST" || request.method === "OPTIONS");
    const cors = corsHeaders(env, request, publicFormRoute);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    // Origin check and CSRF mitigation on mutating requests
    if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
      const origin = request.headers.get("Origin");
      // v1.5.0: both apex and www. are legitimate (the Worker route binds
      // both) — the old exact-match check 403'd every sign-in from www.
      const permitted = publicFormRoute
        ? [...allowedOrigins(env), ...publicFormOrigins(env)]
        : allowedOrigins(env);
      if (origin && !permitted.includes(origin)) {
        return errorResponse("forbidden_origin", "Origin not allowed", 403);
      }
      const hasSession = getCookie(request, SESSION_COOKIE);
      if (hasSession) {
        const csrfCookie = getCookie(request, "csrf_token");
        const csrfHeader = request.headers.get("X-CSRF-Token");
        if (!csrfCookie || !csrfHeader || !timingSafeEqual(csrfCookie, csrfHeader)) {
          return errorResponse("csrf_failed", "CSRF token mismatch or missing", 403);
        }
      }
    }

    /* v1.45.0 (security audit A2) — MANDATORY 2FA IS NOW ENFORCED HERE.
       The CEO's directive (permissions.ts: every staff role) was, until this
       release, a rule the CLIENT kept: the API returned `requires_2fa` and
       the portal UI blocked itself, but a stolen password used with curl or a
       modified page got a full session and every endpoint that role could
       reach. The control everyone believed in was off at the layer that
       matters. One gate, before any route runs, for every method — a
       staff member on a mandatory role who has not ENABLED 2FA can reach
       only the doors needed to enrol or leave. */
    const twofaGate = await enforce2fa(request, env, path);

    let res: Response;
    try {
      /* The gate short-circuits routing but still falls through the shared
         tail below, so it carries the same CORS and security headers as any
         other response — a refusal must not look like a broken API. */
      res = twofaGate ?? await route(request, env, path);
    } catch (err0) {
      /* v1.25.2 (error_log 18-08 09:36: "/staff/announcements — D1_ERROR:
         Network connection lost."): that is Cloudflare's database link
         dropping mid-query, not a fault in our code — the same request
         succeeds immediately afterwards. A READ is safe to repeat, so retry
         it once rather than showing staff a red error for a blip. Writes are
         never retried: repeating a POST could double-punch or double-post. */
      /* v1.26.2 (error_log 19-08 11:01: "/staff/notifications — D1_ERROR: D1
         DB storage operation exceeded timeout which caused object to be
         reset."): same family of D1 blip, different wording — the v1.25.2
         pattern matched "storage operation failed" but not "exceeded
         timeout … object to be reset", so the retry never fired and staff
         saw a red error for a self-healing hiccup. */
      const transient = /network connection lost|storage operation failed|storage operation exceeded|object to be reset|storage caused object to be reset|internal error.*d1|connection reset|d1 db is overloaded/i
        .test(err0 instanceof Error ? err0.message : String(err0));
      let retried: Response | null = null;
      if (transient && (request.method === "GET" || request.method === "HEAD")) {
        try {
          await new Promise((r) => setTimeout(r, 120));
          retried = await route(request, env, path);
        } catch { /* second failure falls through to the normal handler */ }
      }
      const err = err0;
      if (!retried) console.error(err);
      const detail = err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300);
      const error_id = "ERR-" + crypto.randomUUID().split('-')[0].toUpperCase();
      // v1.7.2: the message stored in the log must NOT contain the random
      // error_id — including it gave every occurrence of the SAME exception a
      // unique message, which defeated the 6-hour de-dupe and produced the
      // "api ×4 / ×5 new system errors" notification flood. The id still goes
      // to the caller for support correlation; the log de-dupes on the stable
      // (source + message + path) key.
      if (retried) {
        // the blip healed on the second attempt — serve it, log nothing
        res = retried;
      } else {
        await logError(env, "api", detail, path);
        res = json({ error: { code: "internal", message: "Something went wrong. The error has been logged.", error_id } }, 500);
      }
    }
    // attach CORS + baseline security headers to every response (v1.5.0)
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) headers.set(k, v as string);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("X-Frame-Options", "DENY");
    headers.set("Referrer-Policy", "same-origin");
    // API responses are personal or operational data — never cacheable unless
    // a route explicitly says otherwise (media uploads do). A heuristically
    // cached /auth/me was bouncing signed-out users straight back to /portal.
    if (!headers.has("Cache-Control")) headers.set("Cache-Control", "no-store, private");
    return new Response(res.body, { status: res.status, headers });
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env, path: string): Promise<Response> {
  const method = request.method;

  /* ---- public ---- */

  /* v1.5.0: this token-gated probe used to be registered at /api/v1/health,
     shadowing the public monitor endpoint further down (first match wins) —
     the external uptime monitor got a permanent 401. Moved to /health/detail. */
  /* v1.31.0 (CEO: "how to update all the inventory to match with inventory
     in A2Zcreative??"): the ELFIA store's stock-sync bridge. READ-ONLY by
     construction — one SELECT, no parameters reach SQL, nothing is written.
     Requires the shared secret; unset secret = endpoint off (501), wrong
     key = 401.

     v1.35.0 (CEO: "sync the prices and inventory to ELFIA"): the feed now
     carries price_cents — the number that goes straight onto the shop's
     price tag (elfia_price_cents when set, else unit_price_cents; the
     TikTok live rebate NEVER applies online). Scoping moved from the SKU
     LIKE hack to the explicit bridge_enabled flag: renaming a SKU must not
     silently add or drop a product from a client-facing store. 0075
     backfills the flag from the old LIKE so the visible set is unchanged.
     Shaping/filtering lives in bridge-feed.ts, proven by guard #10. */
  if (path === "/api/v1/bridge/elfia-inventory" && method === "GET") {
    if (!env.ELFIA_BRIDGE_KEY) return errorResponse("not_configured", "Bridge is not enabled", 501);
    const given = request.headers.get("X-Bridge-Key") ?? "";
    if (!timingSafeEqual(given, env.ELFIA_BRIDGE_KEY)) {
      return errorResponse("unauthorized", "Bad bridge key", 401);
    }
    let rows: BridgeRow[];
    try {
      /* v1.45.0 (0086): the feed now also carries each item's ELFIA dressing
         — category, description, photo URL + change marker — set in the
         portal's ELFIA tab. The store uses name+price to CREATE a product it
         has never seen (hidden, pending Publish in its /admin), and the rest
         to dress it. */
      const { results } = await env.DB.prepare(
        `SELECT sku, name, stock, status, bridge_enabled, unit_price_cents, elfia_price_cents,
                elfia_category, elfia_description, elfia_image_key, elfia_image_updated_at,
                elfia_discount_cents, elfia_flash_until
         FROM inventory_items WHERE bridge_enabled = 1
         ORDER BY sku LIMIT 1000`,
      ).all();
      rows = results as unknown as BridgeRow[];
    } catch {
      try {
        /* v1.63.0 — 0093 pending. ONE tier for ONE column: everything the
           v1.49 feed carried, minus the flash deadline. Without this step a
           database missing only `elfia_flash_until` would fall all the way
           to the flags-and-prices feed and the shop would lose its photos,
           descriptions, collections AND discounts until someone migrated —
           a punishment out of all proportion to the missing field. */
        const { results } = await env.DB.prepare(
          `SELECT sku, name, stock, status, bridge_enabled, unit_price_cents, elfia_price_cents,
                  elfia_category, elfia_description, elfia_image_key, elfia_image_updated_at,
                  elfia_discount_cents
           FROM inventory_items WHERE bridge_enabled = 1
           ORDER BY sku LIMIT 1000`,
        ).all();
        rows = results as unknown as BridgeRow[];
      } catch {
      try {
        /* 0086 pending — the v1.35.0 feed: flags + prices, no dressing. */
        const { results } = await env.DB.prepare(
          `SELECT sku, name, stock, status, bridge_enabled, unit_price_cents, elfia_price_cents
           FROM inventory_items WHERE bridge_enabled = 1
           ORDER BY sku LIMIT 1000`,
        ).all();
        rows = results as unknown as BridgeRow[];
      } catch {
        /* 0075 pending (the v1.4.218 lesson: skew degrades, never 500s) —
           serve the pre-v1.35.0 feed: LIKE scoping, no prices. */
        const { results } = await env.DB.prepare(
          `SELECT sku, name, stock FROM inventory_items
           WHERE UPPER(sku) LIKE 'ELFIA%' OR UPPER(sku) LIKE 'LUMI%'
           ORDER BY sku LIMIT 500`,
        ).all();
        rows = results as unknown as BridgeRow[];
      }
      }
    }
    /* Photo URLs are built on THIS request's own origin — production serves
       production URLs, the local test rig serves localhost ones, and no
       domain ever enters a committed file. */
    const origin = new URL(request.url).origin;
    const items = serializeBridgeItems(rows, origin);
    /* v1.46.0 — the hero carousel, authored in the portal's ELFIA tab. The
       store replaces its slide set to match this list (slides are wholly
       portal-owned); pre-0087 the table is absent and the key is simply
       omitted, which the store reads as "keep doing what you do". */
    let slides: ReturnType<typeof serializeBridgeSlides> | undefined;
    try {
      /* v1.47.0 added the framing columns. If this worker is published
         BEFORE 0088 runs, the wide query throws — and falling straight to
         the catch would drop the whole slides key and silently freeze the
         shop's carousel. So the narrow 0087 query is tried second: the
         carousel keeps working, framing simply defaults to the middle
         until the migration lands. */
      let slideRows: Record<string, unknown>[];
      try {
        slideRows = (await env.DB.prepare(
          `SELECT id, image_key, image_updated_at, title, subtitle, sort, active, focus_x, focus_y, fit, zoom,
                  cutout_key, cutout_updated_at, cutout_side, cutout_scale
           FROM elfia_slides WHERE active = 1 ORDER BY sort, id LIMIT 12`,
        ).all()).results;
      } catch {
        slideRows = (await env.DB.prepare(
          `SELECT id, image_key, image_updated_at, title, subtitle, sort, active
           FROM elfia_slides WHERE active = 1 ORDER BY sort, id LIMIT 12`,
        ).all()).results;
      }
      slides = serializeBridgeSlides(slideRows as unknown as SlideRow[], origin);
    } catch { /* 0087 pending */ }

    /* v1.52.0 — what delivery costs, set in the ELFIA tab. system_meta long
       predates this, so there is no migration: a shop where nobody has set
       them has no rows, serializeBridgeSettings returns undefined, the key
       is omitted, and the store keeps its own numbers. */
    let settings: ReturnType<typeof serializeBridgeSettings>;
    /* v1.55.0 — the uploaded catalog rides the same system_meta read: PDF,
       label map and cover as URLs on this request's origin, plus the marker
       that gates the store's download. Emitted only when the upload is
       complete (PDF + map + marker); absent means the store keeps what it
       has — the shipped designer catalog included. */
    let catalog: ReturnType<typeof serializeBridgeCatalog>;
    /* v1.61.0 — the /catalog hover backdrop rides the same read: one image
       URL plus the marker that gates the store's download. Absent = the
       store keeps what it has (the shipped ELFIA backdrop included). */
    let backdrop: ReturnType<typeof serializeBridgeBackdrop>;
    try {
      const { results } = await env.DB.prepare(
        `SELECT key, value FROM system_meta WHERE key IN
           ('elfia_shipping_cents', 'elfia_free_above_cents',
            'elfia_catalog_pdf_key', 'elfia_catalog_map_key',
            'elfia_catalog_cover_key', 'elfia_catalog_updated_at',
            'elfia_backdrop_key', 'elfia_backdrop_updated_at')`,
      ).all<{ key: string; value: string }>();
      const meta = Object.fromEntries(results.map((r) => [r.key, r.value]));
      settings = serializeBridgeSettings(meta);
      catalog = serializeBridgeCatalog(meta, origin);
      backdrop = serializeBridgeBackdrop(meta, origin);
    } catch { /* no system_meta in this checkout — omit the keys */ }

    return json({
      items,
      ...(slides !== undefined ? { slides } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(catalog !== undefined ? { catalog } : {}),
      ...(backdrop !== undefined ? { backdrop } : {}),
      as_of: new Date().toISOString(), count: items.length,
    });
  }

  /* v1.36.0 (feed B): the store reports every web sale as a signed movement
     and RETRIES anything not acknowledged. Idempotent by event_id — the one
     rule that must not be got wrong. Same key, same server-to-server posture
     as the feed above (no cookie → the CSRF gate does not engage; verified
     by tests/bridge-idempotency.mjs). Handler in bridge.ts. */
  if (path === "/api/v1/bridge/elfia-movements" && method === "POST") {
    return handleElfiaMovements(request, env);
  }

  if (path === "/api/v1/health/detail" && method === "GET") {
    const auth = request.headers.get("Authorization");
    if (!env.SETUP_TOKEN || !timingSafeEqual(auth ?? "", `Bearer ${env.SETUP_TOKEN}`)) {
      return errorResponse("unauthorized", "Invalid health check token", 401);
    }
    const pragma = await env.DB.prepare(`PRAGMA user_version`).first<{ user_version: number }>();
    return json({ ok: true, service: "azoneofficial-api", db_version: pragma?.user_version ?? 0 });
  }

  if (path === "/api/v1/health/migrations" && method === "GET") {
    /* v1.28.0: this used to hard-code the newest migration's filename and
       went stale the moment 0071 shipped — reporting "pending" forever on a
       fully migrated database. It now tracks LATEST_MIGRATION, which sits
       next to the migration list so the standing rule ("every new migration
       adds a line") updates both together. */
    let pending = false;
    try {
      const { results } = await env.DB.prepare(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`).all<{ name: string }>();
      if (results.length === 0 || results[0].name !== `${LATEST_MIGRATION}.sql`) {
        pending = true;
      }
    } catch {
      pending = true;
    }
    return json({ ok: true, pending });
  }

  /* v1.4.273: the client report link — public, read-only, token-gated.
     A client can forward this to their boss; it is also our best brochure. */
  if (path === "/api/v1/client-report" && method === "GET") {
    const t = new URL(request.url).searchParams.get("t") ?? "";
    if (!/^[a-f0-9]{32}$/.test(t)) return json({ error: "invalid_token" }, 404);
    try {
      const link = await env.DB.prepare(
        `SELECT l.customer_id, c.company FROM client_report_links l JOIN customers c ON c.id = l.customer_id WHERE l.token = ?1`,
      ).bind(t).first<{ customer_id: number; company: string }>();
      if (!link) return json({ error: "invalid_token" }, 404);
      const nowMY = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
      const month = nowMY.slice(0, 7);
      const lastMonth = new Date(new Date(month + "-01T00:00:00Z").getTime() - 86400_000).toISOString().slice(0, 7);
      const one = async <T,>(sql: string, ...args: unknown[]): Promise<T | null> => {
        try { return await env.DB.prepare(sql).bind(...args).first<T>(); } catch { return null; }
      };
      const lives = await one<{ n: number; minutes: number }>(
        `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN end_time IS NOT NULL
            THEN (CAST(substr(end_time,1,2) AS INTEGER)*60 + CAST(substr(end_time,4,2) AS INTEGER))
               - (CAST(substr(start_time,1,2) AS INTEGER)*60 + CAST(substr(start_time,4,2) AS INTEGER)) ELSE 0 END), 0) AS minutes
         FROM live_sessions WHERE client_id = ?1 AND status != 'cancelled' AND substr(session_date, 1, 7) = ?2`,
        link.customer_id, month);
      const livesLast = await one<{ n: number }>(
        `SELECT COUNT(*) AS n FROM live_sessions WHERE client_id = ?1 AND status != 'cancelled' AND substr(session_date, 1, 7) = ?2`,
        link.customer_id, lastMonth);
      const inv = await one<{ paid_cents: number; docs: number }>(
        `SELECT COALESCE(SUM(total_cents), 0) AS paid_cents, COUNT(*) AS docs FROM sales_documents
         WHERE customer_id = ?1 AND doc_type = 'INV' AND payment_status = 'paid'
           AND substr(COALESCE(paid_at, created_at), 1, 7) = ?2`, link.customer_id, month);
      const hours: { hour: string; n: number }[] = [];
      try {
        const { results } = await env.DB.prepare(
          `SELECT substr(start_time, 1, 2) AS hour, COUNT(*) AS n FROM live_sessions
           WHERE client_id = ?1 AND status != 'cancelled' AND session_date >= date('now', '+8 hours', '-60 days')
           GROUP BY hour ORDER BY n DESC LIMIT 3`,
        ).bind(link.customer_id).all<{ hour: string; n: number }>();
        hours.push(...results);
      } catch { /* pre-0056 */ }
      return json({
        company: link.company, month,
        lives: { this_month: lives?.n ?? 0, minutes: lives?.minutes ?? 0, last_month: livesLast?.n ?? 0 },
        invoiced_paid_cents: inv?.paid_cents ?? 0,
        top_hours: hours,
        generated: nowMY.slice(0, 10),
      });
    } catch (e) {
      if (String(e).includes("no such table")) return json({ error: "not_ready" }, 503);
      throw e;
    }
  }

  /* v1.4.273: the public package rate card (null until the CEO sets tiers). */
  if (path === "/api/v1/packages" && method === "GET") {
    try {
      const row = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'packages_json'`).first<{ value: string }>();
      const pk = row ? JSON.parse(row.value) : null;
      return json({ packages: Array.isArray(pk) && pk.length ? pk : null });
    } catch { return json({ packages: null }); }
  }

  if (path === "/api/v1/content-public" && method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT key, value FROM site_content`,
    ).all();
    return json(
      { content: results },
      200,
      { "Cache-Control": "public, max-age=60" },
    );
  }

  if (path === "/api/v1/enquiries" && method === "POST") {
    const allowed = await checkRateLimit(env, `enquiry:${clientIp(request)}`, 5, 3600);
    if (!allowed) {
      return errorResponse("rate_limited", "Too many submissions — please try again later or WhatsApp us", 429);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.name, 120) || !isNonEmptyString(body.message, 4000)) {
      return errorResponse("invalid_input", "name and message are required", 400);
    }
    await env.DB.prepare(
      `INSERT INTO enquiries (name, company, phone, email, message)
       VALUES (?1, ?2, ?3, ?4, ?5)`,
    )
      .bind(
        (body.name as string).trim(),
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        isNonEmptyString(body.email, 200) ? body.email : null,
        (body.message as string).trim(),
      )
      .run();
    return json({ ok: true }, 201);
  }

  /* ---- auth ---- */

  /* ---- TikTok Shop order webhook (v1.4.40) ----
     Receives order events and moves inventory + creates postage records
     automatically. Configure the same secret in TikTok Seller Center (or the
     relay you use) and as a Worker secret:
       npx wrangler secret put TIKTOK_WEBHOOK_SECRET
     Expected JSON body:
       { "order_id": "5790…", "status": "awaiting_shipment" | "cancelled" | "returned",
         "items": [ { "sku": "AZ-001", "qty": 2 }, … ] }
     - awaiting_shipment (or "paid"/"new"): creates postage record TT-{order_id}
       and deducts stock per SKU (all-or-nothing; on shortage the record is
       still created with a note so the order is tracked, but nothing deducts)
     - cancelled/returned: restocks that order's lines, once. */
  /* ---- TikTok status + manual sync (v1.4.48) ----
     Webhooks only push orders created AFTER the subscription goes live, so
     "Sync from TikTok" backfills the last 30 days via Get Order List. */
  if (path === "/api/v1/integrations/tiktok/status" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || me.role === "customer") return errorResponse("unauthorized", "Sign in required", 401);
    const tok = await tiktokToken(env);
    const last = await env.DB.prepare(
      `SELECT created_at, verified FROM webhook_events WHERE provider = 'tiktok' ORDER BY id DESC LIMIT 1`,
    ).first<{ created_at: string; verified: number }>();
    /* v1.4.212 (approved architecture review): two ADDITIVE keys for the
       new Connection-status card — existing keys and consumers untouched.
       last_order_at = newest synced TikTok order (webhook or sync);
       failed_events_7d = signature-verification failures this week (>0
       usually means the stored app secret is stale — the known fix is
       re-copy → wrangler secret put TIKTOK_APP_SECRET → deploy). */
    const lastOrder = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM postage_records WHERE order_ref LIKE 'TT-%'`,
    ).first<{ at: string | null }>();
    const failed7 = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM webhook_events
       WHERE provider = 'tiktok' AND verified = 0 AND created_at >= datetime('now', '-7 days')`,
    ).first<{ n: number }>();
    /* v1.4.217: the CEO fixed the secret but the card still showed the
       warning — the 7-day counter and "last event" verdict are HISTORY and
       stay red until the NEXT webhook arrives. These two additive keys let
       the card tell "fixed, waiting for the next event" apart from "still
       broken": if the newest VERIFIED event is more recent than the newest
       failure, the secret is provably working again. */
    const lastOk = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM webhook_events WHERE provider = 'tiktok' AND verified = 1`,
    ).first<{ at: string | null }>();
    const lastFail = await env.DB.prepare(
      `SELECT MAX(created_at) AS at FROM webhook_events WHERE provider = 'tiktok' AND verified = 0`,
    ).first<{ at: string | null }>();
    return json({
      configured: Boolean(env.TIKTOK_APP_KEY && env.TIKTOK_APP_SECRET),
      authorized: Boolean(tok),
      last_event_at: last?.created_at ?? null,
      last_event_verified: last ? Boolean(last.verified) : null,
      last_order_at: lastOrder?.at ?? null,
      failed_events_7d: failed7?.n ?? 0,
      last_verified_at: lastOk?.at ?? null,
      last_failed_at: lastFail?.at ?? null,
    });
  }

  /* v1.4.220 (CEO: failures continue AFTER the secret update — waiting is
     no longer the answer): replay the newest failed webhook against the
     secret the worker is running RIGHT NOW and return a verdict. Note the
     ~30-min failure cadence is TikTok RETRYING the same undelivered event
     (it re-sends until it receives a 200), so the counter climbs until
     verification passes once. Scheme-B replays skip the 5-minute
     freshness check — the point is the HMAC, not the age. */
  if (path === "/api/v1/integrations/tiktok/webhook-debug" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !["ceo", "coo", "admin", "super_admin"].includes(me.role)) {
      return errorResponse("forbidden", "Management access required", 401);
    }
    const ev = await env.DB.prepare(
      `SELECT created_at, headers, body FROM webhook_events
       WHERE provider = 'tiktok' AND verified = 0 ORDER BY id DESC LIMIT 1`,
    ).first<{ created_at: string; headers: string; body: string }>();
    if (!ev) return json({ state: "no_failures" });
    let hdrs: { signature?: string; relay?: string } = {};
    try { hdrs = JSON.parse(ev.headers) as typeof hdrs; } catch { hdrs = {}; }
    const sig = hdrs.signature ?? "absent";
    const relayPresent = hdrs.relay === "present";
    if (sig === "present") {
      // Legacy row from before this release — the value wasn't stored yet.
      return json({ state: "insufficient_data", event_at: ev.created_at, relay_header: relayPresent });
    }
    if (sig === "absent" || !sig) {
      return json({ state: "no_signature_header", event_at: ev.created_at, relay_header: relayPresent });
    }
    let scheme: "A" | "B" = "A";
    let hmacOk = false;
    if (env.TIKTOK_APP_SECRET && env.TIKTOK_APP_KEY) {
      if (!sig.includes("=")) {
        const expected = await hmacHex(env.TIKTOK_APP_SECRET, env.TIKTOK_APP_KEY + ev.body);
        hmacOk = timingSafeEqual(expected, sig.trim());
      } else {
        scheme = "B";
        const parts = Object.fromEntries(
          sig.trim().split(",").map((kv) => {
            const i = kv.indexOf("=");
            return [kv.slice(0, i).trim(), kv.slice(i + 1).trim()] as [string, string];
          }),
        );
        if (parts.t && parts.s) {
          const expected = await hmacHex(env.TIKTOK_APP_SECRET, `${parts.t}${ev.body}`);
          hmacOk = timingSafeEqual(expected, parts.s);
        }
      }
    }
    return json({
      state: "replayed",
      event_at: ev.created_at,
      scheme,
      relay_header: relayPresent,
      current_secret_verifies: hmacOk,
    });
  }

  /* v1.62.0 — TikTok Shop Analytics: FIND OUT before building.
   *
   * The CEO asked for GMV, orders, units, buyers, visitors, impressions, page
   * views and CTR, split by video / live / product card, and per product.
   * The plumbing to fetch all of that already exists (tiktokSignedFetch above
   * signs and sends; the token refreshes itself). What does NOT exist is
   * certainty about the endpoint paths and the field names: TikTok's v2 specs
   * are behind a Partner Center login, and their own guidance is that shop
   * analytics is not one endpoint but several.
   *
   * Writing a schema and a cron against guessed field names would produce a
   * panel that looks finished and silently shows zeros. So this route asks
   * the live API, with the real token, and reports exactly what comes back.
   *
   * It is READ-ONLY and deliberately inert: it stores nothing, changes
   * nothing, and cannot move money or stock. It exists to turn a guess into a
   * fact, and can be deleted once the panel is built.
   *
   * Add a candidate with ?path=/some/path&extra=k:v to try one by hand.
   */
  if (path === "/api/v1/integrations/tiktok/analytics-probe" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !["ceo", "super_admin"].includes(me.role)) {
      return errorResponse("forbidden", "CEO access required", 401);
    }
    const tok = await tiktokToken(env);
    if (!tok) {
      return json({
        state: "not_authorised",
        hint: "No TikTok token stored. Complete the Renew authorisation in Partner Center first.",
      });
    }
    if (!env.TIKTOK_APP_SECRET) {
      return json({ state: "no_secret", hint: "npx wrangler secret put TIKTOK_APP_SECRET" });
    }

    /* A window TikTok will certainly accept: the last 7 whole days, MYT. */
    const day = (offset: number) =>
      new Date(Date.now() + 8 * 3600 * 1000 - offset * 86400_000).toISOString().slice(0, 10);
    const range = { start_date_ge: day(7), end_date_lt: day(0) };

    const probeUrl = new URL(request.url);
    const asked = probeUrl.searchParams.get("path");
    const askedVersion = probeUrl.searchParams.get("version") ?? "202405";

    /* ROUND 2 — what round 1 taught us, 27-08-2026:
     *
     *   /analytics/202405/shop/performance  -> 36009003 "Internal error"
     *   /analytics/202409/shop/performance  -> 36009004 "Invalid API version.
     *                                          The 'version' query parameter
     *                                          is invalid."
     *   everything else                     -> 36009009 "Invalid path"
     *
     * Two facts fall out of that. First, /analytics/202405/shop/performance
     * IS a real endpoint — a path that does not exist answers 36009009, and
     * this one did not. Second, TikTok wants `version` as a QUERY PARAMETER
     * as well as a path segment; nothing sent one, which is the likeliest
     * cause of the "internal error" on the path that does exist.
     *
     * So: every candidate now carries `version`, and the sub-resources are
     * retried under the naming family TikTok actually uses (shop_products,
     * not shop/product_performance). Several parameter shapes are tried on
     * the endpoint we know exists, because "internal error" is often what
     * this API returns for a missing required parameter. */
    /* ROUND 3 — what round 2 taught us, 28-08-2026. Round 2's own results:
     *
     *   shop/performance          + currency          -> WORKS
     *   shop/performance          + granularity=ALL   -> WORKS
     *   shop/performance          (no currency)       -> 36009003 internal
     *   shop/performance          + granularity=1D    -> 36009003 internal
     *   shop_products/performance                     -> WORKS
     *     (click_through_rate, gmv, id, orders, units_sold)
     *   shop_skus / shop_videos / shop_lives          -> 36009004
     *     "Invalid API version. The `version` query parameter is invalid."
     *
     * That last line is the whole story, and it is not a permissions
     * problem: 202405 is NOT a global API version. TikTok stamps each
     * analytics endpoint with its OWN version, and their documentation URLs
     * carry it in the slug:
     *
     *   get-shop-performance-202405              -> shop            202405
     *   get-shop-product-performance-list-202405 -> shop_products   202405
     *   get-shop-sku-performance-list-202509     -> shop_skus       202509
     *   get-shop-video-performance-list-202409   -> shop_videos     202409
     *     (a -202509 revision also exists, so both are tried)
     *   get-shop-live-performance-list-202509    -> shop_lives      202509
     *   get-shop-live-performance-overview-202508
     *
     * The last one is the proof this is right rather than a guess: THIS
     * WORKER ALREADY CALLS IT at 202508 (see the LIVE analytics cron), and
     * that call works. One version for all eight was always going to fail
     * five of them.
     *
     * So each candidate now carries its own version, in the path AND in the
     * query parameter — the refusal names the query parameter specifically.
     *
     * Two settled facts are baked in below rather than re-tested:
     *   - `currency` is effectively REQUIRED; omitting it returns 36009003
     *     "internal error" instead of a missing-parameter message, so every
     *     candidate sends it.
     *   - granularity=1D returns 36009003 where ALL succeeds. 36009003 is
     *     TikTok's own internal error and their guidance is to retry, so 1D
     *     stays in the probe to learn whether it is permanent — but the real
     *     panel must read totals with ALL and treat a daily split as a
     *     bonus, never a dependency. */
    const cand = (
      label: string, version: string, resource: string,
      extra: Record<string, string> = {}, suffix = "performance",
      sendVersion = true,
    ) => ({
      label,
      path: `/analytics/${version}/${resource}/${suffix}`,
      /* currency on every candidate — see above. `sendVersion: false` exists
         for one case only: the LIVE overview endpoint, whose known-good call
         elsewhere in this worker omits the version query parameter. */
      params: { ...(sendVersion ? { version } : {}), ...range, currency: "LOCAL", ...extra },
    });
    const candidates: { label: string; path: string; params: Record<string, string>;
                        body?: string; method?: string }[] = asked
      ? [{ label: "manual", path: asked, params: { version: askedVersion, ...range } }]
      : [
          /* the two that already answer — kept as controls, so a future
             failure here is visibly a REGRESSION and not a new mystery */
          cand("shop performance (ALL)", "202405", "shop", { granularity: "ALL" }),
          cand("shop performance (daily)", "202405", "shop", { granularity: "1D" }),
          cand("product performance", "202405", "shop_products", { page_size: "10" }),
          /* the three that were never really tested — rejected on version
             before TikTok ever looked at this shop's authorisation */
          cand("sku performance", "202509", "shop_skus", { page_size: "10" }),
          cand("video performance (202409)", "202409", "shop_videos", { page_size: "10" }),
          cand("video performance (202509)", "202509", "shop_videos", { page_size: "10" }),
          cand("live performance", "202509", "shop_lives", { page_size: "10" }),
          /* ROUND 4 — the last refusal, and what round 3 revealed.
             Round 3 result: 7 of 8 answered. `granularity=1D` on shop
             performance, which failed in round 2, WORKED in round 3 with no
             code change — so that one really was TikTok's transient
             internal error, exactly as 36009003 claims to be.
             Only the LIVE overview still returns 36009003. It is the one
             candidate whose parameters were guessed rather than copied, and
             this worker ALREADY CALLS THIS ENDPOINT successfully in the
             live-analytics route below — with two parameters the probe never
             sent: `granularity` and `account_type`. Given a missing required
             parameter is precisely what produced 36009003 on shop/performance
             (no currency), that is the likeliest cause rather than a fault.
             Both shapes are tried, because the working call also omits the
             `version` query parameter and only sending both settles which
             half matters. */
          /* ROUND 5 — `shop_lives/overview_performance` is RETIRED from this
             probe, on evidence rather than fatigue.
             It was asked four ways across three rounds — bare, with
             granularity + account_type (the exact parameters the LIVE cron
             sends), with the version query parameter and without it — and
             answered 36009003 "Internal error" every single time, while the
             seven endpoints beside it answered on the first correct version.
             36009003 is TikTok's own internal error; four identical refusals
             across two parameter families is their side, not ours.
             It is also REDUNDANT: shop_lives/performance @202509 answers and
             carries the same figures per LIVE, so nothing is lost. The LIVE
             card now reads from there (see /api/v1/live-analytics above),
             which is what this endpoint was blocking all along.
             Keeping a permanently red row here would train everyone to
             ignore a red row, which is the one thing this panel must not do.
             To re-test it by hand after TikTok fixes their side:
               /integrations/tiktok/analytics-probe?path=/analytics/202508/shop_lives/overview_performance&version=202508 */

          /* ROUND 6 (28-08) - the NAME sources, not analytics at all.
             Every analytics row comes back as a 19-digit id and no name,
             because the names live in the catalogue and the order feed, not
             in the analytics response. Two attempts to join them on have now
             failed, and the second failed SILENTLY, so both sources are
             asked here in the open: whichever of them TikTok actually opens
             for this authorisation is the one the panel should read. */
          { label: "product catalogue (names)", path: "/product/202309/products/search",
            params: { page_size: "5" }, body: JSON.stringify({}), method: "POST" },
          { label: "order names (fallback)", path: "/order/202309/orders/search",
            params: { page_size: "5" },
            body: JSON.stringify({ create_time_ge: Math.floor(Date.now() / 1000) - 90 * 86400 }),
            method: "POST" },
        ];

    const findings: unknown[] = [];
    for (const c of candidates) {
      const res = (await tiktokSignedFetch(env, c.path, c.params, c.body, c.method ?? "GET")) as
        { code?: number; message?: string; data?: unknown } | null;
      /* Report the SHAPE, not a dump: the top-level keys and the keys of the
         first row are what decide the schema, and they keep the response
         small enough to read. */
      const data = res?.data as Record<string, unknown> | undefined;
      const firstRow = data
        ? (Object.values(data).find((v) => Array.isArray(v)) as unknown[] | undefined)?.[0]
        : undefined;
      findings.push({
        label: c.label,
        path: c.path,
        /* the exact parameters sent, so a refusal can be read without
           guessing what the probe did */
        params: c.params,
        code: res?.code ?? null,
        message: res?.message ?? null,
        /* code 0 is TikTok's "success". Anything else is usually a missing
           scope or a path that does not exist — the message says which. */
        usable: res?.code === 0,
        data_keys: data ? Object.keys(data).slice(0, 40) : null,
        first_row_keys: firstRow && typeof firstRow === "object"
          ? Object.keys(firstRow as Record<string, unknown>).slice(0, 60) : null,
        /* The first row itself when there is one, otherwise the whole data
           object truncated — enough to read, never enough to be a dump. */
        sample: firstRow ?? (data ? JSON.stringify(data).slice(0, 600) : null),
      });
    }
    return json({
      state: "probed",
      window: range,
      shop_cipher_present: Boolean(tok.shop_cipher),
      findings,
      next: "Send this back to Claude — the usable paths and their field names decide the schema.",
    });
  }

  if (path === "/api/v1/integrations/tiktok/sync" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me || !can(me.role, "sync_manage")) {
      return errorResponse("forbidden", "Inventory access required", 403);
    }
    const r = await runTikTokSync(env, me.id);
    if (!r.ok) return errorResponse(r.code, r.message, r.status);
    return json(r);
  }

  if (path === "/api/v1/integrations/tiktok/webhook" && method === "POST") {
    // TikTok signs its own requests (tiktok-signature); a relay such as
    // Make/Zapier can instead send x-webhook-secret. Either proves origin.
    const len = Number(request.headers.get("Content-Length") ?? "0");
    if (!Number.isFinite(len) || len <= 0 || len > MAX_WEBHOOK_BODY_BYTES) {
      return errorResponse("payload_too_large", "Webhook payload is too large", 413);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_WEBHOOK_BODY_BYTES) {
      return errorResponse("payload_too_large", "Webhook payload is too large", 413);
    }
    const sigHeader = request.headers.get("tiktok-signature") ?? request.headers.get("Tiktok-Signature") ?? "";
    const relaySecret = request.headers.get("x-webhook-secret") ?? "";
    const viaTikTok = sigHeader ? await verifyTikTokSignature(env, sigHeader, rawBody) : false;
    const viaRelay = Boolean(env.TIKTOK_WEBHOOK_SECRET) && Boolean(relaySecret) &&
      timingSafeEqual(relaySecret, env.TIKTOK_WEBHOOK_SECRET ?? "");
    const verified = viaTikTok || viaRelay;

    const body = (() => {
      try { return JSON.parse(rawBody) as Record<string, unknown>; } catch { return null; }
    })();
    // TikTok wraps the payload: { type, shop_id, timestamp, data: {...} }.
    const data = (body?.data ?? body ?? {}) as Record<string, unknown>;
    const orderId = String(data.order_id ?? data.orderId ?? "").trim();
    const rawStatus = String(data.order_status ?? data.status ?? "").toLowerCase();

    // Record the receipt — including unverified ones — so a signature
    // mismatch is visible and diagnosable instead of silently dropped.
    // v1.5.0: unverified receipts are rate-limited per IP (the endpoint is
    // unauthenticated — anyone could previously grow this table at 4 KB per
    // request forever) and the table is trimmed to the newest 2000 rows.
    const recordReceipt = verified ||
      (await checkRateLimit(env, `webhook_unverified:${clientIp(request)}`, 30, 3600));
    if (recordReceipt) {
      await env.DB.prepare(
        `INSERT INTO webhook_events (provider, event_type, order_ref, verified, headers, body)
         VALUES ('tiktok', ?1, ?2, ?3, ?4, ?5)`,
      ).bind(
        String(body?.type ?? "unknown"),
        orderId ? `TT-${orderId}` : null,
        verified ? 1 : 0,
        /* v1.4.220: store the actual signature value — it is derived and
           public in transit, and without it a failed event can never be
           replayed against a corrected secret to prove the fix. */
        JSON.stringify({ signature: sigHeader || "absent", relay: relaySecret ? "present" : "absent" }),
        rawBody.slice(0, 4000),
      ).run();
      if (Math.random() < 0.02) {
        try {
          await env.DB.prepare(
            `DELETE FROM webhook_events WHERE id NOT IN (SELECT id FROM webhook_events ORDER BY id DESC LIMIT 2000)`,
          ).run();
        } catch { /* housekeeping only */ }
      }
    }

    if (!verified) {
      return errorResponse("unauthorized", "Signature verification failed", 401);
    }
    if (!orderId) return json({ ok: true, ignored: "no order_id" });

    const orderRef = `TT-${orderId.slice(0, 64)}`;
    const existing = await env.DB.prepare(
      `SELECT id, restocked FROM postage_records WHERE order_ref = ?1`,
    ).bind(orderRef).first<{ id: number; restocked: number }>();

    // TikTok status codes: 100/AWAITING_SHIPMENT etc. Treat "new order" states
    // as stock-out, cancellation/return states as stock-in.
    const outbound = ["awaiting_shipment", "awaiting_collection", "paid", "unpaid", "new", "100", "111"];
    const reversal = ["cancelled", "canceled", "returned", "refunded", "140", "capture_failed"];

    if (outbound.some((k) => rawStatus.includes(k))) {
      if (existing) return json({ ok: true, duplicate: true });
      // Line items are not in the webhook — fetch them from the Order API.
      const detail = await tiktokOrderItems(env, orderId);
      const lines = detail.items;
      const resolved: { id: number; qty: number; unit_sale_cents: number | null }[] = [];
      const unknown: string[] = [];
      const shortages: string[] = [];
      const nameMatched: string[] = [];
      for (const l of lines) {
        // v1.4.162: SKU first, item-name fallback (see matchInventoryItem)
        const item = await matchInventoryItem(env, l.sku, l.name, l.variant);
        if (!item) { unknown.push(`${l.qty}× ${l.sku || l.name}`); continue; }
        if (item.via === "name") nameMatched.push(item.name);
        if (item.stock < l.qty) shortages.push(`${item.name}: ${item.stock} in stock, order needs ${l.qty}`);
        resolved.push({ id: item.id, qty: l.qty, unit_sale_cents: l.unit_sale_cents });
      }
      const canDeduct = shortages.length === 0 && resolved.length > 0;
      const notes = ["TikTok order (auto)"];
      if (lines.length === 0) notes.push("items not retrieved — authorize the app to enable stock movement");
      if (nameMatched.length) notes.push(`matched by item name: ${nameMatched.join(", ")}`);
      if (unknown.length) notes.push(`not in inventory (SKU or name): ${unknown.join(", ")}`);
      if (!canDeduct && shortages.length) notes.push(`NOT deducted — ${shortages.join("; ")}`);

      const rec = await env.DB.prepare(
        `INSERT INTO postage_records (order_ref, courier, buyer_city, status, note, updated_by)
         VALUES (?1, 'TikTok', ?2, 'preparing', ?3, NULL) RETURNING id`,
      ).bind(orderRef, detail.city, notes.join(" · ")).first<{ id: number }>();
      if (canDeduct) {
        for (const l of resolved) {
          const upd = await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock - ?1, updated_at = datetime('now') WHERE id = ?2 AND stock >= ?1`,
          ).bind(l.qty, l.id).run();
          if (upd.meta.changes) {
            // v1.4.166: movement carries the actual sold price; rebate auto-syncs
            await recordTiktokLine(env, rec!.id, l.id, l.qty, l.unit_sale_cents);
            await env.DB.prepare(
              `UPDATE inventory_items SET status = CASE WHEN stock = 0 THEN 'out_of_stock' WHEN stock <= 5 THEN 'low' ELSE 'in_stock' END WHERE id = ?1`,
            ).bind(l.id).run();
            await audit(env, null, "inventory.out", "inventory_items", String(l.id), { qty: l.qty, unit_sale_cents: l.unit_sale_cents, order: orderRef, source: "tiktok" });
          }
        }
      }
      await audit(env, null, "tiktok.order", "postage_records", String(rec?.id), { status: rawStatus, deducted: canDeduct });
      return json({ ok: true, order_ref: orderRef, deducted: canDeduct, unknown_skus: unknown, shortages }, 201);
    }

    if (reversal.some((k) => rawStatus.includes(k))) {
      if (!existing) return json({ ok: true, ignored: "unknown order" });
      if (!existing.restocked) {
        const { results } = await env.DB.prepare(
          `SELECT inventory_item_id, qty FROM postage_items WHERE postage_id = ?1`,
        ).bind(existing.id).all();
        for (const l of results as { inventory_item_id: number; qty: number }[]) {
          await env.DB.prepare(
            `UPDATE inventory_items SET stock = stock + ?1,
               status = CASE WHEN stock + ?1 <= 5 THEN 'low' ELSE 'in_stock' END,
               updated_at = datetime('now') WHERE id = ?2`,
          ).bind(l.qty, l.inventory_item_id).run();
          await audit(env, null, "inventory.in", "inventory_items", String(l.inventory_item_id), { qty: l.qty, reason: rawStatus, source: "tiktok" });
        }
        await env.DB.prepare(
          `UPDATE postage_records SET status = 'returned', restocked = 1, updated_at = datetime('now') WHERE id = ?1`,
        ).bind(existing.id).run();
      }
      await audit(env, null, "tiktok.order_reversal", "postage_records", String(existing.id), { status: rawStatus });
      return json({ ok: true, restocked: true });
    }
    // Shipping/other status updates: keep the tracker current without moving stock.
    if (existing && rawStatus) {
      await env.DB.prepare(
        `UPDATE postage_records SET status = ?1, updated_at = datetime('now') WHERE id = ?2`,
      ).bind(rawStatus.includes("delivered") || rawStatus.includes("complete") ? "delivered" : rawStatus.includes("ship") ? "shipped" : "preparing", existing.id).run();
    }
    return json({ ok: true, status: rawStatus });
  }

  /* ---- Threads account connection (v1.89.0) ----
     Two browser redirects, not API calls: /connect sends a signed-in manager
     to Meta with a state cookie, Meta sends them back to /callback with a
     code, and threads.ts turns the code into a long-lived token that never
     leaves the Worker. Both sides derive the redirect URI the same way the
     Google sign-in does — from the request origin, never a literal — so the
     pair always agrees and no domain enters this file. */
  if (path === "/api/v1/integrations/threads/connect" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !can(me.role, "threads_manage")) {
      return errorResponse("forbidden", "Management sign-in required", 403);
    }
    if (!threadsConfigured(env)) {
      return errorResponse("not_configured", "Threads app credentials are not set", 503);
    }
    const u = new URL(request.url);
    const origin = `${u.protocol}//${u.host}`;
    const base = allowedOrigins(env).includes(origin) ? origin : primaryOrigin(env);
    const state = randomHex(16);
    const authorize = threadsAuthUrl(env, `${base}/api/v1/integrations/threads/callback`, state);
    /* ?show=1 — v1.89.1: print the URL instead of following it. Meta's
       authorise page answers a wrong app id or an unregistered redirect with
       "An unknown error has occurred" and nothing else, and by then the
       address bar has moved on. This shows a manager the exact client_id
       and redirect_uri the worker sends, to compare with the dashboard.
       Nothing here is secret: the app id is public and the secret is never
       in any URL. */
    if (u.searchParams.get("show") === "1") {
      /* v1.94.0 — the raw stored value tells you things the trimmed one
         hides: a pasted newline, a space, letters where an app id is all
         digits. Reported ABOUT the value, never as a second copy of a
         secret — this is the public app id only. */
      return json({
        authorize_url: authorize,
        ...threadsSetupReport(env),
        redirect_uri: `${base}/api/v1/integrations/threads/callback`,
        note: "client_id must be the THREADS App ID (Use cases > Threads API > Customize > Settings) - NOT the Meta App ID on Settings > Basic. redirect_uri must appear character-for-character in that page's Redirect Callback URLs, and its Uninstall and Delete callback fields must not be empty.",
      });
    }
    return new Response(null, {
      status: 302,
      headers: {
        Location: authorize,
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      },
    });
  }
  if (path === "/api/v1/integrations/threads/callback" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !can(me.role, "threads_manage")) {
      return errorResponse("forbidden", "Management sign-in required", 403);
    }
    const u = new URL(request.url);
    const code = u.searchParams.get("code");
    const state = u.searchParams.get("state");
    const cookieState = getCookie(request, OAUTH_STATE_COOKIE);
    const clearState = `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
    const page = (title: string, line: string) => new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:40px">
       <h2>${title}</h2><p>${line}</p><p><a href="/portal">Back to the staff portal</a></p></body>`,
      { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Set-Cookie": clearState } },
    );
    if (!code || !state || !cookieState || state !== cookieState) {
      return page("Threads was not connected", "The sign-in did not come back the way it left. Open the Threads tab and press Connect again.");
    }
    const origin = `${u.protocol}//${u.host}`;
    const base = allowedOrigins(env).includes(origin) ? origin : primaryOrigin(env);
    const done = await threadsCompleteAuth(env, code, `${base}/api/v1/integrations/threads/callback`, me.id);
    if (!done.ok) {
      await logError(env, "threads_connect", done.reason, path);
      return page("Threads was not connected", done.reason);
    }
    return page("Threads connected", `@${done.username} is connected. The history import has started and continues in the background; the Threads tab shows its progress.`);
  }

  /* ---- TikTok seller authorization callback (v1.4.44) ----
     Point the app's Redirect URL here. TikTok returns ?code=…; this exchanges
     it for the access token that lets order webhooks resolve line items. */
  if (path === "/api/v1/integrations/tiktok/callback" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me || !["ceo", "coo", "admin", "super_admin"].includes(me.role)) {
      return errorResponse("forbidden", "Management sign-in required", 403);
    }
    if (!env.TIKTOK_APP_KEY || !env.TIKTOK_APP_SECRET) {
      return errorResponse("not_configured", "TikTok app credentials are not set", 503);
    }
    const code = new URL(request.url).searchParams.get("code");
    if (!code) return errorResponse("invalid_input", "Missing authorization code", 400);
    const tokenUrl = new URL("https://auth.tiktok-shops.com/api/v2/token/get");
    tokenUrl.searchParams.set("app_key", env.TIKTOK_APP_KEY);
    tokenUrl.searchParams.set("app_secret", env.TIKTOK_APP_SECRET);
    tokenUrl.searchParams.set("auth_code", code);
    tokenUrl.searchParams.set("grant_type", "authorized_code");
    const res = await fetch(tokenUrl.toString());
    const data = (await res.json().catch(() => null)) as {
      data?: { access_token?: string; refresh_token?: string; access_token_expire_in?: number };
    } | null;
    const tok = data?.data;
    if (!tok?.access_token) return errorResponse("auth_failed", "TikTok did not return an access token", 400);
    await env.DB.prepare(
      `INSERT INTO integration_tokens (provider, access_token, refresh_token, expires_at, updated_at)
       VALUES ('tiktok', ?1, ?2, datetime('now', '+' || ?3 || ' seconds'), datetime('now'))
       ON CONFLICT (provider) DO UPDATE SET
         access_token = ?1, refresh_token = ?2,
         expires_at = datetime('now', '+' || ?3 || ' seconds'), updated_at = datetime('now')`,
    ).bind(tok.access_token, tok.refresh_token ?? null, String(tok.access_token_expire_in ?? 604800)).run();
    // Order APIs need the shop_cipher — resolve and store it immediately.
    const cipherRes = await refreshTikTokShopCipher(env);
    await audit(env, me.id, "tiktok.authorized", undefined, undefined, { shop_cipher: cipherRes.detail });
    return new Response(
      `<!doctype html><meta charset="utf-8"><body style="font-family:Arial;padding:40px">
       <h2>TikTok Shop connected</h2>
       <p>AZ ONE OFFICIAL can now read order details and move inventory automatically.</p>
       <p><a href="/portal">Back to the staff portal</a></p></body>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  /* v1.4.244 PUBLIC DOCUMENT — deliberately unauthenticated, deliberately
     NOT under /staff. The customer opens this on their phone straight from
     WhatsApp; the long random token is the only credential. Read-only, one
     document, no ids that could be walked. Revoked the moment the token is
     cleared in the portal. */
  const pubDoc = path.match(/^\/api\/v1\/public\/doc\/([a-f0-9]{32})$/);
  if (pubDoc && method === "GET") {
    const token = pubDoc[1]!;
    let d: Record<string, unknown> | null = null;
    try {
      d = await env.DB.prepare(
        `SELECT d.doc_type, d.doc_number, d.issuer_code, d.items, d.discount_cents, d.tax_percent, d.delivery_cents,
                d.total_cents, d.notes, d.valid_until, d.due_date, d.created_at, d.kind, d.reference,
                d.delivery_address, d.delivery_status, d.payment_status, d.payment_ref, d.paid_at,
                c.company, c.contact_person, c.email AS customer_email, c.phone AS customer_phone,
                c.address, c.delivery_address AS customer_delivery_address,
                sp.name AS salesperson_name, cb.role AS created_by_role
         FROM sales_documents d JOIN customers c ON c.id = d.customer_id
         LEFT JOIN users sp ON sp.id = d.salesperson_id
         LEFT JOIN users cb ON cb.id = d.created_by
         WHERE d.share_token = ?1`,
      ).bind(token).first<Record<string, unknown>>();
    } catch (e) {
      // Migration skew (v1.4.218 lesson): without 0062/0063 the link simply
      // does not resolve rather than throwing a 500 at a customer.
      // v1.28.0: without 0073 (issuer_code) the link must not die either —
      // retry once without the issuer column; the row then renders as
      // legacy AZ ONE OFFICIAL, which is exactly what a pre-0073 row is.
      if (!String(e).includes("no such column")) throw e;
      try {
        d = await env.DB.prepare(
          `SELECT d.doc_type, d.doc_number, d.items, d.discount_cents, d.tax_percent, d.delivery_cents,
                  d.total_cents, d.notes, d.valid_until, d.due_date, d.created_at, d.kind,
                  c.company, c.contact_person, c.email AS customer_email, c.phone AS customer_phone,
                  c.address,
                  sp.name AS salesperson_name, cb.role AS created_by_role
             FROM sales_documents d JOIN customers c ON c.id = d.customer_id
             LEFT JOIN users sp ON sp.id = d.salesperson_id
             LEFT JOIN users cb ON cb.id = d.created_by
            WHERE d.share_token = ?1`,
        ).bind(token).first<Record<string, unknown>>();
      } catch { d = null; }
    }
    if (!d) return errorResponse("not_found", "This link is no longer valid — please ask for a new one", 404);
    /* Same signer rule as the portal (v1.4.233): an officer's document shows
       that officer's signature; anyone else's is signed in ink. */
    const MGMT = ["ceo", "coo", "cco"];
    const creatorRole = String(d.created_by_role ?? "");
    const signRole = MGMT.includes(creatorRole) ? creatorRole : (d.doc_type === "INV" ? "ceo" : null);
    let signer: { signer_name: string; position: string | null } | null = null;
    if (signRole) {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users
         WHERE role = ?1 AND is_active = 1 ORDER BY id LIMIT 1`,
      ).bind(signRole).first<{ signer_name: string; position: string | null }>();
    } else if (d.salesperson_name) {
      signer = await env.DB.prepare(
        `SELECT COALESCE(full_name, name) AS signer_name, position FROM users WHERE name = ?1 LIMIT 1`,
      ).bind(d.salesperson_name).first<{ signer_name: string; position: string | null }>();
    }
    delete d.created_by_role;
    return new Response(JSON.stringify({
      doc: { ...d, signer_role: signRole, signer_name: signer?.signer_name ?? null, signer_position: signer?.position ?? null },
    }), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow", // a customer's prices stay out of search
        ...corsHeaders(env),
      },
    });
  }

  /* v1.38.0 (IMPLEMENTATION-PLAN.md S-1): the signature on a SHARED document
     rides the same credential the document itself does — the 32-hex share
     token. Before this, five real handwritten signatures were plain static
     files anyone on the internet could download; now the public path knows
     only this route, which serves exactly the signer's PNG for exactly the
     documents that were deliberately shared, from the private R2 vault.
     Revoking the share link revokes the signature with it. */
  if (path === "/api/v1/public/doc-signature" && method === "GET") {
    const token = new URL(request.url).searchParams.get("t") ?? "";
    if (!/^[a-f0-9]{32}$/.test(token)) return errorResponse("not_found", "Unknown document", 404);
    let sigDoc: { doc_type: string; created_by_role: string | null } | null = null;
    try {
      sigDoc = await env.DB.prepare(
        `SELECT d.doc_type, cb.role AS created_by_role
         FROM sales_documents d LEFT JOIN users cb ON cb.id = d.created_by
         WHERE d.share_token = ?1`,
      ).bind(token).first<{ doc_type: string; created_by_role: string | null }>();
    } catch { sigDoc = null; }
    if (!sigDoc) return errorResponse("not_found", "Unknown document", 404);
    // Same signer rule as everywhere (v1.4.233): officer's doc → their chop;
    // anyone else's INV → CEO; anything else is signed in ink (no image).
    const MGMT = ["ceo", "coo", "cco"];
    const role = MGMT.includes(sigDoc.created_by_role ?? "")
      ? (sigDoc.created_by_role as string)
      : (sigDoc.doc_type === "INV" ? "ceo" : null);
    if (!role) return errorResponse("not_found", "This document is signed in ink", 404);
    const obj = await env.MEDIA.get(`private/signatures/${role}-sign.png`);
    if (!obj) return errorResponse("not_found", "Signature not on file", 404);
    return new Response(obj.body, {
      headers: { "Content-Type": "image/png", "Cache-Control": "no-store, private", "X-Robots-Tag": "noindex" },
    });
  }

  if (path === "/api/v1/auth/login" && method === "POST") {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.email, 200) || !isNonEmptyString(body.password, 200)) {
      return errorResponse("invalid_input", "email and password are required", 400);
    }
    const emailNorm = (body.email as string).toLowerCase().trim();
    /* v1.5.0: only FAILED attempts count (10 per account+IP, plus a looser
       per-IP ceiling of 30 for spray attacks). Successful sign-ins used to
       consume the same budget, so ten good logins from one office IP locked
       everyone behind that NAT out for 15 minutes. */
    const keyAcct = `login:${clientIp(request)}:${emailNorm}`;
    const keyIp = `loginip:${clientIp(request)}`;
    if (await isRateLimited(env, keyAcct, 10, 900) || await isRateLimited(env, keyIp, 30, 900)) {
      return errorResponse("rate_limited", "Too many attempts — try again in 15 minutes", 429);
    }
    const user = await env.DB.prepare(
      `SELECT id, email, name, role, password_hash FROM users
       WHERE email = ?1 AND is_active = 1
         AND COALESCE(employment_status, '') NOT IN ('resigned', 'terminated')`,
    )
      .bind(emailNorm)
      .first<SessionUser & { password_hash: string }>();

    /* v1.45.0 (security audit C5) — both answers must cost the same.
       When the email did not exist the old code skipped hashing entirely and
       returned in a fraction of the time, so anyone could tell a real staff
       address from an invented one by timing the 401 — a free list of who
       works here, and the first step of a targeted password attack. A
       non-existent account now pays for the same PBKDF2 work against a
       throwaway hash, and the two paths answer indistinguishably. */
    const okPassword = user
      ? await verifyPassword(body.password as string, user.password_hash, env.SESSION_PEPPER)
      : await verifyPassword(body.password as string, DUMMY_PASSWORD_HASH, env.SESSION_PEPPER).catch(() => false);
    if (!user || !okPassword) {
      await bumpRateLimit(env, keyAcct, 900);
      await bumpRateLimit(env, keyIp, 900);
      return errorResponse("invalid_credentials", "Email or password is incorrect", 401);
    }
    await resetRateLimit(env, keyAcct);

    // Two-factor (v1.4.37): the password alone does not create a session for
    // an account with 2FA on. Issue a short-lived challenge; the session is
    // minted only by POST /auth/2fa/verify with a valid code.
    const twofa = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(user.id).first<{ totp_enabled: number }>();
    if (twofa?.totp_enabled) {
      const challenge = crypto.randomUUID() + crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO twofa_challenges (id, user_id, expires_at)
         VALUES (?1, ?2, datetime('now', '+5 minutes'))`,
      ).bind(await sha256Hex(challenge), user.id).run();
      await audit(env, user.id, "auth.2fa_challenge");
      return json({ twofa_required: true, challenge }, 200);
    }

    const token = await createSession(env, user.id);
    await audit(env, user.id, "auth.login");

    return json(
      { user: { id: user.id, email: user.email, name: user.name, role: user.role } },
      200,
      sessionHeaders(token),
    );
  }

  /* ---- two-factor authentication (v1.4.37) ---- */

  if (path === "/api/v1/auth/2fa/verify" && method === "POST") {
    // v1.5.0: failed codes count, successful verifications do not.
    const key2fa = `2fa:${clientIp(request)}`;
    if (await isRateLimited(env, key2fa, 10, 900)) {
      return errorResponse("rate_limited", "Too many attempts — try again in 15 minutes", 429);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.challenge, 200) || !isNonEmptyString(body.code, 20)) {
      return errorResponse("invalid_input", "challenge and code are required", 400);
    }
    const id = await sha256Hex(body.challenge as string);
    const ch = await env.DB.prepare(
      `SELECT user_id, attempts FROM twofa_challenges
       WHERE id = ?1 AND expires_at > datetime('now')`,
    ).bind(id).first<{ user_id: number; attempts: number }>();
    if (!ch) return errorResponse("challenge_expired", "This sign-in attempt expired — start again", 401);
    if (ch.attempts >= 5) {
      await env.DB.prepare(`DELETE FROM twofa_challenges WHERE id = ?1`).bind(id).run();
      return errorResponse("too_many_attempts", "Too many incorrect codes — sign in again", 401);
    }
    const row = await env.DB.prepare(
      `SELECT id, email, name, role, totp_secret FROM users WHERE id = ?1 AND is_active = 1`,
    ).bind(ch.user_id).first<SessionUser & { totp_secret: string }>();
    if (!row?.totp_secret) return errorResponse("invalid_state", "Two-factor is not configured", 400);

    const code = (body.code as string).trim();
    // v1.45.0 (audit C6): the sign-in path burns the code it accepts, so the
    // same six digits cannot be replayed later in their window.
    let ok = await totpVerifyOnce(env, ch.user_id, row.totp_secret, code);
    if (!ok) {
      // Backup code path: single use. v1.5.0 codes are PBKDF2-hashed; codes
      // issued before that were unsalted SHA-256 — both formats verify, so
      // nobody's printed sheet dies with the upgrade.
      const codeNorm = code.toUpperCase();
      const { results: backups } = await env.DB.prepare(
        `SELECT id, code_hash FROM twofa_backup_codes WHERE user_id = ?1 AND used_at IS NULL`,
      ).bind(ch.user_id).all<{ id: number; code_hash: string }>();
      const legacyHash = await sha256Hex(codeNorm);
      for (const b of backups) {
        const match = b.code_hash.startsWith("pbkdf2$")
          ? await verifyPassword(codeNorm, b.code_hash, env.SESSION_PEPPER)
          : timingSafeEqual(b.code_hash, legacyHash);
        if (match) {
          await env.DB.prepare(`UPDATE twofa_backup_codes SET used_at = datetime('now') WHERE id = ?1`)
            .bind(b.id).run();
          await audit(env, ch.user_id, "auth.2fa_backup_used");
          ok = true;
          break;
        }
      }
    }
    if (!ok) {
      await env.DB.prepare(`UPDATE twofa_challenges SET attempts = attempts + 1 WHERE id = ?1`).bind(id).run();
      await bumpRateLimit(env, key2fa, 900);
      return errorResponse("invalid_code", "That code is not correct", 401);
    }
    await env.DB.prepare(`DELETE FROM twofa_challenges WHERE id = ?1`).bind(id).run();
    await resetRateLimit(env, key2fa);
    const token = await createSession(env, row.id);
    await audit(env, row.id, "auth.login_2fa");
    return json(
      { user: { id: row.id, email: row.email, name: row.name, role: row.role } },
      200,
      sessionHeaders(token),
    );
  }

  if (path === "/api/v1/auth/2fa/status" && method === "GET") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    const row = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(me.id).first<{ totp_enabled: number }>();
    const codes = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM twofa_backup_codes WHERE user_id = ?1 AND used_at IS NULL`,
    ).bind(me.id).first<{ n: number }>();
    return json({
      enabled: Boolean(row?.totp_enabled),
      eligible: TWOFA_ELIGIBLE(me.role),
      backup_codes_left: codes?.n ?? 0,
    });
  }

  if (path === "/api/v1/auth/2fa/setup" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    if (!TWOFA_ELIGIBLE(me.role)) {
      return errorResponse("forbidden", "Two-factor is available for staff accounts", 403);
    }
    const current = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(me.id).first<{ totp_enabled: number }>();
    if (current?.totp_enabled) {
      return errorResponse("already_enabled", "Two-factor is already enabled", 409);
    }
    // A fresh secret each time setup is opened; it only becomes active once a
    // code from it is verified in /enable.
    const secret = randomSecret();
    await env.DB.prepare(`UPDATE users SET totp_secret = ?1 WHERE id = ?2`).bind(secret, me.id).run();
    /* v1.27.0 — the authenticator label/issuer is A2Z CREATIVE MARKETING.
       SPLIT-BRAIN, ON PURPOSE: the issuer is a cosmetic caption the phone
       stores at ENROLMENT and never sends back, so it is not part of the
       TOTP computation and nothing re-keys. Staff who enrolled before this
       deploy keep seeing "AZ ONE OFFICIAL" in their app and their codes keep
       working; only new enrolments show A2Z. We deliberately do NOT force a
       re-enrolment to tidy this up: /2fa/disable requires a password, and
       Google-only accounts have none — asking them to re-enrol would strand
       them. Keep components/security/two-factor-panel.tsx's "Account name:"
       line in step with whatever this writes. */
    const label = encodeURIComponent(`A2Z CREATIVE MARKETING:${me.email}`);
    return json({
      secret,
      otpauth: `otpauth://totp/${label}?secret=${secret}&issuer=A2Z%20CREATIVE%20MARKETING&digits=6&period=30`,
    });
  }

  if (path === "/api/v1/auth/2fa/enable" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    if (!TWOFA_ELIGIBLE(me.role)) {
      return errorResponse("forbidden", "Two-factor is available for staff accounts", 403);
    }
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const row = await env.DB.prepare(`SELECT totp_secret FROM users WHERE id = ?1`)
      .bind(me.id).first<{ totp_secret: string | null }>();
    if (!row?.totp_secret) return errorResponse("invalid_state", "Start setup first", 400);
    /* v1.45.0 (audit C6): enrolment burns its code too — otherwise the code
       that switched 2FA on would still be replayable at the sign-in screen
       moments later. */
    if (!body || !isNonEmptyString(body.code, 20) || !(await totpVerifyOnce(env, me.id, row.totp_secret, body.code as string))) {
      return errorResponse("invalid_code", "That code is not correct — check the time on your phone and try again", 400);
    }
    await env.DB.prepare(`UPDATE users SET totp_enabled = 1 WHERE id = ?1`).bind(me.id).run();
    // Fresh backup codes; the plain values are returned exactly once.
    await env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(me.id).run();
    const codes = makeBackupCodes();
    for (const c of codes) {
      await env.DB.prepare(
        `INSERT INTO twofa_backup_codes (user_id, code_hash) VALUES (?1, ?2)`,
      ).bind(me.id, await createPasswordHash(c.toUpperCase(), env.SESSION_PEPPER)).run();
    }
    await audit(env, me.id, "auth.2fa_enabled");
    return json({ ok: true, backup_codes: codes });
  }

  if (path === "/api/v1/auth/2fa/disable" && method === "POST") {
    const me = await getSessionUser(request, env);
    if (!me) return errorResponse("unauthorized", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    // Disabling requires the current password — a stolen session alone
    // cannot strip the second factor off the account.
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(me.id).first<{ password_hash: string }>();
    if (!body || !isNonEmptyString(body.password, 200) || !row ||
        !(await verifyPassword(body.password as string, row.password_hash, env.SESSION_PEPPER))) {
      return errorResponse("invalid_credentials", "Your current password is required", 401);
    }
    await env.DB.prepare(`UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?1`).bind(me.id).run();
    await env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(me.id).run();
    await audit(env, me.id, "auth.2fa_disabled");
    return json({ ok: true });
  }

  if (path === "/api/v1/auth/logout" && method === "POST") {
    const raw = getCookie(request, SESSION_COOKIE);
    if (raw) {
      const tokenHash = await sha256Hex(raw);
      // v1.5.0: { all: true } signs out every device — a user who suspects a
      // stolen session can self-revoke without waiting for an admin.
      const bodyLo = (await request.json().catch(() => null)) as { all?: boolean } | null;
      if (bodyLo?.all) {
        const owner = await env.DB.prepare(`SELECT user_id FROM sessions WHERE id = ?1`)
          .bind(tokenHash).first<{ user_id: number }>();
        if (owner) {
          await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(owner.user_id).run();
          await audit(env, owner.user_id, "auth.logout_all");
        }
      } else {
        await env.DB.prepare(`DELETE FROM sessions WHERE id = ?1`).bind(tokenHash).run();
      }
    }
    // v1.5.0: the csrf_token cookie dies with the session — it used to
    // outlive it and be replayed against the next sign-in on this browser.
    return json({ ok: true }, 200, [
      ["Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`],
      ["Set-Cookie", `csrf_token=; Secure; SameSite=Lax; Path=/; Max-Age=0`],
    ]);
  }

  /* ---- one-time super admin bootstrap ---- */
  // Works ONLY while no super_admin exists AND with the SETUP_TOKEN secret.
  // No emails or passwords are hardcoded anywhere. Self-disables permanently.

  if (path === "/api/v1/auth/setup" && method === "POST") {
    const allowedSetup = await checkRateLimit(env, `setup:${clientIp(request)}`, 5, 3600);
    if (!allowedSetup) return errorResponse("rate_limited", "Too many attempts", 429);

    const existing = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'super_admin'`,
    ).first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      return errorResponse("gone", "Setup already completed", 410);
    }

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body || typeof body.token !== "string" || !env.SETUP_TOKEN ||
      !timingSafeEqual(body.token, env.SETUP_TOKEN)
    ) {
      return errorResponse("forbidden", "Invalid setup token", 403);
    }
    const emailOk =
      typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (
      !emailOk || !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) || (body.password as string).length < 10
    ) {
      return errorResponse("invalid_input", "email, name, and a password of 10+ characters are required", 400);
    }
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    const res = await env.DB.prepare(
      `INSERT INTO users (email, password_hash, name, role, is_active)
       VALUES (?1, ?2, ?3, 'super_admin', 1) RETURNING id`,
    )
      .bind((body.email as string).toLowerCase().trim(), hash, (body.name as string).trim())
      .first<{ id: number }>();
    await audit(env, res?.id ?? null, "auth.bootstrap_super_admin", "users", String(res?.id));
    const token = await createSession(env, res!.id);
    return json({ ok: true }, 201, sessionHeaders(token));
  }

  /* ---- self-registration (pending approval) ---- */

  if (path === "/api/v1/auth/register" && method === "POST") {
    const allowedReg = await checkRateLimit(env, `register:${clientIp(request)}`, 5, 3600);
    if (!allowedReg) return errorResponse("rate_limited", "Too many registrations — try again later", 429);

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const emailOk =
      body && typeof body.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(body.email);
    if (
      !body || !emailOk || !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) || (body.password as string).length < 10
    ) {
      return errorResponse("invalid_input", "Valid email, name, and a password of 10+ characters are required", 400);
    }
    const email = (body.email as string).toLowerCase().trim();
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      // Public registration = customer account, active immediately.
      // Customers can only ever see their own data; staff/admin roles are
      // assigned exclusively by a super admin, so this is safe by design.
      const res = await env.DB.prepare(
        `INSERT INTO users (email, password_hash, name, role, is_active)
         VALUES (?1, ?2, ?3, 'customer', 1) RETURNING id`,
      )
        .bind(email, hash, (body.name as string).trim())
        .first<{ id: number }>();
      await audit(env, res?.id ?? null, "auth.register_customer", "users", String(res?.id));
      const token = await createSession(env, res!.id);
      return json(
        { ok: true, user: { id: res!.id, email, name: (body.name as string).trim(), role: "customer" } },
        201,
        sessionHeaders(token),
      );
    } catch {
      return errorResponse("conflict", "An account with this email already exists", 409);
    }
  }

  /* ---- Google OAuth ---- */

  /* v1.29.0: the callback must match the host the sign-in STARTED on —
     Google verifies it exactly, and both domains' callbacks are registered
     in the console. A request from a host we do not serve falls back to the
     primary origin. Start and callback both derive it the same way, so the
     pair always agrees. */
  /* v1.29.1 — PRODUCTION OUTAGE FIX (error_log 19-08 19:09-19:24, six rows,
     all "url is not defined"). This line used to read `url.protocol`, but
     `url` is a local of fetch(); route() receives only (request, env, path).
     Nothing typechecks at deploy time — wrangler bundles with esbuild, which
     strips types without resolving them — so the bare identifier shipped and
     threw a ReferenceError on EVERY request whose handler sits BELOW this
     line: /auth/me, /staff/*, /health, and the 404 fall-through. Sign-in
     itself (line ~1947, above here) still succeeded, so the browser got its
     cookies and then /auth/me 500'd — the portal read that as "not signed
     in" and bounced back to /login. That is the login loop. Derive the
     origin from `request`, which route() actually has. */
  const selfUrl = new URL(request.url);
  const selfOrigin = `${selfUrl.protocol}//${selfUrl.host}`;
  const oauthBase = allowedOrigins(env).includes(selfOrigin) ? selfOrigin : primaryOrigin(env);
  const redirectUri = `${oauthBase}/api/v1/auth/google/callback`;

  if (path === "/api/v1/auth/google" && method === "GET") {
    const state = randomHex(16);
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", "openid email profile");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("prompt", "select_account");
    return new Response(null, {
      status: 302,
      headers: {
        Location: authUrl.toString(),
        "Set-Cookie": `${OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`,
      },
    });
  }

  if (path === "/api/v1/auth/google/callback" && method === "GET") {
    const url2 = new URL(request.url);
    const code = url2.searchParams.get("code");
    const state = url2.searchParams.get("state");
    const cookieState = getCookie(request, OAUTH_STATE_COOKIE);
    const clearState = `${OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;

    if (!code || !state || !cookieState || state !== cookieState) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    // Exchange code for tokens
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    const tokens = (await tokenRes.json().catch(() => null)) as { access_token?: string } | null;
    if (!tokenRes.ok || !tokens?.access_token) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    // Fetch verified profile
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = (await profileRes.json().catch(() => null)) as
      | { email?: string; email_verified?: boolean; name?: string }
      | null;
    if (!profileRes.ok || !profile?.email || profile.email_verified !== true) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?error=oauth", "Set-Cookie": clearState },
      });
    }

    const email = profile.email.toLowerCase().trim();
    let account = await env.DB.prepare(
      // v1.5.0: also carry employment_status so an offboarded staff member
      // cannot walk back in through Google.
      `SELECT id, is_active, employment_status FROM users WHERE email = ?1`,
    )
      .bind(email)
      .first<{ id: number; is_active: number; employment_status: string | null }>();

    if (!account) {
      // Every self-registration is a CUSTOMER — no exceptions (v1.4.35).
      // Google sign-up previously auto-assigned the "marketing" staff role to
      // company-domain emails; that was an unattended path into the staff
      // side. Staff and admin roles are now granted ONLY by explicit
      // assignment: /admin Users (admin tier) or HR staff creation. A staff
      // member who signs in with Google on an email an admin already
      // elevated keeps their assigned role — that path is unchanged.
      let res: { id: number; is_active: number; employment_status: string | null } | null = null;
      try {
        res = await env.DB.prepare(
          `INSERT INTO users (email, password_hash, name, role, is_active)
           VALUES (?1, 'oauth$google', ?2, 'customer', 1) RETURNING id, is_active, employment_status`,
        )
          .bind(email, profile.name ?? email)
          .first<{ id: number; is_active: number; employment_status: string | null }>();
      } catch (e) {
        throw new Error(`customer signup insert: ${e instanceof Error ? e.message : String(e)}`);
      }
      account = res!;
      await audit(env, null, "auth.google_signup_customer", "users", String(account.id));
    }

    if (!account.is_active ||
        ["resigned", "terminated"].includes(account.employment_status ?? "")) {
      return new Response(null, {
        status: 302,
        headers: { Location: "/admin?pending=1", "Set-Cookie": clearState },
      });
    }

    const roleRow = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(account.id).first<{ role: Role }>();

    /* v1.23.1 (CEO: "when my staff login using Google, there is no 2FA appear
       which is incorrect flow … it is supposed to follow my existing staff
       flow! this is something that you leak!"): Google used to mint a full
       session even when the account has 2FA ENABLED — a bypass of the exact
       control password sign-in enforces. Now: 2FA on → NO session; the same
       short-lived challenge as password login, handed to /login via a 5-min
       cookie, and the session is minted only by /auth/2fa/verify with a valid
       code. (Mandatory-role accounts NOT yet enrolled are still caught after
       sign-in by requires_2fa, which blocks the portal until setup — same as
       before, any sign-in method.) */
    const twofaG = await env.DB.prepare(`SELECT totp_enabled FROM users WHERE id = ?1`)
      .bind(account.id).first<{ totp_enabled: number }>();
    if (twofaG?.totp_enabled) {
      const challenge = crypto.randomUUID() + crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO twofa_challenges (id, user_id, expires_at)
         VALUES (?1, ?2, datetime('now', '+5 minutes'))`,
      ).bind(await sha256Hex(challenge), account.id).run();
      await audit(env, account.id, "auth.2fa_challenge");
      const h2 = new Headers({ Location: "/login?2fa=1" });
      h2.append("Set-Cookie", `twofa_challenge=${challenge}; Secure; SameSite=Lax; Path=/; Max-Age=300`);
      h2.append("Set-Cookie", clearState);
      return new Response(null, { status: 302, headers: h2 });
    }

    const dest =
      roleRow?.role === "customer" ? "/account"
      : ["super_admin", "admin"].includes(roleRow?.role ?? "")
        ? "/admin"
        : "/portal";
    const token = await createSession(env, account.id);
    await audit(env, account.id, "auth.login_google");
    const headers = new Headers({ Location: dest });
    for (const [k, v] of sessionHeaders(token) as [string, string][]) headers.append(k, v);
    headers.append("Set-Cookie", clearState);
    return new Response(null, { status: 302, headers });
  }

  /* ---- authenticated ---- */

  const user = await getSessionUser(request, env);

  if (path === "/api/v1/auth/change-password" && method === "POST") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (
      !body ||
      !isNonEmptyString(body.current_password, 200) ||
      !isNonEmptyString(body.new_password, 200) ||
      (body.new_password as string).length < 10
    ) {
      return errorResponse("invalid_input", "Current password and a new password of 10+ characters are required", 400);
    }
    const row = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(user.id)
      .first<{ password_hash: string }>();
    // Google-only accounts have no password to verify — and letting a hijacked
    // session ADD one would hand the attacker a permanent way in. They manage
    // credentials with Google.
    if (!row || row.password_hash.startsWith("oauth$")) {
      return errorResponse("google_account", "This account signs in with Google and has no password to change", 400);
    }
    const valid = await verifyPassword(body.current_password as string, row.password_hash, env.SESSION_PEPPER);
    if (!valid) return errorResponse("invalid_credentials", "Current password is incorrect", 401);
    const hash = await createPasswordHash(body.new_password as string, env.SESSION_PEPPER);
    await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, user.id).run();
    // Revoke every session (including any attacker's), then re-issue one for
    // this browser so the legitimate user is not logged out by their own change.
    await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(user.id).run();
    const fresh = await createSession(env, user.id);
    await audit(env, user.id, "auth.change_password");
    return json({ ok: true }, 200, sessionHeaders(fresh));
  }

  if (path === "/api/v1/auth/me" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    // v1.4.181: oauth = signs in with Google, has no password here. The
    // change-password route already refuses such accounts; this flag lets
    // the UI hide the pointless form instead of showing it with a footnote.
    const ph = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(user.id).first<{ password_hash: string }>();
    /* v1.26.2 (CEO's screenshot: "CSRF token mismatch or missing" on SAVE,
       which always sends the header): a browser can end up with a live
       session but no csrf_token cookie — the session cookie is HttpOnly and
       survives cookie cleanups that evict script-visible cookies; the csrf
       one is not. That state used to brick every save until re-login. Now
       /auth/me — hit on every page load and by the api() retry — re-issues
       a fresh csrf_token whenever it is missing. Safe: double-submit only
       requires cookie == header on the SAME request, not persistence. */
    const csrfHeaders: HeadersInit = getCookie(request, "csrf_token")
      ? {}
      : [["Set-Cookie", `csrf_token=${randomHex(16)}; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_HOURS * 3600}`]];
    return json({ user: { ...user, oauth: ph?.password_hash.startsWith("oauth$") ?? false } }, 200, csrfHeaders);
  }

  /* ---- staff portal (all routes require auth) ---- */

  if (path.startsWith("/api/v1/staff/")) {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    if (user.role === "customer") return errorResponse("forbidden", "Staff access only", 403);
    const sub = path.slice("/api/v1/staff".length);
    /* v1.105.0 (roadmap phase 03) - a queueable write with an Idempotency-Key
       runs once and answers the same way forever after (worker/src/outbox.ts).
       Every other request passes straight through. */
    const staffRes = await replayOrRun(env, request, user.id, sub, () => handleStaff(request, env, sub, user as StaffUser));
    /* v1.65.0 — THE ONE PLACE a write is noticed.
       Every staff mutation already passes through this line, so the version
       bump lives here rather than in three hundred route handlers. Putting it
       in each handler would mean every future route silently opting out of
       live updates by forgetting a call; here, a new route is live the day it
       is written and nobody has to remember anything.
       Only successful writes count: a rejected save changed nothing, and
       telling every open tab to reload after a 403 would be a lie plus a
       stampede. */
    /* v1.105.0 - a replayed answer changed nothing; telling every open tab to
       reload for it would be a stampede over a no-op. */
    if (staffRes && method !== "GET" && staffRes.status >= 200 && staffRes.status < 300 && !staffRes.headers.get(REPLAY_HEADER)) {
      await bumpVersion(env, topicOf(sub));
    }
    if (staffRes) return staffRes;
    return errorResponse("not_found", "Staff route not found", 404);
  }

  if (path === "/api/v1/enquiries" && method === "GET") {
    if (!user || !can(user.role, "enquiry_manage")) {
      return errorResponse("forbidden", "Business team access required", 403);
    }
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        `SELECT id, name, company, phone, email, message, category, status, reply, replied_at, assigned_to, created_at
         FROM enquiries ORDER BY created_at DESC LIMIT 100`,
      ).all()).results;
    } catch {
      results = (await env.DB.prepare(
        `SELECT id, name, company, phone, email, message, status, assigned_to, created_at
         FROM enquiries ORDER BY created_at DESC LIMIT 100`,
      ).all()).results;
    }
    return json({ enquiries: results });
  }

  if (path.match(/^\/api\/v1\/enquiries\/\d+$/) && method === "PATCH") {
    if (!user || !can(user.role, "enquiry_manage")) {
      return errorResponse("forbidden", "Business team access required", 403);
    }
    const id = path.split("/").pop()!;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const allowed = ["new", "contacted", "qualified", "closed"];
    const hasStatus = typeof body?.status === "string" && allowed.includes(body.status);
    /* v1.4.191 (CEO gap list): IN-APP REPLY — staff answer inside the portal
       and the customer reads it on /account. Sending a reply auto-marks the
       enquiry contacted (unless a further status is set in the same call). */
    const hasReply = typeof body?.reply === "string" && body.reply.trim() !== "";
    if (!body || (!hasStatus && !hasReply)) {
      return errorResponse("invalid_input", `Provide reply text and/or status (${allowed.join(", ")})`, 400);
    }
    if (hasReply) {
      try {
        await env.DB.prepare(
          `UPDATE enquiries SET reply = ?1, replied_by = ?2, replied_at = datetime('now'),
             status = COALESCE(?3, CASE WHEN status = 'new' THEN 'contacted' ELSE status END)
           WHERE id = ?4`,
        ).bind((body.reply as string).trim().slice(0, 2000), user.id, hasStatus ? body.status : null, id).run();
      } catch (e) {
        if (String(e).includes("no such column")) return errorResponse("migration_missing", "Run: npx wrangler d1 migrations apply azoneofficial --remote (0055_enquiry_reply)", 500);
        throw e;
      }
    } else {
      await env.DB.prepare(`UPDATE enquiries SET status = ?1 WHERE id = ?2`).bind(body.status, id).run();
    }
    await audit(env, user.id, "enquiry.update_status", "enquiries", id, { ...(hasStatus ? { status: body.status } : {}), ...(hasReply ? { replied: true } : {}) });
    return json({ ok: true });
  }

  /* v1.4.197 (CEO, from his LIVE Center screenshots: "I want to bring this
     data into my dashboard too, possible?"): TikTok Shop ANALYTICS — shop
     LIVE performance (GMV, viewers, likes, comments, shares, followers…)
     via GET /analytics/202508/shop_lives/overview_performance. Same signed
     API; needs the Data & Insights (Analytics) SCOPE granted + re-authorize
     — until then TikTok's own error message is surfaced honestly. LIVE
     Rewards (diamonds) is creator-side monetisation and is NOT in the Shop
     API — deliberately absent. Cached in system_meta for 30 min so staff
     views never hammer TikTok. Any signed-in staff role may read (same
     motivation principle as /staff/gmv). */
  if (path === "/api/v1/live-analytics" && method === "GET") {
    if (!user || user.role === "customer") return errorResponse("forbidden", "Staff access required", 403);
    // 30-min cache
    try {
      const cached = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'live_analytics_cache'`)
        .first<{ value: string }>();
      if (cached?.value) {
        const c = JSON.parse(cached.value) as { fetched_at: number; payload: unknown };
        if (Date.now() - c.fetched_at < 30 * 60 * 1000) return json({ cached: true, ...(c.payload as Record<string, unknown>) });
      }
    } catch { /* no cache / pre-0057 */ }
    const mytNow = new Date(Date.now() + 8 * 3600 * 1000);
    const end = new Date(mytNow.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10); // end_date_lt is exclusive
    const start = new Date(mytNow.getTime() - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    /* v1.64.0 — THE FIX FOR THIS CARD.
       Until now this called /analytics/202508/shop_lives/overview_performance,
       which answers 36009003 "Internal error" in every parameter shape the
       28-08 probe tried. That is why this card has never shown a number: not
       a scope problem, not our parameters — that endpoint does not open.
       The same figures live in shop_lives/performance @202509, one row per
       LIVE with its own sales_performance and interaction_performance, and
       that endpoint answers. So the card now adds those rows up. */
    const live = await ttAnalytics(env, TT_ANALYTICS.lives, "shop_lives",
                                   { page_size: "50" }, { start_date_ge: start, end_date_lt: end });
    if (!live.ok) return json({ error: live.why });
    const data = { data: live.data } as { code?: number; message?: string; data?: Record<string, unknown> };
    /* v1.64.0 — SUM, do not take the first.
       The old reader stopped at the first value it found for each metric,
       which was right when the payload was one overview object. It is now a
       LIST of lives, and "the GMV of the first live" is not "GMV". Each row
       is added up instead, and only metrics that are meaningful to add are
       (ttAccumulate) — summing a click-through rate would produce a number
       that looks like data and is nonsense. */
    const metrics: Record<string, number> = {};
    const liveRows = ttRows(data.data);
    ttAccumulate(liveRows, metrics, 0);
    /* How many LIVEs those totals came from — without it "RM 4,200" has no
       denominator and nobody can tell one good session from six poor ones. */
    if (liveRows.length > 0) metrics.live_count = liveRows.length;
    if (Object.keys(metrics).length === 0) {
      await logError(env, "tiktok_live_analytics",
        `no known metrics; ${liveRows.length} live row(s); row keys=[${Object.keys(liveRows[0] ?? {}).join(",")}]`);
    }
    const payload = { metrics, range: { start, end }, fetched_at_myt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ") };
    try {
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES ('live_analytics_cache', ?1)
         ON CONFLICT (key) DO UPDATE SET value = ?1`,
      ).bind(JSON.stringify({ fetched_at: Date.now(), payload })).run();
    } catch { /* pre-0057 — uncached is fine */ }
    return json(payload);
  }

  /* ---- TikTok Shop Analytics, the whole panel in one call (v1.64.0) ----
     The CEO wants GMV, orders, units, buyers, visitors, views and CTR, split
     by video, LIVE and product card. Seven endpoints answer; this reads all
     of them once, caches for 30 minutes, and returns what came back.

     Two rules it keeps, both learned the hard way on this integration:

       1. A section that did not answer is NAMED, never drawn as zero. A zero
          is a claim about the business; "TikTok refused this, here is what
          they said" is the truth. `unavailable` carries those reasons.
       2. Rates are never summed. CTR is recomputed from totals where it is
          shown at all, because adding up percentages is how a dashboard
          starts lying quietly.

     Permission is `revenue_view`: this is per-product and per-video revenue,
     which is the same class of data as /staff/revenue, not the motivational
     shop-wide GMV any staff member may see. */
  if (path === "/api/v1/tiktok-analytics" && method === "GET") {
    if (!user || !can(user.role, "revenue_view")) {
      return errorResponse("forbidden", "Revenue access required", 403);
    }
    const qDays = Number(new URL(request.url).searchParams.get("days"));
    const days = qDays === 1 || qDays === 30 ? qDays : 7;
    /* v1.70.2 - same reason as the name map: cached payloads carry rounded
       ids in every row. A new key makes the first request after the deploy
       correct, rather than correct in thirty minutes. */
    const cacheKey = `tiktok_analytics_cache_v2_${days}`;
    const fresh = new URL(request.url).searchParams.get("fresh") === "1";
    if (!fresh) {
      try {
        const cached = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = ?1`)
          .bind(cacheKey).first<{ value: string }>();
        if (cached?.value) {
          const c = JSON.parse(cached.value) as { fetched_at: number; payload: Record<string, unknown> };
          if (Date.now() - c.fetched_at < 30 * 60 * 1000) return json({ cached: true, ...c.payload });
        }
      } catch { /* no cache yet */ }
    }

    /* v1.64.1 — the window that shop/performance will actually accept.
       The first build asked for end_date_lt = TOMORROW, to include today's
       sales. The four list endpoints allowed it; shop/performance answered
       36009003 both times, which is the code TikTok returns for a rejected
       parameter as readily as for a real fault. The probe, which has always
       worked, asks for end_date_lt = TODAY.
       So today is tried FIRST for the totals, because a working figure for a
       closed window beats an internal error for an open one, and tomorrow is
       tried after — if TikTok accepts it, today's sales are included and the
       window reported to the panel says so. */
    const myt = new Date(Date.now() + 8 * 3600 * 1000);
    const dayStr = (d: Date) => d.toISOString().slice(0, 10);
    const startOf = (back: number) => dayStr(new Date(myt.getTime() - back * 86400_000));
    const today = dayStr(myt);
    const tomorrow = dayStr(new Date(myt.getTime() + 86400_000));
    /* days=1 has to run to tomorrow or the window is empty: start today, end
       today is zero days wide. The others fall back happily. */
    const firstEnd = days === 1 ? tomorrow : today;
    const ends = days === 1 ? [tomorrow] : [today, tomorrow];
    const range = { start_date_ge: startOf(days - 1), end_date_lt: firstEnd };
    const unavailable: { what: string; why: string }[] = [];

    /* Serial, not parallel. The first build fired all six at once and the
       two that failed were the two hitting the SAME resource (shop, ALL and
       1D) in the same instant. Six sequential calls cost a few seconds once
       every thirty minutes, which is a price worth paying for figures that
       arrive. */
    const shopAll = await ttAnalyticsWindow(env, TT_ANALYTICS.shop, "shop",
                                            { granularity: "ALL" }, range.start_date_ge, ends);
    const shopDaily = await ttAnalyticsWindow(env, TT_ANALYTICS.shop, "shop",
                                              { granularity: "1D" }, range.start_date_ge, ends);
    /* Products and SKUs: the newer version first, because 202405 returns an
       id and no name — which is why every product row read "-". If 202509
       does not exist for this resource TikTok says so on the version, and
       the known-good version answers on the second try. */
    const products = await ttAnalyticsVersions(env, ["202509", TT_ANALYTICS.products],
                                               "shop_products", { page_size: "20" }, range);
    const skus = await ttAnalyticsVersions(env, [TT_ANALYTICS.skus, "202405"],
                                           "shop_skus", { page_size: "20" }, range);
    const videos = await ttAnalytics(env, TT_ANALYTICS.videos, "shop_videos", { page_size: "20" }, range);
    const lives = await ttAnalytics(env, TT_ANALYTICS.lives, "shop_lives", { page_size: "20" }, range);


    const usedEnd = shopAll.ok ? (shopAll.end ?? range.end_date_lt) : range.end_date_lt;

    const shop: Record<string, number> = {};
    let shopOk = false;
    if (shopAll.ok) { ttAccumulate(shopAll.data, shop, 0); shopOk = true; }
    else unavailable.push({ what: "Shop totals", why: shopAll.why ?? "refused" });

    /* The daily series drives the trend strip. Each bucket is summed on its
       own so one bad day cannot be hidden inside a week's total. */
    const daily: { date: string; gmv: number; orders: number }[] = [];
    if (shopDaily.ok) {
      for (const row of ttRows(shopDaily.data)) {
        const m: Record<string, number> = {};
        ttAccumulate(row, m, 0);
        const date = String(row.date ?? row.day ?? row.start_date ?? "").slice(0, 10);
        if (date) daily.push({ date, gmv: m.gmv ?? 0, orders: m.orders ?? m.sku_orders ?? 0 });
      }
      daily.sort((a, b) => a.date.localeCompare(b.date));
    } else {
      unavailable.push({ what: "Daily breakdown", why: shopDaily.why ?? "refused" });
    }

    /* Per-row readers. Field names below are the ones the probe actually saw
       come back, with `??` chains only where a version genuinely uses a
       different name for the same thing. */
    const num = (v: unknown): number => {
      if (typeof v === "number" && Number.isFinite(v)) return v;
      if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
      if (v && typeof v === "object" && "amount" in (v as Record<string, unknown>)) {
        const a = (v as { amount?: unknown }).amount;
        if (a !== undefined && a !== null && Number.isFinite(Number(a))) return Number(a);
      }
      return 0;
    };
    /* v1.64.1: a NUMBER is text too. TikTok returns product and SKU ids as
       numbers, the first build only accepted strings, and every product row
       in the panel therefore read "-" — an id is a poor label but it is not
       nothing, and it is what lets a row be looked up. */
    const txt = (v: unknown, max = 120): string | null => {
      if (typeof v === "string" && v.trim() !== "") return v.slice(0, max);
      if (typeof v === "number" && Number.isFinite(v)) return String(v);
      return null;
    };
    /* Whatever this row is called, in whichever version answered. */
    const nameOf = (r: Record<string, unknown>): string | null =>
      txt(r.title) ?? txt(r.name) ?? txt(r.product_name) ?? txt(r.sku_name);
    const byGmv = <T extends { gmv: number }>(rows: T[]): T[] =>
      rows.sort((a, b) => b.gmv - a.gmv);

    /* v1.64.4 — the rows are built FIRST, without names, so the name map can
       be asked about the ids that are actually going on screen. Fetching the
       names before knowing what they are for is what let v1.64.2 declare
       success on a map that covered none of these rows. */
    const rawProducts = products.ok ? byGmv(ttRows(products.data).map((r) => ({
      id: txt(r.id, 40), title: nameOf(r),
      gmv: num(r.gmv), orders: num(r.orders ?? r.sku_orders),
      units_sold: num(r.units_sold ?? r.items_sold),
      click_through_rate: num(r.click_through_rate),
    }))) : [];
    if (!products.ok) unavailable.push({ what: "Product cards", why: products.why ?? "refused" });

    const rawSkus = skus.ok ? byGmv(ttRows(skus.data).map((r) => ({
      id: txt(r.id, 40), product_id: txt(r.product_id, 40), title: nameOf(r),
      gmv: num(r.gmv), sku_orders: num(r.sku_orders ?? r.orders),
      units_sold: num(r.units_sold ?? r.items_sold),
    }))) : [];
    if (!skus.ok) unavailable.push({ what: "Variants", why: skus.why ?? "refused" });

    const wantProducts = [...new Set([
      ...rawProducts.filter((r) => !r.title).map((r) => r.id),
      ...rawSkus.map((r) => r.product_id),
    ])].filter((v): v is string => !!v);
    const wantSkus = [...new Set(rawSkus.filter((r) => !r.title).map((r) => r.id))]
      .filter((v): v is string => !!v);
    const names = await ttNameMap(env, fresh, wantProducts, wantSkus);

    const productRows = rawProducts.map((r) => ({
      ...r, title: r.title ?? (r.id ? names.products[r.id] ?? null : null),
    }));

    /* A variant row needs BOTH names to mean anything: "Mocha" alone says
       nothing, and the product title alone does not say which size sold. */
    const skuRows = rawSkus.map((r) => ({
      ...r,
      title: r.title ?? (r.id ? names.variants[r.id] ?? null : null),
      product_name: (r.product_id ? names.products[r.product_id] : null)
        ?? (r.id ? names.skuProduct[r.id] : null) ?? null,
    }));

    /* The warning is decided by what is STILL unnamed on screen, not by
       whether the map came back empty.

       v1.64.5 — and it is written as an INSTRUCTION, not as a paste of
       TikTok's error. Their reply was correct and completely unactionable in
       the place it appeared: the same 300-character scope paragraph twice,
       ending in a shortlink, above a table of numbers. What the reader needs
       is the one sentence that changes the outcome. */
    const unnamed = productRows.filter((r) => !r.title).length
      + skuRows.filter((r) => !r.title && !r.product_name).length;
    if (unnamed > 0) {
      /* Identical replies from two endpoints are one fact, not two. */
      const notes = [...new Set(names.notes)];
      const scopeDenied = notes.some((t) => /access denied|scope/i.test(t));
      const rows = `${unnamed} row${unnamed === 1 ? "" : "s"}`;
      /* v1.70.1 — a product that no longer exists is not an error.
         TikTok answers a lookup for a deleted product with "Precondition
         Required. This operation requires an existing product ID", and
         quoting that at the CEO reads like something is broken and something
         must be done. Nothing is broken and there is nothing to do: the item
         sold, then it was archived. Say THAT. */
      const goneRows = names.gone.length > 0
        && skuRows.filter((r) => !r.title && !r.product_name)
             .every((r) => !r.product_id || names.gone.includes(r.product_id));
      let why: string;
      if (goneRows && !scopeDenied) {
        why = `${rows} are products that are no longer in your TikTok catalogue — they sold, then were deleted or archived, so only their id remains. Nothing to fix.`;
      } else if (scopeDenied) {
        /* v1.70.0 — SHORT. The first version of this said the same thing in
           three times the words, and at the top of a card it read as a wall
           rather than an instruction: a warning nobody finishes reading is a
           warning that does not work. One sentence for what is wrong, one
           for what to do. The reasoning that led here lives in the
           changelog, not above the numbers. */
        why = `${rows} show a TikTok id: this app has no PRODUCT scope, so the catalogue cannot be read. `
          + `Fix: Partner Center -> your app -> add the product scope -> re-authorize the shop -> Refresh.`;
      } else {
        const said = notes.length > 0 ? ` TikTok said — ${notes.join("; ")}.` : "";
        const got = names.sources.length > 0
          ? ` Names did come from: ${names.sources.join(", ")}.` : "";
        why = `${rows} could not be named, so they show their TikTok id.${got}${said}`;
      }
      /* The id-space check, in one clause: if orders answered and the rows
         are still unnamed, either the ids differ or the sale is older than
         the harvest. Showing one of each settles which. */
      /* The id comparison is diagnosis, not instruction. It belongs in the
         diagnostic panel with the build number and the source counts, not
         in the amber block a person reads while trying to price a shawl. */
      let idNote: string | undefined;
      if (names.sources.includes("orders")) {
        const gotSku = ttSampleId(names.variants) || ttSampleId(names.skuProduct);
        const gotProd = ttSampleId(names.products);
        const wantSku = wantSkus[0] ?? "";
        const wantProd = wantProducts[0] ?? "";
        const missSku = wantSku && !names.variants[wantSku] && !names.skuProduct[wantSku];
        const missProd = wantProd && !names.products[wantProd];
        if (missSku || missProd) {
          idNote = `orders carry${gotSku ? ` sku ${gotSku}` : ""}${gotProd ? ` product ${gotProd}` : ""}`
            + `; this page wants${wantSku ? ` sku ${wantSku}` : ""}${wantProd ? ` product ${wantProd}` : ""}`;
        }
      }
      unavailable.push({ what: "Product names", why });
      if (idNote) names.notes.push(idNote);
    }

    const videoRows = videos.ok ? byGmv(ttRows(videos.data).map((r) => {
      /* A video's sales figures moved into a nested object between 202409
         and 202509, so they are accumulated as well as read directly: the
         direct read wins when it is there, the sum catches the nesting. */
      const m: Record<string, number> = {};
      ttAccumulate(r, m, 0);
      return {
        id: txt(r.id, 40), title: nameOf(r), username: txt(r.username, 60),
        gmv: num(r.gmv) || (m.gmv ?? 0),
        sku_orders: num(r.sku_orders) || (m.orders ?? m.sku_orders ?? 0),
        units_sold: num(r.items_sold ?? r.units_sold) || (m.units_sold ?? m.items_sold ?? 0),
        views: num(r.views) || (m.views ?? 0),
        click_through_rate: num(r.click_through_rate),
        posted_at: txt(r.video_post_time, 40),
      };
    })) : [];
    if (!videos.ok) unavailable.push({ what: "Videos", why: videos.why ?? "refused" });

    /* A LIVE's numbers arrive nested in sales_performance /
       interaction_performance, so each row is accumulated rather than read
       field by field — the nesting has already changed once between
       versions. */
    const liveRows = lives.ok ? byGmv(ttRows(lives.data).map((r) => {
      const m: Record<string, number> = {};
      ttAccumulate(r, m, 0);
      return {
        id: txt(r.id, 40), title: nameOf(r), username: txt(r.username, 60),
        start_time: txt(r.start_time, 40), end_time: txt(r.end_time, 40),
        gmv: m.gmv ?? 0, orders: m.orders ?? m.sku_orders ?? 0,
        units_sold: m.units_sold ?? m.items_sold ?? 0, views: m.views ?? 0,
      };
    })) : [];
    if (!lives.ok) unavailable.push({ what: "LIVE sessions", why: lives.why ?? "refused" });

    /* v1.64.1 — when TikTok will not give the shop totals, the panel used to
       fall back to four zeroed tiles beside an amber warning, which is the
       exact thing this panel promised never to do: a zero is a claim that
       nobody bought. `shop_ok` lets the UI draw a dash instead.
       The totals are NOT derived from the rows below, tempting as it is:
       product, video and LIVE figures are attributed views of the same
       sales, so adding them up would double-count and produce a confident
       wrong number, which is worse than a dash. */
    const payload = {
      window: { start_date_ge: range.start_date_ge, end_date_lt: usedEnd, days },
      /* v1.70.0 — which of the shop tiles TikTok actually SENT. "Buyers 0"
         beside "3 orders" is not a fact about the shop, it is the panel
         inventing a number for a field that never arrived — the same sin as
         drawing zeros for a refused section, one tile smaller. */
      shop_has: {
        gmv: shop.gmv !== undefined,
        orders: shop.orders !== undefined || shop.sku_orders !== undefined,
        units: shop.units_sold !== undefined || shop.items_sold !== undefined,
        buyers: shop.buyers !== undefined || shop.unique_buyers !== undefined || shop.customers !== undefined,
      },
      /* v1.64.4: the build that produced this reply. The API deploy has been
         stuck before, and "is the fix live?" should be answerable from the
         panel rather than by reading a changelog and hoping. */
      worker_version: WORKER_VERSION,
      names: { sources: names.sources, notes: names.notes,
               products: Object.keys(names.products).length,
               variants: Object.keys(names.variants).length },
      shop, shop_ok: shopOk, daily,
      products: productRows, skus: skuRows, videos: videoRows, lives: liveRows,
      unavailable,
      fetched_at_myt: new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " "),
    };
    try {
      await env.DB.prepare(
        `INSERT INTO system_meta (key, value) VALUES (?1, ?2)
         ON CONFLICT (key) DO UPDATE SET value = ?2`,
      ).bind(cacheKey, JSON.stringify({ fetched_at: Date.now(), payload })).run();
    } catch { /* uncached is fine */ }
    return json({ cached: false, ...payload });
  }

  /* v1.4.191 (CEO gap list): OFF-CLOUDFLARE EXPORT — stream the newest R2
     backup for download so a copy lives OUTSIDE this Cloudflare account
     (ransomware / account-loss insurance). Records the export moment in
     system_meta so /admin can nag when a quarter passes. */
  /* v1.4.265 (CEO: "no uptime monitor — staff will tell you the portal is
     down before anything else does"): the endpoint an EXTERNAL monitor pings.
     Unauthenticated ON PURPOSE — a monitor cannot sign in — and it leaks
     nothing: a static ok plus one cheap DB probe, so it distinguishes "worker
     up, database down" from "all up". The monitor itself must live OUTSIDE
     Cloudflare (UptimeRobot etc.) — a system cannot report its own outage. */
  if (path === "/api/v1/health" && method === "GET") {
    let db = false;
    try { await env.DB.prepare(`SELECT 1`).first(); db = true; } catch { /* db unreachable */ }
    /* v1.23.5: version in the public probe — one glance (or one fetch)
       answers "which build is the WORKER on?" the same way the site's
       visible stamp answers it for the pages. */
    /* v1.38.0: + the ELFIA bridge block, mirroring the store's own health
       probe (its checklist step 4 reads ours the same way it reads theirs).
       Configuration booleans and two timestamps — nothing sensitive. */
    /* v1.39.0 (AUDIT minor): configuration booleans only, computed from
       env — no DB work and no business-activity timestamps on the one
       endpoint anyone on the internet can hammer. */
    const elfia_bridge = bridgeHealth(env);
    return new Response(JSON.stringify({ ok: db, db, version: WORKER_VERSION, elfia_bridge }), {
      status: db ? 200 : 503,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  }

  if (path === "/api/v1/system/backup/download" && method === "GET") {
    if (!atLeast(user, "super_admin")) return errorResponse("forbidden", "Super admin required", 403);
    const listed = await env.MEDIA.list({ prefix: "backups/" });
    const newest = listed.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
    if (!newest) return errorResponse("not_found", "No backup exists yet — press Back up now first", 404);
    const obj = await env.MEDIA.get(newest.key);
    if (!obj) return errorResponse("not_found", "Backup object missing", 404);
    /* v1.45.0 (security audit C11) — this is a GET, and GETs are outside the
       CSRF check by design. The session cookie is SameSite=Lax, which IS sent
       on a top-level cross-site navigation, so a super admin lured to a link
       would silently stamp this timestamp. Nothing leaks (the attacker never
       sees the response) but a bookkeeping row would lie about when the last
       export happened. The stamp now rides the RECORDED fact instead: the
       audit row, which is written either way, is the honest source. The
       X-Offsite-Export header lets the admin page update its own display
       after a real download. */
    const exportedAt = new Date().toISOString().slice(0, 19).replace("T", " ");
    if (request.headers.get("Sec-Fetch-Mode") !== "navigate") {
      /* A same-origin fetch() from the admin page — a deliberate download,
         not a lured navigation. Only that stamps the timestamp. */
      try {
        await env.DB.prepare(
          `INSERT INTO system_meta (key, value) VALUES ('last_offsite_export', datetime('now'))
           ON CONFLICT (key) DO UPDATE SET value = datetime('now')`,
        ).run();
      } catch { /* pre-0057 — download still works */ }
    }
    await audit(env, user.id, "system.backup_export", "system", newest.key);
    return new Response(obj.body, {
      headers: {
        "Content-Type": "application/gzip",
        "Content-Disposition": `attachment; filename="${newest.key.split("/").pop()}"`,
        "X-Offsite-Export": exportedAt,
      },
    });
  }

  /* ---- system health (v1.4.72): error log + backup status ---- */

  if (path === "/api/v1/system/health" && method === "GET") {
    if (!atLeast(user, "ceo")) return errorResponse("forbidden", "Admin or CEO required", 403);
    let errors: unknown[] = [];
    try {
      const { results } = await env.DB.prepare(
        `SELECT id, created_at, source, message, path FROM error_log ORDER BY id DESC LIMIT 20`,
      ).all();
      errors = results;
    } catch { /* migration 0024 not applied yet — show empty rather than fail */ }
    let last_backup: { key: string; size: number; uploaded: string } | null = null;
    try {
      const listed = await env.MEDIA.list({ prefix: "backups/" });
      const newest = listed.objects.sort((a, b) => b.key.localeCompare(a.key))[0];
      if (newest) last_backup = { key: newest.key, size: newest.size, uploaded: newest.uploaded.toISOString() };
    } catch { /* keep null */ }
    let last_offsite: string | null = null;
    try {
      const meta = await env.DB.prepare(`SELECT value FROM system_meta WHERE key = 'last_offsite_export'`)
        .first<{ value: string }>();
      last_offsite = meta?.value ?? null;
    } catch { /* pre-0057 */ }
    /* v1.4.265 (CEO's deploy discipline gap — one wrong-order deploy already
       blanked the staff directory in v1.4.218): probe one marker column per
       recent migration and NAME the ones the database is missing, with the
       exact command. The card turns this red; nobody has to remember. */
    const migrations_pending: string[] = [];
    const probes: [string, string][] = [
      ["0059 (staff profile columns)", `SELECT address FROM users LIMIT 1`],
      ["0060 (document kind)", `SELECT kind FROM sales_documents LIMIT 1`],
      ["0062 (reference / delivery address)", `SELECT reference FROM sales_documents LIMIT 1`],
      ["0063 (customer share links)", `SELECT share_token FROM sales_documents LIMIT 1`],
      ["0064 (stock movement direction)", `SELECT direction FROM manual_stockouts LIMIT 1`],
      ["0065 (invoice stock link)", `SELECT doc_id FROM manual_stockouts LIMIT 1`],
      // v1.4.277: the newer migrations join the probe — the card must name
      // the FULL pending set, not the set that existed when it was written.
      ["0066 (prospects)", `SELECT id FROM prospects LIMIT 1`],
      ["0067 (growth pack)", `SELECT referred_by FROM prospects LIMIT 1`],
      // v1.6/v1.7: the newer migrations join the probe set (standing rule).
      ["0068 (targets / commission / push)", `SELECT id FROM commission_rules LIMIT 1`],
      ["0069 (stokis / content / receipts)", `SELECT id FROM stokis LIMIT 1`],
      ["0070 (selfie clock-in)", `SELECT selfie_key FROM attendance_records LIMIT 1`],
      ["0071 (ERP core)", `SELECT id FROM gl_accounts LIMIT 1`],
      ["0072 (geofence seed)", `SELECT value FROM system_meta WHERE key = 'attendance_geofence' LIMIT 1`],
      ["0073 (document issuer)", `SELECT issuer_code FROM sales_documents LIMIT 1`],
      ["0074 (client brand)", `SELECT website, logo_key FROM customers LIMIT 1`],
      // v1.39.0 (AUDIT M16: 0075–0078 missed this list and the pending
      // banner stayed dark on a database missing four migrations — the
      // standing rule has THREE places, not two)
      ["0075-0077 (ELFIA bridge pricing)", `SELECT bridge_enabled, elfia_price_cents FROM inventory_items LIMIT 1`],
      ["0078 (bridge movements + stock ledger)", `SELECT id FROM bridge_events LIMIT 1`],
      ["0079-0080 (SKU match key)", `SELECT sku_key FROM inventory_items LIMIT 1`],
      ["0081 (web orders)", `SELECT id FROM web_orders LIMIT 1`],
      ["0083 (task scope + tracking)", `SELECT id FROM task_items LIMIT 1`],
      ["0084 (ELFIA traffic)", `SELECT day FROM web_traffic_daily LIMIT 1`],
      ["0085 (marketing consent)", `SELECT marketing_consent FROM web_orders LIMIT 1`],
      ["0086 (2FA replay guard)", `SELECT totp_last_step FROM users LIMIT 1`],
      ["0086 (ELFIA product fields)", `SELECT elfia_image_key FROM inventory_items LIMIT 1`],
      ["0087 (ELFIA discount + carousel)", `SELECT id FROM elfia_slides LIMIT 1`],
      ["0088 (ELFIA slide framing)", `SELECT focus_x FROM elfia_slides LIMIT 1`],
      ["0089 (ELFIA slide zoom)", `SELECT zoom FROM elfia_slides LIMIT 1`],
      ["0090 (ELFIA slide cut-out)", `SELECT cutout_key FROM elfia_slides LIMIT 1`],
      /* v1.63.0 — 0091/0092 shipped unprobed, so a database missing them
         would have shown a green banner while leave adjustments silently
         failed. The standing rule has THREE places, not two. */
      ["0091 (leave adjust)", `SELECT adjust FROM leave_balances LIMIT 1`],
      ["0092 (leave used adjust)", `SELECT used_adjust FROM leave_balances LIMIT 1`],
      ["0093 (ELFIA flash sale)", `SELECT elfia_flash_until FROM inventory_items LIMIT 1`],
      ["0094 (live card versions)", `SELECT topic, v FROM data_versions LIMIT 1`],
      ["0095 (task blocks on the roster)", `SELECT task_id, block_date FROM task_blocks LIMIT 1`],
      ["0096 (a block records its day)", `SELECT done_at FROM task_blocks LIMIT 1`],
      ["0097 (unpaid day recorded by management)", `SELECT recorded_direct FROM leave_requests LIMIT 1`],
      ["0098 (courier tracking link on a web order)", `SELECT tracking_url FROM web_orders LIMIT 1`],
      ["0099 (working-hour schedules)", `SELECT name, mon_start FROM shift_patterns LIMIT 1`],
      ["0100 (a forgotten punch waits for approval)", `SELECT pending_approval FROM attendance_records LIMIT 1`],
      ["0101 (a rest day worked, credited as leave)", `SELECT work_date, days FROM replacement_credits LIMIT 1`],
      ["0102 (a working day in two blocks)", `SELECT mon_start2, fri_end2 FROM shift_patterns LIMIT 1`],
      ["0103 (an unpaid break comes off the day)", `SELECT break_minutes FROM shift_patterns LIMIT 1`],
      ["0105 (the Threads connection)", `SELECT threads_user_id, username FROM threads_accounts LIMIT 1`],
      ["0106 (study cases - what others post)", `SELECT label, query FROM threads_topics LIMIT 1`],
      ["0107 (what a connected account may do)", `SELECT granted_scopes FROM threads_accounts LIMIT 1`],
      ["0108 (which harvested posts read as Malaysian)", `SELECT my_signal, my_reasons FROM threads_topic_posts LIMIT 1`],
      ["0109 (asking or selling, and a note on the last run)", `SELECT intent, (SELECT last_note FROM threads_topics LIMIT 1) AS n FROM threads_topic_posts LIMIT 1`],
      /* 0110 DROPS tables, so no query can fail for want of it; the probe reads
         the index it adds, which is the one thing it creates. */
      ["0110 (Threads keeps a week, not an archive)", `SELECT found_at FROM threads_topic_posts INDEXED BY idx_threads_topic_posts_found LIMIT 1`],
      ["0111 (the hotel directory)", `SELECT state, hotel_name FROM hotels LIMIT 1`],
      ["0112 (the hotel list, seeded)", `SELECT person_name, phone FROM hotel_contacts LIMIT 1`],
      ["0113 (who reports to whom)", `SELECT reports_to FROM users LIMIT 1`],
      ["0114 (the outbox)", `SELECT key FROM idempotency_keys LIMIT 1`],
    ];
    for (const [label, probe] of probes) {
      try { await env.DB.prepare(probe).first(); } catch (e) {
        const msg = String(e);
        if (msg.includes("no such column") || msg.includes("no such table")) migrations_pending.push(label);
      }
    }
    /* v1.4.282 (auditor pick 1: "migration health page — show which
       migrations are applied/missing instead of relying on runtime errors"):
       wrangler records every applied migration in d1_migrations — read it
       and compare against the compile-time list of ALL migrations this
       build ships. This list MUST gain a line with every new migration
       (same standing rule as the probes above). */
    const EXPECTED_MIGRATIONS = [
      "0001_init",
      "0002_rate_limits",
      "0003_staff_portal",
      "0004_customer_role",
      "0005_doc_numbering_daily",
      "0006_multi_tenant",
      "0007_role_modules",
      "0008_expand_role_check",
      "0009_role_cleanup",
      "0010_leave_chain_and_badge",
      "0011_holidays",
      "0012_full_name",
      "0013_staff_photo",
      "0014_attendance_manual",
      "0015_postage_stock_link",
      "0016_postage_multi_items",
      "0017_payroll",
      "0018_two_factor",
      "0019_bank_join",
      "0020_tiktok_tokens",
      "0021_employment_status_values",
      "0022_ic_number",
      "0023_buyer_city",
      "0024_error_log",
      "0025_events",
      "0026_claims_revenue",
      "0027_base_salary",
      "0028_payslip_release",
      "0029_johor_holidays_2026",
      "0030_payroll_worked_days",
      "0031_payroll_ot",
      "0032_expenses",
      "0033_expenses_due",
      "0034_payments_targets",
      "0035_salesperson",
      "0036_claim_items",
      "0037_lifecycle_money",
      "0038_claim_chain",
      "0039_claim_payment_proof",
      "0040_hari_hol_not_observed_july",
      "0041_payroll_net_cents",
      "0042_supplier_returns",
      "0043_supplier_return_replacement",
      "0044_overtime",
      "0045_delivery_fee",
      "0046_live_rebate",
      "0047_unit_sale_price",
      "0048_manual_sales",
      "0049_manual_stockouts",
      "0050_manual_out_lifecycle",
      "0051_claim_payee",
      "0052_enquiry_category",
      "0053_hourly_payroll",
      "0054_ot_approval",
      "0055_enquiry_reply",
      "0056_live_sessions",
      "0057_staff_docs_vault",
      "0058_assets",
      "0059_staff_profile_fields",
      "0060_doc_conversion_link",
      "0061_doc_kind",
      "0062_doc_reference_delivery_address",
      "0063_doc_share_token",
      "0064_manual_stock_direction",
      "0065_stockout_doc_link",
      "0066_prospects",
      "0067_growth_pack",
      "0068_features_v16",
      "0069_business_modules",
      "0070_selfie_clockin",
      "0071_erp_core",
      "0072_geofence_seed",
      "0073_document_issuer",
      "0074_customer_brand",
      "0075_bridge_enabled",
      "0076_elfia_price",
      "0077_bridge_pricing_backfill",
      "0078_bridge_movements",
      "0079_inventory_sku_key",
      "0080_sku_key_backfill",
      "0081_web_orders",
      "0082_fix_po_direction",
      "0083_task_tracking",
      "0084_elfia_traffic",
      "0085_web_order_consent",
      "0086_elfia_product_fields",
      "0086_totp_replay_guard",
      "0087_elfia_discount_slides",
      "0088_elfia_slide_framing",
      "0089_elfia_slide_zoom",
      "0090_elfia_slide_cutout",
      /* v1.63.0 — 0091 and 0092 shipped without being registered here, and
         LATEST_MIGRATION still named 0086, so registry-parity would have
         failed the build and the pending-migration banner could not have
         named them. Both are listed now, with 0093. */
      "0091_leave_adjust",
      "0092_leave_used_adjust",
      "0093_elfia_flash_sale",
      "0094_data_versions",
      "0095_task_blocks",
      "0096_task_block_done",
      "0097_leave_recorded_direct",
      "0098_web_order_tracking_url",
      "0099_shift_patterns",
      "0100_attendance_pending",
      "0101_replacement_credits",
      "0102_split_shifts",
      "0103_unpaid_break",
      "0104_payslip_employer",
      "0105_threads",
      "0106_threads_study",
      "0107_threads_scopes",
      "0108_threads_malaysia",
      "0109_threads_intent",
      "0110_threads_study_only",
      "0111_hotels",
      "0112_hotels_seed",
      "0113_reports_to",
      "0114_outbox",
    ];
    let migrations_all: { name: string; applied: boolean }[] | null = null;
    try {
      const { results } = await env.DB.prepare(`SELECT name FROM d1_migrations`).all<{ name: string }>();
      const applied = new Set(results.map((r) => r.name.replace(/\.sql$/, "")));
      migrations_all = EXPECTED_MIGRATIONS.map((name) => ({ name, applied: applied.has(name) }));
    } catch { /* d1_migrations absent — keep null, probes above still work */ }
    return json({ errors, last_backup, last_offsite, migrations_pending, migrations_all });
  }

  /* v1.4.282 (auditor pick 3: "staff offboarding flow — one button:
     deactivate, revoke sessions, remove 2FA, record final date"): every
     exit step in ONE audited call, so no step can be forgotten. Admin
     tier or CEO; admin-tier accounts and yourself cannot be offboarded. */
  if (path.startsWith("/api/v1/users/") && path.endsWith("/offboard") && method === "POST") {
    if (!atLeast(user, "ceo")) return errorResponse("forbidden", "Admin or CEO required", 403);
    const idOb = Number(path.split("/")[4]);
    if (!Number.isFinite(idOb)) return errorResponse("bad_request", "Bad user id", 400);
    if (idOb === user.id) return errorResponse("forbidden", "You cannot offboard yourself", 403);
    const target = await env.DB.prepare(`SELECT id, role, name FROM users WHERE id = ?1`).bind(idOb)
      .first<{ id: number; role: string; name: string }>();
    if (!target) return errorResponse("not_found", "User not found", 404);
    /* v1.45.0 (audit A1, same family): offboarding clears 2FA and kills every
       session, so it is a disruption an admin should not be able to aim at an
       executive account either. Super admin handles those. */
    if (PROTECTED_ROLES.includes(target.role) && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Executive and admin accounts are offboarded by the super admin", 403);
    }
    let bodyOb: { left_on?: string; status?: string } = {};
    try { bodyOb = await request.json(); } catch { /* defaults below */ }
    /* v1.77.0 — a date that was SENT and is not a date is now refused rather
       than quietly replaced with today. Omitting it still means today, which
       is what an older client does; but the CEO now picks the last day in the
       dialog, and `left_on` is what payroll prorates the final month on. A
       silent substitution there is a salary computed against a day nobody
       chose, printed on a payslip, with nothing anywhere saying it happened. */
    if (bodyOb.left_on !== undefined &&
        !(typeof bodyOb.left_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(bodyOb.left_on))) {
      return errorResponse("invalid_input", "Last day must be a date (YYYY-MM-DD)", 400);
    }
    const leftOn = typeof bodyOb.left_on === "string"
      ? bodyOb.left_on
      : new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
    const statusOb = bodyOb.status === "terminated" ? "terminated" : "resigned";
    /* v1.5.0: a resigned/terminated status now BLOCKS every sign-in path
       (login query + Google OAuth below both reject it) and all sessions are
       revoked here — so the account cannot be used again. is_active is left
       untouched on purpose: flipping it to 0 would drop the leaver from their
       own final-month payroll run (the payslip/M2E queries filter is_active),
       i.e. they wouldn't get paid for their last month. */
    await env.DB.prepare(
      `UPDATE users SET employment_status = ?1, left_on = ?2, totp_secret = NULL, totp_enabled = 0 WHERE id = ?3`,
    ).bind(statusOb, leftOn, idOb).run();
    const sess = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(idOb).run();
    try { await env.DB.prepare(`DELETE FROM twofa_backup_codes WHERE user_id = ?1`).bind(idOb).run(); } catch { /* pre-0018 */ }
    await audit(env, user.id, "staff.offboard", "users", String(idOb),
      { status: statusOb, left_on: leftOn, sessions_revoked: sess.meta?.changes ?? 0 });
    return json({ ok: true, status: statusOb, left_on: leftOn });
  }

  if (path === "/api/v1/system/backup" && method === "POST") {
    if (!atLeast(user, "ceo")) return errorResponse("forbidden", "Admin or CEO required", 403);
    const res = await runBackup(env, user.id);
    if (!res.ok) return errorResponse("backup_failed", res.message, 502);
    return json(res);
  }

  if (path === "/api/v1/audit" && method === "GET") {
    // Audit trail viewer — admin tier only. Reads the log every consequential
    // action already writes to (logins, approvals, role changes, resets).
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin required", 403);
    const url = new URL(request.url);
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 300);
    const action = url.searchParams.get("action");
    const rows = action
      ? await env.DB.prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           WHERE a.action LIKE ?1 || '%' ORDER BY a.id DESC LIMIT ?2`,
        ).bind(action, limit).all()
      : await env.DB.prepare(
          `SELECT a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, u.name AS user_name
           FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
           ORDER BY a.id DESC LIMIT ?1`,
        ).bind(limit).all();
    return json({ entries: rows.results });
  }

  if (path === "/api/v1/dashboard/summary" && method === "GET") {
    if (!isContentTeam(user)) {
      return errorResponse("forbidden", "Sign in required", 403);
    }
    const enquiries = await env.DB.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count
       FROM enquiries`,
    ).first();
    const posts = await env.DB.prepare(`SELECT COUNT(*) AS total FROM posts`).first();
    const portfolio = await env.DB.prepare(`SELECT COUNT(*) AS total FROM portfolio_items`).first();
    const testimonials = await env.DB.prepare(`SELECT COUNT(*) AS total FROM testimonials`).first();
    const { results: activity } = await env.DB.prepare(
      `SELECT a.action, a.entity, a.entity_id, a.created_at, u.name AS user_name
       FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
       ORDER BY a.created_at DESC LIMIT 15`,
    ).all();
    return json({ enquiries, posts, portfolio, testimonials, activity });
  }

  /* ---- customer account ---- */

  if (path === "/api/v1/account/enquiries" && method === "POST") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !isNonEmptyString(body.message, 4000)) {
      return errorResponse("invalid_input", "A message is required", 400);
    }
    // Tie the enquiry to the signed-in customer automatically — staff see who
    // asked without the customer re-typing their details.
    /* v1.4.181 (CEO): category so the team triages package/service questions
       at a glance, and the business team is bell-notified THE MOMENT the
       enquiry lands — a customer contacting AZ ONE gets a fast human. */
    const cats = ["general", "package_pricing", "live_commerce", "order_delivery", "collaboration"];
    const category = typeof body.category === "string" && cats.includes(body.category) ? body.category : "general";
    let enqId: number | null = null;
    try {
      const r1 = await env.DB.prepare(
        `INSERT INTO enquiries (name, company, phone, email, message, category)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id`,
      ).bind(
        user.name,
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        user.email,
        (body.message as string).trim(),
        category,
      ).first<{ id: number }>();
      enqId = r1?.id ?? null;
    } catch (e) {
      if (!String(e).includes("no such column")) throw e;
      const r1 = await env.DB.prepare(
        `INSERT INTO enquiries (name, company, phone, email, message)
         VALUES (?1, ?2, ?3, ?4, ?5) RETURNING id`,
      ).bind(
        user.name,
        isNonEmptyString(body.company, 200) ? body.company : null,
        isNonEmptyString(body.phone, 40) ? body.phone : null,
        user.email,
        (body.message as string).trim(),
      ).first<{ id: number }>();
      enqId = r1?.id ?? null;
    }
    try {
      const catLabel: Record<string, string> = {
        general: "general", package_pricing: "package & pricing", live_commerce: "live commerce services",
        order_delivery: "order & delivery", collaboration: "collaboration",
      };
      const { results: staffRows } = await env.DB.prepare(
        `SELECT id FROM users WHERE is_active = 1 AND role IN ('sales_marketing', 'marketing', 'ceo')`,
      ).all<{ id: number }>();
      for (const st of staffRows) {
        await env.DB.prepare(
          `INSERT INTO notifications (user_id, kind, message, ref) VALUES (?1, 'enquiry', ?2, ?3)`,
        ).bind(st.id, `New customer enquiry (${catLabel[category]}): ${user.name}`, `enquiry:${enqId ?? ""}`).run();
      }
    } catch { /* notifications are best-effort — the enquiry itself is saved */ }
    await audit(env, user.id, "account.enquiry", "enquiries", enqId ? String(enqId) : undefined, { category });
    return json({ ok: true }, 201);
  }

  if (path === "/api/v1/account/enquiries" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    // Email ownership is only proven for Google sign-ins. Password accounts
    // see just the enquiries submitted after their registration, so nobody
    // can register a stranger's email and read that person's history.
    const acct = await env.DB.prepare(
      `SELECT password_hash, created_at FROM users WHERE id = ?1`,
    ).bind(user.id).first<{ password_hash: string; created_at: string }>();
    const verified = acct?.password_hash.startsWith("oauth$") ?? false;
    let results: unknown[];
    try {
      results = (await env.DB.prepare(
        verified
          ? `SELECT id, message, category, status, reply, replied_at, created_at FROM enquiries
             WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`
          : `SELECT id, message, category, status, reply, replied_at, created_at FROM enquiries
             WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`,
      ).bind(...(verified ? [user.email] : [user.email, acct?.created_at ?? ""])).all()).results;
    } catch {
      results = (await env.DB.prepare(
        verified
          ? `SELECT id, message, status, created_at FROM enquiries
             WHERE email = ?1 ORDER BY created_at DESC LIMIT 50`
          : `SELECT id, message, status, created_at FROM enquiries
             WHERE email = ?1 AND created_at >= ?2 ORDER BY created_at DESC LIMIT 50`,
      ).bind(...(verified ? [user.email] : [user.email, acct?.created_at ?? ""])).all()).results;
    }
    return json({ enquiries: results });
  }

  /* v1.6.0 — customer order tracking. A signed-in customer sees their own
     quotations, invoices (with the share link to the PDF) and live-session
     history. SECURITY: only for accounts whose email is proven (Google
     sign-in) — otherwise someone could register a stranger's email and read
     their invoices. Password accounts get a clear notice to verify. Matches
     the customer's users.email to the CRM customers registry by email. */
  if (path === "/api/v1/account/orders" && method === "GET") {
    if (!user) return errorResponse("unauthenticated", "Sign in required", 401);
    const acct = await env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?1`)
      .bind(user.id).first<{ password_hash: string }>();
    const verified = acct?.password_hash.startsWith("oauth$") ?? false;
    if (!verified) {
      return json({ locked: true, docs: [], lives: [], brand: null });
    }
    const email = user.email.toLowerCase().trim();
    const { results: custRows } = await env.DB.prepare(
      `SELECT id FROM customers WHERE lower(email) = ?1`,
    ).bind(email).all<{ id: number }>();
    const ids = custRows.map((c) => c.id);
    if (ids.length === 0) return json({ locked: false, docs: [], lives: [], brand: null });
    /* v1.30.0 — the client's OWN brand, sent back with their orders so their
       area can show their mark and link home. Fails soft: a pre-0074
       database, or a client with neither website nor logo, simply yields
       null and the area renders exactly as it did before. */
    let brand: { company: string; website: string | null; logo_key: string | null } | null = null;
    try {
      const b = await env.DB.prepare(
        `SELECT company, website, logo_key FROM customers WHERE id = ?1`,
      ).bind(ids[0]!).first<{ company: string; website: string | null; logo_key: string | null }>();
      if (b && (b.website || b.logo_key)) brand = b;
    } catch { /* pre-0074 — no brand columns yet */ }
    const placeholders = ids.map((_, i) => `?${i + 1}`).join(", ");
    let docs: unknown[] = [], lives: unknown[] = [];
    try {
      docs = (await env.DB.prepare(
        `SELECT doc_number, doc_type, total_cents, payment_status, delivery_status,
                due_date, paid_at, share_token, created_at
           FROM sales_documents WHERE customer_id IN (${placeholders})
           ORDER BY created_at DESC LIMIT 100`,
      ).bind(...ids).all()).results;
    } catch { /* pre-share_token: fall back without it */
      docs = (await env.DB.prepare(
        `SELECT doc_number, doc_type, total_cents, payment_status, delivery_status,
                due_date, created_at
           FROM sales_documents WHERE customer_id IN (${placeholders})
           ORDER BY created_at DESC LIMIT 100`,
      ).bind(...ids).all()).results;
    }
    try {
      lives = (await env.DB.prepare(
        `SELECT session_date, start_time, end_time, platform, status
           FROM live_sessions WHERE client_id IN (${placeholders})
           ORDER BY session_date DESC LIMIT 50`,
      ).bind(...ids).all()).results;
    } catch { /* pre-live_sessions */ }
    return json({ locked: false, docs, lives, brand });
  }

  /* ---- site content ---- */



  const contentMatch = path.match(/^\/api\/v1\/content\/([\w.\-]+)$/);
  if (contentMatch) {
    const key = contentMatch[1]!;
    if (method === "GET") {
      const row = await env.DB.prepare(`SELECT key, value, updated_at FROM site_content WHERE key = ?1`)
        .bind(key)
        .first();
      if (!row) return errorResponse("not_found", "No content for this key", 404);
      return json(row);
    }
    if (method === "PUT") {
      if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body.value === "undefined") {
        return errorResponse("invalid_input", "value is required", 400);
      }
      await env.DB.prepare(
        `INSERT INTO site_content (key, value, updated_by, updated_at)
         VALUES (?1, ?2, ?3, datetime('now'))
         ON CONFLICT(key) DO UPDATE SET value = ?2, updated_by = ?3, updated_at = datetime('now')`,
      )
        .bind(key, JSON.stringify(body.value), user.id)
        .run();
      await audit(env, user.id, "content.update", "site_content", key);
      return json({ ok: true });
    }
  }

  /* ---- media (R2) ---- */

  const mediaServe = path.match(/^\/api\/v1\/media\/file\/(.+)$/);
  if (mediaServe && method === "GET") {
    const key = decodeURIComponent(mediaServe[1]!);
    /* v1.5.0 SECURITY REWRITE — default-deny.
       The old rule was a denylist ("private/ needs staff auth, everything
       else is public"), which made database backups (backups/db-*.json.gz)
       and claim receipts (claims/*) publicly downloadable. Now only
       uploads/ (site media placed by the content team) is public; every
       other prefix requires auth, and the sensitive ones check ownership. */
    const isPublic = key.startsWith("uploads/");
    if (!isPublic) {
      if (!user || user.role === "customer") {
        return errorResponse("forbidden", "Staff access required", 403);
      }
      if (key.startsWith("backups/") && !atLeast(user, "super_admin")) {
        return errorResponse("forbidden", "Backups are super admin only — use the export button in /admin", 403);
      }
      // Staff documents (contracts, letters): the owner, HR, or management.
      const mDoc = key.match(/^private\/staff-docs\/(\d+)-/);
      if (mDoc && user.id !== Number(mDoc[1]) &&
          !can(user.role, "hr_manage") && !can(user.role, "exec_view")) {
        return errorResponse("forbidden", "This document belongs to another staff member", 403);
      }
      // Payroll template: payroll roles only.
      if (key.startsWith("private/m2e/") && !can(user.role, "payroll_export")) {
        return errorResponse("forbidden", "Payroll access required", 403);
      }
      // v1.9.0 — clock-in selfies: the owner, HR or management only. Any key
      // under the prefix that does NOT parse to an owner id is denied (fail
      // closed, review fix), never silently opened to all staff.
      if (key.startsWith("private/attendance/")) {
        const mSelf = key.match(/^private\/attendance\/(\d+)-/);
        const ownerId = mSelf ? Number(mSelf[1]) : NaN;
        if (!Number.isFinite(ownerId) ||
            (user.id !== ownerId && !can(user.role, "hr_manage") && !can(user.role, "exec_view"))) {
          return errorResponse("forbidden", "This selfie belongs to another staff member", 403);
        }
      }
      // Claim receipts / payment proofs: the claimant, payee, HR, or deciders.
      const mClaim = key.match(/^claims\/(\d+)-/);
      if (mClaim && !can(user.role, "hr_manage") && !can(user.role, "claims_decide") &&
          !can(user.role, "exec_view")) {
        const owner = await env.DB.prepare(
          `SELECT user_id, payee_user_id FROM claims WHERE id = ?1`,
        ).bind(Number(mClaim[1])).first<{ user_id: number; payee_user_id: number | null }>();
        if (!owner || (owner.user_id !== user.id && owner.payee_user_id !== user.id)) {
          return errorResponse("forbidden", "This receipt belongs to another claim", 403);
        }
      }
    }
    const obj = await env.MEDIA.get(key);
    if (!obj) return errorResponse("not_found", "File not found", 404);
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("X-Content-Type-Options", "nosniff");
    const ct = headers.get("Content-Type") ?? "";
    // Never let user-supplied markup execute on the API origin.
    if (/svg|html|xml/i.test(ct)) {
      headers.set("Content-Disposition", "attachment");
    }
    headers.set(
      "Cache-Control",
      isPublic ? "public, max-age=31536000, immutable" : "private, max-age=300",
    );
    return new Response(obj.body, { headers });
  }

  if (path === "/api/v1/media" && method === "GET") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, r2_key, kind, alt, created_at FROM media ORDER BY created_at DESC LIMIT 200`,
    ).all();
    return json({ media: results });
  }

  if (path === "/api/v1/media" && method === "POST") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const url2 = new URL(request.url);
    const filename = (url2.searchParams.get("filename") ?? "upload.bin").replace(/[^\w.\-]/g, "_");
    const kind = url2.searchParams.get("kind") ?? "image";
    if (!["image", "video", "document", "logo"].includes(kind)) {
      return errorResponse("invalid_input", "kind must be image|video|document|logo", 400);
    }
    if (!request.body) return errorResponse("invalid_input", "Request body required", 400);
    
    const contentType = request.headers.get("Content-Type") ?? "application/octet-stream";
    // v1.5.0: image/svg+xml removed — an SVG can carry <script> and executes
    // on the API origin with access to the csrf_token cookie (stored XSS).
    const allowedTypes = [
      "image/jpeg", "image/png", "image/webp", "image/gif",
      "video/mp4", "video/webm",
      "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (!allowedTypes.includes(contentType)) {
      return errorResponse("invalid_input", `File type ${contentType} is not allowed`, 400);
    }

    const key = `uploads/${Date.now()}-${filename}`;
    await env.MEDIA.put(key, request.body, {
      httpMetadata: { contentType },
    });
    const res = await env.DB.prepare(
      `INSERT INTO media (r2_key, kind, alt, uploaded_by) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
    )
      .bind(key, kind, url2.searchParams.get("alt"), user.id)
      .first<{ id: number }>();
    await audit(env, user.id, "media.upload", "media", String(res?.id ?? key));
    return json({ id: res?.id, r2_key: key, url: `/api/v1/media/file/${encodeURIComponent(key)}` }, 201);
  }

  const mediaDelete = path.match(/^\/api\/v1\/media\/(\d+)$/);
  if (mediaDelete && method === "DELETE") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const id = mediaDelete[1]!;
    const row = await env.DB.prepare(`SELECT r2_key FROM media WHERE id = ?1`).bind(id).first<{ r2_key: string }>();
    if (!row) return errorResponse("not_found", "Media not found", 404);
    await env.MEDIA.delete(row.r2_key);
    await env.DB.prepare(`DELETE FROM media WHERE id = ?1`).bind(id).run();
    await audit(env, user.id, "media.delete", "media", id);
    return json({ ok: true });
  }

  /* ---- generic CRUD: products, posts, portfolio, testimonials ---- */

  const crudMatch = path.match(/^\/api\/v1\/(products|posts|portfolio|testimonials)(?:\/(\d+))?$/);
  if (crudMatch) {
    const cfg = CRUD[crudMatch[1]!]!;
    const id = crudMatch[2];

    if (method === "GET" && !id) {
      // Public sees only published/visible rows; editors see everything
      const isEditor = isContentTeam(user);
      const publicFilter =
        cfg.table === "products" ? "WHERE is_visible = 1"
        : cfg.table === "posts" ? "WHERE status = 'published'"
        : "WHERE is_published = 1";
      const { results } = await env.DB.prepare(
        `SELECT * FROM ${cfg.table} ${isEditor ? "" : publicFilter} ORDER BY ${cfg.orderBy} LIMIT 200`,
      ).all();
      return json({ items: results });
    }

    if (method === "GET" && id) {
      const row = await env.DB.prepare(`SELECT * FROM ${cfg.table} WHERE id = ?1`).bind(id).first();
      if (!row) return errorResponse("not_found", "Not found", 404);
      return json(row);
    }

    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (method === "POST" && !id) {
      if (!body || !cfg.required.every((c) => isNonEmptyString(body[c], 10000))) {
        return errorResponse("invalid_input", `Required: ${cfg.required.join(", ")}`, 400);
      }
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      const placeholders = cols.map((_, i) => `?${i + 1}`).join(", ");
      const stmt = env.DB.prepare(
        `INSERT INTO ${cfg.table} (${cols.join(", ")}) VALUES (${placeholders}) RETURNING id`,
      ).bind(...cols.map((c) => body[c] as string | number | null));
      const res = await stmt.first<{ id: number }>();
      await audit(env, user.id, `${cfg.table}.create`, cfg.table, String(res?.id));
      return json({ id: res?.id }, 201);
    }

    if (method === "PUT" && id) {
      if (!body) return errorResponse("invalid_input", "Body required", 400);
      const cols = cfg.columns.filter((c) => typeof body[c] !== "undefined");
      if (cols.length === 0) return errorResponse("invalid_input", "No writable fields provided", 400);
      const sets = cols.map((c, i) => `${c} = ?${i + 1}`).join(", ");
      await env.DB.prepare(`UPDATE ${cfg.table} SET ${sets} WHERE id = ?${cols.length + 1}`)
        .bind(...cols.map((c) => body[c] as string | number | null), id)
        .run();
      await audit(env, user.id, `${cfg.table}.update`, cfg.table, id, { fields: cols });
      return json({ ok: true });
    }

    if (method === "DELETE" && id) {
      if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role or above required", 403);
      await env.DB.prepare(`DELETE FROM ${cfg.table} WHERE id = ?1`).bind(id).run();
      await audit(env, user.id, `${cfg.table}.delete`, cfg.table, id);
      return json({ ok: true });
    }
  }

  /* ---- content listing (editor+) ---- */

  if (path === "/api/v1/content" && method === "GET") {
    if (!isContentTeam(user)) return errorResponse("forbidden", "Editor role or above required", 403);
    const { results } = await env.DB.prepare(
      `SELECT key, value, updated_at FROM site_content ORDER BY key`,
    ).all();
    return json({ content: results });
  }

  /* ---- user management (super_admin only) ---- */

  if (path === "/api/v1/users" && method === "GET") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const { results } = await env.DB.prepare(
      `SELECT id, email, name, role, employment_status, is_active, created_at FROM users ORDER BY id`,
    ).all();
    return json({ users: results });
  }

  if (path === "/api/v1/users" && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const isPartTimeAliasC = body?.role === "live_host_part_time"; // v1.4.180
    const roleWantedC = isPartTimeAliasC ? "live_host" : (typeof body?.role === "string" ? body.role : "");
    if (
      !body ||
      !isNonEmptyString(body.email, 200) ||
      !isNonEmptyString(body.name, 120) ||
      !isNonEmptyString(body.password, 200) ||
      (body.password as string).length < 10 ||
      !roles.includes(roleWantedC)
    ) {
      return errorResponse("invalid_input", "email, name, role, and a password of 10+ characters are required", 400);
    }
    /* v1.45.0 (security audit A1) — only a super admin may MINT authority.
       The old rule protected `super_admin` and `admin` and stopped there,
       which left ceo/coo/cco creatable by any admin. Those roles are not
       "lower": ceo alone holds claims_decide, commission_decide and
       accounting_manage — the money approvals an admin is deliberately
       denied — so creating one was a way to hand yourself the authority the
       matrix withholds. Executive roles now sit behind the same door. */
    if (PROTECTED_ROLES.includes(roleWantedC) && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", `Only a super admin can create a ${roleWantedC} account`, 403);
    }
    const email = (body.email as string).toLowerCase().trim();
    // v1.4.180: domain policy aligned with the portal (v1.4.156–157) —
    // personal emails CAN hold staff roles but only as part_time; permanent
    // staff and admin-tier roles require a company email.
    const companyMailC = email.endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
    if (["super_admin", "admin"].includes(roleWantedC) && !companyMailC) {
      return errorResponse("domain_policy", `Admin-tier roles require an @${env.COMPANY_DOMAIN} email`, 400);
    }
    const forcePartTimeC = isPartTimeAliasC || (roleWantedC !== "customer" && !companyMailC);
    // Check the email conflict explicitly, so a constraint failure elsewhere
    // (e.g. a role the database does not yet allow) is never mislabelled as
    // "email already exists".
    const existing = await env.DB.prepare(`SELECT id FROM users WHERE email = ?1`)
      .bind(email)
      .first<{ id: number }>();
    if (existing) {
      return errorResponse("email_exists", "A user with this email already exists", 409);
    }
    const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
    try {
      const res = await env.DB.prepare(
        forcePartTimeC
          ? `INSERT INTO users (email, password_hash, name, role, employment_status) VALUES (?1, ?2, ?3, ?4, 'part_time') RETURNING id`
          : `INSERT INTO users (email, password_hash, name, role) VALUES (?1, ?2, ?3, ?4) RETURNING id`,
      )
        .bind(email, hash, (body.name as string).trim(), roleWantedC)
        .first<{ id: number }>();
      await audit(env, user.id, "user.create", "users", String(res?.id), { role: roleWantedC, ...(forcePartTimeC ? { employment_status: "part_time" } : {}) });
      return json({ id: res?.id }, 201);
    } catch (e) {
      // Most likely a CHECK constraint (role not yet allowed by the DB) —
      // report it as what it is, with the fix in the message.
      return errorResponse(
        "db_constraint",
        "The database rejected this user. If you picked a newer role (cco, ceo, hr_admin, sales_marketing), run migration 0008 (`wrangler d1 migrations apply azoneofficial --remote`) and try again.",
        500,
      );
    }
  }

  const userMatch = path.match(/^\/api\/v1\/users\/(\d+)$/);
  if (userMatch && method === "PATCH") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = userMatch[1]!;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) return errorResponse("invalid_input", "Body required", 400);

    // Escalation guards: an admin manages everyone below super admin, but can
    // never modify a super admin, mint one, or change their own role.
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(id)
      .first<{ role: string }>();
    if (!target) return errorResponse("not_found", "User not found", 404);
    /* v1.5.0: admin-tier targets require SUPER admin. ceo and admin share a
       rank, so a CEO (no content_manage permission) could previously reset an
       admin's password and sign in as them — a lateral capability gain.
       v1.45.0 (security audit A1): the SAME hole existed in the other
       direction and was missed. The list was ["super_admin","admin"], so an
       admin could reset the CEO's password (or the COO's or CCO's) and sign
       in as them — inheriting claims_decide, commission_decide and
       accounting_manage, the approvals the matrix denies an admin. Both
       directions now consult PROTECTED_ROLES, which holds every role that
       carries authority its peers do not. */
    if (PROTECTED_ROLES.includes(target.role) && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can modify an executive or admin-tier account", 403);
    }
    if (PROTECTED_ROLES.includes(String(body.role ?? "")) && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can grant executive or admin-tier roles", 403);
    }
    if (String(user.id) === id && typeof body.role === "string" && body.role !== user.role) {
      return errorResponse("invalid_input", "You cannot change your own role", 400);
    }
    const roles = ["super_admin", "admin", "editor", "marketing", "live_host", "hr_admin", "sales_marketing", "ceo", "coo", "cco", "customer"];
    const changed: string[] = [];

    /* v1.4.180 (CEO: "I cant manually assigned staff roles based on Google
       account … there is no roles live_host_part_time in the list"): /admin
       now follows the SAME policy as the portal route (v1.4.156–157):
       — role changes are SUPER ADMIN only (CEO's security directive);
       — "live_host_part_time" is an accepted alias = live_host + part_time;
       — STAFF roles on personal emails are ALLOWED but employment_status is
         FORCED to part_time (permanent needs @company email);
       — admin-tier roles still hard-require a company email. */
    if (typeof body.role === "string") {
      const isPartTimeAlias = body.role === "live_host_part_time";
      const roleWanted = isPartTimeAlias ? "live_host" : body.role;
      if (roles.includes(roleWanted)) {
        if (!atLeast(user, "super_admin")) {
          return errorResponse("forbidden", "Role changes are reserved for the super admin (CEO security directive)", 403);
        }
        let forcePartTime = isPartTimeAlias;
        if (roleWanted !== "customer") {
          const acct = await env.DB.prepare(`SELECT email FROM users WHERE id = ?1`)
            .bind(id).first<{ email: string }>();
          const companyMail = !!acct && acct.email.toLowerCase().endsWith(`@${env.COMPANY_DOMAIN.toLowerCase()}`);
          if (["super_admin", "admin"].includes(roleWanted) && !companyMail) {
            return errorResponse("domain_policy", `Admin-tier roles require an @${env.COMPANY_DOMAIN} email`, 400);
          }
          if (!companyMail) forcePartTime = true; // personal email → part-time staff
        }
        if (forcePartTime) {
          await env.DB.prepare(`UPDATE users SET role = ?1, employment_status = 'part_time' WHERE id = ?2`).bind(roleWanted, id).run();
          changed.push("role", "employment_status=part_time");
        } else {
          await env.DB.prepare(`UPDATE users SET role = ?1 WHERE id = ?2`).bind(roleWanted, id).run();
          changed.push("role");
        }
      }
    }
    if (typeof body.is_active === "number" || typeof body.is_active === "boolean") {
      if (String(user.id) === id && !body.is_active) {
        return errorResponse("invalid_input", "You cannot deactivate your own account", 400);
      }
      await env.DB.prepare(`UPDATE users SET is_active = ?1 WHERE id = ?2`).bind(body.is_active ? 1 : 0, id).run();
      if (!body.is_active) {
        await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      }
      changed.push("is_active");
    }
    if (isNonEmptyString(body.password, 200) && (body.password as string).length >= 10) {
      const hash = await createPasswordHash(body.password as string, env.SESSION_PEPPER);
      await env.DB.prepare(`UPDATE users SET password_hash = ?1 WHERE id = ?2`).bind(hash, id).run();
      await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
      changed.push("password");
    }
    if (changed.length === 0) return errorResponse("invalid_input", "Nothing to update", 400);
    await audit(env, user.id, "user.update", "users", id, { changed });
    return json({ ok: true });
  }

  const revokeMatch = path.match(/^\/api\/v1\/users\/(\d+)\/revoke-sessions$/);
  if (revokeMatch && method === "POST") {
    if (!atLeast(user, "admin")) return errorResponse("forbidden", "Admin role required", 403);
    const id = revokeMatch[1]!;
    const target = await env.DB.prepare(`SELECT role FROM users WHERE id = ?1`)
      .bind(id)
      .first<{ role: string }>();
    if (!target) return errorResponse("not_found", "User not found", 404);
    /* v1.45.0 (audit A1, same family): forcing an executive out of every
       session is a disruption reserved for the super admin. */
    if (PROTECTED_ROLES.includes(target.role) && !atLeast(user, "super_admin")) {
      return errorResponse("forbidden", "Only a super admin can force out an executive or admin account", 403);
    }
    const res = await env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?1`).bind(id).run();
    await audit(env, user.id, "user.force_logout", "users", id, {
      sessions_revoked: res.meta.changes ?? 0,
    });
    return json({ ok: true, sessions_revoked: res.meta.changes ?? 0 });
  }

  return errorResponse("not_found", "Route not found", 404);
}
