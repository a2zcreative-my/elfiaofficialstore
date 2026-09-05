/* v1.4.0 — the payment rules that the 27-08-2026 security audit found
   broken, turned into checks a build can fail.

   The audit's finding P1 was the worst kind of bug: code that looked like a
   safety net and was actually a door. When a paid bill matched no order, the
   callback fell back to the order number the CALLER had typed in
   `reference_1` and marked THAT order paid. Anyone who genuinely paid one
   RM 1 bill could replay it naming someone else's RM 100 order, for as many
   orders as they liked. Two things made it reachable: the X-Signature was
   optional (P2), so the callback authenticated nobody, and the requery only
   asked "is it paid?" and never "for how much?" (P3).

   None of it was exploitable while online payment was off — which is exactly
   why it had to be fixed BEFORE the gateway is switched on, and why these
   checks exist now rather than after the first real payment.

   Run: node tests/payment-integrity.mjs */
import { readFileSync } from "node:fs";

let failed = 0;
const fail = (msg) => { console.log(`FAIL ${msg}`); failed++; };
const ok = (msg) => console.log(`ok   ${msg}`);

const index = readFileSync("worker/src/index.ts", "utf8");
const gw = readFileSync("worker/src/bayarcash.ts", "utf8");

/* v1.46.0 — Bayarcash replaced Billplz. The three locks are the same three;
   the names changed. The hole P1 found was "the paid fact came from the
   gateway, the order it applied to came from the caller". Under Bayarcash the
   callback carries an order_number and the shop is ALLOWED to read it - but
   only to find the row. What settles the row is the payment intent the shop
   itself created for it, re-read over our token, and that record's own
   order_number and amount. These checks hold that shape. */

/* Isolate the callback handler — every rule below is about THIS block. */
const start = index.indexOf('if (path === "/payments/bayarcash/callback"');
if (start < 0) { console.log("FAIL the Bayarcash callback handler is gone from index.ts"); process.exit(1); }
const cb = index.slice(start, start + 6000);

