# ELFIA OFFICIAL STORE — v1.11.1 (25-08-2026)

## The deploy that stopped at "Database changes"

PUSH.bat failed on the CEO's machine with:

```
SQL code did not contain a statement. [code: 7500]
```

Migration 0017 was valid SQLite. It applied perfectly to the local database,
and wrangler's own splitter (the same 4.125.0 she runs) turned it into four
clean `ALTER` statements — checked directly by calling
`unstable_splitSqlQuery` on the exact file. The **remote D1 API parses
submitted SQL its own way**, and something in the file's long prose comment
defeated it: an em dash, an ellipsis, a semicolon mid-sentence, a pair of
quoted words — chasing which character exactly is not worth an evening.

The fix is to stop writing migrations that need a clever parser. 0017 is
rewritten as plain ASCII with `--` comments and nothing quotable inside them;
the explanation it used to carry lives here, where it is read by people
rather than by a parser.

**`tests/migration-safety.mjs`** now enforces that on every NEW migration
(0017 onward — the files already applied to the live database are
grandfathered, because editing an applied migration to satisfy a linter is a
worse idea than the prose it would remove):

- plain ASCII only
- `--` line comments, never `/* */`
- no apostrophes or semicolons inside a comment
- every statement terminated

This is the second time a deploy has been stopped by something that passed
every local check, and both times the cost was hers, at midnight. The guard
runs with the other gates so the rule is enforced *before* a deploy.

### Verified

- Every migration re-applied from an **empty database**, 0001 through 0017,
  on both projects.
- `scratch/store-sync-test.mjs` — 151 assertions, twice, against the rebuilt
  database. `overflow-check.mjs` 30/30. brand-isolation, no-secrets,
  migration-safety PASS.

**Deploy**: migration 0017 (the rewritten one). PUSH.bat.

# ELFIA OFFICIAL STORE — v1.11.0 (25-08-2026)

## The model steps out of the carousel

The CEO, with a reference image: **"It is good that I can have this carousel
which is the ladies 3D outside the carousel. Which is suitable for both view
web and mobile apps view."**

That effect is not a filter or a 3D transform — it is a **second picture**.
The banner keeps its own background inside its rounded corners, and a
background-removed cut-out of the model is drawn over it, rising above the
top edge so she appears to stand out of the card. Migration **0017** adds
`cutout_key`, `cutout_marker`, `cutout_side` and `cutout_scale` to
`portal_slides`; the portal uploads the PNG, the store copies it into its own
R2 (marker-gated, same 5 MB pipeline as every other portal image) and draws
it.

Two details that are the whole trick:

- **The card clips, the slide does not.** The carousel must clip sideways —
  that is how slides slide — and CSS cannot clip one axis without the other.
  So the rounded, overflow-hidden box moved from the track onto each slide's
  CARD, and the cut-out became a SIBLING of that card. A child would be cut
  off by the very box she is meant to step out of.
- **The room above is measured, not guessed.** The container reserves
  headroom equal to the tallest cut-out's overhang × the banner's real
  height, via a ResizeObserver — the banner's height comes from an aspect
  ratio that changes with the viewport, and the tab-bar lesson was that a
  guessed clearance is just a luckier guess. No cut-outs anywhere = zero
  headroom = the hero is byte-for-byte what it was.

The caption automatically takes the opposite end from the model, and the
gradient wash flips with it, so the words never sit behind her.

### Verified

- `scratch/store-sync-test.mjs` — **151 assertions**, twice: the cut-out is
  copied into the store's own storage and served by it; side and height cross
  over; an unchanged marker is not re-downloaded; moving and resizing her
  costs no download; removing her in the portal returns a plain banner and
  leaves the slide's own photo untouched.
- `scratch/overflow-check.mjs` — still **30/30**: the reserved headroom does
  not reintroduce sideways scroll at any width.
- Rendered and checked at 390px and 1280px with a genuinely transparent PNG,
  so a JPEG masquerading as a cut-out (a white box) could not pass unnoticed.
- Worker `tsc` clean; `next build` clean; brand-isolation, no-secrets PASS.

**What to upload**: a PNG (or WEBP) of the model with the background removed
— the store refuses a JPEG for this slot, because a JPEG cannot be
see-through and would paint a white box across the banner.

**Deploy**: migration 0017. PUSH.bat.

# ELFIA OFFICIAL STORE — v1.10.1 (25-08-2026, late night)

## The phone layout could scroll sideways — that is the "offset"

The CEO: **"Mobile view apps why looks like this? Seem like offset!!! Check
on the webpage also to ensure no outspec!!!!"** — with a screenshot of the
home page shifted left, the logo and the product row cut off at the edge.

Nothing was mis-positioned. The page was **wider than the screen**, so one
stray sideways swipe moved everything left and left it there. Measured, not
guessed — `scratch/overflow-check.mjs` reports document scrollWidth against
clientWidth at five widths and NAMES the elements sticking out:

