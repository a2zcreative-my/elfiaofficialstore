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
 * SECURITY MODEL: the payment callback is just a hint. Billplz signs its
 * callbacks (x_signature), but we do not even rely on that — the bill id is
 * RE-QUERIED against Billplz's own API with our secret, and only paid:true
 * from that authenticated read flips the order. Anyone can POST to the
 * callback URL; nobody can make GET /bills/{id} say "paid" but Billplz.
 *
 * Flagged UNTESTED against the live gateway until Stage B sign-off: run one
 * real RM1 bill (or a sandbox run with BILLPLZ_SANDBOX="1") before
 * announcing online payment.
 */
import type { Env } from "./index";

const base = (env: Env): string =>
  env.BILLPLZ_SANDBOX === "1" ? "https://www.billplz-sandbox.com/api/v3" : "https://www.billplz.com/api/v3";

const authHeader = (env: Env): string => `Basic ${btoa(`${env.BILLPLZ_SECRET}:`)}`;

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
      // Billplz requires email OR mobile; not every checkout leaves an email,
      // so fall back to a store inbox — the customer's real contact stays the
      // phone number on the order.
      email: o.email ?? "orders@elfiaofficialstore.my",
      name: o.customer_name.slice(0, 255),
      amount: String(o.total_cents), // cents, same unit as the database
      description: `ELFIA order ${o.order_number}`.slice(0, 200),
      callback_url: "https://elfiaofficialstore.my/api/v1/payments/billplz/callback",
      redirect_url: `https://elfiaofficialstore.my/order?t=${o.token}`,
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
