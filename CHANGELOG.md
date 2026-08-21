# ELFIA OFFICIAL STORE — changelog

## [1.1.2] — 21-08-2026 — the portal's spelling of a SKU now matches

**CEO, with portal screenshots: "the prices not even sync! then the stock not
even show what is the available qty as per inventory in my portal!"**

Her screenshots settled two things at once. First, the store side of the
bridge is now configured (health shows both `bridge_*_configured: true`) but
the portal side still answers 501/404 — that half lives in the portal chat.
Second, and store-side: the portal spells its codes **"LUMI 004"**, with a
space, while this store writes **"LUMI004"**. The sync matched SKUs only
case-insensitively, so the day the wires connected, every single SKU would
have reported "unknown on the other side" and nothing would have synced.

- **SKU matching is now case- AND whitespace-insensitive** (`normSku`) — in
  the pull, the outbox hold-list, and the spec for the portal's side of the
  match. Each system keeps its own spelling; reports show the reader's own.
- **A SKU the portal feed carries is switched to counted automatically** on
  the first pull that matches it. Until now every product sat in "always
  available" mode (the v0.7.0 stopgap for counts nobody maintained), which
  would have kept the real counts invisible even after they synced.
- **The product page shows the exact live count** — "20 pieces available —
  ready to ship" — once a product is counted, the same number the portal
  shows, not a vague "In stock".
- Spec + handoff sharpened: the feed must send the **net** selling price when
  a rebate runs (RM 39 − 3 → send `3600`), and the movements endpoint must
  match SKUs whitespace-insensitively too. The fake portal now serves spaced
  SKUs, so the suites prove the fix.

## [1.1.1] — 21-08-2026 — sign-up works on the real Cloudflare

**CEO, from the live site: "User still cant sign up or either sign in!!"**

The bug was mine, and it is the nastiest kind: code that passes every local
test and fails only in production. Passwords were hashed with PBKDF2 at
210,000 iterations; **Cloudflare's production runtime caps PBKDF2 at
100,000** and throws above it, while the local dev runtime does not enforce
the cap — so all 85 local assertions were green while every real sign-up and
sign-in on elfiaofficialstore.my crashed.

- Iterations are now **100,000 — the platform maximum**. The count is stored
  per user, so it can rise the day the cap does, without locking anyone out.
- `verifyPassword` now **fails closed**: any hashing failure is a refused
  login, never a 500.
- The v1.1.0 self-diagnosis did its job — the customer saw a readable
  message and `/health` proved the database and migrations were fine, which
  is what pointed at the hashing itself.

No migration needed: no production account was ever successfully created, so
there are no old-format hashes to migrate. All suites re-run and green,
including real sign-up → session → order → claim through the new hashing.

## [1.1.0] — 20-08-2026 — the portal runs the business

**CEO, from the live site: sign-in said "Network problem", no Billplz button,
and: "the inventory can be sync with my staff portal? Orders auto-deducted
there? Prices controlled in /portal? Orders sent into the portal so I can
monitor everything?"**

### Why login failed — and how it can never hide again
The live worker was v1.0.0 but its **database migrations and secrets were
never applied** (`/api/v1/health` showed every `*_configured: false`).
Sign-up then crashed into Cloudflare's HTML error page, which the storefront
can only read as "Network problem". Two fixes so this class of failure
explains itself:

- **Every error now leaves the worker as JSON.** A global handler catches
  anything uncaught; the customer sees a real sentence, never a mystery.
- **/health now reports `migrations_current`** and, when false, lists which
  tables are missing, what will fail because of it, and the exact command
  that fixes it. DEPLOY.bat prints this at the end of every deploy.
- Sign-up on an unmigrated database used to answer "email already taken" —
  a lie that sends customers chasing a password they never made. It now says
  the shop's setup is unfinished and that guest checkout still works.

*(No Billplz button is the same story: the button appears the moment
`BILLPLZ_SECRET` + `BILLPLZ_COLLECTION` exist — they were never set.)*

