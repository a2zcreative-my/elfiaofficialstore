# Portal bridge — what the A2Z portal must implement

**For:** whoever maintains the agency portal repo (v1.31.0).
**Why:** ELFIA OFFICIAL STORE (elfiaofficialstore.my) and the portal sell the
same physical scarves. This contract keeps their piece counts in agreement.

Two endpoints, both on the portal, both guarded by one shared secret.

- **A — inventory feed** (already exists as of portal v1.31.0). The store reads
  it every 5 minutes. *Portal → store.*
- **B — movements** (NEW, the missing half). The store posts its own sales here
  so the portal can deduct them. *Store → portal.*

Without B, the portal never learns about a web sale and the two systems drift
apart every time the shop sells something.

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

## A — inventory feed (portal → store)

```
GET  <BRIDGE_URL>
     X-Bridge-Key: <secret>
```

**200 response**

```json
{
  "items": [
    { "sku": "LUMI001", "name": "Bawal Premium — Dusty Rose", "stock": 24 },
    { "sku": "LUMI002", "name": "Bawal Premium — Periwinkle", "stock": 0 }
  ]
}
```

| field | rule |
| --- | --- |
| `sku` | required. Matched case-insensitively against the store's SKU. |
| `stock` | required, integer ≥ 0. Pieces physically available to sell. |
| `name` | optional, for humans reading the sync report. |

Read-only: the store never writes here. `name`, price, photos and description
are the store's own and must not be sent back to it.

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
| `sku` | the product code, e.g. `LUMI001`. Match case-insensitively. |
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

## Checklist before switching it on

1. Portal: implement B, add the unique index on `event_id`, deploy.
2. Portal: `wrangler secret put ELFIA_BRIDGE_KEY` (or your equivalent).
3. Store: paste both URLs into `worker/wrangler.toml` (`BRIDGE_URL`,
   `BRIDGE_PUSH_URL`), then `cd worker && npx wrangler secret put BRIDGE_KEY`
   with **the same value**. Deploy.
4. Check `elfiaofficialstore.my/api/v1/health` shows
   `"bridge_pull_configured": true, "bridge_push_configured": true`.
5. Open /admin → Products → **Sync with portal now** and read the report.
6. Place one RM 1 test order in the store, then confirm the portal's count for
   that SKU dropped by one. Cancel the order and confirm it came back.
7. Send the same `event_id` twice by hand (curl) and confirm the portal's count
   moves only once — that is the dedupe rule working.
