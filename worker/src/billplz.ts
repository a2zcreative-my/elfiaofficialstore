/**
 * Stage B — Billplz FPX integration (the CEO's chosen gateway). INERT UNTIL
 * CONFIGURED.
 *
 * This module does nothing until BOTH secrets exist:
 *   wrangler secret put BILLPLZ_SECRET       (API Secret Key from the Billplz dashboard)
 *   wrangler secret put BILLPLZ_COLLECTION   (the Collection ID you create there)
 * Optional var in wrangler.toml:
 *   BILLPLZ_SANDBOX = "1"   -> talks to billplz-sandbox.com for testing
 *                              (sandbox and production are SEPARATE accounts)
 *
 * Until then, /orders/:token/pay returns 501 and the storefront never shows
 * the online-payment button (store-config reports gateway:false) — bank
 * transfer + receipt upload carries the store alone.
 *
 * Billplz API v3 facts this module relies on (verified 20-08-2026 against
 * billplz.github.io/api_slate):
 *   - Auth: HTTP Basic, API key as username, empty password.
 *   - POST /api/v3/bills with collection_id, email, name, amount (CENTS —
 *     RM 49.00 = 4900, same unit as our database), callback_url,
 *     redirect_url, description -> { id, url }.
 *   - GET /api/v3/bills/{id} -> { paid: true|false, state }.
 *
 * SECURITY MODEL — two locks, in this order:
 *   1. X-SIGNATURE. Billplz signs its callback and redirect with a key only
 *      you and Billplz hold (BILLPLZ_XSIGN). A wrong or missing signature is
 *      rejected before anything else happens. Cheap, and it stops forgeries
 *      without spending a network call.
 *   2. AUTHENTICATED REQUERY. Even a correctly signed message is only a
 *      claim. The bill id is re-read from Billplz's own API with the secret
 *      key, and ONLY `paid:true` from that read marks an order paid. Anyone
 *      can POST to the callback URL; nobody but Billplz can make
 *      GET /bills/{id} say paid.
 * If BILLPLZ_XSIGN is not set the requery still stands alone — the store is
 * safe but noisier, and /admin says the key is missing.
 *
 * NOTHING IN THIS FILE IS A SECRET. Keys live in Wrangler secrets, URLs in
 * STORE_URL. tests/no-secrets.mjs fails the build if that ever stops being
 * true.
 */
import type { Env } from "./index";

/**
 * v1.0.0 — X-Signature verification.
 *
 * Billplz signs its callback and its redirect with a key you hold (the
 * "X Signature Key", separate from the API Secret Key). The source string is
 * every parameter except the signature, each rendered as `key + value`,
 * sorted by key, joined with `|`, then HMAC-SHA256.
 *
 * The redirect's parameters arrive as `billplz[id]`, `billplz[paid]`, … and
 * are flattened to `billplzid`, `billplzpaid`, … before sorting — that is
 * Billplz's own rule, not ours.
 *
 * This is a GATE, not the source of truth. Even a perfectly signed callback
 * is still re-queried against Billplz's authenticated API before an order is
 * marked paid (billplzVerifyPaid). Signature first, because it is cheap and
 * rejects forgeries without spending a network call; requery second, because
 * only Billplz's own answer decides whether money moved.
 */
export function billplzSignatureConfigured(env: Env): boolean {
  return Boolean(env.BILLPLZ_XSIGN);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", enc.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const constantTimeEqual = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
};

/**
 * @param params  every parameter Billplz sent, signature included.
 * @param flatten true for the redirect (`billplz[id]` -> `billplzid`).
 * @returns true when the signature matches, false when it does not, and
 *          "unconfigured" when no key is set — the caller decides whether to
 *          proceed on the requery alone.
 */
export async function billplzSignatureOk(
  env: Env, params: URLSearchParams, flatten: boolean,
): Promise<true | false | "unconfigured"> {
  if (!env.BILLPLZ_XSIGN) return "unconfigured";
  const given = params.get(flatten ? "billplz[x_signature]" : "x_signature") ?? params.get("x_signature") ?? "";
  if (!/^[a-f0-9]{64}$/i.test(given)) return false;
  const parts: string[] = [];
  for (const [rawKey, value] of params) {
    const key = flatten ? rawKey.replace(/^billplz\[(.+)\]$/, "billplz$1") : rawKey;
    if (key === "x_signature" || key === "billplzx_signature") continue;
    parts.push(`${key}${value}`);
  }
  parts.sort();
  const expected = await hmacHex(env.BILLPLZ_XSIGN, parts.join("|"));
  return constantTimeEqual(expected.toLowerCase(), given.toLowerCase());
}

const base = (env: Env): string =>
  env.BILLPLZ_SANDBOX === "1" ? "https://www.billplz-sandbox.com/api/v3" : "https://www.billplz.com/api/v3";

