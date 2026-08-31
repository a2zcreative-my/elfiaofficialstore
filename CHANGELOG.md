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
