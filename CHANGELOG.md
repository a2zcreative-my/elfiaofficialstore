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
