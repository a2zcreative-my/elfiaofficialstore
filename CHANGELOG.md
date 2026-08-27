# ELFIA OFFICIAL STORE — v1.35.0 (27-08-2026)

## The backdrop is a web-view effect — the app view stays plain

The CEO, having seen v1.34.0 on a phone: "I dont want the hover in the
mobile apps view, let it on the web view instead."

- **v1.34.0's always-on rule is removed.** The `touch:` variant and its
  three uses are gone from the code, not just switched off — nothing
  reveals the backdrop where there is no cursor.
- **On a desktop nothing changes**: the ELFIA backdrop still fades in
  behind a cut-out photo when the cursor arrives, on product cards, the
  product page and /catalog.
- **On a phone or tablet the cards are exactly as they were** — the
  plain blush pad, no backdrop, whatever the photo.
- The rig keeps a phone section, now proving the opposite: every laid-out
  layer stays at opacity 0 in a touch emulation. Turning it back on by
  accident would fail a check.

# ELFIA OFFICIAL STORE — v1.34.0 (27-08-2026)

## The app view sees it too — where nothing can hover, it is always on

The CEO: "I want mobile apps view also can see this hover!"

A phone has no cursor. Nothing can be moved over a card, and a tap opens
the product — so a hover-only effect is invisible on a phone forever, and
that is what the app view had.

- **On any device with no cursor** (phones, tablets, the app view) the
  ELFIA backdrop is simply THERE behind every cut-out photo, all the
  time: product cards, the product page, /catalog.
- **On a desktop the fade stays exactly as it was** — hidden until the
  cursor arrives, revealed under it.
- One new `touch:` variant in globals.css carries this, keyed on the
  browser's own `(hover: none)` — not on screen width, which would put
  the always-on look on a narrow desktop window and leave a big tablet
  without it.
- Same picture, same layer, same portal upload. Only the trigger differs,
  because the input differs.

# ELFIA OFFICIAL STORE — v1.33.0 (27-08-2026)

## The ELFIA backdrop on every product card, not just /catalog

The CEO, pointing at the shop grid: "for this area also need to have the
hover!"

- **Every product card** — home rails, Studio picks, the shop grid,
  collections, the wishlist, "you may also like" — now fades the ELFIA
  backdrop in behind the photo on hover, exactly like the /catalog
  tiles. Same single source: /api/v1/tile-backdrop, so the picture is
  whatever was uploaded in the portal (shipped one until then), and one
  upload changes every card in the shop at once.
- **The product page's own photo** got the same hover, so a cut-out
  model stands in the studio there too instead of on a flat pad.
- It costs nothing where photos are still opaque: the layer is only ever
  SEEN through a cut-out photo. Press "Cut out ALL photo backgrounds" in
  the portal once and the whole shop gains the effect together.

# ELFIA OFFICIAL STORE — v1.32.0 (27-08-2026)

## The carousel is yours alone, and the hover backdrop is uploadable

The CEO: "this should not appear in Homepage carousel, I think this is
hardcoded. I want Homepage carousel only appear for my uploaded!" and
"for the cut out background I want to have an option for me to add this
background if require and this I can upload by myself in portal!"

- **The shipped campaign slides are GONE from the homepage carousel.**
  The carousel now shows only what the portal uploaded (plus products
  marked Featured, which are also yours). No portal slides and no
  Featured products = no carousel at all — nothing hardcoded can appear.
- **The /catalog hover backdrop is the portal's now.** A new "Catalog
  hover background" card in the portal's ELFIA tab (portal v1.61.0)
  takes a JPEG/PNG/WebP; the store downloads it marker-gated like every
  other asset and serves it at one stable URL (/api/v1/tile-backdrop),
  so every tile's hover switches with no site rebuild. Nothing uploaded
  (or Remove pressed) = the shipped ELFIA backdrop, exactly as before.
- New store plumbing: `backdrop` key on the bridge feed, pull downloads
  into R2 with type/size checks (refusals reported like photo errors),
  DELETE /api/v1/bridge/backdrop reset door for the portal's Remove.

**To see it: run PUSH.bat in BOTH folders** (store for the carousel and
the worker; portal for the upload card), then close and reopen the
portal tab before uploading.

# ELFIA OFFICIAL STORE — v1.31.0 (27-08-2026)

## The whole model is the tap target, breathing room, and a pill that cannot miss

The CEO, live screenshots in hand: "CLICKABLE should be based on the model
photo like previous we done! … the price tag should have at least a bit
gap … price why not inside the PILL!"

- **Tap targets cover the model's photo**, not just the caption: each
  label's rectangle reaches up to the photo above it (as far as 240pt,
  stopped by whatever sits above) and sideways to halfway toward the
  nearest same-row label — so a tap can never claim a neighbouring
  product. Verified: grid tiles 174×287pt, detail name pill 174×295pt.
- **A visible breath between name and price** (gap 0.8× text size — the
  v1.30 spacing sat on the descenders).
- **The Price section can no longer come out empty** (portal v1.60.0):
  when the pixel search doesn't find a pill under a "Price" heading, a
  guaranteed spot directly under the heading is used instead, coloured
  from its own pixels — pill-coloured on a pill, fabric-coloured on
  fabric, price always drawn, always legible.

**NOT code — data, and it needs the CEO** (the same list since the first
upload): Bawal lumi Dusty Olive, Champagne Sand; Shawl Chiffon Black,
Dark Purple have no PUBLISHED product with those names, and "Champange"
is a typo in the PDF. The shop never guesses a price. Publish/rename them
in the ELFIA tab and the prices appear on the next download — no
re-upload needed. The upload preview lists these names before anything
uploads.

**ALSO NOT code — the stale tab**: the portal reads the PDF in the
browser; a portal tab left open across a deploy keeps the OLD reader (the
likely cause of this round's empty pill). After PUSH.bat: close the
portal tab, open it fresh, then choose the PDF.

## Deploy

**No migration.** Engine + portal, fresh portal tab, re-choose the PDF.

# ELFIA OFFICIAL STORE — v1.30.0 (27-08-2026)

## Plain price text, the pill truly filled, and the ELFIA hover

The CEO, with the live price-less catalog: "THE PRICE STILL NOT APPEAR WHEN
THERE IS A PRICE PILL WHICH IS EMPTY! … DONT INTRODUCE PILL for the PRICE
… the FONT style should be same as the font of SAIZ … just a text is
enough! this will cause an overlapped on the background."

- **Why his pill stayed empty**: the panel HAD found it, but his pill
  stretches far left of its "Price" heading — the site centred itself out
  of the store's pairing reach, and having "printed prices" on the page
  also suppressed the fallback text. Fixed on both ends: the panel clips
  the pill site around the heading's centre (search widened to ±260pt,
  still demanding two real pill edges), and the store's pairing reach grew
  to 100pt. The price now sits INSIDE his pill, white, sans.
- **Inserted prices are PLAIN TEXT now** — the v1.25 cream chip is gone
  (it read as a pasted box on his fabric backgrounds). Sans face (the
  "Saiz" style), the house maroon, struck old price alongside.
- **One size across the catalog**: an inserted price never inherits a
  display heading's scale — text under a 22pt "Price" matches the text
  under an 11pt grid caption (clamped 7.5–10pt).
- **/catalog hover** (his OPAI reference): each tile carries the ELFIA
  studio backdrop — synthesised from a campaign photo, model removed,
  wordmark kept (public/collection/elfia-backdrop.jpg) — which fades in
  behind the cut-out model on cursor. Touch screens keep the still tile;
  an opaque photo simply never shows the layer.

Proven on a wide-pill price-less catalog uploaded through the REAL panel,
and on the real /catalog page (hover screenshot with a genuine cut-out).
Rigs: upload 24, catalog-pdf 43, live 16, extract 32 — all green.

## Deploy

**No migration.** Engine + website + portal, then RE-CHOOSE the PDF.

# ELFIA OFFICIAL STORE — v1.29.0 (27-08-2026)

## Price-less catalogs, finished: inside the pill, once, and snug

The CEO, on the price-less upload: "no automatically price tagging there!
… price tag below of the Bawal name too gap … the price become duplicated!
… not properly price tagging inside the Pills by refer to the font style!"

- **The empty Price pill is filled INSIDE, in its own style.** The portal
  now finds the designer's empty pill by its pixels — a bounded blob of
  uniform colour under the "Price" heading, three properties no photograph
  shares — and ships it as a price site with the pill's colour and white
  ink. The store then writes the live price inside the pill, sans face,
  white on rose, exactly as the designer would have (portal v1.58.0).
