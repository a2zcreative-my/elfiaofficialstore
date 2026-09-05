/**
 * Stage B — Bayarcash FPX integration. INERT UNTIL CONFIGURED.
 *
 * v1.46.0 — the CEO, 05-09-2026: "I want to use BayarCash for my payment
 * gateway, you have to remove Billplz inside ELFIA". Billplz (v0.7.0 ..
 * v1.44.2) is gone; this module takes its place and keeps its shape, so the
 * routes in index.ts change names and not their reasoning.
 *
 * This module does nothing until ALL THREE secrets exist:
 *   wrangler secret put BAYARCASH_PAT      (Personal Access Token - Bayarcash console, profile)
 *   wrangler secret put BAYARCASH_PORTAL   (the Portal Key of the portal that takes the money)
 *   wrangler secret put BAYARCASH_SECRET   (the API Secret Key - signs what we send, verifies what comes back)
 * Optional var in wrangler.toml:
 *   BAYARCASH_SANDBOX = "1"   -> talks to api.console.bayarcash-sandbox.com
 *                                (sandbox and production are SEPARATE accounts)
 *
 * Until then, /orders/:token/pay returns 501 and the storefront never shows
 * the online-payment button (store-config reports gateway:false) - bank
 * transfer + receipt upload carries the store alone.
 *
 * Bayarcash API v3 facts this module relies on (read 05-09-2026 at
 * api.webimpian.support/bayarcash):
 *   - Auth: `Authorization: Bearer <Personal Access Token>`.
 *   - POST /v3/payment-intents with payment_channel (1 = FPX), portal_key,
 *     order_number, amount (RINGGIT with two decimals - "39.00" - NOT sen;
 *     the database holds sen, so this file converts at the edge and nowhere
 *     else), payer_name, payer_email, optional payer_telephone_number,
 *     return_url (browser GET), callback_url (server POST), checksum
 *     -> { id: "pi_...", url }.
 *   - GET /v3/payment-intents/{id} -> { status: "paid" | ..., amount,
 *     order_number, attempts: [{ transaction_id, status, ... }] }.
 *   - Checksum: HMAC-SHA256 with the API Secret Key over the payload's
 *     VALUES, keys sorted alphabetically, joined with "|".
 *       request : amount | order_number | payer_email | payer_name | payment_channel
 *       callback: amount | currency | exchange_reference_number |
 *                 exchange_transaction_id | order_number | payer_bank_name |
 *                 status | status_description | transaction_id
 *   - Transaction status codes: 0 new, 1 pending, 2 failed, 3 success,
 *     4 cancelled. Bayarcash retries a callback up to 5 times unless it gets
 *     a 200.
 *
 * SECURITY MODEL - the same three locks Billplz had, in the same order:
 *   1. CHECKSUM. Bayarcash signs its callback with the API Secret Key. A
 *      wrong or missing checksum is rejected before anything else happens.
 *      REQUIRED - `bayarcashReady()` makes the key part of being allowed to
 *      take money, so a shop that cannot verify a callback never offers the
 *      card in the first place.
 *   2. BAYARCASH NAMES THE ORDER. The callback's order_number only LOCATES
 *      the order row. What decides is the payment intent the shop itself
 *      created for that order (its id is on the order row), re-read over
 *      our token: its status, its amount and ITS order_number. A forged
 *      callback can name any order it likes and still only ever move an
 *      order whose own intent Bayarcash says is paid.
 *   3. THE MONEY. That same authenticated record must say paid, for at
 *      least this order's total in sen, for this order's number. One fetch
 *      answers locks 2 and 3, so the record that chose the order is the
 *      record that cleared the money.
 *
 * NOTHING IN THIS FILE IS A SECRET. Keys live in Wrangler secrets, URLs in
 * STORE_URL. tests/no-secrets.mjs fails the build if that ever stops being
 * true - and a key that has ever appeared in a chat or a screenshot is one
 * to regenerate in the console, not one to type here.
 */
import type { Env } from "./index";

const base = (env: Env): string =>
  env.BAYARCASH_SANDBOX === "1" ? "https://api.console.bayarcash-sandbox.com/v3" : "https://api.console.bayar.cash/v3";

/** FPX. Every other channel needs activating on the Bayarcash side first. */
const CHANNEL_FPX = 1;

