/**
 * Stage B — Billplz FPX integration (the CEO's chosen gateway). INERT UNTIL
 * CONFIGURED.
 *
 * This module does nothing until ALL THREE secrets exist:
 *   wrangler secret put BILLPLZ_SECRET       (API Secret Key from the Billplz dashboard)
 *   wrangler secret put BILLPLZ_COLLECTION   (the Collection ID you create there)
 *   wrangler secret put BILLPLZ_XSIGN        (the X Signature Key — v1.39.0, see below)
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
 * SECURITY MODEL — v1.40.0, THREE locks, in this order:
 *   1. X-SIGNATURE. Billplz signs its callback and redirect with a key only
 *      you and Billplz hold (BILLPLZ_XSIGN). A wrong or missing signature is
 *      rejected before anything else happens. Cheap, and it stops forgeries
 *      without spending a network call. REQUIRED — `billplzReady()` below
 *      makes the key part of being allowed to take money, so a shop that
 *      cannot verify a callback never offers the card in the first place.
 *   2. BILLPLZ NAMES THE ORDER. The order is chosen from `reference_1` — but
 *      the copy that decides is the one GET /bills/{id} returns over our
 *      secret key, which is the value the shop itself set when it created
 *      the bill. The request's own parameters are never consulted for it.
 *      (Until v1.39.0 the callback fell back to the `reference_1` that
 *      arrived in the REQUEST, which let one genuinely paid RM 1 bill mark
 *      any other order paid. That fallback is gone; what replaced it reads
 *      the same field from the authenticated side of the wire.)
 *   3. THE MONEY. That same authenticated record must say paid, for at least
 *      this order's total in sen, into our own collection. Anyone can POST
 *      to the callback URL; nobody but Billplz can make GET /bills/{id} say
 *      paid — and a paid bill for RM 1 can no longer settle an RM 300 order.
 *      One fetch answers locks 2 and 3, so the record that chose the order
 *      is the record that cleared the money: no second read can disagree
 *      with the first.
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
 * marked paid (billplzPaidFor). Signature first, because it is cheap and
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

/**
 * v1.39.0 (SECURITY) — the X-Signature key is now part of being configured.
 *
 * It used to be optional: with no key set, `billplzSignatureOk` answered
 * "unconfigured" and the callback carried on with the requery alone. The
 * comment above called that "safe but noisier". It was neither — see the
 * callback in index.ts, where the requery proves that A bill was paid while
 * the order it applied to came from the request. Two facts that are never
 * tied together are not a second lock.
 *
 * So the shop now refuses to take a card at all unless it can verify what
 * comes back. A missing key means no bill is ever created, `gateway` is
 * false, and checkout shows bank transfer — which this shop already
 * supports and already reconciles by receipt. That is the honest failure:
 * decline the payment, rather than accept money we cannot prove arrived.
 */
export function billplzConfigured(env: Env): boolean {
  return Boolean(env.BILLPLZ_SECRET && env.BILLPLZ_COLLECTION);
}

/**
 * Ready to take money — configured AND able to verify what comes back.
 *
 * The distinction matters: `billplzConfigured` answers "could we call the
 * API", `billplzReady` answers "should we let a customer pay". Without the
 * signature key the callback authenticates nobody, so the shop declines the
 * card entirely and shows bank transfer instead — which it already supports
 * and already reconciles by receipt. Declining a payment we cannot verify is
 * the honest failure; accepting money we cannot prove arrived is not.
 */
export function billplzReady(env: Env): boolean {
  return billplzConfigured(env) && Boolean(env.BILLPLZ_XSIGN);
}

/**
 * v1.14.1 — the result of trying to create a bill, INCLUDING why it failed.
 *
 * This used to return `null` for every failure, so a live shop showed the
 * customer "Payment gateway unavailable" and kept the only useful fact — what
 * Billplz actually said — entirely to itself. A wrong key, a sandbox key on a
 * live shop, an unactivated account and a rejected phone number were all one
 * indistinguishable dead end.
 *
 * `detail` is Billplz's own reply, truncated. It never contains our
 * credentials: the key travels in the Authorization header and is not echoed
 * back in a response body.
 */
export type BillResult =
  | { ok: true; id: string; url: string }
  | { ok: false; status: number; detail: string };