| width | was | now |
| --- | --- | --- |
| 320 (iPhone SE) | **77px** past the edge | 0 |
| 390 (iPhone 12) | **7px** | 0 |
| 430 | 0 | 0 |
| 768 (tablet) | **237px** | 0 |
| 1280 | 0 | 0 |

Three separate causes, all now fixed:

- **The bottom tab bar.** `flex-1` does not shrink an item below the width of
  its own text, so "Collections" held the bar wider than the phone. Added
  `min-w-0` and truncation — the labels give way instead of pushing the
  layout off-screen. This alone was the 7px on her iPhone.
- **The phone app bar.** The search box had `min-w-0` on its input but not on
  the form, so it could not shrink; the lock-up had no ceiling either. 77px
  on a 320px screen.
- **The web header at tablet size.** It needs roughly 1000px for lock-up +
  links + search + three actions, and it was appearing from `sm` (640px) —
  so every tablet drew a header 240px too wide. The phone/desktop split moved
  from `sm` to `lg` everywhere it exists (header, footer, tab bar, floating
  buttons, page padding, product rails, the buy bar), which also gives
  tablets the app layout they actually want.

### Verified

- `scratch/overflow-check.mjs` — **30 checks** across 6 pages × 5 widths, all
  green. Kept in the repo: this is the class of bug that is invisible in a
  screenshot review and obvious to whoever is holding the phone.
- `next build` clean; `tsc` clean; brand-isolation, no-secrets PASS.

**Deploy**: website only, no migration. PUSH.bat.

# ELFIA OFFICIAL STORE — v1.10.0 (25-08-2026, late night)

## Collections are named in the portal now

The CEO: **"why it is Bawal plain? I think I should be able to add the
category in the portal so that easier for me to categorized it"** — and then
**"how I want to add the Collection category!"**, looking at a dropdown that
offered exactly two words.

She was right to be annoyed twice. This file hard-coded four collections and
split the bawal range by running a **regex over the product NAME** — so every
LUMI shade, none of which says "floral" or "gold", fell into a shelf called
**"Bawal Plain" that nobody had ever chosen**. A collection the shop invents
from a product's spelling is not a collection.

**Collections are now simply the distinct Collection values the portal
sends, in the portal's own spelling.** Type "Bawal Printed" there and the
shelf exists here; rename it there and it renames here; stop using it and it
disappears. An empty collection cannot exist, because a collection IS its
products. The home strip, the home filter chips, /categories and /shop's
rail are all derived from the same list — there is no list left to maintain.

- `collectionsOf(products)` replaces the hard-coded `GROUPS`; `categoryChips`
  replaces the fixed Bawal/Shawl pair.
- Matching ignores case and spacing, so "Bawal Printed" and "bawal  printed"
  are one shelf, not two. An all-lowercase legacy value ("bawal", "shawl") is
  title-cased for display; anything typed with capitals is shown exactly as
  typed.
- The sync accepts any collection name (40 chars) instead of coercing
  everything to bawal/shawl. Absent still means "the store keeps what it
  has"; a brand-new SKU with no collection is created into Bawal.
- **ELFIA Exclusive** stays — it is the /admin "featured" tick, a curation
  rather than a category — and is always listed last.
- A portal-named collection carries no blurb, and the shop no longer invents
  one for it.

### Verified

- `scratch/store-sync-test.mjs` — **142 assertions**, twice: a collection she
  invented lands on the product and reaches the shopfront in her spelling;
  renaming it in the portal renames it here; saying nothing leaves it
  standing; a brand-new SKU is created into the portal's collection.
- Storefront checked against the live payload: the strip renders Bawal (6),
  Bawal Printed (2), Raya Exclusive (1), Shawl Premium (1) and ELFIA
  Exclusive (4) — all from portal names, no phantom shelf.
- Worker `tsc` clean; `next build` clean; brand-isolation, no-secrets PASS.

**Deploy**: no migration — `products.category` was already free text. Use
PUSH.bat (engine + website).

# ELFIA OFFICIAL STORE — v1.9.0 (25-08-2026, late night)

## "Still the discount is not live update!!!!"

It was updating — it just took up to five minutes, and there was no way to
say *now*. The CEO changes a price in her portal and looks straight at the
shop; a wait she cannot shorten reads as broken however correct it is.

- **The sync now runs EVERY MINUTE** (`crons = ["* * * * *"]`, Cloudflare's
  floor). 1,440 invocations a day, which is nothing.
- **`POST /bridge/sync-now`** — the portal can now say "pull everything,
  right now" using the shared bridge key. No ADMIN_KEY, no store screen: the
  button lives in her ELFIA Store tab, where she already is. Wrong key or no
  key is refused like every other bridge route.

## "I want to zoom out at least I can see the full"