/* ---- P1: the order is settled by Bayarcash's record, never by the caller ---- */
{
  if (!/const intent = await bayarcashFetchIntent\(env, o\.bill_id\)/.test(cb)) {
    fail("the callback no longer re-reads the ORDER'S OWN payment intent from Bayarcash — nothing would authenticate the payment (AUDIT P1)");
  } else ok("the callback re-reads the order's own intent over the authenticated API");

  if (/fields\.status\s*===|Number\(fields\.status\)|fields\.amount/.test(cb.replace(/\/\*[\s\S]*?\*\//g, ""))) {
    fail("the callback reads status or amount from the CALLER's fields — a forged callback could settle an order (AUDIT P1)");
  } else ok("the callback never takes paid or amount from the request");

  if (!/intent\.order_number !== null && intent\.order_number !== o\.order_number/.test(cb)) {
    fail("the callback no longer checks the intent's own order_number against the row it found (AUDIT P1)");
  } else ok("the order is bound by Bayarcash's own record of the intent");

  if (!/if \(!intent\.paid\) return json/.test(cb)) {
    fail("the callback no longer requires the AUTHENTICATED intent to say paid (AUDIT P1)");
  } else ok("only Bayarcash's own 'paid' settles the order");
}

/* ---- P2: the checksum is mandatory ---- */
{
  if (!/if \(sig !== true\)/.test(cb)) {
    fail("the callback accepts a checksum result other than true — an unsigned or unconfigured callback would be processed (AUDIT P2)");
  } else ok("only a verified checksum proceeds (unconfigured is refused)");

  if (!/export function bayarcashReady\(/.test(gw)) {
    fail("bayarcashReady() is gone — the store could advertise online payment without BAYARCASH_SECRET (AUDIT P2)");
  } else {
    if (!/return bayarcashConfigured\(env\) && bayarcashSignatureConfigured\(env\);/.test(gw)) {
      fail("bayarcashReady() no longer requires the API Secret Key (AUDIT P2)");
    } else ok("online payment is only offered when the secret that verifies callbacks exists");
    /* The two doors that must use READY, not merely configured. */
    if (!/gateway: bayarcashReady\(env\)/.test(index)) fail("/store-config advertises the gateway without requiring the secret (AUDIT P2)");
    if (!/if \(!bayarcashReady\(env\)\) return err\("not_configured"/.test(index)) fail("the /pay route raises intents without requiring the secret (AUDIT P2)");
  }
  if (!/for \(const k of \["transaction_id", "exchange_reference_number", "exchange_transaction_id", "order_number", "currency", "amount", "payer_bank_name", "status", "status_description"\]\)/.test(gw)) {
    fail("the callback checksum is not computed over Bayarcash's nine v3 fields — every genuine callback would be refused, or a forged one accepted");
  } else ok("the checksum covers exactly the nine fields Bayarcash signs");
  if (!/constantTimeEqual\(expected\.toLowerCase\(\), given\.toLowerCase\(\)\)/.test(gw)) fail("the checksum is not compared in constant time");
}

/* ---- P3: the money must cover the order ---- */
{
  if (!/intent\.amount_cents === null \|\| intent\.amount_cents < o\.total_cents/.test(cb)) {
    fail("the callback no longer compares the amount paid against the order total — a RM 1 payment could settle a RM 100 order (AUDIT P3)");
  } else ok("a payment smaller than the order total never marks it paid");

  if (!/export async function bayarcashPaidFor\(\s*env: Env, intentId: string, expectCents: number, orderNumber: string,/.test(gw)) {
    fail("bayarcashPaidFor no longer REQUIRES an expected amount and order number — the check could be skipped by a caller (AUDIT P3)");
  } else ok("bayarcashPaidFor cannot be called without an expected amount and order number");

  if (!/const settledNow = await bayarcashPaidFor\(env, o\.bill_id, o\.total_cents, o\.order_number\)/.test(index)) {
    fail("the verify-payment route no longer asks the full question (paid, amount, order number) (AUDIT P3)");
  } else ok("the customer's own verify route asks the same three questions");

  /* The unit boundary: the database is in sen, Bayarcash is in ringgit. The
     conversion must live in one place, and the amount sent must be the
     amount signed. */
  if (!/export const ringgit = \(cents: number\): string => \(cents \/ 100\)\.toFixed\(2\);/.test(gw)) {
    fail("the sen -> ringgit conversion is gone or moved — a RM 39.00 order sent as 3900 would be a RM 3,900 charge");
  } else ok("sen becomes ringgit in exactly one place");
  if (!/const amount = ringgit\(o\.total_cents\);/.test(gw) || !/amount,\s*payer_name,\s*payer_email,\s*\};/.test(gw)) {
    fail("the amount sent to Bayarcash is not the one that was signed");
  } else ok("the amount signed is the amount sent");
}

/* ---- the refusals are visible ---- */
{
  if (!/logPaymentRefusal/.test(cb)) {
    fail("payment refusals are no longer recorded — a customer who paid would have no trace anyone could find");
  } else ok("every refusal is written down for a human");
}

/* ---- ST1: the receipt cap does not trust a header ---- */
{
  if (/const len = Number\(request\.headers\.get\("Content-Length"\) \?\? "0"\);\s*\n\s*if \(len > 5 \* 1024 \* 1024\) return err[\s\S]{0,200}MEDIA\.put\(key, request\.body/.test(index)) {
    fail("the receipt upload trusts Content-Length again — a chunked upload would stream into R2 unbounded (AUDIT ST1)");
  }
  if (!/fileBytes\.byteLength > RECEIPT_MAX/.test(index)) {
    fail("the receipt upload no longer measures the bytes it actually received (AUDIT ST1)");
  } else ok("the receipt size cap is enforced on real bytes, not a header");
}

/* ---- ST2: the bridge feeds are rate-limited ---- */
{
  if (!/async function bridgeAuth\(/.test(index)) {
    fail("bridgeAuth() is gone — the bridge key could be guessed at unlimited speed (AUDIT ST2)");
  } else {
    const feeds = ["/bridge/orders", "/bridge/traffic"];
    for (const f of feeds) {
      const i = index.indexOf(`if (path === "${f}"`);
      if (i < 0) continue;
      if (!/bridgeAuth\(request, env\)/.test(index.slice(i, i + 500))) {
        fail(`${f} does not use the rate-limited bridgeAuth() (AUDIT ST2)`);
      }
    }
    ok("both bridge feeds authenticate through the rate-limited gate");
  }
}

/* ---- ST5: the visitor hash has no public fallback key ---- */
{
  const traffic = readFileSync("worker/src/traffic.ts", "utf8");
  if (/\?\? "elfia-traffic"/.test(traffic)) {
    fail("the visitor hash falls back to a hardcoded key again — anyone could recompute a visitor's daily hash (AUDIT ST5)");
  } else ok("the visitor hash has no public fallback key");
  if (!/TRAFFIC_HMAC_KEY/.test(traffic)) fail("the dedicated TRAFFIC_HMAC_KEY is gone (AUDIT ST5)");
}

/* ---- C9: the rate limiter decides atomically ---- */
{
  const auth = readFileSync("worker/src/auth.ts", "utf8");
  if (!/RETURNING hits/.test(auth)) {
    fail("hitLimit no longer decides from the stored count — parallel requests could all pass a limit (AUDIT C9)");
  } else ok("the rate limiter increments and decides in one statement");
}

/* ---- C4: a cookie-bearing request with no Origin is refused ---- */
{
  if (!/if \(!origin\) return !request\.headers\.get\("Cookie"\)/.test(index)) {
    fail("originAllowed waves through a missing Origin again (AUDIT C4)");
  } else ok("a request carrying our cookie must declare its origin");
}

if (failed) { console.error(`\n${failed} payment-integrity check(s) failed.`); process.exit(1); }
console.log("\npayment-integrity: money can only be credited by Bayarcash, to the right order, for the right amount.");
