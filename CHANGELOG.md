# ELFIA OFFICIAL STORE — v1.46.2 (05-09-2026) — A STRAY COPY STOPPED THE DEPLOY

The store half of DEPLOY.bat failed at the compile gate:

```
src/index-1.ts(4,53): error TS2307: Cannot find module './staff'
src/index-1.ts(6,38): error TS2307: Cannot find module './shared'
...
```

**Nothing was wrong with the store.** `src/index-1.ts` was a 274 KB copy of the
A2Z PORTAL's worker entry point, written into this folder by accident while the
desktop bridge was reconnecting; Windows would not overwrite the store's own
`src/index.ts`, so it kept the copy beside it under a `-1` name. The gate read
it and failed on imports that only resolve in the other project.

It would have failed the NEXT gate too, which is worth writing down: `no-secrets`
found a password-hash template inside that copy and refused the build. So
excluding it from the typechecker alone would have moved the failure one step
along rather than fixing it.

- `src/index-1.ts` is now an empty, commented stub explaining what it was. It is
  safe to delete; nothing imports it and wrangler never bundled it.
- `worker/tsconfig.json` excludes duplicate names — `*-1.ts` through `*-9.ts`
  and `*copy*.ts`. Listed one by one because TypeScript globs understand `*` and
  `?` but not `[0-9]`, and `*-?.ts` would also swallow a real file named
  something like `feature-v2.ts`.

Verified by putting the real 274 KB copy back in place and running the gates:
`no-secrets`, the compile gate and `payment-integrity` all pass with it there.

---

# ELFIA OFFICIAL STORE — v1.46.1 (05-09-2026) — CHECKED AGAINST BAYARCASH'S OWN DOCS

The CEO sent the reference: `api.webimpian.support/bayarcash`. v1.46.0 was
built from the same pages; this pass read the ones I had not, and fixed what
they disagreed with.

## Confirmed as built
- `POST /v3/payment-intents` returns exactly `{type, id: "pi_…", payer_name,
  payer_email, order_number, amount, url}` — the shop reads `id` and `url`,
  which is what it does.
- Required headers are `Content-Type: application/json` and
  `Authorization: Bearer <PAT>`, with `Idempotency-Key` optional — all three
  are what the shop sends.
- The payment-intent checksum covers `amount | order_number | payer_email |
  payer_name | payment_channel` (keys sorted, values joined with `|`,
  HMAC-SHA256 with the API Secret Key) — as implemented.
- The v3 callback checksum covers the nine transaction fields, excluding
  `payer_name`, `payer_email` and `datetime` — as implemented.

## Corrected
- **`GET /v3/transactions` has no `limit` parameter.** It pages with `page`
  (15 per page) and filters by `order_number`, `status`, `payment_channel`,
  `exchange_reference_number`, `payer_email`. The admin credential check now
  asks for `?page=1`. The old `?limit=1` was ignored rather than harmful, but
  a call that quietly does something other than what it says is a call nobody
  can reason about later.
- **The callback now accepts the older v2 checksum as a fallback.** v3 signs
  nine fields; the v2 shape signs thirteen (the same plus `record_type`,
  `payer_name`, `payer_email`, `datetime`). Both are HMAC-SHA256 with OUR API
  Secret Key, so accepting either is still proof Bayarcash sent it — and a
  merchant account still emitting the v2 shape does not spend a day answering
  403s at the door. `payment-integrity` now requires BOTH comparisons to be
  constant time and fails on any `===` against the given checksum.

## Still not documented by Bayarcash
Which query parameters it appends to `return_url` on the v3 GET redirect. The
docs say only "GET {return_url}". The shop therefore marks its own return with
`back=1` and treats anything Bayarcash adds (`status`, `transaction_id`) as a
CLAIM; what settles an order is the authenticated re-read of that payment
intent. That was already the design, and it is now written down beside the
line that builds the URL.

---

# ELFIA OFFICIAL STORE — v1.46.0 (05-09-2026) — BAYARCASH REPLACES BILLPLZ

## What the CEO asked for

*"I want to use BayarCash for my payment gateway, you have to remove Billplz
inside ELFIA."* (A Portal Key was pasted with the request. It is not in this
repo and never will be — see "Keys" below.)

## What changed

**`worker/src/bayarcash.ts` replaces `worker/src/billplz.ts`** and keeps its
shape, so every route in `index.ts` kept its reasoning and changed its names:

| Billplz | Bayarcash |
|---|---|
| POST /api/v3/bills → bill id + URL | POST /v3/payment-intents → intent id (`pi_…`) + URL |
| GET /api/v3/bills/{id} (paid, paid_amount, collection_id, reference_1) | GET /v3/payment-intents/{id} (status "paid", amount, order_number) |
| X-Signature over `key+value` pairs | HMAC-SHA256 checksum over sorted VALUES, joined with `\|` |
| amount in **sen** | amount in **ringgit with two decimals** (`"39.00"`) — converted in one function, `ringgit()` |
| `BILLPLZ_SECRET`, `BILLPLZ_COLLECTION`, `BILLPLZ_XSIGN` | `BAYARCASH_PAT`, `BAYARCASH_PORTAL`, `BAYARCASH_SECRET` |
| `/payments/billplz/callback` (GET or POST) | `/payments/bayarcash/callback` (POST only) |
| `/admin/billplz-test` | `/admin/gateway-test` |

**The three locks are the same three.** (1) The callback's checksum must
verify with the API Secret Key — required, not preferred: `bayarcashReady()`
includes the secret, so a shop that could not verify a callback never raises a
payment. (2) The callback's `order_number` only LOCATES the order row; what
settles it is the payment intent the shop itself created for that row
(`orders.bill_id`, which now holds the intent id), re-read over our token, and
that record's own `order_number` and `amount`. (3) Paid, in full, to the sen.
The customer's own `/verify-payment` route asks the same three questions.

**Return journey.** The return URL we hand Bayarcash carries `back=1`;
Bayarcash appends its fields (`transaction_id`, `status` …). The order page
treats any of those as "returned", reads `status === "3"` as the gateway's own
claim (never as proof), and strips everything but `t=` from the address bar.

**Deploy.** `DEPLOY.bat gateway` asks for the three Bayarcash values one at a
time (nothing is written to a file) and deletes the three Billplz secrets from
the worker. The normal `DEPLOY.bat` now checks which gateway's secrets the
worker holds at step 3b and says plainly if Bayarcash is incomplete or Billplz
remnants remain. `wrangler.toml` and `README.md` describe the new setup;
`BAYARCASH_SANDBOX = "1"` points the shop at the sandbox account.

## Keys

The `no-secrets` guard gained two shapes: a Personal Access Token
(`<digits>|<random>`) and a 32-hex value assigned as a literal (a Portal Key).
Typing the pasted key into any file fails the build — verified by doing it.
Any key that has been in a chat or a screenshot should be regenerated in the
Bayarcash console before it is entered with `DEPLOY.bat gateway`.

## Verified

Worker and changed pages typecheck. `payment-integrity` rewritten for the new
names (18 checks, each negative-tested: a callback reading `status` from the
request, `bayarcashReady()` without the secret, and `ringgit()` sending sen
all fail it). `no-secrets`, `in-app-browser` pass. The portal's ELFIA tab
card reads "Online payment (Bayarcash FPX)".

## Still to do on the Bayarcash side

Run `DEPLOY.bat gateway` with the three values, then `DEPLOY.bat`, then the
admin test. The first real payment (sandbox first, if you can) is the proof of
the Portal Key and the checksum; if Bayarcash refuses it, the reason lands in
the ELFIA tab's payment check in their own words.

---

# ELFIA OFFICIAL STORE — v1.45.0 (05-09-2026) — THE SHOP FILLS THE SCREEN

## What the CEO asked for

With the home page open on a 1920px monitor: *"for ELFIA webpage, I want full
view which is make it looks nice on webpage view!"* The screenshot showed the
shop as a 1152px column down the middle of the screen with a third of the
width empty on each side — a laptop measure on a desktop monitor.

## What changed

**One width, one token.** `--container-shop: 96rem` (1536px) in globals.css,
used as `max-w-shop` by every browsing surface: the desktop header, the home
page, Shop, Wishlist, the Catalog, and the footer. It was `max-w-6xl` (72rem)
written six times; now it is one number, and the gutter grows to `px-10` from
`lg` so the wider page still has a margin.

**Grids grow instead of stretching.** Every product grid gains
`xl:grid-cols-5 2xl:grid-cols-6`, so a 1536px page shows five or six cards of
the size a card was designed at, rather than four cards inflated to fill it.
The New Arrivals / Best Sellers rail renders six tiles and hides the fifth and
sixth below their breakpoint, keeping one list in the markup. The collections
strip goes to six columns from `xl`; the trust strip gets a little more
padding and a 14px title at desktop width.