### Prices are controlled in /portal
The portal's inventory feed may now carry `price_cents` per SKU. When it
does, the portal owns that selling price: every 5-minute pull applies it,
and a store-side edit is corrected back on the next pull. When it does not,
the store's own price stands — pricing moves to the portal SKU by SKU,
exactly when the portal starts sending a number. A zero or garbage price is
refused rather than zeroing the shop. Prices are never deferred the way
counts are: even a SKU whose count is held back (unsent sales) takes the
portal's price immediately.

### The portal sees every order
New `GET /api/v1/bridge/orders` on the store — same shared key, constant-time
compared, cursor-based. The portal polls it and receives every web order with
items, totals (the price actually charged, frozen at purchase), status,
tracking and customer details, and the same order re-surfaces on every status
change so the portal's copy is never stale. The customer's private order-page
token is deliberately excluded. Together with the movements push (v0.8.0),
this closes the loop the CEO asked for: web orders auto-deduct portal stock
AND appear in the portal for monitoring.

### The portal's address never enters the repo
`BRIDGE_URL` and `BRIDGE_PUSH_URL` are now **secrets** like `BRIDGE_KEY` —
the brand-isolation gate forbids the agency's domain in any committed file,
and pasting it into wrangler.toml would have made DEPLOY.bat refuse to
deploy. Set all three with `wrangler secret put`.

### Tested
The sync suite grew to **36 assertions** (portal price applied, store edit
corrected back, garbage price refused, SKU without a price keeps its own;
orders feed auth, cursor walk, status-change re-surfacing, no token leak).
API suite 85, browser journey 16 steps — all passing.

## [1.0.0] — 20-08-2026 — no joy buyers, real Billplz, no secrets in the code

**CEO: "ensure that there is no joy buyer … fully integrate with Billplz …
no hardcoded API since I need my system secure from attacking … DEPLOY.bat not
functioning well"** — and, mid-build: **"when customer half way make the order,
they refresh to main page it missing their order. I think we should make the
sign up/sign in page."**

### No joy buyers
- **An unpaid order now expires.** Twelve hours (`ORDER_HOLD_HOURS`), after
  which the cron cancels it, puts the stock back and tells the portal — the
  same path an admin cancel takes, so nothing is a special case. The customer's
  page shows a live countdown ("Please pay within 11 hours 59 minutes") and,
  afterwards, an event saying exactly why it was released and that they may
  order again. A silent cancellation would be worse than the joy buyer.
- **One phone may hold two unpaid orders** (`MAX_OPEN_ORDERS`). The third is
  refused with a message that tells them where to find the first two rather
  than just saying no.
- **Eight orders an hour from one address.** Stops scripted order spam without
  touching anybody real.

### Billplz, completed
- **X-Signature verification** on both the callback and the redirect
  (`BILLPLZ_XSIGN`). A forged callback is rejected with 403 before it costs a
  network call. The authenticated re-query still stands behind it: a signature
  proves who sent the message, only Billplz's own API proves money moved. Both
  locks are tested — a forged signature is refused, a correct one is accepted
  *and still does not mark the order paid*.
- **No domain is hardcoded any more.** `STORE_URL` builds the callback and
  redirect URLs and the allowed origins.

### Nothing secret in the code
- **`tests/no-secrets.mjs` — a build gate**, run by DEPLOY.bat before anything
  is uploaded. It fails on a secret-looking name assigned a literal, on the
  shapes real keys take (a Billplz key is a UUID; an X-Signature key is 128 hex
  characters), and on any `_KEY`/`_SECRET` entry under `[vars]`, which is
  committed. Verified by pasting a real-looking key into a file and watching
  the build stop.
- Every credential is a Wrangler secret: `ADMIN_KEY`, `BRIDGE_KEY`,
  `BILLPLZ_SECRET`, `BILLPLZ_COLLECTION`, `BILLPLZ_XSIGN`.

### Harder to attack
- **The admin passcode is rate-limited** — ten wrong keys in fifteen minutes
  and that address is refused, right or wrong, until the window passes. A
  correct key clears the count, and an admin on another connection is
  unaffected.
- One rate limiter for the whole API (order placement, sign-in, sign-up, order
  lookup, order claiming, the admin key), keyed per rule per address.