v1.8.0 gave the portal an aim point and a crop/no-crop switch. A switch has
no middle. Migration **0016** adds `zoom` to `portal_slides`: per cent, where
**100 = every edge of the photo visible** inside the hero and higher grows it
until it fills and crops, around the focus point. The hero now lays the photo
in whole (`object-contain`) and scales it — one dial, no switch, no
re-encoding, so re-framing stays free and endlessly repeatable. A slide the
portal has not zoomed yet has no number and the old switch still answers for
it, so nothing on the shop jumps the day this ships.

## "Thumbnail also should take the actual photo … to share on WhatsApp"

WhatsApp, Messenger, Telegram and the rest read `og:` tags out of the HTML at
the URL itself. The shopfront is a static export where every product lives at
`/p?id=N` — one file, one set of tags — so **every shared product showed the
same campaign photo**.

`GET /api/v1/share/:id` now answers with a small page whose tags are THAT
product's: its own photo (served from our R2, per-segment encoded so the
crawler's fetch cannot 404), its name, and its price in the description. A
real visitor is forwarded straight to the product page. The product page
gained a **Share** row — the phone's own share sheet where there is one, a
WhatsApp hand-off, and Copy link everywhere else. An unknown or retired id
still answers 200 with the shop's own preview, so a link already sent to a
customer never dies.

## Also

- **`/admin` → "From portal" is gone** (CEO: "this should not be appear in
  ELFIA system! all inside the portal … dont make this system conflict and
  become unstable!!!"). No second publishing screen, no review queue, no
  counter. The old route answers **410** with a sentence pointing at the
  portal rather than a 404 that looks like a broken shop. A SKU'd product's
  edit form now says plainly that the portal owns its name, collection,
  description, photo, price and stock.

### Verified

- `scratch/store-sync-test.mjs` — **137 assertions**, twice: zoom crosses,
  re-zooming costs no download, a mad number is clamped, a portal with no
  zoom leaves the old switch in charge; sync-now works with the bridge key
  and is refused without it; a shared link previews that product's own photo
  and price, and an unknown id still answers.
- `scratch/portal-live-e2e.mjs` — **42 assertions against the real portal
  worker**, twice, including the whole path she will use: set a price in the
  portal, press Update the shop now, and the shop already has it.
- The rig gained a movements-only outage and GET-retry (a dropped keep-alive
  socket is not a finding about the store).
- Worker `tsc` clean; `next build` clean; brand-isolation, no-secrets PASS.

**Deploy**: migration 0016. Use PUSH.bat — it publishes the ENGINE and the
WEBSITE, which is the half that was missing on 25-08.

# ELFIA OFFICIAL STORE — v1.8.0 (25-08-2026, late night)

## Two dead ends removed, and the photo you can aim

Three complaints in one evening, and two of them were the same fault wearing
different clothes: something in this store was quietly waiting for a human to
visit `/admin` — an `/admin` the live store cannot even open, because
ADMIN_KEY has never been set.

### "Shawl set in the portal doesnt listed there!"

Twelve shawls, ticked **Publish** in the portal, never reached the shop. Not
a sync failure: feed A carries ONLY items with the portal's publish flag, and
this store was taking each new SKU and hiding it (`active = 0`,
`portal_pending = 1`) to wait for a *second* approval under
/admin → Products → From portal. That gate was mine, not hers. It asked the
CEO to approve her own approval, in a screen she cannot reach.

**A feed item is now created LIVE.** The portal's tick IS the publish
decision. And a row still sitting in the old queue is **released on the next
pull** — which is what clears the twelve without anyone touching /admin.
What still guards the shopfront is upstream and unchanged: an item with no
name or no positive price is reported, never invented. The store's own
/admin keeps its off switch for emergencies, and un-ticking Publish in the
portal drops the SKU from the feed as before.

### "I still notice that the stock doesnt sync correctly!!"

LUMI001 and LUMI002 read **SOLD OUT** against a portal count of 20, and
stayed that way through two deploys. A real deadlock, and an ugly one:

- An unsent movement rightly stops the pull overwriting that SKU's count —
  the portal computed it before it knew about the sale.
- But the push loop **stops retrying** at `MAX_ATTEMPTS`. From that moment
  the row could never be sent *and* never be overwritten. The shelf froze
  forever, and the only key was `/admin/sync-retry`.

Now the hold applies only while a sale is genuinely **in flight**
(`attempts < MAX_ATTEMPTS`). Once the push has given up, the local number is
a guess nobody can deliver, so the portal's count wins and the stuck SKU is
**reported** in the pull result (`stuck_skus`) instead of silently freezing a
product out of the shop.

### "I want to adjustable the photo … it is look too zoom"

The hero is a wide letterbox and v1.7.0 cropped every slide the same way —
`50% 30%`, hard-coded here — so tall group photos lost their heads and
nothing in the portal could change it. Migration **0015** adds `focus_x`,
`focus_y` and `fit` to `portal_slides`:

- **Aim** — the CEO clicks the spot on the photo in the portal's carousel
  card; that arrives as two percentages and becomes CSS `object-position`.
  The stored file is never re-encoded, so reframing costs nothing and can be
  redone as often as she likes.
- **Whole photo** — `fit: contain` shows the entire picture letterboxed
  instead of cropping, for the shots that must not lose their edges.
- A portal that sends no framing gets the middle of the photo, filling —
  exactly v1.7.0's behaviour, so nothing jumps.

### Verified

- `scratch/store-sync-test.mjs` — **117 assertions**, twice in a row. The
  hidden-queue assertions are deliberately REVERSED (live on arrival;
  released from the legacy queue by the pull), plus new steps for the stuck
  outbox (given-up sale no longer freezes the shelf; an in-flight one still
  defers) and framing (aim crosses, re-aiming costs no download, contain
  survives, no framing = the middle).
- `scratch/portal-live-e2e.mjs` — **37 assertions against the real portal
  worker**, twice: a portal-published shawl lands in the shop with no /admin
  visit, and an aim point set in the portal reframes the shopfront's hero.
- The rig gained a movements-only outage (`_down {only:"movements"}`) — the
  one state in which a pull can be watched while a sale is still in flight.
- Worker `tsc` clean; `next build` clean; brand-isolation, no-secrets PASS.

**Deploy**: migration 0015. ADMIN_KEY is still worth setting one day, but
nothing in the shop waits on it any more.

# ELFIA OFFICIAL STORE — v1.7.0 (25-08-2026, late night)

## The slashed price and the portal-run carousel

The CEO: "remove the store's current photos which is all the photo should
sync from the portal then the prices also should come from the portal. I also
want to add for the collection photo which is to make the photo of the
carousel gallery and also there is a discount for me to update in the portal.
This is to make my staff easier to update all in one finger tips in the
portal." Photos and prices already flow from the portal (v1.5.x/v1.6.0); this
release adds the two things that did not exist yet — a discount and the home
page carousel, both run from the portal's ELFIA tab.

- **Sale price** (`migration 0014`, `compare_price_cents`): when the feed
  sends `list_price_cents` next to `price_cents` (the portal does this when a
  discount is set there), the store keeps the pre-discount number and the
  storefront draws it — struck-through beside the price on every product
  card, a gold **SALE** badge on the card, and "Save RM X" on the product
  page. The customer still pays exactly `price_cents`, the same contract as
  always. Feed stops sending it → badge comes off on the next pull. Nothing
  is ever edited by hand in /admin: the discount lives in the portal.
- **The carousel** (`portal_slides` table, same migration): the portal's
  ELFIA tab now authors the home page hero. Slides ride the same
  `/api/v1/products` response the page already fetches; photos are copied
  into the store's own R2 under `slides/…` (marker-gated, same 5 MB/type
  rules as product photos) and served from `/media/slides/…`. This is the ONE
  feed section where absence means delete — a slide removed in the portal
  leaves the shop on the next pull, because a slide has no store-side author
  to protect. No portal slides at all = the shipped campaign slides show, so
  the page is never blank.