- **One price per product per page.** On a price-less detail page both the
  name pill and the Price heading resolved to the same product and BOTH
  drew. The Price heading wins; every other label of that product keeps
  its tap link only.
- **The inserted chip sits snug under its label** (gap cut from 0.3 to
  0.05 of the text size — the extracted label box already carries descent
  room).

The other two screenshots were the already-fixed-awaiting-deploy pair:
Mahogany matching (fused kerning) and the vanished bottom shawl row — both
land with this deploy + a re-choose of the PDF in the portal.

Proven on a constructed price-less catalog in his cut-out style, uploaded
through the REAL panel: pill found (372..558 × 665..698, rose, white ink),
filled once, grid chips tight; upload rig now asserts exactly-once (24).

## Deploy

**No migration.** Engine + portal, then RE-CHOOSE the PDF in the portal
(pill detection happens at choose time).

# ELFIA OFFICIAL STORE — v1.28.0 (27-08-2026)

## The overriding price is indistinguishable from the designer's

The CEO, on the first override output: "Price should the font like Saiz and
also the box should not height like this to cover the static price there!"

- **Same face**: the replacement price is set in the sans face his designer
  uses for pill values ("Saiz", "170 cm X 65 cm"), not the serif the
  insert-mode chip uses.
- **Same ink**: the portal now samples the printed number's own colour from
  its glyphs (median of the far-from-background pixels, so a sliver of
  photograph at the box's edge cannot fool it) and the store writes the
  live price in that exact colour — white stays white on his rose pill,
  maroon stays maroon on the cream grid.
- **No visible box**: the cover patch hugs the printed glyphs (pad 0.18/0.1
  of the text height, was 0.35/0.22) — the tall flat patch that showed over
  the pill's gradient is gone.

Verified on his own Catalog Final Harga: both Price pills and a grid row
rendered and inspected. Portal v1.58.0 carries the ink sampling.

# ELFIA OFFICIAL STORE — v1.27.0 (27-08-2026)

## An uploaded catalog WITH printed prices: the system's price overrides it

The CEO, with his designer's "Catalog Final Harga" (6 pages, prices
printed): "when I upload into the portal it should sync … and the price
from system automatically override the price in PDF which is we done it
before."

Done as before, now for ANY uploaded file:

- **The map carries printed prices too** (`price_sites`: place + the page
  colour sampled around each one by the portal's browser at upload — this
  worker has no eyes). Each printed price is covered in its own background
  colour — cream stays cream, his rose Price pill stays a rose pill — and
  the live price is written in the same spot, sized like the designer's own
  number, dark ink on light grounds and white on dark ones. Sale pairs
  (live + struck old) draw when they fit the spot; the live price alone
  when they don't.
- **Whose price goes where**: each printed price pairs with the label
  directly above it in its own column; the label's matched product decides.
  A printed price whose label matches no live product is left EXACTLY as
  printed — the same honesty rule as v1.19.
- **On a designer-priced page, prices live only where she printed them**:
  no inserted chips on those pages (an inserted chip was covering the "By
  Elfia" line inside his name pill). Price-less pages keep insert mode
  unchanged, so both kinds of catalog work.
- **The matcher sees through display-face kerning** — his file reads
  "Bawal lumiMahogany" as one word, which is WHY Mahogany had no price in
  the live catalog. A product token (3+ chars) now also matches inside the
  label with its spaces removed; the two-products-tie rule still referees.
- **Extraction fixes from his real file**: labels on one printed row can
  differ by hundredths of a point in baseline — the sort now quantises to
  half a point, and a line may only continue within a narrow band of the
  previous run (the unbounded backwards merge was folding his bottom shawl
  row into an inside-out rectangle and dropping all three labels).

Proven ON HIS FILE: all 6 pages, 23 labels priced live (RM 36 over printed
RM 39, RM 11 with struck RM 14), the Price pills on both detail pages
filled in place, covers invisible, "Shawl Chiffon Champange" honestly left
printed (the typo — fix it or rename the product and it prices itself).
Rigs: upload 24, extract 32 (portal), portal e2e 27, catalog-pdf 43,
live-page 16 — all twice.

## Deploy

**No migration.** Engine (store) + portal — both PUSH.bat halves. Then
re-choose the PDF in the portal and upload: the new map with printed-price
places is built at that moment.

# ELFIA OFFICIAL STORE — v1.26.0 (27-08-2026)

## The /catalog page is the tile grid again — full stop

The CEO, on seeing v1.25.0's inline document view: "I want like the
previous which is correctly with the prices tag! you make it this worse
now!"

He is right, and the change is reverted completely. The tile grid IS the
catalog page: every product with its photo, its name, and its price tag
drawn live from the shop — always correct, whatever any PDF says. v1.25.0
replaced that with a rendering of the uploaded document, which faithfully
showed the document's own gaps (labels with no published product carry no
price) — trading a page that was always right for a picture of a file that
might not be.

- `app/catalog/page.tsx` is back to exactly the v1.24 behaviour: cover,
  tile grid with live price tags on every product, PDF embedded on desktop,
  "Open the PDF" button everywhere.
- An upload from the portal changes what it always changed: the
  downloadable/shareable PDF and the cover — never this page's layout.
- The v1.25.0 PDF improvements STAND (they fix what was actually asked):
  the cream chip under prices, the filled Price pill on single-product
  detail pages, page furniture handled, and the portal naming every label
  that will print without a price.
- The rig now asserts the OPPOSITE of what it asserted for one release:
  with an upload live, the page keeps its tiles and draws no document
  canvases (16 checks).

pdf.js stays installed but dormant (public/vendor/, package.json) — removing
it again would churn three files for no behaviour change.

## Deploy

**No migration.** Website only (the engine is unchanged since v1.25.0 —
deploying both via PUSH.bat is fine as always).

# ELFIA OFFICIAL STORE — v1.25.0 (27-08-2026)

## The uploaded catalog, finished: prices everywhere they belong, and ON the page

The CEO, after uploading his designer's new cut-out catalog: "missing
prices tag and also I see the price overlapping on the photo a bit,
elfiaofficialstore.my/catalog should reflect to the pdf that uploaded."

Three fixes, one release:

- **The empty Price pill on a Product Detail page is filled.** His
  designer's detail pages say "Price" over a pill left deliberately blank —
  the number is ours to write. A bare "Price"/"Harga" heading now takes the
  page's price **when the page has exactly ONE matched product**; with two
  products on a page it stays empty rather than guess. Page furniture
  ("Saiz", "Details", "Material", "Product Detail" …) is recognised by its
  whole text and no longer gets shelf links or a place in the unmatched
  list — that list is now purely the labels that truly found no product.
  *The other missing prices are DATA, not code: a label that matches no
  published product (a typo like "Champange", or a shade not yet
  published/renamed in the portal) prints without a price on purpose — the
  portal now names those labels at upload (portal v1.56.0), and
  `curl -sI …/catalog.pdf | grep -i unmatched` lists them for the live file.*
- **The price sits in a cream chip.** His new pages put labels on
  photographs; bare rose text on a photo read as overlap. The price (and
  the struck-through old price) now sit in a small capsule in the house
  paper colour — invisible on the cream page, a clean plate on a photo.
- **`/catalog` shows the uploaded document itself.** When the shop is
  serving a portal upload, the page draws every page of THAT file inline —
  phone and desktop — with tap targets read from the PDF's own link
  annotations, laid over the artwork. The tile grid stands down (the
  document already shows every shade, priced, in his layout) and returns
  the moment the upload is removed, or on any browser pdf.js cannot run.
  The HEAD probe on /catalog.pdf now names its source (two R2 head calls,
  no document built) so the page decides without downloading megabytes.

Rigs: upload rig grew to 22 checks (Price-pill rule both ways, furniture
silence); the live-page rig to 18 (uploaded document takes the page over,
tap overlays present, tiles return on remove). The harness now forwards all
response headers and serves .mjs correctly — two ways it was blinder than
production.

## Deploy

**No migration.** Engine + website (chip + Price rule in the engine; the
inline document view is the website half). `npm install` picks up pdf.js.

# ELFIA OFFICIAL STORE — v1.24.0 (26-08-2026)

## No /api/ in anything a customer sees — the full audit

The CEO: "Check all the url to ensure that there is no API such like this
https://elfiaofficialstore.my/api/v1/share/24"

Every URL a customer can see, copy or share was audited. ONE still carried
`/api/v1/`: the product share link (the Share / WhatsApp / Copy-link row on
every product page). Fixed the same way as the catalog:

- **The share link is now `elfiaofficialstore.my/share/24`.** A wrangler
  route (`/share/*`, both hosts) hands the path to the engine, which serves
  the same per-product preview page — the product's own photo, name and
  price as the card, then straight on to the product page. The old
  `/api/v1/share/…` address keeps answering, so every link already sitting
  in a chat keeps working.

**The audit, in full — what a customer can see and what it reads as:**

| Surface | URL the customer sees | Verdict |
| --- | --- | --- |
| Product share row (Share / WhatsApp / Copy) | `/share/<id>` | fixed this release |
| Catalog PDF link | `/catalog.pdf` | clean (v1.22.0) |
| Product pages | `/p?id=<id>` | clean |
| Shop, cart, checkout, wishlist, account | `/shop`, `/cart`, … | clean |
| Order tracking link (in WhatsApp updates, receipts, Billplz return) | `/order?t=…` | clean |
| WhatsApp message texts (order updates, restock notes) | `/order?t=…` or no URL | clean |
| Share/preview cards' og:url and redirects | `/p?id=…`, `/catalog.pdf`, `/shop` | clean |

What deliberately KEEPS `/api/v1/` — addresses no customer ever reads:
photo/cover URLs inside `<img>` tags and og:image tags (fetched by browsers
and crawlers, never displayed), the traffic beacon, every in-page data
fetch, and the Billplz `callback_url` (Billplz's server calls it; the
customer-facing `redirect_url` is `/order?t=…` and always was).

The sync rig's share claim grew 2 checks (165): the public `/share` address
serves the identical product preview, and forwards to the same product
page. `scratch/serve-local.mjs` mirrors the new route.

## Deploy

**No migration.** Engine + website (routes ride the engine; the share row's
new link is the website half).

# ELFIA OFFICIAL STORE — v1.23.0 (26-08-2026)

## The shared catalog link shows its cover

The CEO: "catalog missing thumbnail for the PDF share! and you require to
review all the thumbnail url so that it is match."

A PDF cannot carry og: tags, so a link straight to it never got a preview
card — WhatsApp showed bare text. The platforms' crawlers need HTML, so now
the crawlers get HTML: when the request for `/catalog.pdf` (either address)
comes from a link-preview bot — WhatsApp, Facebook, Telegram, X, LinkedIn,
Slack, Discord, Skype, Pinterest, all of which announce themselves — the
engine answers with a tiny page whose card is the catalog: title "Catalog
ELFIA v1" (from `CATALOG_FILENAME`), the cover as the image, the pretty
address as the canonical link. Every human and every other client still
receives the PDF itself, named and priced as before.

**The thumbnail audit the CEO asked for — every card, one cover:**

| Surface | Image URL |
| --- | --- |
| `/catalog` page share card (og + twitter) | `…/api/v1/catalog-cover` |
| `/catalog.pdf` link share card (og + twitter) | `…/api/v1/catalog-cover` |
| `/api/v1/catalog.pdf` (old link) share card | `…/api/v1/catalog-cover` |
| WhatsApp document card (file attached) | page 1 of the PDF itself |

`/api/v1/catalog-cover` is the single source: the portal-uploaded cover
when one exists, the shipped page-1 scan otherwise — so uploading a new
catalog changes EVERY card at once, and none of them can disagree. The
declared card size (1100×1556) is the cover file's real size. The
homepage's own card keeps the campaign photo on purpose — it previews the
shop, not the catalog.

The rig's THE LINK SHE SHARES claim grew to 11 checks (43 total): the
WhatsApp crawler gets HTML with the right image/title/canonical URL, a
customer's browser still gets the PDF, and the bot page's cover URL is
byte-identical to the one baked into the /catalog page's static export.

**Note for the CEO:** WhatsApp caches link previews on its side. After
PUSH.bat, send the link in a fresh message to see the card; a copy sent
before the deploy keeps its old (bare) look.

## Deploy

**No migration.** Engine only.

# ELFIA OFFICIAL STORE — v1.22.0 (26-08-2026)

## The catalog's own address, and its own name

The CEO, sharing the catalog on WhatsApp: "Catalog PDF will be name as
Catalog ELFIA v1. The slug url should make something nice which should not
appear as API."

- **The link customers see is `elfiaofficialstore.my/catalog.pdf`** — no
  `/api/` in it. Two new wrangler routes hand that ONE exact path to the
  engine, which serves the same live-priced document there. The address is
  deliberately versionless: the whole point of the live-priced catalog is a
  permanent link that never goes stale — v2 replaces the file, the link
  never changes, every copy already shared keeps working.
- **The downloaded file is named `Catalog ELFIA v1.pdf`** — set as
  `CATALOG_FILENAME` in `worker/wrangler.toml`, so when catalog v2 ships the
  name is a one-line edit and a deploy, never a code change. Both the pretty
  link AND the old `/api/v1/catalog.pdf` link send the name, so copies of
  the old link already in chats download correctly too.
- The `/catalog` page's "Open the PDF" button now uses the public address.
  The old route stays (the desktop embed and anything already shared).
- `scratch/serve-local.mjs` mirrors the new production route so the rigs
  exercise exactly what customers get; `catalog-pdf-check.mjs` gained a
  5-check "THE LINK SHE SHARES" claim (37 total) and `catalog-live-check`
  was brought up to the v1.21 stable-cover route it had drifted behind.

## Deploy