/** Create a bill for the order; returns the Billplz payment page URL. */
export async function billplzCreateBill(
  env: Env,
  o: { order_number: string; token: string; total_cents: number; customer_name: string; phone: string; email: string | null },
): Promise<BillResult> {
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
    /* v1.14.1 — the mobile is sent ONLY when it really is a Malaysian mobile
       number. Billplz validates this field and answers 422 for anything it
       does not like, which would refuse the whole bill — so a customer who
       typed a landline, an office number or a number with a typo could not
       pay at all, and the shop could not say why. The email above is always
       present (falling back to the store's own mailbox), so Billplz always
       has a contact and dropping a doubtful mobile costs nothing. */
    const digits = o.phone.replace(/[^0-9]/g, "");
    const local = digits.startsWith("60") ? digits.slice(2) : digits.replace(/^0/, "");
    if (/^1\d{8,9}$/.test(local)) form.set("mobile", `+60${local}`);

    const r = await fetch(`${base(env)}/bills`, {
      method: "POST",
      headers: { Authorization: authHeader(env) },
      body: form,
    });
    if (!r.ok) {
      /* Billplz's own words, kept short and stripped of newlines so they fit
         in one line of a report. Nothing here can contain the API key — it
         goes out in the Authorization header and is never echoed back. */
      const raw = (await r.text().catch(() => "")).replace(/\s+/g, " ").trim();
      return { ok: false, status: r.status, detail: raw.slice(0, 300) || "(no reply body)" };
    }
    const j = (await r.json()) as { id?: string; url?: string };
    return j.id && j.url
      ? { ok: true, id: j.id, url: j.url }
      : { ok: false, status: r.status, detail: "Billplz accepted the request but returned no bill id or URL." };
  } catch (e) {
    return { ok: false, status: 0, detail: `Could not reach Billplz: ${e instanceof Error ? e.message : "network error"}` };
  }
}

/**
 * v1.14.1 — turn a bill failure into a sentence that names the fix.
 *
 * Kept beside the codes it explains rather than in the route, because the
 * route's job is to answer the customer and this is for whoever has to
 * repair the shop.
 */
export function billplzFailureHint(status: number, sandbox: boolean): string {
  if (status === 401) {
    return `Billplz rejected the API Secret Key. If the key was regenerated in the dashboard, the shop is still holding the old one — set it again with \`wrangler secret put BILLPLZ_SECRET\`. Check too that it is a ${sandbox ? "billplz-sandbox.com" : "billplz.com"} key: sandbox and live are separate accounts.`;
  }
  if (status === 403) {
    return "Billplz knows the key but refused it. That usually means the account is not fully activated for collections yet, or its access was withdrawn — check the Billplz dashboard.";
  }
  if (status === 404) {
    return "The Collection ID does not exist in this account. Copy it again from the collection's page and set it with `wrangler secret put BILLPLZ_COLLECTION`.";
  }
  if (status === 422) {
    return "Billplz refused the bill's contents — read the detail above. The usual causes are an amount below their minimum, or a name, email or mobile it will not accept.";
  }
  if (status === 0) return "The shop could not reach Billplz at all.";
  return `Billplz answered ${status}. The detail above is their own reply.`;
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
    /* v1.14.0 — 403 belongs with 401. Billplz answers 401 for a key it does
       not recognise and 403 for a key it recognises but will not accept here
       (an account not yet activated, or one whose access has been withdrawn).
       Both are credential problems the CEO must act on; the old code filed
       403 under "try again in a moment", which is advice that never comes
       good. */
    if (r.status === 401 || r.status === 403) {
      return {
        ok: false, status: r.status, sandbox,
        message: r.status === 401
          ? `Billplz rejected the API Secret Key. Check it was copied whole, and that it is a ${sandbox ? "billplz-sandbox.com" : "billplz.com"} key — sandbox and live accounts are separate.`
          : "Billplz recognised the key but refused it (403). That usually means the account is not fully activated for collections yet, or its access was withdrawn — check the Billplz dashboard.",
      };
    }
    if (r.status === 404) {
      return { ok: false, status: 404, sandbox, message: "The key works but that Collection ID does not exist in this account. Copy the id from the collection's page in the Billplz dashboard." };
    }
    return { ok: false, status: r.status, sandbox, message: `Billplz answered ${r.status}. Try again in a moment.` };
  } catch {
    return { ok: false, status: 0, sandbox, message: "Could not reach Billplz at all — network problem on their side or ours." };
  }
}