- **The lock-up line** (CEO, after seeing it live): the words under the
  ELFIA logo are now the brand line — **First Sight, Forever Yours** — not
  "Official Store", on desktop and the phone app bar both, written once
  (`STORE.tagline`). Set exactly like the footer's, on her instruction
  ("header should be the same as this footer"): italic, deep rose, sentence
  case — the same three classes `SiteFooter` uses, not the old letter-spaced
  uppercase caption.

### Verified

- `scratch/store-sync-test.mjs` — now **105 assertions**, twice in a row:
  discount lands (net price + compare price in admin AND the public payload),
  clearing removes it; two slides copied with captions and order, unchanged
  marker not re-downloaded, caption-only edit lands without touching the
  photo, removal propagates, empty list removes the `slides` key.
- `scratch/portal-live-e2e.mjs` — now **35 assertions against the real
  portal worker**, twice in a row: an RM 5 discount set in the portal's
  ELFIA tab becomes RM 55 struck → RM 50 paid on the shopfront and clears
  again; a slide photo uploaded in the portal (with captions) is copied,
  served by the store itself, and disappears when removed in the portal.
- Worker `tsc` clean; `next build` clean; brand-isolation, no-secrets PASS.

**Deploy**: one DEPLOY.bat run — it applies migration 0014 and ships the
still-pending v1.5.2/v1.6.0 changes with it.

# ELFIA OFFICIAL STORE — v1.6.0 (25-08-2026, night)

## The portal owns whatever it sends

The CEO renamed her portal items onto the store's LUMI codes, uploaded photos
for all of them — and the shop kept showing its own names and photos. Her
verdict: **"SKU doesnt sync with the portal!!"** She was hitting v1.5.x's
protection rule on purpose-built copy: the feed could only rewrite products
it had created, so matched SKUs took counts and prices but nothing else.