- **Security headers**: a content security policy that allows only this origin
  plus Billplz for form posts, `frame-ancestors 'none'`, HSTS, a permissions
  policy, and `no-store`/`noindex` on /admin, /order and /account.

### Accounts — optional, never in the way
- **Sign up / sign in** at /account: order history that follows the customer to
  a new phone, and a saved address that fills in the next checkout.
  **Guest checkout is untouched** — forcing sign-up in front of payment is how
  a small shop loses the sale.
- Passwords are PBKDF2-SHA256, 210,000 iterations, per-user salt, with the
  iteration count stored beside the hash so it can be raised later. Sessions
  are HttpOnly cookies whose value is stored only as a hash — a leaked database
  cannot sign in as anybody.
- **Past guest orders are never auto-claimed by phone number.** That would hand
  one customer another's history. They are added deliberately, proved the same
  way /track proves it: order number plus the phone that placed it.
- **The reported bug, fixed for everyone — account or not.** The checkout form
  is kept on the device as it is typed, so a refresh no longer loses it, and
  every order placed on that device is offered again on /track.

### DEPLOY.bat, rewritten
It never closes without saying why, writes `deploy-log.txt`, and checks
everything *before* touching Cloudflare: Node present, project files intact,
`wrangler.toml` placeholders, that you are logged in. Each failure names the
exact command that fixes it. It refuses to deploy if the secret gate, the
typecheck or the brand check fails, and ends by printing which secrets are
still missing with the command to set each one.

### Tested
85 API assertions, 25 sync assertions and a 16-step browser journey — all
passing, all repeatable. New coverage: order expiry driven through the real
scheduled handler, the open-order cap, sign-up/sign-in/session/claim, forged
vs signed Billplz callbacks, and admin brute-force lockout.

## [0.9.0] — 20-08-2026 — order progress the customer can follow

**CEO: "I want to have a progress order status for customer."**

The page drew five steps but could only ever highlight the current one —
there was nowhere to record *when* each step happened, and no way back to the
page once the customer lost their checkout link. Both fixed.

- **The order keeps its own history** (migration 0009, `order_events`). One
  row per movement, written for every transition including the ones the system
  makes by itself — a receipt upload, an FPX payment verified against Billplz.
  Never edited, never deleted. Existing orders are backfilled with the two
  facts that are actually known about them (placed, and reached its present
  status); nothing in between is invented.
- **The timeline now shows when, not just where.** Each reached step carries
  its time in Malaysian time and what happened; the current step says what to
  expect next ("We check receipts by hand, usually within a few hours"). Steps
  not yet reached stay grey and empty rather than being given a made-up date.
  A progress bar runs across the top, and an order paid online no longer shows
  "receipt received" half-lit as though something were outstanding.
- **Tracking that actually tracks.** When you mark an order shipped you can
  pick the courier (J&T, Ninja Van, Pos Laju, Flash, City-Link, DHL) and the
  customer gets a working "track parcel" link next to the number. A courier
  we have no URL for shows the number alone — a wrong link is worse than none.
- **"Track my order"** — a new page in the menu. Order number plus the phone
  used at checkout finds their order page again. Because order numbers run in
  a sequence, this is a guessing surface, so: the phone must match too
  (compared on digits, so +60 12-345 6789 and 0123456789 are one person); a
  wrong phone and a non-existent order number give the *same* answer, so
  nobody can count the shop's orders; and eight misses in fifteen minutes
  turns that address away without affecting anyone else.
- **One-tap WhatsApp updates in /admin.** Every order now carries a button
  with the right message already written for its current status — payment
  reminder, receipt received, payment confirmed, tracking, delivered — each
  including the link to that customer's own order page. You tap send.
- Admin timestamps are shown in Malaysian time instead of raw UTC.
- Tests grown to match: the API suite is now **59 assertions** (progress
  history recorded in order, courier link, lookup by phone, identical answers
  for wrong phone vs unknown order, rate limiting that stops a guesser without
  locking out a real customer), and the browser journey walks the new /track
  flow including a wrong phone number being refused. All suites pass.

## [0.8.0] — 20-08-2026 — the inventory actually syncs

