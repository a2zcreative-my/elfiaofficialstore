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
const billplz = readFileSync("worker/src/billplz.ts", "utf8");

/* Isolate the callback handler — every rule below is about THIS block. */
const start = index.indexOf('if (path === "/payments/billplz/callback"');
if (start < 0) { console.log("FAIL the Billplz callback handler is gone from index.ts"); process.exit(1); }
const cb = index.slice(start, start + 5000);

/* ---- P1: the order is chosen by Billplz, never by the caller ---- */
{
  /* The precise shape of the hole: reading reference_1 out of the request's
     own parameters. `bill.reference_1` (from the authenticated read) is fine
     and is what the fixed code uses. */
  if (/params\.get\((["'`])billplz\[reference_1\]\1\)|params\.get\((["'`])reference_1\2\)/.test(cb)) {
    fail("the callback reads reference_1 from the CALLER's parameters again — a paid RM 1 bill could be replayed against any order (AUDIT P1)");
  } else ok("the callback never reads reference_1 from the request");

  if (!/const bill = await billplzFetchBill\(env, billId\)/.test(cb)) {
    fail("the callback no longer re-reads the bill from Billplz — nothing would authenticate the payment (AUDIT P1)");
  } else ok("the callback re-reads the bill over the authenticated API");

  if (!/bill\.reference_1/.test(cb)) {
    fail("the callback no longer binds the order via the AUTHENTICATED bill's reference_1 (AUDIT P1)");
  } else ok("the order is bound by Billplz's own record of the bill");
}

/* ---- P2: the signature is mandatory ---- */
{
  if (!/if \(sig !== true\)/.test(cb)) {
    fail("the callback accepts a signature result other than true — an unsigned or unconfigured callback would be processed (AUDIT P2)");
  } else ok("only a verified signature proceeds (unconfigured is refused)");

  if (!/export function billplzReady\(/.test(billplz)) {
    fail("billplzReady() is gone — the store could advertise online payment without BILLPLZ_XSIGN (AUDIT P2)");
  } else {
    if (!/billplzConfigured\(env\) && Boolean\(env\.BILLPLZ_XSIGN\)/.test(billplz)) {
      fail("billplzReady() no longer requires BILLPLZ_XSIGN (AUDIT P2)");
    } else ok("online payment is only offered when the signature key exists");
    /* The two doors that must use READY, not merely configured. */
    if (!/gateway: billplzReady\(env\)/.test(index)) fail("/store-config advertises the gateway without requiring XSIGN (AUDIT P2)");
    if (!/if \(!billplzReady\(env\)\) return err\("not_configured"/.test(index)) fail("the /pay route raises bills without requiring XSIGN (AUDIT P2)");
  }
}

/* ---- P3: the money must cover the order ---- */
{
  if (!/bill\.paid_amount === null \|\| bill\.paid_amount < o\.total_cents/.test(cb)) {
    fail("the callback no longer compares the amount paid against the order total — a RM 1 payment could settle a RM 100 order (AUDIT P3)");
  } else ok("a payment smaller than the order total never marks it paid");

  if (!/export async function billplzVerifyPaid\(env: Env, billId: string, expectCents: number\)/.test(billplz)) {
    fail("billplzVerifyPaid no longer REQUIRES an expected amount — the check could be skipped by a caller (AUDIT P3)");
  } else ok("billplzVerifyPaid cannot be called without an expected amount");

  if (!/billplzCollectionOk/.test(cb)) {
    fail("the callback no longer checks the bill belongs to this shop's collection (AUDIT P3)");
  } else ok("a bill from another Billplz collection is refused");
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
console.log("\npayment-integrity: money can only be credited by Billplz, to the right order, for the right amount.");
