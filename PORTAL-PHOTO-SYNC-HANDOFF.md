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

## Ownership (v1.6.0 — the CEO's rule)

**The portal owns whatever it sends, for every matched SKU**: name,
collection, description and photo are all applied on the pull, whether the
store product was portal-created or made by hand in /admin. A field the feed
omits leaves the store's own value standing — absence means "keep", never
"delete". The photo marker still gates downloads. (v1.5.x protected
store-side copy from the feed; the CEO reversed that on 25-08 — the portal's
ELFIA tab is the catalogue's single home.)

## v1.7.0 — the discount and the carousel

Two more feed A sections, both authored in the portal's ELFIA tab:

- **`list_price_cents`** (per item, optional): sent ONLY when a discount is
  set portal-side and actually bites (`0 < discount < price`). `price_cents`
  stays what the customer pays (now net of the discount); `list_price_cents`
  is the pre-discount number. The store keeps it as `compare_price_cents`
  and draws the struck price + SALE badge. An item arriving with
  `price_cents` but no `list_price_cents` clears the badge — this pair is
  evaluated together, so "no list price" means "no sale", not "keep".
- **`slides`** (top-level, optional array): the home page hero carousel —
  `{id, image_url, image_updated_at, title?, subtitle?, sort}`. The store
  REPLACES its slide set to match the feed on every pull: this is the one
  feed section where absence-in-the-list means delete, because a slide has
  no store-side author to protect. Photos are copied into the store's own R2
  (`slides/…`, marker-gated, same 5 MB/type rules). Key absent entirely
  (portal pre-0087) = the store's slides are left alone; empty array =
  cleared. No rows = the storefront falls back to its shipped campaign
  slides.

## Proven

- Store-side unit rig: `scratch/store-sync-test.mjs` against
  `scratch/fake-portal.mjs` — 105 assertions (v1.7.0 added the discount and
  slide steps).
- The portal's serializer guard covers the omission rules (absent-when-empty,
  unknown category dropped, URL only with its marker, list price only when
  the discount bites, slides sorted with absolute URLs).
- **Cross-system**: `scratch/portal-live-e2e.mjs` runs this store's real
  Worker against the portal's real Worker (both on wrangler dev, real D1 +
  R2) — 35 assertions: create-hidden with photo/description/
  collection, marker-gated re-download, portal edit flowing across, a portal
  photo taking over a store-made product, Publish → shopfront, an ELFIA sale
  landing in the portal's stock ledger, a portal discount becoming the
  shopfront's slashed price (and clearing), and a portal slide becoming —
  then leaving — the shop's carousel.
