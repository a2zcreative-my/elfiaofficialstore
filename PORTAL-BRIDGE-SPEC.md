# Portal bridge — what the A2Z portal must implement

**For:** whoever maintains the agency portal repo (v1.31.0).
**Why:** ELFIA OFFICIAL STORE (elfiaofficialstore.my) and the portal sell the
same physical scarves. This contract keeps their piece counts in agreement.

Three endpoints, all guarded by ONE shared secret. Two live on the portal,
one on the store:

- **A — inventory + price feed** (exists as of portal v1.31.0; price field is
  new). The store reads it every 5 minutes. *Portal → store.*
- **B — movements** (NEW). The store posts its own sales here so the portal
  can deduct them. *Store → portal.*
- **C — orders feed** (NEW, lives on the STORE). The portal polls it to pull
  every web order — items, totals, status, tracking — so everything is
  monitored in one place. *Portal ← store.*

Without B, the portal never learns about a web sale and the two systems drift
apart every time the shop sells something. Without C, web orders are invisible
from the portal.

---

## Authentication

Both endpoints require the header:

```
X-Bridge-Key: <shared secret>
```

The portal stores it as `ELFIA_BRIDGE_KEY`; the store stores the same value as
the `BRIDGE_KEY` secret. Compare it in constant time and return **401** on a
mismatch, with no body that hints at the correct value. No other auth, no
cookies, no CORS — this is server-to-server only.

---

## A — inventory + price feed (portal → store)

```
GET  <BRIDGE_URL>
     X-Bridge-Key: <secret>
```

**200 response**

```json
{
  "items": [
    { "sku": "LUMI001", "name": "Bawal Premium — Dusty Rose", "stock": 24, "price_cents": 4900 },
    { "sku": "LUMI002", "name": "Bawal Premium — Periwinkle", "stock": 0 }
  ]
}
```

| field | rule |
| --- | --- |
| `sku` | required. Matched **case- and whitespace-insensitively**: the portal's `LUMI 004` and the store's `LUMI004` are the same SKU. Each side keeps its own spelling; neither needs renaming. |
| `stock` | required, integer ≥ 0. Pieces physically available to sell. |
| `price_cents` | optional, integer > 0, **in cents** (RM 49.00 = `4900`). When present the portal owns that SKU's selling price and the store applies it on every pull. When absent the store's own price stands. Never send ringgit as a decimal — the store refuses anything that is not a positive integer. **Send the price the customer must actually pay**: if the portal runs a rebate (RM 39.00 − 3.00 → RM 36.00), `price_cents` is the NET `3600`, because this number goes straight onto the shop's price tag. |
| `name` | optional, for humans reading the sync report. |

Read-only: the store never writes here. Photos and descriptions remain the
store's own; price moves to the portal SKU by SKU, exactly when the portal
starts sending `price_cents` for it.

Return the **whole** list every time; the store diffs it. A SKU that stops
appearing is reported as unmatched, not deleted.

## B — movements (store → portal) — the new endpoint

```
POST <BRIDGE_PUSH_URL>
     X-Bridge-Key: <secret>
     Content-Type: application/json
```

**Request** (up to 50 movements per call)

```json
{
  "movements": [
    {
      "event_id": "9f1c8b2e-6a34-4f7d-9c21-0a5b7e3d1f88",
      "sku": "LUMI001",
      "delta": -2,
      "reason": "order",
      "reference": "ELF-200826-6",
      "occurred_at": "2026-08-20 11:54:03"
    }
  ]
}
```

| field | meaning |
| --- | --- |
| `event_id` | UUID. **The idempotency key — see below.** |
| `sku` | the product code, e.g. `LUMI001`. Match **case- and whitespace-insensitively** (`LUMI001` ≡ `LUMI 001`) — the store writes SKUs without spaces, the portal with. |
| `delta` | **negative** = the store sold/reserved pieces. **positive** = an unpaid order was cancelled and the pieces came back. Apply it as `stock = stock + delta`. |
| `reason` | `order` or `cancel`. Informational — `delta` already carries the direction. |
| `reference` | the store's order number, for your audit trail. May be null. |
| `occurred_at` | when the store recorded it (UTC). May be older than "now" if the portal was unreachable. |

