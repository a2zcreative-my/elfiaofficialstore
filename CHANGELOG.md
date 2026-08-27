# ELFIA OFFICIAL STORE — v1.40.0 (27-08-2026) — SECURITY + THE CATALOG 404

## What was broken on the live shop

**`/catalog.pdf` returned 404, and the payee line said REPLACE.** The live
Worker was running an old `wrangler.toml` — the 3.6 KB version that routes
only `/api/*` and carries placeholder values for `BANK_LINE` and
`WHATSAPP_DIGITS`. Every share link and the catalog download went nowhere,
and a customer who reached the bank-transfer panel was shown a placeholder
instead of an account number. The current `wrangler.toml` ships in this
release: the real payee line, the real WhatsApp number, `CATALOG_FILENAME`,
and the `/catalog.pdf` and `/share/*` routes.

**The store build was failing.** `lib/config.ts` on the deploy machine was a
v1.4.x file missing 22 of the exports the app imports (`toggleWish` among
them), so `next build` never finished and nothing new could ship at all.
The complete file ships here, with the audit's ST4 device-memory hardening
folded in: the remembered-order list lives in `sessionStorage`, expires
after 30 days, and `clearRemembered()` wipes it.

## The audit's remaining Critical/High findings, closed

**The callback is bound to Billplz's own record (P1).** v1.39.0 removed the
`reference_1` fallback by matching on bill id alone, which also broke the
pre-0003 case where the bill id could not be written back to the order row.
The callback now makes ONE authenticated read — `GET /bills/{id}` with our
secret key — and takes the order name, the paid flag, the settled amount and
the collection all from that single record. `reference_1` still names the
order; the copy that decides is Billplz's, never the caller's. A forged
callback can name any bill id it likes and still only moves the order that
bill was raised for.

**Online payment is offered only when it can be verified (P2).** New
`billplzReady()` = configured **and** `BILLPLZ_XSIGN` set. `/store-config`
advertises the gateway through it and `/pay` refuses to raise a bill without
it, so a shop that cannot check a callback shows bank transfer instead.

**Every refusal is written down (P1/P3).** A payment that is refused now
records the reason in `sync_state.last_payment_refusal`, where the portal's
ELFIA tab can read it. A customer whose money left their account and whose
order still says "awaiting payment" is a phone call, and whoever answers it
needs the reason.

**The receipt cap counts real bytes (ST1).** The 5 MB limit read
`Content-Length` and then streamed the body into R2. A chunked upload sends
no `Content-Length`, so the cap passed and an unbounded stream went into the
bucket. The bytes are read first and their actual length decides.

**The bridge key costs something to guess (ST2).** All seven `/bridge/*`
routes now go through one `bridgeAuth()` — the same hashed constant-time
compare, plus a counted window: twenty wrong keys from an address in fifteen
minutes and it is refused until the window passes. A correct key clears the
count, so the portal never meets the limiter.

**A cookie without an Origin is refused (C4).** A missing `Origin` used to be
waved through as "server-to-server, curl". Browsers omit it on plain form
POSTs too — and still attach our cookie, which is exactly the shape of a
CSRF. A request carrying our session must now declare where it came from;
server-to-server callers send no cookie and are unaffected.

**The visitor hash has its own key (ST5).** `TRAFFIC_HMAC_KEY`, with no
public fallback: with none set, traffic declines to count rather than
counting de-anonymisably.

**The rate limiter decides atomically (C9).** `hitLimit` increments and reads
in one `RETURNING hits` statement, so parallel requests cannot all pass the
same limit.

## Guards

`tests/payment-integrity.mjs` (14 checks) fails the build if any of the above
is undone. `scratch/payment-integrity-check.mjs` runs 24 forgery attempts
against a live local Worker; `scratch/expiry-race-check.mjs` proves the cron
cannot cancel an order that became paid. All green, alongside the existing
brand-isolation, bank-line, no-secrets, migration-safety and
worker-compile-gate guards and the 176-check store/portal sync rig.

## Deploy note

`BILLPLZ_XSIGN` must be set for online payment to appear at all. The Billplz
credentials that were pasted into chat must be **rotated in the Billplz
dashboard** and re-set from your own machine:

    npx wrangler secret put BILLPLZ_SECRET
    npx wrangler secret put BILLPLZ_COLLECTION
    npx wrangler secret put BILLPLZ_XSIGN
    npx wrangler secret put TRAFFIC_HMAC_KEY

---

# ELFIA OFFICIAL STORE — v1.39.0 (27-08-2026) — SECURITY

## Only Billplz, about the right bill, can mark an order paid

The audit of 27-08-2026 found one Critical and two Highs in the money path.
All three are closed here. **Read the deploy note at the bottom before
running PUSH.bat.**

**The Critical — a callback could name someone else's order.** The callback
re-queried Billplz to prove a bill was paid (correct), then, if that bill
matched no waiting order, fell back to the order number echoed in
`reference_1` — which arrives **in the request**. The paid fact came from
Billplz; the order it was applied to came from the caller; nothing tied
them together. Anyone who paid one small order of their own held a real
paid bill id, and could use it to mark any other order paid — including a
stranger's, since order numbers are sequential. The fallback is gone. The
order is now found by the bill id the shop itself recorded when it created
the bill, and nothing about which order was paid is ever read from the
request.

**The signature is now mandatory.** It used to be optional: with no
`BILLPLZ_XSIGN` set, verification returned "unconfigured" and every forged
callback walked through to the requery. The key is now part of being
configured, so a shop without it creates **no bills at all** and shows bank
transfer instead — declining a payment it cannot verify, rather than
accepting money it cannot prove arrived.

**The money is checked, not just the fact of payment.** A bill must come
back paid, for this order's exact amount in sen, in our own collection. A
paid RM 1 bill can no longer settle an RM 300 order.

**The twelve-hour release can no longer cancel an order that was just
paid.** Its `UPDATE … cancelled` carried no status predicate, and the job
runs every minute — so a payment landing between the job's read and its
write was overwritten to cancelled, the goods went back on the shelf and
the portal was told to restock, while the customer's money had moved. The
cancellation is now the claim: only the run that actually moves the row out
of pending gets to restock.

**Also:** a failed fetch of a shipped image is a 404 rather than a 500, and
those routes now send `X-Content-Type-Options: nosniff`.

**New rigs:** `scratch/payment-integrity-check.mjs` (11 checks — 24 forgery
attempts across both methods and every parameter spelling, the mandatory
signature, and a sweep proving no other public route can write `paid`) and
`scratch/expiry-race-check.mjs` (11 checks — the paid order survives, the
unpaid one is still released exactly once, plus a source-shape guard that
fails if the cancel ever loses its status predicate again).

### DEPLOY NOTE — do this in order

1. **Rotate** the three Billplz keys in the dashboard (they were pasted into
   a chat on 26-08 and have not been rotated).
2. From `worker\`: `npx wrangler secret put BILLPLZ_SECRET`, then
   `BILLPLZ_COLLECTION`, then **`BILLPLZ_XSIGN`**.
3. Then PUSH.bat.

If step 2 is skipped, online payment switches itself off and checkout falls
back to bank transfer — deliberately. Check with:
`curl -s https://elfiaofficialstore.my/api/v1/health | grep gateway`