**What did not change.** Reading pages keep their narrow measure — a policy,
an order, a receipt, the account, checkout, tracking. Width is for browsing;
a receipt at 1536px is worse, not better. The phone layout is untouched: every
change sits behind `lg`, `xl` or `2xl`.

## Verified

Changed files typecheck; no `max-w-6xl` remains in app/. `no-secrets` passes.
Files touched: app/globals.css, app/page.tsx, app/chrome.tsx, app/shop/page.tsx,
app/wishlist/page.tsx, app/catalog/page.tsx, package.json.

---

# ELFIA OFFICIAL STORE — v1.44.2 (04-09-2026) — THE COUNTER THAT NEVER COUNTED

## What happened

The portal's `PUSH.bat` gained a compile gate today — each engine is typechecked
before it is published, the check the 19-08 outage taught. On its first run it
refused to publish this store's engine:

```
src/index.ts(428,40): error TS2339: Property 'tracking_courier' does not exist on type 'OrderRow'.
src/index.ts(488,44): error TS2339: Property 'tracking_courier' does not exist on type 'OrderRow'.
src/index.ts(1647,30): error TS2552: Cannot find name 'body'. Did you mean 'Body'?
src/index.ts(1647,58): error TS2552: Cannot find name 'body'. Did you mean 'Body'?
```

The store's own `DEPLOY.bat` has run this same gate since v1.29; the combined
deploy script had not, and these two slipped through it.

## What was wrong

**Line 1647 was a real bug, hidden by its own safety net.** v1.42.0 added the
in-app-browser tally on the pay route: the shop tells the worker when a
customer is paying from inside TikTok's browser, and the worker counts it, so
the "logged out. Access denied" reports could be measured instead of argued
about. The route never read the request body. `body?.in_app` threw a
ReferenceError on every payment — and the `try/catch` around the counter
swallowed it, exactly as designed ("a counter must never stop a payment"). So
payments went through, nobody noticed, and both tallies read zero for a week,
which on the payment check looks like "no in-app payers", the opposite of the
truth. The route now reads the body (a missing body is the ordinary-browser
case, not an error).

**Lines 428 and 488 were type-only.** `OrderRow` never gained the
`tracking_courier` column that migration 0009 added; `SELECT *` returned it
and the code used it, so nothing broke at runtime. The field is on the type
now, optional, because a row read before 0009 has no such column.

## Verified

Reproduced the four errors on the shipped file, then `tsc --noEmit` clean on
the fixed one. brand-isolation, no-secrets, order-tracking, payment-integrity
and bank-line all pass. The next `PUSH.bat` publishes it.

# ELFIA OFFICIAL STORE — v1.44.1 (31-08-2026) — THE FOOTER NAMES THE OPERATOR

## What the CEO asked for

**A2Z CEO:** *"elfia footer need to add A 2 Z Creative SSM since this is
handle by A 2 Z Creative."*

## What changed

Both footers — the phone one and the desktop one — now end with one muted
line under the copyright:

> ELFIA is a brand operated by A2Z CREATIVE MARKETING · SSM 202603003468 (CA0414729-A)

The wording and the number come from the agency's own issuer record in the
portal (`lib/issuers.ts`, facts supplied by the CEO on 19-08-2026), not
retyped from memory — a wrong SSM number on a storefront is worse than none.

## The part that needed care

This repo has a **brand-isolation guard** whose whole job is to fail the
build if the agency's name, SSM number, bank account or domain appears
anywhere in ELFIA's code — ELFIA is a client brand and must not wear the
agency's identity. This request is the owner of that policy adding a legal
disclosure, so the guard gained its SECOND deliberate exemption (the payee
`BANK_LINE` was the first, 26-08): the agency's name and registration are
allowed **only on the single line that defines `OPERATOR_LINE`** in
`app/chrome.tsx`. Both footers render that constant. The same identity on
any other line — including elsewhere in the same file — still fails the
build, so a disclosure cannot quietly grow into co-branding.

Negative-tested both ways: the identity pasted anywhere else in the repo
fails; the operator line itself passes.

# ELFIA OFFICIAL STORE — v1.44.0 (31-08-2026) — NOTHING LOADS IN WORDS

## What the CEO asked for

**A2Z CEO:** *"I want no loading without skeleton loading react … audit all
the files to ensure that no loading leak without skeleton loading react either
in web or mobile view apps for both my web."*

## What the audit found

The shop had one skeleton — `CardSkeleton`, the grey product tiles — and used
it on three pages (home, shop, wishlist). Everywhere else, loading was either
a sentence or a blank:

- **"Loading…" in words, ten times.** The account page while it checked who
  you were; the order and product pages while they fetched; the three
  `<Suspense>` fallbacks on `/p`, `/order` and `/shop` (the very first thing
  a customer sees on a static page that reads its query string); the count
  lines on the cart, shop and wishlist; and the catalog's *"Loading the
  collection…"*.
- **One spinner**, on the order page while a payment was being confirmed.
- **Nine of the twelve pages that fetch on mount drew nothing — or worse, an
  empty state — until the data arrived.** The account page said *"No orders
  on this account yet"* while the orders were still on their way. Checkout's
  summary read **RM 0.00** for a full cart and *"Ordering as a guest"* to a
  customer about to turn out to be signed in. The admin showed the passcode
  form to someone whose cookie was a moment from signing them in. Collections
  had a placeholder, but it sat above an empty list whose margin made the
  page jump 20px when the rows landed.

## What changed

**Four primitives in `app/ui.tsx`**, in CardSkeleton's own style
(`animate-pulse`, `bg-elfia-blush/70`): `Skel` (one block), `SkelText`
(lines, the last one shorter), `SkelRows` (thumbnail, two lines, chip — the
shape of every list on the shop) and `PageSkeleton` (a whole page, for
Suspense fallbacks). A caller's `rounded-full` or `space-y-3` replaces the
default instead of fighting it.

**Every fetch-on-mount page now draws the shape of what is coming**, on the
same `<main>`, the same column width and the same grid breakpoints as the
real thing, phone and desktop, so nothing moves when the data lands:

- `/account` — greeting card, the four order tiles, order rows; and the
  orders list itself shows rows, not *"No orders yet"*, until it has an
  answer.
- `/order` and `/p` — a page-shaped skeleton (status header, summary, payment
  rows, progress, items, address; photo frame, title, price, buttons, the
  "You may also like" rail) used for **both** the Suspense fallback and the
  fetch, so the customer sees one shape from first paint to real page. The
  payment-confirming spinner is a pulsing dot on the same beat as every
  skeleton.
- `/cart` and `/checkout` — one skeleton row per line already in the cart,
  and skeleton totals, until the prices are in. Checkout's *"Ordering as…"*
  line waits for `/auth/me` to answer.
- `/catalog` — a collection section with its round tiles; `/categories` —
  rows inside the list they stand in for; `/shop` and `/wishlist` — the count
  line is a block, not a word; `/track` — the WhatsApp line waits for the
  store config; `/admin` — the dashboard's tab row, filter chips and order
  rows until the cookie probe answers, and rows (not *"No orders here"*)
  while a filter change is in flight.

Every empty-state message is kept, and every one is now gated on the data
having arrived, so none can flash while loading. No request, price or layout
changed.

## Guard

`tests/skeleton-loading.mjs` (16 checks, negative-tested both ways), wired
into DEPLOY.bat: no loading state in words anywhere in `app/` (comments
stripped; `loading="lazy"` and the `"loading"` state literal ignored), no
`animate-spin`, every function component with a `useEffect` and a `fetch`
references a `Skel`/`*Skeleton`, nothing returns `null` on a loading flag,
every `<Suspense fallback>` is a skeleton, and the primitives exist in the
house style. The deploy stops with *"A page loads without a skeleton"* if any
of it regresses.

---

# ELFIA OFFICIAL STORE — v1.43.0 (30-08-2026) — THE TRACKING LINK, AND FIXING A TYPO

## What the portal asked for

**A2Z CEO:** *"on the web order, I want to add their tracking number and also
how to make sure that they able to tracking their order based on the tracking
number provided? I want to use J&T service or Ninjavan service."*

Most of this shop already did it. Since v1.12.0 the portal can enter a courier
and a tracking number over the bridge, and since v0.9.0 the customer's order
page turns them into a **track parcel** link — J&T Express and Ninja Van have
been in the courier map from the start, alongside Pos Laju, Flash, City-Link
and DHL. Two things were genuinely missing.

## 1. A typo was permanent

A tracking number is typed by a human off a parcel label, and `ship` was the
only way it could ever be set — an action that is legal only from `paid`. Get
a digit wrong and the customer sat on a courier page following somebody else's
parcel, with nobody able to correct it.

**New action `update_tracking`**, allowed only from `shipped`: the status does
not move, the number and courier change, `updated_at` bumps so the portal's
feed re-sends it, and the correction is written into the order's own history —
*"Tracking number updated — now …"* — so the customer sees a number change
rather than quietly finding a different one than the one they were given.

