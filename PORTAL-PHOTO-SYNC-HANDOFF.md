# Feed A product dressing — the IMPLEMENTED contract (store v1.5.1)

*This file used to be a request to the portal chat. As of 25-08-2026 both
sides are BUILT: the portal has its ELFIA tab (photo upload, description,
collection, publish), and this store creates and dresses products from the
feed. What follows is the record of the contract as it now runs, kept next to
`PORTAL-BRIDGE-SPEC.md`, which it extends. Everything agreed there stands —
same endpoints, same `X-Bridge-Key`, same 5-minute cron, same case- and
whitespace-insensitive SKU matching.*

---

## Feed A — the four + one optional fields

`GET <portal>/api/v1/bridge/elfia-inventory` items may carry, per SKU:

| Field | Type | Store behaviour |
| --- | --- | --- |
| `name` | string | Required for a NEW SKU to be created; without it the SKU is only reported, as before. Portal-created products follow later renames. |
| `category` | `"bawal"` \| `"shawl"` | The ELFIA collection. Absent = bawal on creation; portal-created products follow later changes. The portal omits anything else rather than sending a value the store would refuse. |
| `description` | string ≤ 2000 | The product page's write-up. Set at creation; portal-created products follow later edits. **Never overwrites a description typed in the store's /admin on a hand-made product.** |
| `image_url` | https URL | Public, unauthenticated. The store copies the file ONCE into its own R2 (5 MB cap, JPEG/PNG/WEBP, 10s timeout) and serves it itself — never hot-links. Sent only together with `image_updated_at`. |
| `image_updated_at` | opaque string | Change marker. The store re-downloads only when it differs from the one it stored, so repeating it every 5 minutes costs nothing. |

Every field is optional and **absent means "the store keeps what it has"** —
a feed without them behaves exactly as before v1.5.0.

`price_cents` keeps its standing rule: integer sen, NET of any rebate, absent
= the store's own price stands.

## What the store does with an unmatched SKU

A feed item whose SKU the store has never seen, carrying a `name` and a
usable price, is **created hidden** (`active = 0`, `portal_pending = 1`) and
waits in **/admin → Products → From portal** for a human to Publish or
Dismiss. Nothing the feed invents reaches a customer unreviewed. Without a
name or a positive price it is only reported — a product needs something to
be called and something to be sold for.

## Photo ownership (both sides hold the same doctrine)

The feed may FILL an empty photo and may REPLACE one it delivered itself; it
never overwrites a photo uploaded in the store's /admin. Symmetrically, the
portal's tab is where the photo is uploaded once — nobody uploads the same
file twice.

## Proven

- Store-side unit rig: `scratch/store-sync-test.mjs` against
  `scratch/fake-portal.mjs` — 92 assertions.
- The portal's serializer guard covers the four fields' omission rules
  (absent-when-empty, unknown category dropped, URL only with its marker).
- **Cross-system**: `scratch/portal-live-e2e.mjs` runs this store's real
  Worker against the portal's real Worker (both on wrangler dev, real D1 +
  R2) — 22 assertions, run twice: create-hidden with photo/description/
  collection, marker-gated re-download, portal edit flowing across, /admin
  copy protected, Publish → shopfront, and an ELFIA sale landing in the
  portal's stock ledger.