const headers = (env: Env): Record<string, string> => ({
  Authorization: `Bearer ${(env.BAYARCASH_PAT ?? "").trim()}`,
  Accept: "application/json",
  "Content-Type": "application/json",
});

/** Where this shop lives. One var, no domain literals scattered about, and
    no trailing slash to double up in the URLs above. */
export const storeUrl = (env: Env): string =>
  (env.STORE_URL && !env.STORE_URL.startsWith("REPLACE") ? env.STORE_URL : "https://elfiaofficialstore.my")
    .replace(/\/+$/, "");

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

/** Bayarcash's rule: sort by key, join the VALUES with "|", HMAC-SHA256.
    Values are trimmed first, as their docs advise. */
async function checksumOf(secret: string, payload: Record<string, string | number>): Promise<string> {
  const values = Object.keys(payload).sort().map((k) => String(payload[k]).trim());
  return hmacHex(secret, values.join("|"));
}

/** Sen -> the "39.00" Bayarcash wants. The ONE place the unit changes. */
export const ringgit = (cents: number): string => (cents / 100).toFixed(2);
/** "39.00" (or 39, or "39") -> sen. Null when it is not a number. */
export const toCents = (v: unknown): number | null => {
  const n = Math.round(Number(String(v ?? "").replace(/,/g, "")) * 100);
  return Number.isFinite(n) ? n : null;
};

/** Could we call the API at all. */
export function bayarcashConfigured(env: Env): boolean {
  return Boolean((env.BAYARCASH_PAT ?? "").trim() && (env.BAYARCASH_PORTAL ?? "").trim());
}

/** Can we verify what comes back. */
export function bayarcashSignatureConfigured(env: Env): boolean {
  return Boolean((env.BAYARCASH_SECRET ?? "").trim());
}

/**
 * Ready to take money - configured AND able to verify what comes back.
 * `bayarcashConfigured` answers "could we call the API", `bayarcashReady`
 * answers "should we let a customer pay". Without the secret the callback
 * authenticates nobody, so the shop declines the card entirely and shows
 * bank transfer instead. Declining a payment we cannot verify is the honest
 * failure; accepting money we cannot prove arrived is not.
 */
export function bayarcashReady(env: Env): boolean {
  return bayarcashConfigured(env) && bayarcashSignatureConfigured(env);
}

/** The result of trying to create a payment intent, INCLUDING why it failed.
    `detail` is Bayarcash's own reply, truncated. It never contains our
    credentials: the token travels in the Authorization header and is not
    echoed back in a response body. */
export type IntentResult =
  | { ok: true; id: string; url: string }
  | { ok: false; status: number; detail: string };

/** Create a payment intent for the order; returns the Bayarcash payment page URL. */
export async function bayarcashCreateIntent(
  env: Env,
  o: { order_number: string; token: string; total_cents: number; customer_name: string; phone: string; email: string | null },
): Promise<IntentResult> {
  try {
    /* Bayarcash needs an email. Not every checkout leaves one, so fall back
       to a mailbox at the store's own domain - derived from STORE_URL,
       never a domain typed into this file. */
    const payer_email = (o.email ?? `orders@${new URL(storeUrl(env)).hostname}`).trim().slice(0, 255);
    const payer_name = o.customer_name.trim().slice(0, 255) || "ELFIA customer";
    const amount = ringgit(o.total_cents);
    const signed: Record<string, string | number> = {
      payment_channel: CHANNEL_FPX,
      order_number: o.order_number,
      amount,
      payer_name,
      payer_email,
    };
    const payload: Record<string, unknown> = {
      ...signed,
      portal_key: (env.BAYARCASH_PORTAL ?? "").trim(),
      return_url: `${storeUrl(env)}/order?t=${o.token}&back=1`,
      callback_url: `${storeUrl(env)}/api/v1/payments/bayarcash/callback`,
      checksum: await checksumOf((env.BAYARCASH_SECRET ?? "").trim(), signed),
    };
    /* The mobile is sent ONLY when it really is a Malaysian mobile number.
       Bayarcash validates the field and a refused field refuses the whole
       intent; the email above is always present, so dropping a doubtful
       mobile costs nothing. Their format: digits, country code first. */
    const digits = o.phone.replace(/[^0-9]/g, "");
    const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0/, "");
    if (/^1\d{8,9}$/.test(local)) payload.payer_telephone_number = `60${local}`;

    const r = await fetch(`${base(env)}/payment-intents`, {
      method: "POST",
      headers: { ...headers(env), "Idempotency-Key": `${o.token}-${o.total_cents}-${Math.floor(Date.now() / 60000)}` },
      body: JSON.stringify(payload),
    });
    if (!r.ok) {
      const raw = (await r.text().catch(() => "")).replace(/\s+/g, " ").trim();
      return { ok: false, status: r.status, detail: raw.slice(0, 300) || "(no reply body)" };
    }
    const j = (await r.json()) as { id?: string; url?: string };
    return j.id && j.url
      ? { ok: true, id: j.id, url: j.url }
      : { ok: false, status: r.status, detail: "Bayarcash accepted the request but returned no payment intent id or URL." };
  } catch (e) {
    return { ok: false, status: 0, detail: `Could not reach Bayarcash: ${e instanceof Error ? e.message : "network error"}` };
  }
}