const authHeader = (env: Env): string => `Basic ${btoa(`${env.BILLPLZ_SECRET}:`)}`;

/** Where this shop lives. One var, no domain literals scattered about, and
    no trailing slash to double up in the URLs above. */
export const storeUrl = (env: Env): string =>
  (env.STORE_URL && !env.STORE_URL.startsWith("REPLACE") ? env.STORE_URL : "https://elfiaofficialstore.my")
    .replace(/\/+$/, "");

export function billplzConfigured(env: Env): boolean {
  return Boolean(env.BILLPLZ_SECRET && env.BILLPLZ_COLLECTION);
}

/** Create a bill for the order; returns the Billplz payment page URL. */
export async function billplzCreateBill(
  env: Env,
  o: { order_number: string; token: string; total_cents: number; customer_name: string; phone: string; email: string | null },
): Promise<{ id: string; url: string } | null> {
  try {
    const form = new URLSearchParams({
      collection_id: env.BILLPLZ_COLLECTION!,
      // Billplz needs an email or a mobile. Not every checkout leaves an
      // email, so fall back to a mailbox at the store's own domain — derived
      // from STORE_URL, never a domain typed into this file.
      email: o.email ?? `orders@${new URL(storeUrl(env)).hostname}`,
      name: o.customer_name.slice(0, 255),
      amount: String(o.total_cents), // cents, same unit as the database
      description: `ELFIA order ${o.order_number}`.slice(0, 200),
      callback_url: `${storeUrl(env)}/api/v1/payments/billplz/callback`,
      redirect_url: `${storeUrl(env)}/order?t=${o.token}`,
      reference_1_label: "Order",
      reference_1: o.order_number,
    });
    const mobile = o.phone.replace(/[^0-9]/g, "");
    if (mobile) form.set("mobile", mobile.startsWith("60") ? `+${mobile}` : `+60${mobile.replace(/^0/, "")}`);
    const r = await fetch(`${base(env)}/bills`, {
      method: "POST",
      headers: { Authorization: authHeader(env) },
      body: form,
    });
    if (!r.ok) return null;
    const j = (await r.json()) as { id?: string; url?: string };
    return j.id && j.url ? { id: j.id, url: j.url } : null;
  } catch {
    return null;
  }
}

/**
 * v0.7.0 — credential check for /admin, so the gateway can be proved BEFORE a
 * customer meets it. Reads the configured collection with the secret key:
 *   200 → key and collection both good
 *   401 → wrong secret key (or a sandbox key against production, or vice versa)
 *   404 → key fine, collection id wrong for this account
 * Read-only. It creates nothing, charges nothing and moves no money.
 */
export async function billplzCheck(env: Env): Promise<{ ok: boolean; status: number; sandbox: boolean; message: string }> {
  const sandbox = env.BILLPLZ_SANDBOX === "1";
  if (!billplzConfigured(env)) {
    return { ok: false, status: 0, sandbox, message: "BILLPLZ_SECRET and BILLPLZ_COLLECTION are not both set — run `wrangler secret put` for each, then redeploy." };
  }
  try {
    const r = await fetch(`${base(env)}/collections/${encodeURIComponent(env.BILLPLZ_COLLECTION!)}`, {
      headers: { Authorization: authHeader(env) },
    });
    if (r.ok) {
      const j = (await r.json()) as { title?: string; status?: string };
      return {
        ok: true, status: r.status, sandbox,
        message: `Connected to the ${sandbox ? "SANDBOX" : "LIVE"} collection "${j.title ?? env.BILLPLZ_COLLECTION}"${j.status ? ` (${j.status})` : ""}.`,
      };
    }
    if (r.status === 401) {
      return { ok: false, status: 401, sandbox, message: `Billplz rejected the API Secret Key. Check it was copied whole, and that it is a ${sandbox ? "billplz-sandbox.com" : "billplz.com"} key — sandbox and live accounts are separate.` };
    }
    if (r.status === 404) {
      return { ok: false, status: 404, sandbox, message: "The key works but that Collection ID does not exist in this account. Copy the id from the collection's page in the Billplz dashboard." };
    }
    return { ok: false, status: r.status, sandbox, message: `Billplz answered ${r.status}. Try again in a moment.` };
  } catch {
    return { ok: false, status: 0, sandbox, message: "Could not reach Billplz at all — network problem on their side or ours." };
  }
}

/** Ask Billplz directly (authenticated) whether this bill is paid. */
export async function billplzVerifyPaid(env: Env, billId: string): Promise<boolean> {
  // Bill ids are short alphanumerics — refuse anything else before it goes
  // into a URL we sign with our credentials.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(billId)) return false;
  try {
    const r = await fetch(`${base(env)}/bills/${billId}`, {
      headers: { Authorization: authHeader(env) },
    });
    if (!r.ok) return false;
    const j = (await r.json()) as { paid?: boolean };
    return j.paid === true;
  } catch {
    return false;
  }
}