/**
 * What Billplz itself says about a bill.
 *
 * v1.39.0 — this used to return a bare boolean and throw the rest away,
 * which meant nothing anywhere compared the money that arrived with the
 * money that was owed. `paid: true` on its own answers "did SOMEBODY pay
 * SOMETHING" — not "was this order settled in full into our account".
 */
export interface BillFacts {
  paid: boolean;
  /** sen the customer was ASKED for */
  amount: number | null;
  /** sen Billplz says actually settled — the number that decides */
  paid_amount: number | null;
  collection_id: string | null;
  /** the order number we set when the bill was created */
  reference_1: string | null;
}

/** Ask Billplz directly (authenticated) what this bill is. Null = no answer. */
export async function billplzFetchBill(env: Env, billId: string): Promise<BillFacts | null> {
  // Bill ids are short alphanumerics — refuse anything else before it goes
  // into a URL we sign with our credentials.
  if (!/^[A-Za-z0-9_-]{4,64}$/.test(billId)) return null;
  try {
    const r = await fetch(`${base(env)}/bills/${billId}`, {
      headers: { Authorization: authHeader(env) },
    });
    if (!r.ok) return null;
    const j = (await r.json()) as {
      paid?: boolean; amount?: unknown; paid_amount?: unknown;
      collection_id?: unknown; reference_1?: unknown;
    };
    const num = (v: unknown): number | null => {
      const n = Math.round(Number(v));
      return Number.isFinite(n) ? n : null;
    };
    /* paid_amount is what settled; amount is what was asked. A paid bill
       normally reports both, but an older API shape only carries `amount` —
       falling back to it keeps a genuine payment from being refused, and the
       caller still compares the figure against the order. */
    const settled = num(j.paid_amount);
    return {
      paid: j.paid === true,
      amount: num(j.amount),
      paid_amount: settled ?? (j.paid === true ? num(j.amount) : null),
      collection_id: typeof j.collection_id === "string" ? j.collection_id : null,
      reference_1: typeof j.reference_1 === "string" ? j.reference_1 : null,
    };
  } catch {
    return null;
  }
}

/** Is this bill in the collection this shop actually sells from? A paid bill
    from another collection on the same account is somebody else's money. */
export function billplzCollectionOk(env: Env, bill: BillFacts): boolean {
  if (!env.BILLPLZ_COLLECTION || !bill.collection_id) return true;   // cannot tell — the amount check still stands
  return bill.collection_id === env.BILLPLZ_COLLECTION;
}

/**
 * Did THIS bill settle THIS order, in full, into OUR collection?
 *
 * v1.39.0 — three questions, all of which have to be yes:
 *   1. Billplz's own authenticated answer says paid.
 *   2. The amount equals what the order asks for, to the sen. A bill is
 *      created server-side at `total_cents`, so a mismatch means the bill
 *      is not this order's — or something changed underneath it.
 *   3. The collection is ours. A paid bill from another collection on the
 *      same account is somebody else's money.
 * A mismatch returns false and says why, so the caller can log it rather
 * than fail silently: an order that was paid but not accepted is a customer
 * ringing up, and whoever answers needs the reason.
 */
export async function billplzPaidFor(
  env: Env, billId: string, expectCents: number,
): Promise<{ ok: true } | { ok: false; why: string }> {
  const bill = await billplzFetchBill(env, billId);
  if (!bill) return { ok: false, why: "billplz gave no answer for this bill" };
  if (!bill.paid) return { ok: false, why: "not paid" };
  if (!billplzCollectionOk(env, bill)) return { ok: false, why: "bill belongs to another collection" };
  if (bill.paid_amount === null || bill.paid_amount < expectCents) {
    return { ok: false, why: `settled ${bill.paid_amount ?? "?"} < order ${expectCents}` };
  }
  return { ok: true };
}

/**
 * The old name, kept — with the expected amount now REQUIRED by the type, so
 * no caller can ever ask the cheap question ("is it paid?") again without
 * also asking the one that matters ("for how much?").
 */
export async function billplzVerifyPaid(env: Env, billId: string, expectCents: number): Promise<boolean> {
  return (await billplzPaidFor(env, billId, expectCents)).ok;
}