Deliberately not allowed after delivery: at that point the number is history,
and editing it rewrites what the customer was told at the time.

Both callers — the bridge and the shop's own `/admin` — now gate on one
`ORDER_ACTIONS` set instead of on `ORDER_MOVES`, so neither can forget an
action that is not a status move.

## 2. The portal had a number but no link

**Feed C now carries `tracking_url`**, built here, and the action response
carries it too so the portal has the link the instant a parcel is marked
shipped rather than after its next five-minute poll.

The portal holds the courier key and could assemble the URL itself. That is
exactly what must not happen: this shop keeps one map of six couriers and the
shape of each one's tracking URL, and the day J&T changes its URL the fix has
to be one edit, not two repositories with the forgotten one sending customers
to a dead page for months. The spec now says so in as many words, and
`tests/order-tracking.mjs` fails the build if anything here builds a link
outside the single `trackingUrl()` function.

## Guard

`tests/order-tracking.mjs` (23 checks, five ways negative-tested), wired into
DEPLOY.bat: J&T and Ninja Van are still in the map, every link is https and
encodes the number, one builder feeds the order page, the feed and the action
response, `update_tracking` stays shipped-only and bumps `updated_at`, and an
unrecognised courier key is dropped rather than stored.

---

# ELFIA OFFICIAL STORE — v1.42.0 (29-08-2026) — THE BANK SAID "ACCESS DENIED"

## What happened to a customer

A customer reached Maybank2u through Billplz and was told:

> **You have been logged out. Access denied.**

Nothing was wrong with the order, the bill, the redirect or the callback. The
gateway did its job. The bank refused the session.

## Why

**Malaysian bank logins will not run inside an app's embedded browser** — the
webview that opens when somebody taps a link in TikTok, Instagram or Facebook
instead of in Chrome or Safari. The bank sees a session it will not trust and
ends it before the password is even typed.

That lands on this shop harder than on most, because **most ELFIA customers
arrive by tapping a link in TikTok**. They never chose an in-app browser. They
tapped a video.

A shop cannot change a bank's policy. It can stop letting a customer spend two
minutes typing credentials into a page that was always going to refuse them.

## What the shop does now

**Before the Pay button**, when the page is running inside an app:

> **You are browsing inside TikTok**
> Banks block online banking inside app browsers, so the payment page may say
> "access denied" however carefully you type. Tap the ⋮ menu at the corner of
> this page and choose "Open in browser" (Chrome), then pay from there.
> Or use bank transfer below — it works from here and we confirm it the same day.

The instruction is written per platform, because "Open in Safari" on Android is
worse than no instruction at all.

**It warns; it never blocks.** User-agent detection is guesswork — apps change
their strings and some webviews do complete a payment. A false positive costs
one sentence. Blocking on a guess costs a sale.

## And it counts, so this stops being a guess

Two tallies in `sync_state`, reported by `/bridge/payment-check`:
`pay_attempts_in_app` and `pay_attempts_browser`.

A broken gateway and a bank refusing webviews look identical from the admin
screen, and they need completely different responses. One screenshot was enough
to form a theory; it is not enough to act on for weeks. Now the shop knows what
proportion of its payers are standing inside another app — an app name and a
number, no personal data.

## Tested against real user agents

`tests/in-app-browser.mjs`. The TikTok and Instagram strings both contain
"Safari" and "Chrome" — a naive check calls them ordinary browsers and the
customer gets no warning at all. Five in-app agents are caught and named
correctly; four real browsers (Chrome, Safari, Samsung Internet, desktop) are
left alone, because a warning everyone sees is a warning nobody reads. The
guard also asserts the pay button is never disabled by the detection.

---

# ELFIA OFFICIAL STORE — v1.41.0 (28-08-2026) — FLASH SALES

Red ⚡ Flash Sale pill with a live countdown on the product card and the
product page, driven by `flash_until` from the portal (migration 0018). The
portal owns the deadline, so the price reverts by itself on the next sync and
nobody has to remember to end a sale.

---

# ELFIA OFFICIAL STORE — v1.40.0 (27-08-2026) — SECURITY + THE CATALOG 404

See the portal's CHANGELOG for the full security remediation; the store's half
was the payment path (authenticated bill binding, mandatory signature, amount
and collection checks), the admin session cookie, the receipt byte cap and the
bridge rate limits.