That protection is now removed, on her instruction. The rule becomes ONE
sentence: **a field the feed carries is applied — name, collection,
description, photo — for every matched SKU; a field the feed omits leaves
the store's value standing.** Matching a portal item to a store SKU is the
instruction to take it over. The photo change-marker still gates downloads
(an unchanged image_updated_at costs nothing), and dropping image_url from
the feed deletes nothing — absence always means "keep", never "delete".

This also answers the missing Shawl collection: set an item's Collection to
Shawl in the portal's ELFIA tab and the matched store product moves into the
Shawl collection on the next pull — the storefront's Collections strip then
shows Shawl by itself (it only hides EMPTY groups).

### Verified

- `scratch/store-sync-test.mjs` — **93 assertions**: the old
  "never overwrites an /admin photo" step is deliberately REVERSED (the
  portal's photo replaces the store's; the take-over is counted; dropping the
  URL from the feed deletes nothing; a matched store-made product takes the
  portal's name).
- `scratch/portal-live-e2e.mjs` — **24 assertions against the real portal
  worker**, including the new cross-system step: a store-made product with
  the shipped campaign shot ends up wearing the photo uploaded in the
  portal's ELFIA tab after one sync.
- Worker `tsc` clean; brand-isolation, no-secrets, compile gate PASS.

Worker-only, no migration — one DEPLOY.bat run ships it together with
v1.5.2's header/tagline (still pending deploy).

# ELFIA OFFICIAL STORE — v1.5.2 (25-08-2026, evening)

## The lock-up and the brand line

Two corrections from the CEO after seeing the live site:

- **"official store should be below of the ELFIA logo and centralized"** —
  the header lock-up is now stacked: the wordmark with OFFICIAL STORE
  letter-spaced beneath it, centred, on desktop AND in the phone app bar
  (scaled down), on every width — no longer a side note that only appeared on
  large screens.
- **"ELFIA branding name is First Sight, Forever Yours"** — the brand line
  replaces "Modest wear, made to last." everywhere it lived: the STORE
  constant, the first hero slide's subtitle, the footer (its own italic line
  in deep rose), and the page + Open Graph descriptions, so a shared link now
  carries the brand line too.

Pages-only — no Worker deploy, no migration. `next build` clean,
brand-isolation PASS.

# ELFIA OFFICIAL STORE — v1.5.1 (25-08-2026)

## The portal's words, and the proof

The CEO's correction: the photo upload, description and product controls
belong in HER PORTAL, not in this store's /admin. The portal side was built
for real today, in the portal's own repo (its new ELFIA tab: photo upload,
description, collection and publish controls; the portal's own changelog
carries the detail — this repo deliberately names no other company). This
release is the store's half of the remaining gap, plus the cross-system
proof.

- **Feed A may now carry `description`.** A product the portal creates is
  born with it; and a **portal-created** product follows the portal's name,
  collection and description on every pull — the same ownership doctrine as
  photos: the portal authors what it created, and never overwrites copy typed
  in this store's /admin.