**CEO: asked whether the inventory stays live and accurate against
the agency portal.** It did not. It was a button nobody could press
(the bridge URL was still a placeholder), it only ever ran when a human
pressed it, and it only went one way — so every web sale left the portal
believing scarves existed that had already been sold. Now:

- **Sales are pushed to the portal.** The direction that was missing entirely.
  Every reservation and every restock is written to a `stock_events` outbox
  (migration 0008) in the same request that changed the order, then delivered.
  If the portal is unreachable the row simply waits and the cron retries — a
  network failure delays a sale, it never loses one.
- **Each movement carries a UUID the portal must dedupe on.** The store
  retries anything it does not see acknowledged, because losing a sale is
  worse than sending it twice; the idempotency key is what makes the retry
  safe. This is the one rule the portal side must not get wrong.
- **The pull runs by itself every 5 minutes** (`[triggers] crons` +
  a `scheduled` handler), not only when someone opens /admin.
- **A stale count can no longer undo a sale.** If a SKU still has undelivered
  movements, the pull *skips* that SKU rather than accepting a number the
  portal computed before it heard about our orders. Without this the two
  systems fight and the store silently puts sold pieces back on the shelf.
- **Deltas out, counts in.** The store never sends the portal an absolute
  number — the portal owns the true count. The store reports only what it
  did: −2 sold, +2 cancelled.
- **Always-available products still report their sales.** The store does not
  gate on their count, but the portal still needs to know the pieces went.
- **/admin → Products shows whether the sync is alive**: sales delivered vs
  waiting, anything stuck, the last push and pull times, and the exact SKUs
  that exist on one side but not the other — listed, never guessed. A sync
  that fails quietly is worse than no sync at all.
- **`PORTAL-BRIDGE-SPEC.md`** — the contract for the portal team: both
  endpoints, auth, request/response shapes, the idempotency rule, what silence
  means, and a switch-on checklist. The portal needs one new endpoint.
- Two new config vars: `BRIDGE_URL` (renamed meaning: the inventory feed) and
  `BRIDGE_PUSH_URL` (new). `/api/v1/health` now reports
  `bridge_pull_configured` and `bridge_push_configured` separately, so a
  half-configured sync is visible instead of looking fine.
- **Tested against a stand-in portal** that implements the spec, including its
  dedupe rule: `scratch/fake-portal.mjs` + `scratch/store-sync-test.mjs`, 24
  assertions, all passing — sale reaches the portal, cancel returns it, a sale
  made while the portal is DOWN is delivered later and not lost, a stale count
  cannot overwrite it, a repeated movement moves the count once, and an
  unknown SKU is reported rather than retried forever.

## [0.7.0] — 20-08-2026 — open for orders

**CEO: "stock become sold out which is it is incorrect. I want to have a
scroll up button same as A2Z. Make this system e-commerce working well and
customer can make the order directly to this store."**

