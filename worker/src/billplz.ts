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
