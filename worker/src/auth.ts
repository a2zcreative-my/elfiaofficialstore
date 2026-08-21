/**
 * Customer accounts and the API's rate limiter (v1.0.0).
 *
 * WHAT AN ACCOUNT IS AND IS NOT
 *   It is a convenience: a saved address, and an order history that follows
 *   the customer to a new phone. It is NOT a gate — guest checkout is
 *   untouched, and an order carries `customer_id` only when the buyer
 *   happened to be signed in.
 *
 * PASSWORDS never reach the database. PBKDF2-SHA256 at 100,000 iterations —
 * the Cloudflare platform maximum, see the note on PBKDF2_ITER — with a fresh
 * 16-byte salt each, and the iteration count stored beside the hash so it can
 * be raised later without locking anyone out. Verification is constant-time.
 *
 * SESSIONS are a 32-byte random token handed to the browser in an HttpOnly,
 * Secure, SameSite=Lax cookie. The database stores only the SHA-256 of it, so
 * a leaked database still cannot sign in as anybody.
 *
 * PAST ORDERS ARE NOT AUTO-CLAIMED. It is tempting to attach every guest
 * order with a matching phone number the moment someone signs up — and that
 * is exactly how you hand one customer another customer's history. A signed-in
 * customer claims an order the same way anyone finds one: the order number
 * plus the phone that placed it.
 */
import type { Env } from "./index";

/* 100,000 is the MAXIMUM Cloudflare's production runtime allows for PBKDF2
   (crypto.subtle enforces the cap on the platform, and throws above it — the
   local dev runtime does not, which is how 210,000 passed every local test
   and then broke every real sign-up on the live site, v1.1.1). The count is
   stored per user, so it can rise if the platform cap ever does. */
const PBKDF2_ITER = 100_000;
const SESSION_DAYS = 30;
const COOKIE = "elfia_session";

const hex = (b: ArrayBuffer): string =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (s: string): Promise<string> =>
  hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** Constant-time string compare — never `a === b` on a secret. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function derive(password: string, saltHex: string, iterations: number): Promise<string> {
  const salt = new Uint8Array((saltHex.match(/../g) ?? []).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return hex(bits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string; iter: number }> {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return { hash: await derive(password, salt, PBKDF2_ITER), salt, iter: PBKDF2_ITER };
}

export async function verifyPassword(password: string, hash: string, salt: string, iter: number): Promise<boolean> {
  /* Fail closed, never crash: a stored iteration count the platform refuses
     (or any other derive failure) is a failed login, not a 500. */
  try {
    return timingSafeEqual(await derive(password, salt, iter), hash);
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ rate limits */

/**
 * "Is this caller going too fast?" — one table, one rule per bucket.
 *
 * Deliberately counts EVERY attempt, not only the failed ones: a limit that
 * only counts failures lets an attacker keep guessing as long as they
 * occasionally guess right. Callers that should be forgiven on success
 * (a customer finding their own order) call `clearLimit` afterwards.
 */
export async function hitLimit(
  env: Env, bucket: string, max: number, windowMinutes: number,
): Promise<{ allowed: boolean; remaining: number }> {
  const row = await env.DB.prepare(`SELECT hits, window_start FROM rate_limits WHERE bucket = ?1`)
    .bind(bucket).first<{ hits: number; window_start: string }>().catch(() => null);
  const fresh = row && (Date.now() - Date.parse(`${row.window_start.replace(" ", "T")}Z`)) < windowMinutes * 60_000;
  const hits = (fresh ? row!.hits : 0) + 1;
  await env.DB.prepare(
    `INSERT INTO rate_limits (bucket, hits, window_start) VALUES (?1, 1, datetime('now'))
     ON CONFLICT(bucket) DO UPDATE SET
       hits = CASE WHEN ?2 THEN rate_limits.hits + 1 ELSE 1 END,
       window_start = CASE WHEN ?2 THEN rate_limits.window_start ELSE datetime('now') END`,
  ).bind(bucket, fresh ? 1 : 0).run().catch(() => null);
  return { allowed: hits <= max, remaining: Math.max(0, max - hits) };
}

export async function clearLimit(env: Env, bucket: string): Promise<void> {
  await env.DB.prepare(`DELETE FROM rate_limits WHERE bucket = ?1`).bind(bucket).run().catch(() => null);
}

/** The caller's address. Behind Cloudflare this header is always present and
    cannot be spoofed by the client; "unknown" only happens off-platform. */
export const callerIp = (request: Request): string =>
  request.headers.get("CF-Connecting-IP") ?? "unknown";

/* --------------------------------------------------------------- sessions */

export interface Customer {
  id: number; email: string; name: string;
  phone: string | null; phone_digits: string | null; address: string | null;
  created_at: string;
}

export async function createSession(env: Env, customerId: number, userAgent: string | null): Promise<string> {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)).buffer);
  await env.DB.prepare(
    `INSERT INTO sessions (token_hash, customer_id, expires_at, user_agent)
     VALUES (?1, ?2, datetime('now', ?3), ?4)`,
  ).bind(await sha256Hex(token), customerId, `+${SESSION_DAYS} days`, (userAgent ?? "").slice(0, 200)).run();
  return token;
}

/** Who is calling, if anyone. Never throws — a bad cookie is just a guest. */
export async function currentCustomer(env: Env, request: Request): Promise<Customer | null> {
  const raw = request.headers.get("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!match) return null;
  const row = await env.DB.prepare(
    `SELECT c.id, c.email, c.name, c.phone, c.phone_digits, c.address, c.created_at
     FROM sessions s JOIN customers c ON c.id = s.customer_id
     WHERE s.token_hash = ?1 AND s.expires_at > datetime('now')`,
  ).bind(await sha256Hex(match[1]!)).first<Customer>().catch(() => null);
  return row ?? null;
}

export async function destroySession(env: Env, request: Request): Promise<void> {
  const raw = request.headers.get("Cookie") ?? "";
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{64})`));
  if (!match) return;
  await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?1`).bind(await sha256Hex(match[1]!)).run().catch(() => null);
}

/** Secure is omitted on http://localhost so local testing works; every real
    deployment is https, where the cookie is Secure. */
export function sessionCookie(token: string, url: URL): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=${SESSION_DAYS * 24 * 3600}`;
}

export function clearCookie(url: URL): string {
  const secure = url.protocol === "https:" ? " Secure;" : "";
  return `${COOKIE}=; Path=/; HttpOnly;${secure} SameSite=Lax; Max-Age=0`;
}

/* ----------------------------------------------------------- housekeeping */

/** Expired sessions and stale rate-limit rows, swept on the cron. */
export async function sweepAuth(env: Env): Promise<void> {
  await env.DB.prepare(`DELETE FROM sessions WHERE expires_at <= datetime('now')`).run().catch(() => null);
  await env.DB.prepare(`DELETE FROM rate_limits WHERE window_start <= datetime('now', '-1 day')`).run().catch(() => null);
}

export const normalisePhone = (v: string | null | undefined): string => (v ?? "").replace(/\D/g, "");
export const normaliseEmail = (v: string): string => v.trim().toLowerCase();
export const looksLikeEmail = (v: string): boolean => /^[^@\s]+@[^@\s.]+\.[^@\s]{2,}$/.test(v);