- **Nothing reads Sold out any more.** Migration 0007 adds an *always
  available* mode: `track_stock = 0` means the piece count is ignored
  entirely and the design can always be ordered. Every live product is
  switched to it, because they were all seeded at 0 in 0005 and were hiding
  in-stock shades behind a number nobody was maintaining.
  Each product has its own tick-box in /admin → Products ("Count stock for
  this product"), so counting can come back per design once the agency portal
  numbers are synced. The two modes are honest about themselves: a counted
  design still sells out at zero, restocks on an unpaid cancel, and refuses
  to be oversold; an always-available one is never decremented and never
  compensated, so a cancel cannot invent pieces that were never taken.
- **Back-to-top button** — appears after a screen and a half of scrolling,
  bottom-right, sitting above the WhatsApp bubble so the two never collide.
- **Online payment (Billplz) is ready to switch on.**
  - New in /admin → Orders: **Test online payment (Billplz)**. It reads your
    collection with your secret key and says exactly what is wrong — wrong
    key, wrong collection, sandbox key against live — *without creating a
    bill or moving a sen*. Do this before a customer ever meets the button.
  - New `POST /orders/:token/verify-payment`. Billplz sends the payer back to
    the order page while its server-to-server callback is still in flight
    (and that callback can be lost). The order page now re-checks for ~15
    seconds after a return and flips itself to *Payment confirmed*. The
    answer still comes only from an authenticated read of the bill — never
    from the URL the browser arrived with.
  - A paid order now opens with a green **Payment confirmed — thank you!**
    panel instead of leaving the customer guessing.
- **The whole shop is tested end to end, for real.** Two new harnesses in
  `scratch/`, both driving the actual Worker against an actual (local) D1:
  - `store-e2e-live.mjs` — 48 assertions covering server-side pricing against
    a tampered cart, atomic stock, overselling, sell-out, restock-on-cancel,
    always-available behaviour, free delivery at the threshold, the admin key,
    the honeypot, the waitlist, and the gateway's own state. All 48 pass.
  - `store-journey.mjs` — a real Chromium walk-through: home → product → add
    to cart → cart totals → checkout → a genuine order on the order page with
    bank details → the cart empties → the order appears in /admin. All pass.
  - `serve-local.mjs` serves the built site and proxies `/api` to the local
    worker so the browser sees one origin, exactly like production.

## [0.6.0] — 20-08-2026 — the shopfront

**CEO, from her phone: "the navbar there seem like doesnt same like A2Z. I
want something that looks nice for ELFIA. Which is attract client/customer
when visit" — and "also make the thumbnail looks nice!"**

- **A header that fits a phone.** The old one put the wordmark, both links and
  the Cart button on one row and they fought each other to pieces at 390px.
  Now: hamburger, centred wordmark and a cart icon with a live item-count
  badge, with a tap-to-open menu underneath; on desktop, wordmark left, links
  right, cart button. It sticks to the top as you scroll, over a thin
  announcement bar carrying the free-delivery threshold (the Worker's number,
  never typed into the front end).
- **Thumbnails are a lookbook now.** 4:5 frames matching how the range was
  shot instead of a square crop, the shade name large ("Dusty Rose") with the
  SKU small above it instead of a truncated "Bawal Premium — …", a soft zoom
  on hover, and a corner badge that says **Sold out** or **3 left** on the
  photo itself. Loading shows placeholder cards rather than a bare "Loading…".
- **Floating WhatsApp button** on every page — the same reflex as the green
  bubble customers already know. It hides itself until a real number is set in
  `WHATSAPP_DIGITS`, because a bubble that opens a chat with 60000000000 is
  worse than no bubble at all.
- **Free-delivery progress bar in the cart** — "Add RM 42.00 more for free
  delivery", filling up to "Delivery is on us". Threshold read from the
  Worker, so it can never disagree with what checkout charges.
- **"Tell me when it's back" on sold-out designs** (migration 0006, new
  **Waitlist** tab in /admin). A sold-out shade collects a name and a WhatsApp
  number instead of losing the customer. Nothing is ever sent automatically:
  the admin list shows who is waiting, oldest first, marks the ones whose
  design is back in stock, and gives you a WhatsApp button with the message
  already started. One row per person per design — a refreshed form updates
  the old row instead of stacking up.
- Product pages: breadcrumb, larger price, a stock line that reads green /
  amber / grey, and a short delivery-and-payment note under the fold.
  Checkout and cart restyled to match; buttons are pill-shaped throughout.

## [0.5.0] — 20-08-2026 — the ten-piece Bawal range

The CEO's new photo pack replaces the first one outright: ten Bawal designs
shot individually plus two group campaign shots.

- **LUMI001–LUMI010 are the catalogue now** (migration 0005). Named by colour
  to stay easy to reconcile against the portal's stock list:
  Dusty Rose, Periwinkle, Lavender, Silver Grey, Pastel Aurora, Dawn Blue
  (RM 49) and Navy Gold, Midnight Gold, Olive Floral, Mauve Floral (RM 59 —
  the four printed gold-line and floral designs). Dusty Rose, Pastel Aurora,
  Navy Gold and Mauve Floral are ★ Featured, so they ride the hero carousel.
- ⚠ **STOCK IS 0 ON EVERY DESIGN — the shop reads "Sold out" until you fix
  that.** Deliberate: nothing can be oversold before the counts are real.
  Open /admin → Products and type the numbers, or press "Sync stock from
  portal" to pull them from the portal by SKU. Do this before announcing.
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
  match with inventory in the portal??") — a button in /admin → Products.
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