**200 response** — the store needs to know which ids you have accounted for.
All three lists contain **`event_id` values** (not SKUs); the store maps them
back to codes itself:

```json
{
  "applied":     ["9f1c8b2e-6a34-4f7d-9c21-0a5b7e3d1f88"],
  "ignored":     ["3b7d0e91-2c55-4a10-8f3e-1d9c6b0a4e72"],
  "unknown_sku": ["c40a17ff-8e62-4b93-a5d1-7f2e0c8b6a35"]
}
```

| list | meaning | store's reaction |
| --- | --- | --- |
| `applied` | newly applied to your count | marks it delivered |
| `ignored` | you had already applied this `event_id` | marks it delivered |
| `unknown_sku` | you have no such code — nothing applied | stops retrying, shows it in /admin for a human to reconcile |

Any `event_id` **not** in one of the three lists is treated as undelivered and
**will be sent again**. That is deliberate: silence means retry.

Return a non-2xx status for a whole-request failure (bad key, database down).
The store will retry the entire batch later; nothing is lost.

### Idempotency — the one rule that must not be got wrong

> Store every `event_id` you have applied. If the same `event_id` arrives
> again, **do not apply it a second time** — put it in `ignored` and return 200.

The store retries anything it does not see acknowledged, because losing a sale
is worse than sending it twice. Without dedupe on your side, a dropped response
would deduct the same two scarves again. A unique index on the id column and an
`INSERT … ON CONFLICT DO NOTHING` is enough.

Apply the whole batch in one transaction where you can. A partial failure is
fine — just leave the ids you did not apply out of all three lists and the
store will resend them.

---

## C — orders feed (portal ← store) — poll the store

The store answers this; the portal calls it on whatever schedule suits
(every few minutes is plenty) and upserts into its own tables.

```
GET  https://elfiaofficialstore.my/api/v1/bridge/orders?since=<cursor>
     X-Bridge-Key: <the same shared secret>
```

**200 response**

```json
{
  "orders": [
    {
      "order_number": "ELF-200826-6",
      "status": "paid",
      "customer_name": "Nurul …",
      "phone": "0123456789",
      "address": "88 Jalan …",
      "items": [ { "product_id": 5, "name": "Bawal Premium — Dusty Rose", "qty": 2, "price_cents": 4900 } ],
      "subtotal_cents": 9800,
      "shipping_cents": 1000,
      "total_cents": 10800,
      "payment_method": "fpx",
      "tracking_no": null,
      "tracking_courier": null,
      "created_at": "2026-08-20 11:54:03",
      "updated_at": "2026-08-20 12:10:44"
    }
  ],
  "cursor": "2026-08-20 12:10:44",
  "store": "elfia"
}
```

Rules:

- `since` is the `cursor` from the previous response. First call: omit it.
  Rows come back oldest-change-first, at most 200 per call; keep calling with
  the new cursor until `orders` is empty, then store the cursor for next time.
- **The same order reappears every time its status changes** (paid → shipped
  → completed). Upsert by `order_number` — it is the stable key.
- `items[].price_cents` is the price **actually charged** at purchase time —
  the order's own frozen snapshot, which is the number your reports should
  use even after the portal changes a price later.
- Statuses: `pending_payment`, `payment_review`, `paid`, `shipped`,
  `completed`, `cancelled`. A `cancelled` order's pieces have already come
  back through feed B — do not add them again.
- The customer's private order-page token is deliberately not included.
- **`marketing_consent`** (v1.3.0): `1` when the buyer ticked the PDPA
  marketing box at checkout, else `0` (absent on a pre-0012 store).
  **Marketing lists on the portal side must be built ONLY from rows where
  this is `1`** — everyone else gave their details to receive a parcel, not
  promotions. Consent is withdrawable on the store; a later re-send of the
  same order carries the current value, so upserts keep the portal honest.

---

## D — traffic feed (portal ← store) — poll the store (v1.2.0)

Anonymous visitor aggregates for the portal's "ELFIA Traffic" map. The store
counts page views from a browser beacon, groups them by Malaysian state, city
and page **with no way to name a person** — no IP is stored, the per-day
visitor hash rotates its key daily so nobody can be followed across days, and
this feed carries only the aggregates (no hashes at all).