**No migration.** Engine + website (the routes ride the engine deploy; the
page's button is the website half). After PUSH.bat, the pretty link is live
immediately.

# ELFIA OFFICIAL STORE — v1.21.0 (26-08-2026)

## A catalog uploaded in the portal prices itself

The CEO: "the portal can upload the PDF for this catalog without the prices
tag and it will automatically live price embedded to the PDF uploaded."

This release is the store's half of that promise. The portal's half (the
upload screen itself) ships separately in the portal repo.

- **The bridge feed may now carry a `catalog` key** — URLs for a PDF, its
  label map, and a cover image, plus an `updated_at` marker. Same rules as
  photos and slides: an absent key means the store keeps what it has; a new
  marker makes the pull download all three into the store's own R2
  (`catalog/source.pdf`, `catalog/map.json`, `catalog/cover.jpg`).
  PDF magic, map shape, and a 15 MB cap are checked before anything is
  stored; the three travel together or not at all, so a new file can never
  be priced with an old file's map. Failures land in the photo-errors line;
  the sync response and pull summary say "catalog updated" when it worked.
- **`/api/v1/catalog.pdf` serves the uploaded file first.** When
  `catalog/source.pdf` + `map.json` exist in R2, the engine prices THAT
  file: since an uploaded catalog carries no printed prices, the price is
  *inserted* under each label in the house ink — no colour-matched covering
  needed, no coordinates shipped in code. Labels are matched to products by
  the same strict matcher as before (all distinctive words present, most
  specific wins, ambiguous means no price rather than a guess — unmatched
  labels are named in `X-Catalog-Unmatched`). Tap links come along: a
  matched label opens its product page, an unmatched one its shelf, the
  cover and top bands go home, and every page carries "Prices as at …".
  `X-Catalog-Source: portal` names which file served. With nothing in R2
  the shipped designer catalog serves exactly as in v1.19/v1.20.
- **`/api/v1/catalog-cover` prefers the uploaded cover**, so the /catalog
  share preview follows a new upload with no site rebuild.
- **`DELETE /api/v1/bridge/catalog`** (bridge key) removes the upload and
  returns the shop to the shipped file — the portal's "remove" button, and
  the rigs' way home.

New rig `scratch/catalog-upload-check.mjs` — 18 checks against the real
worker and the stand-in portal: a PDF built fresh by the rig (labels, no
prices) travels the bridge, takes over, prices itself, links correctly,
follows a price change, serves its cover, survives an absent feed key, and
is fully removable. The v1.19/v1.20 rigs still pass against the shipped
file after reset (32 + 14 checks), and the sync rig stays green (163).

## Deploy

**No migration.** Engine only (the website already points at the stable
routes). Nothing changes for customers until a catalog is uploaded from the
portal — which needs the portal release that follows.

# ELFIA OFFICIAL STORE — v1.20.0 (26-08-2026)

## The catalog is a door into the shop now

Per the CEO's approval of the v1.20 plan (point 1): every tile in the
generated catalog PDF is a real tap target.

- **A matched tile opens its own product page** (`/p?id=…`) — the exact
  shade, Add to cart in front of the customer. Safe only because the PDF is
  rebuilt per request, so the id is always current.
- **An unmatched tile lands on its shelf** (`/shop?c=bawal` / `?c=shawl`,
  read from the printed label). Never a dead link, never a guessed product.
- **The two Product Detail pages** are one product each, so everything under
  the header band is the tap area.
- **The ELFIA wordmark on every page goes home; the whole cover goes home.**
  A forwarded catalog is one tap from the shop, from anywhere in it.

Links always carry the PUBLIC shop address, never a test one — a PDF saved
to a phone travels, and its links must work wherever the copy ends up. The
tap areas are annotations layered over her artwork; her ink is untouched.
Tap widths are sized so no tile can claim its neighbour (±86pt in 200pt
columns).

**Two mistakes this release caught by reading the file back rather than
trusting the code:**

1. The first build wrote each URI as a PDF *Name* (`/https:#2f#2f…`), which
   no viewer follows. Everything compiled; the links were dead.
2. The rig's own first parser read qpdf's alphabetised dictionaries with a
   forward window from `/Subtype /Link` — which reads the NEXT object's
   rectangle, shifting every link by one. The rig now parses object by
   object, and never dedupes (the four wordmark links are legitimately
   identical).

The rig gained a CLICKABLE claim — 9 checks: 29 annotations (24 tiles + 5
home), the matched fixture's tile links to its exact product id, shelf links
for the rest, every rectangle inside its page, no tile wide enough to cross
a column. 32 checks total, three runs in a row.

**Where links work:** desktop browsers including the /catalog embed, phone
PDF viewers after download, WhatsApp's document viewer. iOS Safari's quick
inline preview is historically inconsistent with PDF links — the customer
may need "Open in…" first. The phone-first path remains the /catalog page's
own tiles, which have always been links.

## Sharing /catalog previews the cover

The CEO: "thumbnail must correctly fetch the page cover photo of the PDF."
`app/catalog/layout.tsx` bakes og:/twitter: tags into the static export —
WhatsApp's crawler runs no JavaScript, so the tags must be in the HTML — and
the preview image is the catalog cover, not the site's generic campaign
shot.

## Deploy

**No migration.** Engine + website (links live in the engine, share tags in
the website).

# ELFIA OFFICIAL STORE — v1.19.0 (26-08-2026)

## Her catalog. Her pages. Live prices.

The CEO, on v1.18.0's drawn pages: *"I want to use this Catalog without
create any new. I want to make the price live fetch instead of static! do
implementation as require without introduce any new!"*

So nothing is drawn any more. `/api/v1/catalog.pdf` now loads the designer's
own file — the exact PDF she supplied, byte for byte the one already in
`public/lookbook/` — and **patches it in place**: at each spot where her
designer printed a price, the printed number is covered with a swatch of the
surrounding colour and the live price is set in the same position. All five
pages are hers. Her cover, her photography, her typography, her Malay product
details — untouched. Only the numbers change.

### How it knows where the prices are

Her PDF's prices are real text (WinAnsi subsets — `pdffonts`), so every one
has exact coordinates. `PRICE_SITES` in `catalog-pdf.ts` is the map: 24
sites across the two grids and the two Product Detail pills, extracted with
`pdftotext -bbox`, with the cover colours **sampled from a 144dpi render of
her own file** — cream `rgb(251,246,240)`, the two pill roses — and verified
pixel-against-pixel: original and patched renders differ by single digits of
RGB at the seams. The grid prices are re-set in a serif to sit beside her
serif labels; the pills in a sans, matching what her designer used in each
place.

**If she ships a new catalog file, the map must be re-extracted.** The rig
guards this: it checks every mapped label still exists in the stored PDF and
fails loudly, so a swapped file cannot silently print prices in the wrong
places.

### How a price finds its product

By the label her designer printed beside it. A live product matches when
every one of its distinctive words appears in the label — "LUMI AURORA"
takes "Bawal lumi Aurora"; "DARK BROWN" takes "Shawl Chiffon Dark Brown" and
is refused "Shawl Chiffon Dark Purple". Two products claiming one site means
**nobody gets it**: a wrong price in her catalog is worse than an old one,
so the matcher never guesses. Whatever could not be matched keeps its
printed price and is named in an `X-Catalog-Unmatched` response header —
visible in one curl, never silent.

A discount prints as a real sale — live price with the old one struck
through beside it — and each patched page carries a small
"Prices as at YYYY-MM-DD" in the margin, because a PDF outlives the tab it
came from.

### Two limits, stated rather than hidden

- Covering ink does not delete the text object underneath, so
  select-all-and-copy in a PDF viewer can still surface a printed number.
  Every reader SEES the live price.
- That same overlap is why the rig extracts text with `pdftotext -raw`:
  poppler's layout mode discards overlapping text as shadow duplicates, and
  the patch rendered perfectly while plain extraction swore it was absent.

### The rig

`scratch/catalog-pdf-check.mjs` — 23 checks in four claims (HERS / LIVE /
HONEST / MAP GUARD), driven through the real portal → bridge → store chain:
its fixture product enters via the portal feed, gets repriced and discounted
there, and the assertions read the words back out of each downloaded PDF.
The matcher is imported from the shipped worker code, bundled on the fly, so
the tests cannot drift from what runs. Patch cost measured locally: ~280ms
for the full load-patch-save of the 5MB file.

## Deploy

**No migration.** Engine + website. `/catalog` and its embed are unchanged —
the same route now serves her file instead of a drawn one.

**Note for her real catalogue:** every printed label whose shade matches a
live product name updates by itself. `curl -sI
https://elfiaofficialstore.my/api/v1/catalog.pdf | grep -i unmatched` lists
any that did not — a product rename in the portal is usually the fix.

# ELFIA OFFICIAL STORE — v1.18.0 (26-08-2026)

## Her own PDF, embedded, pricing itself

The CEO: *"I want my own PDF without create any new catalog, I want PDF to be
embedded with this website! I also want to make sure this PDF able to fetch
the actual prices of my Product!!!"*

Three things that cannot all be true of a **file**. A PDF sitting in a folder
is a photograph of a moment; it cannot fetch anything, ever. What CAN be true
is a PDF that is **built at the moment somebody asks for it**.

`GET /api/v1/catalog.pdf` does exactly that. Every copy anyone opens, prints,
saves or forwards on WhatsApp was drawn from the prices in the database a
second earlier. Nobody re-exports anything, ever again.

### What is hers, and what is drawn

- **Page 1 is her cover artwork, untouched** — exactly as her designer made
  it. It carries no prices, so it can never go out of date.
- **Pages 2 onward are drawn** in her lookbook's style, because these are the
  pages with prices on them and prices are the whole point.

The style is not guessed. The colours and page size were sampled from the PDF
she supplied: ground `rgb(251,246,240)`, circles `rgb(112,112,110)`, A4
portrait (her cover is 1100×1556, A4 to within a pixel). The wordmark, the
dashed rule, the collection name, the grey circles, the shade names in deep
rose, "First Sight, Forever Yours" in the footer.

PDF has no `border-radius`, so the circular photo tiles are a real clipping
path — four beziers and a `clip` operator — with each portrait anchored to
the TOP of its circle, because centring a portrait crops the face.

### What it does that a file could not

- A price changed in the portal is in the **next** PDF anyone opens.
- A promotion prints as a sale: the new price, and the old one struck through
  beside it.
- A shade published in the portal **appears in the PDF by itself**.
- A collection she invents gets its own section by itself.
- Sold-out shades say so.
- The footer stamps **"Prices as at YYYY-MM-DD"**, because a PDF outlives the
  tab it came from and somebody will still have this file in a month.

### Embedded — and honest about where

`/catalog` embeds it in an `<object>` **on desktop widths only**. iOS Safari
and Android Chrome do not render a PDF inside a frame; they draw a blank
rectangle. Shipping that to the customers who are mostly on phones would be
worse than not embedding at all, so a phone gets the live product tiles —
same shades, same live prices — with the PDF one tap away.

`lg:` rather than a user-agent sniff: the widths that render PDFs inline are
the widths with a desktop browser behind them, and a media query cannot be
wrong about what a browser IS the way a sniff can.

### One security header had to move

`public/_headers` carried `object-src 'none'`, which blocks `<object>`
outright — the embed would have silently shown nothing on a page that looked
perfectly fine. It is now `object-src 'self'`: still refuses every plugin and
document from anywhere else, and permits only a file this same origin built
and served. The rig fails if a CSP violation appears in the console, so this
cannot regress quietly.

## The rig

`scratch/catalog-pdf-check.mjs` — 22 checks, split by claim, because the
three claims can fail separately:

- **real** — PDF magic header, `pdfinfo` reads the page count, A4, titled;
- **current** — change a price in the stand-in portal, and `pdftotext` finds
  the new number in the NEXT download (this is the claim a file cannot make);
- **embedded** — the page carries the `<object>`, it points at the generated
  route, **no CSP violation reaches the console**, and a phone is not shown an
  empty frame.

It reads prices back out of the PDF with `pdftotext` rather than trusting the
database, because "the price is in the document" is the only thing that
matters to somebody holding the document.

## Deploy

**No migration.** Engine + website — both, since the CSP lives in the website
half and the generator in the engine.

`worker/package.json` gains `pdf-lib` (pure JS, no native code, no network).
PUSH.bat's `npm install` picks it up; the worker folder may need its own
`npm install` the first time.

# ELFIA OFFICIAL STORE — v1.17.0 (26-08-2026)

## The catalog is priced by the shop, not by a picture

The CEO, on v1.15.0: *"I need the catalog fetch the prices from it actual
price in web/mobile. this is to make everything automatically without me need
to regenerate the pdf which is difficult for me."*

She is right and I was wrong. I built /catalog out of the PDF's page scans,
which means **a price printed into a JPEG**. The moment she ran a promotion,
the catalog would quote last month's numbers at customers, and the only fix
would be re-exporting a PDF and re-cutting five images. That is not
automation, it is homework — and I even wrote "the catalog needs
regenerating" in the last release as though it were an acceptable answer.

The catalog is no longer a picture of a document. It is the **same data every
other page uses** — `/api/v1/products` — laid out to look like the printed
lookbook: the cream ground, circular photo tiles, the shade name, the price.

- Every price is the price the customer is charged, sale struck through.
- It refreshes on the same signal as the rest of the shop (v1.16.0), so a
  discount reaches an open catalog when the reader comes back to the tab.
- It groups by the collections **the portal names**, so a collection she
  invents gets its own section.
- **A new shade published in the portal appears in the catalog by itself.**
  There is no step where anyone has to remember, which is the only kind of
  "automatically" that survives a busy week.

The four priced page scans are deleted from the repo. Only the cover survives
as an image, because the cover carries no prices and therefore cannot go
stale.

### The printed PDF stays, and says so

A physical catalog is a real thing to hand someone, so the file is still
offered — labelled **"Printed edition (PDF)"** with the month it was made,
under a line saying the prices on the page are the current ones. A customer
who downloads a file and then finds a different number at checkout is
entitled to be annoyed; being plain about which is which costs one sentence.

### Smaller things

- The cover is capped at 42vh on a phone. At full height it was a whole
  screen of scrolling before a customer reached a single shade, which is the
  opposite of what a catalog is for.
- `/catalog` joins `overflow-check.mjs` (now 35 checks across 7 pages), so
  the new page is held to the same no-sideways-scroll rule as the rest.

## The rig

`scratch/catalog-live-check.mjs` — 14 checks. It changes a price in the
stand-in portal, syncs, and asks whether the catalog followed; then adds a
discount and checks the sale renders struck through. It also asserts that
**no priced page scan is on the page any more** — if those images ever come
back, that check fails, which is the point of writing it that way.

## Deploy

**No migration.** Engine + website.

# ELFIA OFFICIAL STORE — v1.16.0 (26-08-2026)

## Prices and discounts on a page that is already open

The CEO: *"How to make all the pages automatically update the prices and
promotion/discount?"*

Most of the answer was already true, and worth writing down in one place:

```
portal edit  ->  bridge feed  ->  store database  ->  the page a customer sees
              (1 min by cron,
           or instant with "Update the shop now")
```

Every page fetches `/api/v1/products` when it opens, and the Worker sends
`Cache-Control: no-store`, so no browser and no CDN ever holds a price. And
**nobody can be charged a stale price whatever happens**: checkout re-prices
every line from the database at the moment the order is placed.

What was NOT true is the case nobody sees. A page **already open** fetched
its prices once, on mount, and never again. Someone opens the shop, is
distracted, comes back an hour later — and is reading last hour's prices. A
promotion started in between was invisible to precisely the customer who was
still browsing.

### One shared refresh signal

`useDataRefresh()` (app/ui.tsx) ticks when the tab becomes visible again,
when the window regains focus, and on a 90-second timer **while the tab is
actually being looked at** — a shop left open in a background tab overnight
should not poll a Worker 480 times.

It is ONE signal for the whole app, not one per component, for two reasons:
the header and the page beneath it must re-read at the same moment (a banner
promising free delivery over RM 45 above a page pricing it at RM 50 is worse
than either number being briefly old), and one interval is one interval
however many components listen.

Pages use it by putting it in the dependencies of the fetch they already had
— one line each, in Home, Shop, Collections, the product page, Cart and
Wishlist.

The page does **not** move under a reader's eyes mid-sentence: the refresh
lands when they come back to the tab. This is a shop, not a ticker.

### The header had its own staleness, and it was mine

v1.13.0 cached the store config promise at module scope so three components
would not fetch the same bytes three times. Correct — but it also froze the
announcement bar's free-delivery figure at whatever it was when the tab
opened, for as long as the tab stayed open. The CEO can change that number in
the portal now (v1.13.0), so the banner has to follow it. The cache is now
per refresh rather than forever: still deduped within a tick, refetched
across ticks.

## The rig

`scratch/live-price-check.mjs` — 9 checks, and it never touches the browser's
data directly. It changes the price in the stand-in portal, syncs, and asks
whether the page a customer is still looking at followed:

- the open page has NOT moved on its own;
- coming back to the tab re-prices it;
- a discount started mid-visit shows as a sale, struck-through price and all;
- the shop listing follows the same change;
- the announcement bar follows the delivery threshold.

The product page gained two `data-testid` marks so the rig reads THAT
product's price rather than one of the prices in "You may also like".

## A rig that poisoned its own next run

`gateway-error-check.mjs` used a fixed landline number to prove a landline no
longer sinks a bill. The shop caps unpaid orders at two per phone, so it
passed twice and then failed on its own litter. It now uses a per-run number
and cancels the orders it creates. Runs three times in a row.

## Deploy

**No migration.** Engine + website.

# ELFIA OFFICIAL STORE — v1.15.0 (26-08-2026)

## /catalog — the lookbook

The CEO: *"Use this catalog and place it inside ELFIA which is a new slug for
Catalog so that customer has option to view the catalog."*

Her five-page catalog is now a page of the shop, at **/catalog**.

### Why page images and not the PDF

Nearly every customer here is on a phone, and **iOS Safari does not render a
PDF inside an `iframe` or `object`** — it draws a blank box, or offers a
download and takes the customer out of the shop. Chrome on Android is no
better with a 5MB file on mobile data.

So the pages are laid out as ordinary images: every browser draws them, they
lazy-load one at a time instead of five megabytes at once, and each one taps
to full screen with Previous/Next and Escape. The PDF is still there for
anyone who wants the file — as a link, not as the reading experience.

Regenerating after a new catalog (the recipe is in the page's own header):

```
pdftoppm -jpeg -r 110 -jpegopt quality=82 public/lookbook/elfia-catalog.pdf /tmp/cat
for i in 1 2 3 4 5; do convert /tmp/cat-$i.jpg -resize 1100x -quality 80 -strip public/lookbook/page-$i.jpg; done
```

then set `PAGES` in `app/catalog/page.tsx` to the new count.

### The assets live under /lookbook, not /catalog

Deliberately. This page IS `/catalog`, and a static export carrying both a
`catalog.html` and a `catalog/` directory asks the host to guess which one
`/catalog` means. The local rig guessed the directory and served **404 for a
page that had built perfectly**. Different names, no guessing, on any host.

### Finding it

A slug nobody can find is a slug nobody visits, so there are three ways in:

- **A card on the home page**, using the catalog's own cover — this is the
  one that matters, because it is the screen everyone lands on.
- The desktop nav, next to Collections.
- The footer, on both phone and desktop.

Not the phone tab bar: it is full at five, and a sixth would shrink every
label. That was the v1.10.1 fault and it is not worth repeating for this.

### It quotes no prices

The catalog is a picture of what the studio printed. Prices and stock live on
the product pages, and the buttons here send people there rather than
restating a number that could be a month old.

## Deploy

**No migration.** Engine + website. The website step carries about 6MB of new
assets — the PDF and five page images.

# ELFIA OFFICIAL STORE — v1.14.1 (26-08-2026)

## "Payment gateway unavailable" — and no way to find out why

The CEO, on the live shop: *"This appear on the gateway payment!"*

That message was not a bug in itself. The bug is that it was **everything the
shop knew**. `billplzCreateBill` returned `null` for every kind of failure, so
the reason was thrown away at the exact moment it was learned:

```ts
if (!r.ok) return null;   // <- Billplz just told us what was wrong
```

A wrong API key, a regenerated key the shop is still holding, a sandbox key
on a live shop, an unactivated Billplz account, a wrong Collection ID and a
rejected phone number were all one indistinguishable dead end — for the
customer AND for whoever had to repair it.

### The reason is now written down

Billplz's own reply is kept in `sync_state`, with the order it happened to
and a timestamp:

```
2026-08-26T10:01 · order ELF-260826-140 · Billplz 403: <Billplz's own words>
```

alongside a hint that names the fix — for 401, *"if the key was regenerated
in the dashboard, the shop is still holding the old one"*; for 404, which
secret to re-set; for 422, that Billplz refused the bill's contents.

**The raw detail is shown before the hint, on purpose.** Proving this out
locally, the hint said "the account may not be activated" while the detail
said the request had been blocked by a network policy. The hint is a guess
about a status code; the detail is what actually happened, and when they
disagree the detail is right.

### Where to read it

**Portal → ELFIA tab → Online payment (Billplz FPX) → Check now.** The portal
relays it server-side with the bridge key it already holds, so nobody has to
carry a credential around to see the answer.

Also `GET /api/v1/bridge/payment-check` directly, behind the bridge key. It
is NOT on the public health endpoint, and it carries no key material — the
rig asserts all three secrets are absent from the response.

### The customer gets a better sentence

> Online banking isn't going through at the moment — please pay by bank
> transfer below. Your order and its prices are unchanged.

"Payment gateway unavailable" reads as a shop that is permanently broken.
This says what to do instead and that nothing has been lost. Billplz's status
codes are not the customer's problem and no longer reach them.

## A phone number could stop a payment dead

Found while reading the bill payload rather than reported: the customer's
phone was always sent to Billplz as `mobile`, reformatted to `+60…` whatever
it was. Billplz validates that field and answers 422 for anything it does not
like — so **a customer who typed a landline, an office number, or a number
with a typo could not pay online at all**, and the shop could not say why.

`mobile` is now sent only when it really is a Malaysian mobile. The email is
always present (falling back to the store's own mailbox), so Billplz always
has a contact and dropping a doubtful number costs nothing.

## The rig

`scratch/gateway-error-check.mjs` — 20 checks. The local rig has deliberately
fake Billplz credentials, so every bill creation fails, which makes it the
right place to walk the whole failure path: what the customer is shown, what
the shop records, what `payment-check` hands back, that the diagnosis is not
public, and that none of the three secrets leak into the response. It also
proves a landline no longer sinks the bill.

## Deploy

**No migration.** Engine + website. The portal's half is v1.53.0 — deploy
both, then press "Check now" in the ELFIA tab.

# ELFIA OFFICIAL STORE — v1.14.0 (26-08-2026)

## The journey back from the bank

The CEO asked for the Billplz interface. The way OUT was already built and
tested — bill creation, X-Signature verification, an authenticated re-query
before any order is marked paid. The way BACK was not, and that is where the
holes were.

The old page polled for eighteen seconds after a customer returned from
Billplz and then went quiet, whatever the answer. So **"it worked", "it
failed" and "the bank is slow" were all rendered as silence** — a customer
who cancelled at their bank landed on a page identical to the one they left:
same Pay button, no acknowledgement, no explanation. They are three different
situations and they need three different things.

### "That payment didn't go through"

Not styled as an error, because cancelling at your bank is an ordinary thing
to do. But unambiguous, and it says the sentence that matters:

> **You have not been charged.** The payment was cancelled or your bank turned
> it down — it happens, and nothing is wrong with your order. Your pieces are
> still held for 11 hours 59 minutes.

Both ways forward are offered — try again, or bank transfer — plus an
"I did pay — check again" for the customer who disagrees with us.

### "Your bank confirmed the payment — we're still verifying it"

The dangerous one. Billplz's redirect says paid; our own authenticated read
has not agreed yet. Telling that customer to try again is how somebody gets
**charged twice**, so this screen says *do not pay again* — and the Pay
button beneath it is **disabled**, with a label saying why.

A warning sentence is only worth as much as the button underneath it agrees
with. Bank transfer stays open, because locking every route would strand
someone who really does have a problem.

### While it is deciding

A proper panel with a spinner, not a thin grey line, and Pay is unavailable
throughout — a tap during those seconds creates a SECOND bill for an order
that may be about to confirm.

## Smaller things that were wrong

- **The poll gave up too early.** Ten tries at 3s instead of six, because a
  slow bank on a busy evening takes longer than eighteen seconds, and giving
  up early made a successful payment look like a failed one.
- **It also polled when there was nothing to poll for.** `verify-payment` now
  answers `bill: false` when no bill was ever created, and the page settles
  at once instead of waiting half a minute to say so.
- **Gateway errors appeared in the wrong place.** A failed "Pay now" wrote
  its message into the RECEIPT UPLOAD area — at the bottom of the bank
  transfer section, far from where the customer was looking. It has its own
  message inside the FPX row now.
- **The order link is cleaned up.** `billplz[...]` parameters are stripped
  from the address bar once read, so a reload an hour later does not replay
  a stale outcome, and the link stays shareable.
- **403 is a credential problem, not a hiccup.** `billplzCheck` filed it
  under "try again in a moment", which is advice that never comes good.
  Billplz answers 403 for a key it knows but will not accept here — an
  account not fully activated, or access withdrawn.

## Proving the keys before a customer does

`GET /api/v1/bridge/payment-check`, behind the bridge key.

`billplzCheck()` already existed but only `/admin` could reach it, and
ADMIN_KEY is not set on this shop — so **the first person to discover a
mistyped API key would have been a customer, halfway through paying.** This
is the same read-only check on a route that is actually reachable: it reads
one collection with the secret key, creates nothing, charges nothing, moves
no money, and returns no key material.

It also names the one combination that looks fine in testing and fails in
front of a customer: live money against a sandbox key.

## The rig

`scratch/payment-return-check.mjs` — 21 checks, walking all three outcomes in
a real browser and reading what is actually on the screen, including that the
Pay button is *disabled* and not merely discouraged.

It needs the gateway switched on locally, which is fake values in
`worker/.dev.vars` (`BILLPLZ_SECRET`, `BILLPLZ_COLLECTION`, `BILLPLZ_XSIGN`).
No bill is created and no real Billplz account is touched — `billplzConfigured()`
only checks both are non-empty. **The live keys are Wrangler secrets, set from
the CEO's own machine. They are not in this repo and never will be**;
`tests/no-secrets.mjs` fails the build if that stops being true.

## Deploy

**No migration.** Engine + website.

Online payment stays invisible to customers until `BILLPLZ_SECRET` and
`BILLPLZ_COLLECTION` are set as secrets — `store-config` reports
`gateway:false` and the FPX row is not drawn. Nothing here can go live by
accident.

# ELFIA OFFICIAL STORE — v1.13.0 (26-08-2026)

## Delivery pricing belongs to the CEO now

The CEO, 26-08: *"I want to have the authority to update the shipping fees
which is above RM45.00, I will provide a free delivery fees."*

Both numbers lived in `worker/wrangler.toml`, so changing what delivery cost
was a code edit and a deploy — something she had to ask someone for. Prices,
stock, photos, discounts and collections already come from the portal.
Delivery was the odd one out, and it is the number most likely to change
during a campaign.

It comes down the bridge now, in a `settings` block on the same feed as
everything else, and is kept in `sync_state`. `storeConfig()` prefers it and
falls back to the wrangler var — so an absent `settings` means "keep what you
have", the rule every optional field on this feed already follows. **No
migration on either side**: `sync_state` has been the store's key/value
scratchpad since 0008, and the portal's `system_meta` is older still.

Set it in the portal: **ELFIA tab → Delivery charges**. It reaches the shop
within a minute, or immediately with "Update the shop now".

### What the numbers are guarded against

This is money a customer is charged, so the failure modes matter more than
the feature:

- A value that will not parse is **ignored, not stored**. A typo in the
  portal cannot make delivery free; the last good number stands.
- A stray zero — RM 45,000 of postage — is **refused, not clamped**, because
  a clamped number is a wrong number that looks deliberate.
- An empty box is **not** zero. Sending 0 for "unset" would read at the shop
  as "delivery is free" and "free delivery from RM 0.00".
- Zero **is** a legal delivery charge, because free postage is a real choice
  someone might make on purpose.
- The portal going quiet does not reset delivery to the built-in numbers
  mid-campaign.

All six are assertions in `scratch/store-sync-test.mjs`, which now runs 163
checks against two real workers and follows one change from the portal to the
`shipping_cents` on a customer's own order page.

`/api/v1/health` now reports `shipping_cents`, `free_above_cents` and
`delivery_from` — so you can confirm a portal change landed without opening
the shop and squinting at the announcement bar. `delivery_from: "store"`
means nobody has set it in the portal yet.

### Free delivery is RM 45

`FREE_ABOVE_CENTS` moves from RM 150 to RM 45 as well as being set in the
portal, so the shop is right the moment this deploys rather than for the one
minute until the first pull.

## The two floating buttons are the same size

The CEO: *"WhatsApp button should same size as Arrow button size"*. The
bubble was 56px and the arrow 44px.

Both now read one `--elfia-fab` token, and so does the stacking offset that
puts the arrow above the bubble. Written by hand in three places, those
numbers drift apart the first time any one of them changes — which is exactly
what v1.12.2 had already set up, with `3.5rem` typed into the offset to match
a height defined elsewhere. `rail-check.mjs` now asserts the two buttons are
the same size and right-aligned, not just that they do not overlap.

## The phone has a footer

The CEO: *"mobile apps view there is no footer"*. It was desktop-only on the
reasoning that the tab bar is the navigation and a four-column link list at
the bottom of a phone is noise.

That reasoning was half right: the LIST is noise, the footer is not. Reaching
the delivery policy or the privacy page from a phone meant knowing the URL,
and a shop that asks for a bank transfer and shows no terms anywhere reads as
less trustworthy than it is.

So the phone gets its own shape — wordmark, the three links a customer
reaches for after ordering (track, delivery & returns, privacy), and the
copyright — rather than the desktop footer squeezed into 390px. The same
two-faces-of-one-storefront idea as the header.

It also moved INSIDE the tab-bar clearance wrapper. Outside it, its last line
would have been drawn underneath the tab bar — the exact fault v1.4.1 fixed
for page content, and one it could not hit while it was desktop-only.

## A test that broke a test three hundred lines away

Worth recording. The new delivery step places a real order to check what the
customer is charged, and it first did so under the default customer name.
An earlier step cancels "the" order by finding the first row named
`Sync Test` — so on the SECOND run of the suite it found my leftover order
instead, cancelled that, and failed an assertion about LUMI001 with no
visible connection to the change. The step now uses its own name and cancels
its own order. The suite passes three times in a row, which is the only
proof that means anything here.

## Deploy

**No migration.** Engine + website. The portal must be deployed too for the
Delivery charges card to exist — its half is v1.52.0.
# ELFIA OFFICIAL STORE — v1.12.4 (26-08-2026)

## The safety checks had never run on Windows

v1.12.3 put four guards into PUSH.bat at step [3/7]. They had all been
written on Linux and run on Linux. The CEO's machine is Windows, and the
first two deploys after that change both stopped at step [3] — once on my
mistake, and once on the guards' own.

Nothing reached the live shop either time, which is the system working. But
a guard that only runs where it was written is not doing its job, so:

### no-secrets.mjs was failing on its own doc comment

```
FAIL - tests\no-secrets.mjs:74 - a secret assigned a literal value: 1abd033b-...
```

The gate exempts itself by name, because its own comments have to show what
a leaked Billplz key looks like in order to explain the rule. The exemption
compared against the literal `"tests/no-secrets.mjs"`. `path.join` produces
`tests\no-secrets.mjs` on Windows, which never matched — so the file scanned
itself and failed the build on the example in its own explanation.

Every path this gate compares or reports now goes through one `norm()` that
forces forward slashes.

### migration-safety.mjs would have died on the next line

It located the migrations folder with `new URL(...).pathname`, which on
Windows returns `/C:/Users/...` — a leading slash in front of the drive
letter, and not a path Windows can open. It only survived the CEO's run
because the check before it failed first. `fileURLToPath` now does the
conversion properly.

It also refuses to pass on an empty list. A guard that checked nothing must
not print PASS: if that folder ever resolves to the wrong place again, it
says so.

Both fixes were checked against simulated Windows paths rather than assumed
— `path.win32.join` reproduces the exact string, and the old comparison
scans itself while the new one skips.

### bank-line.mjs no longer depends on a Node flag

v1.12.3 invoked it as `node --experimental-strip-types tests\bank-line.mjs`,
which is a trap of the same family: an unrecognised flag stops Node BEFORE
the script runs, so on a Node older than 22.6 the deploy would have died
with "bad option" and no way to tell what to do about it.

PUSH.bat now runs it plainly and the script sorts itself out — Node 22.18+
reads the TypeScript helper with no setup; 22.6-22.17 gets one silent
re-exec with the flag; anything older prints a loud SKIPPED and exits 0,
because blocking a deploy over a tooling gap is worse than the check not
running on that one machine. All three paths were exercised, and a genuine
test failure still exits 1 and stops the deploy.

## Deploy

**No migration.** Nothing in this release touches the shop, the worker or
the database — it is the deploy checks themselves.

# ELFIA OFFICIAL STORE — v1.12.3 (26-08-2026)

## The payment instruction is complete

The CEO, 26-08: *"under Maybank"*. `BANK_LINE` in `worker/wrangler.toml` now
carries the bank in front of the account, so its shape is:

```
BANK_LINE = "<bank> <account number> — <account holder>"
```

The filled-in values are deliberately NOT repeated here; see the last section
of this entry. The bank leads because that is the order the customer works in:
choose the destination bank in their banking app, key the account number,
then check the payee name the app shows them against the one printed here.
Bank, account, holder — the shop's whole payment instruction, and no part of
it is a placeholder any more.

Verified against a local run of the worker rather than by reading the file:
`GET /api/v1/store-config` returns the completed line, and the WhatsApp
bubble's number with it.

## Copy now copies the NUMBER, not the sentence

A consequence of the line above, and the reason this is a release rather
than a one-word edit. The order page's Copy button put the whole payee line
on the clipboard. That was survivable while the line was mostly digits. It
is not now: a customer taps Copy, pastes into their banking app's account
field, and it is refused — or worse, trims it by hand and mistypes.

`accountDigits()` (lib/config.ts) takes the longest run of digits, minimum
eight. Both halves of that rule earn their place, because holders' names
contain digits: strip every non-digit from a line ending "— Studio 2 Z ..."
and the 2 is welded onto the account number, giving a value that is the wrong
one and still looks like the right one. On a line with no plausible number
it returns null and Copy behaves exactly as before — an odd clipboard beats
an empty one.

The button reads "Copy number" when it has one, so nobody is surprised by
what lands in the clipboard.

**This is the one value on the shop that must not be wrong.** A mistyped
account number does not bounce; it pays a stranger. So it has a test of its
own — `tests/bank-line.mjs`, 11 cases across spaced, unspaced,
hyphen-grouped and bank-last lines. It runs under Node's TypeScript
stripping (`node --experimental-strip-types`) so it tests the shipped helper
rather than a copy of it.

## PUSH.bat runs the safety checks now

Until this release the guards were only ever run by hand, which meant
`tests/migration-safety.mjs` — written the day a bad migration stopped this
very script dead at "Database changes" — could not do the one job it was
written for. Step [3/7] now runs brand-isolation, no-secrets,
migration-safety and bank-line before anything is published, and stops with
"NOTHING WAS DEPLOYED" if any of them fails. They take seconds.

## brand-isolation caught this release three times

Worth recording, because all three catches were mine, and the third one is
the reason the section above exists.

1. The fixture in `scratch/stub-api.mjs` was first written with the real
   payee line and the real WhatsApp number in it. A test fixture is not a
   reason to make a second copy of an account number.
2. The doc comment on `accountDigits()` explained itself using the real
   account — and the wrong number the naive version produces from it.
3. **This changelog.** The entry above originally opened by quoting the
   completed `BANK_LINE` in full. It was written after the last hand-run of
   the guards, so it went out unchecked and stopped the CEO's deploy at
   step [3/7] — the first real run of the checks that this same release
   added to PUSH.bat. The guard did exactly what it was put there for, on
   its author, within the hour. Nothing reached the live shop.

All three now use invented values or a shape. The shop's real account
appears in exactly one place in this repo — `BANK_LINE` in
`worker/wrangler.toml`, the one narrow exemption added in v1.12.1 — and
`wrangler.toml` now says so in a comment beside the value, which is where
the next person to change it will be looking.

Note the guard skips `tests/` (it has to — `brand-isolation.mjs` holds the
forbidden patterns as its own rules), so that directory is on the honour
system.

**The lesson, for whoever writes the next entry:** describe the payment
values, never paste them. A changelog is committed, and the guard is not
being fussy — a repo that names the account in six places is a repo where
changing the account misses five of them.

## Deploy

**No migration.** Engine + website, as always.

# ELFIA OFFICIAL STORE — v1.12.2 (26-08-2026)

## Three phone faults, measured instead of judged

The CEO, 26-08, with three screenshots: *"Whatsapp button overlapped with the
arrow up button. Carousel photo on mobile offset, shop by collection, new
arrival and studio pick still offset!!!!"*

v1.10.1 had already fixed an "offset" — the page could be dragged sideways —
and `scratch/overflow-check.mjs` still proves it cannot. That was a different
fault from this one, and the guard passing is exactly why this survived: the
page was the right width while the content inside it was not where it looked
like it should be. So this release measures three specific things at five
viewport widths rather than judging screenshots, in
`scratch/rail-check.mjs` — 76 checks, all of which failed before the changes
below.

### 1. Every rail was eating its own gutter

Reproduced on all three phone widths: `scrollLeft = 16` on every horizontal
rail on load, so the first tile of *Shop by collection*, *New arrivals*,
*Studio picks* and the shop's filter chips was sliced off against the left
edge of the screen while the headings above them sat correctly inset.

A rail is pulled out to the screen edges with `-mx-4` and puts the 16px
gutter back inside itself with `px-4`. The cause was one line in
`app/globals.css`: `scroll-snap-type: x mandatory`. `scroll-snap-align: start`
means "line my start edge up with the snapport's start edge", and the
snapport is the scrollport — padding is not what it measures from. The
browser therefore scrolled 16px on load, before anyone touched the rail, to
bring the first tile flush with the border edge, throwing the gutter away.

The fix is `scroll-padding-inline-start: 1rem` on the rail: it tells the
snapport where the content actually starts, so `scrollLeft = 0` becomes the
snap position. It must stay equal to the rail's own `padding-left`.

### 2. The two floating buttons were one floating button

The WhatsApp bubble and the back-to-top arrow both carried
`bottom-tabbar right-4`, which is one position — the arrow was drawn inside
the green circle. Measured overlap: 56px on every phone width.

The comment on `ScrollTopButton` has claimed "sits above the WhatsApp bubble"
since v0.7.0. On a desktop it did (`lg:bottom-24` against `lg:bottom-6`),
which is why this was never seen: it was invisible on the screen it was
built on. The new `bottom-tabbar-2` utility is that position plus the
bubble's own height and a gap, and it is applied **conditionally** — the
bubble hides itself when no WhatsApp number is configured, and an arrow
parked 68px up with nothing underneath it is its own small bug. Both
components now ask one `hasWhatsApp()` function rather than keeping two
copies of the same test.

While there: the store config was being fetched three times per page, once
per component. The promise is cached at module scope now, so it is fetched
once.

### 3. The carousel photo did not fit its banner

The studio shoots **portrait** (896x1200). The banner is 4:3 on a phone and
21:9 on a desktop. A contained portrait photo in a landscape banner leaves
the shop's blush showing down both sides, and at the CEO's own zoom of 150%
those gaps measured **29px each** — the photo read as sitting off-centre in a
box that did not fit it.

Turning the zoom up would close them: the arithmetic says 180% on a phone.
It would not close them on a desktop, and a setting that has to be different
per screen is not a setting anyone can get right once.

So the same photo is now laid in **behind** the banner, cover-fitted and
blurred, with the sharp contained copy on top. The banner is full-bleed for
any photo at any zoom, and nothing already framed in the portal changes.

**The first attempt at this passed a geometric check and was still wrong.**
The blurred layer measured as covering the banner on every side while a 40px
band down each edge was still see-through: a CSS blur samples past its
element's edge, finds nothing there, and fades out — the box was covering,
the paint was not. The guard is therefore a pixel test: the banner's own
background is painted an impossible green, the screenshot is read back, and
any green pixel is a hole. Verified by breaking it on purpose — with the
backdrop removed 7.6% of the banner comes back green; with the first
version's overhang, 2 pixels do; as shipped, none.

## New in scratch/

- `rail-check.mjs` — the 76 checks above, at 320 / 390 / 430 / 768 / 1280,
  including a minimal PNG reader so the banner check can look at pixels.
- `stub-api.mjs` — answers `/api/v1/products` and `/api/v1/store-config` with
  a 22-product fixture, so a layout can be measured without standing up
  wrangler, D1 and R2. Its payee line and phone number are invented; the
  brand-isolation guard caught the first draft for carrying the real ones,
  which is the guard doing its job.

## Unchanged and still true

The bank line is still missing its BANK NAME (see v1.12.1). Nothing in this
release touches money, the bridge, the worker or the database — it is
storefront CSS and one React component. **No migration.**

# ELFIA OFFICIAL STORE — v1.12.1 (26-08-2026)

## The shop can take money again

The live config was still shipping its placeholder:

```
"bank_line": "REPLACE — e.g. MAYBANK 1234 5678 9012 — ELFIA"
"whatsapp_digits": "60000000000"
```

Customers at checkout were being told to transfer to the words **"REPLACE —
e.g. MAYBANK 1234 5678 9012"**. Every order on this shop is a bank transfer,
so nobody could pay — which is the likeliest reason all four orders in the
portal's Web Orders tab are cancelled: placed, unpayable, released by the
12-hour hold.

The CEO supplied both on 26-08:

- `BANK_LINE` = the account and the holder's legal name.
- `WHATSAPP_DIGITS` = `60123834821` (from +60 12 383 4821 — digits only,
  country code first; it is pasted straight into a wa.me link). The floating
  WhatsApp bubble hides itself while the number is the dummy, so it appears
  for the first time with this deploy.

**Still incomplete on purpose**: the BANK NAME is not in the line, because
nobody has said which bank it is and a Malaysian transfer needs it to pick
the destination. Guessing from the account's length would be a guess printed
on a payment instruction. The line is no longer a placeholder, but it wants
one more word in front of the number.

## brand-isolation gains ONE narrow exception

The guard forbids the operating company's bank account anywhere in this repo.
That account is now, by the CEO's instruction, the account this shop collects
into — so `BANK_LINE` in `worker/wrangler.toml` is exempted, and nothing else
is. A payee line is a payment instruction, not branding: a customer whose
banking app shows a payee they were not told to expect abandons the transfer,
and a name mismatch is how a transfer bounces.

The exemption is pinned to one setting in one file, and the guard now scans
line by line so it can be. Proven not to be a hole: the same account number
written anywhere else in the repo still fails, and so does every other
identity (names, registrations, domains). Both cases are exercised.

### Verified

- `store-config` rendered from the real `wrangler.toml`: both values come
  out as the customer will see them.
- brand-isolation PASS, with the leak tests above; no-secrets PASS.

**Deploy**: PUSH.bat. No migration.

# ELFIA OFFICIAL STORE — v1.12.0 (26-08-2026)

## The portal can now fulfil an order

The CEO: **"elfia web order should be able to update the tracking number so
that customer can track the order based on the order number that filled by
staff in the portal."**

Her Web Orders tab could only WATCH. Confirming a payment and entering a
tracking number still needed this store's `/admin` — which is unreachable,
because ADMIN_KEY has never been set on the live worker. Four orders sat
cancelled with no tracking and nobody able to move them.

**`POST /bridge/orders/:order_number`** — behind the same shared bridge key
as every other bridge route, no admin key — moves an order forward:
`confirm_paid`, `ship` (with `tracking_no` + `tracking_courier`), `complete`,
`cancel`. Addressed by ORDER NUMBER, which is what the portal shows and what
a human types, not this store's internal row id.

The transition logic itself was **extracted, not copied**
(`applyOrderAction`): /admin and the portal now call one function. The day
those two screens disagree about what "cancel" does to the shelf is the day
the counts drift — so there is one implementation, and cancelling still puts
the stock back AND reports the movement to the portal exactly as before.

Everything the store already enforced still holds, whoever is asking:
forward-only transitions, and a paid order that cannot be silently
cancelled ("Paid orders are refunded manually, never silently cancelled").
The refusals are already written for a human, so the portal passes them
through rather than replacing them with something vaguer.

### Verified

- `scratch/portal-live-e2e.mjs` — **52 assertions**, twice, both real
  workers, including the whole path she will use: place an order, try to ship
  it before payment (**refused, with the reason**), confirm the payment,
  enter the tracking number, and then **check the CUSTOMER's own order page**
  — because a tracking number nobody can see is not tracking. Then mark it
  delivered, and confirm a finished order cannot be shipped again.
- `scratch/store-sync-test.mjs` 151 assertions; migration-safety,
  brand-isolation, no-secrets PASS.

**Deploy**: no migration. PUSH.bat.

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