- `scratch/portal-live-e2e.mjs` — **both real workers, no stand-ins** (this
  store's Worker against the actual portal Worker, each on wrangler dev with
  real D1 + R2): **22 assertions, passing twice over**. The portal-only shawl
  arrives here hidden with its photo (copied into ELFIA's R2, byte-checked),
  description and collection; an unchanged photo is not re-downloaded; a
  portal description edit lands on the next pull while LUMI001's hand-written
  copy is untouched; Publish puts it on the shopfront; and an ELFIA sale
  walks back into the portal's stock ledger through the movements feed.
- `scratch/store-sync-test.mjs` grew a start-clean step (cross-suite fixture
  retirement) and stands at **92 assertions, all passing**.
- `PORTAL-PHOTO-SYNC-HANDOFF.md` rewritten: it is no longer a request to a
  portal chat — it is the record of the implemented contract on both sides.

Worker-only change on this side and no migration; it rides along with the
v1.5.0 deploy (DEPLOY.bat).

# ELFIA OFFICIAL STORE — v1.5.0 (25-08-2026)

## The portal can send a product, and its photo

The CEO, on 25-08-2026: *"on portal I want an option for me to upload the
photo and also to bridge directly to ELFIA. Which is all this must sync
nicely, Shawl seem not yet being sync yet to ELFIA."*

**The shawls were never a sync failure.** The pull can only refresh a SKU the
store already has, and ELFIA has **no shawl products at all** — the collection
was created in v0.2.0 and never filled, and no SKU series was ever assigned to
it. So the portal's shawls matched nothing, every five minutes, forever, and
were dutifully reported as "unknown here".

### What the store now does

- **Feed A may carry four more optional fields** — `name`, `category`,
  `image_url`, `image_updated_at`. Every one is optional; a portal that has
  not shipped its half yet behaves exactly as before.
- **An unmatched SKU with a name and a usable price is CREATED**, not just
  reported. Created **hidden** (`active = 0`, `portal_pending = 1`) and queued
  in **/admin → Products → From portal**, where a human presses Publish or
  Dismiss. Nothing the portal invents reaches a customer unseen — that was the
  CEO's own choice when asked.
  Without a name or a positive price it is still only reported: a product
  needs something to be called and something to be sold for, and inventing
  either is how two systems start lying to each other.
- **Photos are copied into ELFIA's own R2**, never hot-linked. Re-copied only
  when `image_updated_at` changes, so repeating the URL every five minutes
  costs nothing. 5 MB cap, JPEG/PNG/WEBP only, 10s timeout.
- **Photo ownership follows the same doctrine as everything else here**: the
  portal may fill an EMPTY photo and may replace one it provided itself, but
  it never overwrites a photo uploaded in /admin. The campaign shots were
  chosen by hand; a feed does not get to wipe them.
- **Hidden-but-pending products keep syncing** — their counts and prices stay
  current while they wait, or the CEO would publish a stale number.
- A photo that cannot be fetched is reported on its own line
  (`last_photo_error`) and stops nothing: counts and prices still sync.
- The Worker will only fetch a photo from the portal's own origin, or from a
  public https host. A feed cannot point it at 127.0.0.1 or 10.x, and the
  bridge key travels only to the portal's own host.

New: migration `0013_portal_products.sql`, `POST /admin/products/:id/publish`,
`portal_pending` + `last_photo_error` on `/admin/sync-status`, and the
"From portal" review panel with a count on the Products tab.

### Fixed along the way: every /admin photo upload was a 404

Found by the new tests, and **live on the site right now**.

`imageUrl()` built the URL with `encodeURIComponent` over the *whole* R2 key,
turning the slash in `products/12-….jpg` into `%2F`. `URL.pathname` keeps it
encoded, so the Worker's `/media/(products/…)` route never matched and the
photo came back 404. Nobody noticed because all ten Bawal photos ship with
the site under `/collection/` and return before that line — but a photo
uploaded in /admin has never once been displayed.

Fixed on both sides: the storefront encodes each path segment, and the Worker
matches against the decoded path so any page already in someone's browser
keeps working. Both spellings are now asserted in the sync test.

### Verified

- `scratch/store-sync-test.mjs` against `scratch/fake-portal.mjs` —
  **91 assertions, all passing**, and passing again on an immediate re-run
  (the suite cleans up after itself and uses a fresh SKU each time, so
  "created" is genuinely exercised every run, not just the first).
  New ground covered: a never-seen SKU is created hidden with the portal's
  name/price/count/category; its photo lands in R2 and is served; an
  unchanged marker downloads nothing; a changed marker replaces it; an
  /admin photo is never overwritten; a pending row keeps syncing and is not
  reported as "unknown there"; Publish makes it live; Dismiss clears it
  without publishing; a text/html photo and a 6 MB photo are both refused
  with a message a human can act on, and neither stops the sync; a nameless
  or priceless item is reported, never invented.
- Real Worker, real D1, real R2, real HTTP (wrangler dev --local).
- `next build` clean · worker `tsc --noEmit` clean · `tests/no-secrets.mjs`,
  `tests/brand-isolation.mjs`, `tests/worker-compile-gate.mjs` all PASS.
- The From portal panel was driven in a browser end to end: two shawls
  proposed, one photo accepted, one refused with the reason shown in red.

### Deploying this one

**Not Pages-only.** `DEPLOY.bat` handles it — it applies the migration
(`wrangler d1 migrations apply elfia-store --remote`) before deploying the
Worker, so one run does everything.

### The portal still has to do its half

`PORTAL-PHOTO-SYNC-HANDOFF.md` (repo root) is written to be pasted into the
portal chat: a photo upload with a public image URL, the four feed fields, and
a SKU series for the shawls (**`SHWL001` upward**). Until that lands, this
release changes nothing visible — which is the point: it is safe to deploy
first.

# ELFIA OFFICIAL STORE — v1.4.1 (25-08-2026)

## The dock sat on top of the shop

The CEO sent a photo of the live site on her iPhone with the last row of
products running underneath the bottom tab bar.

It was a real bug, not a bad moment. Every screen cleared the bar with a
hard-coded `5.25rem` (84px) — but the bar is **taller than that on a notched
iPhone**, because it adds `env(safe-area-inset-bottom)` (34px) of its own
padding to clear the home indicator. 62 + 34 = 96px of bar against 84px of
clearance, so the bottom 12px of every page was covered.

- **The bar now measures itself.** `BottomTabBar` publishes its real rendered
  height as `--elfia-tabbar` (ResizeObserver on the **border box** — a
  content-box observer never fires when only padding changes, which is exactly
  what the safe-area inset is). `pb-tabbar`, `bottom-tabbar` and the new
  `above-tabbar` all read that variable. Guessing a bigger number would only
  have been a luckier guess.
- **The bar is solid white, not translucent + `backdrop-blur`.** iOS Safari
  repaints a backdrop-filter on a *fixed* element badly while the page is
  scrolling, which is the smear visible in her screenshot.
- The product page's phone buy bar now sits **on** the tab bar
  (`above-tabbar`) instead of on its own hard-coded offset.

### Verified

- `scratch/tabbar-check.mjs` — **54 assertions, all passing**, over nine
  screens, run twice: once plain, once with 34px injected into the bar to
  simulate a notched iPhone (Chromium cannot emulate the real inset). Asserts
  the published variable equals the bar's true height, that each page's
  clearance is at least the bar height, and that with the page scrolled to the
  very bottom **nothing** overlaps the bar. Against the pre-fix build the
  simulated-notch half of this suite fails on 8 of 9 screens, which is the bug
  she photographed.
- `next build` clean; `tests/brand-isolation.mjs` PASS.

Pages-only, like v1.4.0 — no migration, no Worker deploy.

### Also in this release

`PORTAL-PHOTO-SYNC-HANDOFF.md` — the portal-side spec for uploading a product
photo in the portal and having it bridge into ELFIA, and for the Shawls.
**The Shawls are not a sync failure**: ELFIA has no shawl products at all and
the collection never got a SKU series, so the feed matches nothing. The store
half of that work (create-hidden + photo into R2) is v1.5.0, still to come.

# ELFIA OFFICIAL STORE — v1.4.0 (25-08-2026)

## The app layout

The CEO sent a five-screen blush layout — dashboard, homepage, product
listing, categories, payment — and asked for "the interface to look like this,
nice on the mobile apps view and also web view, same function, using Billplz".

This release is that, as ONE storefront with two faces. It is not a second
app and not an app-store app: on a phone elfiaofficialstore.my now behaves
like the layout she sent (bottom tab bar, app bar, rails, sticky buy bar); on
a desktop it is still a proper web shop (header nav, four-column grids,
footer). Same routes, same data, same Worker, same Billplz.

### New

- **Design tokens** (`app/globals.css`). The whole palette is now
  `--color-elfia-*` in one `@theme` block — cream, blush, veil, line, ink,
  body, muted, rose, deep, gold. Changing the shop's colour is one file.
- **`app/ui.tsx`** — the shared pieces: the icon set (one 24px stroke family,
  nothing borrowed), `ProductCard` with the wishlist heart, `SectionHeader`,
  `IconTile`, `EmptyState`, `CardSkeleton`, `StatusPill`. The phone and the
  desktop cannot drift apart because they render the same components.
- **Bottom tab bar** (phones only): Home · Shop · Collections · Wishlist ·
  Profile, with live badges. Safe-area aware, so it clears the iPhone home
  indicator.
- **`/shop`** — the product listing: live count, collection chips, sort
  (featured / price / name), a "hide sold out" filter, and search. Every view
  is a link: `/shop?c=printed&sort=price_asc`, `/shop?q=rose`.
- **`/categories`** — the collections screen. The groups are DERIVED from the
  live catalogue (`GROUPS` in lib/config.ts), so an empty collection is never
  advertised. Today that is Bawal Printed, Bawal Plain, Shawl and ELFIA
  Exclusive (the Featured flag).
- **`/wishlist`** — the heart on every card. Device-local, like the cart: no
  sign-up, nothing sent anywhere, prices re-fetched on every visit. "Add all
  available to cart" in one tap.
- **Dashboard** (`/account`) — greeting card, the four order states as tiles
  with live counts (To Pay / To Ship / To Receive / Completed) that filter the
  list, quick access, and member benefits. The benefits are the ones the shop
  really gives: the Worker's free-delivery threshold, the restock waitlist,
  saved details. **No wallet and no points** — ELFIA keeps neither, and a
  stored-value wallet is e-money, which needs a BNM licence.
- **Payment screen** (`/order`) — order summary first, then the methods as a
  chosen list: FPX online banking (Billplz, one tap, shown only when the
  Worker reports `gateway:true`) and bank transfer with a copy button and
  receipt upload. No other logos are drawn: the shop can only take what it can
  take.
- **Search** in both headers, landing on `/shop?q=`.
- `scratch/preview-server.mjs` — serves `out/` with a stubbed catalogue so the
  design can be reviewed without a Worker, a database or a Billplz key.
  Never deployed.

### Changed

- Home is now hero → trust strip → collections → New arrivals → Studio picks →
  catalogue. There is **no "best sellers" rail**: the shop does not count
  sales yet, so the second rail shows what an admin actually marked Featured.
- Product page: wishlist heart, "You may also like", and a phone buy bar that
  appears only once the real Add-to-cart scrolls away (so the page never holds
  two buttons with the same name — ambiguous for a screen reader and for
  `scratch/store-e2e.mjs`).
- Cart: "Save for later" moves a line straight to the wishlist. One Checkout
  button, for the same reason.
- Checkout: two-step indicator and a sticky order summary beside the form.
- The footer is desktop-only; on a phone the tab bar is the navigation.
- `layout.tsx` declares `apple-mobile-web-app-capable` and `viewport-fit`, so
  "Add to Home Screen" opens the shop without a browser bar.

### Unchanged on purpose

Every Worker route, the Billplz flow (create bill → redirect → verified
requery, `X-Signature` then authenticated read), stock reservation, the 12h
unpaid hold, accounts/PBKDF2, PDPA consent, the portal bridge, the traffic
beacon, `data-testid="product-grid"` and `data-testid="category-tabs"`.
**No migration. No Worker deploy needed** — this is a Pages-only release.

### Verified

- `next build` — clean, 14 static routes.
- `tests/brand-isolation.mjs` — PASS.
- Rendered at 390×844 and 1440×900 in Chromium against the stub catalogue;
  no console errors on home, shop, categories, product, cart, checkout,
  order (payment) or dashboard.

### Still open

- The wishlist is per-device. Carrying it into the account needs a `wishlist`
  table on the Worker.
- **Voucher codes** are not built. The member panel shows the automatic
  free-delivery perk, which is real; a redeemable code needs a `vouchers`
  table, validation inside `POST /api/v1/orders` (so the discount is priced
  server-side, never in the browser), a field at checkout and a tab in
  /admin.
- /admin is still on the old stone palette. It is staff-only, so it was left
  alone.
- Billplz has still never run against the live gateway (see the go-live
  checklist): rotate the keys, set `BILLPLZ_SECRET`, `BILLPLZ_COLLECTION`,
  `BILLPLZ_XSIGN` and `ADMIN_KEY`, then one real RM 1 order.

# ELFIA OFFICIAL STORE — changelog

## [1.3.0] — 24-08-2026 — PDPA: consent, a privacy notice, and marketing done right

**CEO: marketing needs to reach customers, covered by PDPA — decided as
"from orders + consent": the people marketed to are the people who ticked
the box, never the people who merely bought.**

- **Consent tick-box** at checkout and at sign-up — optional, never
  pre-ticked, bilingual (EN/BM), stored with its timestamp
  (`0012_marketing_consent.sql`). An untouched form consents to nothing.
- **Withdrawal that actually works.** Account holders untick it on the
  account page — effective immediately, and the flag is rewritten on their
  orders so the portal's marketing list drops them within one poll. Guests
  WhatsApp the shop; the admin `withdraw_marketing` action clears every
  order under that phone and any linked account in one call.
- **Privacy notice (PDPA 2010 s.7)** on the policies page, in English AND
  Bahasa Malaysia as the Act requires, written to match what the system
  actually does: what is collected, why, who sees it, the anonymous-only
  website statistics, retention, and the customer's rights. Footer link
  added.
- **Orders feed carries `marketing_consent`** (spec § C updated): the portal
  builds marketing lists ONLY from rows where it is `1`.
- `/health` names 0012 if it has not run; `/auth/me` reports the consent
  state so the account page shows the truth.

## [1.2.0] — 24-08-2026 — the shop now counts its visitors (anonymously)

**CEO, with the portal's Operations map on screen: "for ELFIA, I want to have
a traffic to see which user that visit my pages … a new map like Operations
map … a new tab for ELFIA traffic."**

The store now measures WHERE its visitors browse from and WHAT they look at,
and serves those numbers to the agency portal, which draws them on a Malaysia
state map in a new "ELFIA Traffic" tab. "Which user" is deliberately answered
with *where and how many*, never *who* — the decision recorded as OD-20a:

- **A tiny beacon in the storefront** sends only the page path and the
  referrer. No cookie, no ID stored in the browser, nothing that follows a
  customer around. Location comes from Cloudflare's own geo lookup on the
  network connection (state + city), never from the page.
- **No IP address is ever stored.** Unique visitors are counted with a keyed
  hash whose key includes the calendar day — the same phone hashes
  differently tomorrow, so within-day uniques are countable and cross-day
  tracking is impossible by construction, not by policy.
- **Aggregates, then deletion** (OD-22): raw hits roll up into per-day
  state/city/page counts on the 5-minute cron and are deleted after 60 days.
  The aggregates carry no hashes at all.
- **Bridge feed D** — `GET /api/v1/bridge/traffic?since=<day>` — same shared
  key and constant-time check as the orders feed. Finished days are final;
  today is resent as a running total. Spec: PORTAL-BRIDGE-SPEC.md § D.
- Self-declared bots are not counted; a beacon flood is rate-limited per
  address; `/health` now also names migration 0011 if it has not run.
- Migration: `0011_traffic.sql` (two new tables; touches nothing existing).

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
