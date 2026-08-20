# ELFIA OFFICIAL STORE — changelog

## [0.5.0] — 20-08-2026 — the ten-piece Bawal range

The CEO's new photo pack replaces the first one outright: ten Bawal designs
shot individually plus two group campaign shots.

- **LUMI001–LUMI010 are the catalogue now** (migration 0005). Named by colour
  to stay easy to reconcile against the A2Zcreative stock list:
  Dusty Rose, Periwinkle, Lavender, Silver Grey, Pastel Aurora, Dawn Blue
  (RM 49) and Navy Gold, Midnight Gold, Olive Floral, Mauve Floral (RM 59 —
  the four printed gold-line and floral designs). Dusty Rose, Pastel Aurora,
  Navy Gold and Mauve Floral are ★ Featured, so they ride the hero carousel.
- ⚠ **STOCK IS 0 ON EVERY DESIGN — the shop reads "Sold out" until you fix
  that.** Deliberate: nothing can be oversold before the counts are real.
  Open /admin → Products and type the numbers, or press "Sync stock from
  portal" to pull them from A2Zcreative by SKU. Do this before announcing.
- **The old placeholder rows are retired, not deleted** — set to hidden, and
  their LUMI001–LUMI004 codes released so no two rows share a code (the
  portal sync matches by SKU and must never see a duplicate). Scoped to rows
  still carrying a first-pack photo (`/collection/shawl-*.jpg`): if you had
  replaced a photo in /admin, that row is yours and is untouched. Hidden rows
  can be restored or deleted by hand in /admin → Products.
- **Two new hero slides** — the studio group shot and the salon group shot —
  replace the three first-pack campaign slides, which are removed from the
  build. Portrait group photos crop badly from the top (all ceiling), so each
  brand slide now carries its own crop position. The first pack's *product*
  photos stay in `public/collection/` (~460 KB) so a retired row still renders
  if you unhide it; delete them once you are sure none will come back.
- **Product pages show the whole photo.** The detail image is 3:4, the shape
  of the photography, instead of a square centre-crop that clipped the top of
  the hijab. The catalogue grid stays square for tidy rows.
- Prices are live, not placeholders, for the first time. Stock is not.

## [0.4.0] — 20-08-2026 — the real logo, all-Bawal photos, and portal stock sync

- **The ELFIA wordmark** (CEO's file) now heads every page and the footer,
  and is the favicon. Served from the site itself — no external dependency.
- **Every photo in the pack is Bawal** (CEO: "the photo that I provided
  which is Bawal"). Migration 0004 corrects the one seeded row that 0002
  had guessed into Shawl from its filename: it becomes LUMI004 "Bawal
  Premium — Grey (styled)". Guarded to the untouched seed only — if it was
  already edited in /admin, nothing changes. Shawl is now an empty
  collection awaiting its own products and code series.
- **Sync stock from portal** (CEO: "how to update all the inventory to
  match with inventory in A2Zcreative??") — a button in /admin → Products.
  It pulls the live-session inventory counts from the agency portal's
  read-only bridge and updates matching products BY SKU (case-insensitive).
  Stock ONLY — prices, photos, descriptions and categories remain the
  store's own. SKUs that exist on one side but not the other are LISTED in
  the result, never guessed, so the two systems can be reconciled by hand
  once and stay honest. Admin-triggered only; nothing syncs by itself.
- One-time setup for the sync (both sides must hold the same secret):
  1. Portal repo (v1.31.0): `wrangler secret put ELFIA_BRIDGE_KEY`
  2. This repo: paste the portal's bridge URL into BRIDGE_URL in
     worker/wrangler.toml, then `wrangler secret put BRIDGE_KEY`
  3. Redeploy both. /api/v1/health shows bridge_configured:true.

## [0.3.0] — 20-08-2026 — Billplz is the gateway

**CEO: "I am using Billplz for the gateway payment."** The Stage B module is
now Billplz (v3 API, verified against their docs); ToyyibPay is gone.

- **"Pay online now — RM xx.xx (FPX / online banking)"** appears on the order
  page the moment the two secrets exist — one tap to Billplz's payment page,
  automatic redirect back, status flips to *Payment confirmed* by itself.
  Bank transfer + receipt upload stays underneath as the manual path.
- **Callback parameters are never trusted.** Billplz's callback supplies only
  the bill id; the worker re-queries GET /api/v3/bills/{id} with the secret
  key, and only paid:true from that authenticated read marks the order paid
  (matched by the bill id stored on the order — migration 0003).
- **Sandbox switch built in:** set `BILLPLZ_SANDBOX = "1"` under [vars] with
  a billplz-sandbox.com account's credentials to rehearse the full payment
  loop without real money. Remove it for production.
- To go live: `wrangler secret put BILLPLZ_SECRET` (API Secret Key) and
  `wrangler secret put BILLPLZ_COLLECTION` (Collection ID), then redeploy.
  Amounts are sent in cents — RM 49.00 = 4900 — the same unit as the
  database, so no conversion exists to get wrong.
- ⚠ Flagged UNTESTED against the live gateway until one sandbox run or one
  real RM1 bill succeeds — do that before announcing online payment.

## [0.2.0] — 20-08-2026 — the collections release

**CEO: "add this photo for the collection of Bawal… make carousel slide
automatically on the main… I can update the image and change the prices,
description, product category and other details… 2 collections, Bawal and
Shawl, Bawal starting with LUMI code."**

- **Hero carousel on the home page** — auto-advances every 4.5 seconds,
  pauses under the pointer, arrows + dots for manual control. Slides are the
  three ELFIA campaign photos plus every product marked ★ Featured in
  /admin; a featured slide clicks straight through to its product.
- **Two collections** — every product is Bawal or Shawl; the catalogue gets
  All / Bawal / Shawl tabs and each product carries a SKU (Bawal = LUMI001,
  LUMI002, …). Product pages and admin rows show code + collection.
- **/admin now edits everything** — name, description, price, stock, SKU,
  collection, featured, photo, show/hide. (Photo uploads go to R2; the
  seeded photos ship with the site itself.)
- **Seeded from the photo pack** (migration 0002): LUMI001 Beige, LUMI002
  Taupe, LUMI003 Grey under Bawal (all featured), one Grey under Shawl.
  ⚠ PRICES (RM 49 / RM 59) AND STOCK (10) ARE PLACEHOLDERS — set the real
  numbers in /admin before announcing the store. The Shawl SKU is yours to
  set (only the Bawal LUMI series was specified).

## [0.1.0] — 19-08-2026 — first release
Full purchase loop: catalogue → cart → checkout (server-side pricing,
atomic stock) → bank transfer + receipt upload → admin confirm → ship.
ToyyibPay FPX code-complete but inert until secrets are set.