/** Turn an intent failure into a sentence that names the fix. */
export function bayarcashFailureHint(status: number, sandbox: boolean): string {
  if (status === 401) {
    return `Bayarcash rejected the Personal Access Token. If it was regenerated in the console, the shop is still holding the old one - set it again with \`wrangler secret put BAYARCASH_PAT\`. Check too that it is a ${sandbox ? "sandbox" : "live"} token: sandbox and live are separate accounts.`;
  }
  if (status === 403) {
    return "Bayarcash knows the token but refused it. That usually means the merchant account is not fully activated yet, or the token's access was withdrawn - check the Bayarcash console.";
  }
  if (status === 404) {
    return "Bayarcash could not find what was asked for. If this happened while creating a payment, the Portal Key is most likely wrong for this account - copy it again from the portal's page and set it with `wrangler secret put BAYARCASH_PORTAL`.";
  }
  if (status === 422) {
    return "Bayarcash refused the payment's contents - read the detail above. The usual causes are a Portal Key it does not recognise, a checksum computed with a different API Secret Key than the console holds, an amount below their minimum, or a name, email or mobile it will not accept.";
  }
  if (status === 0) return "The shop could not reach Bayarcash at all.";
  return `Bayarcash answered ${status}. The detail above is their own reply.`;
}

/**
 * Credential check for /admin and /bridge/payment-check, so the gateway can
 * be proved BEFORE a customer meets it. Lists transactions with the token
 * (one page, read-only): 200 proves the token; 401 is a wrong token or a
 * sandbox token against live (or vice versa). The Portal Key cannot be read
 * back without creating a payment, so it is reported as set-or-not.
 * It creates nothing, charges nothing and moves no money.
 */
export async function bayarcashCheck(env: Env): Promise<{ ok: boolean; status: number; sandbox: boolean; message: string }> {
  const sandbox = env.BAYARCASH_SANDBOX === "1";
  if (!bayarcashConfigured(env)) {
    return { ok: false, status: 0, sandbox, message: "BAYARCASH_PAT and BAYARCASH_PORTAL are not both set - run `wrangler secret put` for each, then redeploy." };
  }
  try {
    const r = await fetch(`${base(env)}/transactions?limit=1`, { headers: headers(env) });
    if (r.ok) {
      return {
        ok: true, status: r.status, sandbox,
        message: `Connected to Bayarcash ${sandbox ? "SANDBOX" : "LIVE"}: the Personal Access Token works. The Portal Key is set${bayarcashSignatureConfigured(env) ? " and the API Secret Key is set" : ""}; both are proved by the first real payment.`,
      };
    }
    if (r.status === 401 || r.status === 403) {
      return {
        ok: false, status: r.status, sandbox,
        message: r.status === 401
          ? `Bayarcash rejected the Personal Access Token. Check it was copied whole, and that it is a ${sandbox ? "sandbox" : "live"} token - sandbox and live accounts are separate.`
          : "Bayarcash recognised the token but refused it (403). That usually means the merchant account is not fully activated yet, or the token's access was withdrawn - check the Bayarcash console.",
      };
    }
    return { ok: false, status: r.status, sandbox, message: `Bayarcash answered ${r.status}. Try again in a moment.` };
  } catch {
    return { ok: false, status: 0, sandbox, message: "Could not reach Bayarcash at all - network problem on their side or ours." };
  }
}