```
GET  https://elfiaofficialstore.my/api/v1/bridge/traffic?since=<day>
     X-Bridge-Key: <the same shared secret>
```

**200 response**

```json
{
  "days": [
    { "day": "2026-08-23", "state": "", "city": "", "path": "", "visits": 412, "visitors": 187 },
    { "day": "2026-08-23", "state": "Selangor", "city": "Shah Alam", "path": "/", "visits": 61, "visitors": 40 },
    { "day": "2026-08-23", "state": "Selangor", "city": "Shah Alam", "path": "/p?id=5", "visits": 22, "visitors": 18 }
  ],
  "final_through": "2026-08-23",
  "running_day": "2026-08-24",
  "store": "elfia"
}
```

Rules:

- `since` is the newest **final** day the portal already holds (`final_through`
  from the previous response). First call: omit it and take everything the
  store still has. Rows come back day-ordered, at most 2000 per call.
- **Days are Malaysian calendar days** (UTC+8), the same clock as order
  numbers.
- A day ≤ `final_through` is **final** — the store never touches it again.
  `running_day` (today) is a **running total**, resent on every poll:
  **replace** your copy of any day you receive, never add to it, and advance
  your cursor only to `final_through`.
- The row with `state = "" , city = "", path = ""` is the **whole-day total**;
  its `visitors` is the day's true unique count. Per-state/city/page rows
  carry their own `visits` (sum cleanly) and `visitors` (do **not** sum these
  across rows — distinct visitors overlap between groups; use the total row).
- Foreign visits arrive as `state = "Outside Malaysia"` with the country code
  in `city`.
- Aggregates refresh on the store's 5-minute cron, so `running_day` numbers
  are at most ~5 minutes behind the live site. Raw hits are kept 60 days;
  aggregate rows are kept indefinitely.
- Same auth and failure shapes as feed C: 501 until `BRIDGE_KEY` is set,
  401 on a wrong key, constant-time compare.

---

## Behaviour worth knowing about on the store side

- **Sales are pushed immediately** when an order is placed, and again on the
  5-minute cron for anything that failed. Movements are written to an outbox
  in the same database transaction as the order, so a network failure delays
  delivery — it never loses it.
- **The store will not overwrite a count it knows is stale.** If a SKU still
  has undelivered movements, the next pull *skips* that SKU rather than
  accepting a number the portal computed before it heard about our sales.
  This is what stops the two systems from fighting.
- **The store never sends absolute counts** — only deltas. The portal owns the
  true number.
- **Products can be "always available"** in the store, where the count is
  ignored for display. Movements are still pushed for them: the store does not
  gate on the number, but the portal still needs to know the pieces went.
- **A SKU the feed carries becomes counted automatically.** On the first pull
  that matches it, the store switches that product from "always available" to
  counted, shows the exact piece count on the product page, and enforces it at
  checkout. The portal's number is the shop's number from that moment on.

## Checklist before switching it on

1. Portal: implement B, add the unique index on `event_id`, deploy.
2. Portal: `wrangler secret put ELFIA_BRIDGE_KEY` (or your equivalent).
3. Store (all three are secrets — the portal's domain never enters the repo):
   `cd worker`, then `npx wrangler secret put BRIDGE_URL`,
   `npx wrangler secret put BRIDGE_PUSH_URL`, and
   `npx wrangler secret put BRIDGE_KEY` with **the same value as the
   portal's**. Deploy.
4. Check `elfiaofficialstore.my/api/v1/health` shows
   `"bridge_pull_configured": true, "bridge_push_configured": true`.
5. Open /admin → Products → **Sync with portal now** and read the report.
6. Place one RM 1 test order in the store, then confirm the portal's count for
   that SKU dropped by one. Cancel the order and confirm it came back.
7. Send the same `event_id` twice by hand (curl) and confirm the portal's count
   moves only once — that is the dedupe rule working.
8. Portal: poll feed C once with the key and confirm the RM 1 test order comes
   back with its items and status; change a `price_cents` in the portal and
   confirm the store shows the new price within 5 minutes.
