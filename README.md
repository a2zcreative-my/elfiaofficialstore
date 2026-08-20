# ELFIA OFFICIAL STORE — direct ecommerce

Standalone system for elfiaofficialstore.my. Next.js static storefront
(Cloudflare Pages) + TypeScript Worker (`elfia-api`) + D1 (`elfia-store`)
+ R2 (`elfia-media`).

Customer flow: catalogue → cart → checkout (order priced and placed
server-side) → order page with bank details, FPX button, WhatsApp and receipt
upload → you confirm in /admin → ship with tracking → delivered. Statuses only
move forward; cancelling an unpaid order restocks automatically.

The customer follows all of that on their own order page: a timestamped
progress timeline, a courier tracking link once it ships, and — if they lose
the link — **/track**, which finds it again from their order number and the
phone they used. Each time you move an order forward, /admin hands you a
WhatsApp message already written, with that link in it.

## Before you announce the shop

Set these in `worker/wrangler.toml` [vars] and redeploy — each one changes what
customers see:

| Setting | What breaks if it is wrong |
| --- | --- |
| `BANK_LINE` | The order page shows "REPLACE — …" instead of your account |
| `WHATSAPP_DIGITS` | The floating chat button stays hidden |
| `SHIPPING_CENTS` / `FREE_ABOVE_CENTS` | Delivery charge and the free-delivery bar |

## Availability — why nothing says "Sold out"

Every product has an availability mode (v0.7.0, `track_stock`):

- **Always available** — the piece count is ignored, the design can always be
  ordered. All ten Bawal designs are set to this, because they were seeded at
  0 and were showing Sold out while actually in stock.
- **Count stock** — tick "Count stock for this product" in /admin → Products.
  Orders decrement it, it sells out at zero, an unpaid cancel puts the pieces
  back, and two buyers can never share the last one.

Switch designs to counting once the real numbers are in — they arrive by
themselves from the portal (see below), or type them in /admin.

## Inventory sync with the agency portal

The store and the portal sell the same physical pieces, so they exchange
inventory both ways:

- **↓ Counts in** — every 5 minutes the store reads the portal's inventory
  feed and refreshes its own numbers, matched by SKU.
- **↑ Sales out** — the moment an order is placed, the store reports what it
  took (`−2 LUMI001`); a cancelled unpaid order reports it back (`+2`). These
  go into an outbox first, so if the portal is down the sale waits and is
  delivered later. Nothing is lost.

The store never sends absolute counts — the portal owns the true number. And
the store will not accept a count for a SKU whose sales the portal has not yet
seen, so a stale number can never put sold pieces back on the shelf.

To switch it on, both sides must hold the same secret:

1. The portal needs one new endpoint — hand **`PORTAL-BRIDGE-SPEC.md`** to
   whoever maintains that repo.
2. Paste both URLs into `worker/wrangler.toml`: `BRIDGE_URL` (the portal's
   inventory feed) and `BRIDGE_PUSH_URL` (where movements are posted).
3. `cd worker && npx wrangler secret put BRIDGE_KEY` — the same value the
   portal stores as `ELFIA_BRIDGE_KEY`. Deploy.
4. `/api/v1/health` should show `bridge_pull_configured: true` and
   `bridge_push_configured: true`. /admin → Products shows live sync health.

Until then the store records its sales but cannot deliver them, and /admin
says so in red rather than pretending everything is fine.

## Turning on online payment (Billplz FPX)

1. In the Billplz dashboard, create a Collection and copy its **Collection ID**;
   from Settings copy the **API Secret Key**.
2. To rehearse first, use a separate **billplz-sandbox.com** account's
   credentials and add `BILLPLZ_SANDBOX = "1"` under `[vars]`.
3. `cd worker`, then:
   `npx wrangler secret put BILLPLZ_SECRET` and
   `npx wrangler secret put BILLPLZ_COLLECTION`.
4. Redeploy, open **/admin → Orders → Test online payment (Billplz)**. It reads
   your collection and names the exact problem if there is one. No bill is
   created and no money moves.
5. When it says connected, place one real RM 1 order and pay it. Then remove
   `BILLPLZ_SANDBOX` (if set) and repeat step 4 against the live account.

The customer's order page shows "Pay online now — RM xx.xx (FPX / online
banking)" the moment both secrets exist; bank transfer stays underneath.

## The rules this system will not bend

- Prices and stock are decided by the Worker — the browser is never trusted.
  A tampered cart cannot buy below list.
- Receipts live under R2 `receipts/` and are only readable with the admin key.
- A payment is only ever marked paid from an authenticated read of the bill
  against Billplz's own API — never from a callback's parameters, and never
  from the URL the customer came back with.
- Paid orders cannot be silently cancelled; a refund is a human decision.

## Testing it yourself

Three harnesses, all running the real Worker against a local D1 — see each
file's header for the setup:

- `scratch/store-e2e-live.mjs` — 59 API assertions (pricing, stock, orders,
  progress history, order lookup and its rate limiting)
- `scratch/store-journey.mjs` — a real browser purchase, start to finish
- `scratch/store-sync-test.mjs` + `scratch/fake-portal.mjs` — 24 assertions on
  the two-way inventory sync, including the portal being offline mid-sale

Nothing touches the live database.

Deploy: follow the one-time steps in the header of `DEPLOY.bat`, then run
`DEPLOY.bat` for every release.
