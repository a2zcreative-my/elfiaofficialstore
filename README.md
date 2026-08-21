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

## Secrets — none of them live in this repo

Set each from your own machine; the value is never written to a file:

```
cd worker
npx wrangler secret put ADMIN_KEY            # the /admin passcode
npx wrangler secret put BILLPLZ_SECRET       # Billplz API Secret Key
npx wrangler secret put BILLPLZ_COLLECTION   # Billplz Collection ID
npx wrangler secret put BILLPLZ_XSIGN        # Billplz X Signature Key
npx wrangler secret put BRIDGE_KEY           # shared with the portal
npx wrangler secret put BRIDGE_URL           # portal inventory+price feed
npx wrangler secret put BRIDGE_PUSH_URL      # portal movements endpoint
```

`node tests/no-secrets.mjs` fails the build if a credential is ever committed —
DEPLOY.bat runs it before anything is uploaded. If a key has ever been pasted
into a chat, an email or a screenshot, rotate it in the Billplz dashboard and
set the new one here.

## Before you announce the shop

Set these in `worker/wrangler.toml` [vars] and redeploy — each one changes what
customers see:

| Setting | What breaks if it is wrong |
| --- | --- |
| `BANK_LINE` | The order page shows "REPLACE — …" instead of your account |
| `WHATSAPP_DIGITS` | The floating chat button stays hidden |
| `SHIPPING_CENTS` / `FREE_ABOVE_CENTS` | Delivery charge and the free-delivery bar |
| `STORE_URL` | Billplz callback/redirect URLs and the allowed origins |
| `ORDER_HOLD_HOURS` / `MAX_OPEN_ORDERS` | How long an unpaid order holds stock, and how many one phone may hold |

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

- **↓ Counts and prices in** — every 5 minutes the store reads the portal's
  inventory feed and refreshes its numbers, matched by SKU. When the feed
  carries `price_cents` for a SKU, the portal owns that selling price and the
  store applies it — prices are controlled in /portal.
- **↑ Sales out** — the moment an order is placed, the store reports what it
  took (`−2 LUMI001`); a cancelled unpaid order reports it back (`+2`). These
  go into an outbox first, so if the portal is down the sale waits and is
  delivered later. Nothing is lost.
- **↑ Whole orders out** — the portal polls `GET /api/v1/bridge/orders`
  (same shared key, cursor-based) and receives every web order with its
  items, totals, status and tracking, re-sent on every status change. Web
  orders are monitored from the portal like everything else.

The store never sends absolute counts — the portal owns the true number. And
the store will not accept a count for a SKU whose sales the portal has not yet
seen, so a stale number can never put sold pieces back on the shelf.

To switch it on, both sides must hold the same secret:

1. The portal needs the movements endpoint and the orders-feed poller — hand
   **`PORTAL-BRIDGE-SPEC.md`** to whoever maintains that repo. (Adding
   `price_cents` to its existing feed is the change that moves pricing there.)
2. `cd worker`, then set all three as secrets — the portal's domain never
   enters a committed file: `npx wrangler secret put BRIDGE_URL`,
   `npx wrangler secret put BRIDGE_PUSH_URL`,
   `npx wrangler secret put BRIDGE_KEY` (same value as the portal's
   `ELFIA_BRIDGE_KEY`). Deploy.
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

## Accounts, and unpaid orders

- **Accounts are optional.** /account gives a customer their order history and
  a saved address; guests still buy without one. A half-filled checkout is kept
  on the device either way, so a refresh loses nothing.
- **An unpaid order expires after 12 hours** — the stock goes back, the portal
  is told, and the customer sees a countdown before it happens and a plain
  explanation after. One phone may hold two unpaid orders at a time.

## The rules this system will not bend

- Prices and stock are decided by the Worker — the browser is never trusted.
  A tampered cart cannot buy below list.
- Receipts live under R2 `receipts/` and are only readable with the admin key.
- A payment is only ever marked paid from an authenticated read of the bill
  against Billplz's own API — never from a callback's parameters, and never
  from the URL the customer came back with.
- Paid orders cannot be silently cancelled; a refund is a human decision.
- A Billplz callback must carry a valid X-Signature *and* survive an
  authenticated re-query before an order is marked paid.
- Passwords are never stored, only PBKDF2 hashes; session cookies are stored
  as hashes too, so reading the database grants nobody a login.
- Guessing costs: order lookup, sign-in, sign-up and the admin passcode are all
  rate-limited per address.

## Testing it yourself

Three harnesses, all running the real Worker against a local D1 — see each
file's header for the setup:

- `scratch/store-e2e-live.mjs` — 85 API assertions (pricing, stock, orders,
  progress, lookup, order expiry, accounts, signatures, rate limits)
- `scratch/store-journey.mjs` — a real browser purchase, a refresh mid-checkout,
  /track, and creating an account
- `scratch/store-sync-test.mjs` + `scratch/fake-portal.mjs` — 24 assertions on
  the two-way inventory sync, including the portal being offline mid-sale

Nothing touches the live database.

Deploy: follow the one-time steps in the header of `DEPLOY.bat`, then run
`DEPLOY.bat` for every release.