/** What Bayarcash itself says about a payment intent. */
export interface IntentFacts {
  paid: boolean;
  /** sen the customer was asked for, as Bayarcash records it */
  amount_cents: number | null;
  /** the order number we set when the intent was created */
  order_number: string | null;
  /** the successful transaction, if any */
  transaction_id: string | null;
  status: string | null;
}

/** Ask Bayarcash directly (authenticated) what this intent is. Null = no answer. */
export async function bayarcashFetchIntent(env: Env, intentId: string): Promise<IntentFacts | null> {
  // Intent ids are short alphanumerics ("pi_PGPP2G") - refuse anything else
  // before it goes into a URL we send our token with.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(intentId)) return null;
  try {
    const r = await fetch(`${base(env)}/payment-intents/${intentId}`, { headers: headers(env) });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      status?: unknown; amount?: unknown; order_number?: unknown;
      attempts?: { transaction_id?: unknown; status?: unknown }[];
    };
    const status = typeof j.status === "string" ? j.status : null;
    const ok = (j.attempts ?? []).find((a) => Number(a.status) === 3);
    return {
      paid: status === "paid",
      amount_cents: toCents(j.amount),
      order_number: typeof j.order_number === "string" ? j.order_number : j.order_number != null ? String(j.order_number) : null,
      transaction_id: typeof ok?.transaction_id === "string" ? ok.transaction_id : null,
      status,
    };
  } catch {
    return null;
  }
}

/**
 * Did THIS intent settle THIS order, in full? Three questions, all yes:
 *   1. Bayarcash's own authenticated answer says paid.
 *   2. The amount equals what the order asks for, to the sen. An intent is
 *      created server-side at `total_cents`, so a mismatch means the intent
 *      is not this order's - or something changed underneath it.
 *   3. The intent's order_number is this order's. That is the binding a
 *      collection id gave under Billplz: the record names the order it was
 *      raised for, and we set that name ourselves.
 * A mismatch returns false and says why, so the caller can log it: an order
 * that was paid but not accepted is a customer on the phone.
 */
export async function bayarcashPaidFor(
  env: Env, intentId: string, expectCents: number, orderNumber: string,
): Promise<{ ok: true; transaction_id: string | null } | { ok: false; why: string }> {
  const it = await bayarcashFetchIntent(env, intentId);
  if (!it) return { ok: false, why: "bayarcash gave no answer for this payment intent" };
  if (!it.paid) return { ok: false, why: "not paid" };
  if (it.order_number !== null && it.order_number !== orderNumber) {
    return { ok: false, why: `intent is for order ${it.order_number}, not ${orderNumber}` };
  }
  if (it.amount_cents === null || it.amount_cents < expectCents) {
    return { ok: false, why: `settled ${it.amount_cents ?? "?"} < order ${expectCents}` };
  }
  return { ok: true, transaction_id: it.transaction_id };
}

/**
 * LOCK 1 - the callback's checksum, over the nine v3 fields, sorted by key.
 *
 * @param fields every parameter Bayarcash sent, checksum included.
 * @returns true when it matches, false when it does not, and "unconfigured"
 *          when no secret is set - which `bayarcashReady` prevents from ever
 *          being the case on a shop that raised an intent.
 */
export async function bayarcashCallbackOk(env: Env, fields: Record<string, string>): Promise<true | false | "unconfigured"> {
  const secret = (env.BAYARCASH_SECRET ?? "").trim();
  if (!secret) return "unconfigured";
  const given = (fields.checksum ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(given)) return false;
  const signed: Record<string, string> = {};
  for (const k of ["transaction_id", "exchange_reference_number", "exchange_transaction_id", "order_number", "currency", "amount", "payer_bank_name", "status", "status_description"]) {
    signed[k] = fields[k] ?? "";
  }
  const expected = await checksumOf(secret, signed);
  return constantTimeEqual(expected.toLowerCase(), given.toLowerCase());
}

/** Bayarcash posts JSON to the callback URL; older integrations saw form
    bodies. Read either into one flat string map. */
export async function readCallbackFields(request: Request): Promise<Record<string, string>> {
  const ct = request.headers.get("content-type") ?? "";
  const out: Record<string, string> = {};
  if (ct.includes("application/json")) {
    const j = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    for (const [k, v] of Object.entries(j ?? {})) if (v != null && typeof v !== "object") out[k] = String(v);
    return out;
  }
  const p = new URLSearchParams(await request.text().catch(() => ""));
  for (const [k, v] of p) out[k] = v;
  return out;
}
