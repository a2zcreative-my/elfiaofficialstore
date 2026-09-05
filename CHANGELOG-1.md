# Changelog

All notable changes to the AZ ONE OFFICIAL platform.

## [1.105.0] - 2026-09-05 - roadmap phase 03: the outbox

**CEO**, 05-09-2026, on how an offline clock-in should be recorded: *phone's time, marked pending* - and on what may queue: *attendance punches, task updates, leave and claim submissions, hotel call notes*.

### A correction first
The roadmap said push was "built but almost nothing sends through it". Wrong: every one of the 36 in-app notifications already reaches the phone through `notify()`. What was missing was smaller and is fixed below - a tap always opened the Dashboard, never the tab the notice was about.

### What was wrong
The offline banner said *"Changes cannot be saved until connectivity is restored"*, and meant it. A clock-in pressed in a lift was gone, and the person found out at payroll.

### The outbox
A write on a **queueable** route that cannot reach the server is kept on the phone (IndexedDB, so it survives the tab and the browser closing) and sent, in order, the moment the signal is back - on the `online` event, when the app comes to the front, and every 45 s while something waits. Three rules make it safe rather than clever:

1. **The list is explicit.** Seven routes, named in `lib/outbox.ts` and again in `worker/src/outbox.ts`; guard #40 fails the build if the two ever differ. A sign-in, a 2FA code, an approval, a "pull now" - none of those may queue, because replaying any of them later is wrong.
2. **Every queueable write carries an idempotency key, queued or not.** Minted once when the button is pressed, sent with every attempt. The worker stores the first answer under `(key, person)` and returns the *same* answer to any repeat - so a request that reached the server but whose reply died in the tunnel cannot become a second clock-in when the queue replays it. A replayed answer does not bump the live version either; nothing changed.
3. **The phone says when.** `X-Client-At` carries the moment the button was pressed. A punch sent late is recorded at **that** time - the day, the duplicate check and late/half-day are all judged against it - and **marked pending**, exactly like a forgotten punch (v1.76.0): it counts for nothing until the CEO approves it. The approver sees *pressed 09:02 · arrived 09:41*, which is a different thing from a punch typed in at 09:41. A timestamp is only trusted when it travels with a key, is more than a minute old (otherwise this is a live request and now is the truth) and less than 48 h old (a phone clock a week out is not a punch).

**Every kept write says so.** The punch, leave, task status, task tick and claim each got a `queued` branch whose toast reads *"Kept — no signal"* - because "saved" would be a lie for a few minutes. A claim kept offline cannot carry its receipt (the receipt needs the claim's id, which does not exist yet); the toast says to attach it with Edit once it has gone. The banner now reads *"N changes kept on this phone, sending when you are back"*, and a kept change the server later **refuses** - an offline clock-in that turned out to be the day's second - is shown with the server's own words until dismissed, never dropped silently.

### A push lands on its tab
`notify()` deep-links by kind: *leave approved* opens Leave, *task assigned* opens Tasks, a stock alert opens Inventory. The portal reads `?tab=` once and removes it from the address; the service worker now **navigates an open portal window** to the tab instead of matching by substring and opening a second one. Shell bumped to v32 so installed phones pick it up.

### iPhone coaching
Safari on iOS has no install prompt, and iOS push works only once the site is on the Home Screen - so the two features this phase most wants a phone to have were a Share-sheet away from anyone never told. One card on the Dashboard, phones only, iOS + Safari + not installed, dismissed once and never again.

### Guards
**#40** (`tests/outbox.mjs`, 71 checks) runs the real worker module against a fake D1: one key runs the handler once; the second call returns the first answer with the replay header; a different person with the same key is a different request; a 5xx is not stored so a retry really retries; a 409 *is* stored so a third attempt still says "already punched"; no key, a malformed key, or a key on a non-queueable route runs every time; a database without 0114 runs the handler rather than failing. `clientAt` is run against now, 20 s ago, 5 min ago, 40 h ago, 3 days ago, the future and garbage. Negative-tested seven ways - a route on one list only, storing a 500, dropping the one-minute floor, removing the key header, judging the day from the server clock, deleting the leave toast, reverting the shell version - each fails.

Migration **0114** adds `idempotency_keys` (purged nightly after 7 days) and `attendance_records.offline_sent_at`.

## [1.104.0] - 2026-09-05 - roadmap phase 02: views are remembered

### What was wrong
`lib/cached-api.ts` has existed since v1.25.0 - paint the last known figures at once, refresh quietly behind them, say "updating…" on anything financial. It was wired into **two files out of ninety-two**. Every other card showed a grey skeleton on every single visit, including the tabs people open forty times a day.

### What changed
Nine views now open from the device first and refresh behind: **News, Tasks, Leave** (the three everyone opens daily), the **Staff** directory, **Hotels**, **Assets**, **Web Orders**, **ELFIA Traffic**, and the month-end **attendance reconciliation**. The second visit to any of them is instant, including a cold open on a phone in the morning; the first-ever visit still shows the skeleton it always did.

Three things had to change in the hook itself for that to be safe:

- **It is live.** `useCachedApi(path, enabled, topics)` now takes the SSE topics a view depends on and refetches when one moves. A remembered view is never stale for longer than the stream takes to say so - and the topic wiring the converted tabs used to carry by hand (`useLiveRefresh(["tasks"], load)`) moved inside.
- **It is honest.** It reports `failed`, so a card can tell "nothing to show" from "showing yesterday's". The Staff directory only says the list could not load when there is nothing remembered to show; a stale-but-present list is better than a warning over an empty one.
- **It fits real views.** The 120 KB ceiling silently refused the very views that gain most - the whole hotel directory is ~230 KB of JSON. The ceiling is 400 KB, and a write that trips the browser's quota now evicts the **oldest** entries and tries once more, so the cache degrades to *remembering less* instead of *remembering nothing* as it fills.

The **Leave** tab also got faster in a second way: its three requests (balance, mine, everyone's) used to run in series, so an approver waited three round-trips before the board drew. They run at once now.

**Money still says so.** The reconciliation wears the "updating…" mark while remembered figures refresh - the CEO's rule from v1.25.0, kept.

### Guards
**#39** (`tests/remembered-views.mjs`, 44 checks) runs the real cache module against a fake localStorage with a quota: an entry over the ceiling is refused rather than thrown; a write that trips the quota evicts oldest-first and lands; an entry past 24 h reads as nothing; one account can never read another's; a genuine account switch wipes the store and a same-account reload does not. It then holds each converted view to reading through the hook with its topic. Negative-tested by removing the eviction retry, dropping the live wiring, putting `setLoaded` back into the hotel panel, and removing the StaleHint from the reconciliation - each fails.

`tests/api-routes.mjs` learned that `useCachedApi` names a full path and is a caller: 352 → **368** client calls now checked against the routes the worker actually serves. Without that line, every card converted here would have silently left the guard's sight.

## [1.103.0] - 2026-09-05 - roadmap phase 01: the bundle is split

**CEO**, 05-09-2026, on the roadmap: *"Proceed with phase by phase."*

### What was wrong
Nothing in the project was code-split - zero dynamic imports. The portal shipped as one bundle carrying every tab for every person: a live host opening the roster downloaded Payroll, Accounting, Purchasing, the ELFIA catalogue editor and the Threads study room to get there, none of which her role can open, all of which she paid for in download and parse time on a phone.

### What changed
`components/portal/lazy-panels.tsx` wraps every tab panel that is not on the first screen in `next/dynamic` - **30 panels from 20 modules**, each its own chunk, fetched the first time its tab is opened and cached after. They are the same components under the same names with the same props, so the thirty render sites in `page.tsx` did not change; only the import lines did. The fallback while a chunk arrives is a skeleton, not the word "Loading" (house rule #28), and `ssr: false` because the page is behind sign-in and prerenders to a skeleton anyway.

What stayed static, on purpose: everything the Dashboard paints on first load (`dashboard-cards`, `company-monitor`, `side-columns`, `ops-map`). Deferring the first screen would add a round-trip to the one moment that matters most.

### Measured, on a real `next build` of this tree
| | route chunk | first-load JS |
|---|---|---|
| before | 280 kB | 435 kB |
| after | **120 kB** | **252 kB** |

That is 42% less JavaScript before the portal can draw, and the route's own chunk down 57%. The heaviest things now load only when asked for: the payroll and payslip code is its own chunk, the Threads study room another, and the PDF library only arrives when somebody actually prints a document. On a phone on hotel wifi the difference is the part of the wait you notice.

**Guard #38** (`tests/lazy-panels.mjs`, 152 checks) is what keeps it this way. It reads the list of wrapped modules out of `lazy-panels.tsx` and asserts that `page.tsx` imports none of them statically (a static import anywhere pulls the module back into the first bundle and the `dynamic()` beside it becomes decoration), that every wrapper points at a module and a named export that exist (a misspelt `m.Foo` is `undefined` at runtime - a blank tab, not a type error), that every wrapper is rendered and imported through the wrapper, and that the first-screen modules are *not* wrapped. Negative-tested by re-adding a static import, misspelling an export, wrapping `dashboard-cards`, and replacing the skeleton with "Loading…" - each fails.

### Not in this phase
The panels written inside `page.tsx` itself (Dashboard, Leave, Tasks, Sales, Announcements, Profile) cannot be split until they are extracted into their own files - the page chunk is still 433 kB unminified for that reason. That is the housekeeping item on the roadmap, not phase 01.

## [1.102.0] - 2026-09-05 - the CEO's own tab order, and two tabs parked

**CEO**, 05-09-2026, writing the entire tab list out himself, in the order he wants to read it, ending: *"Stokis - inactive this for future usage. Content - inactive this for future usage."*

### The order is his
`ALL_TABS` in `lib/portal-tabs.ts` now runs: home, then what the company **sells** (Ecommerce, Inventory, Sales, Assets, Hotels, Threads), then the **ELFIA** store's own three, then the **people** stack (HR, Attendance, Tasks, News, Staff, Leave, Claims, Payroll), then the **money** stack (Finance, Reconciliation, Commission, Ads Fund, Purchasing, Accounting), then your own account. That list also decides the **phone bottom bar**, which shows the first four tabs a role can see - so on a phone the thumb row is now Dashboard, Ecommerce, Inventory, Sales.

**No tab was renamed.** His list says "News" and "Staff", which is what those two tabs have displayed on screen since `lib/i18n.ts` got its dictionary - `Announcements` and `Staff Details` are internal keys. Renaming the keys would have changed nothing visible and orphaned every tab-access override and per-person grant saved under the old names, so the keys stayed.

### The sidebar was the real complaint
The desktop rail had its **own** ordering (`SECTIONS` in `side-nav.tsx`), written at v1.13.0 and never revisited. Five tabs added since - **Hotels, Threads, ELFIA Store, Web Orders and ELFIA Traffic** - had never been placed in a section at all, so they fell through to an unlabelled "Other" group at the bottom of the rail. That is what he was looking at.

The sections are now **cuts of the one sequence**, not a second ordering laid over it: read the tabs down the sidebar and you get `ALL_TABS` exactly. Six groups - Overview, Business, ELFIA, People, Finance, Account - nothing orphaned. `tests/registry-parity.mjs` now fails the build if the sidebar ever resequences the registry or leaves a tab unplaced again.

### Parked, not deleted
**Stokis** and **Content** are finished features he intends to switch on later, so deleting them would mean writing them twice; and merely unticking them in the access card leaves defaults sitting in `TAB_ROLES` ready to reappear the day somebody resets an override.

So `PARKED_TABS` is a **third rail** in `canSeeTab`, and it sits **above** the super_admin bypass, above saved overrides, and above per-person grants:

- Nobody sees them - not even a super admin. A tab taken off the product should not still be there for one account; that is how a half-finished feature becomes a support question.
- They drop out of the 🔐 access card, and out of the worker's `TAB_ACCESS_TABS`, so the **API refuses to grant one** even if a request arrives naming it.
- A stale override or personal grant in `system_meta` naming them cannot bring them back.
- The **"Who sees what"** card still lists them, struck through, saying *"built but switched off for everyone"* rather than "hidden by the role" - which would have been untrue and would have invited a press that could only fail.
- Their panels, routes, role defaults and hints all stay exactly where they are. **Un-parking is deleting a name from one list.**

Guards: `registry-parity` gained four checks (the parked list is real, the rail sits above the bypass, the worker whitelist drops parked tabs, the sidebar reads as the registry) and `person-access` nine. Each negative-tested: moving the rail below the super_admin bypass, dropping a tab from the sections, reordering the sections, leaving a parked tab in the worker whitelist, removing the rail, and reporting a parked tab as role-hidden all fail.

## [1.101.1] - 2026-09-05 - a list that scrolls, and a chart you can edit from

**CEO**, 05-09-2026, with the Hotels tab and the new Organisation view side by side: *"Every state 442 shown show the list too long, should scrollable at least. also for Organisation, I want to edit back if I want to change their reporting to HOD."*

### The hotel list scrolls in its own box
442 rows is a page fourteen screens deep. By the time you are reading Johor, the search box, the Export CSV button and the map are all somewhere above you, and getting back to them is a long flick.

The rows now scroll inside the card while the toolbar and the map stay put. This is not the two-scrollbar mistake v1.99.4 undid on the staff circle: that was a 30rem box around a 34rem **picture**, which cut a whole thing in half for nothing. A directory is a list you page through by nature. The height is capped against the **viewport** rather than a fixed pixel count, so it fills a big monitor without swallowing a laptop, and `overscroll-contain` means a flick at the bottom of the list stops there instead of running the page away behind it. The count beside the heading now says the list scrolls.

### The reporting line is changed from the box
v1.101.0 could already do this - from a panel that shipped **collapsed** at the bottom of the page. That the CEO had to ask for it is the clearest possible report that a control behind a "Show" link is a control nobody finds.

- **Every box on the chart now carries a pencil**, and pressing it opens a picker in a bar under the chart. Not a popover pinned to the box: the tree scrolls sideways and a popover would sail off with it, and expanding the branch itself would shift the tree under the hand that just pressed it.
- **The root has no pencil.** Nobody sits above the top of the chart, so a control there could only ever be refused.
- **The full "Reporting lines" table starts open.**
- The card is now a `<span>` holding two buttons rather than a button holding buttons - browsers silently un-nest that, and one of the two presses stops working.

Guard #37 gained seven checks (56 total) and guard #36 four (38), each negative-tested: removing the scroller, restoring the pencil on the root, and re-collapsing the table all fail.

## [1.101.0] - 2026-09-05 - the organisation chart

**CEO**, 05-09-2026: *"I want to add infographic for each staff reported to who which is either CEO, COO or CCO. I will assigned by myself and organized it based on who is their HOD to make it like organisation."*

**Staff Details** now has two views - **Circle** and **Organisation** - on one segmented control. Same people, same fetch, same permissions; pressing a box on the chart opens the same record card the circle does.

### One column, not three buckets
The literal reading of that sentence is three lists: the CEO's people, the COO's people, the CCO's people. It draws a chart that cannot say the second half of the sentence. *"Organized it based on who is their HOD"* means an HOD has their own people - and those people are not the COO's direct reports, they are the HOD's.

So each person points at **one other person** (`users.reports_to`, migration 0113), and the three divisions are read by walking **up** the line rather than stored beside it and left to drift. A two-level chart is a special case of this one. The company can grow a fourth level without a schema change or a second opinion about which division somebody is in.

### What the chart shows
- **The CEO is the root by role**, not by having an empty manager field - otherwise on day one, with every line unset, the first render would be the whole company in one flat row.
- **A stripe down each box is the division**, mixed from the brand (gold for the CEO's line, navy for the COO's, the two blended for the CCO's) so a re-brand carries it and both themes keep their contrast.
- **The number on the right is the whole subtree**, not direct reports. A manager of two who each manage four is not a manager of two.
- **Leavers are not on it.** Somebody who resigned stays in the directory and in the circle, faded. On an org chart they would be a box with live people hanging off it.
- **Everybody not yet placed waits in a tray under the chart**, each with a "reports to" picker. That is both an honest statement of where the chart stands and exactly the worklist for finishing it.

### Who assigns
The **CEO, COO and CCO** - `org_assign` in the worker. Deliberately narrower than HR, and deliberately without `admin` and `super_admin`: who a person answers to is a statement about how the company is run, and the CEO said he assigns it himself. Everyone who can already open Staff Details can **look** at the chart. Every change is written to `audit_log` with both names, not just two ids.

### The loop
A cycle - A reports to B reports to A - is the one shape that matters, because a chart is drawn by descending and a division is read by ascending. **The worker walks the line up from the proposed manager before writing** and refuses anything that closes a ring, with a hop limit so the check that finds cycles cannot itself be hung by one. The picker never offers a choice that would close a loop in the first place, and the renderer sweeps anybody stranded in one into the tray rather than dropping them off the page - five people invisible is worse than five people waiting.

**Guard #37** (`tests/org-chart.mjs`, 49 checks) runs the real tree builder against data carrying every broken line at once - a manager who left, a manager who does not exist, a person pointing at themselves, a pair pointing at each other, a closed ring of five - and asserts that every active person ends up on the chart or in the tray, exactly once. Negative-tested by dropping the tray sweep, removing the hop limit (the run hangs and is killed, which is the point), emptying the descendant filter, adding `hr_admin` to `org_assign`, deleting the worker's cycle walk, and removing the failure toast.

### Also
- The staff list's migration-skew armour got its **own rung for 0113**. Bolting `reports_to` onto the existing fallback would have meant that, between the code deploying and the migration applying, one missing column silently cost the Staff tab the seven profile fields it has had since v1.4.213. One new column costs one new column.

## [1.100.3] - 2026-09-05 - the hotel map is the real map

**CEO**, with a screenshot of the Operations map beside the Hotels tab: *"why Hotel mapped doesnt looks like this?!!!!"*

He was right, and v1.100.2 fixed the wrong thing. I had made the grid of tiles wider and darker when the problem was that it was a grid of tiles at all.

### There was already a map of Malaysia in this portal
`lib/malaysia-map.ts` has held real Malaysian geometry since v1.20.1 - sixteen state outlines, the two standard insets, a dashed divider between the peninsula and Borneo. The **Operations map** draws it. The **ELFIA Traffic map** draws it. I built the hotel map as a cartogram of rounded squares instead, reasoning that an outline makes Perlis a speck and Sarawak a third of the picture. That reasoning is fine in the abstract and worthless here: three maps of one country inside one product do not look like one product, and that is exactly what he saw.

**The Hotels card is now the third consumer of the same geometry**, drawn in the same visual language as the other two: gold fill whose weight is the count, a navy bubble carrying the number, the same insets, the same divider, the same theme tokens. Change the brand and all three follow.

### The one thing the tiles were better at is kept
A tile made Kuala Lumpur - 104 hotels, the largest entry in the directory - as easy to press as Pahang. On the real map it is a shape a few pixels wide, and Putrajaya is smaller still. So on this map **the count bubbles are buttons**, not decoration as they are on the Operations map. The number you can read is the thing you press, and the two federal territories are reachable.

### Sixteen shapes, fifteen states
The geometry is the country and includes Labuan; the workbook is the sales territory and has fifteen sheets, no Labuan. The map draws all sixteen - Labuan shades as empty, which is true - while the "which state" picker offers only the fifteen the server will accept, because an option that is refused on save is a bug with a shrug for an error message. The panel names that difference in one place (`NOT_A_WORKBOOK_STATE`) and **guard #36 now reads that place**: it asserts the panel imports the shared geometry rather than defining shapes of its own, that every state the worker accepts has a shape, and that the picker offers exactly the fifteen. Negative-tested by renaming Perlis in the geometry, by emptying the exclusion set, and by replacing the import - each fails.

## [1.100.2] — 2026-09-05 — the hotel map, fixed

**CEO**, on the Hotels tab: *"why map looks like this!"*

Two things, and the first is the one that made it look broken.

### The frame was three times the width of the map
The bordered panel was full-width while the grid inside it carried the `max-w`, so a 704px map sat in the middle of a 1600px box with a third of it empty on either side and the border miles from the picture. **The frame now carries the width** (46rem) and the grid fills it, so the panel hugs the map.

### Every tile was grey
The shade was `color-mix(primary N%, card)` topping out at **60%** — so even Kuala Lumpur's 104, the darkest tile on the map, came out a pale slate and the whole thing read as grey boxes. A choropleth whose darkest tile is not dark has no top end. The ramp now has five steps and reaches **full** primary: 100 / 72 / 48 / 28 / 15%, with the label flipping to `primary-foreground` from 48% up. Kuala Lumpur is now navy, Perlis is nearly white, and the gradient between them is readable at a glance.

### Two smaller things
- **The empty column between the peninsula and Borneo is labelled SOUTH CHINA SEA**, set vertically in the gap. It was always the sea; saying so is what turns a hole in the grid into a map.
- **Putrajaya and Negeri Sembilan swapped cells.** Putrajaya now sits directly under Kuala Lumpur — both are federal enclaves in the same place — and Negeri Sembilan sits under Selangor, which is where it is.

## [1.100.1] — 2026-09-05 — a folder of copies stopped the website building

The v1.100.0 deploy published the API and then failed on the website:

```
./Claude outputs/hotels.ts:35:26
Type error: Cannot find module './index' or its corresponding type declarations.
```

**Nothing was wrong with the code.** `Claude outputs` is a folder the desktop app creates INSIDE the project and drops delivered files into when it cannot place them itself — which is what happened while the bridge was down mid-delivery. It had a flat copy of every file of v1.100.0 in it, `hotels.ts` among them. `next build` type-checks everything `tsconfig.json` includes, and that copy's `import type { Env } from "./index"` only resolves from its real home in `worker/src/`. So a duplicate of a correct file failed the build of the half that had not deployed yet.

- `tsconfig.json` and `eslint.config.mjs` now exclude `Claude outputs/**`. Verified by putting a copy of `worker/src/hotels.ts` in such a folder and typechecking: it fails without the exclude and passes with it.
- The folder is safe to delete — everything in it is a duplicate of a file that lives somewhere else in the project. Deleting it is tidiness, not a fix: the build no longer looks there either way.

The v1.100.0 files themselves are now in their proper places (`worker/src/hotels.ts`, `worker/migrations/0111`, `0112`, `components/portal/hotels-panel.tsx` and the registries), which is why `[5/7] No migrations to apply` — the migrations were never on disk when the deploy read them.

## [1.100.0] — 2026-09-05 — the hotel directory, listed by state

**CEO**, with `1. DATA HOTEL.xlsx`: *"add new tabs for save all this data list, make sure that it is being listed by State ... Name of Hotel, Name of Company, contact person ... include their name, phone number based on Malaysia format and their email. Validate the state based on the tabsheet of the excel. make the infographic map for me to easier clickable and also professional with nice futuristic. Also make sure that I can a function to edit or to delete it ... Tabs only visible for ceo, cco, coo, hr_admin, super admin, admin."*

**442 hotels and 690 named contacts**, now a tab.

### Reading the workbook
- Columns were found by **header, not by letter** — Selangor carries a `CONTACT 4` column, which pushes capacity and star rating one place right on that sheet alone. A fixed-letter reader would have filed 50 hotels' room counts as star ratings.
- A contact cell is a block of text (name, one or two numbers, an email); it is split into its parts once, on import.
- **Phone numbers are stored in Malaysian form** — `012-345 6789` for a mobile, `03-1234 5678` for a landline, `088-123 456` for Sabah and Sarawak, with `ext` kept. 27 cells held two numbers jammed together with no separator; those were split. All 690 now match.
- The user's note said contacts were in columns D, E, F; in the file **D is the address** and the contacts are E, F, G (and H on Selangor). The address is kept as its own field.

### The tab
- **The map is a tile cartogram**, not a tracing of Malaysia: one rounded tile per state, laid out in the country's rough geography, shaded by how many hotels are in it and carrying the count. An outline would make Perlis a speck nobody can hit and Sarawak a third of the picture — the opposite of what a list of 442 needs. Press a state to filter; press again for all. Glass panel, soft primary wash, theme tokens throughout so it reads in light and dark.
- **Search runs over the hotels and their people**, because "who do we know at the Hilton" and "which hotel does Aida work at" are the same question from two ends.
- **Edit and delete** on the portal's own `rowBtn` / `rowBtnDanger` / `inputClass` — not one bespoke button in the file, as asked. One form creates and edits alike, contacts add and remove inside it, and a delete asks first and reports either way.
- CSV export, one row per contact.

### State is a closed list
The workbook's fifteen sheet names are the only legal states, held in **three** places that the guard compares name for name: the migration's `CHECK` constraint, `MY_STATES` in the worker, and the map's tiles. A hotel filed under an invented state is a hotel that disappears from every view that groups by state.

### Access
`hotels_view` and `hotels_manage` are exactly the six roles the CEO named — CEO, COO, CCO, hr_admin, admin, super_admin — in the worker matrix and mirrored in `TAB_ROLES.Hotels`. Deletes are **soft** (`is_active = 0`) and audited with the hotel's name, so a mis-click loses nothing.

### Guard #36 — tests/hotels-guard.mjs (31 checks)
Runs the real `formatMyPhone` over the shapes the workbook actually contained, compares the three copies of the state list, holds the six roles exactly, and requires the soft delete and its audit. Each family negative-tested.

## [1.99.4] — 2026-09-05 — the Staff circle stops scrolling, and looks the part

**CEO**, on the redrawn Circle: *"should it scrollable for this staff UI/UX? I dont think so. please make it looks professional and more futuristic"*

### The scrollbar was a bug, not a feature
A `max-h-[30rem]` box wrapped the whole Staff view. The circle is 34rem, so the box cut its bottom third off and put a **scrollbar inside a card that already sits in the page's scroll** — two scrollbars for one picture, and the two faces at the bottom of the ring were simply not there until you found the inner one. The inner scroller is gone at every width, and the orbit is now sized against the **viewport** — `min(34rem, calc(100svh − 25rem))` — so it is whole on the screen it is drawn on and the page scrolls once, or not at all.

### Professional, and a little futuristic
- The field is a **glass panel**: hairline border, translucent card, backdrop blur, rounded 24px.
- A slow **conic sweep** turns behind the orbit (26s) — the one moving thing that says "live" without being a toy.
- The centre's halo **breathes** (4.5s), each face lifts on hover with a soft primary glow, and its spoke to the centre brightens.
- Every one of those is a theme token, so it reads the same in light and dark, and every decoration is `pointer-events-none` behind the faces — nothing new can swallow a press.
- All animation is dropped under `prefers-reduced-motion`.

Guard `clickable-data`: the square-field check no longer pins the `max-w-[34rem]` class (v1.99.4 caps the size in a style instead, because a viewport calc has no Tailwind class). It now asserts the property — the orbit is `aspect-square` and capped, by class or by style. Negative-tested by removing `aspect-square`.

## [1.99.3] — 2026-09-05 — the note blamed the wrong thing

**CEO**, with the Meta dashboard open on **Publish: Published** beside the portal's amber note claiming Development mode: *"why??!"*

He was right and the note was wrong. **App Mode is not what gates this.** What gates it is the ACCESS LEVEL of the one permission:

- **Standard access** — what every app holds before review — lets `threads_keyword_search` return posts written by the app's **own Threads testers** and nobody else. Published or not, live or not, that is all it can see. Which is exactly what he got: one post, his own.
- **Advanced access** for `threads_keyword_search` is what opens the search to the public, and it is granted only through **App Review** (dashboard → App Review → Permissions and features → `threads_keyword_search` → Request advanced access). Meta usually wants **Business Verification** and a short screencast of the feature in use first.

The topic note now says that, with the path to click, and no longer mentions App Mode at all. Guard #35 gains a check that the note names App Review and does **not** name Development mode — negative-tested by putting the old wording back.

Nothing else changed: the Study section, its filters and the seven-day retention are as they were in 1.99.0–1.99.2. The tool is finished and waiting on Meta, not on code.

## [1.99.2] — 2026-09-05 — as many document lines as fit one page, and a Circle that breathes

Two things the CEO asked for in the same sitting.

### 1. "Add more line if require as long as not exceed to 1 page!"
The document editor never capped item lines — but nothing told anyone where the page ended either, so a long quotation silently spilled onto a second sheet whose footer, acceptance block and signatures were orphaned. Every A2Z document is designed as ONE page.

So the page is now a **budget, measured in millimetres** by `docPageFit()` in `lib/doc-template.ts` — from the template's own geometry (A4 less print padding, less letterhead, meta strip, address panels, table head, totals block, acceptance/payment block, footer). It is used **twice, from one definition**:

- **In the editor:** a slim bar beside *+ Add line* reading *"6 lines · room for 9 more"*, amber past 85%, and the button stops at the line that would overflow instead of letting it. A long description or a stack of detail lines eats the budget faster than a plain line, and the bar shows that as you type. Save re-checks with the same function and refuses with a sentence naming the ways out (shorten, remove a detail line, split into a second document).
- **On the paper:** when the lines need the room, the item table prints in a **denser style** (tighter padding and leading, same design) rather than spilling. The editor says so: *"prints tighter to stay on one page"*.

Detail lines per item raised 10 → 12, since the page — not an arbitrary number — is now the real limit.

### 2. "Still not nice for UI/UX!" — the Circle, third pass
The diagnosis was the **caption**, not the radius or the colour. A name and a role pinned under every floating face means each person needs a 112 × 110px box on a circle; on a nine-person ring those boxes touch, which is why "Nurfarah Suaidah" wrapped to two lines and Izzudin's role sat under Nasuha's chin.

The orbit now carries **faces only**. The name floats over the face as a chip on hover or keyboard focus (positioned, so it can never push a neighbour), and **one caption bar under the field** — fixed height, so nothing moves — names whoever is hovered or open, with their position, their leaving date if they have gone, and their birthday if it is close. The spoke to the hovered face brightens. With the captions gone the ring widens and the faces sit further apart; the circle finally has air in it, and exactly one label is on screen at a time, which is why it stays legible. The phone grid keeps its captions.

Guard `clickable-data` gains a predicate form so a check can assert a property across **every** `<StaffBubble/>` in the file — that each one presses the single `press` handler — instead of one hand-measured window that any new prop widens past. Negative-tested.

## [1.99.1] — 2026-09-05 — the Circle, redrawn

**CEO**, a screenshot of the Staff circle: *"make this circle bubbles looks better and nice interface!"*

### What was wrong with the first one
It put one ring per **tier** — five rings 13% apart on a 544px square — so a face with its two-line caption (110px tall) sat on a 70px gap. Nasuha's face covered Izzudin's caption, "Nurfarah Suaidah" wrapped, the rings were too faint to read as rings, and the leaver's red ring shouted from the corner.

### What it is now
- **One orbit** (two above eight people, three above sixteen), walked **clockwise from the top in company order**, the most senior at the centre. The tier lives in the order and the caption, not in a radius of its own — that is how a nine-person team fits a circle a person can read. Radii are chosen so the arc between neighbours is wider than a cell.
- **A field that reads as an orbit:** a soft radial wash behind, a dashed ring per orbit turning very slowly, a hairline **spoke** from the centre to every face.
- **Faces that lift:** a white-offset ring and shadow on every face, a 96px centre with a soft halo, roles as small **pills** (the centre's in primary), a leaver **faded and greyscale** with a quiet grey ring instead of red. Drift trimmed to 3px.
- A one-line legend under the field says how to read it; the birthdays line is now **pressable chips**, amber inside a week.
- Phone view unchanged (the three-column grid).

Guard `clickable-data`: the two circle checks that pinned the 34rem cap and the exact radius list — implementation, not property — are replaced by three that assert the property: a square field, one radius feeding both x and y of a face, one number feeding both width and height of a ring. Negative-tested.

## [1.99.0] — 2026-09-05 — Threads is a study room, and it keeps a week

**CEO**: *"remove library since this is not supposed to view by my staff. the objective for this Threads to make them to find a study case based on the market research and the demand based on the keywords that they want. and the data should not keep too much since it is only for 7 days for them to study. Additionally, you need to make sure that D1 from Cloudflare not hold so much data for the Threads research to minimalist the requirement of D1 storage capabilities. make it properly planned and also ensure that dont touch another area tabs or data beside of Threads!"*

### The plan, in one paragraph
Threads had two halves: the connected account's **own** posts and numbers (Overview, Library, the history import, the daily snapshots) and **study cases** (public posts found for a topic). The first half is the CEO's personal Threads history shown to the staff, and it was also the half that grew without limit — one metrics row per post per day, forever. The second half is the objective. So the first half goes, entirely; the second half stays and gets a ceiling on every axis: days kept, posts per topic, topics. Nothing outside `worker/src/threads.ts`, `components/portal/threads-panel.tsx`, the Threads migrations and the Threads guards is touched; the only edits in `index.ts` are the migration bookkeeping and the cron comment.

### What goes
- **Overview and Library sections** — gone from the panel, with their state, loaders, CSV, tiles and the `/posts` and `/summary` routes behind them. Study is the section the tab opens on; **Connection is offered to management only**.
- **The history import and the snapshots** — `importPage`, `snapshotPost`, `snapshotAccount`, baselines, the Sync now button and its route. The cron tick now does two things: refresh tokens that are due, and purge.
- **Three tables** — migration 0110 drops `threads_posts`, `threads_post_metrics`, `threads_account_metrics`. The sync columns on `threads_accounts` are set idle and never written again (left in place: dropping columns is where a migration goes wrong).

### What the database may hold, written down
- `KEEP_DAYS = 7` — a found post is deleted seven days after it was found.
- Search records are deleted after **8** days — the quota is a rolling 7-day window and needs a day of slack, or the day it runs would be undercounted.
- `POSTS_PER_TOPIC = 400` — after every search, oldest-found go first, so the week's newest reading is what stays.
- `MAX_TOPICS = 40` — a 41st topic is refused with a sentence, not a stack trace.
- Removing a topic removes its posts on the next tick.
- **Ceiling of the whole thing:** 40 × 400 rows of short text plus one week of search records. The Study header now shows *"Kept 7 days · N posts on file"* so the week is a figure on the screen, not a promise here.

### Guard #33 rewritten where it described the old machinery (70 checks)
The budget section now holds only `refreshDueTokens`. A new section 6 holds the week: KEEP_DAYS is seven, the purge deletes by `found_at` and by the quota window, it runs on every tick, the per-topic and topic ceilings exist, nothing names the dropped tables, 0110 drops all three, no `/posts`, `/summary`, import or snapshot remains, the panel has exactly Study and Connection with Connection gated to management, and the storage figure is on screen. Each negative-tested. `docs/THREADS-PLAN.md` carries a status note: phases 2–5 (drafting, publishing, autopilot, AI on the account's own history) are shelved.

### After deploying
Migration 0110 applies with PUSH.bat. The Connection section no longer shows "posts imported" or "last sync" — the account exists to hold the search credential and that is all it says.

## [1.98.0] — 2026-09-05 — who is ASKING for it, and who is selling it

**CEO**: *"I want study case posting which is for me to find if there is anyone users in Malaysia looking for the keywords or posting that the keywords that I want to find so that I can do some research on the requirement and demand for my business study!!!!!"*

### Demand reads differently from supply
A person **looking** for a tudung writes a question with an ask in it — *ada tak, mana nak cari, any recommendation, berapa harga, worth it?* A person **selling** one writes an offer — *ready stock, RM 39, DM to order, free postage*. Both contain the keyword, so counting the keyword was never going to be a demand study. Every harvested post is now read for its intent at harvest — **asking**, **selling** or **other** — and the verdict is stored with the post (migration 0109; older rows are scored on first open).

### On the Study section
- **Asking / Selling / Any** chips beside Malaysia / All. *Asking* is the demand: Malaysians (with the Malaysia switch on) who want the thing your keywords name. Counts on each chip.
- Each post is tagged *asking* or *selling*; the topic line says "… · 7 asking".
- "What this niche does" opens with **Asking or selling** — the three-way split — and **What the asking posts say**: the words the demand posts use, each a button that filters to those posts. That list is the requirement, in the customers' own words.
- The empty state for *Asking* is honest: *"Nobody in this harvest is asking for it… demand is not showing on Threads for these words yet."* That is a finding too.
- CSV gains an *Asking or selling* column.

### Why the harvest is one post, said on the topic
When **every** post a search returns belongs to an account connected to this app, the topic now carries an amber note (not red — it is not an error): that is what a Meta app in **Development mode** returns; it only sees its own testers. Switching the app to **Live** in the Meta dashboard is what opens the search to everyone. Until then the Study section is fully built and waiting.

Guard #35 grows to 38 checks: nine intent sentences (asking, selling, other), a question that names a price is still a question, one stray "link" is not a shop, storage and backfill, the chips, the note. Negative-tested.

## [1.97.1] — 2026-09-05 — a base salary change reaches the month on screen

**CEO**, on the Payroll tab: *"Base salaries was not sync with staff table Basic! then Net why didnt correcly count? this is something that bug or wrong flow!"*

It was the flow. The Base salaries panel said, in small print, that a change "applies from the next unsaved month onwards; months already saved stay as saved". September had already been saved with the CCO at RM 3,500; his base was then raised to RM 4,000; the row kept 3,500, the net followed the row, and the only sign was a 10px "Base" link nobody would read as "these two disagree".

### What changes
- **Save base salaries now carries the change into the open month.** For every person whose base changed, if their row was simply following the base (Basic equal to the old base, or never saved), the row's Basic becomes the new base and the row is **saved at once with its net recomputed** — by the same formula, on the row about to be written, not on the old state. The toast names each row: *"09-2026 Basic re-filled and saved: Mohamad Izzudin (RM 3,500.00 → RM 4,000.00)"*.
- **Two things are deliberately left alone**, and the toast says which and why. A month already **released** to staff is not changed under them — the row shows the difference and a button to change it on purpose. A Basic that was **set by hand** to something other than the old base was a decision, so it stays and is flagged.
- **The flag is visible now:** an amber chip on the row — *≠ base RM 4,000.00 · Use base* — with both figures in the tooltip, instead of the old link.

### On "Net didn't count correctly"
Net follows the row's Basic, so the CCO's RM 3,500.00 was the row, not the formula. The two RM 1,923.08 nets are RM 2,000 less one approved unpaid day (2,000 ÷ 26 = RM 76.92), shown in red under each — the deduction the UL:1 mark warns about. That part is correct.

Guard `payroll-days` gains four checks (89), each negative-tested: the carry-over exists and saves the row; a released month is left as saved; the re-filled row is priced with the shared formula on the new figure; a hand-set Basic is flagged, not replaced.

## [1.97.0] — 2026-09-05 — the Malaysian posts, and why each one counts

**CEO**, with the first study case on screen: *"I want to search and filter the Threads post by malaysia users which is for me to do some research based on their post regarding on the Study cases that I want to view. this is to helping me to boost my product for marketing purposes!"*

### What Threads does not give us
A public post carries no country. There is no location on the author, no country filter on the search, no field to ask for. So "Malaysian" cannot be read off Meta — and nothing about a person is looked up to get it (OD-20a stands: this is the text of a public post and nothing else).

### What the post itself gives away
The worker now scores every harvested post from its words, at harvest: **Malay wording that is Malay rather than Indonesian** (tak, nak, dah, korang — not gak, banget, aja), **a price in RM**, **a Malaysian place** (KL, Johor, Penang, Langkawi, Sabah …), and a short list of words nobody outside Malaysia writes (tudung, bawal, tapau, jom …). Indonesian markers pull the score down by name. The verdict is stored as `my_signal` and the **reason beside it** as `my_reasons` — "penang · Malay wording", "RM price", "reads Indonesian" — because a number nobody can check is a number nobody should trust.

### On the Study section
- **Malaysia / All** switch above the posts, Malaysia on by default; the findings panel ("What this niche does") recomputes for whichever is showing, so the hooks, lengths and hours are the Malaysian niche's, not the world's.
- Every post carries a small **MY** badge (hover for the reason); the reason is printed when the post is opened. The topic line says "12 of 40 read as Malaysian".
- Language is now three-way: Malay, English, **Indonesian** — and the bar dropped from three words to two, so a 13-character post is no longer "unclear".
- The CSV gains *Malaysian* and *Why* columns and says in its header when it is Malaysian-only.
- A tip under the topic form: the search has no country filter, so **the words are the filter** — "hotel murah", "tudung bawal", "staycation KL" return Malaysian posts by themselves.

### Migration 0108
`my_signal`, `my_reasons` on threads_topic_posts, indexed by topic and signal. Rows harvested before it are scored the first time the study is opened.

### Guard #35 — tests/threads-malaysia.mjs (20 checks)
Runs the real functions, bundled from the worker, on sentences a Malaysian would not argue with — four that must read Malaysian, three (Jakarta, Lisbon, Bandung) that must not — and reads the source for the properties: the signal takes only text, nothing about a person is fetched, the reason is stored beside the verdict. Negative-tested.

### A note on what came back
The first search returned one post — the CEO's own. That is Meta's **Development mode**: the keyword search answers only with posts from people who hold a role on the app until the app is switched to **Live**. The Study section works; the niche arrives when the app does.

## [1.96.2] — 2026-09-05 — "An unknown error occurred" said in words

**CEO**, pressing Search now on *Hotel Malaysia*: *"An unknown error occurred"*.

That is Meta's whole answer when a Threads token lacks a permission. The A2Z account was connected under 1.94, before `threads_keyword_search` was on the scope list, so its token cannot search — and nothing in the database recorded that, because 0105 kept the token and forgot what it was minted for.

- **Migration 0107** adds `threads_accounts.granted_scopes`: the scope string asked for at connect, rewritten on every reconnect. A row still NULL predates search and is treated as unable to search.
- The Study section now says so **before** the button is pressed — a notice naming the fix (reconnect once) with an *Open Connection* button — and Search now is disabled until then. A search that would fail this way is refused at the route and spends nothing from the weekly allowance.
- A search only ever asks with a token that holds the scope. If Meta still answers code 1 after a reconnect, the message now says what that usually is — `threads_keyword_search` not added to the Threads use case in the Meta dashboard — instead of "unknown".

Guard #33: 68 checks (+3, each negative-tested). Triple bump: LATEST_MIGRATION, EXPECTED_MIGRATIONS, health probe 0107.

## [1.96.1] — 2026-09-05 — the first two results from the Study section

**CEO**, minutes after deploying 1.96.0, with two screenshots: *"2 errors: HTTP 500 / For field 'keyword_search': Param search_type must be one of {RECENT, TOP}"*.

### The search sent Meta's two parameters the wrong way round
1.96.0 put `KEYWORD` / `TAG` in `search_type`. Meta reads `search_type` as the **order** of the answer — `TOP` or `RECENT` — and the match mode is a different parameter, `search_mode`. Every search was refused at the door.

- A run now asks for the **top posts** and then the **newest** (two searches from the weekly allowance; only the top posts when fewer than two are left), so a topic re-run next week holds fresh posts as well as the ones that lasted. The quota badge says so.
- Topic-tag topics send `search_mode=TAG`. If the app is ever told it does not know `search_mode`, the words are searched as keywords and the topic says so, rather than failing.
- The toast now says both figures — *"14 posts back, 9 new"* — because "posts back" hid whether anything new had arrived. New is counted from the rows actually written, not from what came back.

### The history import gave up on a 500
The account sat at *"0 posts imported · history still importing · sync_error HTTP 500"*. 1.96.0 fell back to the plainer field list only on Meta's "unknown field" code (100); a bare 500 is not code 100, so nothing fell back and nothing was retried. Now every failed attempt hands over to a plainer one — fewer fields, then a smaller page of 25 — and only when the plainest ask also fails is the error written up. A 500 that arrives as an HTML page (not JSON) now carries its first words instead of just the number.

### After deploying
Reconnect the A2Z account once on the Connection section (the token minted before 1.96.0 lacks the `threads_keyword_search` scope), then press **Sync now**, then run a topic.

Guard #33 gains three checks (65): `search_type` carries TOP/RECENT and never the match mode; the match mode goes in `search_mode`; the import falls back on any failed attempt. Each negative-tested.

## [1.96.0] — 2026-09-05 — study cases: what the niche actually posts

**CEO**, with the A2Z account finally connected: *"I want to view only for study case on Product and Service like Hotel, product for Tudung."*

Not our account — the **subject**. What hotels post on Threads, what tudung sellers post, so a pitch or a content plan for the next client starts from what that niche does rather than from an opinion about it. A fourth section, **Study**, beside Overview, Library and Connection.

### What it can and cannot show, decided before it was built

Posts come from the Threads keyword search, which returns public posts by anyone — and **insights belong to the account that owns a post**. A stranger's post arrives as words, author, time, format and link, and nothing else. So every finding here is about the **writing**, never about reach: how they open (a number, a question, a call to act, with media), how long they run, which language, which words recur. There is no view column in the schema, because it would always be null, and the card says so in one line where somebody would otherwise read a share of posts as a share of eyeballs. The CSV repeats it, because an export outlives the screen it came from.

### The allowance is rationed, and the portal counts it

Threads allows roughly 500 keyword searches per rolling 7 days **for the whole app**. Every call is recorded — successful or not, because a failed call still spends one — and the section shows *"n / 450 searches left this week"*, amber under 100, red under 25. A search past the cap is refused here rather than at Meta: a quota you discover by being cut off is a quota nobody can plan around. The fifty held back are the difference between an allowance that runs out on a Tuesday and one that answers when somebody needs it.

Because the ration is shared, **spending** a search — and adding or removing a topic — is `threads_manage`. **Reading** a harvest is `threads_view`, so the whole marketing floor can study what was collected without anyone being able to empty the week's allowance.

### What a topic is

A name you will recognise (*Hotel*), the words to search for (*tudung*), and whether it is words-in-the-post or a topic tag. It is kept, not just run: the same words next week are a comparable reading, and a post already seen is never stored twice. Press a word in "Words they use" and the post list filters to the posts using it.

### One thing to do once

Searching needs a permission the app did not previously ask for, so **the connected account must be reconnected once** (Connection → Connect) to grant it. A search on an older token fails with a permission error, and the tab says exactly that rather than returning nothing and letting somebody conclude the niche is quiet.

### Guards

Eleven checks in guard #33: the scope is on the `SCOPES` constant (the first draft matched the word in a comment and stayed green with the scope removed), the quota refuses before Meta does, the cap is under 500, every search is recorded whether it succeeded or not, spending and topic changes need `threads_manage`, reading does not, every topic action is audited, a missing scope is reported as such, no study query names a view count, and the caveat appears on both the screen and the export. Negative-tested by removing the quota check, opening the search to viewers, dropping the scope and deleting the caveat.

**Two of my own new checks did not bite on the first pass** — one matched a comment, one was satisfied by a duplicate string — which is the same class of mistake the guard-writing rule at the top of `run-guards.mjs` exists for. Both were tightened until the mutation they name actually fails them.

## [1.95.2] — 2026-09-04 — the offer, on a timer

**CEO:** *"update the PUSH.bat for me to re-insert the THREADS_APP_ID is set / THREADS_APP_SECRET is set 1 more time."*

v1.95.1 added `PUSH.bat secrets` for exactly this, and it was the wrong shape: this file is **double-clicked**, so "run it with an argument" is a command line he does not open. The argument still works, but the ordinary run now offers it too.

When both credentials are already stored, the step asks once — *"Replace the Threads credentials now? [y/N]"* — waits **five seconds**, and carries on by itself if nobody answers. Press Y and it prompts for both; press nothing and the deploy proceeds as it always did. A deploy left running in another window still finishes unattended, which is the property that made a plain prompt unacceptable here.

It never asks twice in one run: if either credential was missing and has just been typed in, the offer is skipped.

## [1.95.1] — 2026-09-04 — replacing a secret, not just setting a missing one

**CEO**, on the deploy step that was supposed to help: *"THREADS_APP_ID is set. THREADS_APP_SECRET is set. why PUSH.bat already detected this??!"*

Because they were set an hour earlier, in the previous run of the same step, and a Wrangler secret lives on the Worker permanently — every deploy after that finds it there. The step asks Cloudflare which secret **names** exist and prompts only for the missing ones. Cloudflare never returns a value, so nothing in that check can tell a good secret from a stale, wrong, or rotated one; it can only see that something is stored under that name.

Skipping what exists is right — a deploy must not stop to re-ask for credentials it already has — but it left no way to put a NEW value in after rotating one, which is exactly what a leaked secret requires. So:

```
PUSH.bat secrets
```

prompts for both regardless, then deploys as usual. The ordinary run now says so in one line when it skips, instead of leaving the door closed and unmarked.

## [1.95.0] — 2026-09-04 — one order, on every list in the portal

**CEO:** *"review all the tabs and ensure that the list is ascending by roles which is CEO, COO, CCO, admin, hr_admin, Sales and Marketing, Designer, Live Host."*

Two things in that sentence. He has **placed `admin` himself** — above hr_admin, where v1.78.0 had deliberately left it further down because nobody had said where it went. And "all the tabs" is an audit, so this is an audit.

### The rank

`admin` moves from 55 to 35, between CCO and hr_admin, in `lib/staff-order.ts` **and** in the worker's `STAFF_ORDER_SQL`. Those two are the same order written twice — once for the browser, once for SQL, because the worker cannot import the module — and the parity guard fails the build if they ever disagree. The rest of the sequence was already his: Sales and Marketing, then Designer (a marketing person whose position says design), then Live Host, with part-timers after their own role.

### The lists

Nine routes handed people to a screen or a picker in alphabetical order, which puts the CEO in the middle of the alphabet. All nine now end in `ORDER BY ${STAFF_ORDER_SQL}`: the leave entitlement table (his screenshot), `/staff-list` — which is every picker in the portal — the per-person targets grid, who is available today, the attendance monitor, the attendance CSV, who is on each working-hour pattern, the staff directory and its pre-0059 fallback, and the commission host picker in `erp.ts`. Each needed a `u.` alias to reach role, position and employment_status; all 820 queries still PREPARE clean against the real schema.

Two orderings are deliberately left alone: staff birthdays sort by month and day, which is what that list is *for*, and the pattern-delete warning is a `DISTINCT` of names with no other column to sort on. The guard allows exactly one such query and names it.

### Guards

Five checks added, including the CEO's full eight-role sequence run through the comparator, and one that no person-listing query is left on `ORDER BY name`. Negative-tested by moving admin back, by desyncing the SQL from the module, and by putting one route back on `ORDER BY 2`.

**Two of my own guards went red on this change and were wrong to** — both pinned the exact SQL text of a query rather than the property, so they failed the moment a query correctly gained an alias. Rewritten to assert what matters: that the row carries the three columns the comparator reads, and that the targets route is month-scoped. That is the rule at the top of `run-guards.mjs`, and this is the ninth time it has earned its place.

## [1.94.1] — 2026-09-04 — a circle needs a square

**CEO**, a desktop screenshot of the new Staff field: *"it is looks shorter."*

He is right, and the cause is arithmetic. The layout placed each face at a percentage of the field's width and a percentage of its height — two radii, one per axis. That is a circle only when the field is square, and the field was the full width of the canvas by 460px tall. On his 1600px monitor that made every ring a 3.5:1 ellipse: flat, stretched, and wide enough that the outer ring's faces landed on the labels of the ring inside it — Nur Nasuha's photo sitting on top of Mohamad Izzudin's name at the bottom of the shot.

**The field is a centred square now**, capped at 34rem, so one radius per ring does both axes and a ring is a ring at any window width. The rings redraw as true circles, each ring starts a little further round than the one inside it so no two put a face on the same spoke, and the whole thing reads as one glance instead of a horizon. Checked against the current floor: the tightest gap is 359px between faces on a 104px cell, so nothing can collide.

Two things that came with it. The outermost ring's labels need room outside the square — half a cell reaches past 49% — so the field sits in its own gutter. And desktop names wrap to two lines like the phone's do: *"Mohd Alif Far…"* on a wide monitor was the phone bug wearing a bigger screen.

## [1.94.0] — 2026-09-04 — the forward that ate the question, and the Staff circle on a phone

### Threads: we were sending the browser to the wrong host

**CEO**, three attempts, each landing on the same page: `{"error_message":"An unknown error has occurred.","error_code":1}`.

Look at **where** that page is: `threads.**com**/oauth/authorize/error.json`. We were sending the browser to `threads.**net**/oauth/authorize`. Threads moved to threads.com in April 2025 and .net forwards — so every attempt made a redirect hop before reaching Meta's page, and a redirect is where a query string goes to die. An authorise page that receives no `client_id` answers exactly this way: an error that names nothing, because from its side nothing was asked. That is why the message never named a parameter, however many dashboard fields were checked.

The authorise URL now points straight at `https://www.threads.com/oauth/authorize`. No hop, no lost parameters. If it still fails after this, it fails **on the real page with the real parameters**, and the error will finally say which one.

**Two more things that produce the identical error.** `wrangler secret put` stores exactly what was pasted, and a paste out of a browser often carries a trailing newline — `client_id=1234%0A` is not an app id, and Meta rejects a malformed one as anonymously as a missing one. Both credentials are trimmed at every read now.

And **Check setup**, a button on the Threads tab beside Connect: it prints the `client_id` and `redirect_uri` this worker actually sends, flags stray whitespace in either credential, says whether a Threads App ID looks like one (they are all digits — a value with letters is usually the Meta App ID or the secret), and confirms the secret is set. Nothing secret is shown: the app id travels in every authorise URL, and the secret is reported only as set-or-not.

**Guard #33 refused my own first draft of this**, and was right: the `?show=1` route read `THREADS_APP_SECRET` in `index.ts`, breaking its "exactly one file reads the secret" rule. The report moved into `threads.ts` where the secret lives. Five checks added — the host, the trims, the count of raw env reads, and the report never carrying the value it describes — the last one scoped to the report, because the token exchange twelve lines away legitimately sends the secret to Meta.

### Staff on a phone

**CEO**, a phone screenshot: names cut to *"Mohd Alif Far…"*, *"Mohamad Iz…"*, and the last row's roles sliced in half.

Three causes, all fixed. The faces sat in a wrap row of fixed 88px cells, so a three-word Malay given name never fit — they are a three-column **grid** now, each cell a third of the screen, with the name wrapping to two lines instead of truncating. The card's inner scroller (`max-h-[30rem] overflow-y-auto`) is what sliced the bottom row; it is a desktop convenience and a phone bug, so it is desktop-only and the page scrolls the way a phone expects. And the first thing on the screen was a disabled full-width *"Print selected badges (0) — up to 9 per A4"* — it appears now only when something is selected, and says *"Print badges (2)"*. Faces are a little larger to suit the wider cells; the desktop circle is untouched.

## [1.93.0] — 2026-09-04 — the circle, the cake, and the hosts who are paid by the hour

### Staff: the company as orbits

**CEO**, a frame from the LazyThreads video of its Circle screen: *"Staff tabs content should be like this."*

The row of faces from v1.92.0 is now a field. The most senior person sits at the centre, larger and gold; the next tier on the first ring, the floor on the second, hosts and part-time on the third, and leavers on the outermost ring, faded. Each ring's people are spread evenly round it, offset so no two rings line up, and every face drifts a little on its own clock — the video's field, without the video's forty grey ghosts. Faint rings are drawn behind. Positions are percentages of the field, so it fits any width; phones keep the wrapping row, because a 360px-wide orbit is a pile. Pressing a face still opens the record below, one at a time; Select for printing still ticks. Everything stands still under reduced-motion.

### The birthday lives on the person

**CEO:** *"the birthday should be embedded into the staff card!"* The separate Birthdays card listed everyone with a date box each; the date is already a field on the record. What the card was *for* — knowing whose day is coming — is now a 🎂 on the face when it is within a fortnight (with the age they turn on hover), a chip on the open record (*🎂 12-09 · turns 29 in 8 days*), and one line under the circle naming the next three, each a door to the record. The card is gone from the Staff tab; `birthdayInfo()` is one function so the three read the same date the same way.

### Part-time hosts have no leave

**CEO:** *"part time live host should not entitle any leave or medical leave since they are part time staff."*

One predicate — `isHourlyUser` (live host + part-time), the one payroll already uses to pay by the clock — is now asked at every leave door: applying for leave is refused with the reason; the personal balance reads zero for every type and says why, so the Leave tab shows one line instead of five empty tiles and no form; the entitlement table lists them (they are staff) but shows one quiet cell across the row instead of boxes; setting or adjusting an hourly entitlement is refused by the worker; and *Apply to all* means everyone with an entitlement. Nine checks in `tests/unpaid-leave.mjs`, negative-tested by removing the refusal from the apply route.

## [1.92.0] — 2026-09-04 — four screens, each asked for by name

### Targets: this month's people, and a Save button

**CEO:** *"Per-person targets (RM) should not listed the staff that in active! and it should have a save button."*

The grid listed everyone whose account was active, so a person who resigned on the 31st was still offered a September target. A target is for a month, so the worker now lists the people employed in **that** month — the same `payrollMonthStaffSql` predicate payroll uses, so the two screens name the same people — in company order.

Every box used to save itself on blur, which is a form nobody can review before it commits. Each box is a draft now; the ones that differ from what is stored are ringed amber, and one **Save targets (n)** button writes exactly those, then reports — *3 target(s) set for September 2026*, or *Partly saved* naming the ones the server refused. A blank box is not a change: nothing here removes a target.

### Assignments today: the given name, whole

**CEO:** *"I should be able to see their first and middle name so that I can know."* The card printed the first word — "NUR" three times for one host. `givenNames()` in `lib/names.ts` takes every word before *bin / binti / a/l / a/p*, or the first two words when there is no connector: Nur Nasuha, Mohd Alif Farhan, Nurul Fasehah. The phone rows and the desktop table both use it.

### Staff: a row of faces

**CEO:** *"for Staff tabs content I want the table change to circle avatar which is minimalist the interface so that I can clickable to the staff bubbles circle like an animation."*

A closed record is a circle now — the photo when one is on file, initials on the brand colour when not, the given name under it, the role under that — in a wrapping row, popping in one after another (and standing still under reduced-motion). Press a face and the record opens below the row, one at a time; press it again and it closes. A leaver keeps a red ring and their last day, because the Staff tab is the one place they are still listed (v1.87.0). Printing badges for several people needs a selection, so **Select for printing** turns the row into a picker — a face ticks instead of opening, and each face says which mode it is in (`aria-pressed`). Sort by rank or name is unchanged; the skeleton is the same circles.

### Leave: the CEO's own half first

**CEO:** *"Leave entitlement and Leave — whole company should be in the minimalist interface and below of the table mine eligible leave and Apply for leave."*

The entitlement editor sat **above** the CEO's own balances and form — a table for the whole company before the four boxes he came to use. Both management areas now sit below the personal half, behind one chooser — *Leave — whole company* with a badge of how many are in progress, and *Leave entitlement* — one open at a time, the board first because it is the one with things waiting. Nothing inside either changed.

### Guards

staff-order +3 (the targets card sorts by the comparator; the route is month-scoped; the month is validated before the splice), action-feedback +3 (the targets save reports, a partial save names the failures, no box saves on blur any more), clickable-data +3 (a face opens its record, a closed record draws only its face, a face says its mode). Negative-tested by dropping the month predicate, restoring a blur save, and making a face tick instead of open.

## [1.91.0] — 2026-09-04 — three doors the CEO asked for

### Attendance corrections open to the HR tier

**CEO:** *"Staff attendance — corrections & back-entry I want hr admin has access on it which is ceo, coo, cco and hr admin has this authorized to access."*

The card had been CEO + admin tier since v1.4.28, as three role names typed into the worker. It is a permission now — `attendance_correct`: CEO, COO, CCO, HR admin and the admin tier — read by every corrections route (manual entry, the pending list, amend, delete, the unpaid list) and mirrored by the page. Whoever may correct a register may now read one: the `/attendance` register used to let only `hr_manage` name another person, so a COO handed the card would have been shown their own punches.

What did **not** open with it, on purpose: recording an unpaid day and approving a forgotten punch both create or remove pay and stay with the CEO (`unpaid_leave`); working-hour patterns follow `hr_manage` as the worker already enforced. `tests/unpaid-leave.mjs` gains eight checks — the tier asserted as an exact set, the routes reading the permission rather than role names, the register read, the two CEO powers surviving, the page and the card's unpaid area — negative-tested by adding `marketing` to the set and by putting the decide route behind the wider gate.

### Leave — whole company: the name opens the application

**CEO:** *"Leave — whole company I want to have a clickable to see the details of the leave application!"*

The company board printed one line per leave and nothing could be opened, though the reason, the reviewer's note and who reviewed it and when were all in the row the worker returns. The applicant's name is a door now, on the in-progress rows and the decided ones alike, and it opens one detail: applicant with position and department, leave number, type, period, days, when it was applied, status, reason, the three-stage approval trail (HR reviewed · pre-approved · final, each with who and when), the reviewer's note, and Print form. Guard #31 gains three cases for it.

### Schedule & Roster: company order, and a task you can update where it waits

**CEO:** *"for this table, need to ascending by position which is starting by CEO, COO, CCO, hr_admin, sales marketing, designer and live host. for Unscheduled work I can clickable on it and update the task accordingly and check if there is any duplication module or function of it."*

The staff grid, every picker on the board and the Available-today rail read the worker's staff list, which arrives alphabetical. It is sorted once, where it arrives, by the one company comparator every payroll surface already uses (`lib/staff-order.ts`) — the worker's `/staff-list` now carries `position` and `employment_status` so a designer and a part-timer sort as themselves and not as their role alone. The staff-order guard gains five checks, including the CEO's sequence run through the comparator.

An unscheduled card has two doors: the card still arms placement (tap, then a day), and a pencil opens the task where it stands — title, assignee, priority, deadline, Save or Mark done — on the same `PATCH /tasks/:id` the Tasks tab uses. Every save reports either way (guard #25, two new cases).

**On duplication, checked:** there is no second module. Unscheduled work is a *view* — open tasks with no block this week, computed once in the worker's `/roster` — over the same `tasks` table the Tasks tab lists and the company monitor counts; there is one create route (`POST /tasks`, reached from the Tasks tab and the roster's "Assign a task") and one update route (`PATCH /tasks/:id`, reached from the Tasks tab's editor and now this pencil). Two ways to reach one function is the intent; two functions would have been the bug.

## [1.90.2] — 2026-09-04 — a leave request that said nothing

**CEO:** *"One of my staff unable to update their leave application, please check any bug?"* — with her screenshot: leave type annual, start date 10-09-2026, **end date empty**, days 1, reason typed, Submit pressed. Nothing happened.

That is the bug, and it is in the button. `apply()` began with `if (!start || !end || days <= 0) return;` — a bare return, no message. A one-day leave is the commonest kind and needed a second date typed that nothing said was required, and a person who did not type it got no answer at all. It also swallowed the server's reply: an insert the worker refused looked identical to one it accepted.

Three changes. A blank end date now means the same day, and the end date follows the start date as it is typed until somebody moves it later. A request that cannot be sent says why — no start date, end before start, days under 0.5 — instead of doing nothing. And the server's answer is reported either way: *Leave requested · annual · 1 day · 10-09-2026 · waiting for HR*, or *Not sent* with the worker's own message. Guard #25 already said every mutation reports; this one had slipped in before it.

`tests/action-feedback.mjs` gains three named cases for the apply button — success, a refused request, and the no-date case — negative-tested by putting the bare return back.

Editing a leave after it is submitted is unchanged and deliberate (v1.83.0): amending a decided leave is the CEO's, because it can move a day between payroll months or turn a paid day unpaid. A staff member who needs a change asks HR, who can reject it, and applies again.

## [1.90.1] — 2026-09-04 — PUSH.bat puts the secrets where the engine reads them

**CEO:** *"I want PUSH to update for this: cd …\worker · npx wrangler secret list · npx wrangler secret put THREADS_APP_ID · npx wrangler secret put THREADS_APP_SECRET"*

The Threads tab kept reporting the two app secrets unset after they had been entered. The portal folder has two `wrangler.toml` files — the root one is the **website** worker, `worker\` is the **engine** — and `wrangler secret put` run from the root stores the secret on the website, which never reads it.

`PUSH.bat` now has a step for this, and it runs **inside `worker\`** so the target cannot be wrong: it asks Cloudflare which secrets `azoneofficial-api` holds (`wrangler secret list`), and prompts — on screen, hidden while pasting — only for `THREADS_APP_ID` or `THREADS_APP_SECRET` if missing. Enter alone skips. No value is ever written to the file or to disk; wrangler sends it straight to Cloudflare. Once both are set the step prints two lines and moves on.

Two more things the same file now does, both offered earlier in the week: each engine is **compiled before it is published** (`tests\worker-compile-gate.mjs`, the 19-08 outage class — wrangler bundles without checking types), and an upload that loses its connection mid-way (`fetch failed`, the store engine on 04-09) is **retried three times, fifteen seconds apart**, before the run is declared failed.

## [1.90.0] — 2026-09-04 — who sees what

**CEO**, a screenshot of a staff phone with Dashboard, Attendance, Ecommerce and Inventory on its bottom bar: *"for some of the access I want to also review what they can see and what they cant see which is for me to authorize them to access it in users tabs."*

The 🔐 card governs tabs by **role**. It answers "who sees Payroll" and cannot answer "what does Aina see" — you would have to read all twenty-six rows and know her role. And it cannot give one marketing person the Sales tab without giving it to every marketing person.

### One person, above the role

A person may now carry tabs **granted** to them and tabs **refused**, kept in `system_meta` under `tab_access_people`, keyed by user id. Deny beats allow; both beat the role. The two rails of the role rule are unchanged: Dashboard and Profile cannot be refused (clocking in and reading a payslip are not permissions), and `super_admin` is not governed (the escape hatch must survive a refusal aimed at it). `canSeeTab` in `lib/portal-tabs.ts` takes the person's entry as a fourth argument, and a new `accessOf` says, for every tab, whether the person sees it and *why* — always, role, granted, refused, or hidden by the role.

The portal's tab strip — and therefore the phone bottom bar, which is the first four tabs the strip shows — reads the person's entry from `GET /tabs/access` (`mine`), which returns only the caller's own entry; the whole map is a CEO read on `/tabs/access/people`.

### The card

**Who sees what**, on the Users tab under the 🔐 card, CEO only. Pick a person; two rows of chips, *Can see* and *Cannot see*, and a line naming their phone bar. Press a chip to move it to the other row — for that person only; the toast says so by name. A chip that sits where it does because of a personal grant or refusal is marked + or −, and pressing it again returns the tab to the role's rule. Dashboard and Profile are shown and cannot be pressed. **Back to role defaults** clears the person's entry. One line under the chips says what the card does not do: a granted tab is drawn, and the data inside it still needs the role's server permission (AUDIT M13) — the card says this rather than pretending otherwise.

`POST /tabs/access/person` (`user_id`, `tab`, `mode` = allow / deny / clear / reset) is CEO-only, validates the tab against the governable list and the mode against the four, refuses a customer or a super_admin as target, removes an emptied entry rather than storing two empty lists, and audits every change as `tabs.person_access` with the person, the tab and the resulting lists.

### Guard #34, `tests/person-access.mjs` — 29 checks, every one negative-tested

This guard **runs** the rule rather than reading it: it imports `lib/portal-tabs.ts` and calls `canSeeTab` / `accessOf` with real inputs — a grant shows a hidden tab, a refusal hides a shown one, deny beats allow, a grant beats a role override, the always-visible tabs cannot be refused, super_admin is not governed, a redundant grant reads as the role (a + on a tab the role already shows would teach that + means nothing), and `accessOf` agrees with `canSeeTab` on every tab. The worker half checks the gate, the validation, the two target refusals, the audit, the emptied-entry removal, and that a staff member receives only their own entry. The portal half checks the strip passes the entry through and the card asks `accessOf` rather than carrying its own copy of the rule.

## [1.89.1] — 2026-09-04 — show me what you sent

**CEO**, pressing Connect on the new Threads tab and landing on Meta's page: `{"error_message":"An unknown error has occurred.","error_code":1}`.

That page is Threads refusing the authorisation request before any login screen — a wrong app id, an unregistered redirect URI, a scope the use case has not added, or an account that is not yet a tester — and it says none of that. By the time it appears the address bar has moved on, so there is nothing to compare with the dashboard.

`GET /api/v1/integrations/threads/connect?show=1` (management session) now prints the exact `client_id` and `redirect_uri` the worker sends instead of following them, with a one-line note on where each is checked. Nothing in it is secret: the app id is public and the secret is never in any URL. Guard #33 still holds — the block still derives its URI and still gates on `threads_manage`.

## [1.89.0] — 2026-09-04 — the Threads workspace, phase 1: connect and import

**CEO**, after a walkthrough video of LazyThreads, a content tool for one social network: *"for Threads I want new tabs all in 1 tabs for the Threads with minimalist interface"*.

Every screen in that video is built on the same two ingredients: the account's own post history and metrics pulled from the Threads API, and rules on top that turn the numbers into advice. This release is the first ingredient, because once the history and the numbers are in our own database every later phase is reading our own rows.

### One tab, three sections

A new **Threads** tab, after Content. It opens on a section chooser — the pattern the attendance card uses — with Overview, Library and Connection, and nothing else. Not the video's eleven analytics sub-tabs; most of those are a model's opinion dressed as a screen, and the ask was minimalist.

**Overview** is the 30-day brief: followers, views, views per post and posts published, each against the 30 days before; the five posts that did best, each with its *× baseline*; and views by publishing hour in Malaysia time, which is where "publish around 1–3 PM" comes from without anyone guessing. Every tile with rows behind it opens them — Views opens the library sorted by views, Posts opens the last 30 days newest first — and the one tile without rows (followers is a number, not a list) stays a plain tile, per guard #31.

**Library** is every post the account has ever published, imported from Threads. A chip row (all · last 30 days · ≥ 2× baseline · with media · text only), a month select, newest-or-most-viewed, a text search, and a CSV that holds exactly the rows on screen, because the worker filters and the export never re-filters. A row opens to the whole text and a link to the post on Threads.

**Connection** is the account: who connected it and when, how many posts are in, how far an import has got, when the token runs out (amber inside ten days), and the three buttons that need a manager — Connect, Sync now, Disconnect.

### "× baseline" is arithmetic, not opinion

The video shows "17.7× above baseline" on a post and never says what baseline is. Here it is the median views of the thirty posts published before that one on the same account, computed by the worker over the whole history in order — so a post from March is judged against the account of March, not against the bigger audience of September. A post with fewer than five posts before it has no baseline and says so.

### The token never leaves the worker

Connecting is two browser redirects: a manager is sent to Meta with a state cookie, Meta sends them back with a code, and `worker/src/threads.ts` turns the code into a 60-day token that is written to `integration_tokens` — the shelf the TikTok Shop token already sits on — and read by nothing but the functions that call Threads. The routes select the account list column by column; none of them can name the token column. The redirect URI is derived from the request origin the same way the Google sign-in derives its own, so no domain enters a committed file and connect and callback always agree.

The two secrets, `THREADS_APP_ID` and `THREADS_APP_SECRET`, go in with `wrangler secret put` and are listed in `wrangler.toml` with the others. Until they are set the tab says so and connects nothing. Each account you own is added as a Threads Tester on the Meta app — no App Review, no business verification, for accounts you own.

### Work is a tick with a budget

A first import of a large account is thousands of posts and one insights call per post, and a Worker invocation has a ceiling on subrequests. So a sync is a *tick*: it refreshes any token inside its last 35 days, fetches up to two pages of history, files today's follower count, and snapshots the posts with no snapshot for today — the last 30 days daily, older posts weekly, newest first — and stops when the budget is spent, recording where it got to. The 30-minute cron runs one tick for every account; the Sync button runs a bigger one for one account. "Nightly metrics" is therefore not a separate job that can fall over on its own; it is whatever the ticks get round to, and they get round to all of it. The budget defaults to 24 for the free Workers plan and is one plain var (`THREADS_TICK_BUDGET`) on a paid one.

Snapshots are append-only, keyed by the day of capture, so views at day 1, day 7 and day 30 remain answerable later. The post row carries a denormalised copy of the newest one so the library sorts without a join.

### What is deliberately not here yet

Composing, scheduling and publishing (phase 2, v1.90.0); the rule-based "why this worked" and "today we recommend" cards (phase 3, v1.91.0); AI-assisted drafting on Workers AI (phase 4, the CEO's choice); and images, which need a public URL and are text-only until then. The Circle map — a per-person record of everyone who replied — is out of scope by decision, for the same reason OD-20a keeps shopper tracking anonymous.

### Migration 0105 — four tables, triple bump

`threads_accounts`, `threads_posts` (with trait columns computed at import so phase 3 is SQL over these columns and not a model with an opinion), `threads_post_metrics`, `threads_account_metrics`. `LATEST_MIGRATION`, `EXPECTED_MIGRATIONS` and a health probe on `threads_posts`. Migration-safety, sql-schema-check (822 queries verified, threads.ts now in its list) and registry-parity all green.

### Guards

**Guard #33, `tests/threads-guard.mjs`** — 45 checks, every one negative-tested: no route names the token column and the only route statement on `integration_tokens` is the disconnect DELETE; the secret is read in one file; sync, disconnect and relabel are audited and gated on `threads_manage`, which is a subset of `threads_view`; the OAuth pair derives the same URI and names no domain; each tick helper pays for every Graph call it makes and both loops stop at the budget; snapshots are never deleted and disconnecting keeps the posts; the door in `staff.ts` is there and hands over the query string; the CSV reads the same rows as the table; the followers tile makes no promise; every mutation reports; no loading state is spelled out.

**`tests/api-routes.mjs`** learned the second door: `/threads/` in `staff.ts` is excluded like the `/staff/` door and the routes are read from `threads.ts` with their own base, so a path the module never answers still fails. Negative-tested with a misspelt `/sumary`.

Permissions `threads_view` and `threads_manage` in `worker/src/permissions.ts`; the tab in `lib/portal-tabs.ts`, the worker access list, the icon map (AtSign — a handle is what an account is) and the i18n dictionary, and registry-parity confirms all four agree.

## [1.88.2] — 2026-09-03 — one shell, one width

**CEO:** *"on /admin the UI/UX should same width as /portal. same goes to other. everything must follow like /portal UI/UX"*

`/portal` has filled the window since v1.74.0 — the CEO's own request then: *"I want it full fit to the website width"*. The other app views never followed. `/admin` was capped at 1152px, `/account` at 896px, and `/admin/permissions` had **no shell at all** — a bare centred column on the page background, no navy rail, no canvas, so reaching it from the console looked like leaving the product. On one monitor the consoles were three different widths and read as three products.

All four app views now render the same `AppShell` at the same width, with the same content-column padding. The caps came off both the canvas and the inner column — lifting one and leaving the other would only have moved the gutters inside the canvas. `/admin/permissions` gains the rail and a way back to the console; the matrix itself is untouched.

The public pages are deliberately **not** in this set: `/doc` and `/report` are documents a customer opens from a WhatsApp link, and `/login` is the sign-in page. Putting a staff shell around any of them would be the wrong kind of consistency.

Twelve checks added to guard #32: every app view renders the shell, none caps the canvas, none caps its column. Negative-tested by putting the `/admin` cap back.

## [1.88.1] — 2026-09-03 — the page underneath the app

**CEO**, a screenshot of the Leave tab: the app canvas ending two-thirds down the window, a white void beneath it, and a **second scrollbar on the page itself**. *"Still got bug and defects!"*

The v1.21.1 model is that the shell is fixed to the viewport on desktop and the content column is the only thing that scrolls. That model had two holes.

**The canvas was `overflow-hidden` but not `relative`.** An absolutely positioned descendant with no positioned ancestor is laid out against the *document*, not the canvas — so it grows the document's scrollable area straight through a clip that never sees it. That is the mechanism the screenshot points at: the canvas clipped correctly, and the page grew anyway. `relative` makes the canvas that element's containing block, and then the clip does its job.

**Nothing actually forbade the document from scrolling.** The model relied on nothing ever escaping, which is a hope rather than a rule. While the shell is mounted at desktop widths, `html` and `body` are now locked; the rule ships inside the shell component rather than in a stylesheet elsewhere, behind a media query so the phone layout — which scrolls the document by design — is untouched.

Both on purpose: the first is the mechanism this screenshot implicates, the second makes the symptom impossible whatever the next mechanism turns out to be.

### A fix for a bug I could not reproduce carries its own evidence

I could not see his browser. So the portal's overflow self-report — built at v1.23.8 for phones, for *width* — now also runs on desktop, for *height*: if the document is still taller than the viewport after the page settles, the elements whose bottom edge pokes past it are named and written to the error_log, once per tab per session per build. Content below the fold *inside* the shell's scroller is ignored, because that is normal; content below the *canvas* is the bug. The worker records which axis a report is about, so the two kinds of overflow are not read as one.

If this ever recurs, the next report arrives with the culprit's tag, classes and position attached.

New guard #32, eight checks, negative-tested.

## [1.88.0] — 2026-09-03 — a number you can open

**CEO:** *"Audit all the tabs and ensure that all the tabs have a function of clickable data without me need to open another new tabs. Additionally, make it minimalist interface for the clumsy interface for better UI/UX without change any major designed!"*

He had asked the narrow version of this at v1.21.5, about the stock chips: *"data will appear when click without go to the tabs/table"*. That was built — and then every card added since printed its figures as text again.

An audit of all 24 tabs found **forty dead ends** in thirteen files: a number the interface asks you to act on and gives you no way to open. *3 overdue. 12 unpaid invoices. 7 not acknowledged.* You read it, then you go and find the rows yourself on another tab.

### Two structural causes, not forty separate mistakes

- **`StatTile` had no `onClick` at all** — so all twenty-two of its call sites were dead by construction. Its sibling `StatCard` has accepted one since v1.13.0; the two halves of the same idea disagreed about whether a number is a door. It takes one now, and a tile *without* an action still renders as a plain div: a tile that looks pressable and does nothing is worse than one that never offered.
- **Rows of count chips where some are buttons and the rest are spans**, in the same `.map()`. A chip that opens beside one that does not is worse than neither opening — it teaches you the row is inert.

### What now opens where it stands

- **Company task progress** — Open / Pending / Closed / Overdue / Not acknowledged each list their tasks underneath. The card's own v1.42.0 comment calls two of them *"the numbers that demand a manager's action"*, and neither could be opened. The list is filtered by the **same tests the server counted with**, because a tile of 3 that opens 4 rows is worse than one that opens nothing.
- **Stock status** — the quiet chips now expand like the low/out-of-stock ones have since v1.21.5.
- **Asset counts** → filter the asset table. Keyed on the status **code**, not the translated label, or the filter would break the moment you switch to BM.
- **ELFIA state chips** → scope the consented-customer list. Every state on the map above has been a button since v1.43.0; the matching chip row was spans.
- **Open POs** → narrows the table. **Suppliers** → does what the Suppliers button beside it already did; it was that button's inert twin.
- **The claims summary strip** — Approved / paid / Pending / Rejected each scope the claim list below.
- **The right rail's red badges** → open the Leave and Tasks tabs. The badge is the rail's whole point — how many things are waiting on you — and it was a span.

### Guarded

New **guard #31**, deliberately narrow: *should this number be clickable* is a judgement, and a linter that guesses would cry wolf until it was ignored. It checks the two things that are not judgement — that the figure components can carry an action at all, and that each fixed dead end has not silently reverted, every one named with what it opens.

Guard #28 caught a *"Loading…"* I had written into the new task list — a sentence about waiting where a skeleton in the shape of the count belongs. Corrected.

Twenty-nine of the forty findings remain, mostly single figures on Dashboard tiles that need a destination decided rather than a mechanism. The mechanism is there now; say the word and I will work through the rest.

## [1.87.0] — 2026-09-03 — a leaver leaves the lists

**CEO:** *"If staff already resigned after that day, the day after it no more listed the staff on task, payroll after their payroll released and etc except staff tabs which is for recording purposes."*

Offboarding sets `left_on`, kills every session and clears 2FA — but **deliberately leaves `is_active = 1`**, with a comment saying why: flipping it would drop the leaver from their own final payroll run and they would not be paid for their last month.

That decision was right and its cost was never paid down. A leaver stayed in every staff list **forever** — still an option in the task assignee dropdown, still in the attendance picker, still counted in "staff total", still sent notifications, still offered a shift, months after they left.

`is_active` says *the account exists*. There was nothing that said *they work here today*, which is what a people-picker means. Now there is, in both the worker and the browser:

- **The last day is a working day.** `left_on` is the last paid day — the offboard dialog says so — so somebody leaving on the 30th is on staff on the 30th and gone on the 1st.
- **A re-joiner is back.** `rejoined_on` has meant that since v1.4.101 and the payroll honours it; a list that did not would hide somebody sitting in the office.

Applied to thirteen places: the staff pickers, the birthday lists, the headcount, the notification fan-outs — and to the **assignment checks**, because hiding somebody from a dropdown is not the same as refusing the assignment.

### The exception he named himself

*"payroll after their payroll released"* — a leaver must stay on the payroll of every month they **actually worked**, which is what pays their final salary, and drop off once the run moves past it. That is a different question from "do they work here today", so it has its own predicate keyed to the month being processed.

Deliberately **not** keyed on whether the payslip was released: a released month still gets recomputed, reprinted and queried, and a person vanishing from a month they were paid for is a payslip nobody can reproduce.

The month is spliced into that SQL rather than bound, because each caller has its own `?1..?n` numbering and threading one more parameter through a dozen queries by hand is how a bind lands on the wrong placeholder. That is only safe because the helper validates the month itself and **throws** on anything else. Which turned up a small bug of its own: on `/payroll/day-fill` the month reached three queries straight from the query string, unchecked, and it decides which month's salary is computed.

### And the exception that is the point

**The Staff tab keeps everyone.** A record you cannot look up is not a record. `/users` feeds both the directory and the pickers, so it still returns leavers and the *picker* filters — the record stays whole and the dropdown stays current.

Eleven checks added to guard #29, negative-tested. One existing check had pinned the absence scan's `WHERE` clause verbatim and went red when the leaver rule joined it — the eighth this week, and corrected the same way.

## [1.86.0] — 2026-09-03 — one place a leave record lives

**CEO:** *"leave to review should inside the leave and also why looks like Leave applications — whole company like having same function as leave to review? make it minimalist please!"*

Because by this release they nearly did, and the duplication was mine.

**Leave to review** shipped at v1.78.0 with two halves, because at the time both were homeless: rest-day work waiting to be credited, and the month's unpaid days as a row of chips. Then **v1.83.0 gave the Leave tab a real register** — the whole decided history, filtered by month, with Edit and Remove on every row. An unpaid day *is* a decided leave record, so from that release the chips were a second view of rows the register already listed, with a second way to delete one. Two lists of the same records is how two screens start disagreeing about what was deducted.

So the chips are gone. The register is the one place a leave record lives, and an unpaid row is marked red in it — the chips were the only thing making an unpaid day stand out, and that job had to go somewhere.

What is left is the half that is **not** a leave record: work that happened and has not become one yet. It moves to the Leave tab as **Rest days worked — credit replacement leave**, sitting above the register, because crediting is what turns work into a leave record and the register is where that record then appears. On the Staff tab it had been sitting beside a directory that has nothing to do with leave.

**Leave applications — whole company** is now just **Leave — whole company**, and says what it holds: everything in progress and whose approval it waits on, then every decided record including the unpaid days recorded from Attendance.

Net effect: one card fewer, one list fewer, one delete path fewer, and the Staff tab is a staff directory again.

Three checks in guard #29 updated and negative-tested — that the card is on the Leave tab above the register, that the chips have not come back, and that the register still makes an unpaid record visible.

## [1.85.0] — 2026-09-03 — the payslips that never got the memo

**CEO**, on his August payslip: *"payslip capture AZ ONE OFFICIAL instead of A2Z Creative Marketing"*

He is right, and the code was not wrong. v1.28.0 built the whole mechanism: a payslip carries the employer of record stamped on its month row in `payslip_releases`, and the renderer resolves it. `NULL` means a month released before the switch and renders as **AZ ONE OFFICIAL** forever — and that rule is deliberate, because a payslip may not be retroactively rebranded onto an entity that did not employ the person that month.

**What went wrong is narrower than that.** The release route stamps the code inside a `try`, with a fallback `INSERT` for a database that had not applied migration 0073 yet. **The fallback writes no `issuer_code` at all.** So a month released in that window records `NULL` — not because it was an AZ ONE month, but because the column was not there to write to — and reads as AZ ONE forever, with nothing on any screen to say so.

### The correction, and its limit

A2Z CREATIVE MARKETING has employed since 19-08-2026 — the CEO's own decision, recorded in `lib/issuers.ts` as *"A2Z invoices, A2Z employs"*. Migration `0104` sets the stamp on months from **2026-08 onward that are still NULL**. Months before that are left exactly as they are: they were AZ ONE months, they say AZ ONE, and that is not a bug. Only `NULL` rows are touched — a month somebody deliberately stamped `azoo` keeps its stamp. This repairs an absence; it does not overrule a decision.

### And the hole it came through

The fallback still cannot fail the release — a payslip nobody can see is worse than one with the wrong letterhead — but it no longer passes in silence. It writes a `payroll.release_unstamped` audit entry naming the cause and the consequence, and the response reports the employer **the row actually carries**, not the one the insert attempted: the month may already have been released, in which case `ON CONFLICT DO NOTHING` changed nothing.

Most of all, **the Payroll panel now names the employer of record before the payslips go out**, and flags a released month carrying no stamp with what to do about it. That fact was previously discoverable only by opening a rendered PDF, which is exactly how a month of slips went out under the wrong entity without anybody noticing.

Eight checks added to guard #12, negative-tested — including that the worker's copy of the two entity names still matches `lib/issuers.ts`, which the worker cannot import.

**One to confirm:** August 2026 is treated as an A2Z month, since the switch was 19-08-2026 and the period runs 01-08 to 31-08. If July or earlier should also read A2Z, say so — it is one line in `0104`, but it is a legal statement about who employed whom, so it is not one to guess at.

## [1.84.1] — 2026-09-03 — the pills are the filter

**CEO:** *"pill above there should clickable to get the data"*

The three figures at the top answered *"is anything wrong this month"* — and then the only way to act on the answer was to read every row looking for it. Each pill is now the filter for the thing it counts, and the table, the expanded dates and the CSV all follow it. A summary that cannot be opened is a summary you have to verify by hand.

Filtering to a thing opens its dates, rather than making him click every row he just asked for. A pill with nothing behind it stays plain text: *"Every row balances"* is the good news and there is nothing to open.

### The figure his screenshot was actually asking about

Zolkefli's row read **19 worked** beside **46h34 / 131h**, with no flag explaining it. A day clocked in and never clocked out counts as a day worked and contributes **no hours at all** — so the Hours column reads low and nothing on the row says why.

There is now a fourth pill and a per-row flag for it, with the dates behind them. It is not an absence and it is not a short day; it is a missing punch, and it is fixed on the Attendance card.

### The guard missed one of its own class

The first draft of the pill row declared `Pill` inside the card's render — a new component type every render, rebuilding all four pills each time. That is precisely what guard #30 was written for last week, and it went straight past: the guard recognised a body that **starts** with JSX or with `return (<`, and this one starts with a condition (`on ? (<button…>) : (<span…>)`).

The guard now recognises the third shape too — an expression body whose JSX arrives after a ternary or a short-circuit — bounded to the same 200 characters so a `<` further down still cannot be mistaken for it. Negative-tested against exactly the shape that escaped.

## [1.84.0] — 2026-09-03 — the month, reconciled

**CEO:** *"attendance verification should move to Attendance and make it minimalist interface, then it is should include for the staff which is on leave, or medical leave. full report is require and a must!"*

The card lived on the HR tab and printed **every punch in the month** — one row per ketukan, hundreds of them, each with a Shift check badge beside it. Nothing added up, and nothing could: it was a log, not a report.

The part that mattered most: somebody on medical leave for a week simply had **no rows**, which on that screen is indistinguishable from somebody who never came in. Telling those two apart is the entire job of a verification report.

### What makes it a report

Every scheduled working day now lands in exactly one bucket, and the buckets sum:

> **worked + leave + absent = scheduled**

A row where that fails carries a question, and the row says so and explains the usual causes — a reconciliation nobody can see is a reconciliation nobody does. Rest days and public holidays are counted separately and are **not** scheduled days: nobody is absent from a day they were never due to work, and which days those are comes from that person's own split-shift pattern rather than an assumption about Saturdays.

Three more rails: a joiner is not absent from the fortnight before they started; **tomorrow is not an absence**, so a month opened on the 3rd does not report everybody absent for the rest of it; and leave is broken down by type, so medical, annual and unpaid are each visible rather than merged into "away".

**Minimalist** means one row per person, not per punch — nine rows instead of six hundred — with the day-level dates one click away on the row they belong to. The CSV carries every figure plus the absent and leave dates behind them, because a figure somebody has to come back and ask about is half a report.

### Three bugs the toolchain caught before you did

- **A temporal dead zone.** `employedDays` was a `const` a few thousand lines inside `handleStaff`, and the new report sits above that line — a `ReferenceError` at runtime on the route. esbuild passed it without a murmur; `tsc` failed it (TS2448), which is exactly why the compile gate was changed to treat that code as fatal rather than a strict-mode warning. Hoisted to module scope, like `WORK_DAY_MINUTES` before it.
- **A 404.** The card called `/attendance/verification` where the staff routes live under `/staff/…`. Guard #26 named the file, the line and the address it would have hit.
- **A wrong column.** The holiday query asked for `date`; the table's column is `holiday_date`. It sat inside a `try/catch`, so it would have failed silently into a month with no public holidays — every one of them counted as a scheduled working day, and anybody who took the day off marked absent.

Two guards were exact-count checks (`employedDays` at six call sites, `STAFF_ORDER_SQL` at three) and went red because a **sixth and a fourth surface correctly adopted them**. More surfaces sharing one rule is the goal, not a regression, so both now assert a floor. The property in each is carried by the other half of the check.

Ten checks added to guard #24, negative-tested.

## [1.83.0] — 2026-09-03 — a leave you can correct or take back

**CEO:** *"leave application and history I want to view and to edit if necessary or to remove if require. filter by month"*

A leave could be applied for, decided, and after that only **read**. A wrong date, a leave taken as annual that should have been medical, a request approved twice — none of it could be corrected, and the only way out was a second record contradicting the first.

**Recently decided** was five lines of plain text with nothing to click. It is now the whole history, filtered by month, with Edit and Remove on each row. A month filter is the only one that matters here: a leave question is nearly always *"what happened in August"*, and it is the same month the payslip is being checked against. Matched by **overlap**, so a leave running from the 29th into the next month appears under both — it was taken in both.

Both actions are the **CEO alone**, for the same reason recording an unpaid day is. An amendment is not a smaller act than an approval: it can move a day between payroll months, turn a paid day unpaid, or delete a deduction somebody has already been charged for.

Three rails on an amendment: the days figure has to **fit the dates** (0.5 days across a week, or 5 days on one date, is a figure payroll would multiply anyway); a date more than a year out is refused as a typo in the year, the same rail recording one already had; and a multi-day range cannot carry a fraction.

**Every change records what it replaced** — not a flag saying "edited", the whole previous row, in the audit log. A register where a figure can change and the old one is gone is a register nobody can reconcile a payslip against. Removal records the deleted row for the same reason: afterwards there is nothing left to compare against.

And the person is told, either way. A deduction somebody first hears about on pay day is how trust in a payroll system ends, and that is as true of a change to one as of the original. Both the toast and the amendment form say to press **Recompute nets** if that month's payroll is already saved.

Eleven checks added to guard #14, negative-tested.

## [1.82.0] — 2026-09-03 — leave in the register

**CEO:** *"find and filter should include UPL and also Leave on that month which is for me easier to pull the data"*

A month of attendance without the leave beside it is a month with holes in it. Answering *"why was nobody in on the 12th"* meant opening the Leave tab and reading two screens against each other, and pulling the data meant two exports and a join in Excel.

The register carries the month's approved leave now — in the same table, under the same filters, in the same CSV. **Record type** gains *Leave (all types)* and *Unpaid leave (UPL) only*.

Four decisions worth stating, because each is a way the two could have disagreed:

- **Overlap, not start date.** Payroll attributes a leave to the month it *starts* in, deliberately, and `payslipExtras` depends on that. This is a different question: a leave from 29 August to 2 September means the person was away on the 1st and 2nd, and a September register that omitted those days would be lying about September.
- **One row per person-day**, not one per request — the same shape as a punch, so leave can be counted, filtered and totalled beside the attendance instead of needing its date range unpacked by hand. A single-day request keeps its exact `days`, so a half day shows as a half day; a range spreads whole days and cannot claim a fraction.
- **A rest day inside a leave range is not a day of leave.** It is a weekend. Counting it would inflate every leave that spans one.
- **Approved only.** A pending application is a request, not an absence — the same rule the pending punch already follows.

Leave rows are **read-only** here: a leave is decided on the Leave tab with its own approval chain, and a Save button in the register would be a second, quieter way to change one. The Direction filter excludes leave when set, because a leave day is neither a clock-in nor a clock-out.

### The guard suite has a rule now

Correcting the CSV button's row count to include the leave failed a check about the count being honest — **the seventh guard this week to go red on a change that was right**.

All seven had one shape: the check named an *implementation* where it meant a *behaviour*. `scheduledMinutes(shD)` when it meant "the day's own length". `shortMins / WORK_DAY_MINUTES` when it meant "rounded to quarter days". An eighty-character sentence when it meant "the reason is on screen".

A guard that goes red when the code is right is worse than no guard: it costs a deploy, it trains everybody to read a failure as noise, and the one time it means something it gets waved through with the rest.

A sweep of all 33 guards flagged **57 checks** with the same shape. They are not all wrong — pinning prose is correct when the prose *is* the behaviour, like a refusal that has to name the people or a notification that has to say "half a day". The test is whether the thing named could be rewritten while staying correct.

`scripts/run-guards.mjs` now carries the rule at the top, where every guard author reads it, with the seven failures as worked examples. The remaining candidates are listed but not rewritten: weakening a real guard to silence a false one is the worse mistake, and each needs the judgement made deliberately rather than in bulk.

## [1.81.1] — 2026-09-03 — half a day unpaid

**CEO:** *"unpaid should have option half day unpaid or full day unpaid"*

The server has accepted a fractional `days` since v1.75.0 — it rounds to quarter days, the payslip multiplies it, and the Staff tab already prints the fraction beside the date. The form on the attendance card simply never sent one, so every record was a whole day whatever had actually happened.

**How much** now sits between Date and Reason: Full day or Half day. A select rather than two buttons, because the amount is a property of the record being made and has to be visible while the date is chosen — two buttons would hide the decision inside the click, where nobody can check it before pressing.

The button says which one it will record, since this is a press that cannot be taken back. And the notification the staff member receives says **"half a day"** rather than *"0.5 of a day"* — that message is the first they hear that their pay is being cut, and it should read like something a person wrote.

Three checks added to guard #20, negative-tested: that the select reaches the request body (a setting that never leaves the browser is a setting that does nothing), that the button names the amount, and that the notification uses words.

## [1.81.0] — 2026-09-03 — lunch is not work

**CEO**, on a short-day chip reading `10/08 · 4.98h/8h`: *"this one should exclude of lunch time of 1 hour"*

The absence scan measured a clocked day against the **elapsed** length of the schedule. An office day of 10:00–18:00 is eight hours on the clock and **seven hours of work**, because an hour of it is lunch and lunch is unpaid. Everybody owed seven was being judged against eight — and the card said so in as many words, *"days clocked short of 8 hours (break included)"*, which was at least honest about being wrong.

Migration `0103` puts the break on the pattern, defaulting to sixty minutes, which applies to every pattern that already exists. **When** it applies is not stored, because it is law rather than policy: Employment Act 1955 s.60A(1)(a) — no employee shall work more than five consecutive hours without a period of leisure of not less than thirty minutes. So the break comes off a day only when one of its blocks runs longer than five hours, and it comes off **once**: a six-hour afternoon earns it, and the two-hour evening block beside it does not earn a second one.

`scheduledMinutes` stays the elapsed schedule, because that is what the register prints. `workMinutes` is the new number anybody is measured against. Conflating the two is what produced `4.98h/8h`.

### The charge was worse than the display

Marking a short day unpaid charged a fraction of a **flat eight hours**, whatever the person's schedule said. Somebody on a seven-hour day who worked six was billed 2/8 of a day instead of 1/7 — **over-charged by more than double**, on a line that reads as a plain fraction and looks right.

It now resolves the day's owed hours from that person's own pattern, **server-side**. The browser sends what it displayed; what a payslip deducts is not something a request body gets to decide.

The chip itself had a third version of the same mistake: it printed a hard-coded `/8h` beside a figure the server had measured against something else entirely. It shows the day's real target now, and says on hover what the break took off.

### Elsewhere

The pattern editor gains an **Unpaid break** field. Every day total and the week total are now hours of **work**, net of it, with the gross on hover — so a 10:00–18:00 row reads 7h, which is the number that decides whether somebody is short. The attendance export carries `break_minutes` and `work_minutes` as their own columns, so a deduction can be traced without knowing the rule.

A database that has not applied `0103` deducts **no** break at all. Inventing an hour the schedule never mentioned would charge people for lunch they were not given.

### Guarded

Guard #24 gained eleven checks — that the break is earned by the five-hour rule rather than assumed, that it comes off once, that the elapsed schedule and the owed hours stay different numbers, that the charge uses the day's own denominator, and that the browser's copy of the rule matches the worker's.

Two existing checks had to be corrected, and both for the same reason as the four before them this week: they named an implementation rather than a behaviour. One pinned `scheduledMinutes` in the short-day scan and went red when the scan correctly moved to `workMinutes`; the other pinned `WORK_DAY_MINUTES` as the divisor of the quarter-day rounding and went red when the divisor correctly became the day's own hours. **That is six guards in one week failing on a correct change.** Both now assert the property and leave the specific rule pinned where that rule lives.

## [1.80.1] — 2026-09-03 — a pattern you can remove, and the error you could not see

**CEO:** *"option to remove this pattern since there is a issue to update pattern name!"*

### Why the rename looked broken

There was a real failure behind that sentence, and the card was reporting it **in green, above the fold, while he was working below it**.

Every action on this card routes through one helper. On success it raised the portal's toast; on failure it did not — it only set a message that renders as a single green line near the **top** of the card. Working hours sits several screens below that now. So a rejected save — a missing migration, an expired session, a name the server would not take — looked exactly like nothing happening at all: no toast, and the only explanation rendered in the colour of success, out of sight.

Failures now raise the same toast as successes, which appears where the eye is regardless of scroll, carrying the server's own reason. And the inline line is red when it is bad news.

Worth naming the likely cause of his particular failure: **migrations `0101` and `0102` are not applied yet**. Saving a pattern writes the second block's columns, which do not exist until `0102` runs, and the server says so — it has been saying so, in green, off-screen.

### Removing a pattern

A pattern created by mistake had no way out. It sat in the chip row permanently, and the only thing to do with it was open it and try to rename it into something useful.

**Remove pattern** is in the editor now, on saved patterns only, behind a confirm. Two refusals, both about history rather than tidiness:

- **The default pattern stays.** It is what everybody without their own schedule is measured against, and what a new joiner starts on. Deleting it drops the whole company onto the hard-coded 10:00–18:00 fallback — the exact constant `0099` existed to remove.
- **An assigned pattern stays.** Assignments are effective-dated: they *are* the record of which hours each month was flagged against. Delete the pattern and `shiftOn` finds nothing on the join and falls through to the default, silently re-flagging months that have already been paid.

The second refusal **names the people still on it**, because "reassign them first" is only useful advice if you know who they are.

Guard #24 gained eight checks covering both refusals, the confirm, and the two feedback fixes — each negative-tested.

## [1.80.0] — 2026-09-03 — a working day in two blocks

**CEO:** *"I want minimalist interface for me to easier to choose which area that I want to update. If user clock in after working hour need to check if their task is assigned to work at 8pm above? if yes, then it is consider their working time. this one need to change since it is not working correctly flow which is require 8 hours, 11:00am to 5:00pm then continue work at 8:30pm to 10:30pm and bulk choose day for me to update easily"*

### 11:00–17:00, then 20:30–22:30

v1.76.0 gave every weekday **one** start and one end. That is the shape of an office day and not the shape of this company: a live host works the afternoon, goes home, and comes back for the evening broadcast. Six hours plus two is the eight he is owed, and there was nowhere to put the two.

Written as one window — 11:00–22:30, the only way it fitted — everything downstream believed it. **Eleven and a half scheduled hours.** An early-out flag on anybody who left at 17:00 as instructed. And a part-time host paid RM15/h for the three and a half hours he spent at home: **RM 52.50 a day**.

Migration `0102` gives each weekday an optional second block. A day is now a list of blocks, and four helpers exist so it is easier to be right than to reach for the old `start`/`end` and be subtly wrong at 20:30 — `windowAt`, `lateAgainst`, `endOfDay`, `scheduledMinutes`. `start` and `end` still mean the first block, so every single-block pattern in the company behaves exactly as it did.

Four places were wrong about the evening and are not now:

- **Late** is measured against the block somebody is turning up *for*. 20:28 for a 20:30 block was previously "late by nine hours" against an 11:00 start — and being past the half-day threshold, it **docked half a day**.
- **Early-out** is measured against the *last* block's end. Against a 17:00 first-block end, leaving at 22:30 read "ok" and leaving at 17:05 read "ok" too; the flag meant nothing.
- **Hourly pay** counts the overlap of the punch span with the scheduled blocks, not the span. 11:00 to 22:30 now pays eight hours.
- **The short-day scan** compares like with like. It had been measuring a six-hour first block against an 11.5-hour span, so it never found anybody short — ever.

### Work the schedule does not know about

*"If user clock in after working hour need to check if their task is assigned to work at 8pm above? if yes, then it is consider their working time."*

A pattern is a normal week. A client booking a 21:00 broadcast is not, and a punch at 21:00 was being measured against a shift that ended at 17:00.

A punch outside every scheduled block is now checked against the two places this company actually schedules work — `live_sessions` (the live board) and `task_blocks` (the roster). If either covers that moment, the punch **counts as working time** and the register says which job vouched for it, by name: *assigned: Sara Beauty*. The month's commitments are read once per request, not twice per punch.

Three limits, each with a reason: a **cancelled** session covers nothing (turning up for a session that was called off is not assigned work); a block with no end time covers **three hours**, not the rest of the night (`task_blocks.end_time` is nullable, and open-ended would vouch for a punch at midnight); and assigned minutes overlapping a scheduled block are **never paid twice**.

Where there is nothing to measure against at all — a rest day worked, a database that has not applied `0099` — the whole span still counts, exactly as before. **A schedule the system cannot read must never silently zero a wage.** And because this change can make a payslip *smaller*, the payroll row now shows both figures: `clocked 11h30 · 3h30 off-schedule`.

### Bulk day select, and hours you can see

*"bulk choose day for me to update easily"*

Tick the days that share a schedule — with Mon–Fri and All shortcuts — type the times once, Apply. Typing 11:00–17:00 into five rows by hand is five chances to put 17:30 where 17:00 belongs, and the only symptom is somebody flagged late on a Thursday three weeks later.

Every row shows what that day comes to, and the footer shows the week. Eight hours split across two blocks is not a sum anybody should be doing in their head.

### The card opens short

*"I want minimalist interface for me to easier to choose which area that I want to update"*

Add record, Unpaid leave, Working hours and Find & filter were four full forms stacked open at once — **eighteen controls before the first attendance row**, and the records he opened the card to read were off the bottom of the screen. One area at a time now, chosen from a row of buttons. Find & filter opens by default, because it decides what the table shows; the table itself is always there.

### Guarded

Guard #24 gained fifteen checks: that the helpers exist rather than being re-derived at each call site, that blocks are stored in order, that all three punch classifiers use them, that a cancelled session vouches for nothing, that assigned minutes are not double-paid, and that an unreadable schedule still pays the span.

Two of its existing checks named the export's column list and a formula verbatim, and went red because the export widened to carry both blocks — the third and fourth time this release that a guard pinned prose instead of behaviour. Both now assert the property.

One check was **itself wrong on its first run**: it looked for the pre-migration recovery by searching the file for `if (!String(e2).includes("no such column")) throw e2;`, a line that already appears twice elsewhere in `staff.ts` — so it passed with the recovery deleted. It now matches the whole recovery as one span. That recovery matters: the worker publishes **before** migrations run, and `shiftOn` names its columns explicitly, so for a few minutes it asks a database with no `mon_start2` for `mon_start2`. Swallowed, that would have flagged every punch in the window against the hard-coded 10:00–18:00 nobody works.

## [1.79.0] — 2026-09-02 — one tab registry, a payroll row you can read, and two discounts told apart

**CEO:** *"why it wrapped like this? when I clicked closed it doesnt popup which is not correct! also I want minimalist style to make it easy in order and 🔐 Tab access control should update all the tabs available to make it up-to-date"*

### The payroll row stopped shredding people's names

The NET cell carried `whitespace-nowrap`, and underneath the figure sit two explanation lines that run to eighty characters. Forced onto one line each, they widened that column until the table overflowed its container — and the space had to come from somewhere, so the STAFF column was squeezed until names broke **one word per line**.

The figure still never wraps. The prose beneath it now does, inside a fixed 13rem cell, and it is shorter: `incomplete month · 9/19 days` and `unpaid · 19d + 8 rest · capped`, with the full sentence on hover. The STAFF cell is two lines — the name, which never breaks, and the job title under it, which may. Both the ⚠ date-mismatch warning and the hourly badge were rewritten to match.

Guard #20's *"the reason is on the screen, not in a hover"* check had the old sentences written out verbatim, so **shortening them failed a guard about something else entirely**. It now strips every `title={…}` from the deduction block and asserts the day counts survive as visible text — the property it was written for, indifferent to the wording. Moving an explanation back into a tooltip still fails it.

### Closing an enquiry says so, and three other silent controls

*"when I clicked closed it doesnt popup which is not correct!"*

The v1.78.0 feedback audit walked buttons. **Dropdowns and checkboxes were never walked** — and a `<select>` that writes to the database is as much a mutation as a button. A scan that resolves each `onChange` to its handler body found four:

- the enquiry status dropdown (**his**) — now reports both ways
- the enquiry reply — reported nothing, and worse, **cleared the draft even when the send failed**; it now returns early and keeps what you typed
- the task tick — silent on failure
- the onboarding checklist tick — set the tick on screen and never checked the save, so a failed write left the box ticked and the record unticked; it now reverts and says so

The scan is being folded into guard #25 as a standing rule.

### The two discounts had the same name

**CEO**, on invoice INV-AZOO280826-1: *"I see why discount not populated there?"*

The invoice was right — RM 39.00 gross, RM 12.00 off, RM 27.00 total, and the words agreed. But the LUMI LUXE line printed at full price with a dash in its DISCOUNT column, because the RM 12 had gone into the **document-level** discount, which prints at the bottom as *Less: discount*.

Easy to get wrong, and not his fault: the item-row field was labelled `Discount (RM)` and the document field `Discount (RM, optional)`. Two different figures, printing in two different places, under one name. They are now **Line discount (RM)** and **Whole-document discount (RM)**, and the second says underneath where it prints and points at the first for the other behaviour.

Two more things came off the same thread. The document field now warns when the discount exceeds what the items come to — the Worker clamps the total at zero, so what the customer would otherwise receive is a document reading *Less: discount − RM 500* under a subtotal of RM 39 and a total of RM 0.00. And the item row's column headers are `hidden sm:grid`, so **on a phone the line was four unlabelled boxes, two of them reading "0.00"** — unit price and line discount, side by side, with only a tooltip to tell them apart. Each field now carries its label below that breakpoint and hides it above, where the header row does the job.

### Guard #30: a component declared inside a component

The label fix wrapped each line field in a small `Cell` component — declared inside `Sales`, which would have made the unit-price box **unusable**: a component declared inside a render is a new type on every render, so React unmounts and rebuilds the subtree, and the input loses focus after every keystroke.

Caught before it shipped, but it had already shipped once. `RightRail` had been carrying a `Section` declared the same way for releases, throwing away and rebuilding all three of its panels on every render. Nothing in `Section` holds focus, which is exactly why nobody found it — that is the shape of this bug: harmless until somebody puts an input in it, then baffling.

Both are at module scope now, and guard #30 fails the build on the pattern rather than waiting for the symptom. Helpers that merely return JSX are deliberately not caught: they are called, not mounted, so their identity changing costs nothing. The capital letter is the line, because it is the line React uses too.

`SubR` — the portal's field label since v1.4.139 — was private to `role-panels.tsx`, which is why every other file either rewrote it or shipped bare placeholders. It and its grid-row sibling `RowCell` now live in `components/ui/sub-label.tsx`.

### 🔐 Tab access control now cannot go stale

*"should update all the tabs available to make it up-to-date"*

He asked this once before, at v1.21.4, and it was answered by re-copying the list into the card under a comment saying to keep the two in sync. **A comment is not a mechanism**, and by this release the copy had drifted again: the card listed the tabs in a different order from the portal, and had the Users tab down as *ceo, coo* when the portal has allowed `admin` since v1.40.0 — the card was confidently describing a permission the system does not apply.

`tests/registry-parity.mjs` had been checking the tab NAMES across all four copies since v1.40.1, which is exactly why the names stayed right and the **roles** quietly went wrong: the guard checked the half that was easy to check.

The list, the defaults, the role chips, the hints and the visibility rule now live in `lib/portal-tabs.ts`. The portal builds its tab strip from `canSeeTab()`; the card renders `GOVERNABLE_TABS` and asks the same function what a setting means. A tab added anywhere appears in the card on the same deploy, in the portal's own order, with the portal's own rules. Two hundred lines of duplicated table are gone from `page.tsx` and the card.

One dead special case went with it: the Sales tab's default was computed outside the matrix as `SALES_ROLES.includes(role) || role === "ceo"`, and `SALES_ROLES` has contained `"ceo"` since it was written — the second half had never once changed an answer.

The parity guard now fails the build if either file re-declares `ALL_TABS`, `TAB_ROLES`, `TABS` or `DEFAULTS`, if a hint names a tab that does not exist, or if a default grants a role the card has no chip for — a permission the CEO could see but never revoke.

### Minimalist, as asked

The card was 24 bordered boxes, each printing every allowed role inline, so the longest rows ran to a dozen comma-separated names and the tab's own name was lost in the middle of them. It is now one ruled list: name, one-line hint, and the audience as a count — *"7 of 9 roles"*, the full membership on hover. The names are read from the same dictionary the navigation uses, so they match the tabs on screen in both languages. **Reset to default** moved inside the editor, where the change it undoes is visible.

## [1.78.0] — 2026-08-31 — company order, and the Saturday you worked comes back

**CEO:** four things, in one message.

### The salary run reads in company order

*"payroll should ascending with position which is CEO, COO, CCO, HR_admin, Sales Executive, Sales Marketing, Marketing Designer and lastly Live host and Part time last host."*

Payroll sorted alphabetically, so the CEO appeared second and the part-time host fourth. A rank order **already existed** — inlined in the staff directory — and was nearly this one: it flattened marketing, editor and live_host into a single bucket and knew nothing about part-time contracts. Rather than add a second order that would drift from the first, that one moved to `lib/staff-order.ts`, gained the two levels named above, and is now what **both** the Staff tab and Payroll read.

The worker mirrors it in SQL, because it cannot import from `lib/`. That matters more than it sounds: **the M2E salary file pays people in the order its rows come out**, so a file ordered differently from the screen is a file nobody can check against the screen. All three payroll listings — the table, the M2E file and its preview — now share it, and guard #29 compiles the module, runs it on a made-up company, and reads the same ranks back out of the SQL. Every column header still sorts; company order is the resting state, not a cage.

### Working on a rest day earns a day back

*"in Staff table should appear a list of replacement leave for the staff that working on weekend which is for me to credit the replacement leave either half day or full day depend on their in and out time."*

`replacement` has been a leave type since the beginning and could only ever be **taken** — the entitlement editor refuses it in as many words, *"counted as taken, not granted"*. So somebody who worked a Saturday was owed a day the system had no way to give them, and the balance lived in somebody's memory.

A **Leave to review** card now sits at the top of the Staff tab listing every rest day worked and not yet credited, with the clock-in and clock-out time beside it and both buttons — **Half day** and **Full day**. A chip suggests which, from the hours actually clocked; the decision stays the CEO's. Crediting adds to that person's replacement balance through the CEO-only entitlement lever, notifies them, and is audited; they then apply for it like any other leave.

Four things make that safe, each checked by the guard: it must be a **rest day on that person's own schedule** (not Saturday and Sunday — somebody rostered to work Saturdays is not owed a day for it), there must be an **approved clock-in** behind it (a pending claim buys nothing), it can only ever be **half a day or a whole one**, and migration `0101`'s unique index means **a double tap costs the company nothing**. Hourly part-timers are skipped: they were already paid for those hours, and crediting leave on top pays for the same Saturday twice.

### Unpaid days moved to where they are reviewed

*"for Staff attendance — corrections & back-entry Unpaid leave should not appear all the list of during that month which is the record should be recorded into staff table."*

The chip row listing every unpaid day of the month has left the Attendance card and joined the same review card, undo included. Recording a day still happens on Attendance, where the correction tools are; **reviewing** the month happens on the Staff tab, down one list, across everybody. The Attendance card now says where they went.

### The attendance card stops looking hand-made

*"Working hour pattern seem like not so professional with that interface which is to me ugly! use globally format coding!"*

He was right, and it was worse than the working-hours row. All four control rows on that card — Add record, Unpaid leave, Working hours, Find & filter — were hand-rolled flex with per-input `max-w-56` / `max-w-40` guesses and **no labels at all**, just placeholders. On a wide screen the date and month inputs blew out to full width while the selects sat tiny at the left, so every row read as a broken ladder.

All four are now the house pattern the rest of the portal already uses: a `SubR` label above every field, the shared `inputClass`, and a real 4-column responsive grid that decides the widths. The per-weekday time boxes in the pattern editor use `inputClassSm` instead of a pasted class string, and the pattern and assignment chips use `chipNeutral`. Every handler, condition, endpoint and toast is unchanged — this is presentation only.

### The system account is not an employee

**CEO, mid-build:** *"Take note, super_Admin is not a staff. Super_admin is system controller which is handling everything about the system."*

He was reading the same payroll screen, where **Days with no clock-in** opened with a **Super Admin** block listing nineteen absent days. The system account had been quietly acquiring an attendance record, an absence history, a birthday in the company list and a place in every staff dropdown — because those queries asked for `role != 'customer'` (everyone who is not a shopper) while the payroll and M2E queries beside them asked for staff. Two halves of one screen disagreeing about who works here.

One predicate now — `staffRolesSql` in the worker, `isStaffRole` in the browser — across ten staff lists: the shift resolver, the leave-entitlement editor, the rest-day scan, both attendance-days lists, the absence scan, birthdays, the company task board and the two announcement broadcasts (whose own comments already said *"every active staff member"*). **Nothing about permissions changed** — super_admin still holds every one of them, because controlling the system is the job. What changed is who the system counts, pays, rosters and chases for a missing punch. The guard fails the build on any staff list that drifts back to the loose predicate.

### Notes

- **Migration `0101_replacement_credits`** — apply it. One new table, replayable.
- 29 guards.

## [1.77.0] — 2026-08-31 — buttons that answer

**CEO:** *"on the Task, there is no popup box to show if there is any task successfully deleted. I also want to make sure that all this being done globally, you require to audit all the files in this project to ensure that all is globally!"* — then, an hour later, two things that were plainly broken: a "no clock-in" chip that answered *"Something went wrong"*, and **Offboard** that answered *"Staff route not found"*.

Three different symptoms, one theme. **A button either does what it says or tells you why not.**

### The two that were broken

**Marking a day unpaid crashed.** The route read `WORK_DAY_MINUTES` — a `const` declared about a hundred lines *further down the same function*. JavaScript does not hoist a value into that gap; it throws. The constant now sits at module scope, initialised before any request exists.

**Offboarding called an address nobody was listening at.** The staff directory builds its requests with the staff-portal prefix, so `/users/12/offboard` went out as `/api/v1/staff/users/12/offboard`. The real route is `/api/v1/users/12/offboard` — offboarding kills sessions and clears two-factor, so it lives with the account-lifecycle routes rather than in the portal. The handler was perfect. The address was wrong. One call site now uses the API root.

### Offboarding asks for the last day

**CEO:** *"offboard should I can insert the date of their resignation which is to ensure that I can insert correctly instead of capture to today date"*.

The button stamped **today**, which is only correct if you offboard somebody the moment they walk out — and notice is normally served in advance, so the common case was the wrong one. The date is not decoration: `left_on` is what payroll prorates a final month on, so a day out is money out.

The dialog now asks for the last day, pre-filled with today in **Malaysia** time (the same expression the worker uses, so a laptop left on UTC cannot propose yesterday) and refusing to submit while it is empty. The confirmation reads the date back. And the server no longer replaces a date it cannot parse with today: a value that was sent and is not a date is a 400, because a silent substitution there is a final salary computed against a day nobody chose, printed on a payslip, with nothing saying it happened. Omitting the field entirely still means today, so an older client keeps working.

`usePrompt` gained a date-only mode (`text: false`) and a `danger` button, rather than growing a second bespoke modal.

### The audit he asked for

Every mutating call in all 64 client files, read in turn. Nine actions changed money, time off or a record and then said nothing:

- **deleting a task** (his own report) — now says so, and says it differently when the server refuses
- **deciding somebody's leave**, and the **CEO override** that bypasses the HOD
- **approving or rejecting overtime**
- **removing a commission rule**
- **crediting a supplier return** and **recording a replacement** — money coming back, recorded in silence
- **deleting a supplier return** — a dialog promising stock movement, then nothing
- **deleting a company event** — every member of staff is notified when one is created; removing one was mute, and did not even check whether the server agreed
- **deleting a file from a staff member's document vault** — and **uploading one**, which succeeded and failed identically. Somebody who uploads a signed contract and sees nothing assumes it is filed. The vault is its own component, so it now carries its own toast rather than borrowing the directory's.

### Three guards, so this is the last time

- **`action-feedback`** — a DELETE must report, and anything gated behind *"are you sure?"* must report. Its first draft read forty lines around each call and passed a deliberately silent delete, because a helper defined underneath it happened to show a message. It reads the enclosing function now: what the code three lines down does is not evidence about this call.
- **`api-routes`** — resolves all 342 API calls in the portal to the path they actually put on the wire, and checks each against the routes the worker really serves. Nothing else could have caught the Offboard bug: both sides are strings, TypeScript sees two valid strings, and the handler it was looking for is genuinely there.
- **`worker-compile-gate`** — already ran the real compiler over the API, already saw the crash (`TS2448`), and passed it anyway, because it was being counted among the pre-existing strict-mode complaints it ignores by design. *Used before its declaration* is not an opinion about strictness; it is a name that will not exist when the line runs, which is the same bug as the 19-08 outage. It is fatal now.

### A month of unpaid leave still paid five Saturdays

**CEO:** *"Zul Hisyam should entitle 2 PH but seem like the payroll make it around 5++ which is not correct! you have to audit it to ensure that I didnt pay something that incorrect and overpaid!"*

He was right, and both halves of his sentence were exact. Zul was absent every one of August's 19 working days. Unpaid leave deducts at the Employment Act's ordinary rate — monthly wage ÷ 26 — so 19 days took RM1,461.54 and left **RM538.46 for a month in which he did nothing**. That residue is exactly seven days: his 2 public holidays, and 5 Saturdays.

**The cause is a divisor mismatch, not a rounding error.** The 1/26 rate assumes a six-day week, one rest day in seven. This company works five days. So no number of unpaid working days can ever reach the whole salary, and anyone with heavy unpaid leave was affected — not just Zul.

**The rule, of three put to the CEO:** a week in which *every* one of that person's working days is unpaid also loses that week's rest days. Rest days are earned by working the week. It was chosen over a flat "absent all month = nothing" because it has no cliff — a heavily-but-not-wholly unpaid month tapers instead of jumping — and over leaving it alone because leaving it alone pays Saturdays to somebody who was not there.

**Public holidays are never touched**, by the rule or by the cap beneath it. Section 60D(2) removes holiday pay only for absence *without* the employer's consent, and recorded unpaid leave is consented absence. That is the whole of the CEO's "2 PH".

| | before | after |
|---|---|---|
| Zul Hisyam — all 19 days unpaid | RM538.46 | **RM153.85** (his 2 public holidays) |
| 15 of 19 unpaid (3 whole weeks) | RM846.15 | RM384.62 |
| Nur Nasuha — 2.75 days scattered | RM1,788.46 | **unchanged** |

The cap is a second fix in its own right: incomplete-month and unpaid leave were two independent deductions that together could exceed the basic and print a **negative payslip**. They cannot now.

### Working on a public holiday now pays what the Act says

**CEO:** *"if they are working on Public Holiday, then only will be paid as double. if they are not working on public holiday consider that they will receive 1 day of paid instead of double paid of working day which is we need to follow on the regulation"*.

Until now the payroll paid **nothing extra** for a public holiday worked. The holiday was already inside the monthly salary — that is the "1 day of paid" for not working — but a person who clocked in on Merdeka Day was paid exactly the same as one who stayed home.

The rate was confirmed with the CEO against the Act rather than the word "double": **Employment Act 1955 s.60D(3)(a)(i)** — an employee who works on a paid holiday is paid *two days' wages at the ordinary rate of pay in addition to* the holiday pay. So one public holiday worked adds 2 × (basic ÷ 26) to the month: **+RM153.85 on RM2,000.** A part-time hourly host follows the Employment (Part-Time Employees) Regulations 2010 instead — twice the hourly rate — so the hours on that day earn a second RM15/h.

What counts as worked: an **approved** clock-in (a pending claim earns nothing) on a date the holiday calendar marks *public* or *replacement*. A *company* day off is the company's gift, not a gazetted holiday, and carries no statutory premium.

One resolver, four surfaces — the payslip, the panel's figures, `/payroll/recompute` and the hourly save. The payslip carries it as its own earnings line naming the days; the row shows it under BASIC in green; the totals row shows how much of the month's basic is holiday premium. Guard #23 runs the arithmetic and refuses a build where any of the four surfaces forgets it, where a company day starts paying it, or where "double" quietly becomes one day.

### A returning employee was charged for every day since they first left

`employedDays` — which decides how much of a month somebody is paid for — read `Joined on` and `End date` and **ignored `Re-joined on` entirely**, though the field has existed since v1.4.101 and the staff list already honours it. Anyone who resigned and came back was prorated away from their old leaving date, silently, for as long as that date sat in their record. Threaded through all six call sites.

### Five copies of one formula became one

The unpaid deduction was written out in the payslip, in `/payroll/recompute` (which is what *writes* `net_cents`), and three times in the browser. A rule with a week clause and a public-holiday floor cannot survive five copies — the first one anybody forgot would be a row disagreeing with its own payslip. There is now **one resolver** in the worker, called by all three server surfaces, and a runnable twin in `lib/payroll-days.ts` that guard #23 executes against the real August figures. The browser no longer derives per-day pay at all; it prints the server's number, and the guard fails on *any* `÷ 26` arithmetic reappearing in the panel.

### And the reason is on the screen

The red line under a net said `− RM 1,052.63 auto`, with the explanation hidden in a hover tooltip. Two completely different deductions rendered identically — unpaid leave at 1/26, and an incomplete month at 1/working-days. That is how a RM1,052.63 charge sat on Nurfarah Suaidah's row unexplained. Every automatic deduction now says what it is, in words, on the row and on the payslip.

Her row also exposed something no formula can settle: the system had her **employed for 9 of 19 working days but clocked in on 12**. Both cannot be true; one of her employment dates is wrong. The payroll now flags that contradiction on the row rather than quietly charging for the difference — a warning, not a block, so a genuine edge case can still be processed.

### The Payroll tab was taking the better part of a minute

**CEO:** *"why seem too take longer to load? this is abnormal!"* — with the tab showing **TOTAL — 0 staff**.

Two separate faults, both introduced with the shift schedules in v1.76.0.

**The scan asked the database the same question five hundred times.** Resolving one person's hours on one date is two queries. The absence scan did that inside two nested loops — every person, every day of the month — and the attendance export did it *per punch*. Nothing about the data justified it: there are a handful of patterns and one row per assignment, so the entire schedule of the company now loads in **two queries** and every lookup after that is a comparison in memory.

**And the table was waiting for it.** The scan was `await`ed in the middle of the panel's load, and the salary table is only drawn at the end — so the whole tab sat behind it, reading "TOTAL — 0 staff", which looks exactly like a payroll with nobody in it. The scan is a suggestion card; it can arrive late. The table cannot.

Guard #24 gained the invariant, stated as something checkable rather than as advice: **no shift lookup may sit inside a loop** (brace-tracked, because a line window cannot tell where a loop ends), and the payroll table must not await the scan.

### Nothing loads in words, and nothing loads blank

**CEO:** *"I saw skeleton loading react doesnt accurately follow the width of my interface and also I want no loading without skeleton loading react. Additionally, audit all the files to ensure that no loading leak without skeleton loading react either in web or mobile view apps for both my web."*

**The width.** `PortalSkeleton` — the first thing painted, baked into `portal.html` — still capped its canvas at 1440px after v1.74.0 removed that cap from the real shell, and it drew no side columns although the Dashboard has two (264px and 292px). So the skeleton painted a different shape from the app that replaced it and the page jumped, which is the one thing a skeleton exists to prevent. It now carries AppShell's classes verbatim, side columns included; guard #28 fails the build if the two ever differ.

**The audit.** Every `.tsx` in both repositories, every component that fetches when it mounts:

| | portal | shop |
|---|---|---|
| components that fetch on mount | 89 | 12 |
| …with a skeleton, before | 6 | 3 |
| "Loading…" in words | 5 | 10 |
| spinners | 0 | 1 |
| blank (`return null`) while loading | 4 | 2 |

That is how the Payroll tab read **"TOTAL — 0 staff"** this morning: not a wrong number, an empty state drawn while the data was still on its way. Eighty portal components and nine shop pages now show a skeleton **in the shape of what is coming** — same card, same heading, same grid and table columns, same phone/desktop breakpoints — until their first request settles, and every "No records yet" message is gated on that so it can no longer flash. One exemption, printed by the guard so it stays countable: the login form, whose only fetch is a redirect for someone already signed in.

**Guard #28 `skeleton-loading`** (and the same guard in the shop's DEPLOY.bat): no loading state in words, no spinner, the first paint mirrors the shell, and — detected rather than declared — every component with a mount-time fetch references a skeleton primitive and never returns `null` on a loading flag.

### Notes

- No migration. Nothing to apply.
- 28 guards.

## [1.76.0] — 2026-08-30 — working hours become a schedule

**CEO:** *"clock in/out should capture their clock working hour which is 10am to 6pm for Monday to Thursday, Friday 10am to 5:30pm... if they forget to clock in or clock out, they will be able to clock in and out but system will require them to get the approval... The approval will be require CEO... then CEO will update the clock in/out time during the approval... on weekend the system should be able to capture it is out of working day... I want to have the working hour schedule for me to setup their working hours so that system able to capture their working hours without everything dump into 1 working hour."*

### It was already wrong

Working hours were a single constant in the worker — `10:00–18:00, Monday–Friday` — and **the company had already moved its Friday finishing time.** There is an announcement about it on the dashboard, *PERUBAHAN WAKTU BALIK BEKERJA UNTUK HARI JUMAAT*. Every Friday since has been flagged against 18:00, in the register, the payroll export and the short-day scan.

### Patterns, assigned, effective-dated

`0099` adds **named shift patterns** with a start and finish per weekday, and assignments that carry the date they begin. The office pattern is seeded with the Friday finish the company actually uses.

- **A pattern is shared**, so the next company-wide change is one edit rather than nine.
- **Assignments are effective-dated** — fixing somebody's hours today does not re-flag a month that has already been paid.
- **A day left blank is a rest day.** That is what makes "weekend" answerable *per person*: somebody whose pattern works Saturday is not on a weekend, and a punch on their rest day is flagged `rest_day` rather than as an early-out against hours that do not apply.

Everything that judged a punch now resolves the person's own schedule: the classifier, the register (`day_kind`, the hours it judged against, and whether the punch is waiting), the payroll export (which now carries `day_kind`, `pattern`, `shift_start`, `shift_end` so a late flag can be traced to a set of hours), and the short-day scan — somebody on 11:00–19:00 is not short at 18:00.

### A forgotten punch is recorded, then approved

Clocking out with no clock-in used to be **refused**. That was worse than it looked: the person had worked the day, could not record it, and the day vanished from payroll entirely.

Now the first tap explains and the second sends it. The punch is stored `pending_approval = 1` (`0100`) and **counts for nothing** — not hours, not days worked, not the payroll scan — until the CEO approves it. Approving is where the time is set, because the claimed time is the one thing nobody can verify. Rejecting deletes the punch: a rejected claim is not a record of anything, and a zombie row is what gets counted by something later.

Five queries count attendance — hourly pay, the payslip's working days, the payroll day-fill, the absence scan and the export — and all five exclude pending punches through one shared clause resolved once per request.

### Guard #24 `shift-schedule` (37 checks, five ways negative-tested)

The two rules that are silent when broken: **every counting query excludes a pending punch**, and **nothing reads the old constant** — a stray `SHIFT.startMinutes` is that Friday bug growing back, so the guard scans line by line and allows it only inside `shiftOn()`'s own fallback.

### After deploying

Migrations **0099 and 0100**. Then open Attendance → Working hours: the seeded office pattern is 10:00–18:00 with Friday 17:30 — check it, add a pattern for anyone on different hours, and assign it from the date it should start.

## [1.75.0] — 2026-08-30 — a payslip was deducting approved medical leave

**CEO:** *"on payslip, I want to count for the Public Holiday that set to the staff, then incomplete month only for the new staff which is new joiner in that month. Unpaid will be count based on their no data in, then on unpaid I should able to deduct for half day or based on their time in... the working hours is 8 hours include their break time."*

Auditing this found a live over-deduction, so that goes first.

### The bug

Nur Nasuha, August 2026: 19 working days, 15 clocked, 1 recorded unpaid, **1 approved medical leave**. Her payslip printed:

    UNPAID LEAVE (1.00 DAY × 1/26 MONTHLY WAGE)      76.92
    INCOMPLETE MONTH (WORKED 15 OF 19 PAYABLE DAYS)  315.79

The second line is `basic × (19 − 15 − 1) ÷ 19` — three days at RM 105.26. **One of those three was her approved medical leave, which the Employment Act pays.** The proration read the attendance clock, and a day on approved paid leave has no clock-in, so it looked like absence. Nothing threw. The slip added up.

### The model now

Two deductions, from two sources that cannot overlap:

| Deduction | Reads |
|---|---|
| Incomplete month | **employment dates only** — `joined_on`, `left_on` |
| Unpaid leave | **days somebody explicitly recorded as unpaid** |

**Attendance no longer moves money by itself.** A day is payable if the person was employed on it, so proration applies to a mid-month joiner or leaver and mathematically cannot apply to anyone else — no flag, no special case, the formula is the rule. The payslip line now reads `INCOMPLETE MONTH (JOINED 2026-08-08 — EMPLOYED 12 OF 19 WORKING DAYS)` instead of `WORKED 15 OF 19`, which read like an accusation and was arithmetically wrong.

**Public holidays** are counted inside a person's employment — "the Public Holiday that set to the staff". A joiner is credited the ones after they started, not the whole month's. They were already outside the working-day count, so they never reduced pay, and under this model they structurally cannot.

### Days with no clock-in

`GET /payroll/absences` scans the month for working days with **no clock-in and no approved leave of any kind**, and for days clocked more than two hours short of eight. The payroll panel lists them per person as one-click chips.

They are **proposals, never deductions**. A missing punch is a client visit, a shoot or a flat battery at least as often as it is an absence, and taking pay off somebody automatically for silence in a database is the one thing a payroll system must not do. Future days and hourly part-timers are excluded; a day covered by any approved leave is never offered.

### Part of a day

`POST /attendance/unpaid` accepts `hours_worked` or `days`. Clocked 2h of 8 → 6h short → **0.75 day**, rounded to a quarter day: `0.708333 DAYS` on a payslip is a line nobody can check, and an argument about seven minutes costs more trust than it saves. Capped at one day per row — `leave_requests.days` has been REAL since 0003, so the payslip, the recompute and the panel all multiplied fractions correctly the moment they were allowed to exist. **No migration.**

### Guard #23 `payroll-days` (34 checks, five ways negative-tested)

The arithmetic moved to `lib/payroll-days.ts` so a test can **run** it rather than read it. It reproduces the old formula's 315.79 exactly — confirming that *is* the arithmetic that ran — then asserts the new figures: her incomplete-month deduction is zero, her unpaid day still costs RM 76.92, and her August net is **RM 1,923.08**. Plus the worker held to the same formula text, the 8-hour day, the quarter-day rounding, and the rule that the absence scan proposes and never writes.

### After deploying

**Press Recompute nets for any month you have already saved** — August's stored figures were computed the old way. Nasuha's August net moves from RM 1,607.29 to RM 1,923.08: the medical day was never chargeable, and the other two no-clock-in days are only money if you mark them unpaid from the new list.

## [1.74.0] — 2026-08-30 — export what you filtered to, and fill the window

### CSV that follows the filters

**CEO:** *"I want to generate in excel csv by follow to the filter that I want or a month that I want."*

A **⬇ CSV** button in the attendance Find & filter bar, labelled with the number of rows it will write. It exports **exactly what the table is showing, in the order it is showing it** — search, In/Out, record kind, one day, the month, and the column you sorted by. The table and the button share one `exportRows()`, because two definitions of "visible" drift the first time a filter is added and then the file quietly disagrees with the screen.

Columns: Staff · Type · Date (MYT) · Time (MYT) · Mark · Location · Record ID, above three comment lines recording the month, when it was generated and **which filters were active** — the file outlives the screen it came from. The filename carries them too: `attendance-2026-08-nasuha-clock_in.csv`, not `export(3).csv`.

New `lib/csv.ts` is the one builder, and it gets the four things that make a CSV Excel opens *correctly* rather than merely opens:

- a **UTF-8 BOM**, or Excel reads the file as the local code page and any diacritic becomes mojibake;
- **CRLF**, because these files get forwarded to accountants;
- proper quoting of commas, quotes and newlines;
- **formula defusing** — a cell beginning with `=`, `+`, `-` or `@` is *executed* by Excel on open. Today these cells are names and times; "the data was harmless when I wrote the exporter" is exactly how that hole ships.

The inventory stock-count export, which had its own hand-rolled escaper, now goes through the same builder.

The server's existing `/attendance/export` (whole month, payroll-shaped, with shift flags) is untouched — this is the other thing: what is on your screen, right now.

### The portal fills the window

**CEO:** *"I want it full fit to the website width... dont change the interface layout or any new. just make it fit only."*

Two ceilings, both removed: `AppShell` capped the canvas at **1440px** and `PORTAL_WIDTH` capped the content at **1600px**, so on a 1920 monitor a band of backdrop sat down each side and the app read as a window that had failed to maximise.

Nothing else moves. The rounded canvas, the `p-5` backdrop that makes it a canvas at all, the icon rail, both side columns and every phone rule are exactly as they were — and `PORTAL_WIDTH` is still ONE width in ONE place applied to the outer container, so it can be capped again with one edit if a screen ever wants it.

### Guard #22 `csv-export` (20 checks, five ways negative-tested)

It compiles `lib/csv.ts` and inspects the **bytes it produces** — BOM present, CRLF between rows, a comma quoted, a quote doubled, `=SUM(A1)` defused, a number left unquoted so the column still sums — rather than checking that the source looks about right. Plus: the table and the export must share one visible-rows definition, and no file outside `lib/csv.ts` may build a `text/csv` blob of its own.

## [1.73.0] — 2026-08-30 — the tracking link, and correcting a wrong number

**CEO:** *"on the web order, I want to add their tracking number and also how to make sure that they able to tracking their order based on the tracking number provided? I want to use J&T service or Ninjavan service."*

**Most of this was already built, and saying so is more useful than shipping it twice.** Since v1.51.0 the Web Orders tab has taken a courier and a tracking number and pushed both to the shop over the bridge; the shop turns them into a **track parcel** link on the customer's order page; and **J&T Express and Ninja Van have been in the courier list from the start**, with Pos Laju, Flash, City-Link and DHL.

Two reasons it looked missing:

1. **Every order on the tab was Cancelled.** The courier and tracking boxes appear on a **paid** order — a cancelled one says "nothing left to do here". There has not been a paid web order to try it on.
2. **Until today the live API was v1.32.1.** The route those buttons call arrived in v1.51.0, so even on a paid order it would have failed. This morning's deploy is the first time it has existed on live.

What was genuinely missing is now built.

### The tracking number is a link, everywhere

Feed C carries `tracking_url` (store v1.43.0) — built by the **shop**, from its one courier map — and `0098` gives it a column. The Tracking column in the tab becomes a real link, so a parcel can be checked without retyping a number into a courier site.

The portal holds the courier key and could assemble that URL itself. It deliberately does not, and guard #21 fails the build if it ever starts: the day J&T changes its tracking URL, the fix has to be one edit in one repository, not two with the forgotten one sending customers to a dead page for months.

### A typo is no longer permanent

A tracking number is typed off a parcel label by hand, and `ship` — legal only from `paid` — was the only way it could ever be set. One wrong digit and the customer followed somebody else's parcel forever. A **shipped** order now has a correct-the-number control that calls the shop's new `update_tracking` action; the correction is written into the order's own history, so the customer sees the number change rather than quietly finding a different one.

### Handing it to the customer

Marking a parcel shipped updates the shop's order page — **but nothing reaches the customer until somebody tells them**, and there is still no outbound email (OD-12). So: a **WhatsApp the tracking** button on a shipped order, which opens WhatsApp to that customer's number with the order number, the courier, the tracking number, the direct courier link and the shop's own lookup page. The link comes back with the ship action itself, not on the next five-minute poll — five minutes of "no link yet" is exactly when somebody sends a bare number.

### Guard #21 `web-order-tracking` (20 checks, four ways negative-tested)

The headline rule is a **repository-wide ban on courier domains** in `app/`, `components/`, `lib/`, `constants/` and `worker/src/` — the only way to keep one courier map honest across two repositories that cannot import from each other. Plus: the feed link must be https or dropped, the poller must stay armored for a pre-0098 database, the six courier keys must still match the shop's list, and the WhatsApp message must read the shop's address from the brand registry rather than typing it.

## [1.72.2] — 2026-08-30 — find & filter on the attendance corrections table

**CEO:** *"I want to have the search box for me to find the staff and to filter based on what I want to view either in or out or anything that I want to view."*

The v1.4.78 "Find staff" dropdown becomes a filter bar of its own, sitting directly above the table instead of tucked into the Add-record row where it did not belong:

- **Search** — type part of a name.
- **In & out / In only / Out only.**
- **Any record / Punched by staff / Added manually / Time amended / Off-site (flagged)** — the last one is the geofence flag, so "show me every punch that was not at the office this month" is one click.
- **One day** — a date picker that narrows the month to a single day.
- The **month** picker moves here too; it was always a view control, not an entry field.

A live count reads *"12 of 148 records"* while anything is active, with a **Clear** beside it, and an empty result says so rather than showing a blank table. Everything filters in the browser against the month already loaded, so it is instant and costs no request; sorting by column header still works on the filtered set.

## [1.72.1] — 2026-08-30 — the website build, blocked by one anchor

`DEPLOY EVERYTHING` got through the migration and published the API, then stopped in step 5:

    ./app/portal/page.tsx
    12465:9  Error: Do not use an `<a>` element to navigate to `/login/`.
             Use `<Link />` from `next/link` instead.  @next/next/no-html-link-for-pages

Nothing to do with this release. It is the **"Sign in required"** screen, and that anchor has been there for months — `next lint` refuses it because a raw `<a>` to an in-app route throws away the router and reloads the whole bundle to reach a page the browser already has.

It surfaced now because **this was the first deploy where the website half of the pipeline actually ran.** Step 5 is the half that used to be missing; until it ran, `next build` was never executed on this machine and the lint error sat there unrun. The sandbox those changes are written in cannot run `next build` either — Google Fonts is blocked there — so this class of error can only ever appear here, on the first real build.

`<a href="/login">` → `<Link href="/login">`, one import added. Everything else in that output is a warning and does not block a build.

## [1.72.0] — 2026-08-30 — three things the CEO could not do, and one he already could

**CEO:** *"on Tasks tabs, I want to have an option for me to delete which is roles CEO only... Leave tabs I want to have a function for me to approved the leave form of all the staff which is can by pass their HOD... I also want to have a option for me to update their attendance to Unpaid Leave which is for payroll. on Payroll also to capture this unpaid leave."*

Four asks. Three needed building. The fourth was already there, and saying so is more useful than pretending otherwise.

### Delete a task — CEO only

`DELETE /staff/tasks/:id`, gated by a new `task_delete` permission that admits the CEO and the break-glass account and nobody else. Every other thing that can go wrong with a task is reversible — a wrong status flips back, a wrong deadline is edited, a wrong assignee is reassigned — so deletion sits with `claims_decide` and `leave_entitlement` rather than with `team_manage`.

The children go first and by hand: `task_items`, `task_events`, `task_comments`, `task_blocks`. None of these tables carry ON DELETE CASCADE, and **the roster reads `task_blocks` by date, not through `tasks`** — leaving them would keep a deleted task occupying somebody's working week forever. The assignee and the person who set the task are notified once, and the audit row records the **title**, because a log line saying "task 41 deleted" tells nobody what was lost.

The confirm dialog says what leaves with it, and points at Closed for the case that is actually meant.

### Approve leave past the HOD

`PATCH /staff/leave/:id` now accepts `override: true`, refused to everyone but the CEO. It takes a request from whatever stage it is sitting at straight to approved.

The chain itself is untouched — HR checks the balance, the COO or CCO pre-approves, the CEO signs. What the chain cannot survive is an approver being away, and the CEO is the last signature on that form in any case. **Two rules the bypass does not relax:** nobody approves their own leave, and a closed request cannot be re-decided.

There is no "was bypassed" column, deliberately: `hr_by` and `preapp_by` stay NULL while `final_by` carries the CEO, and that unsigned shape is exactly what the printed form already renders. `audit_log` records `leave.override_approve` with the stage it jumped from.

### Mark a day as Unpaid Leave

New in Attendance → corrections, CEO only: pick the person, pick the day, an optional reason. **The day is stored as an approved unpaid-leave request** (`recorded_direct = 1`, migration `0097`) rather than in a new table — so the payslip, the payroll table, the Leave tab and the balance card all keep reading the same rows and there is no second source of truth to drift.

A day already covered by unpaid leave is refused, because two rows over one day is two deductions. The staff member is notified the moment it is recorded — **a deduction first discovered on the payslip is how trust in a payroll system ends** — and again if it is undone. Undo deletes only `recorded_direct = 1` rows: a leave the staff member applied for and the chain approved is their record, and is not erased from an attendance screen.

### Payroll capturing it — already true since v1.4.79

The payslip has carried an explicit **UNPAID LEAVE (n DAYS × 1/26 MONTHLY WAGE)** line at the Employment Act 1955 s.60I ordinary rate for months, Basic stays full so the slip shows *why* the pay is lower, and those days are excluded from the incomplete-month proration so one absence is never deducted twice. Nothing had to change for the new days to count, which is the point of storing them as leave requests.

One thing did change: the attendance list filters by the month a leave **starts** in, matching what payroll actually attributes — an overlap filter would have shown a July leave under August while August pay was untouched, a screen about money disagreeing with the money.

### Guard #20 `unpaid-leave` (46 checks, seven ways negative-tested)

Permissions are checked as a **set** (`["ceo","super_admin"]`), not by string presence — appending `hr_admin` to the line would otherwise still pass. The cascade is checked table by table. The self-approval rule is checked. And the rate is checked **everywhere it is computed** — the payslip, the recompute and the payroll panel's three sites — because the first draft of that check asserted only that *one* of them said 26, and passed with another quietly changed to 22. That is an underpaid salary that no screen would show.

## [1.71.0] — 2026-08-30 — the business cards go digital

**CEO: "based on this Business Card, I want to make it digital ... all this card should be individual slug url who are representing to their own roles."** Three printed cards are now three URLs:

    a2zcreative.my/farhan   MOHD ALIF FARHAN   Managing Director / CEO
    a2zcreative.my/izz      MOHAMAD IZZUDIN    Director / CCO
    a2zcreative.my/zoll     ZOLKEFLI           Director / COO

The slugs are the names already printed on the paper — a client who met En. Zoll types `zoll`. Role aliases `/ceo`, `/coo` and `/cco` redirect (302, never 301) to whoever holds the chair: a person's URL follows the person, a role's URL stays with the company.

### Static in the site repo, not served by the API

`constants/team.ts` holds one record per person and everything else reads from it — the page, the vCard, the QR, the sitemap entry, the Open Graph image. No table, no worker, no runtime.

That is a deliberate refusal of the obvious design. **A card is printed on paper and handed to a stranger, so the URL on it has to resolve on a bad day.** The site is a static export on Pages and deploys reliably; `azoneofficial-api` is a separate deploy whose build connection has never worked — the live API has sat on v1.32.1 for weeks. The one URL a client types after meeting you does not belong behind that. The record is shaped exactly as a database row would be, so the day this becomes portal-managed the source changes and nothing above it moves.

### What the page does that paper cannot

- **Save to contacts** — a real `.vcf` per person: name, role, direct email, `hello@`, mobile, company, office address and the card's own URL. This is the feature; everything else supports it.
- **One tap to call, WhatsApp or email**, the direct address and the office one both.
- **The office with a map link**, from the same address string that prints on every invoice this company issues — the card can never disagree with the paperwork.
- **Links into the business** — services, packages, work, contact.
- **Its own QR** on the page, for when the holder is out of cards.
- **A per-card Open Graph image** — forwarding the link in WhatsApp shows a name and a role, not a bare URL. That is how a card actually spreads.

### The photos

Each card carries the person's own headshot, cropped square on the face and cut to a circle — the same three images the portal holds, but **as static files in `public/cards/`, not fetched from it**. Pointing the page at `/api/v1/media/file/<key>` would have put a grey box on a client's screen every time the API had a bad day, and would have made every staff photo publicly fetchable by key. All three are framed identically (the face fills 59% of the frame) so the three cards read as one set, and the same photo goes onto the link-preview image, so forwarding a card in WhatsApp now shows the person rather than two letters. `scripts/card-og.py` does the compositing and regenerates every QR and preview from `constants/team.ts`; the monogram stays as the fallback for a record with no photo yet.

`N:;MOHD ALIF FARHAN;;;` — given name only, no surname field. A phone that decides "MOHD" is a surname sorts the contact wrongly and then greets them by it.

### The floating WhatsApp button is hidden on a card page

It opens the OFFICE number. On a page whose whole purpose is one person's own WhatsApp, a client taps the green circle believing they are messaging the person whose card they were handed. One number per page.

### Guard #19 `business-cards` (84 checks, nine ways negative-tested)

The slugs sit at the ROOT of the site, one level from `/about`. Adding `app/izz/` later would shadow a card that is already printed and nothing would fail — the wrong page would simply start rendering. So the guard checks every slug and alias against the real `app/` directory, the real `public/` directory and a reserved list, and fails the **build**. It also:

- rebuilds each `.vcf` from `constants/team.ts` and compares byte-for-byte (`node tests/business-cards.mjs --write` regenerates them) — a stale number in a saved contact is worse than no card, because the client believes they have the right one;
- checks the **printed** number against the **dialled** one (`012-2461823` vs `+60122461823`) — a typo in either is invisible on screen;
- pins `*.vcf text eol=crlf` in `.gitattributes` and asserts it. vCard is a CRLF format, and `* text=auto` would have rewritten all three to LF on the Linux build container **after** this guard approved them on Windows;
- asserts the aliases are 302, the sitemap lists the cards, and `_headers` serves `.vcf` as `text/vcard` (as octet-stream some phones save a file instead of offering to add the contact).

### Still to do

The printed QR still opens a WhatsApp chat. Pointed at the card URL instead, one scan hands over the number, both emails, the address, the vCard **and** WhatsApp. That is artwork, so it lands at the next print run — `public/cards/<slug>-qr.png` is 900 px and ready for it. Cloudflare Web Analytics needs only a token in `SITE_CONFIG.cfAnalyticsToken`; the CSP already allows the beacon.

## [1.70.3] — 2026-08-29 — the totals come back, and every variant gets a label

The id fix landed: the panel now reads **BAWAL COTTON VOILE** and **ELFIA Shawl Chiffon Premium (170cm × 65cm)** where nineteen digits used to be, and the diagnostic confirms *"17 products, 4 variants from catalogue"*. Two things were still wrong.

### The top-line numbers had gone

GMV, Orders, Units and Buyers all showed **—** with *"TikTok: Internal error. Retry later."* An hour earlier they had shown RM 64.50 and 3 orders. Nothing about the shop had changed.

`36009003` is TikTok's transient error and **their own message says "Retry later"**. My notes have recorded since round three that this code comes and goes — `granularity=1D` refused one afternoon and answered the next with no code change. I wrote that down and never acted on it, so the panel refused on the first answer and a shop with real sales got four dashes and nothing to do about it.

**One retry now, after a pause.** Not three: if their aggregation really is down, hammering it helps nobody and the panel is honest about a refusal. The pause matters — an immediate retry lands inside the same failing moment. The message says so too: *"Asked twice. The other figures on this card are unaffected."*

### Two variants still showed an id

Because a product with **one unnamed SKU has no variant identity** — no colour, no size, no seller code. TikTok sends that SKU with an empty `sales_attributes`, the old rule stored nothing at all, and the Variants tab fell back to printing the id.

The product's own title is the truthful label there. It repeats what the Product column says, which is exactly right when the variant *is* the product, and is better than a number in every case. Where a seller code exists it still wins — that is why **ELFIA001** and **ELFIA002** already read correctly.

### Both guarded

Guard #18 now also asserts the retry exists, pauses, and stops at two attempts, and that the SKU label falls back to the title. Removing either fails it.

## [1.70.2] — 2026-08-29 — every TikTok id was being silently rounded

**CEO: "I want product name instead of product SKU!"** — with a screenshot of **BAWAL LUMI AURORA · Live** in Seller Center, sitting there perfectly alive, while the panel called it deleted.

He was right, and my previous explanation was wrong. Here is what was actually happening.

### The bug

TikTok ids are **19-digit snowflakes**. `Number.MAX_SAFE_INTEGER` is **16 digits**. The analytics endpoints return ids as JSON **numbers**, so `res.json()` rounded every one of them, silently and irreversibly:

```
1736703643101529119  ->  1736703643101529000
1737184156551578655  ->  1737184156551578600
```

**Every id ending in `00` on that panel was a corrupted id.** They were in plain sight in every screenshot for four days.

The catalogue returns *its* ids as **strings** — precise. So the name join was comparing a real id against a rounded one and matching nothing, however many sources it tried. The per-product lookup then asked TikTok for an id that genuinely does not exist, and TikTok answered, correctly:

> Precondition Required. This operation requires an existing product ID.

That statement is **true of the id we sent** and says nothing about the product.

### What I did with that, and why it was worse than the bug

I read that refusal as *"the product was deleted"*, wrote a confident message saying so, and shipped it. The panel then told the CEO that sixteen live products were gone from his catalogue.

The API had been answering honestly the whole time. The question was corrupted before it was ever asked, and I built an explanation on top of the corruption instead of checking the data I was reasoning about. The ids were right there.

### The fix

Responses are parsed from **text**, with any integer too long to survive quoted before `JSON.parse` sees it. Applied to **every** TikTok call, not just analytics — order and shop ids are snowflakes too and have been getting the same treatment wherever TikTok chose to send them as numbers.

**Both caches got new keys.** The name map lives six hours and the analytics payload thirty minutes, and every row in both holds rounded ids. Shipping the fix without moving the keys would have served the bug for the rest of the day.

### Guard #18 · `tiktok-id-precision`

It extracts the **shipped** parser out of the worker so the test cannot drift from the code, then runs it against the real response shapes: a bare id, two adjacent ids in an array (the lookahead case), an id TikTok already sends quoted, digits inside a sentence, a full nested response, and malformed input. It ends with a control assertion that plain `JSON.parse` really does corrupt the same value — so the test proves the disease as well as the cure.

Put `res.json()` back and it fails immediately.

### What to expect

Press **Refresh**. Product cards and Variants should show real names — *BAWAL LUMI AURORA* rather than `1737184156551578600`. Anything still unnamed is now a genuine question rather than an artefact.

## [1.70.1] — 2026-08-29 — a deleted product is not an error

**The product scope is granted** — the panel now reports *"Names did come from: catalogue, orders"*, and product and variant names resolve. That was the fix; this is the tail of it.

Four rows still showed ids, above TikTok's own words:

> product detail: **Precondition Required.** This operation requires an existing product ID. Please verify the product ID and retry.

That reads like something is broken and someone must go and check a product id. Nothing is broken and there is nothing to check. **Those products sold, and were later deleted or archived from the catalogue.** The lookup is asking for something that no longer exists, and TikTok is answering correctly.

### The catalogue list does not include the archive

An empty search body is TikTok's *"everything I would normally show a seller"* — which excludes deleted and deactivated products. A shawl that sold last week and was archived on Monday is therefore absent from the list while still appearing in last week's analytics. That is the whole of it.

There is now a second sweep for `SELLER_DEACTIVATED`, `PLATFORM_DEACTIVATED`, `FREEZE` and `DELETED`, so an archived product still gets its real name. It runs **only when something is still unnamed** and stops as soon as everything resolves, so a shop with an intact catalogue pays nothing for it.

### And when a product really is gone, the panel says so

> 4 rows are products that are no longer in your TikTok catalogue — they sold, then were deleted or archived, so only their id remains. **Nothing to fix.**

TikTok's raw refusal is no longer quoted for this case, because "Precondition Required" is an answer to a question, not a failure to answer it. A real refusal — a scope problem, a network failure — still comes through in their words.

### A crash this would have caused on deploy

The name map is cached for six hours in `system_meta`, so **a map written by an earlier build is read by a newer one**. Adding a field to it and then reading `.length` off it would have returned a 500 on the first request after every such deploy, until the cache expired.

The cached map is now normalised on the way in rather than trusted. Guarded, because the cache outlives the code that wrote it and this will not be the last field added to it.

## [1.70.0] — 2026-08-29 — one width, and a warning that fits

### One standard width for the whole portal

**CEO: "make the width globally standardize instead of inconsistent!"**

The portal shell carried `md:max-w-none` — **no maximum width on desktop at all**. Every screen was as wide as the window happened to be, so on a wide monitor a paragraph in one card ran to two hundred characters while the card beside it held a table pinned to 760px. Nothing on the page shared a measure.

`PORTAL_WIDTH` now lives in `lib/ui-styles.ts` beside `card`, and the shell uses it: **`mx-auto max-w-[1600px]`**. The number comes from the widest thing the portal actually draws — the seven-column roster grid and the payroll tables — plus room to breathe. Narrower and those scroll on a screen with space to spare.

It goes on the **outer container of a screen, never on a card**. Cards are meant to fill their column; capping them one at a time is how the inconsistency started.

### The analytics warning was a wall

The scope message I wrote yesterday was correct and three times too long. At the top of a card it read as a paragraph to skip rather than an instruction to follow, and **a warning nobody finishes reading is a warning that does not work.** It is now two lines:

> 15 rows show a TikTok id: this app has no PRODUCT scope, so the catalogue cannot be read.
> Fix: Partner Center → your app → add the product scope → re-authorize the shop → Refresh.

The id comparison — *orders carry sku 1736…, this page wants sku 1737…* — moved into the diagnostic panel with the build number and the source counts. It is diagnosis, not instruction, and it does not belong above the numbers somebody is reading to price a shawl.

### "Buyers 0" was the same bug, one tile smaller

The shop tiles showed **Buyers 0** beside **3 orders**. TikTok had not sent that field at all; the panel was inventing a number for something that never arrived — the same sin as drawing zeros for a refused section, at tile scale.

The payload now says which of the four TikTok actually sent, and a field that did not arrive shows **—**. An older worker that sends no such flag is treated as having sent everything, so a split deploy shows the figures it always did rather than four dashes.

## [1.69.2] — 2026-08-29 — the roster says who, in full

**CEO: "roster I want the table get full name include the PDF."**

Both the on-screen staff column and the printed one cut every name to its first two words. **NUR NASUHA BINTI ZAINAL ABIDIN** appeared as *NUR NASUHA*.

On a sheet that goes out to the whole floor, half a name is a guess about who is meant — and two people here can share their first two words. The screen at least offered the rest on hover; paper offers nothing.

### On screen

The whole name, wrapping over as many lines as it needs rather than truncating. The row grows with it.

### In print

Harder, because a PDF has no reflow. Three changes together:

**The staff column went from 118pt to 150pt.** That costs each day column about five points, which the chips do not notice.

**The name wraps** instead of being cut, and the totals sit under wherever it ends rather than at a fixed offset.

**The row grows to fit the longer of its name and its busiest cell.** Sizing on chips alone would print a two-line name straight over the border of the row below it — the kind of fault that only shows up on the one staff member with the longest name, which is to say after the sheet has already been shared.

The line count is *measured* with the same greedy rule the canvas uses, not estimated: `Canvas.wrap` reports its height only after drawing, and the row has to be sized before.

### Verified by rendering four real names

The guard checks the wiring; the render checks the result. A harness builds the sheet with the actual names from the floor — including *NURFARAH SUAIDAH BINTI MOHD SAIFUDDIN* at 37 characters — then pulls every text literal out of the PDF operator stream and asserts **every word of every name is printed somewhere**, whether or not that name needed wrapping. That check holds however the wrapping falls, which a substring match on the whole name would not:

```
"NUR NASUHA BINTI ZAINAL ABIDIN"
"NURFARAH SUAIDAH BINTI MOHD"
"SAIFUDDIN"
"ZOLKEFLI BIN SAHDI"
"NUR DINI FARHANA BINTI NAZARUDIN"
```

Negative-tested three ways: restore the two-word cut in print, size the row on chips alone, or truncate on screen — each fails.

### Where short names stay

The task chips, the Unscheduled work rail and the mobile agenda keep the two-word form: a chip is ninety points wide and a full name there would push out the time. Each carries the full name in its tooltip. The block detail bar, which has the width, now shows it in full.

## [1.69.1] — 2026-08-28 — the shared plan is the whole week

**CEO: "on the PDF, only appear Live instead of the task also!!!"**

The board grew a second kind of block in v1.66.0. `lib/roster-pdf.ts` did not, and nothing connected the two — so the printed sheet still showed three of eight staff and told the marketing team, on paper, that they had nothing booked.

That is the exact fault the roster had on screen before Track R, still being handed round as a PDF. **A shared plan that contradicts the board is worse than no shared plan**, because it is the version that leaves the building.

### What the sheet shows now

Task chips in violet, drawn under each person's live sessions in the same order the screen uses, so the paper and the board read alike. Done days print green with an `OK` mark, conflicts amber, urgent work flagged `!`. The legend gains **Task**.

Totals count both kinds everywhere they appear — the week header, each day column, and each person's row. A printed total that counts only live sessions understates the week exactly as the screen's did before v1.66.0. An empty row now reads **"nothing booked"** rather than "no sessions", because a person with four tasks and no live had been told they had nothing.

Row heights grow with the busiest cell counting both, so a day with two lives and two tasks is not clipped.

### Two details that only matter later

**The new arguments are optional and last**, so any caller still on the old signature prints exactly the sheet it printed yesterday rather than failing.

**A block's overnight end is handled in print**, the same way sessions were fixed in v1.22.8 — a 20:00–00:30 shift is four and a half hours, not minus nineteen.

### Verified by rendering, not by reading

The guard checks the wiring, but the wiring was never the doubt — the doubt was whether the chips would actually be drawn. A harness builds a real roster PDF from live sessions plus three task blocks (one done, one urgent, one in conflict) and asserts the output contains them, the mixed totals, and the "nothing booked" row. **118 draw ops, both kinds present.** Negative-tested three ways, including the original bug: stop passing blocks from the board and it fails.

## [1.69.0] — 2026-08-28 — update the task, from the board

**CEO: "I want to have an option for me to update the Task."**

Tapping a block offered *Done today · Unschedule · Close*. Tick it, or throw the day away — nothing in between. A wrong deadline or a typo in a title meant deleting the task and building it again, losing its scope, its comments and its history. That is not editing, that is retyping.

### `PATCH /tasks/:id` was status-only

It could move a task between open, in-progress and completed, and touch nothing else. It now takes **title, description, priority, deadline and assignee** as well.

Three details that decide whether an edit route is safe:

**An empty deadline clears it** rather than erroring. A task with no due date is a normal thing; a task stuck with the *wrong* due date is what fires a false overdue alert every morning until somebody mutes the bell — and a muted bell takes the real alerts with it.

**Reassigning is management-only**, the same rule the roster already applies to moving a block onto another person's day.

**Reassigning moves the scheduled days with it.** Leaving the blocks behind would show two people booked for one piece of work — the board would be lying about who is busy, which is the one thing it exists to answer.

### One dialog, two halves

**Update task** edits the work and the day it happens together, because from the board those are one question: *what is this, and when.* The task's title, priority, status, due date and owner sit above; this day's date and hours sit below.

**"Use these hours on every day of this task."** Getting the hours wrong on a six-day duty was six corrections, and the sixth is the one that gets forgotten. The date deliberately still moves one day only — pushing a single date across a run would collapse six days onto it.

**It sends only what changed.** Posting the whole form back would let a dialog opened five minutes ago overwrite a time somebody else has since fixed — the classic last-write-wins bug on a screen two people share. Change nothing and it says so instead of pretending to save.

The dialog also shows where the run stands (*"5 days scheduled, 2 done"*) and warns before saving if the day you have chosen falls after the due date.

## [1.68.1] — 2026-08-28 — the roster rings the bell

**CEO, after booking a six-day run for himself: "there is no alert notification appear after task assigned."**

Correct, and for two separate reasons. One was a rule applied in the wrong place; the other was a missing feature that mattered more.

### Scheduling yourself was silent

The rule was *"tell them unless it is you"* — right for a plain task, wrong for a booking. Nobody needs a bell saying what they did a second ago. But everybody needs a record that the diary now holds six days of work, and the bell is where this portal keeps records you can scroll back to.

So a **schedule** always notifies, including your own: *"🗓️ Scheduled — yours: Operation — 01-09-2026 10:00-21:00 (6 days, to 06-09-2026)."*

An unscheduled task you made for yourself is still silent. You are looking at it.

### Nothing told you when the day arrived

This is the half that matters. A roster earns its keep by telling somebody what today holds. Booking six days in September and hearing nothing on any of those mornings is a diary only its author ever reads.

**At 09:00 MYT, everyone with work booked for today gets one message:** *"🗓️ Today: 10:00-21:00 Operation. Tick each one off on the roster as it is done."*

Three decisions in that one line:

**09:00, not the 30-minute pass.** The half-hourly cron would first notice "today" at about ten past midnight, and a list of the day's work delivered at 00:10 is worse than no list at all. It rides the daily block that already sends birthdays, which fires when somebody can act on it.

**One message per person, not one per block.** Three chips on a Wednesday is one working day. Three bells for it is how a bell gets muted, and a muted bell takes the overdue and unacknowledged alerts down with it.

**A day already ticked off is not announced**, and the dedupe row is written *after* the person has been told — so a failure means they hear it on the next pass rather than being silently skipped.

### And the mistake I keep making

The first version of the guard for this checked that the word `byUser` appeared in the file. It passed while the notification sat outside the grouping loop, firing once per block.

That is the third time today a check asserted an **identifier exists** rather than a **behaviour holds** — the same fault as checking `durOfB` was present while the totals ignored it. All three now assert the actual shape: the notify call inside the per-person loop, the reduce inside the total, the discount inside the flash sale.

## [1.68.0] — 2026-08-28 — the ELFIA store panel: a filter that filters, and a flash sale you can price

**CEO: "when I choose Bawal, it doesnt only show Bawal then how to update the flash sales price? seem it is wrong flow."**

Two complaints, both correct, and the second one is a design fault rather than a missing feature.

### "Bawal" selected without showing

Those links **selected** a collection and left all 22 products on screen. Ticking ten things you cannot see is not a workflow — you pick a collection precisely so you can *check what you are about to reprice* before you reprice it.

Collection is now a **filter**. Two rows, two words, one job each:

- **Show:** `All (22)` · `bawal (10)` · `shawl (12)` — chips that change the list
- **Select:** *all bawal (10)* · *published only (8)* · *clear selection* — an action on what is showing

Changing the filter clears the selection. A tick you can no longer see is a tick you will forget you made, and the next **Apply** would have repriced it.

And a filter that hides everything now says so, with a way back. A collection can be renamed on one product while its chip is still selected; an empty list with no explanation costs somebody an afternoon.

### "How to update the flash sales price?"

You couldn't, and that was the fault. A flash sale is **a price and a deadline**. The panel asked for the price in one row of the bar, the deadline in another, and the flash row refused anything that had not already been discounted somewhere else — a form explaining itself instead of doing the job.

The flash row now takes its own price: **`% off` / `RM off` · value · ends · Start flash sale**. One action, one click.

Leaving the price blank keeps the old behaviour — put a deadline on the discount those products already carry — which is still the right answer for items already marked down.

Server-side the discount is applied **first**, using exactly the arithmetic `/elfia/bulk-discount` uses (the item's own web price, falling back to list price), so the two paths can never drift into pricing the same product differently. Anything it cannot apply to is still named per SKU rather than skipped quietly, and the refusal message stopped being a dead end: *"no discount set — set the flash price here, or give it a discount first."*

## [1.67.0] — 2026-08-28 — a duty that repeats, and a day you can tick

**CEO, assigning a standing operations duty across a week: "how to assigned like pick by date and update by daily?"**

Two things were missing, and only one of them was obvious.

### The obvious one: the form built one block

A duty running Monday to Friday had to be entered five times. **Repeat** now sits in the assign form in exactly the words the live-session dialog has used since v1.22.1 — *One-off · Every day · Pick days*, with an **until** date — because a standing duty is the normal case for a task, not the exception.

The preview prints **the dates the rule lands on**, never the search window. A previous version of the live dialog printed "until the 25th" for a rule that stopped on the 19th and the CEO caught it; that mistake is not worth making twice.

The whole run posts in one request, so it either lands or is refused as a whole rather than half-appearing. Capped at 62 days, like the live planner — a rule that expands to a year is a mistake being made quickly.

### The one that mattered: "done" is a fact about a day

A task carries **one** status and **one** set of tick-boxes. For a standing duty that is the wrong shape entirely. Ticking *"monitor overall operation"* once says nothing about whether it happened on Wednesday, and no amount of repeating the schedule fixes that — five blocks pointing at one status still only records one answer.

So `task_blocks` gained `done_at` (migration 0096), and the division is:

> **The scope describes what a good day looks like. The block records that the day happened.**

Each day gets its own tick. A done block goes green, struck through, and out of the conflict list — a finished Monday flagged against Monday's live session on Friday is noise, and noise is how a conflict list gets ignored. The detail bar shows the run: **"3/5 days done"**.

Un-ticking is supported, because a day marked done by mistake has to be correctable without deleting the block and losing the schedule.

### What it deliberately does not do

**Marking a day done does not close the task.** A task is finished when its days are done *and* its scope is ticked, and that is a judgement a person makes on the Tasks tab — not something a checkbox on a calendar should decide for them. Guard #17 asserts this, because the shortcut is tempting and silently wrong.

The alternative design — one task per day — was rejected: it turns a monthly duty into twenty rows in the Tasks tab and scatters one shared scope across all of them.

### And a lesson I had to learn twice in one afternoon

Guard #16 asserted `LATEST_MIGRATION` was 0094; migration 0095 broke it the next day, and I fixed it. Guard #17, written hours later, asserted `LATEST_MIGRATION` was 0095 — and 0096 broke it within the hour.

Both now check that a migration is **registered and probed**, which stays true forever, rather than **latest**, which is true for exactly one release. A guard that fails on somebody else's unrelated work is a guard people learn to skip, and a skipped guard protects nothing.

## [1.66.0] — 2026-08-28 — Track R: the roster holds the whole week

**CEO: "for schedule roster, I dont want only to use for live, I also want to use for Task schedule and also assignment Task."**

The board planned live sessions and nothing else, so it showed three of eight staff and implied the marketing team did nothing all week. That was never true — their work simply lived on another screen.

### Overlay, not merge — and the reason is money

The obvious build is one `assignments` table holding both kinds of block. It would have been a real bug, not just a big refactor:

> The sales leaderboard credits TikTok GMV to whoever was **in a live session at the time**. A task stored as a `live_sessions` row means somebody doing paperwork on Tuesday afternoon earns commission on the shop's sales for that hour. The money goes wrong quietly, and the first symptom is an argument about a payslip.

So `live_sessions` is untouched. Tasks got their own table, and the roster became a view over two sources that the board draws in two colours and never confuses.

**Guard #17 `roster-tasks` is the tripwire on that decision.** It reads `attributedSalesByUser` by brace balance — so it cannot be defeated by the function growing — and fails if a task block can ever reach the query that pays commission. Twenty-six checks, negative-tested four ways: leaking `task_blocks` into attribution, downgrading the live-overlap conflict, dropping the permission check, and dropping task hours from the totals each fail it.

### `task_blocks` (migration 0095) — a side table, deliberately

Not three columns on `tasks`. A task is often *two* blocks — three hours Tuesday, two hours Thursday — and one date field can never say that. It also means dragging a block writes here rather than to a hot `tasks` row carrying scope, status and assignment, and unscheduling deletes a row instead of nulling fields on a live record.

### What the board does now

**Both kinds of block, and totals that count both.** Per-person now reads "6 live · 4 tasks · 92 hrs" — committed hours that ignore tasks cannot answer *is this person overloaded*, which is the only question those hours were ever for. Day columns, the week header and the mobile agenda all count both; a phone showing half the day's work would be worse than showing none of it.

**An Unscheduled work rail.** Open tasks with no block this week, due this week or already late. Tap the task, tap the day. **Not HTML5 drag-and-drop:** this board is used on a phone as much as a laptop, and dragging on a touch screen fights the page scroll. The rail is not manager-gated — a staff member planning their own week is exactly who it is for, and they see only their own.

**`+ New assignment` asks which.** Task opens a form that creates the task *and* its first block in one action, because two actions is how a task ends up assigned and never scheduled. The assignee is notified with a time: "Wednesday 10:00–12:00" is a different instruction from "due Wednesday". The date is optional — leave it blank and it behaves exactly like the Tasks tab and waits in the rail.

### The conflict the board made visible

Three new checks, one of which is the point of the whole exercise:

- **A task scheduled after its own deadline.** Invisible on a task list, invisible on a calendar of one, and obvious the moment due dates and working days share a screen. The assign form catches it before the save; the board flags it after.
- **Work booked on approved leave** — red. The person is not there.
- **A task under a live session** — **amber, not red** (OD-26). A live session is fixed to the hour it was sold at; the task is what moves. Colouring it the same red as two clashing lives would be crying wolf.

### Permissions (OD-25)

These follow the **task** rule, not the live rule. Live scheduling is management-only because a live session commits the storefront; planning your own week is not that. Staff schedule their own tasks on their own row; `team_manage` schedules anyone; moving work onto *another* person is management-only either way. Applying the live rule here would have taken self-planning away from the marketing team — consistency that cost a capability.

### A guard that would have aged badly

Guard #16, written yesterday, asserted `LATEST_MIGRATION` was `0094`. Migration 0095 broke it the next day. **A guard that fails on somebody else's unrelated work is a guard people learn to skip**, so it now checks 0094 is *registered and probed* — which stays true forever — rather than *latest*.

`IMPLEMENTATION-PLAN.md` §12's migration reservations were stale for the same reason: ranges reserved per track go wrong the first time two tracks ship out of order. They are now a record of what is actually on disk, with the rule changed to "take the next free number, then record it".

## [1.65.0] — 2026-08-28 — live cards: the portal stops going stale

**CEO: "for any updates that I do in my system, it will auto update the card so that I won't require to refresh it."**

### The audit first

The portal was not starting from nothing. Three things already existed and shaped the answer:

- **A working SSE stream.** `/staff/notifications/stream` holds a connection for ~20 seconds, polls D1 every 5, self-closes, and lets the browser reconnect. A 120-second poll sits behind it as a safety net. This has been carrying notifications since v1.6.0 and it works.
- **One dispatch point for every staff write.** All ~300 staff routes pass through a single `handleStaff` call in `index.ts`.
- **One hand-built precursor.** The ops map already listened for an `azone:tiktok-synced` custom event so it would redraw after a sync — the right instinct, solved once, for one card.

Those three facts decided the design. There was no need for a new transport, and no need to touch three hundred route handlers.

### What was rejected, and why

**WebSockets / Durable Objects.** The "proper" real-time answer, and the wrong one here: a new billable primitive and a new failure mode, to replace a stream that already works.

**Pushing the changed data.** Tempting and dangerous. Every pushed row has to be authorised per recipient, per card, per role, forever — and the cost of getting that wrong is showing the wrong person real numbers. Rejected on that alone.

**Polling every card on a timer.** Ten cards × a poll each is ten requests to learn that nothing happened.

### What it does instead

**One integer per topic.** The server keeps a counter — `tasks`, `leave`, `orders`, `elfia` — and adds one when a write on that topic succeeds. The counters ride the stream that was already open. A card names the topics it cares about; when one moves, the card refetches **through its own normal endpoint**.

So a version bump can leak exactly one bit: *something in this topic moved*. The data still comes back through the door that already knows who is asking.

And because the counters only ever increase, a late frame from a dying connection cannot be applied backwards. There is no ordering problem to get wrong.

**The bump lives at the dispatch point, not in the routes.** One call site, in `index.ts`, after `handleStaff` returns. Put it in each handler and every future route opts out of live updates by forgetting a line; here, a new route is live the day it is written. Only 2xx non-GET responses count — a rejected save changed nothing, and telling every open tab to reload after a 403 is a lie plus a stampede.

**Making a card live is two lines:**

```tsx
useEffect(() => { void load(); }, [load]);
useLiveRefresh(["tasks"], load);
```

Live in this release: the dashboard, leave (both cards), tasks, announcements, sales, users, the sales leaderboard, targets & commission, and the operations map.

### The three details that decide whether it is pleasant or awful

**The first observation is a baseline, never a reload.** The card has just fetched for itself; reloading because it saw a number for the first time would double every card's traffic on every page load.

**A hidden tab neither refetches nor consumes the change.** The version is left unread, so the card is still owed its reload when the tab comes back. A phone in a pocket costs nothing and is still correct when it is taken out.

**Bursts are coalesced.** One bulk action bumps a topic that three open cards watch; a 250ms window turns a flurry into one round.

**Coming back to the foreground** asks for the version map once over plain HTTP and then pokes the store. That path also covers a proxy that blocks SSE entirely — the portal stays correct the moment somebody looks at it, even if every stream in the building failed.

Only *changed* topics go on the wire, with the last snapshot held in the stream's closure. A quiet shop sends one query and zero bytes per tick.

### A new guard, because I made this mistake twice in one sitting

A topic is a route's first path segment. Watch `commission-rules` when the route is `/commission`, or `documents` when it is `/docs`, and the card silently never updates — nothing throws, nothing logs, no test fails. The feature just quietly is not there, which is the worst kind of broken.

I got two of eleven wrong on the first pass. **`tests/live-topics.mjs` (guard #16)** reads the real route table out of `staff.ts` and checks every watched topic against it, plus the bump call site, the success gate, the never-throw contracts, the changed-only stream, and the three client rules above. Negative-tested three ways: reintroducing the wrong topic name, removing the bump, and bumping on failed writes each fail it.

### Migration 0094 · `data_versions`

One row per topic. Deliberately **not** per user: it says what changed, never who may see it.

Pre-0094 databases degrade to exactly the old behaviour rather than erroring — `readVersions` catching a missing table means "nothing ever changes", which is what the portal did yesterday.

## [1.64.5] — 2026-08-28 — the name error becomes an instruction

The diagnostic in 1.64.4 worked. TikTok's answer, in their words:

> **Access denied.** This app has not been granted any access scope required by this endpoint. Add a required scope to the app, reauthorize it, and retry with a new access token.

So: **the app has no product scope.** The catalogue and the per-product detail calls are both shut, which is why two rounds of joining names on were never going to work no matter how they were written. The orders fallback answered, which is why the panel could still say something.

### The fix is one setting, and the panel now says so

That reply was correct and completely unactionable where it appeared — the same 300-character scope paragraph printed twice, ending in a shortlink, sitting above a table of numbers. Nobody reads that and knows what to do next.

It now reads:

> 15 rows show a TikTok id because this app has not been granted the PRODUCT scope, so the catalogue cannot be read. To fix it: TikTok Partner Center → your app → add the product scope, then re-authorize the shop and press Refresh. Until then, names can only come from recent orders, which covers what has sold and nothing else.

Identical replies from two endpoints are collapsed into one fact rather than repeated.

### And the remaining puzzle is now printed rather than guessed

Orders *did* answer and the rows are *still* unnamed, which means either the ids differ or the sale is older than the harvest. Rather than theorise about it a third time, the warning now prints one id from each side:

> Orders answered but did not cover these rows — they carry sku 1736…, while this page wants sku 1737….

Two ids side by side settle in a glance what three paragraphs of reasoning could not.

The order harvest also goes six pages deep instead of four, matching the order sync's own depth — stopping at 200 orders quietly lost the oldest of them.

## [1.64.4] — 2026-08-28 — the names, properly this time, and a way to tell whether a fix is live

**CEO: "I still can't get the actual product name or variant!"**

v1.64.2 claimed to fix this and did not. Worse, it said nothing while failing — the amber block showed only the shop-totals error, so the panel looked like it had nothing to report about the names at all.

### The bug in the fix

The name map tried the catalogue, then orders, and **stopped at the first source that returned anything at all**. One name from either source counted as success. And the "could not name these" warning only fired when the map came back completely empty — so a map holding a handful of names for products that were not on screen counted as working, and the panel went quiet.

That is the one outcome this panel is not allowed to produce. A wrong answer is bad; a silent one is worse, because there is nothing to argue with.

### What replaces it

**Rows are built first, without names, so the map can be asked about the ids that are actually going on screen.** Fetching names before knowing what they are for is what let the old code declare victory over a map that covered none of these rows.

**Three sources, each asked only about what is still unnamed after the last:**

1. The catalogue list (`POST /product/202309/products/search`)
2. **Per-product detail** (`GET /product/202309/products/{id}`) for whatever the list missed — a handful of calls, capped at fifteen, never a scan
3. Recent orders, which need no product scope at all and carry `product_name` and `sku_name` on every line item

**The warning is now decided by coverage of what is on screen**, not by whether the map is empty: *"9 rows could not be named, so they show their TikTok id. Names did come from: orders. TikTok said — catalogue list: [their message]."* TikTok's own words from each source are carried through, because "it did not work" is not a diagnosis.

The cache still runs six hours, but a cached map that does not cover the ids in front of us is refreshed rather than trusted.

### Both name sources are now in the probe

Round 6. The catalogue search and the order search are asked in the open, alongside the analytics endpoints, so whichever one this authorisation actually opens can be seen rather than inferred. This is the same method that settled the per-endpoint versions in rounds 1–3, and it should have been applied to the names from the start instead of guessing twice.

### The API build number is on the panel

Folded into the diagnostic: **"API build 1.64.4 · names: 34 products, 112 variants from catalogue"**.

This is not decoration. The `azoneofficial-api` deploy connection has been broken before and the live API sat on an old version for weeks. "Is the fix live?" and "did the fix work?" are different questions that have been answered as one for two releases running. Now the panel answers the first one itself.

## [1.64.3] — 2026-08-28 — the Ecommerce tab, five cards lighter

**CEO: "Sales leaderboard can you clipped inside the Operations map — orders by state so that I can minimalise the space? Sales history — month by month, Business lines — product vs service should combine into 1 card of Targets & commission."**

Five cards became two. Roughly eight hundred pixels of scrolling went with them, and nothing was removed.

### The leaderboard moved into the map

The map's side column was carrying two stat tiles, five state rows and a hint line — and then a third of its height in white space. The leaderboard now sits in it.

It is not the same board squeezed narrower. At 240px the progress bar and the four-paragraph attribution note are not readable, so they go: **first names** instead of full names (the full name, role and figure are in the row tooltip), the podium badge shrinks, and the attribution note moves to the section's own tooltip — one hover away rather than gone. Commission, for those allowed to see it, rides beside the name as a small `+RM`.

The wide board is still in the code and still the default. `compact` is a mode, not a replacement.

### Targets, history and business lines are one card with three tabs

They all answer the same question — how is the money doing, and who gets paid for it — so they are one card now, with three headers, three borders and three sets of padding removed.

Two decisions worth recording:

**All three tabs stay mounted, hidden with CSS rather than unmounted.** Unmounting on a tab click would refetch on every switch and, worse, throw away a half-typed target. The card issues the same three requests it always did, once, on load.

**The Targets tab is gated; the card is not.** Targets & commission was `TARGET_ADMIN_ROLES`, while sales history and business lines were the wider `REVENUE_ROLES`. Folding them into an admin-only card would have quietly taken two reports away from everyone who could see them yesterday — an invisible permissions change, made by accident, while tidying up. So the card is shown to revenue roles and only the Targets tab is admin-only.

### And a smaller one

An empty section inside a tab now **says** it is empty. Standalone, both cards still vanish when there is no data, which is right for a card — but a tab that opens onto nothing reads as a bug.

## [1.64.2] — 2026-08-28 — the analytics rows learn their own names

**CEO: "I want to know product and variant with correct details instead of number which I don't know."**

Fair. The Variants tab was a column of nineteen-digit ids — correct, verifiable, and no use whatsoever for deciding what to reorder.

### Why the names were missing

**None of TikTok's analytics endpoints return a product or variant name.** `shop_products/performance` returns `id, gmv, orders, units_sold, click_through_rate` and nothing else; `shop_skus/performance` adds `product_id` and stops there. v1.64.1's attempt to find them by asking for a newer endpoint version was the wrong tree — the names are not in that response at any version, because analytics and catalogue are different APIs.

### Where they come from now

A **name map**, fetched separately and joined on, cached six hours of its own — a catalogue changes on the day someone edits it, not on the half hour, and this must not become the slow part of a panel.

Two sources, in order:

1. **The catalogue** (`/product/202309/products/search`) — every product with its title, every SKU with the sales attributes that make up its variant name. Complete, including items that have never sold. The body sent is empty rather than status-filtered, because a wrong guess at their status enum fails the whole call.
2. **Recent orders**, if that scope is not granted. Every line item carries `product_name` and `sku_name`. This is weaker in theory and near-equivalent in practice: an analytics row only exists because it *sold*, so an order carries its name.

If neither answers, the rows still show ids and the panel **says so** in the amber block rather than showing blanks.

### What the tables show

A variant row needs both names to mean anything — "Mocha" alone says nothing, and the product title alone doesn't say which size went. So the **Variants** tab now reads the variant in the first column and its parent product in the last, and the **Product cards** tab reads the product title.

**The id stays**, small and monospaced under the name. It's what Seller Center searches on, and it's the only handle left if a name never comes through. Removing it would have made the table prettier and harder to act on.

### Also

The Refresh button now busts the name cache too, so a product renamed in Seller Center can be pulled straight through instead of waiting six hours.

## [1.64.1] — 2026-08-28 — the analytics panel, made honest and made to answer

The panel shipped an hour earlier had four faults, and the first one is the one that mattered.

### It drew zeros for a section TikTok had refused

Shop totals and the daily breakdown came back `36009003`, the amber banner said so — and the four tiles underneath still read **RM 0.00 / 0 / 0 / 0**. That is exactly the thing the panel promised not to do. A zero is a claim about the business: it says nobody bought. Anyone glancing at the tiles rather than reading the banner would have taken it as a bad week.

The payload now carries `shop_ok`, and the tiles render **—** when the figure is unknown.

They are deliberately **not** derived from the rows below. It would be easy to sum the product tab and call it GMV, and it would be wrong: product, video, LIVE and variant figures are attributed views of the *same* sales, so adding them double-counts. A confident wrong number is worse than a dash.

### Why the shop totals were refused at all

Not a permissions problem and not TikTok being flaky. The probe — which has worked since round three — asks for `end_date_lt = today`. The panel asked for **tomorrow**, to include the current day's sales. The four list endpoints allowed it; `shop/performance` did not, and said `36009003 "Internal error"`, which is the same code TikTok returns for a rejected parameter as for a genuine fault. That ambiguity has now cost three rounds and is written down.

The totals now ask for the window that has always worked and *then* reach for the wider one, and the panel prints the window it actually got: **"22-08-2026 to 27-08-2026"** under the title. Up to yesterday is a labelled fact, not a silent shortfall.

The six calls also run **one after another** instead of all at once. The two that failed were the two hitting the same resource — `shop`, ALL and 1D — in the same instant. Six sequential calls cost a few seconds once every thirty minutes.

### Every product and variant row read "—"

`txt()` accepted a string and nothing else. TikTok returns product and SKU ids as **numbers**, so every id was discarded and every row lost its label. Numbers are text too now.

Names are a separate problem: `shop_products @202405` returns an id and no name at all. The panel now asks **202509 first and falls back to 202405** — if the newer version exists for this resource it carries a name, and if it does not, TikTok refuses on the version and the known-good call answers on the second try. Worst case that is one wasted call per half hour in exchange for rows you can actually read.

### Smaller things

- Rows are **sorted by GMV**, so what sold is at the top instead of buried under a screen of zero-GMV product cards.
- A **Refresh** button goes straight past the 30-minute cache, for when a number is being chased rather than glanced at.
- Two sections refused for the same reason now say it once, not twice.
- Video sales figures are read directly *and* accumulated from the nested shape, since that nesting moved between 202409 and 202509.

## [1.64.0] — 2026-08-28 — TikTok Shop Analytics, and the endpoint that was never going to answer

**CEO, on the third screenshot of the same red row: "still error."**

The Analytics card has said *"setting up"* since it was built, because nobody knew which of TikTok's analytics endpoints this shop's authorisation actually opens, or what the fields inside them are called. Three rounds of probing settled both, and this release turns the probe into the panel it was always the scaffolding for.

### What was actually wrong

**The endpoint version is per endpoint, not per API.** This is the whole story of rounds one and two. `202405` is correct for shop totals and product cards and *wrong* for SKUs, videos and LIVE, which want `202509`. Sending one version to all eight, which is what any reasonable person would do, produced `36009004 "wrong version"` on five of them and looked exactly like a permissions problem. Giving each endpoint its own version took the panel from **3 of 8 answering to 7 of 8**.

Two other facts that cost a round each and are now written down in `TT_ANALYTICS` rather than rediscovered: `currency` is effectively mandatory, and it must be `LOCAL` or `USD` — passing `MYR`, the actual currency of the actual shop, is rejected. And `36009003` is not one error but two: a missing required parameter, or TikTok's own internals failing. The message is identical either way.

### The eighth endpoint, and why it is now gone rather than red

`shop_lives/overview_performance` was asked four ways across three rounds — different versions, with and without `granularity`, with and without `account_type` — and returned `36009003 "Internal error"` every single time, while its siblings on the same authorisation, the same token and the same version answered normally. That is TikTok's side, not ours.

It has been **removed from the probe list**, which deserves a word because deleting a failing check looks like hiding a failure. It is not, for two reasons. It is redundant: `shop_lives/performance @202509` answers, and carries the same figures per LIVE session, so nothing is lost — the LIVE card now reads from there and **has real numbers for the first time**, having pointed at the dead endpoint since the day it was written. And a row that is permanently red teaches people to ignore red rows, which is the expensive kind of habit. If TikTok ever fixes it, the probe takes a manual path: `?path=…&version=202508`.

### The panel

`GET /api/v1/tiktok-analytics?days=1|7|30`, gated on `revenue_view`, six calls in parallel, cached 30 minutes — one panel should cost one round trip, not seven in a row, and not seven every time somebody switches tabs.

- **Shop totals** — GMV, orders, units sold, buyers
- **GMV by day**, summed per bucket, so a bad day cannot hide inside a good week
- **Videos / LIVE / Product cards / Variants**, each with GMV, orders and units, and a fourth column that is whatever that tab is judged on: click-through for a video or a product card, viewers for a LIVE, the parent product for a variant

The **Variants** tab is the one worth pointing at. It answers *which size and which colour actually sold*, which for a shawl business is a different question from which product sold, and the one that decides the next order.

**The rule this panel keeps: a section that did not answer is named, in TikTok's own words, and never drawn as a zero.** A zero is a claim about the business — it says nobody bought — and someone deciding what to reorder will act on it. "TikTok refused this" is the truth. They are not the same sentence and the panel does not let them look alike.

Money is converted once, at the edge: TikTok reports GMV in whole ringgit and `fmtRM` expects sen, so that multiplication lives in one function rather than in six call sites where five of them would eventually be right.

The probe is kept, folded into a `<details>` at the foot of the card. It costs nothing sitting closed, and it is how the next version change gets diagnosed instead of guessed at.

### Migrations 0091, 0092 and 0093 rewritten in plain ASCII

Not part of the analytics work, and the more useful finding of the two. `tests/migration-safety.mjs` exists because a deploy died on 25-08 at *"Database changes"* with `SQL code did not contain a statement` — the remote D1 parser choking on prose. All three pending migrations broke its rule: em dashes, curly quotes, an apostrophe inside a comment. **Every one of them would have stopped `PUSH.bat` at the same step, and 0091/0092 have been sitting there unshipped.**

The SQL is byte-for-byte unchanged in all three — only the comments were rewritten. The guard caught this before the deploy did, which is precisely the trade the guard exists to make.

The store's `0018_flash_sale.sql` had the identical fault and the identical fix; it ships as **elfia-store v1.41.0**.

## [1.63.0] — 2026-08-28 — bulk prices, and Flash Sales

**CEO: "I want to add price update in a bulk, add category for the flash sales and ELFIA should have a pill of Flash Sales to make the customer attracted."**

### Bulk web price (`/elfia/bulk-price`)

The sibling of bulk discount: that one changes what comes *off* a price, this changes the price itself. Three ways, because all three are things a shop actually does — **set to RM X** (one price across a collection), **± % ** and **± RM** (both worked out from each product's own current web price, so a range keeps its ladder instead of collapsing to one number). The direction is a dropdown, not a minus sign in the box: a stray "−" turning a price rise into a cut is not a mistake worth leaving available.

Same reporting discipline as the discount: rows it cannot apply to are **named by SKU**, never skipped quietly. And one case that needed deciding rather than ignoring — a new price can strand an existing discount (RM 5 off a product just repriced to RM 4). Rather than ship a price no customer could be charged, the discount is cleared on that item and reported. 

### Flash sales (`/elfia/flash-sale`, migration `0093_elfia_flash_sale`)

**A flash sale is deliberately not a category.** A product is a bawal or a shawl — it does not stop being one because it is on offer this weekend, and putting "flash sale" in the category column would have cost the shop its real grouping for the length of the sale and lost it afterwards. It is a **deadline on the discount the item already carries**:

| discount | deadline | what happens |
|---|---|---|
| set | none | an ordinary discount, runs until cleared — unchanged behaviour |
| set | ahead | a flash sale: the discount applies and the shop counts down to it |
| set | passed | **over** — the feed stops applying the discount, so the price reverts by itself on the very next pull |

That last row is the point of the word "flash": nobody has to remember to end it. And because the *portal* decides it rather than the store, there is one clock and one answer — the shopfront can never be selling at a price the office believes expired. A flash sale on an item with no discount is refused, because a pill that promises nothing is a lie on the shopfront.

The store's half ships as elfia-store v1.41.0: a red ⚡ Flash Sale pill with a live countdown on the card and product page, which removes itself the second the clock reaches zero rather than waiting for the next sync.

### Registry repairs found on the way

`LATEST_MIGRATION` still named `0086_totp_replay_guard` while the newest file was `0092`, and **0091/0092 were in neither `EXPECTED_MIGRATIONS` nor the health probes** — so `registry-parity` would have failed the build, and the pending-migration banner could not have named them. All three registries are correct again, and 0093 joins them.

Also: the ELFIA feed's fallback chain gained a tier. A database missing only the new `elfia_flash_until` column would have fallen all the way to the flags-and-prices feed and the shop would have lost its photos, descriptions, collections *and* discounts until someone migrated — a punishment out of all proportion to one missing field.

## [1.45.0] — 2026-08-27 — the security audit's findings, closed

**CEO: "Audit all project files thoroughly as a security-focused code reviewer … then eliminate the findings and ensure that it is working well without any error."** The audit ran read-only first (both repos, four parallel reviews, every serious finding re-verified by hand against the code). This release fixes the portal's share; the store's ships as elfia-store v1.4.0 alongside.

The theme on this side was **rules everyone believed that the code did not actually enforce.**

### Authority can no longer be minted sideways (audit A1)

An `admin` could create a `ceo`, `coo` or `cco` account, reset the sitting CEO's password and sign in as them, or offboard them. Rank made those roles look "not higher", but `ceo` alone holds `claims_decide`, `commission_decide` and `accounting_manage` — the money approvals an admin is deliberately denied. So the shortest path to approving your own claims was to issue yourself a CEO account. Every route that mints or takes over an account (create, password reset, role grant, offboard, force-logout) now consults one list, `PROTECTED_ROLES`, and those roles belong to the super admin.

### Mandatory 2FA is now actually mandatory (audit A2/A3)

The CEO's directive — 2FA for every staff role — was enforced only by the portal's own UI. The API returned `requires_2fa` and no route ever refused a request for it, so a phished password used with `curl` got a full session and everything that role could reach. **`enforce2fa` now runs before routing**, for every method: a mandatory-role staff member who has not *enabled* 2FA can reach only enrolment, identity, sign-in and logout. Separately, the "must enrol" flag keyed off `totp_secret`, so merely *starting* setup and abandoning it cleared the requirement for good while login still issued no challenge — it now keys off `totp_enabled`, the same column login checks.

### Smaller, real (audit S1/S2/S3/C5/C6/C7/C11)

- **Payroll:** `/payroll/pull-commission` — which adds commission into the salary run and marks it settled — was the one payroll write gated by a *read* permission (`payroll_export`), which admits `hr_admin` and `cco`, the two roles deliberately removed from payroll. It now uses `PAYROLL_PROC` like every sibling.
- **Task comments:** `/tasks/:id/comments` checked nothing beyond "is staff", so anyone could read or write any task's thread by walking the ids. Now scoped to assignee / creator / team manager, and an attachment must be the caller's own upload.
- **`/content` GET and POST** gained the gate their PATCH and DELETE siblings already had.
- **Login timing** (C5): an unknown email skipped hashing and answered faster, enumerating who works here. Both paths now pay the same PBKDF2 cost.
- **2FA codes are single-use** (C6, migration `0086_totp_replay_guard`): a code stayed replayable for its ~90-second window. Each user records the highest step spent; sign-in and enrolment both burn the code they accept.
- **Print flows escape what they interpolate** (C7): badges, payslips, claim forms, leave forms and statements build HTML as strings, where React's escaping never runs — a staff name containing markup was parsed as markup. New `lib/escape-html.ts` (`esc`, `safeUrl`).
- **No state-mutating GET** (C11): the backup download stamped a timestamp on a plain GET, outside CSRF, reachable by luring a super admin to a link.

### Headers (audit C1)

The portal — staff sessions, HR, payroll, the signed-document vault — was shipping **weaker** headers than the storefront: no CSP, no HSTS. Both added, each directive chosen against what the app actually loads (Cloudflare's beacon, the /contact map iframe, generated PDF blobs), plus `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and one-year HSTS.

### Keeping it fixed

New guard **`tests/authz-guard.mjs`** (15 total) turns each of the findings above into a check the build fails on: it resolves every payroll write route's gate to the **roles it actually admits** rather than the name it is spelled with, verifies the 2FA exemption list stays minimal, and refuses the old `["super_admin","admin"]` target shape. Every tripwire was deliberately broken and confirmed to fail before shipping; `next` is pinned to an exact version.

## [1.44.0] — 2026-08-24 — marketing the PDPA way, and an honest accuracy check

**CEO: "track their location accuracy … trace which customer are recorded … for marketing purposes and to ensure that all this cover by PDPA requirement." Decided (OD-24): marketing reaches ORDER customers who CONSENTED — never anonymous visitors, never per-person browsing (OD-20a stands).**

### Marketing reach (consent-gated end to end)

- The store (its v1.3.0) adds a bilingual consent tick-box at checkout and sign-up — optional, never pre-ticked, timestamped — plus a PDPA s.7 privacy notice in English and Bahasa Malaysia, and working withdrawal (account toggle for members, an admin action for guests who WhatsApp).
- Feed C now carries `marketing_consent`; migration **`0085_web_order_consent.sql`** stores it, and the upsert overwrites it on every re-send — **withdrawal on the store empties the portal list within one poll**, no human memory involved.
- New route `/staff/web-marketing` (revenue_view; every read is audit-logged): consented customers deduped by phone — name, phone, orders, spend, last order — with a context line ("31 of 220 customers have consented"). The ELFIA Traffic tab gains a **Marketing reach** card: counts by state, expandable list, one-tap copy of the phone numbers for a campaign.

### Location accuracy (the check the CEO asked for)

- New **Location accuracy** card: visit locations are network-derived (approximate); order addresses are typed by customers (exact, ground truth). The card compares the two DISTRIBUTIONS per state — bar = visit share, marker = order share — and scores their agreement, instead of pretending IP geolocation is precise. The KL/Selangor mobile-gateway skew is stated on the card itself.

### Registry discipline

- `0085` + `LATEST_MIGRATION` + `EXPECTED_MIGRATIONS` + health probe (triple bump, guard-enforced); `parseWebOrder` treats anything but a literal `1` as no consent — nobody is consented by a missing field.

## [1.43.0] — 2026-08-24 — the ELFIA Traffic map

**CEO, with the Operations map on screen: "for ELFIA, I want to have a traffic to see which user that visit my pages which is you need to create a new map like Operations map — but you need to create a new tabs for ELFIA traffic."**

A new **ELFIA Traffic** tab draws the store's visitors on the same real-geography Malaysia map as Operations — where people browse from, what they look at, and how visits turn into orders. Built with the privacy decision recorded as **OD-20a**: *"which user" is answered with WHERE and HOW MANY, never WHO.*

### What the tab shows

- **State map** — page views per state as fill intensity + count bubbles, the exact geometry the ops map uses (extracted verbatim into `lib/malaysia-map.ts`, now shared; the TikTok map's behaviour is untouched). Foreign visits sit in an "Outside Malaysia" line under the map.
- **Today / 7 days / 30 days** ranges; page views, visitors (daily uniques — the store's hash rotates its key daily, so no cross-day figure exists *by construction*), and the poller's last-pull time.
- **Tap a state** → its top cities, top pages, and a visits-vs-orders conversion line computed by running the ELFIA web orders' addresses through the shared city→state mapper — the closest honest "conversion" that exists without tracking anybody.

### How the numbers arrive (bridge feed D)

- The store (its v1.2.0) counts visits with a beacon — no cookies, no stored IPs, daily-rotating visitor hashes that never leave the store, raw hits deleted after 60 days (OD-22) — and serves per-day `(state, city, page)` aggregates at `GET /bridge/traffic`, same shared key and constant-time check as the orders feed.
- The portal's **`pollElfiaTraffic`** rides the same 5-minute cron as web orders (money first, map second; a traffic failure is logged, never belled, and can never block an order pull). Cursor discipline per PORTAL-BRIDGE-SPEC.md § D: each received day is **replaced whole** in one D1 batch, and the cursor advances only to what the store declares final — the running day keeps refreshing until it is.
- No new secret: the traffic URL is derived from `ELFIA_ORDERS_URL` (`/orders` → `/traffic`), so both feeds always point at the same store.

### Registry discipline (the part v1.40.1 made mechanical)

- Migration **`0084_elfia_traffic.sql`** (`web_traffic_daily`; zero ALTERs, replayable) + `LATEST_MIGRATION` + `EXPECTED_MIGRATIONS` + a `/system/health` probe — the triple bump, guard-enforced.
- "ELFIA Traffic" registered in `ALL_TABS`, worker `TAB_ACCESS_TABS`, the tab-access card, `nav-icons` (Map — unused on every rail), and i18n ("Trafik ELFIA") — `tests/registry-parity.mjs` fails the build if any of the five drift.
- Routes `/staff/web-traffic` + `/staff/web-traffic/detail` gated `revenue_view`, armored pre-0084 (`pending_migration` instead of a 500).

## [1.42.0] — 2026-08-23 — tasks with a scope, an acknowledgement, and an alarm clock

**CEO: "I need to make the task scope followed clearly by the staff and I want to have a proper implementation to make sure that everyone is alert on their task and the task being track properly to ensure that it is followed and monitor closely."**

Three asks, three mechanisms — each one a fact in the database, not a habit someone has to remember.

### Scope that can be followed (migration `0083_task_tracking`)

- The create form gains **"Scope — one deliverable per line"**. Each line becomes a tickable item on the task (`task_items`). A scope someone can tick is a scope someone can follow — and **progress now counts itself**: ticking items sets the task's % (done/total), replacing the hand-typed number for any task that has a scope. Who ticked what, and when, shows beside each item.
- When the LAST item is ticked, the assigner is told: *"All scope items done — review and close it."* Closing stays a human decision.

### Everyone is alert (the 30-minute cron, deduped per task per day via `task_events`)

- **Assignment** (improved): the notification now carries the deadline and the scope size, and says what to do — *"Open the Tasks tab and press Acknowledge."*
- **Acknowledgement** (new): an assigned task shows an **Acknowledge** button to its assignee. Pressing it records a timestamped "seen and understood" and tells the assigner. Until then, the assigner sees an amber **Not acknowledged** badge — and after 24 hours the cron nudges the assignee daily and tells the assigner it is still unconfirmed. A task nobody confirmed seeing is not assigned in any real sense.
- **Due soon**: the assignee is reminded the day before and the day of the deadline — before it is late, not after.
- **Overdue**: once the deadline passes unclosed, BOTH the assignee and the assigner hear it, every day until it moves. All of these ride the existing notification funnel, so they web-push to phones where staff have allowed it.

### Tracked and monitored closely

- The task list is now a monitoring surface: **overdue tasks read red** with "OVERDUE — was due …", unacknowledged assignments wear the amber badge, and every task with a scope shows its ✓ done/total chip (click it to open the checklist).
- The **company-wide card** gains two tiles that demand action: **Overdue** (red when above zero) and **Not acknowledged** (amber) — next to Open/Pending/Closed.
- Every status change writes a trail row and notifies the OTHER party — the assigner monitors without asking; the assignee is never surprised by a manager's change.

All armored on migration skew: pre-0083 the tab renders exactly as v1.41 did.

## [1.41.2] — 2026-08-23 — the total on screen is the total on the document

**CEO: "I saw total was not deduct when there is discount insert"** — two RM 11.70 lines with RM 1.70 off each showed **Total: RM 23.40**.

He caught a real and old one. Per-line discounts shipped in v1.4.243, and the Worker has subtracted them from the subtotal ever since — but the on-screen preview never did. So the document being CREATED was right (RM 20.00 here) while the number staff read before pressing the button was wrong. A preview that disagrees with the ledger is worse than no preview: it teaches staff to distrust the screen, and v1.41.0 made it bite daily by steering every price reduction into the Disc field.

The preview now mirrors `staff.ts` term for term: each line's discount capped at the line's own value, then the document discount, then tax, then delivery — which the server zeroes on a Delivery Order AND on a service document (v1.4.238), a second quiet preview drift fixed in the same pass.

**Guard extended:** `registry-parity` now trips if either side loses a term of the formula — the preview omitting line discounts (this bug), the preview losing the service-delivery exclusion, or the Worker losing the discount subtraction.

## [1.41.1] — 2026-08-23 — sales people get their whole name back

**CEO: "the name of sales person to short, I dont need their roles there. their name is require instead"**

The Sales-person dropdown showed `Nur — live host`, `Mohamad — cco`. Two problems: the role was noise he never asked for, and the first-name truncation was genuinely ambiguous — two staff named Nur were distinguishable only BY that noise. `/staff-list` has sent the full name (`full_name`, falling back to the account name) since v1.4.93; the shortening was purely client-side cosmetics. The dropdown now shows the full name, nothing else. The "— me (auto from login)" hint stays on the first row because it is function, not decoration: it tells staff the attribution is captured automatically.

## [1.41.0] — 2026-08-22 — product lines come from the catalogue

**CEO: "For the sales, I want to have a list of the product with the prices auto filled and if there is any discount staff will insert the discount amount. SKU need to be filled for the products. This is only for Product."**

### What changed

- **Product documents pick, they don't type.** On a Product QT/DO/INV, the item line is now a dropdown of Inventory items — `SKU — name — RM price`, sorted by SKU. One tap fills the name, the SKU (shown under the field), the list price, and defaults UOM to PCS. Service documents are untouched: agency work has no catalogue and stays free text. The old type-to-match datalist (which only filled the price on an exact name match, and only if the price box was empty) is gone.
- **The price box locks on a picked line.** The list price comes from Inventory; changing it happens *there*, or the reduction goes in **Disc** — per line, or the document-level discount — where it is visible on the printed document instead of hidden inside a hand-edited price.
- **The Worker decides the price, not the browser.** On create, every product line's SKU is resolved against Inventory (the bridge's matching rule — case- and whitespace-insensitive, with a fallback for stale keys) and the catalogue's name and `unit_price_cents` **overwrite** whatever the client sent; the line discount is re-capped against the authoritative price. A product line with no SKU, an unknown SKU, or a catalogue item with no price set is refused with the line named. **Edits cannot bypass it**: any product line carrying a SKU is re-resolved and re-priced on every edit, so a tampered price quietly reverts. Legacy documents (pre-v1.41 lines without SKUs) still edit freely.
- **Side benefit:** `deductForInvoice` matches lines by SKU first — now that every new product line carries one, invoice stock deduction stops depending on exact name matches.

### Proved

Typecheck, `next lint`, worker compile gate, `sql-schema-check` (677 queries, including the new resolver's both-shapes lookup) and `registry-parity` all green; full 13-guard suite run before delivery.

## [1.40.1] — 2026-08-22 — the pipeline stops trusting itself

Closes audit findings M16–M19 and B5 (release integrity). The theme: every check that could pass while proving nothing now fails instead.

- **Guard #13, `registry-parity`** — the hand-maintained lists that "standing rules" in comments were supposed to keep in sync are now build-enforced: `ALL_TABS` ↔ the tab-access whitelist ↔ the override card ↔ the icon map ↔ the i18n dictionary; `worker/migrations/` ↔ `EXPECTED_MIGRATIONS` ↔ `LATEST_MIGRATION` ↔ the health-probe set; wrangler crons ↔ `scheduled()` branches; the 0082 data-fix's remark literal ↔ what erp.ts actually writes; DEPLOY.bat's gate ↔ package.json. Its first run caught its own draft passing vacuously on DEPLOY.bat (batch files escape quotes — the regex matched nothing and `every([])` is true), which is the point of the whole exercise.
- **The health-probe set knows 0075–0081** (M16) — before this, `/system/health` reported zero pending migrations on a database missing all of them and the ⛔ banner stayed dark.
- **`bm-coverage` derives its tab walk from `ALL_TABS` + the dictionary** (M17) instead of a hardcoded 23-item list that silently skipped the 24th tab while printing "every tab renders fully in BM". A tab without a BM dictionary entry now fails before the browser even launches.
- **`deploy-api.sh` asserts instead of hoping** (M18, B5): the schema guard runs on the API build itself (the build that applies migrations — previously only the *website* build checked schema agreement); after publish it polls `/api/v1/health` until the live worker reports THIS build's version, and fails the build if it never does — the exact blindness that left production on 1.32.1 while everyone believed main was live. And a non-production branch now deploys **nothing** (the old else-branch skipped migrations but still published code — the audit's worst deploy state).
- **`DEPLOY.bat` gates on the package NAME, not a version** (B5) — the hardcoded `1.34.0` pin meant the emergency path refused to run the moment the version bumped, i.e. exactly when it would be needed.
- **Node pinned** (`engines` + `.nvmrc`) — two guards silently depended on ≥22.18 type-stripping with nothing declaring it.

## [1.40.0] — 2026-08-22 — the tabs agree with themselves

Closes audit findings M11–M15 (tab and navigation integrity).

- **"Web Orders" is now fully registered** (M11): in the worker's tab-access whitelist (the CEO could not grant or revoke it — the only ungovernable tab), in the override card with its default roles, in the icon map (it rendered as an anonymous blank square on the icon-only desktop rail — it gets the Globe), and the BM guard reaches it via derivation.
- **A tab-access override on Sales no longer renders a blank page** (M12): the render branch's independent `SALES_ROLES` re-check is gone — visibility is decided once, in the tabs filter, like every other tab. An override-granted role now sees the panel and any server refusals surface as errors instead of nothing.
- **The override card tells the truth** (M15): only `super_admin` is implicit; the old note claiming admin was "always allowed" was false and hid real lockouts. The card also now says plainly that granting a tab does not grant its data permissions (M13).
- **Client and server permission maps reconciled** (M14): `Users` gains `admin` client-side (the server always allowed it); `task_reports` gains `ceo` server-side — **the CEO's HR task report used to clear the draft and be silently discarded on a 403.** The submit now also keeps the draft and says why when it fails, whoever you are.
- The 🔒 access-denied placeholder is bilingual (F8).

## [1.39.1] — 2026-08-22 — a signature is earned per document, not per login

Closes audit finding B3 (and decision OD-15a). The v1.38.0 vault route had **no role check** — any staff login, including editor, marketing and live host, could download the CEO's handwritten signature at full fidelity, unaudited. That was a narrower leak than the public folder it replaced, and still a leak.

Access is now earned, through three doors, narrowest first:

- **Document-scoped** (new): `GET /staff/claims/:id/signature/(emp|pre|ceo)` and `GET /staff/leave/:id/signature/(emp|pre|ceo)` — the requester must OWN the document or sit in its approval chain, and the SERVER decides which chop applies at the document's stage (the pre-approver's only once pre-approved, the CEO's only once approved). This is how an editor prints their OWN approved claim — which legitimately carries the approvers' signatures — without being able to fetch any chop at will. The claim/leave print forms and both PDF builders now use these routes.
- **Role-scoped** (tightened): the `<role>-sign.png` route now requires the `sales` or `hr_manage` permission — the set of people who can already open every signed sales document. Used by the QT/DO/INV print paths.
- **Token-scoped** (unchanged): a customer's shared document serves its signer's chop against the share token, and revoking the link revokes the signature.

**Every serve is audited** (`signature.serve`, with the document context) — an exfiltration now leaves a trace. And `no-public-signatures` (guard #12) grew teeth to match: it asserts the permission gates and ownership checks EXIST in the shipped source, not merely that the routes do — the v1.38.0 guard could not fail on the exact regression it was written for.

## [1.39.0] — 2026-08-22 — the bridge is rebuilt to survive failure

**CEO: "Audit everything … make this system powerful and the bridge of between both are working well and no bugs."** The audit (`AUDIT-2026-08-22.md`) found 5 blockers and 15 majors — the worst in the bridge code shipped earlier today, all in failure and concurrency paths that 12 green guards never exercised. This release closes B1, B2, B4 and bridge majors M1–M10.

### The two that mattered most

- **B1 — a lost sale can no longer masquerade as an applied one.** Every movement now applies in ONE `db.batch()` transaction, stock moves by an atomic SQL expression (`MAX(0, stock + ?)` — never a JS read-modify-write, closing the concurrent-loss race M1), and the idempotency gate is **outcome-aware**: a conflicting `pending` row means a previous attempt died mid-flight, so the retry APPLIES — the old code answered "ignored", which the store reads as *already applied, stop retrying*, permanently losing the sale. Guard #11 now replays exactly that scenario, plus the expression-fallback SKU match and the discontinued-item case.
- **B2 — the cash booking actually books.** `cashflow_entries.created_by` is NOT NULL and the old code bound NULL — every single web order's cash-in and journal entry failed inside an empty catch, forever. Now: a real system actor, booking gated on the atomic `paid_seen_at` claim (`meta.changes` — one concurrent booker wins, closing the double-book race M2), the claim RELEASED on failure so the next poll retries, and failures logged, never swallowed. `booked_cents` records what was booked, and revenue reads it, so a store-side amendment cannot make `/revenue` and cash flow disagree (M3).

### The rest of Q-1

- **Refunds are a human decision** (M3, OD-17b): a paid order the store later cancels is flagged (`refund_flagged_at`) and the CEO is notified — revenue stays booked until a person decides, matching the existing "paid invoices cannot be silently cancelled" rule.
- **The first poll seeds its cursor to now** (M4, OD-16a) — months of store history can no longer avalanche into the deployment month's revenue. Importing history is a deliberate one-off, if ever wanted.
- **Nothing is silently dropped** (M5): an unparseable order is counted, logged, and shown on the bridge health card; a failing order gets one retry then is counted — one poison pill no longer wedges the feed forever.
- **A stuck cursor aborts loudly** (M6) instead of re-fetching the same page ten times per tick behind a green health card.
- **`reason` is informational, per the spec** (M7): the order/cancel whitelist was a poison pill — one new store-side string would have silently frozen a SKU's sync forever. Structural fields still validate strictly.
- **One SKU normalisation** (M8): the key is computed in JS by the same function the matcher uses and bound as a value; a stale/NULL key degrades to an expression-match fallback, never a lost sale; collisions and missing keys surface on the bridge health card.
- **`discontinued` survives a movement** (M9) — a sale no longer silently republishes a withdrawn item.
- **Migration skew refuses loudly** (M10): the movements endpoint answers 503 on a pre-0078 database instead of 200-with-empty-lists — the store holds and retries, per the contract.
- **The migrations themselves are restructured** (B4): the four never-applied drafts became eight files — one non-idempotent ALTER per file, everything else convergent — so a half-apply can never wedge the deploy pipeline. *Note for the reader of the 1.35.0–1.38.0 entries below: the migration names cited there (0075_bridge_pricing … 0078_fix_po_direction) were superseded by this restructuring before anything was ever applied; the current set is `0075_bridge_enabled` … `0082_fix_po_direction`, documented in DATABASE.md.*
- The public `/api/v1/health` bridge block is env-only again — no DB work, no business-activity timestamps for anonymous callers; the detail lives behind the authenticated bridge-health route, which now also reports rejected orders, pending refund decisions, missing keys and collisions.
- The `manual_stockouts` **revert** action now respects `direction` — reverting a stock-IN subtracts, with a stock check; the old unconditional add double-stocked every 'in' row (pre-existing, but the bridge now feeds that path machine-written rows).

## [1.38.1] — 2026-08-22 — the bridge card stops guessing

**CEO: "How to get ELFIA bridgeKey not set — the store cannot connect (ELFIA_BRIDGE_KEY)"**

He was reading the new bridge card, and the card was overconfident. `if (bh.data)` treated an **error body as health data**: a 404 or 403 from `/staff/inventory/bridge-health` is still an object, so `key_configured` came back `undefined`, which is falsy, and the card announced *"Key not set"* — a specific, confident, possibly wrong diagnosis that sends someone to set a secret which may already be set.

The 404 case is not hypothetical: the site worker and the API worker **deploy independently** (AUTO-DEPLOY.md), so the new Inventory page can be live while the API is still on a build without that route. That is exactly the window in which the card lied.

**Now:** only a real payload (`key_configured` actually a boolean) counts as health. Anything else renders *"Status unavailable — this page could not reach the bridge route. Usually the API worker is older than the site: deploy azoneofficial-api, then reload."* The run-guards rule applied to a UI: **a check that cannot run must never read like one that ran.**

### Verified against production while diagnosing

- `https://a2zcreative.my/api/v1/health` reports **version 1.32.1** — the live API worker is behind the repo (which was 1.34.0 before this work). v1.33.x–v1.38.x have never reached the API.
- An unauthenticated `GET /api/v1/bridge/elfia-inventory` returns **501 `not_configured`**, which is the portal's own "the secret is unset" answer. So `ELFIA_BRIDGE_KEY` is genuinely not set on the live worker — the card's message happened to be true this time, for a reason it could not actually see.
- The **store is fully configured**: `bridge_pull_configured: true`, `bridge_push_configured: true`. It has been pulling our feed and getting 501 on every attempt, and holding its movements in its outbox. Nothing is lost — but nothing has ever synced either.

## [1.38.0] — 2026-08-22 — the bridge is whole, and the signatures are off the internet

**CEO: "Do everything at one go. I dont want to hold anymore since I need to make my system live and publish completely."**

Track A of `IMPLEMENTATION-PLAN.md` is code-complete: web revenue, cash booking, a reconciliation report, bridge health in the public probe — plus the three security/debt items the plan marked urgent. Ships together with 1.36.0 and 1.37.0 below as one deploy.

### The signatures (S-1) — the item that could not wait

Five real handwritten signatures (`ceo, coo, cco, hr-admin, sales-marketing`) were plain files under `/signatures/` — downloadable by anyone on the internet, no login, since the day they were added. Flagged in v1.34.0 as found-but-not-fixed because **nine** call sites fetch them by URL (the v1.34.0 entry knew about two): `lib/doc-pdf.ts`, `lib/form-pdf.ts` ×6, `lib/doc-template.ts`, the printable leave form in `app/portal/page.tsx` ×3 and the claim form in `role-panels.tsx` ×3.

Now: the PNGs live in **private R2** (`private/signatures/`), served only through two routes — `GET /api/v1/staff/signature/<role>-sign.png` (signed-in staff; the session cookie rides along on the print window's `<img>`) and `GET /api/v1/public/doc-signature?t=<share-token>` (a customer's shared document — the signature rides the SAME credential the document itself does, so revoking the link revokes the signature). All nine call sites repointed. The public files are replaced by 1×1 transparent placeholders so stale cached HTML renders blank instead of broken. **Guard #12 (`no-public-signatures`)** fails any build where a real image returns to `public/signatures/` or any client file references the old path again.

**One action needed from you** (in the app, no terminal): /admin → Staff → **Signatures** — upload the five PNGs once. Until then, documents print a blank signing zone (the graceful path that already existed). And because the old files were public for an unknown period, upload **fresh scans**, not the leaked images — then a saved copy of the leak no longer matches any new document.

### The orphan pipeline reminder (S-2)

The 30-min cron was still bell-notifying staff "📞 Follow up today — Pipeline tab" — a tab deleted in v1.21.0 on your own words ("Sales pipeline is really needed?? I dont think so"). A notification that leads nowhere trains people to ignore notifications, so the block is gone. The `prospects` data stays; the reminder returns with Track C-2 only if you approve rebuilding the pipeline at all.

### Goods receipt recorded backwards (S-3)

`erp.ts` wrote every PO goods-receipt trail row without a `direction`, so the 0064 default recorded every stock **in** as an **out**. The insert now says `'in'` explicitly, and migration `0078_fix_po_direction` corrects the historical rows (scoped to the exact `Goods receipt PO-…` remark the code writes, so no genuine stock-out can be touched).

### Web revenue, booked like everything else

- `revenueLines()` gains an **`elfia`** bucket — paid web orders on a payment-received basis (`paid_seen_at`, stamped the first time the poller sees an order paid). Because `/revenue`, `/finance/pnl` and the business-lines card all derive from this one function, they cannot disagree.
- A first-seen-paid order books one cashflow money-in + one balanced journal entry, **idempotent by ref `ELF-<order_number>`** — the recordBankMovement rule (post twice, book once).
- Web orders are deliberately **NOT** in `attributedSalesByUser()` — no live session, no shift, nobody's commission — and guard #11 asserts that so nobody "fixes" it later.
- `GET /api/v1/health` now carries an `elfia_bridge` block (configured, orders_configured, last movement, last poll) — the mirror of the store's own probe, per its checklist step 4.
- `GET /staff/bridge/reconcile?date=` — per published SKU, the day's ledger movements by source against the current count. It says out loud that the ledger carries only ELFIA movements until Track E unifies the other sources.

### Also in this deploy

`bridge_events` retention on the 30-min cron (applied events kept 400 days; `unknown_sku` rows kept forever — each is an unresolved business problem), and `docs/BRIDGE-RUNBOOK.md` — key rotation without losing a movement, resolving unknown SKUs, replaying a cursor, correcting a clamped count.

## [1.37.0] — 2026-08-22 — every web order, visible from the portal

**"Everything is monitored in one place."** — the store's own spec, feed C, now consumed.

### What changed

- **Migration `0077_web_orders`** — `web_orders` (upsert key `(store, order_number)`) + `web_order_lines` (a snapshot, replaced whole on every update; `price_cents` is the price **actually charged at purchase** — the frozen number reports must use even after a price changes).
- **A 5-minute poller** (`worker/src/bridge.ts`, its own cron trigger so a bridge failure can never swallow the clock-out reminders or the TikTok sync). Cursor in `system_meta`, persisted only after a page is fully written — a crash mid-page re-reads the page and the upsert makes that harmless. ≤10 pages per tick, 20 s timeout, and after 3 consecutive failed polls it bells super_admin + CEO once per day. The store's URL is the **`ELFIA_ORDERS_URL` secret** — the client's domain never enters a committed file, the same posture the store takes toward ours.
- **The poller touches `web_orders` only.** A cancelled order's pieces already came back through the movements feed; guard #11 asserts the orders path can never write `inventory_items` or `stock_ledger`.
- **New "Web Orders" tab** (sales/inventory tier + executives, BM: "Pesanan Web") — status chips, search by order no/phone/name, and a detail drawer showing the frozen prices AND the portal-side stock movements for that order, joined through the bridge events. Plus a rate-limited "Pull now" button for the impatient (the cron pulls every 5 minutes anyway).

## [1.36.0] — 2026-08-22 — the store's sales finally reach the count

Until now the bridge was one-way: the store read our numbers, and every web sale drifted the two systems apart. This is the other half — the half where a mistake costs real stock.

### What changed

- **Migration `0076_bridge_movements`** — `bridge_events` (the idempotency store: `UNIQUE(source, event_id)`), `stock_ledger` (append-only; every movement writes one row with the APPLIED delta and the balance after — corrections are compensating rows, never edits), and `inventory_items.sku_key` (normalised match key: the store's `LUMI001` finds our `LUMI 001`, maintained by both routes that write a SKU).
- **`POST /api/v1/bridge/elfia-movements`** — up to 50 movements per call, same shared key. Response is exactly the spec's three lists (`applied` / `ignored` / `unknown_sku` — **event ids, not SKUs**). The store treats any id in NO list as undelivered and resends it: silence means retry, so the lists are truthful — a movement that fails mid-flight is simply left out and the retry is safe.
- **The one rule:** `INSERT … ON CONFLICT (source, event_id) DO NOTHING` — zero rows changed means already applied, answer `ignored`, apply nothing. **Guard #11 (`bridge-idempotency`) replays the same event five times against the real schema and the real INSERT (extracted from the shipped source) and proves stock moves exactly once.** Loses a sale? Never — the store retries. Deducts twice? Never — this guard.
- **Clamped, and loud.** A movement that would push a count below zero applies down to 0 (the pieces already physically left the shop; refusing would retry forever), records the APPLIED delta in the ledger, and bells sales + CEO — the shop sold pieces the portal did not think existed, and a human reconciles.
- **`unknown_sku` is a human's job.** Nothing is applied and nothing retries; the new **ELFIA bridge card** on the Inventory tab lists them in amber with the fix (rename the SKU to match, or add the item). The card also shows the key state, last sale reported, applied-24h and last orders poll.
- Every applied movement also writes the familiar `manual_stockouts` row (`ELFIA order ELF-…`), so the Inventory tab's movement list shows web sales alongside everything else.

## [1.35.0] — 2026-08-22 — the portal now sets ELFIA's prices

**CEO: "I want my system a2zcreative sync the prices and inventory to ELFIA which is all the system is automatically recorded and trace."**

The store has been ready since its side shipped: its 5-minute pull already accepts an optional `price_cents` per SKU and puts that number straight on the shop's price tag (`PORTAL-BRIDGE-SPEC.md`, feed A). Our feed just never sent it. From this release, prices are controlled here — change a price in Inventory and the shop shows it within five minutes. This is release 1 of 4 on the bridge track in **`IMPLEMENTATION-PLAN.md`** (new file, the living plan for the bridge, HRM, CRM and the rest); movements in (B) and the orders feed (C) are the next two releases.

### What changed

- **Migration `0075_bridge_pricing`** — two columns on `inventory_items`: `bridge_enabled` (which items the store may see) and `elfia_price_cents` (the web price, in sen, nullable).
- **The feed grew a price and lost a hack.** `GET /api/v1/bridge/elfia-inventory` now sends `price_cents` = the web price when set, else the list price/unit — and omits the key entirely when there is neither, which the store reads as "my own price stands". Scoping moved off the `ELFIA%`/`LUMI%` SKU prefix match onto the explicit `bridge_enabled` flag: renaming a SKU can no longer silently add or remove a product from a client's shop. 0075 backfills the flag from the old match, so the store sees exactly the same items on day one.
- **The live rebate never touches the web.** `live_rebate_cents` is a TikTok LIVE mechanic (v1.4.164, auto-computed). If it fed the web price, every rebate a host earned would silently discount the website. A web discount is typed into the web-price box, explicitly, as the net figure the customer pays — the spec's own rule.
- **Inventory tab: one new column, "ELFIA web".** A checkbox (publish / withdraw, saves at once, toast confirms) and — when published — a web-price box that saves on blur, with the list price greyed in as the placeholder so you can see what the shop will charge either way. Empty box = list price. New endpoint `PATCH /api/v1/staff/inventory/{id}/bridge`, audited as `inventory.bridge`.
- **Guard #10, `bridge-feed-guard`** — 16 checks on the shipped serialiser (`worker/src/bridge-feed.ts`, a pure module the guard imports directly, the `shift-sales.ts` pattern): price precedence, the omit-when-absent rule, stock never negative, discontinued/unpublished never leave, the rebate never applies, and **no key beyond `{sku, name, stock, price_cents}` can ever leak** — even if someone widens the SELECT later.
- **`worker/wrangler.toml` secrets list completed.** It documented five secrets; the code reads ten. `ELFIA_BRIDGE_KEY`, the VAPID trio and `NOTIFY_WEBHOOK` are now on the record — `ELFIA_BRIDGE_KEY` unset is why a fresh deploy answers 501.

### Proved

`npm run ci` order: typecheck ok → **all 10 guards ok** (the new guard caught a real mistake in review: the store's domain hardcoded in a UI tooltip — `brands-guard` refused it, the copy now says "the ELFIA store") → build. `sql-schema-check` verifies 634 queries against the 75-migration schema, including the feed's fallback pair.

### Still manual (deliberately)

Before this is live for the store: set the secret (`npx wrangler secret put ELFIA_BRIDGE_KEY`, same value as the store's `BRIDGE_KEY`), deploy, then run spec checklist steps 5 and 8 — the store's "Sync with portal now" report clean, and a portal price change visible on the shop within 5 minutes.

## [1.34.0] — 2026-08-21 — deploys itself

**CEO: "I want vibecode for A2Z which is automatically done without I need to manual."**

The manual part was never the coding — it was the delivery: zip → download → unzip into a new folder → `DEPLOY.bat`. That is gone. The code now lives in a private GitHub repository, and Cloudflare builds and publishes it.

**Chosen shape:** GitHub + Cloudflare's own build service, preview on every change, one tap to production. Setup is in **`AUTO-DEPLOY.md`** — about 15 minutes, once.

### The gate

`npm run ci` = typecheck → **9 guards** → build, and it is Cloudflare's build command. A non-zero exit stops the deploy; the live site keeps serving the previous version. Verified in both directions: a deliberate contrast regression exits 1, the restored file exits 0.

`scripts/run-guards.mjs` treats a guard that **cannot run** as a failure, never a skip. A skipped check reads exactly like a passing one in a build log, and "it went green" is what people remember. It also prints, on every run, the five browser-based suites it does **not** cover, so their absence is on the record rather than quietly forgotten.

### Migrations cannot run from a preview

There is one database. A Cloudflare preview gets its own URL but is still bound to the **real** `azoneofficial` D1 — the one holding today's invoices. So `scripts/deploy-api.sh` applies migrations **only** from the production branch, and preview builds are switched off for the API worker entirely. The website preview stays on: it is static files.

### A stale lockfile that was a live trap

`worker/pnpm-lock.yaml` was dated 14-08 and pinned `@cloudflare/workers-types` **4.x** while `package.json` asks for `^5`. That is the exact ERESOLVE mismatch `DEPLOY.bat` carries a retry hack for. Harmless while `DEPLOY.bat` used npm — but an automated builder picks its package manager from whichever lockfile it finds, so this would have reproduced the failure on a schedule. Deleted; `worker/` installs from `package-lock.json`.

### Honest limits, also written into `AUTO-DEPLOY.md`

- The four Playwright guards need a browser Cloudflare's builder does not have. They still run here before a release.
- `app/layout.tsx` fetches Poppins from Google **at build time**. A Google outage fails the build — safely, but it fails. Self-hosting the font would remove the dependency.
- The two workers deploy independently and can land a minute apart.

`DEPLOY.bat` stays as the emergency path, with the caveat at the top: Cloudflare refuses a CLI deploy over a git-connected worker, so the repo must be disconnected **and reconnected afterwards**.

### ⚠️ Found while preparing the repository — not fixed here

**Five real handwritten signatures are publicly downloadable from the live site.** `public/signatures/{ceo,coo,cco,hr-admin,sales-marketing}-sign.png` are plain static assets: `https://a2zcreative.my/signatures/ceo-sign.png` returns the CEO's signature as a clean PNG to anyone, no login. No `_headers` rule restricts them, and the paths appear in the markup of approved leave and claim forms.

This predates automatic deploys and is unchanged by them. It is not fixed in this release because the fix is not cosmetic: `lib/doc-pdf.ts` and `lib/form-pdf.ts` fetch these by URL from the browser, so they need an authenticated endpoint (`/api/v1/staff/signature/:role`) and both PDF builders repointed at it. That is its own release, with its own tests. Flagged rather than quietly patched.

## [1.33.3] — 2026-08-21 — you can type a space in a sales document

**CEO: "The desc on sales cant be space?! Whyyy"** — he typed `Testing Testing` into a line's detail box and got `TestingTesting`.

### Why

The detail box holds a `string[]` (one entry per line) but shows it as text, so it round-trips through `join("\n")` / `split("\n")` on **every keystroke**. The change handler tidied the value on the way _in_:

| the code                | what it did to someone typing                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `.map((s) => s.trim())` | ate the space the instant it was pressed — a trailing space is leading/trailing on its own line, so `trim()` removes it before the next letter arrives |
| `.filter(Boolean)`      | deleted the new blank line the instant Enter was pressed                                                                                               |
| `.slice(0, 10)`         | silently dropped a pasted line 11 and beyond                                                                                                           |

So he could not type a space, could not start a second line, and would have lost a long paste without being told. Tidying input is right; doing it on every keystroke is what broke it.

### The fix

**Typing is now a pure `split("\n")`** — what he types is exactly what is in state. The tidying moved to `createDoc`, the one moment it matters: each detail line trimmed, blank lines dropped, the item name trimmed at the ends only (`Spaced  Service Name` keeps its inner spacing). Over ten detail lines is now **refused out loud** with the offending item named, instead of being silently cut.

### Two more things this turned up

- **`printDoc` could crash the screen right after a successful save.** A 200 response carrying no `doc` threw inside `buildDocHtml`. The invoice existed — but the person saw the screen fall over instead of their PDF, would assume it failed, and create the invoice **a second time**. A duplicate invoice is far worse than a missing preview, so it now returns quietly.
- Swept every other prose field on the document form for the same pattern. The item description and the rest are clean; this handler was the only one.

### The test

`scratch/sales-desc-typing-e2e.mjs` — and it **types**, one character at a time with a real delay. That matters: setting a value programmatically does not reproduce this at all, which is how it survived. Against the previous build it reproduces his exact result:

```
typedDetail: "TestingTesting"                    ← his bug, reproduced
twoLines:    "TestingTestingSecondlinehere"      ← Enter was being eaten too
```

After the fix all of it passes, and the test additionally submits a document and reads the **actual POST body** to prove the tidying moved rather than vanished — `"  Line one  \n\n   \n  Line two  "` is saved as `["Line one", "Line two"]`.

Full guard suite 13/13, typecheck clean, footer / nav-fit / BM / portfolio suites re-run.

**Deploy notes:** portal only, no worker change, no migration. Service worker cache v29 → v30 (the portal shell is cached, so the bump is what puts the fix on already-installed phones).

## [1.33.2] — 2026-08-21 — the left-aligned footer, kept small

**CEO sent a phone photo of the live footer: "I more prefer like this!"**

The photo is the pre-v1.33 layout — brand block on the left, **EXPLORE** and **FOLLOW US** as two headed columns. That is what is back. v1.33.1's centred rows are gone.

The size instruction from the message before it still stands, so the same layout is arranged to cost less than it used to:

- **The brand block and the link columns share a row from `md` up** instead of stacking. That stacking was most of the original 1080px.
- Company and client marks stay a compact row rather than bordered description cards.
- The secondary pages (FAQ, Case Studies, Careers, Privacy, Terms, Login) ride on the legal bar instead of forming a third column.
- Type and spacing tightened throughout — the slogan and address at `text-xs`, list spacing 8px → 6px, section gaps trimmed.

### Where that lands

| width  | v1.32.1 (the original) | v1.33.1 (centred) | **v1.33.2 (this)** |
| ------ | ---------------------- | ----------------- | ------------------ |
| 1280px | 1080px                 | 433px             | **458px** (−58%)   |
| 768px  | 1080px                 | 451px             | **491px** (−55%)   |
| 390px  | 1208px                 | 647px             | **839px** (−31%)   |

Being straight about the phone number: **839px is a full screen, and the centred version was 647px.** That gap is inherent to the layout, not sloppiness — at 390px a left-aligned brand block and its link columns cannot share a row, so they stack, and stacking is what costs the height. This is the layout you picked, tuned as far as it goes; if the phone specifically matters more than the look, v1.33.1 is the smaller one and I can put it back.

### One deliberate difference from the photo

The email has moved out of the FOLLOW US column into the brand block, under the address. In the photo it is rendering as **"admin@azoneofficial.c / om"** — half a phone column is not enough room for it. With the other contact details it has the width it needs and reads in one piece.

### The guard

`scratch/footer-e2e.mjs` carries over from v1.33.1 with two assertions flipped to match the chosen design, rather than left passing by luck:

- the mark must sit on the container's **left edge** (it asserted _centre_ yesterday) — same principle, opposite axis: deliberately placed, never drifting;
- the social links must each have an **accessible name from whichever source is in use** — visible text now, `aria-label` when they were icon-only. Counting `aria-label`s would have reported 0/3 and failed a correct footer.

Budgets re-baselined to 500 / 540 / 890. Everything else holds: all thirteen destinations linked, address / email / CTA present, the mark loaded and legible, every navy-panel mark a `-white` variant, the email never split mid-word, no sideways scroll, ELFIA under Clients and never under Our companies. Full guard suite 13/13, typecheck clean, `nav-fit-e2e` / `a2z-bm-e2e` / `portfolio-click-e2e` re-run.

**Deploy notes:** site only, no worker change, no migration. Service worker cache v28 → v29.

## [1.33.1] — 2026-08-21 — the footer, minus two thirds of it

**CEO: "footer web should minimalist instead of consume so much space."**

Fair. I centred the footer in v1.33.0 and made it _prettier_ without asking whether it should be that big at all. Measured before touching anything:

| width  | footer height | share of the page |
| ------ | ------------- | ----------------- |
| 1280px | 1080px        | 32%               |
| 768px  | 1080px        | 39%               |
| 390px  | 1208px        | 37%               |

More than a full screen of scrolling, on every page, to reach a list of links.

**Now: 433px / 451px / 647px — 60%, 58% and 46% smaller.**

### What went

- **The two headed columns.** "Explore" and "Follow us" became two quiet wrapped rows. Headings over a seven-item list are furniture; the links are the content.
- **The social labels.** The icons carry the meaning. The words TikTok / Instagram / Facebook live on as `aria-label` and `title`, so nothing was lost for screen readers or on hover.
- **The bordered company cards.** Two boxes with logos and one-line descriptions became a single row of small marks. The descriptions moved into the link's accessible name and tooltip.
- **The standalone address block.** It rides on the legal line now — the full NAP is still on every page, at the cost of one line instead of a block.

### What stayed, deliberately

The mark, **every destination** (all seven nav pages plus FAQ, Case Studies, Careers, Privacy, Terms and Login), the address, the email, the WhatsApp CTA, and the editable `footer.slogan` slot. Minimal means fewer boxes, not fewer facts.

**Our companies and Clients are still two labelled groups**, now with a rule between them. Merging them into one row of logos would be smaller still — and would quietly claim we own our clients. The v1.27.0 permission rule is unchanged.

### One thing I nearly "fixed" that was never broken

The floating WhatsApp button looked, in my screenshots, like it was sitting on the legal line. I was about to spend ~90px of padding clearing it — the exact opposite of what was asked. It turned out the button already fades itself out whenever the footer is on screen (v1.2.18, because the footer carries the same CTA); my screenshot had simply been taken mid-fade. **The first version of my own overlap test also passed for the wrong reason** — it compared the button against a footer that was still 2000px below the fold. Both are now honest: the test scrolls to the true end of the page, asserts it got there, and treats the button's box as real only when it is actually visible.

### The guard

`scratch/footer-e2e.mjs` was rewritten to hold both halves of "minimal" at once, at 1280 / 768 / 390:

- **a hard height budget** (470 / 500 / 700px) — the easiest thing to lose one commit at a time;
- **and completeness** — all thirteen destinations still linked, address / email / CTA present, three social links with accessible names, the mark loaded, centred and legible, every mark on the navy panel a `-white` variant, the email never split mid-word, no sideways scroll, ELFIA under Clients and never under Our companies, and exactly one client shown.

`scratch/footer-height.mjs` prints the before/after numbers on demand. Full guard suite 13/13, typecheck clean, `nav-fit-e2e` / `a2z-bm-e2e` / `portfolio-click-e2e` all re-run.

**Deploy notes:** site only, no worker change, no migration. Service worker cache v27 → v28.

## [1.33.0] — 2026-08-21 — the new A2Z mark, and a footer built around it

**CEO: "change to this logo for A2Z Creative. make the footer a centralise a bit to ensure that the logo nice to see."**

### The mark

- The supplied artwork replaces the old one everywhere it appears: `public/logo.png`, `public/logo-white.png`, the browser tab icon (`app/icon.png`) and both PWA icons (`icon-192.png`, `icon-512.png`).
- It arrived as navy-on-white. Cutting the white out with a hard threshold leaves a jagged, halo'd edge at small sizes, so the alpha channel is a **luminance ramp** instead — every pixel keeps the exact softness of its own anti-aliasing, and the colour is flattened to the brand navy `#1a2946`. The result sits cleanly on the white header and on the navy footer alike.
- **The service worker cache is bumped v26 → v27 deliberately.** `SHELL_URLS` caches `/logo.png` and `/icon-192.png`; without the bump, every already-installed device would keep showing the _old_ mark indefinitely. `activate` deletes any key that is not the current one, so the first visit after this deploy evicts them.

### The footer

- Rebuilt on a **single centre line**: mark → tagline → slogan → address → the WhatsApp action, each centred on the same axis, with the mark raised to `h-14 / sm:h-16` so the stacked A2Z / CREATIVE lockup is legible rather than decorative.
- The Explore and Follow-us columns are now a centred pair (`max-w-lg`, centred text) instead of being pushed to the right-hand edge, and Our Companies, Clients and the legal bar all sit on the same axis.
- **In the header the mark went `h-7` → `h-9 / sm:h-10`.** The new artwork is a stacked lockup; at 28px in a 64px bar the word CREATIVE came out about 4px tall and read as a grey smudge. Re-measured first: Bahasa Melayu — the wider language — wants 1033px of a 1152px row at 1280, so the extra ~22px was affordable, and `nav-fit-e2e.mjs` re-confirms all 16 width × language combinations.

### Three more defects I found in my own screenshots

Not asked for, but visible the moment the footer was rendered at full size, and all three were already live:

- **"ELFIA ELFIA".** The client chips printed the brand name beside a mark that _is_ the brand name. The mark now stands alone; the name survives as the `alt` text and an `aria-label`, so screen readers and anyone whose images fail still get it.
- **A truncated descriptor.** A2Z's line read "Creative marketing, digital growth and live com…" — an ellipsis in the one place whose whole job is to say what each company does. It wraps now, and the two chips stretch to equal height.
- **A split email address.** At 390px the address sat in half a column and broke as "admin@azoneofficial.c / om". It has its own full-width centred row and no longer needs to be breakable at all.

### A contrast bug found on the way, and closed

Reviewing my own screenshot of the new footer, ELFIA's **maroon** wordmark on the navy panel was all but invisible — a defect live since v1.30.0 that no existing test could have caught, because the image loaded perfectly. It was simply the wrong file for that surface.

- `constants/brands.ts` gains a required **`logoOnDark`** on the Brand type, so a brand cannot be registered without stating which mark to use on a dark surface. `public/brands/elfia-white.png` and `azone-white.png` were generated to match.
- The footer now reads `src={b.logoOnDark}` for every chip.
- **`tests/brands-guard.mjs` enforces it**: an `<img>` in the footer that uses `b.logo` instead of `b.logoOnDark` fails the build. Verified in both directions — reverting the footer line makes the guard fail, restoring it makes it pass.

**Tested:** `scratch/footer-e2e.mjs` (new) asserts, at 1280px, that the mark is present, loaded, at least 50px tall and centred on the container axis within 2px, that the link columns are centred, that every footer image loads, that every `/brands/` mark used there is a `-white` variant, that no company descriptor is clipped, and that each client chip shows no duplicate name while keeping its accessible one — then repeats at 390px for the email on a single line, the mark still centred and no sideways scroll. The two new rules were checked in the **failing** direction as well (`scratch/neg.mjs` re-introduces both defects in the live DOM and confirms each rule fires).

`nav-fit-e2e.mjs` re-run at 8 widths × 2 languages after the mark grew (16/16), plus `a2z-bm-e2e.mjs` and `portfolio-click-e2e.mjs`. Full guard suite 13/13, typecheck clean.

**Deploy notes:** site only, no worker change, no migration.

## [1.32.1] — 2026-08-20 — the BM navbar no longer collides

**CEO's screenshot of a2zcreative.my/portfolio in BM: "Tentang Kami" printed through the A2Z logo, "Log Masuk" broken over two lines, and the CTA wrapped inside its button.**

My fault, and a predictable one: Bahasa Melayu labels are about 15% wider than their English originals, and the desktop nav row switched on at `md` (768px) — sized when every label was English. I shipped the translation without re-checking the header at the widths in between.

**Measured, not guessed** (`scratch/nav-fit-measure.mjs`): in BM the seven links plus the toggle, Login and the CTA want **1067px**, while the row is only **961–1057px** wide between 1024 and 1120. English wants 915px and fits, which is exactly why it looked fine to me and broke for him.

- **The desktop row now appears at `xl` (1280px)** instead of `md`. Below that the hamburger takes over — with every destination inside it, including Login and the CTA.
- **The language toggle stays OUTSIDE the hamburger** at every width. A Bahasa Melayu reader should never have to open a menu to find their own language.
- **`whitespace-nowrap`** on every nav link, Login and the CTA, plus `shrink-0` on the logo: a future label that is too long now overflows visibly instead of folding into its neighbour or over the mark.
- Gaps tightened (8 → 6 in the link row, 5 → 4 on the right), which leaves BM 141px of slack at 1280 rather than 85px.

**Now a permanent test** (`scratch/nav-fit-e2e.mjs`): eight widths (390 → 1600, including 1279/1280 either side of the breakpoint) × both languages, asserting no link wraps to a second line, no two header groups overlap, no sideways scroll, exactly one language toggle is visible, all seven links show at desktop width, and the hamburger menu carries all nine destinations below it. 16/16 pass.

**Deploy notes:** site only, no worker change, no migration.

## [1.32.0] — 2026-08-20 — Bahasa Melayu across the public site, and a named portfolio

**CEO: "include portfolio AZ one and ELFIA, then put a toggle for EN BM so that client can choose their preferences."** Scope confirmed by him as every public page, and both brands named with their logos.

### EN / BM toggle

- A pill in the navbar (desktop and inside the mobile menu) switches the whole public site between English and Bahasa Melayu. The choice is remembered per device under the SAME key the staff portal already uses, so someone who works in BM in the portal gets BM on the site too.
- **410 strings** translated into Malaysian business BM — the marketing copy, the packages and services detail, the FAQ, careers, case studies, and the privacy policy and terms in a formal register. Brand names, tier names (Starter/Growth/Scale/Enterprise), registration numbers, the address and the taglines deliberately stay as they are.
- **How it is applied, and why:** the public pages are Server Components (they export `metadata`), so they cannot call a hook. Rather than split all twelve pages into server+client halves and edit thirty files of a live site at once, the BM layer is applied to the rendered DOM — one walk over the text nodes, whole-node matches only, with every original remembered so switching back to English is exact rather than a reverse lookup. A string with no entry, or one whose English has since been reworded, simply stays English.
- **No flash and no hydration mismatch.** Swapping the text in an inline script before React boots was tried and rejected: React then hydrates against text it did not write, repairs the DOM back to English and logs error #418. The inline script now touches no text — it only holds the body invisible (`html.ms-pending`) for the few frames until React mounts and the swap lands. Failsafed twice: the script lifts the veil after 1.2s regardless, and the runtime lifts it on mount even if the swap throws. Proven with every script file blocked — the page still ends up visible.
- The staff portal, admin, account, login, doc and report surfaces are explicitly excluded; they own their own language handling.
- **Honest limit:** the HTML served to crawlers stays English, so English remains the indexed language. BM is a reader convenience. Real BM SEO would be a different job — `/ms` routes rendered at build time.

### Portfolio

- **ELFIA** and **AZ ONE OFFICIAL** are now named entries with their marks, a one-line description of the relationship, and a link to each brand's own site.
- The confidentiality rule from v1.27.0 stands for everyone else: a client is named only with permission. The CEO's instruction of 20-08-2026 is that permission, on the record, for these two entries and no others — a third named entry still needs written permission from that client.

**Deploy notes:** site only, no worker change, no migration. Run `DEPLOY.bat` IN FULL as always.

## [1.31.0] — 2026-08-20 — read-only stock bridge for the ELFIA store

**CEO: "how to update all the inventory to match with inventory in A2Zcreative??"** The ELFIA store (its own separate system) can now pull stock counts from this portal's inventory.

- New endpoint `GET /api/v1/bridge/elfia-inventory` — READ-ONLY by construction (one SELECT, nothing written) and doubly scoped: only SKUs in the ELFIA families (`ELFIA…`, `LUMI…`) ever leave, so the client store can never see A2Z's other inventory. Off (501) until `wrangler secret put ELFIA_BRIDGE_KEY` is set; wrong key = 401 (timing-safe compare).
- Direction is deliberate: the portal is the counting house (live-session stock, stocktakes), the store is a consumer. The store's admin presses "Sync stock from portal" — nothing here pushes, nothing runs on a timer.
- To enable: `wrangler secret put ELFIA_BRIDGE_KEY` here, the same value as `BRIDGE_KEY` on the store's worker, then redeploy both.

**Deploy notes:** worker only, no migration, no site change. Run `DEPLOY.bat` IN FULL as always.

## [1.30.1] — 2026-08-19 — consultancy documents issue under AZ ONE, everything else stays A2Z

**CEO: "letterhead should all under A2Z since A2Z is a main company. the invoice, Quotation and Delivery Order only will letterhead under AZ One if it is consultancy."** The 'azoo' code reserved in migration 0073 goes live — no new migration needed.

- **Create document gains "Issued by (letterhead + bank account)"** — A2Z CREATIVE MARKETING by default; pick AZ ONE OFFICIAL for consultancy work. An amber line spells out what the choice really decides — the letterhead, the registration number, the SST clause AND the Maybank account the client is told to pay — before anyone presses Create. The choice is locked at creation: a document forever shows the entity that issued it, so the edit form never offers it and the worker ignores any attempt.
- **The family stays with its entity.** Convert an AZ ONE quotation and the invoice is AZ ONE's; its receipt and any credit note inherit the same — a receipt acknowledges money paid into the account the INVOICE printed, so an A2Z-lettered receipt for an AZ ONE invoice would acknowledge money A2Z never received. Legacy (pre-v1.28) documents keep converting to A2Z invoices, exactly as decided then; legacy invoices' receipts now stay on AZ ONE paper, matching the letterhead the client already holds.
- **HR paper never moves.** Claims, leave forms and payslips are A2Z's, always — "A2Z invoices, A2Z employs". The guard now fails the build if anyone gives those an entity argument.
- **The document list tags the exception.** Rows issued under AZ ONE (legacy or consultancy) carry a small "AZ ONE" chip — one glance answers "whose bank account is this client paying?". A2Z rows stay clean; tagging the default on every row would be noise.
- The WhatsApp payment chase, share links, PDFs, prints and the public document page all already resolve the letterhead per row, so 'azoo' flows through every surface with no further change.

**Proven:** the render test now covers all three codes against the real template — NULL and 'azoo' produce **byte-identical** AZ ONE documents with zero A2Z contamination, 'a2z' produces A2Z paper with zero AZ ONE contamination. The issuer guard verifies the selector is honoured, conversion/receipt/credit-note inheritance is intact, and HR stamping is untouched — and it was checked in both directions (it genuinely fails when each contract is broken).

**Deploy notes:** site AND worker changed, no migration. Run `DEPLOY.bat` IN FULL from the v1.30.1 folder.

## [1.30.0] — 2026-08-19 — three brands, cleanly separated: one source of truth, and every client owns their own mark

**CEO: "how to make sure that AZONE official and ELFIA is not in my A2Z system? I just want that customer or client can have a option to click on their logo then will redirecting to their own domain."** Two halves, and neither is a hardcoded link.

### Half one — the group's brands live in ONE file

`constants/brands.ts` now declares every brand once: name, kind, canonical domain, logo, descriptor, registration. The footer's new **"Our companies"** row is generated from it — A2Z CREATIVE MARKETING and AZ ONE OFFICIAL side by side, each linking to its own domain, the current site marked rather than linked. A domain move is one edit here plus one line in `public/_redirects`, not a hunt through components.

**ELFIA is `kind: "client"`, and that word does real work.** Clients never appear in the companies row — a shared logo row silently claims ownership of a business you do not own. Clients render only through `PUBLISHABLE_CLIENTS`, which requires `permissionOnFile: true`; ELFIA's is **false**, so ELFIA appears nowhere on the public site today. That is your own standing rule since v1.27.0: client marks are published only with written permission on file.

**Stable outbound short links.** `/go/azone` and `/go/elfia` (302, not 301 — a permanent redirect is cached by browsers forever) mean anything printed, WhatsApped or put in a document survives a future domain move: one line changes and every link ever sent follows.

**New guard, `tests/brands-guard.mjs`,** fails the build if: ELFIA is reclassified as a company; the permission gate disappears; a `/go/` link stops matching the config; a sister or client domain is hardcoded anywhere in `app/`, `components/`, `lib/` or `constants/`; or A2Z's own identity starts leaning on a client's name. Both directions verified — it passes clean and it genuinely fails when a domain is planted in a component.

**A real bug it caught on its first run:** A2Z's document letterhead was still printing `azoneofficial.com`. v1.28.0 shipped that because no A2Z domain existed yet; by today the old domain resolves to nothing, so **every A2Z invoice was showing a client a dead web address**. Fixed to `a2zcreative.my`. AZ ONE's letterhead keeps `azoneofficial.com` — that is its own site — and the A2Z mailbox stays `admin@azoneofficial.com` because Google Workspace has not moved. The guard now pins all three.

### Half two — every client owns their brand, on their own record (migration 0074)

`customers` gains **website** and **logo_key**. In Sales → customer form there is now _Their website_ and an _Upload logo_ button (PNG/JPG/WEBP/SVG, stored in R2 under the public `uploads/` prefix — the client must be able to see their own logo, and their role would be refused by every private prefix).

In the client's own area, a **"Your brand"** card shows that client their own mark and links to their own domain. Note what it is not: v1.27.0 removed an "ELFIA drops" card because it advertised one client's storefront to every signed-in customer, including their competitors. This card is the inverse — each client sees only themselves, read from their own row. A client with neither website nor logo on file sees no card at all.

This is what makes it **systematic** rather than a special case: ELFIA is simply the first client with a website and a mark on file, and the tenth client works identically with no deploy.

Proven end-to-end on the built pages (`scratch/client-brand-e2e.mjs`): client with a brand sees the card and the link to their domain; client without one sees nothing; the public footer lists both companies and links AZ ONE exactly once; **zero links to ELFIA anywhere on the public site**.

**Deploy notes:** site AND worker changed, **and there is a migration (0074)** — run `DEPLOY.bat` IN FULL; step 4 must apply it. Nothing to configure afterwards.

## [1.29.5] — 2026-08-19 — one slot, several hosts

**CEO: "For host I need to have a multiple host pick if it is require."** New assignment now takes as many hosts as the slot needs. Pick the first in the Host box as always, then add more from **+ Add another host** underneath; each one appears as a removable chip.

**What it actually creates, and why:** one session per host. A session row carries exactly ONE host — that single fact is what makes the staff grid, the per-person hour totals, leave-clash detection and individual notifications work. Inventing a shared multi-host row would have quietly broken all four. So three hosts on tonight's 20:30 slot become three sessions at 20:30: three rows on the grid, three sets of hours, three notifications, and each one can be completed or cancelled on its own.

- **The button promises exactly what the press will do.** It counts dates × hosts, not dates: two hosts on a five-day repeat reads "Schedule 10 sessions" before you click, and the repeat preview line spells out the multiplication.
- **A stated ceiling, never a silent one.** One press creates at most 120 sessions. Ask for more (say 4 hosts across a 62-day run) and it queues the first 120 and _says so_ — a silent truncation would read as "scheduled everything" when it did not.
- **Every chip is removable, including the one in the Host box** — removing it promotes the next host into the picker rather than emptying the form. The hosts are equals here; a chip you cannot remove would just look broken.
- **Editing is untouched.** An amendment still concerns exactly one session, so the multi-host row is hidden in Edit mode and cleared when the dialog opens, and cannot leak into the next create.
- **No new CSS.** The chips and the picker use the portal's shared style helpers (`chipNeutral`, `inputClassSm`, `fieldLabel`), so they inherit field sizing, radius, spacing and dark mode automatically — as asked.

Proven end-to-end against the built portal (`scratch/multi-host-e2e.mjs`): three hosts picked → three POSTs, three distinct host ids, same date/slot/client on all three, button read "Schedule 3 sessions" beforehand; removing the picked host dropped it to "Schedule 2 sessions" and promoted the next host into the box; zero page errors.

**Deploy notes:** site only, no worker change, no migration — but run `DEPLOY.bat` IN FULL as always.

## [1.29.4] — 2026-08-19 — the deploy no longer stops on a type-definition version

**Reported from the CEO's machine: step 2 died with `npm error code ERESOLVE`.** `worker/package.json` pinned `@cloudflare/workers-types@^4`, while the wrangler it installs (4.116+) declares an OPTIONAL peer on `@cloudflare/workers-types@^5`. npm refuses the whole tree over that, so nothing after step 2 ran. My container never hit it because its `worker/node_modules` predated the wrangler bump — a clean machine is the only place this shows up, which is exactly why the first run of a new script belongs on a clean machine.

- **The pin now matches wrangler:** `@cloudflare/workers-types@^5.20260730.1`, with `worker/package-lock.json` regenerated to match. Verified on a from-scratch install: `npm install` succeeds with no flags, and the compile gate still reports zero undefined names (the same 28 pre-existing strict-mode warnings, no new ones — the v5 types changed nothing this Worker depends on).
- **Step 2 now retries instead of dying.** If npm ever refuses the tree again — wrangler moves that peer every few weeks — the script retries with `--legacy-peer-deps` (the flag npm itself suggests), says plainly that this only relaxes an optional TYPE definition and cannot change what gets deployed, and fails only if the retry fails too. A deploy must never be blocked at midnight by a `.d.ts` version.
- **A batch-file trap fixed while writing that retry:** inside a parenthesised block, `cmd.exe` expands `%errorlevel%` when it PARSES the block, so a nested check reads the value from before the command ran and silently passes. The retry uses `if errorlevel 1`, and the reason is written above it in the file so the next edit does not reintroduce it.

**Deploy notes:** run `DEPLOY.bat` IN FULL from the v1.29.4 folder. Everything from 1.29.1–1.29.3 rides along: the `url is not defined` outage fix, the Mark completed confirmation, the mobile sign-in page, the single-domain routes, and the consultancy site's scoped enquiry door.

## [1.29.3] — 2026-08-19 — the three-brand shape: one back office, one cross-site door

**Your three decisions, on record: one back office (not three databases) · ELFIA's canonical address is elfiaofficialstore.my · the consultancy site gets a working contact form.** This release is the API side of that shape; the two new websites follow.

**One door, and it is exactly one door.** azoneofficial.com (AZ ONE OFFICIAL — a separate legal entity, its own website) may now POST the public enquiry form into the portal's Enquiries tab, and may do nothing else. That permission lives in its own setting, `PUBLIC_FORM_ORIGINS`, deliberately NOT in `ALLOWED_ORIGINS`: it is consulted at exactly one route (`POST /api/v1/enquiries`) and that route's CORS preflight. From the consultancy site, sign-in, registration and every other endpoint still answer 403. The reasoning is blast radius — a compromise of a marketing site for a different entity has to stop at "someone submitted a fake lead", not reach staff data.

Verified against a running Worker, not just read: enquiry from azoneofficial.com → 201; from its www twin → 201; from A2Z itself → 201; from a stranger → 403; **login from azoneofficial.com → 403**; register → 403; preflight echoes the form origin only. Repeatable via `scratch/public-form-origin-check.sh`.

**The guard now enforces the shape, not just the values.** `tests/origins-guard.mjs` fails the build if azoneofficial.com reappears in `ALLOWED_ORIGINS` (that would hand it sign-in again), if the exception widens beyond POST/OPTIONS on the enquiry route, or if ELFIA's store is ever added to the form allow-list — ELFIA is a **client**, and a client's shop does not post into A2Z's enquiry inbox.

**Deploy notes:** worker only (site unchanged, no migration), but run `DEPLOY.bat` IN FULL as always. `PUBLIC_FORM_ORIGINS` ships in `worker/wrangler.toml`, so the deploy sets it — no dashboard step.

## [1.29.2] — 2026-08-19 — one domain · sign-in fits a phone

**CEO's decision, in his words: "No more API under azoneofficial.com."** The API worker now carries exactly two routes — `a2zcreative.my/api/*` and `www.a2zcreative.my/api/*` — and `ALLOWED_ORIGINS` names only the new domain. `wrangler deploy` reconciles the route list, so the old domain's routes are removed from Cloudflare on the next deploy. This costs nothing today: azoneofficial.com has no DNS records at all and already serves nothing.

**The one thing this does cost, and when:** TikTok Partner Center still holds `https://azoneofficial.com/api/v1/integrations/tiktok/callback` and `.../webhook`. Those must be changed to `a2zcreative.my` in Partner Center **before** the next TikTok authorisation, or order sync will not come back. Restoring the old domain, if you ever want it, is two lines in `worker/wrangler.toml` and nothing else.

**Deliberately unchanged: `COMPANY_DOMAIN` stays `azoneofficial.com`.** That is the staff MAILBOX domain (Google Workspace), not the website. It gates who may hold a staff or admin role — moving it before the mailboxes move would block every staff-role edit and lock people out of their own accounts. The guard test now fails the build if anyone "tidies" it. Likewise the calendar UID domain, frozen forever.

**The sign-in page now fits a phone screen.** It was a fixed 96px-from-the-top block: on the CEO's iPhone that spent a seventh of the screen on emptiness and pushed the Sign in button under Safari's bottom bar. It is now a centred column measured in `svh` — the small viewport height, i.e. with the browser chrome showing — so the logo, both tabs, Google, both fields and the button land on one screen with the URL bar visible or hidden. Measured on the real build at 440×700 (iPhone 16 Pro Max) and 375×555 (iPhone SE): everything fits, no scrolling. Desktop is pixel-identical to before.

**The floating WhatsApp button no longer covers the sign-in form.** On a phone it sat directly over the password field and the Sign in button — the two controls the page exists for — and it made no sense there anyway: nobody WhatsApps sales to sign in to their own staff account. It is hidden on `/login`, exactly as it already is on `/portal` and `/admin`.

**Deploy notes:** site AND worker changed, no migration. Run `DEPLOY.bat` IN FULL from the v1.29.2 folder.

## [1.29.1] — 2026-08-19 — outage fix: "url is not defined" · Mark completed now confirms itself

**This release exists because v1.29.0 broke sign-in on a2zcreative.my, and the fault was mine.** The domain work added host-aware Google OAuth to the API worker and referenced `url.protocol` at the top of the request router — but `url` only exists inside the outer handler; the router is handed `(request, env, path)` and nothing else. So a `ReferenceError` shipped to production, and every request whose handler sits below that line threw it: `/auth/me`, `/staff/*`, `/health`. Sign-in itself SUCCEEDED and then `/auth/me` returned 500, so the portal read "not signed in" and bounced straight back to `/login` — a loop that looked exactly like a wrong password. The error log said it plainly six times: `url is not defined`.

**Why nothing caught it before it went live** — the important part:

- The root `tsconfig.json` carries `"exclude": ["node_modules", "worker"]`. `pnpm typecheck` and `next build` never look at the API worker at all.
- `wrangler deploy` bundles with esbuild, which strips TypeScript types **without resolving them**. An undefined identifier compiles perfectly and only fails when a real request reaches it.
- The guard tests read the source as text; they confirmed the new OAuth logic was PRESENT, not that it could RUN.

**Fixed here:**

- The origin is derived from `request`, which the router actually has.
- **New gate — `tests/worker-compile-gate.mjs`** runs the real TypeScript compiler over `worker/src` and fails the deploy on undefined names (TS2304/TS2552). It deliberately ignores the worker's ~28 pre-existing strict-mode warnings: a gate that cries wolf gets bypassed, and this one has to stay in the deploy path.
- **DEPLOY.bat now runs that gate at step 3, before anything is published**, installs the API's own dependencies at step 2 so the gate can always run, refuses to run from a folder that is not this version, and **prints the live health of both domains at step 6** so the result is visible without asking anyone.

**Also in this release — "when I click mark complete, there is no popup notification":**

- Mark completed / Cancel session on the roster board were six copy-pasted inline handlers that fired the change and threw the answer away. Nothing confirmed the action, and a REJECTED change looked identical to a successful one — the card closed, the board reloaded, and the session quietly stayed scheduled. One shared handler now reports through the same centred confirmation used by Save, Reschedule and the PDF share ("Session completed — ELFIA · 19-08-2026 20:30"), says so when the change is refused, and only reloads the board when the write actually landed.
- The Live session schedule card's status dropdown had the same silence, with a worse edge: a refused change left the dropdown showing the new value while the database held the old one. It now confirms, and re-reads from the server either way.
- Both paths are proven end-to-end against the built portal (success and refusal) in `scratch/roster-toast-e2e.mjs`.

**Deploy notes:** site AND worker changed, no migration. Run `DEPLOY.bat` IN FULL from the v1.29.1 folder. Step 3 must print `[OK] API code has no undefined names`; step 6 must print `"version":"1.29.1"`.

## [1.29.0] — 2026-08-19 — a2zcreative.my goes live alongside azoneofficial.com

**Stage B: the domain. Zone confirmed in the production Cloudflare account (39fe816a…), Google OAuth entries added, so the cutover ships.** After this deploy plus two dashboard clicks, **a2zcreative.my and www.a2zcreative.my serve the complete system** — site, portal, admin, client area and API — while azoneofficial.com keeps working in full. Nothing is taken away; the new domain is added in front.

- **a2zcreative.my is now the primary domain**: canonical URLs, Open Graph, sitemap and structured data all name it; every NEW customer share link is minted on it. Every share link already sent keeps resolving on the old domain forever.
- **Google sign-in works on both domains** — the callback now follows whichever domain the sign-in started on (both are registered in your Google console).
- **Logins, CSRF and the API accept both domains** during the transition; stale tabs on the old domain keep working.
- **TikTok stays pinned to azoneofficial.com** until you update Partner Center — its callback and webhook URLs live there, which is one of the reasons the old domain is never switched off.
- The staff location self-help now names a2zcreative.my; DEPLOY.bat's final checklist now checks BOTH domains' health.
- New guard test (`tests/origins-guard.mjs`): fails the build if either domain's routes are dropped, if the origin order flips, or if the calendar UID domain is ever "modernised" (frozen at azoneofficial.com by design — changing it would duplicate every shift in staff phone calendars).

**AFTER DEPLOY.bat, two clicks by the CEO (60 seconds):** Workers & Pages → `azoneofficial` → Settings → Domains & Routes → Add → Custom Domain → `a2zcreative.my` — and once more for `www.a2zcreative.my`. That attaches the website; the API routes attach themselves during the deploy.

**What staff notice:** nothing, until you tell them the new address. Sessions are per-domain, so each person signs in once on a2zcreative.my when they switch. The installed phone app keeps working on the old domain; re-add the home-screen icon from the new domain whenever convenient.

**Deliberately NOT in this release:** the permanent redirect of azoneofficial.com → a2zcreative.my. That flips ONLY after we verify the new domain end-to-end, and it must exclude `/api/*` (TikTok still calls it). I will hand over the exact rule when we get there.

**Deploy notes:** site AND worker changed (no migration). Run `DEPLOY.bat` IN FULL, then do the two custom-domain clicks, then tell me — I will verify a2zcreative.my from here.

## [1.28.0] — 2026-08-19 — A2Z issues the documents · every old document stays AZ ONE forever · official logo

**Stage C of the migration: the legal document layer. Your decisions on record: "A2Z invoices, A2Z employs"; registered address 34-02 Jalan Setia Tropika 1/1; Maybank 5511 0086 5300 in A2Z's name; A2Z not SST-registered.**

**One rule governs everything: a document forever shows the entity that ISSUED it.**

- Every quotation, invoice, delivery order, receipt, credit note, claim and leave form created FROM THIS DEPLOY ONWARDS is issued by **A2Z CREATIVE MARKETING (SSM 202603003468 / CA0414729-A)** and instructs payment to **MAYBANK 5511 0086 5300 (A2Z CREATIVE MARKETING)**.
- Every document created BEFORE this deploy keeps **AZ ONE OFFICIAL's letterhead and AZ ONE's bank account, forever** — reprints, shares and the customer's saved links all still show the entity that was legally liable and the account they were told to pay. History is never rewritten.
- Payslips switch at RELEASE time: months you release from now on are A2Z payslips (A2Z is the employer of record); already-released months stay AZ ONE.
- HR forms became new controlled documents: A2Z claims print **A2Z-HR-CLM-001 v001** (leave: A2Z-HR-LVE-001 v001); old signed forms keep their AZOO-HR numbers and versions exactly as inked.
- The WhatsApp payment reminder now names whichever entity issued THAT invoice — chasing an old AZ ONE invoice still directs money to AZ ONE's account, so no transfer ever bounces on a name mismatch.
- Statement of Account, weekly roster, staff ID badge, HR reports and client monthly reports are operating documents of the current company and now carry A2Z.

**How it works underneath:** each document row carries an `issuer_code` stamped at creation (migration 0073 — six tables, additive, nothing existing touched). NULL means "issued before the switch" and always renders AZ ONE. The letterhead facts for both entities live in ONE file (`lib/issuers.ts`); all seven generators read from it, and none may touch the marketing identity.

**Proof, not promises:** a new render test (`tests/doc-issuer-render.mjs`) builds the SAME invoice both ways from the real shipped code and asserts 22 checks — including that a legacy invoice contains ZERO bytes of A2Z identity and an A2Z invoice never names AZ ONE's bank. A browser test renders the customer share page under both codes. The tripwire guard now enforces the A2Z contract: the exact account number, holder name and SST status cannot drift without failing the build, and AZ ONE's legacy entry may never be edited.

**Also in this release**

- **Your official A2Z Creative logo is live** — navbar, hero, white-on-navy variant, app icons, favicon and the social share card were all rebuilt from the artwork you sent. (The staff app icon shows the mark on the navy plate with gold CREATIVE.)
- The deploy-health check no longer lies: it tracked migration 0070 as "latest" forever; it now tracks the real latest (0073) from one constant, and migrations 0071/0072/0073 joined the health-card ledger and probes.
- The floating WhatsApp button's screen-reader label still said AZ ONE — fixed.

**Deploy notes:** site AND worker AND a database migration — run `DEPLOY.bat` IN FULL. From the moment it completes, the next invoice you raise is an A2Z invoice. Nothing needs re-entering; nothing historical changes.

## [1.27.0] — 2026-08-19 — A2Z CREATIVE MARKETING becomes the company; AZ ONE OFFICIAL becomes its consultancy

**Stage A of the migration (branding and positioning). No domain change, no database change, no authentication change, and not one document altered.**

**The company you see is now A2Z CREATIVE MARKETING** (202603003468 / CA0414729-A). The public website, the Staff Portal, the Admin Portal and the Client Portal all belong to A2Z. Live commerce is now presented as one strong service line among creative marketing, digital marketing, content creation, consultancy, business development and product development — it is no longer the whole identity.

**AZ ONE OFFICIAL is now a consultancy business unit with its own page.** A new `/consultancy` route presents it as _"AZ ONE OFFICIAL — A Consultancy Service by A2Z Creative Marketing"_, names it as a separate registered entity (202603168673 / JM1046169-H), and sets out what it advises on. Search engines are told the same thing: A2Z is the parent Organization and AZ ONE OFFICIAL is a sub-organization pointing back to it.

**ELFIA is no longer visible anywhere on the public site.** The case-study page, product photographs, wordmark, gallery, homepage client strip, FAQ entry, search-description mentions and the SEO keyword are all gone. The capability story survives, anonymised as "a premium modestwear label", so we keep the sales argument without naming a client. Two things were removed that mattered more than presentation:

- **The Terms page claimed the ELFIA name belonged to us.** That is a claim over an independent client's trademark. It is gone, replaced with an explicit line disclaiming any right in client marks.
- **The customer portal was advertising ELFIA's store to every logged-in customer** — including, potentially, their competitors. The card and its outbound link are deleted.

**Brand assets have been reissued.** The logo, white logo, social preview card, app icons and favicon all rendered the old AZ ONE mark, which would have contradicted every line of text on the page. They are now a clean A2Z wordmark in the existing navy and gold, in the same lockup style. **These are placeholders in the house typeface — replace them with your designer's artwork when it is ready; no code change will be needed, just the image files.**

**Your invoices, payslips, receipts and HR forms have deliberately NOT changed.** A2Z is a separate legal entity, and its registered address and bank account are not yet on file. Putting A2Z's name on an invoice while payment still goes to `MAYBANK 5516 2328 7032 (AZ ONE OFFICIAL)` would get transfers rejected. Every statutory and commercial document therefore still issues as AZ ONE OFFICIAL, and this is now **enforced**: a new `lib/issuers.ts` holds issuer identity as data, no document generator may read the marketing name any more, and a guard test fails the build if that changes. Switching the issuer to A2Z is deliberately a compile error until the address and bank account are supplied.

**Also in this release**

- The Android location self-help said _"find AZ ONE in Settings → Apps"_. The installed app is now captioned **A2Z Staff**, so that instruction would have sent staff hunting for an app that no longer exists. Fixed, and a guard test now keeps the two in lockstep.
- **Canonical URLs added site-wide** — there were none. This had to land before any future domain move or the search index would fragment.
- Every screen that was still English-only got its Bahasa Malaysia twin: the whole sign-in page, the crash-recovery screen, the admin console header and the portal version stamp.
- The service-worker cache key was bumped so old app shells are evicted on this deploy.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL. Staff will see the new name immediately; those with the portal installed on their phone should delete and re-add the home-screen icon to pick up the new name and icon.

## [1.26.3] — 2026-08-19 — The Android location mystery: it was our own security header

**"I still encounter location for the android phone" — found it, and it was never the phones.** The site ships a browser security instruction (`Permissions-Policy` in `public/_headers`, added with the v1.23.5 cache fix): `geolocation=()` — which means "forbid location for this whole website". Android Chrome and Samsung Internet obey it to the letter: instant "blocked", no prompt, no matter what the staff member allows in their settings. iPhone Safari ignores that particular directive — which is exactly why every iPhone worked and every Android was "blocked". The timeline matches to the day: the header first deployed with v1.23.5, and the Android complaints began immediately after.

**The fix is one word:** `geolocation=(self)` — our own pages may ask for location; embedded third-party content still cannot. Camera and microphone stay fully locked (nothing in the system uses them). IZZUDIN's and NURFARAH's phones will start giving real distances on their next clock-in after deploy — no phone settings to change, nothing for staff to do.

**Why three releases hunted the wrong suspect:** a policy-blocked build produces the exact same error as a user pressing "Block", so v1.25.2/v1.25.3 read it as a phone problem. That mislabelling is now impossible:

- The portal checks the build's own policy FIRST. If a build ever forbids location again, staff see _"Location is blocked by the website build itself — NOT your phone"_ (EN/BM), the punch records `NO LOCATION (site build blocked it — redeploy)` in red, and you know in one glance it's a deploy problem.
- A new guard (`tests/permissions-policy.mjs`) fails the build if `geolocation=()` ever reappears on a live header line, or if the self-diagnosis is removed.

**Proven in a real browser:** a simulated policy-blocked build records the punch as `no_location: policy` with the build-blame message; with the fixed header and permission granted, the same tap sends real coordinates (1.4927, 103.7414 → "at office"). The full BM sweep still passes.

**Historical punches:** the "NO LOCATION (blocked)" rows recorded since 17-08 were victims of this header, not staff misbehaviour — worth knowing before anyone is questioned over them.

**Deploy notes:** site-only change; zip cumulative (carries v1.26.2 CSRF self-heal + worker). Run `DEPLOY.bat` IN FULL. Staff need only reopen the portal.

## [1.26.2] — 2026-08-19 — The CSRF error heals itself · D1 blip wording covered · docs brought current

**Your second screenshot — "CSRF token mismatch or missing" next to SAVE — pointed at a different disease than the photo bug.** Save always sent the token… read from a cookie that was no longer there. A browser can keep your (protected, HttpOnly) session cookie while cleaning out the script-visible `csrf_token` one — and in that state EVERY save on every tab fails until you log out and back in. v1.26.1 could not fix that, because the problem was not a missing header; it was a missing cookie.

**Now the system heals itself, two ways:**

1. **Every page load repairs the cookie.** The sign-in check (`/auth/me`) now re-issues a fresh `csrf_token` whenever you arrive with a valid session but no token cookie.
2. **Every save repairs itself mid-flight.** If a save is rejected with the CSRF error, the app silently fetches a fresh token and retries once — you just see "Saved". A real forgery attempt still fails: an attacking site can never read the token, and only the original request is replayed. Proven in a real browser: first attempt rejected → token re-issued → retry accepted, with no error shown.

**All raw upload calls now go through one sanctioned door.** v1.26.1 patched 12 calls by hand; v1.26.2 replaces every one (15 sites) with `csrfFetch()` from the shared API layer, so they all self-heal too. The build guard is stricter: a bare mutating `fetch()` anywhere now fails the check outright, even with a hand-attached header.

**The 11:01 error log** (`/staff/notifications` — "D1 DB storage operation exceeded timeout which caused object to be reset") is the same self-healing database blip family v1.25.2 covered, in new wording the retry pattern did not match — so the retry never fired and staff saw a red error. Pattern broadened; reads now retry once on this wording too.

**Docs brought current (your instruction: "update md files for everything that you have done"):** CONTRIBUTING.md gains the production house rules (api()/csrfFetch only; L(en, ms) at every display point; grid-cols-1 base; one version number) and the full test inventory to run before every zip; SECURITY.md documents the CSRF design, its three-outbreak leak history and the self-heal; ARCHITECTURE.md and API.md describe every subsystem added v1.18 → v1.26 (i18n, skeleton+cache, shift attribution, transient D1 retry, notifications stream, endpoint changes).

**Important:** the error in your screenshot will keep appearing until this zip is DEPLOYED — the fix cannot reach the phone before `DEPLOY.bat` runs. Site AND worker changed — run it IN FULL, then do one hard refresh (or just reopen the portal) and saves work again without re-login.

## [1.26.1] — 2026-08-19 — Every upload works again: the CSRF leak class is closed for good

**"Photo upload failed — CSRF token mismatch or missing" (your screenshot on the Staff Details tab).** The server rightly rejects any change-request that doesn't carry the anti-forgery token — the shared `api()` helper attaches it automatically, but the staff-photo upload was written as a raw browser call that never attached it. Same disease as v1.23.1 (change-password / assets / payroll), different limb.

**This time the whole body was X-rayed, not just the limb.** A new automated guard scans every file for raw change-requests missing the token — and it found not one but **twelve** broken calls:

- **Staff Details:** row photo upload (your screenshot), new-staff-record photo, staff vault document upload
- **Claims:** receipt upload (new claim + edit), receipt attach on a row, payment-proof upload
- **Customer enquiries:** setting the status, sending an in-app reply
- **Tab access:** saving who sees which tab
- **Admin console:** media upload
- **Customer account:** submitting an enquiry — and the public contact form, which silently failed for anyone who happened to be logged in

All twelve now attach the token. Every save/upload flow above works again.

**It cannot quietly come back:** `tests/csrf-guard.mjs` fails the build the moment anyone writes a raw change-request without the token (that guard is how nine of the twelve were found — the screenshot only showed three). Verified end-to-end in a real browser: the staff photo upload now sends the exact token the server expects; all 23 tabs re-swept clean in BM after the change.

**Deploy notes:** site-only fix; zip cumulative (carries v1.26.0 BM everywhere + v1.25.6 worker). Run `DEPLOY.bat` IN FULL.

## [1.26.0] — 2026-08-18 — BM everywhere: the whole system translates, not just the chrome

**Toggling BM now translates every page (CEO: "When I toggle BM, all the pages doesnt translate to BM!").** Since v1.9.0 the translation deliberately covered only the chrome — nav, greeting, dashboard cards, roster read surfaces. Everything deeper (claims forms, payroll, inventory, sales documents, finance, admin console…) stayed English. That scope is gone: the sweep covered **43 files, roughly 2,300 strings**, so the EN/BM toggle now flips the entire system live, without a reload.

**What's covered now, tab by tab:** Dashboard, Attendance (incl. monitor, personal table, team report, OT approvals, attendance admin), Schedule & Roster (incl. the edit/assign modals and toasts that stayed EN in v1.23.2), Ecommerce (leaderboard, targets & commission, TikTok orders, ops map, fulfilment, connection status), Inventory (movements, stock-out, supplier returns, postage), Sales (customers, quotations/invoices/DOs, aging, enquiries), Claims (form, approval chain, receipts), Payroll (runs, payslips screen, M2E flow), Finance / Reconciliation / Commission / Ads Fund / Purchasing / Accounting, Tasks, News, HR (incl. the payslip/payroll summary card), Staff Details (directory, records, vault, onboarding), Stokis, Assets, Content, Users, Profile (incl. 2FA setup and change-password), plus the search palette, data tables, dialogs and calendar.

**The admin console and customer account got the same treatment** — both now have the same EN/BM toggle in their headers (they had none), and their screens are translated, keeping the three shells consistent.

**What deliberately stays English:** printed/official documents (payslip PDF, claim form AZOO-HR-CLM-001, leave form, SOA, staff ID badge) — an official document must not change with the operator's screen language; raw codes and proper nouns (TikTok, RM, SKU, INV/QT/DO, role codes); and server error messages passed through from the API.

**How it's built (for the next release):** every string is wrapped at the DISPLAY point with `L("English", "BM")` reading the saved language per render — values used in logic, comparisons and API payloads are untouched English underneath, so nothing behavioural changes. EN mode is byte-identical to v1.25.6.

**Guard test:** `tests/bm-coverage.mjs` — walks all 23 portal tabs as CEO with BM active and FAILS if common English UI words appear or any tab crashes. Verified: all 23 tabs clean in BM, zero crashes; EN mode shows zero BM leaks; the toggle flips the whole page live.

**Deploy notes:** site-only change, but the zip is cumulative and carries the v1.25.6 worker (shift sales attribution) — run `DEPLOY.bat` IN FULL.

## [1.25.6] — 2026-08-18 — Sales marketing's clocked-in hours capture their TikTok sales

**The leaderboard now credits sales marketing for the shop they actually run (CEO: "sales marketing when clock in then it is supposed to capture their sales").** NUR NASUHA showed RM 0.00 in v1.25.5 because none of the three attribution sources could ever reach her: she is not the salesperson on invoices, she does not host lives, and TikTok orders had no route to her at all. Now they do:

- **Every TikTok order that lands while a sales_marketing person is clocked in is credited to them.** Her attendance clock-in/clock-out IS her shift window — no extra setup, no new screens. The moment she clocks in tomorrow, the day's TikTok orders start counting on her line.
- **All orders during the shift count — including during a live** (your call). The live host keeps their live-session credit too, so an order in a live window appears on both lines.
- **Two sales marketing on shift at once → the order is split equally** (your call), remainder sen to the first, so the team's lines always add up to real money.
- **A forgotten clock-out cannot hoover up the night.** A shift with no real clock-out is cut off at 23:59:59 that day; a genuine overnight shift (real clock-out after midnight) is honoured as punched.
- **Marketing is off the board (CEO: "Marketing doesnt make any sales on TikTok!").** NURFARAH and ZUL HISYAM no longer appear at RM 0.00 — the board lists only people who sell: sales marketing, live hosts, CCO. They would reappear only with an actual sale, a paid invoice they closed, or a target.

**Backdating note:** attribution is computed from attendance records, so this month's PAST orders also credit her retroactively for any day she was clocked in — the board updates the moment the worker deploys, not just from tomorrow.

**Guard tests:** `tests/shift-sales-split.mjs` runs 9 scenarios against the real shipped code (`worker/src/shift-sales.ts`, imported directly — not a copy): full credit on shift, nothing off shift, equal split with no lost sen, open shifts counting up to now, forgotten clock-outs capped, real overnight shifts honoured. `tests/leaderboard-sales-floor.mjs` now also asserts marketing stays off the always-listed roles and the clock-in attribution stays wired and scoped to sales_marketing only.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL.

## [1.25.5] — 2026-08-18 — The whole sales floor is on the leaderboard

**Sales Marketing was missing from the board (CEO: "my Sales Marketing should include into this Sales leaderboard — this month").** The leaderboard only listed people who already had attributed sales or a set target, so NUR NASUHA (sales_marketing) — with neither this month — was dropped from the list entirely. The board read as if she is not part of the sales floor.

**Now the sales floor is always listed.** Sales marketing, live hosts, CCO and marketing appear every month, at RM 0.00 if that is the truth. Everyone else (editor, HR, and so on) still appears only once they have sales or a target, so the board does not fill with people who do not sell.

- **Ranks are for earners.** A person with sales gets 1, 2, 3, …; a person at zero shows a dash instead of a rank number, so the podium still means something and a blank month is visible at a glance rather than hidden.
- **Walk-in / manual sales now count.** A manual "Out −" with a sold price — the offline sale at a venue — is credited to the staff member who recorded it, alongside paid invoices they closed and TikTok GMV during their live sessions. That was the missing third source: a sales person who sells offline had no way onto the board.
- **No emoji on the card.** The trophy and medals are gone, replaced by a gold rank badge for the top three, in line with the house rule (SVG only).
- **The card no longer flashes empty.** It paints a skeleton while the board loads instead of nothing.

**Why NUR NASUHA still shows RM 0.00:** nothing has been attributed to her this month. She earns a rank the moment she is set as the **salesperson** on an invoice that gets paid, records a **walk-in sale** with a price, or hosts a **live session**. Setting her a monthly target under "Targets & commission" also gives her a progress %.

**Guard test:** `tests/leaderboard-sales-floor.mjs` — asserts the sales-floor rule in the worker source and that a zero-sales sales_marketing person actually renders on the board, unranked and emoji-free.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL.

## [1.25.4] — 2026-08-18 — Bottom-nav labels stop getting sliced on iPhone

**The labels were being clipped along their bottom edge (CEO: "Why bottom nav like this?!!!").** Two causes, both measured:

1. **The text box was half a pixel too short for the font.** Each label sat in a 17 px box with a 16.5 px line, and the label is clipped (`truncate`) so long BM names never wrap. Chromium squeaked through; iPhone Safari renders Poppins a shade taller and sliced the bottom off every word. The labels now get a proper line box — 18 px of room for a 17.6 px line — so the glyphs can never touch the edge.
2. **The breathing room under them vanished.** The nav's bottom padding comes from the phone's safe-area inset, and iOS Safari reports that as **zero** while its floating toolbar is on screen — so the labels ended up flush against the bottom. There is now a guaranteed minimum, whatever the phone reports. Clearance under the labels went from 8 px to 14 px.

Fixed on all three phone navigations — staff portal, admin console and the customer area — so they stay identical.

**Deploy notes:** site-only; zip cumulative (carries the v1.25.3 worker: no-location punches + indoor GPS). Run `DEPLOY.bat` IN FULL.

## [1.25.3] — 2026-08-18 — Nobody loses attendance to a stuck phone permission

**NURFARAH's phone is genuinely blocking the site (and v1.25.2's advice was unfollowable).** Her Android screenshots show the OS permission granted, and the new message correctly reported "blocked for this site" — so Samsung Browser itself is refusing. But her portal has **no address bar**: she opens it from the home-screen icon, where the "tap the padlock/⋮ menu" instruction does not exist. Telling someone to tap something that is not there reads as a broken system.

**The Dashboard now shows her the right steps.** A "Show me how to fix it" link appears under a blocked-location message with instructions chosen from what her phone actually is — installed home-screen app (Android Settings → Apps → Permissions → Location), Samsung Internet, Chrome, Firefox or iPhone Safari — in English or BM. All detection is local to the device.

**And a blocked permission no longer costs anyone their attendance (your decision: "record it, flag it loudly").** The punch is now accepted and stored as **NO LOCATION** with the reason, instead of being refused:

- The staff member is told plainly: _"Clocked in — without location. Recorded and flagged for HR."_
- The attendance register and Today's monitor show it in **red** — "NO LOCATION — phone blocked it" — clearly different from the muted blank of older records that predate the GPS rule.
- **HR, the COO and the CEO get a notification** naming the person and the reason.
- It cannot become a silent bypass: the app must state _why_ there is no fix; a punch with no location and no reason is still refused, exactly as before.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL. NURFARAH can clock in and out normally the moment this is live; her punches will be flagged until she fixes the permission with the on-screen steps.

## [1.25.2] — 2026-08-18 — Staff can clock in indoors · two dead queries · every query now schema-checked

**Staff could not capture location — and it was our fault, not their phone (staff: "the location was not capture which is they already toggle on the location permission!").** Their screenshots showed Android permission correctly set to "Allow only while using the app" with precise location ON. The bug: we asked for a **high-accuracy (satellite) fix with a 10-second limit**. A satellite fix is exactly what does _not_ work inside a building — and inside the office is precisely where staff clock in. The request timed out, we reported "no location", and told them to fix a permission that was already correct. Location is now requested in two stages: a short satellite attempt (instant outdoors), then a fallback to **network positioning** (wifi/cell), which answers in about a second indoors and is accurate to tens of metres — comfortably inside the 120 m office fence. A genuine refusal short-circuits at once. Verified against three simulated phones: indoors-with-timeout now **captures location and clocks in**; genuine denial and no-signal each get their own honest message. And the wording is fixed — "blocked" is only said when it is actually blocked, and it now points at the browser's **site** setting (the padlock/⋮ menu), which is the one people miss.

**Two queries that had never worked.** `/hosts` asked for a `suspended` column the users table has never had (the house convention is `is_active`), so the commission host picker was always empty. And a per-host GMV figure asked `postage_records` for `tracking_ref` instead of `order_ref`, silently reporting zero for every host.

**Every query is now schema-checked before it can ship.** Three production 500s in two days were all the same shape — a query naming a column that does not exist, which SQLite only complains about when it runs. `tests/sql-schema-check.mjs` rebuilds the real database from your migrations, extracts all **615** SQL statements from the worker and asks SQLite to prepare each one. It found the `tracking_ref` bug above before you ever saw it. (It also caught itself: an early version passed vacuously because a tool was missing — it now refuses to report success if the schema fails to build.)

**Transient database blips no longer show staff an error** (error log 18-08 09:36, "/staff/announcements — D1_ERROR: Network connection lost"). That is Cloudflare's database link dropping mid-query, not a fault in our code. A read is now retried once after a brief pause; writes are never retried, so a punch or a post can never be duplicated.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL. After deploying, have the staff member who reported it tap **Check my location** on the Dashboard: it should now show her distance from the office.

## [1.25.1] — 2026-08-17 — The portal no longer states a wrong answer while loading

**What the screen recording actually showed (CEO: "there is a loading like that, which is should appear as a Dead Skeleton").** Pulling the video apart frame by frame: for the first half-second the Quick actions card displayed a green **"📍 Clock in"** button and **"No attendance recorded today."** — then corrected itself to **"Clocked in ✓ / Clocked out ✓ · Today: clock in 09:13 · clock out 18:50"**. That is not slow loading; the portal was telling a staff member they had not clocked in, and inviting them to clock in again, when they already had. A double-punch waiting to happen. (The grey ring floating over the recording is the phone's AssistiveTouch button, not part of the app.)

**Root cause — and it was everywhere.** Every card started its data as _empty_ (`[]`, `0`), which is indistinguishable from _"loaded, and genuinely nothing there"_. So during the fetch each card confidently rendered the empty answer. v1.25.0's skeleton fixed the blank page and the cards that literally said "Loading…", but cards that quietly default to empty still flashed a wrong answer — 88 such initialisations, 11 of them printing a definite "nothing here" message.

**The rule now: unknown until proven empty.** Data is either _not known yet_ (→ skeleton) or _known_ (→ real content, including a genuine "None pending"). Applied to the Quick actions buttons and the "Today: …" line, the desktop KPI strip, the phone "This month" figures (which flashed 0 · 0.0 · 0/0), and Pending leave / My open tasks / News.

**Attendance now also remembers.** Your own punches are personal and non-financial, so they are shown instantly from the device's memory on repeat opens — not skeleton-then-truth, but the truth immediately. **And the Dashboard's four requests, which ran one after another (four round-trips stacked end to end on a phone), now run together.**

**A permanent guard.** `tests/no-false-attendance.mjs` replays your exact situation — clocked in 09:13, out 18:50, deliberately slow server — and polls every 100 ms through the whole load, failing if the portal ever renders "No attendance recorded today", a green "Clock in", or "Not clocked in yet" while the punches are unknown. First visit and repeat visit both pass with zero violations.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.8 worker). Run `DEPLOY.bat` IN FULL.

## [1.25.0] — 2026-08-17 — Instant skeleton, Threads-style: staff never watch a blank screen

**The white screen is gone (CEO: "I want to have a dead skeleton waiting for my website like a Threads so that my staff wont see any loading").** Measured on the previous build: `portal.html` painted **nothing**, so staff stared at white while 1,174 KB of JavaScript downloaded, then while the sign-in check answered, then while ~20 cards each fetched their own data. Three separate blank phases — all three fixed:

1. **Instant silhouette, zero JavaScript.** The site is a static export, which means whatever the portal renders on its first pass is baked into the HTML file — and that was `null`. It is now a full app skeleton: navy rail, header, greeting, next-event band, quick-action pad, stat tiles, attendance ring, bottom nav. Verified with **JavaScript completely disabled**: 56 shimmering blocks and 1,109 px of app silhouette paint from the HTML alone, before a single byte of script runs.
2. **Remembered data on every repeat open.** Each card's last successful data is kept on the device (per account, 24-hour ceiling) and painted immediately on the next visit — no skeleton at all for anything already seen. Verified against a deliberately slowed API: nine money figures on screen at 900 ms while the server was still 2.5 seconds away.
3. **Shape-matched skeletons instead of "Loading…".** Every remaining "Loading…" line across the portal and customer area is now a skeleton shaped like the content it replaces, so nothing jumps when data lands.

**Money is marked while it refreshes (your choice).** Financial cards show their remembered figures instantly with a subtle gold "updating…" dot beside the date, which disappears the moment fresh numbers land — nobody reads a stale amount as final. Cache is wiped on sign-out and whenever a different account signs in on the same device.

**Speed, not just polish:** no minimum skeleton time (real content wins the instant it exists), skeletons sized to the real content so the page never jumps, and the shimmer freezes automatically for staff who have reduced-motion switched on.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.8 worker). Run `DEPLOY.bat` IN FULL. Expect the very first open after deploying to still fetch everything once — that visit is what fills the memory; every open after it is instant.

## [1.24.1] — 2026-08-17 — Operations map refreshes on TikTok sync

**The state map updates the moment a sync lands (CEO: "Operations map — orders by state should be updated accordingly when I click on button sync from TikTok").** A successful "Sync from TikTok" now announces itself to every listening card, and the Operations map re-pulls the buyer-state distribution immediately — new orders appear on the map and in the side panel without reloading the page. (The same signal is available for future cards that show order-derived data.)

**Deploy notes:** site-only; zip cumulative (carries the v1.23.8 worker). Run `DEPLOY.bat` IN FULL.

## [1.24.0] — 2026-08-17 — Tab memory, refined: refresh keeps your place, closing starts fresh

**Exactly the behaviour you described (CEO: "if they refresh it will remain to the last page that they visit… go back to dashboard if the staff close their web/mobile browser").** Tab memory now lives in the browser's session storage, which has precisely those semantics: a REFRESH keeps the tab you were on; CLOSING the tab or browser clears it, so the next open starts on the Dashboard. Per-user key and the role clamp keep the shared-device guarantee (a lower-role account can never restore a restricted tab), and a crashing tab can only affect one browser session — never every future visit. The crash-recovery screen's "Back to Dashboard" clears the new memory too.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.8 worker). Run `DEPLOY.bat` IN FULL. Verified: switch to Inventory → refresh → still Inventory; open in a fresh browser → Dashboard.

## [1.23.9] — 2026-08-17 — The overlap/clip culprit, caught and fixed everywhere

**Your screenshot WAS the culprit (CEO: "Culprit!!! It is overlapped and clipped to the line there right!!!").** The giveaway is the "Available today" list: the long staff names render in FULL and push the roles off the right edge — on a correct layout those names truncate with "…". Cause: layout grids across the app declared their columns only from tablet/desktop breakpoints up; below that they relied on the browser's implicit grid column. Chrome and new Safari clamp that implicit column to the screen — the iPhone's Safari sizes it to the WIDEST CONTENT (a long staff name, a wide table), which blew the roster card ~40px past the screen: everything inside shifted, overlapped the edge and got clipped. That is why it could never be reproduced anywhere but on the phone. Fix: every layout grid in the app (46 of them, portal + admin + account + website) now declares an explicit phone-first column (`minmax(0, 1fr)`), which every Safari version respects — names truncate, roles stay on screen, nothing exceeds the phone. Combined with v1.23.8's body clip + overflow reporter, this class of bug is now fixed, guarded, and self-reporting.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.8 worker: TikTok pagination/status fixes + overflow reporter endpoint + health version). Run `DEPLOY.bat` IN FULL, fresh-open on the phone, confirm More says v1.23.9 — and the Attendance tab should finally sit flush inside the screen with names ending in "…" where they're long.

## [1.23.8] — 2026-08-17 — TikTok statuses fixed + the iOS overflow mystery solved at the root

**TikTok orders no longer sit on "Preparing" forever (CEO: "TikTok order show preparing while it is already completed").** Three holes, all closed: (1) the sync fetched only the FIRST 50 orders of the 30-day window — once the shop passed 50 orders, older ones never got their status refreshed; the sync now follows TikTok's pagination (up to 300 orders per pass). (2) An order whose status field was missing from TikTok's response was actively knocked BACK to "preparing"; a missing status now leaves the record untouched. (3) "COMPLETED" now maps to delivered in both the sync and the webhook. ALSO — the card header says "signature FAILED — check app secret": the webhook secret no longer matches TikTok Partner Center, so live status pushes are being rejected. That is a SECRET, not code: run `npx wrangler secret put TIKTOK_APP_SECRET` (in the worker folder) with the current app secret from Partner Center, or statuses only update on the 30-minute sync.

**The mobile overflow saga — root cause finally identified.** `body { overflow-x: hidden }` (globals.css) is honored by every desktop engine but IGNORED by iOS Safari — so wide elements panned the page on iPhones while every test engine (and the overflow detector's logic) reported the page clean. Fixed three ways: body now also carries `overflow-x: clip`, which iOS 16+ DOES honor; the portal gained a self-reporting overflow detector — on phones, 2 seconds after each tab renders, anything poking past the screen edge is logged to the error log (source: ui_overflow, admin → Audit → System health) with the exact element, build version and tab, once per tab per session; and the detector deliberately ignores body/html/shell clips so nothing can mask a culprit again. Verified end-to-end: a deliberately-wide element is reported by name.

**Staff clock-in "Location was blocked":** not a system fault — Safari's per-site location permission is denied on that phone (the device-level Location toggle is a different switch). Fix on the phone: Settings → Privacy & Security → Location Services → Safari Websites → While Using + Precise ON, then in Safari on azoneofficial.com: AA → Website Settings → Location → Allow, reload, "Check my location".

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL, plus the `wrangler secret put TIKTOK_APP_SECRET` above for live webhook statuses. After deploying, press "Sync from TikTok" once — the stuck "Preparing" orders will take their real statuses on that pass.

## [1.23.7] — 2026-08-17 — Clients summary D1 error fixed

**The `/staff/clients/summary` server error is fixed (error log 17-08 15:16: "D1_ERROR: no such column: c.name").** The clients directory query asked the customers table for a `name` column that never existed — the table stores the person as `contact_person` — so the endpoint failed on every call: the clients card showed its error state and the command palette silently skipped client results. The query now aliases `contact_person AS name` (the shape the portal already expects), validated against the full migrated schema.

**Deploy notes:** WORKER change — run `DEPLOY.bat` IN FULL (step 3). No migration. Nice side-effect of the new tooling: this bug was found from the error log alone, and /api/v1/health will confirm the worker is on 1.23.7 after the deploy.

## [1.23.6] — 2026-08-17 — Roster status from the Dashboard · refresh opens Dashboard · roster card clip

**Update session status right on the Dashboard (CEO: "On the dashboard, I cant update their status roster").** On "Assignments today", managers (CEO/COO/CCO/HR admin + admin tier) tap a status chip (it now shows a ▾): a scheduled session opens "✓ Mark done / ✕ Cancel session", a finished one offers "Back to scheduled". Same PATCH the roster board uses, hosts are notified per the usual rules, the card refreshes instantly, and staff see the same list read-only. Works in both the phone rows and the desktop table.

**Refresh always opens the Dashboard (CEO: "make the page when refresh back to dashboard instead of last tabs visit").** The last-visited-tab memory is retired: while you work, tab switches behave exactly as before and every save reflects immediately (each panel reloads its data the moment a save succeeds — plus the v1.23.5 cache policy keeps hard refreshes fresh); but any reload or reopen starts on the Dashboard, predictably. This also permanently removes the "a crashed tab reopens on every visit" lockout mode. Old remembered-tab entries are cleaned from the browser automatically.

**Attendance overflow — third guard + the check that settles it.** All engines available here (Chromium AND real WebKit, with the real Poppins font, manager and staff data) render the current build exactly screen-wide, and a static sweep confirmed every table sits in a scroll container. The roster card now carries its own phone-level clip on top of the v1.23.4 shell clip, so no build state can show the card cut past the screen edge. On the phone after deploying: More sheet must read v1.23.6 — if an older number shows, the phone is on a cached build (fixed permanently once v1.23.5+'s cache policy lands once); if v1.23.6 shows, send a screenshot together with the stamp.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.5 worker: health version + the v1.23.1 security fixes). Run `DEPLOY.bat` IN FULL, then fresh-open the site on the phone once.

## [1.23.5] — 2026-08-17 — Phones stop holding old builds (cache policy) + worker version in /health

**The REAL chronic bug behind "still overflow" (CEO, third screenshot).** The v1.23.4 build cannot pan sideways — the clip guard was verified against a deliberately 600px-wide element, and the audits were re-run with the real Poppins font at 390px and 430px, manager and staff, landing straight on Attendance: page width never exceeds the screen. A panning screenshot therefore means the phone is STILL rendering an older build — and this release fixes why that keeps happening: the site shipped NO cache policy, so phones re-used cached pages long after every deploy. Now every page carries `Cache-Control: no-cache` (browsers revalidate on every open — a cheap 304 when nothing changed, the new build the instant a deploy lands) while the hashed build files under /_next/static are immutable (never re-downloaded until their name changes). After THIS deploy reaches the phone once, no build should ever lag again.

**Worker version in the public health probe.** `/api/v1/health` now answers `{ ok, db, version }` — so "which build is the API worker on?" is checkable from anywhere, matching the site's visible stamp (More sheet + login page, added in v1.23.4).

**Deploy notes:** run `DEPLOY.bat` IN FULL. Then on the phone: close the tab completely, open azoneofficial.com fresh, and check More → bottom line says **v1.23.5**. (This one deploy may still need the manual fresh-open — it's the deploy that INSTALLS the no-cache policy; every deploy after it is picked up automatically.) If the stamp says v1.23.5 and anything still overflows, screenshot it together with the stamp.

## [1.23.4] — 2026-08-17 — Phone pages can never pan sideways again + visible version stamp

**A structural no-overflow guarantee (CEO: "Still overflow for Attendance").** The current build audits clean — landing straight on Attendance at 390px and 430px, manager and staff views, with long client names, conflicts, on-leave and requests, the page width never exceeds the screen. What the phone showed is the OLD build's Dashboard bug (v1.23.3's table) panning the page, plus iOS keeping that zoomed-out state on every tab until the page is reloaded. Two things make this class of problem impossible to see again: (1) the app shell now clips horizontal overflow on phones — verified by injecting a deliberately 600px-wide element: the page stays exactly screen-wide instead of panning; any future too-wide card clips at the edge and shows itself immediately in testing, without breaking the whole page for staff. (2) …

**A visible version number (new, permanent).** The portal's More sheet now ends with "AZ ONE staff portal · v1.23.4" and the sign-in page shows the same stamp — so "is the live site actually on the new build?" is answered by glancing at any phone instead of guessing. The number comes from package.json at build time; after every DEPLOY.bat, check it once.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.1 worker). Run `DEPLOY.bat` IN FULL, then on the phone: reload the tab once and confirm the More sheet says v1.23.4. If the overflow was still visible before this deploy, that confirms the phone was on the old build — the stamp ends that ambiguity for good.

## [1.23.3] — 2026-08-17 — Mobile overflow killed at the source

**The sideways overflow is fixed (CEO: "I saw on mobile view apps overflow").** Root cause measured, not guessed: the Dashboard's "Assignments today" card renders a four-column table (HOST · CLIENT · TIME · STATUS) whose minimum width is ~430px — wider than a phone. It stretched the whole page sideways, so every card's right edge was cut, and because iOS Safari keeps the zoomed-out view after that, other tabs (your roster screenshot) looked cropped too even though they fit. On phones the card now renders agenda-style rows — the roster's proven no-overflow pattern: fixed time column, truncating client + host, shrink-proof status chip. The table stays from tablet width up (in its own scroller, defensively). The dashboard card grid also gained the min-width guard (same class of bug as the v1.22.5 staff-grid drift: a grid track stretched by one wide child), so no future card can pan the page again. Verified at 390px: page width exactly matches the screen on Dashboard and Attendance, zero elements past the edge.

**Deploy notes:** site-only; zip cumulative (carries the v1.23.1 worker). Run `DEPLOY.bat` IN FULL. If a phone still looks zoomed out after deploying, close and reopen the tab once — iOS keeps the old zoom until the page reloads.

## [1.23.2] — 2026-08-17 — BM covers what staff actually see

**BM is consistent now (CEO: "Why some doesn't change to BM? I need to make sure everything change to BM when BM toggle on").** Two kinds of gap were fixed. (1) Tabs added after the translation system was built — Finance, Reconciliation, Commission, Ads Fund, Purchasing, Accounting — never got BM entries, so they stayed English in the bottom bar, More sheet and sidebar. (2) Whole staff-facing surfaces never called the translator at all: the Dashboard cards (Pending leave → Cuti menunggu, My open tasks → Tugasan terbuka saya, News → Berita, Today's sales · LIVE → Jualan hari ini · LANGSUNG, Revenue/target → Hasil/sasaran, All-time → Keseluruhan, Needs attention → Perlu perhatian with all its rows) and the entire Schedule & Roster board (Jadual & Roster: title, chips dijadualkan/tersedia hari ini/bercuti/pertindihan, Hari ini, PDF — kongsi pelan, Minggu …, day names ISN/SEL/RAB/KHA/JUM/SAB/AHD, sesi counts, HARI INI chip, on-leave and rails). Verified in BM on phone: Dashboard and the roster read Malay end to end.

**Scope note (deliberate, same principle as v1.9.0):** management tooling — the assignment/edit dialog, finance tables, admin console — stays English for now; a half-translated data form is worse than a clean bilingual staff surface. If you want deep-panel BM tab by tab (Leave forms, Claims, Profile next), say which tabs and they'll be done in order.

**Deploy notes:** site-only; the zip is cumulative (carries the v1.23.1 worker — 2FA + password fixes). Run `DEPLOY.bat` IN FULL.

## [1.23.1] — 2026-08-17 — Google sign-in 2FA enforced + CSRF fixed on change-password

**Google sign-in no longer bypasses 2FA (CEO: "when my staff login using Google, there is no 2FA appear which is incorrect flow … this is something that you leak!").** Password sign-in has always refused to mint a session for an account with 2FA enabled until a valid authenticator code is entered — but Google sign-in minted the session immediately, walking straight past that control. Now the Google callback follows the exact same flow: 2FA on → no session; a 5-minute single-use challenge is handed to the sign-in page, the same code screen appears, and the session is created only by a valid code (same 5-attempt limit and rate limiting). Customer accounts still land on /account, staff on /portal, admin tier on /admin — nothing about the routing changed.

**2FA is now mandatory for EVERY staff role (CEO decision).** Previously only management (CEO, COO, CCO, HR admin, admin tier) was forced to enrol; live hosts and marketing could skip it — which is why no 2FA appeared for a live host at all. Every staff role now hits the "Two-Factor Authentication Required" setup screen on first sign-in — Google or password — and cannot enter the portal until enrolled. Customers stay exempt.

**"CSRF token mismatch or missing" on Change password — fixed (staff report).** The change-password form was the last surviving raw fetch() on a mutating route: it never attached the X-CSRF-Token header, so the server's CSRF shield rejected every self-service password change, for everyone. It now goes through the shared api() helper like everything else. The same latent leak was found and fixed in two more places: asset register saves and the payroll M2E template upload.

**Deploy notes:** site AND worker changed — run `DEPLOY.bat` IN FULL. After deploying: staff without 2FA will be asked to set it up on their next sign-in (they need an authenticator app — Google Authenticator or similar); tell them to keep their backup codes. Requires v1.22.9's password fix to be live for password changes to actually save.

## [1.23.0] — 2026-08-17 — The portal sidebar on /admin and /account

**The navy icon rail is now on /admin and /account too (CEO: "Where is the sidebar for /account and /admin as same as /portal?").** Both surfaces use the exact SidebarNav component the portal uses — logo at the top, one icon per section with the active one in a gold tile, sign out at the bottom — fed their own sections (admin: Dashboard→Advanced with Users/Staff/Audit gated to the admin tier; account: Account / Orders / My Enquiries). The old desktop pill rows are retired — the rail is the desktop navigation, exactly like the portal — and the admin desktop heading now names the active section. Phones are untouched: bottom navigation and the More sheet behave exactly as before.

**Deploy notes:** site-only change; the zip is cumulative (carries the v1.22.9 password fix worker) — run `DEPLOY.bat` IN FULL.

## [1.22.9] — 2026-08-17 — Password set/change works again (Workers PBKDF2 cap)

**Setting or changing any password works again (CEO: "why I cant change their password? I need to reset their password!!!").** Root cause found and confirmed: the v1.4.280 security-audit change raised password hashing to 310,000 PBKDF2 iterations — but the Cloudflare Workers runtime hard-caps PBKDF2 at 100,000 iterations (an anti-DoS platform limit, cloudflare/workerd#1346) and throws above it. Since 10-08, every password operation that CREATES a hash — admin Set password, staff change-password in Profile, new-user creation, 2FA backup codes — failed with "Something went wrong. The error has been logged." (v1.22.7's honest failure toast is exactly what surfaced it.) Sign-ins were never affected because stored hashes carry their own iteration count. Hashing now runs at 100,000 — the platform maximum — and the deviation is documented in SECURITY.md; the server-side pepper means a stolen database dump still cannot be cracked without the Worker secret.

**Deploy notes:** WORKER change — run `DEPLOY.bat` IN FULL (step 3 must deploy `azoneofficial-api`). Then retry Set password: you'll get the green "Password set" popup. No migration.

## [1.22.8] — 2026-08-17 — Overnight sessions flow correctly + /admin and /account on the portal shell

**Timeline: sessions past midnight now flow correctly (CEO: "timeline for the 8 to 10pm was not flow correctly!").** A session ending past midnight (20:30–00:00) has an end time smaller than its start, so the duration went NEGATIVE — the timeline drew a flat 22px sliver, and the staff grid and PDF called it "30 min". An overnight end now counts as next-day everywhere: the timeline block flows down to the visible edge (23:00), and the staff grid, weekly hour totals and the share-plan PDF all say the real duration (20:30–00:00 = 210 min / 3.5 hrs).

**/admin and /account now follow the portal UI (CEO: "for /admin and /account also I found doesnt follow UI/UX as /portal").** Both surfaces sit on the exact same shell as the staff portal — navy backdrop, rounded light canvas, internal scroll on desktop — and every admin section (Dashboard, Enquiries, Posts, Portfolio, Testimonials, Media, Website, Advanced, Users, Account) now renders inside the house card, like every portal module. Phones are untouched: the mobile headers, bottom navigation and More sheet behave exactly as before (the shell is desktop-only by design, same as /portal).

**Deploy notes:** site-only changes this time, but run `DEPLOY.bat` IN FULL as always — if you haven't deployed v1.22.7 yet, this zip carries everything cumulative (worker included).

## [1.22.7] — 2026-08-17 — Inventory crash fixed + crash recovery screen + honest edit toast + set-password popup

**The Inventory white-screen is fixed (staff report: "Application error: a client-side exception … causing the system cant be access by her").** Root cause: one inventory row with an empty SKU (old rows predate today's validation; audit rows can also carry NULLs) crashed the SKU sort and unmounted the entire portal — and because the portal reopens your last tab, every later visit crashed on load. Two-layer fix: (1) every inventory list (items, TikTok stock-out, manual movements, supplier returns, postage, materials) is sanitised at the moment it arrives, so a NULL field can never reach the screen; (2) a new portal-wide recovery screen — if any card ever crashes again, staff see a branded "Something went wrong on this screen" card with **Back to Dashboard** (clears the remembered tab and reloads clean) instead of a white page. Nobody can be locked out by one bad card again. Verified: the exact crash reproduced, then rendered clean; the recovery screen tested end-to-end.

**Session edit now tells the truth about old workers (CEO: "I have done edit, but it doesnt updated!!!").** The live API worker was an older build: it saved the date/time/host part of an edit and silently ignored client, platform and notes — then reported success. The worker now echoes exactly which fields it applied, and the portal checks: an old worker gets an amber toast — "Only the schedule saved … Run DEPLOY.bat IN FULL (step 3 deploys the worker), then edit again" — instead of a false "Session updated".

**Set password now pops the global toast (CEO: "there is no popup to tell me that the password set successfully or what?").** The admin console's Set password used to show only a small inline line on success and nothing at all on failure. It now speaks through the same save-toast every other action uses: "Password set — [email] signed out everywhere" on success, and the server's reason on failure. Nothing else about the flow changed.

**Deploy notes:** run `DEPLOY.bat` IN FULL — site AND worker changed. No new migration. After deploying, ask the staff member who was locked out to simply reopen the portal (no cache clearing needed — the fixed build loads and the tab renders).

## [1.22.6] — 2026-08-17 — Edit any session (CEO/COO/CCO) + honest repeat preview

**Sessions are amendable (CEO: "I want to have an option for CEO, COO and CCO to amend or to update the roster / schedule if necessary or any typo to change").** Every session detail surface — the staff-grid card, the timeline popover and the mobile agenda — gains an "Edit details" button for the CEO, COO and CCO (plus the admin tier). It reopens the assignment dialog prefilled as "Edit session": fix the client name, date, start/end time, host, platform or notes, press "Save changes", done. Repeat/plan tooling is hidden in edit mode — an amendment touches exactly one session. Changing the slot or the host still notifies the affected host(s) exactly as drag-reschedule does. hr_admin keeps its scheduling powers (create, drag, complete, cancel) but does not get Edit — the worker enforces the same rule server-side, so detail amendments (client/platform/notes) are CEO/COO/CCO + admin tier only. Clearing the End field now clears the end time properly.

**The repeat preview tells the truth (CEO: "why it create until 25th if I pick until Friday??!").** Nothing was ever created past the days you picked — but the preview line printed the SEARCH WINDOW ("19-08 to 25-08", the auto-filled until date) and read as if sessions ran to the 25th. It now prints the ACTUAL dates the rule lands on: "→ Creates 3 sessions: Wed 19-08, Thu 20-08, Fri 21-08 — nothing outside these dates" (first→last shown when a run is longer than 7). The "until" date remains just the window the rule searches; only the toggled weekdays inside it become sessions.

**Deploy notes:** run `DEPLOY.bat` IN FULL — this release changes both the site and the API worker (step 3 must deploy the worker or "Edit details" will save nothing new). No new migration.

## [1.22.5] — 2026-08-17 — Scheduling flow straightened, grid cells pinned

**Pick-days now schedules every day you picked (CEO: "it doesnt schedule all the day that I pick!!").** The bug: with the "until" date left empty, the repeat rule silently collapsed to a single date. Now the until date is prefilled (+6 days) the moment you choose Daily or Pick days, a live line states plainly what will happen — "→ Schedule will create 4 sessions, 18-08 to 24-08" (green when ready, amber telling you exactly what's missing) — and an incomplete rule refuses with instructions instead of guessing.

**One flow, one button (CEO: "Add to plan become 2? what is the flow actually??!").** The primary button no longer morphs into a second "Add to plan". SCHEDULE always schedules exactly what's configured: the form (× repeat, expanded on the spot — the button itself says "Schedule N sessions") or, if you've stacked entries, "Schedule all (N)". "+ Add to plan" is the one optional stacking tool for combining slots/hosts/weeks before a single confirm.

**Staff-grid cells no longer drift (CEO: "the grid cell out from it position!").** `1fr` grid tracks have an implicit min-width, so a wide session chip stretched its own row's columns out of line with the header. Tracks are now `minmax(0,1fr)` with min-width-0 cells — every row pins to identical columns and labels truly truncate. Verified: header and row edges align to the pixel under stress-length labels.

## [1.22.4] — 2026-08-17 — The share-plan PDF is the staff grid

**"PDF — share plan" now produces the same staff × day table the screen shows (CEO: "I want the share plan looks same as the table that I share to you").** Landscape A4: the AZ ONE letterhead, then the grid — navy STAFF corner cell with the week's totals, seven day columns with per-day counts and hours (today tinted), one row per staff member with their weekly totals, and every session as a colour chip (navy = TikTok, gold = Shopee, neutral = other, green = completed, amber = conflict) with red ON LEAVE bands on approved-leave days. Rows grow to fit multiple sessions a day; an over-full sheet summarises the tail instead of clipping; the legend and the SSM footer with the generation stamp close the page. The PDF writer itself learned landscape (optional page orientation) — every other document stays portrait, untouched.

## [1.22.3] — 2026-08-17 — Staff-grid roster: the CEO's reference layout

**The desktop roster now defaults to a STAFF GRID (CEO showed a staff×day reference: "I want weekly roster schedule looks like this!").** One row per staff member, one column per day — exactly the reference structure, rendered in AZ ONE's own identity instead of the reference's rainbow: navy corner cell with the week's totals (sessions · hours), day headers with per-day counts and hours (today tinted gold), a left column with each person's weekly totals, and sessions as colour chips — navy tint = TikTok, gold tint = Shopee, neutral = other, green = completed, amber = conflict, red band = approved leave that day. Clicking a chip opens the session card (status, host, notes, Mark completed / Cancel) centred over the grid; hover shows the full detail as a tooltip. A "Staff grid | Timeline" toggle keeps the hour timeline one click away for drag-to-reschedule. Phones keep the agenda view. A legend closes the grid so the colours explain themselves.

## [1.22.2] — 2026-08-17 — The week's roster as a shareable PDF

**"PDF — share plan" on Schedule & Roster (CEO: "generate 1 schedule table in PDF so that I can share to them for their awareness").** One tap turns the loaded week into a branded A4 PDF and hands it to the phone's share sheet (WhatsApp-ready; desktop downloads it). Built on the same in-house PDF writer as the claim and leave forms, so it carries the AZ ONE letterhead — gold band, LIVE·CONNECT·GROW, week range — then a bordered table grouped by day: a tinted day band (MONDAY · 17-08-2026 · 2 sessions) followed by Time | Session/Client | Host | Platform | Notes rows. Cancelled sessions are excluded, long notes truncate with an ellipsis, an over-full week summarises the tail ("+N more — see the portal"), and the footer carries the SSM line plus the generation timestamp and a reminder that the in-system roster is authoritative. Works for any week you navigate to — this week, next week, or a month ahead.

## [1.22.1] — 2026-08-17 — Batch scheduling: a plan, not one form per session

**New assignment builds a PLAN (CEO: "I need to create multiple schedule in 1 day or in 1 week or advance date").** The dialog gains a Repeat rule — One-off / Daily / Pick days (Mon–Sun toggles) with an "until" date and a live "→ N sessions" preview (capped at 62) — and an "Add to plan" flow: expand a run into the plan, adjust the form (another time slot the same day, another host, a date weeks ahead), add again, then "Schedule all (N)" creates everything in one go. The plan list shows each pending session (date, time, host, client) with per-row remove; duplicates (same date + time + host) are skipped automatically; failures are reported per session without aborting the rest; every created session still bell-notifies its host individually. One-off scheduling is unchanged — fill the form, press "Schedule", exactly as before. Verified end-to-end: a Tue/Thu/Sat run until month-end plus a second same-day slot for a different host = 7 sessions posted in one confirm.

## [1.22.0] — 2026-08-17 — Tabs organised per role, in the CEO's order

**Tab order is now the CEO's list, verbatim** (Dashboard · Attendance · Ecommerce · Inventory · Sales · News · HR · Staff · Leave · Claims · Payroll · Finance · Tasks · Content · Reconciliation · Commission · Ads Fund · Purchasing · Accounting · Stokis · Assets · Profile · Users). Order is functional, not cosmetic: the phone bottom bar is the first four tabs each role can SEE, so every role now opens onto their actual work — management gets Dashboard · Attendance · Ecommerce · Inventory; a live host or editor gets Dashboard · Attendance · News · Leave, with just Claims/Tasks/Content/Profile in More.

**The last loose default is closed.** Ecommerce was visible to every staff role; it is now management + sales + marketing only (editors and live hosts out — its data routes were already server-gated to that tier). With that, every tab default matches its job:

- All staff: Dashboard, Attendance, News, Leave, Claims, Tasks, Profile
- Content team (+ mgmt): Content
- Sales & marketing (+ mgmt): Ecommerce, Sales*, Inventory, Stokis, Ads Fund*
- HR tier: HR, Staff, Assets (+ Commission view)
- CEO/COO only: Payroll, Finance, Purchasing, Users*
- CEO only: Accounting
- (*Sales excludes marketing/editor/live-host; Ads Fund excludes editor/live-host; Users = CEO/COO/super_admin)

Per-tab overrides in Users → Tab access control still trump all defaults, and the worker enforces every data route server-side regardless of what any client shows.

## [1.21.9] — 2026-08-17 — Mobile roster: proper agenda, overflow impossible

**Fixes the remaining overflow the CEO caught in v1.21.8 and upgrades the look.** The v1.21.8 "today" highlight used a negative margin, making today's row 16px wider than the phone — the exact right-edge spill he screenshotted (my test week didn't include "today", so it slipped through; this pass verifies WITH the today band active: page width exactly equals the screen). The mobile roster is now a proper agenda: one rounded frame that clips its own content, day sections with a gold TODAY chip and per-day session counts, each session a row with a fixed time column, gold accent bar (amber = conflict, green = completed), truncating text everywhere, and tap-to-expand details with Mark completed / Cancel. No negative margins, no fixed widths wider than a phone — overflow is structurally impossible.

## [1.21.8] — 2026-08-17 — Roster fits the phone

**Schedule & Roster no longer overflows on mobile (CEO: "It overflow to the right for mobile apps view!").** The 7-column hour grid is a desktop layout — its 640px minimum width can only spill past a phone screen. Phones now get a purpose-built week view: the seven days as a vertical list (today highlighted gold), each session as a tappable card showing client, time, host and platform, colour-keyed exactly like the desktop blocks (conflict amber, completed green). Tapping a session expands its full detail inline — status, notes, Mark completed / Cancel — same actions as the desktop popover. Zero horizontal scrolling anywhere. The hour grid with drag-to-reschedule remains the desktop experience, untouched.

## [1.21.7] — 2026-08-17 — Stock movement deletion: CEO & COO only

**Delete is back on Manual stock movements — for the CEO and COO only (CEO's direction).** Everyone else sees no button, and the API refuses them with 403 regardless of what the client shows. Two safeguards on what delete does, keeping the v1.21.4 accuracy rule intact: the record (and its linked manual sale, so the sales totals follow) is removed from the database permanently, but the shelf quantity is NEVER touched — nothing silently returns to stock; Revert remains the one audited way to move stock back. Every deletion writes an audit entry under the deleting user's name with a full snapshot of the removed record.

## [1.21.6] — 2026-08-17 — My schedule on the phone

**Staff see their assigned roster on the Dashboard (CEO: "On mobile, I cant see the details of the task assigned… The dashboard mobile view doesnt show any").** The notification side already worked — a host is bell-notified (and web-push where enabled) the moment a session is assigned or moved — but the phone had no PLACE where the schedule lived; details sat only in the desktop roster grid. New "My schedule" card on the Dashboard (phone and desktop): the person's own upcoming sessions — date (TODAY highlighted in gold), start–end time, platform chip, client and notes — next five, scheduled only, nothing shown when empty. Each staff member sees only their own assignments.

## [1.21.5] — 2026-08-17 — Calendar dots mean something; low stock pulses and opens in place

**Mini-calendar dots (CEO: "why got dotting instead of there is a task only have a dot").** Attendance days no longer dot the dashboard mini-calendar — with daily punches, every past day carried one and the dots meant nothing. A dot now marks only a day with something ON it: a task due, a roster/live session, or a company event. Attendance still reads in the day card's text line.

**Low stock alerts (CEO: "for low should like animation to make staff alert and data will appear when click without go to the tabs/table").** The Low and Out-of-stock chips on the Inventory status strip now PULSE (amber / red) whenever their count is above zero, and clicking one opens the affected items right under the strip — SKU, name and exact quantity left — no trip to the inventory table. In-stock stays a quiet neutral chip.

## [1.21.4] — 2026-08-17 — Tab access resynced, stock history is permanent, location required on every punch

**Tab access control matches the real tabs again.** The card (and the worker's allow-list behind it) had drifted eight versions — it still offered Overview, Pipeline, Expenses and Birthdays (all retired or folded) and refused Finance and the five ERP tabs, so overrides could not be set on the tabs the portal actually shows. Both sides now mirror the live tab set (21 controllable tabs; Dashboard and Profile stay always-on).

**Manual stock movements can no longer be deleted.** The old Delete hard-erased the record AND silently pushed the quantity back into stock — history gone, shelves changed, no trail. That action is retired on both the button and the API (an old client pressing it gets a clear refusal, not a 404). Movements are permanent records: Edit corrects a typo, and Revert remains the ONE audited way to put stock back — the row stays, marked reverted. Your inventory numbers can no longer be changed by making history disappear.

**Location is required on EVERY punch — with or without the fence.** Before, a deployment that had not yet applied migration 0072 quietly accepted location-less punches: the exact "no location" rows in your In-Today list. The requirement no longer depends on the fence config (the fence only decides outside-office flagging); the client blocks before sending with the precise reason ("location blocked in browser settings" vs "no GPS fix"), OT punches included. And when the deployed worker reports no fence configured, In Today shows a red deployment warning to management instead of staying silent.

**About your current live data:** those three location-less punches were accepted by the older deployment. After running DEPLOY.bat in full (worker + migrations), every new punch requires location, and each staff member must tap "Allow" when the browser asks for location the first time.

## [1.21.3] — 2026-08-17 — Dashboard day card sees the roster; sync failure says why

**The side-panel day card counts everything on the day, not just tasks.** Picking 17-08 with a roster session scheduled used to read "0 tasks — nothing due", as if the day were empty (CEO: "there is roaster schedule created but why … appear task 0??"). The card now reads tasks due + live/roster sessions + company events ("1 item · 1 session"), lists each below (time · platform, client, host), and the mini-calendar dots mark session/event days too.

**"Sync failed — try again" now says WHY.** The bare failure toast is replaced with the actual cause: a 404 means the API worker is still the previous build — run DEPLOY.bat fully (step 3 deploys the worker) and retry; a missing cash-flow table (pre-0071) returns a clear migration message instead of silently reporting "up to date"; permission and server errors surface their real text. The backfill SQL itself was re-verified idempotent against the real 0071 schema.

**Important for the current live site:** the "Sync failed" you saw is the deployed API worker not yet carrying the backfill route (v1.21.2 shipped site-only). Run DEPLOY.bat in full once — the worker step picks it up — then press "Sync existing Finance data" again.

## [1.21.2] — 2026-08-15 — Roster popover in the calendar, Lives-today dialog tidied

**Schedule & Roster — the session detail opens INSIDE the calendar.** Clicking a session used to fill a navy panel underneath the board, off-screen on most laptops (the CEO had to scroll to find it). The detail is now a popover pinned beside the clicked block — sessions on Mon–Thu open it to the right of their column, Fri–Sun to the left, top follows the session's time slot and clamps so the card never leaves the grid. Same content and actions (status chip, host, date · time · platform, notes, Mark completed / Cancel session).

**Lives today dialog — no more overflow.** The modal variant of the live-session scheduler rendered with no inner padding (fields and the "No sessions scheduled." line sat flush against the dialog edges) and squeezed its full-width flowing form into 576px. It now carries the dialog's standard padding and keeps a tidy two-column grid inside the modal.

Deploy: usual DEPLOY.bat — site-only change, no migration, no worker change.

## [1.21.1] — 2026-08-15 — App-like scrolling, calendar grid, Cash Flow backfill, cards reordered

**The shell scrolls inside itself now.** The rounded canvas is fixed to the viewport on desktop; the content column is the scroll container, so the backdrop never scrolls and the frame, rail and side columns stay put — like an app window, not a web page. Switching tabs rewinds the internal scroll to the top. Phones are untouched.

**Events calendar — complete grid.** The month grid's last row used to stop at the final day, leaving an open unbordered notch in the corner. Trailing cells are now padded to full weeks, inner borders collapse cleanly against the frame (no doubled lines), long event names truncate with a hover tooltip, and a third-plus event shows as "+N more".

**Cash Flow — populate what Finance already holds.** The v1.21.0 automation only books events that happen after it shipped. New "Sync existing Finance data" button (and worker backfill route) walks every ALREADY-paid expense, claim, payroll run and invoice and books each with the same ref the live path uses — idempotent, so pressing it twice adds nothing. Cash Flow also LEADS the Finance tab now, P&L and expenses below it.

**Cards where the CEO wants them.** Operations map leads the Ecommerce tab. Targets & commission's per-person inputs are a compact labelled grid (the whole floor in two short rows, full names shown) instead of one full-width row per person; heading emoji dropped. Inventory's status card is now a slim content-hugging strip at the TOP of the Inventory tab.

Deploy: usual 5-step DEPLOY.bat (no new migration; worker changes ride step 3).

## [1.21.0] — 2026-08-15 — GPS flagging, one staff-name source, leave visibility, Cash Flow sync, Pipeline retired

**Office GPS — "allow but flag" (CEO's choice), and the fence turns on out of the box.** Migration 0072 seeds the office geofence with the HQ coordinates (radius 120 m), so location is now REQUIRED on every clock in/out and OT punch — a punch with location blocked is refused with instructions. Being outside the office no longer blocks anyone: the punch is recorded, and management views mark it in red — "In Today" shows **OUTSIDE OFFICE · 6.7 km** for staff beyond radius + accuracy grace, green "at office" inside, and the monthly attendance report carries the same flag per punch. CEO, COO and CCO are exempt from the flag — their distance still shows (neutral) because their location is still captured. The flag is computed at read time from the stored coordinates, so moving the office corrects history too. The Dashboard readiness strip now says exactly what will happen: "outside — your punch is recorded and FLAGGED for HR."

**One staff-name source for every picker.** The Tasks assignee dropdown read the raw account list — duplicate names, test accounts, "Super Admin" — while other dropdowns read the proper staff list. Every assignment picker (Tasks, roster host, Assets) now reads `/staff-list`: active staff only, FULL staff names. The pickers that legitimately need the account list (attendance corrections, claims payee) now label with the full staff name too, and the commission host picker follows the same rule.

**Leave — the whole company's applications, visible.** The Leave tab's approval card was "awaiting my action" only, so anything sitting at another stage was invisible — and COO/CCO could not fetch the list at all (worker gate fixed). The new "Leave applications — whole company" board shows every in-progress request — full name, type, dates, days — with a chip naming whose approval it waits on (HR → COO/CCO → CEO), action buttons on the rows waiting on you, and the last five decided requests below.

**Roster — the on-leave pill opens.** Clicking "N on leave" on Schedule & Roster now lists who is on approved leave this week and their exact dates, so assignments are planned around real absences without leaving the board.

**Cash Flow ⇄ Finance — the money-in side joins the automation.** Money out was already automatic (paid expenses, payroll runs, claims). Now: marking an invoice PAID (or creating it born-paid) books a money-in row + balanced journal entry (ref INV-n), and Reconciliation → "Pull from channels" books each pull's new orders as a per-channel settlement (ref RECON-period-channel-seq) — cashflow, the books and reconciliation cannot drift apart. Auto rows carry an "auto" chip in the table; the manual form remains for movements the system cannot see (capital in, transfers).

**Pipeline retired (CEO: "Sales pipeline is really needed?? I dont think so").** The LEAD→WON tracker, its tab and its worker routes are gone (24 → 23 tabs; the `prospects` table is kept — history is never dropped by a UI decision). Customer enquiries — the real inbound funnel — moved to the top of the Sales tab, where an enquiry that becomes business is raised as a quotation directly; the convert-to-lead hop went with the tab. Card heading emoji cleaned in the same pass.

Deploy: the usual 5-step DEPLOY.bat — step 2 applies migration 0072 (geofence seed), step 3 the worker, steps 4–5 the site.

## [1.20.1] — 2026-08-15 — Operations map: real Malaysia, clickable states

**Real geography (Ecommerce tab).** The schematic two-blob silhouette is gone. The map now draws all 16 states and federal territories with real boundary geometry (Natural Earth data, projected as the standard two insets: Peninsular Malaysia | Sabah & Sarawak). The geometry ships as ~6 KB of inline SVG paths — no map library, no new dependency.

**Every state is clickable (and keyboard-operable).** Tap or click a state — or focus it and press Enter — and the side panel shows that state's order count, revenue, share of national orders and top buyer cities inline, without leaving the tab. "All states" returns to the national summary, whose Top-states rows are also clickable shortcuts. States with orders fill gold (intensity scales with order count) and carry a navy count bubble with a gold ring; the selected state gets a highlight outline. Verified in light, dark and both brand presets, at desktop and 390 px. Card heading emoji removed per the no-emoji rule.

## [1.20.0] — 2026-08-15 — C4 + C5: the modules finally talk to each other

The last two consolidation phases. No migration — every change rides on existing tables.

**Goods receipt moves stock (C4).** PO lines can now link to a stock item (a picker in the builder — leave it on "— not stock —" for services). Marking a PO **received** adds each linked line's quantity to inventory, **exactly once**: the status transition itself is the guard (a second "received" matches zero rows and answers "already received — its stock has been added"). Every receipt writes the same traceability trail manual stock-ins use, with the PO number as the remark, so a movement is findable from both ends. This closes the audit's finding F — "received" used to flip a string while the shelves changed by a separate manual adjust with no PO reference.

**Reconciliation pulls from the channels (C4).** One button — "Pull _month_ from channels" — prefills the period from `postage_records`, the same base `/revenue` sums: order number, channel (TT- prefix → TikTok), and actual sales per order. Keyed by order number, so pulling twice adds only what's new. Estimated sales, fees and shipping are typed on top of real rows instead of the whole table being hand-keyed. "Actual sales" stops being the fifth independent revenue figure.

**Ads Fund is a budget book, not a second approval chain (C4).** The audit's finding B: the company had two "claim" workflows, and the weaker one had no receipts, no conflict-of-interest guards and no payout tracking. Now: managers **record spend** directly against an allocation (born approved, server-side budget cap unchanged, pending rows from before still display); staff who paid for ads out of pocket use the **Claims** tab — the one reimbursement workflow, with receipts and the full chain. The approve/reject route is deleted.

**Enquiry → lead in one click (C4).** Each enquiry in the Pipeline tab's inbox gains "→ Convert to lead": creates the prospect (name, contact, message carried over, tagged with the enquiry number) and marks the enquiry qualified in the same stroke. The two funnels stop drifting; nobody re-types a won enquiry.

**The books write themselves (C5).** Every bank movement now drafts a **balanced journal entry** — automatically, idempotently (same unique ref as the movement: post twice, book once): paid expenses, payroll runs and claim payouts (out: debit the mapped expense account, credit 1100 Bank), and manual Finance-tab entries in both directions (money in credits 4000/4100 income). Categories map to the seeded chart — rent/utilities → 6200, marketing/ads → 6000, salaries/commission → 6100, platform fees → 6300, live/service income → 4100 — and anything unrecognised books to 6900 Other expenses for the accountant to re-class, because a missing mapping must never block an expense from being marked paid. The journal composer stays for adjustments; the trial balance now reconciles with the Finance tab by construction. Posting math verified in sqlite before shipping.

**Setup:** `pnpm install && pnpm build`, deploy site + Worker (steps 3–5). No migration.

**Consolidation programme status:** C1–C5 complete. Remaining known deviation (flagged, deliberate): the v1.6.0 `commission_rules` leaderboard display engine still exists — retiring it changes what the Ecommerce leaderboard means and gets its own pass.

## [1.19.0] — 2026-08-15 — Consolidation: 28 tabs → 24, one of each thing

The CEO approved every recommendation in the consolidation plan (project doc CONSOLIDATION-PLAN-v1.19). This release executes phases C1–C3 plus the Stokis revenue decision. **No table is dropped anywhere** — only duplicate surfaces and duplicate write paths are removed.

**Tabs removed (4).** **Orders** — `sales_documents` was already the unified product+service recorder; the parallel v1.18.0 model connected to no stock, no customers and no revenue report. Its API routes are retired so no new orphan records can be created; the tables stay. **Overview** — everything on it except two cards already lived on the Dashboard; the two survivors moved home (company-wide task table → Tasks tab for managers, stock-status breakdown → Inventory tab; `components/portal/company-monitor.tsx`). **Birthdays** — folded into Staff Details, same component, one staff-record surface. **Cash Flow** — merged into the renamed **Finance** tab (was Expenses): P&L, company expenses, then the bank ledger, one screen.

**Money is typed once (C2).** Marking an expense paid, recording the payroll bank run, or paying out a claim now **auto-creates the matching bank movement** — idempotently: each event carries a unique ref (`EXP-n` / `PAYROLL-YYYY-MM` / `CLM-n`), so toggling "paid" twice can never write two rows, and pre-0071 databases no-op silently.

**The commission double-payment path is closed (C3).** Payroll gains **"Pull approved commission"**: approved entries for the month flow into each person's COMMISSION box and are marked paid in the same pass — a second click finds nothing left. People without a payroll row yet are reported by name, not silently dropped. The v1.4.226 percent-helper (a second commission engine that multiplied month sales by a typed rate) is deleted. Rates and approvals live on the Commission tab only.

**Stokis money is finally revenue (CEO decision Q2).** `stokis_orders` joins `revenueLines()` as its own line — `/revenue`, the P&L, the business-lines card and the commission base all inherit it automatically, because that function is the single source they all sum from.

**Duplicates removed.** The Sales tab's enquiries card moved to Pipeline (lead capture: five surfaces → two — Pipeline for the sales roles, /admin for the website roles). LiveScheduleCard left the Attendance tab (RosterBoard is the one scheduler; the Dashboard modal viewer stays). LiveGmvCard left Ecommerce (it duplicated SalesRevenueCard's TikTok figure on the same screen from a second endpoint). The duplicate `GET /pnl` endpoint and the Overview tab's private PnlCard copy are gone — `/finance/pnl` is the one P&L. Dead `/bd` and `/ops-reports` routes and their never-rendered panels (CommercialPanel, OperationsPanel) are deleted (~450 lines).

**A real authorisation hole, closed.** The admin Staff panel's approve/reject buttons PATCHed the same leave endpoint as the portal Leave tab but **without the stage filtering** — an admin could skip the HR → COO/CCO → CEO chain. The buttons are removed; the panel links to the portal Leave tab, where the chain is enforced.

**Setup:** `pnpm install && pnpm build`, deploy site + Worker (steps 3–5 of DEPLOY.bat). **No migration in this release.** Staff who had Expenses/Overview/Birthdays pinned in tab-access overrides keep working — unknown tab names simply fall away; "Finance" inherits the Expenses roles.

## [1.18.2] — 2026-08-15 — The More sheet scrolls

The seven ERP tabs grew the mobile More sheet past the screen, and a bottom-anchored sheet clips its overflow **off the top** — the CEO could see the later rows but never the first ones, with no way to scroll: the page behind is deliberately locked while the sheet is open, and the sheet itself had no scroll of its own. It was fine at 16 tabs and broke at 23 — a growth bug, invisible until the ERP release crossed the line.

Fix, portal and admin sheets both: `max-h-[80vh] overflow-y-auto overscroll-contain`. The sheet now opens showing the grab handle, close button and the FIRST rows, and scrolls within itself; `overscroll-contain` stops the scroll chaining into the locked page behind. Verified in-browser at 390×844: content 818px in a 674px sheet, internal scroll reaching the end.

**Setup:** `pnpm install && pnpm build`, deploy the site (front-end only).

## [1.18.1] — 2026-08-15 — Location on EVERY clock-in, and management can see it

**The CEO's requirement changed and the code now matches it:** location is captured on **every** punch — clock in, clock out, OT in, OT out — whether or not the office fence is on. Before this, the client deliberately skipped the GPS request when the fence was off (a privacy-first default from v1.9.1); the CEO wants the register to carry the position regardless. Fence OFF = recorded, not enforced. Fence ON = the server refusal stays exactly as it was.

**Permission, handled where it belongs.** The browser's location prompt fires only on the punch tap itself — user-initiated, never on page open (so no staff member gets ambushed by a permission dialog just for reading the Dashboard). If someone has location **blocked**, the punch still records (when the fence is off) and the confirmation toast says so plainly: _"no location — enable location access for this site."_ A denied permission and a failed GPS fix now produce different messages, because "you blocked it" needs different words from "GPS timed out".

**Management sees where.** The "In today" monitor now shows each first clock-in's position as a phrase — **"74 m from HQ"** in green when inside the fence-plus-grace distance, **"3.2 km from HQ"** in amber when not, _"no location"_ dimmed when nothing was recorded. Distance is measured against `SITE_CONFIG.office` with the same radius + 150 m accuracy grace the server applies, so the display can never disagree with the enforcement.

**Honesty about "without cheating", restated from v1.9.1:** browser GPS comes from the client and a determined person with developer tools can spoof it. This system stops the casual "clock in from bed" and records position + IP + user-agent on every punch for cross-checking; it is not forensic proof of presence. Switching the fence ON (Users → Office check-in → Save — pre-filled with HQ) adds the hard server-side refusal.

**Why the CEO's phone still showed nothing:** the live site was running v1.16.1 — v1.17.0's "Check my location" and everything since has not been deployed yet. Deploy this release with ALL FIVE DEPLOY.bat steps (migration 0071 + Worker), then enable the fence with one Save.

**Setup:** `pnpm install && pnpm build`, all five DEPLOY.bat steps.

## [1.18.0] — 2026-08-15 — The ERP arrives: Orders, Cash Flow, Reconciliation, Commission, Ads Fund, Purchasing, Accounting

Programme phases 2–8, authorised by the CEO ("start 2 to 8"). **Seven new modules, one migration, one new Worker module, four new panel files, a reusable data table — and the audit's structural fixes.** Deploy needs ALL FIVE DEPLOY.bat steps: step 2 applies migration **0071**, step 3 ships the new Worker routes.

**Phase 4 — one order for both business natures.** New `orders` + `order_lines` schema where each LINE is product (sku · qty · unit price · cost) or service (host · hours · rate); the order's kind — product / service / mixed — is derived from its lines by the server, never picked by hand. The Orders tab records both natures in one document (ORD-YYYY-NNNN), one revenue basis, one commission basis.

**Phase 5 — Cash Flow + Reconciliation.** Money in / money out / balance ledger against named bank accounts, and the DZI reference's reconciliation table: estimated vs actual sales, cost, fees, shipping, a computed profit column that goes red when negative, and a pending → reconciled / disputed flow.

**Phase 6 — Commission + Ads Fund.** Commission rates (percent + optional RM/hour) are set per host by the CEO tier only, and entry amounts are **computed server-side from the rate table — the form cannot send an amount**, so a typo can never overpay a host. Ads Fund: management allocates a monthly budget per channel; staff claim spend against it; the server refuses any claim that would exceed the allocation (pending claims count against budget too); management approves or rejects.

**Phase 7 — Purchasing + Accounting.** Suppliers and POs (PO-YYYY-NNNN) with a draft → sent → received flow. A 15-account Malaysian-SME chart of accounts seeded by the migration, a journal that **refuses unbalanced entries server-side** (debits must equal credits — the invariant lives where it cannot be bypassed), and a trial balance computed from the journal with an OUT OF BALANCE tile that can only ever show if the data was touched outside the API.

**Phase 2 — `DataTable`** (`components/ui/data-table.tsx`): entries-per-page, search, sortable headers with aria-sort, pagination, phone-safe horizontal scroll. The audit counted eleven hand-pasted sortable-header renderers; new modules use this one, existing panels migrate panel by panel.

**Phase 3 — wiring.** Seven new tabs with lucide icons, role-gated client-side in `TAB_ROLES` and **enforced server-side** by nine new entries in `permissions.ts` (`orders_manage`, `cashflow_manage`, `reconcile_manage`, `commission_view/decide`, `adsfund_manage/claim`, `purchasing_manage`, `accounting_manage`). The CEO's per-user tab overrides apply to the new tabs like any other.

**Phase 8 — the audit's structural fixes.**

- **`worker/src/shared.ts`** — shared `json/err/str/num/cents/audit/logError`. And the real bug: staff.ts's `logError` was a bare INSERT while index.ts had the v1.5.0 six-hour dedupe — staff.ts is the copy the whole portal calls, so error-log spam and bell noise were still live. Its body now delegates to the deduped writer; ten call sites untouched.
- **`@custom-variant dark`** — the 13 `dark:` utilities previously followed the _operating system's_ colour scheme, not the app's 🌙 toggle. Now bound to the `.dark` class the toggle actually sets.
- **`--warning` #b45309 → #946300** — the old value sat ΔE 9.9 from `--danger` under normal vision (floor 15): amber and red chips read as one colour. The new value measures 16.7 from danger, 4.66:1 on the soft chip, 5.19:1 on white. (Red/amber stay deutan-confusable at any hue — house chips always carry their word, which is the accepted relief.)
- **Five orphan files deleted** (~680 lines): prospects-panel (which held the last private `api()` copy that sent no CSRF token), admin/staff-directory, product-gallery, home/elfia, migration-banner — each verified zero importers by exact path before deletion.

**Worker safety net:** if 0071 has not been applied yet, every ERP GET returns an empty list with a `pending_migration` flag and the tabs show "run DEPLOY.bat" instead of a broken screen; writes return a clear 503. Money is integer cents end to end, converted once at the API edge with a NUMBERS-ONLY parser capped at RM 10 million per amount.

**Not everything is done** — kept honest: the 21 existing modules still render their old layouts (they adopt StatStrip/DataTable panel by panel from here); commission entries are typed against a sales basis rather than auto-generated from fulfilled service lines (that automation needs order-fulfilment hooks); Reconciliation rows link to orders optionally but there is no CSV import yet; Accounting has no P&L/balance-sheet reports beyond the trial balance; the content-emoji sweep and the ui-styles adoption sweep remain open.

**Setup:** `pnpm install && pnpm build`, then run ALL FIVE DEPLOY.bat steps — this release has a migration (0071) and a Worker change.

## [1.17.0] — 2026-08-15 — Live GPS detection on the clock-in card; the roster tab decluttered

**"Check my location"** (CEO: "I still cant see the gps detection for the clock in"). The readiness strip on the phone — and the geofence line on desktop — now carry a tap-to-check action. It reads the phone's position once and asks the server where you stand; the verdict comes back as **"● Inside — 74 m from AZ ONE HQ"** in green, or "Outside — 1.2 km from AZ ONE HQ (limit 120 m)" in amber, before you commit to the punch.

Three deliberate properties: it is **tap-initiated** (an automatic probe would fire the browser's location prompt on every page open); it runs **the exact rule the punch enforces** — a new Worker route reusing the same parser, the same haversine and the same 150 m accuracy grace as the punch gate, so the preview can never disagree with the verdict; and the **office coordinates never leave the server** — only the distance comes back. No audit row, no record: a mirror, not an event.

Two prerequisites to see it live, both yours: this release **changes the Worker**, so deploy must run all five DEPLOY.bat steps (no migration, no secrets); and the strip only appears once the fence is ON — Users tab → Office check-in (pre-filled with HQ since v1.16.1) → Save.

**Roster tab decluttered** (CEO: "Schedule & Roster seem take so much unrelated things there"). The context panel and right rail now render on the **Dashboard only**. On Attendance they were repeating pending leave, open tasks and announcements beside a tab already five cards deep — duplication that read as clutter and cost the roster board its width. Every working tab now gets the full canvas; the Dashboard keeps the rails, which is where that at-a-glance layer belongs.

**Setup:** `pnpm install && pnpm build`, then deploy **both** workers (step 3 and step 5 of DEPLOY.bat). No migration, no secrets.

## [1.16.1] — 2026-08-15 — Office location baked in (AZ ONE HQ)

The CEO supplied the office point: **1.544418427439, 103.71003343205108**. It now lives in ONE place — `SITE_CONFIG.office` in `constants/site.ts` (lat, lng, label "AZ ONE HQ", default radius 120 m) — and everything that needs HQ imports it from there.

**The geofence card pre-fills with HQ**, so switching the office check-in on is now: Users tab → 📍 Office check-in → **Save**. A "Use HQ location" button refills the fields any time; a fence that is already saved still wins (the card loads the configured values over the defaults).

**Deliberately NOT seeded by migration.** The fence's `system_meta` row IS the enforcement switch — the moment it exists, every clock/OT punch from every member of staff is refused outside the radius. A deploy must never flip that silently; turning enforcement on stays a one-click human decision in the UI.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.16.0] — 2026-08-15 — SVG icons across the chrome; icon-only sign out

**Every icon in the app chrome is now a professional SVG stroke** (CEO: "I want svg which is looks professional"), drawn from lucide — which the public site already uses, so this adds **no dependency** and the icons tree-shake to only the ~30 named.

**One shared map** (`components/layout/nav-icons.tsx`) covers the portal's 21 tabs, admin's 12 and account's 3. Emoji rendered differently on every platform — monochrome on some Androids, tofu on old WebViews — and could never be tinted; lucide strokes inherit `currentColor`, so one icon is white on the navy rail, navy-on-gold when active, muted grey in the bottom nav, without a second asset. Names shared across surfaces (Dashboard, Users, Enquiries, Account) deliberately share the icon, and an unmapped name falls back to a neutral square — a new tab can never crash a nav.

Converted: the desktop rail (incl. its sign-out), the mobile bottom navs and More sheets on `/portal`, `/admin`, `/account`, the More-sheet Preferences (sound / push / theme), and the portal header's search, sound, push, bell, palette, dark-mode and close controls. Admin's local emoji `TAB_ICONS` map is deleted in favour of the shared one; the old emoji `ICONS` map in `sidebar-nav.tsx` stays exported but deprecated (PDF/doc templates can still want plain-text glyphs) with nothing in the UI rendering from it.

**Sign out is icon-only everywhere** (CEO: "minimize the width") — a `LogOut` glyph with `title` + `aria-label`, in the portal header, admin header, account header and the rail. On the portal header that returns ~70px to the greeting, and with the search capped at `max-w-44` the desktop greeting now fits un-truncated at 1440px with both side columns open.

**Left for a later sweep:** in-content emoji (🎂 birthday lines, "⏱ Overtime approvals"-style card headings, PDF templates) are content, not chrome, and were deliberately not touched here.

**Header fit, measured not guessed.** With both side columns open at 1440px the working column is 773px and the greeting kept ellipsizing. Fixed by measurement: title block gets `flex-1` (it never grew into free space before), the search field drops its circular `w-full` basis for a fixed shrinkable `w-40`, header buttons go `md:px-2.5`, the controls row single `gap-1.5`, and the greeting steps `text-lg` → `2xl:text-xl` (xl is 1280px — re-applying 20px at 1440 was the first attempt's bug). Verified in-browser: h1 width 175px = its scrollWidth, zero truncation.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.15.0] — 2026-08-15 — Dashboard body + mobile Today screen; a five-version-old mobile header bug found and fixed

**Verified differently this time.** Instead of screenshotting a mock page, the real `/portal` static export was loaded with stubbed API responses, so every screenshot in this release is the actual Dashboard component rendering production code paths. That is also how the release's biggest find surfaced.

**THE BUG: the v1.10.0 "calm mobile header" never worked.** The four set-once switches (sound, push, theme, EN/BM) were written as `${btnHdr} hidden md:inline-flex` — but `btnHdr` already carries a bare `inline-flex`, and when one element holds two unprefixed display utilities the _stylesheet's_ order decides, not the class list's. In this Tailwind build `.inline-flex` is emitted after `.hidden`, so all four buttons rendered on every phone since v1.10.0, overflowing the header and squeezing the screen title to zero width. The code's own v1.10.0 comment warns about exactly this trap for `h-9`/`h-12`. Fix: new `btnHdrDesktop` token in `ui-styles.ts` — `hidden` as the only base display class, `md:inline-flex` supplying the visible display — adopted at all four sites. The phone header now actually shows avatar · title · search · bell · dark · sign out, five versions after it was designed to.

**Dashboard (desktop).** A personal KPI strip — today's clock-in + status, days present, hours this month, open tasks — and a **My attendance** day-by-day chart: first-in→last-out hours per MYT day, duplicate punches can't double-count, today in navy, and a day still in progress shows a gold half-bar instead of pretending its hours are known. All from the attendance response the Dashboard already fetched (kept un-filtered rather than re-requested). Company-wide cards stay in the Sales Floor band, role-gated as before. The desktop h1 becomes time-of-day aware (Good morning/afternoon/evening · Selamat pagi/petang/malam).

**Mobile Today screen.** Date line + greeting (hand-rolled EN/BM day and month names — ms-MY locale data varies by browser); the Clock in button goes the reference's green via the `--tile-success` pair (NOT `--success`, which flips to a light text-green in dark mode and would fail contrast under white text); a geofence readiness strip — deliberately a config read, not a live GPS probe, which would fire the browser's location prompt on every Dashboard open before the person asked to punch (the real check stays server-side at the punch, unchanged); **Today's checklist** as the reference's two-column card grid with a real "2 of 4 done" count (the full task response, completed items included); and a compact **This month** stats card. The v1.10.0 hero card and every punch guard, OT rule and geofence path are untouched.

**Also fixed (audit finding):** the "In today" staff list showed `in_at.slice(11,16)` — a raw UTC slice, so a 10:00 MYT clock-in displayed as 02:00. Now `mytTime()`. And the management attendance donut moves off `--success`/`--warning`/`--danger` (the warning/danger pair is not separable — ΔE 2.8 deuteranopia / 9.9 normal vision, and dark-mode `--success` is a text-grade light green) onto the validated `--ring-*` steps.

**Header squeeze.** With both side columns open at 1440px the desktop search yields (`max-w-44`, back to `max-w-56` from `lg`) instead of truncating the greeting.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.14.0] — 2026-08-15 — Canvas shell restored, with context panel and right rail

The CEO reviewed both shells built and chose the canvas: rounded surface on a dark band with the navy icon rail as its left edge, a date-context column on the left and a queue rail on the right. v1.13.0's grouped sidebar is superseded. `side-nav.tsx` is **kept, unused** rather than deleted — it is a working implementation and the module count is still climbing.

**Shell** (`app-shell.tsx`, rewritten again). Four columns on desktop: navy gutter with the sticky icon rail, optional context panel (264px), content, optional right rail (292px). The two side columns are `hidden md:flex` and every other rule is `md:`-prefixed, so the phone still renders `children` in bare wrappers — the v1.11.1 bottom nav, More sheet and safe-area insets are untouched.

**Side columns** (`components/portal/side-columns.tsx`) — and they carry **real data, not placeholders**. The context panel shows the month grid with a gold dot on every day that has an attendance record, a navy "today" card, and the tasks due on the selected day. The right rail shows pending leave, open tasks and recent announcements. Both fetch from the endpoints the Dashboard already calls, so adopting them stayed a pure outer-JSX change — no existing state, effect or handler moved.

**They render only where a date context means something** — Dashboard, Attendance, Leave, Tasks. On Sales or Users they would be decoration competing with the work area.

**New primitives.** `MiniCalendar` (Monday-first, the Malaysian working week; dot markers; pure divs, no calendar library). `Avatar` (photo with an initials fallback that also catches a _failed_ load — a stale media key previously left a hole in the row instead of a face).

**Date handling.** `MiniCalendar` works in MYT `YYYY-MM-DD` strings end to end. Constructing `new Date(y, m, d)` and reading `.getDate()` back would shift the entire grid by a day for anyone whose browser is not on UTC+8 — the same class of bug as the raw `slice(11,16)` timestamp already sitting in the portal's `InTodaySummary`.

**Correction.** An earlier revision of this work overwrote `components/ui/donut.tsx`, which already existed and is imported by `dashboard-cards.tsx`. It has been restored to its original implementation and API; the new work uses it rather than replacing it.

**Not in this release.** The Dashboard tab's own body is still the previous card stack — the hero stat tiles, bar chart, attendance ring and sessions table shown in the design preview are the next phase. The shell, the two side columns and the primitives they need are what shipped here.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.13.0] — 2026-08-14 — ERP shell: grouped sidebar, KPI tiles, page headers

The CEO supplied a second set of reference screenshots (DZI Holistik) specifying the **opposite** navigation paradigm to the first set: a grouped text sidebar and an edge-to-edge working area, rather than v1.12.0's icon rail on a floating rounded canvas. He confirmed the DZI direction, so the shell is rebuilt. **Desktop only** — every rule is `md:`-prefixed and the v1.11.1 phone is untouched.

**Grouped sidebar** (`components/layout/side-nav.tsx`). Twenty-one modules in eight labelled sections — Overview, Work, Sales, Inventory, Human Resources, Finance, System, My HR — with gold section headers, a gold bar on the active row, a collapse toggle down to a 64px icon strip, and the signed-in name and role pinned at the foot. An icon rail is fine for six destinations; at twenty-one, and heading past thirty as Purchasing, Commission, Ads Fund, Cash Flow, Reconciliation and Accounting arrive, unlabelled icons stop being navigation and become a memory test.

**It decides nothing about access.** The sidebar renders the same `navItems` array the role gating and the CEO's per-user tab-access overrides already produce; grouping is presentation. A section appears only if one of its tabs survived that filter, and any tab absent from the grouping map still renders under "Other" — so adding a module can never make it unreachable by forgetting to list it.

**Shell** (`app-shell.tsx`, rewritten). Sidebar + working column: sticky topbar, page header with the title left and a breadcrumb right, content area on the muted page surface, and a footer bar. The portal's existing header becomes that topbar on desktop (`md:-mx-5 md:-mt-4` breaks it out of the content padding) instead of dissolving into the page.

**`StatTile` / `StatStrip`** (`components/ui/stat-tile.tsx`) — the reference's solid-colour KPI blocks: oversized tabular number, label, watermark glyph.

**A contrast trap, closed properly.** The obvious implementation reuses `--success` / `--danger` / `--info` as tile fills. That breaks in dark mode, where those are _text-grade_ tokens and flip to light values (`#4ade80`, `#f87171`, `#38bdf8`) meant to be read as ink on a dark surface — white text on them measures about **1.7:1**. Tiles therefore use six dedicated `--tile-*` fills, each shipping its own `--tile-*-fg`, every pair verified **≥ 4.5:1 in both themes** (lowest is 5.02:1). The foreground is not a prop, so a caller cannot pick a failing pair. White on the brand gold `#c9a227` is ~2:1 and is likewise handled — that tone carries navy ink.

**Also found, not fixed:** the codebase has no `@custom-variant dark` declaration, so in Tailwind v4 the thirteen existing `dark:` utilities key off the operating system's colour-scheme preference, **not** the app's own dark-mode toggle. Those thirteen spots will disagree with the rest of the UI whenever the two settings differ. Left alone in this release because fixing it changes behaviour across the app and deserves its own pass.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.12.0] — 2026-08-14 — App shell: the portal moves onto a rounded canvas

The first phase of the UI/UX uplift the CEO asked for from three reference mockups. **Desktop only** — every class added in this release is `md:`-prefixed, so the phone renders byte-for-byte as it did in v1.11.1.

**The shell.** `/portal` on a laptop no longer sits on a plain white page with a navy strip pinned over the left edge. It now sits on a **dark band (`--shell-backdrop`) as one large rounded canvas**, with the navy icon rail forming the canvas's own left edge. New `components/layout/app-shell.tsx` composes it: backdrop → canvas (26px radius, soft shadow) → navy gutter + content. The rail is `sticky` inside a full-height gutter rather than `fixed` to the viewport, so it rides the canvas instead of floating over it — and on a page longer than the screen the navy edge runs the whole way down instead of stopping at the fold. Nothing uses `overflow-hidden`, which would silently kill the sticky rail; the rounded corners are carried by the gutter and the canvas.

**The v1.8.0 `md:pl-14` spacer is gone.** Rail and content are a flex row now, so no element has to be pushed clear of a fixed one. Adopting the shell was a change to **outer JSX only** — no state, effect, API call, role gate, tab-access override or punch rule was touched. `pnpm typecheck` clean, `next build` clean.

**Design tokens (Phase 0).** Added, never renamed: `--shell-backdrop`, `--brand-primary-soft`, `--tint-navy`, `--tint-gold`, `--radius-shell` (26px), `--radius-card` (16px), `--shadow-soft`, `--shadow-shell`, each with its own dark value in the same commit. Exposed through `@theme` as `bg-shell-backdrop`, `rounded-shell`, `rounded-card`, `shadow-shell` and friends.

**Chart colours — validated, not eyeballed.** New ring and bar steps, run through a palette validator against the real card surface in both themes: attendance ring `#15803d`/`#c9a227`/`#dc2626` on light and `#23773d`/`#af8c28`/`#d22023` on dark (all checks pass, worst CVD ΔE 8.6 and 8.8); ordinal bar ramp `#aab8cd → #5b6d8e → #1a2946` light, `#3e5580 → #7189b4 → #b6c6e0` dark (both pass). **A real defect surfaced doing this:** the existing `--warning #b45309` and `--danger #dc2626` are not separable from each other — ΔE 2.8 under deuteranopia and **9.9 under normal vision**, against a floor of 15. Wherever an amber chip sits beside a red one, nobody can reliably tell them apart. The ring's middle segment therefore uses gold. The chip tokens themselves are unchanged in this release and want a follow-up.

**Cards step to 16px on desktop** (`md:rounded-lg` → `md:rounded-card`), so phone and desktop finally agree and cards sit properly inside the rounded canvas. One string in `lib/ui-styles.ts` restyled every card in the portal, admin and account — which is exactly why that file exists.

**Not in this release** (next phases): the dashboard grid reflow with hero stat tiles, the context panel with the mini calendar, the week-grid roster, the right-hand queue rails, and the operations map. `/admin` and `/account` keep their current desktop layout until the rail question for those surfaces is settled — they were deliberately not given a canvas without one.

**Setup:** `pnpm install && pnpm build`, deploy the site. Front-end only — no Worker change, no migration, no secrets.

## [1.11.1] — 2026-08-14 — Admin + Account app shell, deploy script rebuilt

**One shell across all three signed-in surfaces.** The mobile app shell introduced on `/portal` in v1.10.0 now renders identically on **`/admin`** and **`/account`**: every tab carries an icon, the active tab sits in a filled navy rounded square with its label in navy underneath, the bar is `min-h-16` with the phone's home-indicator inset respected, and labels truncate so a long name ("Testimonials") can't unbalance the row. The three navigations are class-for-class identical. Desktop is untouched — `/admin` keeps its tab-pill grid, `/account` its two-column nav, `/portal` its icon sidebar.

- **`/admin`** — a local `TAB_ICONS` map covers all 12 tabs (admin's names are its own, so the glyphs are defined here rather than pulled from the sidebar's shared map; where names overlap the two agree). The More sheet gained tab icons and bottom padding that clears the taller nav plus the safe-area inset — the last row of tabs was half-covered and untappable on notched iPhones. Role filtering is unchanged: Users/Staff/Audit stay hidden from non-admins, and because admin's More sheet holds only overflow tabs (no Preferences, unlike `/portal`), gating it on `rest.length > 0` remains correct.
- **`/account`** — the three customer tabs get 👤 / 📦 / 📨.
- **Both** — the sticky mobile header no longer overhangs the viewport by 4px each side (`-mx-5`/`px-5` → `-mx-4`/`px-4`, matching the wrapper's own mobile padding), page bottom padding rose to `pb-28` for the taller bar, and the mobile `h1` steps up to `text-xl font-bold` to read as an app screen title.

**DEPLOY.bat rebuilt.** The old script had three faults, all visible in the last deploy log: it ran D1 migrations from the project root (where `wrangler.toml` is the _website assets_ config and carries no D1 binding, hence "Couldn't find a D1 DB 'azoneofficial'"); it built the site into `out\` but never published it, because no root `wrangler deploy` step existed; and its error checks missed wrangler's Windows exit codes, so a failed step didn't stop the run. It is now five explicit steps — install → migrations (from `worker\`) → API deploy → site build → **site publish** — with a real `%errorlevel%` check after each, a guard that `worker\wrangler.toml` is present, and a refreshed post-deploy checklist.

**Housekeeping.** Removed a stray `test_tiktok.ts` that carried the TikTok app secret and an access token in plain text, plus `test-crypto.js`, `fix_portal.js`, `worker/update-all.sql`, and the eleven never-imported components from the abandoned parallel redesign. `outputFileTracingRoot` is pinned in `next.config.ts` so Next stops warning about the inferred workspace root.

**Setup:** `pnpm install && pnpm build`, then deploy. Front-end only — no Worker change, no migration, no secrets.

## [1.10.0] — 2026-08-14 — Mobile app shell (CEO-approved reference design)

Phones only — the desktop keeps the v1.8.0 sidebar shell pixel-for-pixel. Pure front-end: **no Worker change, no migration, no secrets**; deploy is site-only.

**App bar** — the mobile header calms down to avatar + a bold screen title (**"Today"** on the Dashboard, BM _"Hari ini"_; the tab name elsewhere) + four controls in the reference design's soft rounded squares: 🔎 search, 🔔 bell (unread badge kept), 🌙 dark mode, Sign out. Sound, push alerts, EN/BM and the 🎨 theme preset move to the More sheet's new **Preferences** row (bilingual labels) — set-once switches, not daily taps. Desktop header unchanged.

**NEXT EVENT hero card** — a navy panel at the top of the mobile Dashboard: gold letter-spaced eyebrow, the event title big, 🗓 date (DD-MM-YYYY) + 📍 location, the soft decorative circles, and an "in N days" chip. Fed by Upcoming events, falling back to the sooner of the next public holiday (year-end aware) or staff birthday; hides when there's nothing. Tapping scrolls to the Upcoming events card. Fixed navy (`bg-brand`) so the gold eyebrow stays readable in dark mode and restyles under the Plum preset; the fetches don't even run on desktop, where the card can never be seen.

**On shift** — the quick-actions card takes the reference design's presentation: the heading reads **"On shift"** (BM _"Sedang bertugas"_) while clocked in, and the buttons grow to tall rounded-xl app buttons on phones (identical from `md` up). Class changes only — the v1.9.1 geofence flow, clock-out banner, OT punches and all guards are byte-for-byte untouched.

**Bottom navigation** — each tab now shows the same icon the desktop sidebar uses, and the active tab sits in a **filled navy rounded square** with its label in navy underneath, exactly like the mockup. Labels truncate so BM ("Papan Pemuka") can't unbalance the row. **More now always renders** (review fix: a role trimmed to ≤4 tabs would otherwise lose the Preferences entirely) and its sheet gained tab icons + the Preferences strip, with bottom padding that clears the nav plus the iPhone home-indicator inset (review fix: the row was half-covered and untappable before).

**Card language** — every card portal-wide is `rounded-2xl` on phones via the one shared token (`md:rounded-lg` keeps desktop identical); dashboard card headings step up to 15px on phones.

**Other review fixes baked in:** page bottom padding raised for the taller nav; the quick-action breakpoint moved sm→md so the whole mobile shell flips at one width; ghost buttons only dim when disabled on phones (desktop had no such rule); header no longer overhangs the viewport by 4px each side; the mobile title reads the clamped active tab.

**Setup:** `pnpm install && pnpm build`, deploy the site. Worker untouched.

## [1.9.1] — 2026-08-14 — Office geofence clock in/out + clock-out reminders

**Office check-in (geofence) — replaces the selfie step** (CEO: "instead of using face checking, can I use location"). Management (super_admin/CEO/COO) sets the office point + radius on the **Users tab → 📍 Office check-in** card — easiest with the "Use my current location" button while standing at the office (pasting "lat, lng" from Google Maps also works and auto-fills both boxes). Once ON:

- **Clock in, clock out, OT in and OT out** all require the phone's position and must be inside the radius — enforced **server-side** (the distance check runs in the Worker; the UI is only the messenger). Outside the fence → a clear "~X km from AZ ONE HQ" refusal; no record is created.
- Accuracy grace: up to 150 m of the phone's reported GPS accuracy counts toward "inside" (GPS in a building drifts), capped so a spoofed accuracy can't void the fence. 100–200 m is a realistic radius.
- The position is stored on the punch (`gps` column, present since 0003 — **no new migration**), alongside the IP + user-agent already recorded.
- Fence OFF (or never set) → punches behave exactly as before, and staff get **no location permission prompt at all**.
- Honest limit, stated on the card: browser GPS comes from the client and a determined user with dev tools can fake it. This stops casual clock-in-from-bed; the stored IP is the cross-check.

**Clock-out reminders** ("how to remind them to check out"):

- **18:30 MYT** — anyone with today's clock-in and no clock-out gets a bell + web push: "remember to tap Clock out before you leave the office." Staff currently inside an OT window (OT in without OT out) are **not** nagged mid-overtime.
- **22:00 MYT** — a firmer reminder for everyone still open, OT or not, including the fix path ("already home? ask HR/admin for a manual clock-out").
- Each stage fires **once per person per day** (notification-ref dedupe), stops by itself after midnight MYT, and runs ahead of the TikTok sync in the cron so a sync failure can never swallow it.
- On the Dashboard itself, an amber "⏰ Don't forget to clock out" banner appears from 18:30 for anyone still clocked in (EN/BM).

**Selfie clock-in removed** — camera modal, upload route and the punch's selfie attachment are gone; migration 0070 stays (the column is harmless), and selfies already recorded remain in private R2 storage behind the owner/HR media gate.

**Review fixes baked in:** OT-skip in the reminder cron reads `ot_records` (not `attendance_records`, whose CHECK constraint can't even hold OT rows); the geofence save rejects non-numeric coordinates on both client and server (a `NaN → JSON null → 0` chain could otherwise have saved a fence at 0°,0° and locked everyone out); OT punches share the same fence gate as clock punches; "already punched" answers never demand location.

**Setup:** deploy worker + site (`pnpm build` locally first). No migration to apply. No new secrets.

## [1.9.0] — 2026-08-14 — Phase 4: drag-and-drop roster, selfie clock-in, themes, BM, ops map

**Drag-and-drop rescheduling** (Schedule & Roster, desktop) — managers drag a scheduled session block to another day/time (30-minute snap, grab-point aware); a confirm bar shows the exact new slot before anything saves. Both the new and (on reassignment) the previous host are notified. `PATCH /live-sessions/:id` now accepts date/time/host changes. Overnight sessions keep their end time. Touch devices keep the tap-popover flow.

**Selfie clock-in** — Clock in opens the front camera (mirror preview, square crop); the capture uploads to private R2 storage and attaches to the punch. Deliberately optional: no camera, no permission, or Skip all still clock in — attendance is never blocked by a webcam. Selfies are viewable only by the owner, HR and management (media gate, fail-closed), keys are single-purpose (10-minute replay window, per-user prefix), and the upload has a hard 3 MB enforced cap. Migration **0070** adds `attendance_records.selfie_key`.

**Plum & Rose theme preset** — the 🎨 button switches between Navy & Gold (default) and the reference design's plum palette; a pure token swap (light + dark tuned), stored per device.

**Bahasa Melayu chrome** — the EN/BM button translates the portal chrome: tab names, sidebar, bottom navigation, header, quick actions and the greeting. Data and deep panels remain English by design (honest bilingual chrome over a half-translated app).

**Operations map** (Ecommerce tab) — TikTok orders by buyer city grouped into Malaysian states, drawn as bubbles on a schematic Malaysia with a top-states list. Revenue roles only.

**Setup:** apply migration 0070 (`cd worker && npx wrangler d1 migrations apply azoneofficial --remote`) and deploy worker + site.

## [1.8.0] — 2026-08-12 — The new portal shell: sidebar, global search, Schedule & Roster, dashboard cards

Adopts the approved reference design's layout in AZ ONE's navy/gold brand. Phones keep the bottom navigation unchanged.

**App shell (desktop)** — a fixed icon sidebar replaces the two-row tab pills on md+ screens, driven by the same tab list (CEO tab-access control, role gates and the no-flash clamp all reused). Top bar gains a global search: Ctrl/Cmd+K or the 🔎 field opens a command palette that jumps to tabs, staff, clients (revenue roles) and quick actions.

**Schedule & Roster** (Attendance tab) — the reference's flagship screen: a week time-grid of live sessions (08:00–23:00) with conflict flags (double-booked host, host on approved leave), a session detail popover with mark-completed/cancel, stat chips (scheduled / available today / on leave / conflicts), a mini month calendar with session dots, an unassigned-requests rail fed by new client enquiries with one-tap Schedule, an "available today" list, and a click-to-assign modal that posts to the existing /live-sessions API. New Worker aggregate `GET /staff/roster?week=`. PDPA: leave details are scoped — managers see who is on leave (never the type); other staff see only their own.

**Dashboard** — greeting header ("Hello, {name}!"), a Peak-hour tile in the pulse strip (opens the by-hour breakdown), and a new card row: Attendance-today donut (on time / late / not clocked in, tap for detail), Assignments-today table (host, client, time, status; jump to the roster), and month-by-month sales bars with the best month highlighted. Donut populations aligned to active staff only.

**Fixes along the way** — grid blocks clamp to the visible window; palette results grouped after ranking; clients lookup skipped for roles without revenue access (no guaranteed 403s); roster error state with retry; "Today" button always refreshes.

**Housekeeping** — the four hazard files that re-appeared via folder-merge (test_tiktok.ts, worker/update-all.sql, test-crypto.js, fix_portal.js) are deleted again. Reminder: unzip releases into a FRESH folder, not over the old one.

## [1.7.3] — 2026-08-12 — Health card knows migrations 0068/0069

- The /admin System-health card, the migration probes and the yellow "migrations pending" banner now include 0068 (targets/commission/push) and 0069 (stokis/content/receipts) — so a deploy that forgets `wrangler d1 migrations apply` is named explicitly instead of surfacing as "temporarily unavailable" panels.

## [1.7.2] — 2026-08-12 — Stop the TikTok/API error-notification flood

- **Fix: the "N new system errors (api ×4/×5…)" bell flood.** Each unhandled API error logged a message that embedded a fresh random error id, so the 6-hour de-dupe (v1.5.0) never collapsed repeats and every poll counted as a brand-new error. The id now goes only to the caller's response; the stored log message is stable, so identical exceptions de-dupe and management stops being paged every 30 minutes. The id is still returned to the user for support correlation.
- **Fix: an expired TikTok token no longer spams errors.** An expired/unauthorized TikTok token is now treated as a known "please reconnect" state (code not_authorized) rather than a system fault — the 30-minute cron stays silent about it (no error-log row, no bell/push), and the UI shows a clear "reconnect TikTok" message. Combined with v1.7.1 auto-refresh, a healthy connection renews itself; only a rotated app secret or a fully revoked token needs a human.

## [1.7.1] — 2026-08-11 — TikTok token auto-refresh

- **Fix: TikTok "Expired credentials" no longer breaks the sync.** `tiktokToken()` read the stored access token but never refreshed it, so once TikTok's ~7-day access token lapsed, every order sync failed. It now auto-refreshes using the stored refresh token whenever the token is within a day of expiry (so any 30-minute sync pass renews it well ahead of time). Refresh failures are logged once (deduped) with the cause. No re-authorizing needed on a normal cycle.
- Note: token refresh (and webhook signature verification) both require `TIKTOK_APP_SECRET` to match Partner Center — if the app secret was rotated, set it via `wrangler secret put TIKTOK_APP_SECRET` and the connection heals on the next sync.

## [1.7.0] — 2026-08-11 — Sales Pipeline, Content, Stokis, Receipts/Credit Notes, dashboard pulse

Four new business modules (migration **0069**) plus the dashboard company-pulse tiles.

**Sales Pipeline (LEAD → WON)** — new Pipeline tab, rebuilt on the retained prospects data: Lead → Contacted → Meeting → Proposal → Negotiation → Won/Lost, with owner, follow-up date, source/niche/referral, and a "prepare quotation" jump to Sales. The follow-up reminder cron is back and now web-pushes the owner. Every staff role can log a lead; the sales tier moves stages. Legacy prospect stages are mapped on display.

**Content management** — new Content tab: plan TikTok/Reel/Live/campaign content on a schedule, move each through IDEA → SCRIPT → SHOOT → EDIT → APPROVAL → POSTED, keep script + caption + campaign together, assign an owner (notified/pushed), and log performance after posting.

**Stokis management** — new Stokis tab: register resellers (contact, location, commission %), record each purchase, and see per-stokis total, outstanding balance, this-month sales vs a monthly target, and the commission the rate would pay. Active/inactive status. Read + write gated to the sales/management tier.

**Receipts, Credit Notes & Outstanding report** — on the Sales tab, a Documents panel: issue a numbered Receipt for any paid invoice (RC-AZOO… numbering, idempotent), raise a Credit Note against an invoice (CN-AZOO…), and a consolidated Outstanding-payments report across all clients. Receipts and credit notes print with the company letterhead (legal name, address, logo) via the browser's Save-as-PDF.

**Dashboard company pulse** — a compact strip of live counters below the ticker: clients, active stokis, lives today, staff clocked in today, unpaid invoices, and a month cash-flow figure (invoices paid − expenses).

**Setup for this release**

- Apply the migration: `cd worker && npx wrangler d1 migrations apply azoneofficial --remote` (adds 0069). The Pipeline works once 0066/0069 are applied; the other modules need 0069.

## [1.6.1] — 2026-08-11 — Dashboard KPI editing + Needs-attention placement

- **Needs attention** moved into the top ticker row, right beside the "All-time — every channel" card (position 4), instead of a separate strip at the bottom of the dashboard. A rare "Unpaid invoices" card now falls after it so it never gets pushed out of the top row.
- **Monthly KPI target is now set on the Dashboard.** The Sales Floor KPI section has an inline Set/Edit target control — restricted to super_admin, CEO and COO (server guard tightened to match: `admin` no longer sets the KPI). Setting the target turns on the progress bar and pace tracker immediately.
- The editable KPI target block was **removed from the Ecommerce tab's Sales-revenue card** (it was a duplicate). That card keeps the per-channel breakdown and last-month KPI result for context; the target itself lives on the dashboard.

## [1.6.0] — 2026-08-11 — Sales leaderboard & commission engine, client order tracking, PWA + real-time notifications

**Sales targets, commission & leaderboard**

- New engine: per-person and per-team monthly targets (the company target stays on the revenue card), tiered commission rules (base % on all attributed sales + a bonus % on the amount above target — the "1.5% base + bonus over target" model), and a live leaderboard on the Ecommerce tab.
- Attribution: each person's sales = paid invoices they closed (salesperson) + TikTok GMV that landed inside their live-session windows (the same attribution the LIVE GMV card uses). The leaderboard ranks the whole floor, highlights "you", and shows each person's commission estimate to management.
- Management editor (CEO/COO/CCO/admin): set per-person and per-team targets and manage commission rules inline. Migration `0068` adds `user_sales_targets`, `team_sales_targets`, `commission_rules`.

**Client order tracking (customer /account)**

- New "Orders" tab: a signed-in customer sees their quotations, invoices (tap to open the share-link PDF) and live-session history. Invoices show paid/unpaid with due/paid dates.
- Security: order history is shown only to accounts with a verified email (Google sign-in), so nobody can register a stranger's email to read their invoices; password accounts get a clear "verify to see your orders" notice with a WhatsApp fallback.

**PWA + real-time notifications**

- The portal notification bell is now real-time: an SSE stream (`/staff/notifications/stream`) delivers new notifications within ~5 seconds instead of up to 60, with a 120-second poll kept only as a safety net. The stream self-closes after ~20s and reconnects automatically — no connection is held open indefinitely.
- Web push: staff can turn on push alerts per device (🔕/🔔✓ in the header) and receive notifications even with the tab closed. Full RFC 8291/8292 web-push implemented on Web Crypto in `worker/src/webpush.ts` — **needs three VAPID secrets** (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; generate with `npx web-push generate-vapid-keys`). Without them push is simply off and in-app + SSE still work.
- The service worker (`public/sw.js`) now caches an offline app shell and handles push + notification clicks. The app was already installable (manifest + registered SW); this makes it work offline and push-capable.

**Setup for this release**

- Apply the migration: `cd worker && npx wrangler d1 migrations apply azoneofficial --remote` (adds 0068).
- Optional (for push): set the three VAPID secrets via `wrangler secret put`.

## [1.5.0] — 2026-08-11 — Security hardening, CCO login fix, Social removed, trading-style dashboard, global styles

**Security & bug fixes (audit)**

- Deleted committed secrets/backdoors: `test_tiktok.ts` (live TikTok app secret + seller token), `test-crypto.js` and `worker/update-all.sql` (the `SuperSecretPassword123` incident hash), `fix_portal.js`. **Rotate the TikTok app secret and reset the two affected passwords — assume the old values are public.**
- **CCO cannot log in after logout** — root-caused and fixed on several fronts: (1) login rate limit now counts only FAILED attempts, keyed per account+IP, so successful sign-ins from one office IP no longer lock everyone out; (2) the 2FA-required "Sign out" button called `document.cookie` on an HttpOnly cookie (a no-op) and looped forever — it now calls `POST /auth/logout`; (3) `cco` added to `MANDATORY_2FA_ROLES` (was a transposition gap); (4) `www.` origin accepted so sign-in works on both hosts; (5) `/auth/me` and all API responses are now `no-store` so a stale "signed in" reply can't bounce a signed-out user back into the portal.
- Media serving rewritten to default-deny: only `uploads/` is public; database backups, staff documents, payroll templates and claim receipts now require auth and ownership. SVG upload removed (stored-XSS vector). `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` added to every response.
- Logout clears the `csrf_token` cookie and supports `{ all: true }` (sign out every device). CSRF and token comparisons now constant-time.
- 2FA backup codes upgraded to PBKDF2 + widened keyspace (legacy SHA-256 codes still verify). Offboarding blocks every sign-in path via `employment_status` (login + Google OAuth) while keeping the leaver on their final payroll run.
- Rate limiting made atomic (single upsert). Webhook receipts rate-limited and trimmed. Admin-tier accounts can only be modified by a super admin (a CEO could previously reset an admin's password).
- **Error-notification flood fixed**: `tiktok_location` logged once per order on first import instead of every 30-minute sync pass; `error_log` de-duplicates identical entries within a 6-hour window and trims lazily. This is what produced the "22 new system errors since the last check" bell spam.
- Runtime bugs fixed: Expenses tab (`month` → `mE`), Fulfilment drill-down and payroll commission-base (undefined `url`/`PAYROLL_PROC`), the "client gone quiet" cron (`notify` was never imported), returned/cancelled TikTok orders no longer deduct stock, `doc_type` filter bound as a parameter, download filenames sanitised.

**Social tab removed** (CEO direction) — tab, panels (prospects pipeline, trends, pipeline insights) and Worker API routes removed. Prospect data is retained in the database, untouched.

**Trading-style dashboard** — the hero band is now a Sales Floor: live today-vs-yesterday ticker in market green/red, a KPI target bar with a pace marker (target auto-computed from history: last month +10%, a manual target still wins), product-vs-service market targets, pace-aware motivation, and data-driven boost suggestions (best live hour, unpaid invoices, open quotations, restocks). The calendar is unchanged.

**Global styles** — one shared `lib/api.ts` replaces 15 drifted per-file copies; `lib/ui-styles.ts` gains `btnGhost/btnHdr/btnSm/chip*` etc.; `styles/globals.css` gains semantic status tokens (`--success/--warning/--danger/--info`), one canonical gold (`--gold-solid`) and market `--bull/--bear`; hardcoded hex in the KPI cards replaced with tokens.

## [1.4.282] — 2026-08-11 — Quick actions first + the auditor's top-3 (migration health, permission matrix, offboarding)

### Rebased onto the 2026-08-11 security-fixes tree (all adopted): webhook 64KB body cap, generic 500 message (no detail leak), TikTok authorize requires a management session + audits the real user, 2FA setup blocked when already enabled, admin creation = super_admin only, HR staff-creation can no longer mint executives.

### CEO: "Quick Action on dashboard need to put top" + auditor picks

- **Quick actions now leads the Dashboard**; the hero band reads second.
- **🗄 Migration health (auditor pick 1)** — /system/health now reads wrangler's own `d1_migrations` ledger and compares it against the compile-time list of ALL 67 migrations this build ships; SystemHealthCard gains a collapsible "Migration health — N/67 applied" table (✓ grey / ✗ red). The red pending box stays for urgency; this is the complete picture. STANDING RULE extended: every new migration adds itself to EXPECTED_MIGRATIONS.
- **Role permission matrix (auditor pick 2)** — NEW `docs/PERMISSIONS.md`, generated FROM the live PERMS table (14 capabilities × 11 roles) plus every route-level rule (role changes, chains, tab access, offboarding, public routes) and a privilege-creep review rule: any release touching PERMS/TAB_ROLES must update the file or the file is the bug.
- **🚪 Offboarding flow (auditor pick 3)** — NEW `POST /users/:id/offboard` (admin tier + CEO; never admin-tier targets, never yourself): ONE audited call marks resigned + final date (default today MYT), revokes every session, clears the TOTP secret + backup codes. One red "🚪 Offboard" button in the staff directory (open record, amend roles only, hidden once already resigned/terminated) with a danger confirm; date/status editable after via the normal fields.
- Whole repo passes the tsc grammar gate.

## [1.4.281] — 2026-08-10 — 🧩 Business lines: product sales vs service sales

### CEO: "add a card of sales service too, since my company do 2 business… make it necessary requirement… and make it expandable"

- **Business-line reporting is now a core requirement of the revenue system.** NEW `revenueLines()` in the worker buckets every ringgit into a named line — product (TikTok + Shopee/walk-in postage + manual sales + paid product invoices) and service (paid service invoices) — and `revenueByMonth()` is now the SUM of those buckets, so /revenue, /finance/pnl, the hero band and the new card can never disagree.
- **Expandable by design:** a future third business line is ONE more bucket in `revenueLines()`; the `/revenue/lines` route and the card render whatever lines exist, so nothing downstream changes.
- **🧩 Business lines card** (Ecommerce tab, above Sales history, revenue roles): all-time share of each line with brand-toned bars + %, then a month-by-month table (one column per line, TOTAL column and footer).
- **Honest pre-migration state:** on a DB without migration 0061 (`kind` column), paid invoices go into an explicit "Invoices (run migration 0061 to split)" line with an amber note — never silently guessed into product or service.
- **NEW: real `tsc` grammar gate** — the whole repo (every page, component, lib, worker file) now passes a TypeScript parse before packing; this is the audit's quality gate, live from this release.

## [1.4.280] — 2026-08-10 — Audit response: build fixed, backdoor string removed, PBKDF2 raised

### An external code audit found 4 syntax errors that broke the build, plus 2 security items — all verified and fixed

- **Build errors (all confirmed real, all repaired):** (1) `CrudPanel` in /admin had two hooks injected inside its parameter list — moved into the body; (2) the payroll M2E + commission-helper `<details>` blocks were two siblings inside a single-element `( )` — wrapped in a fragment; (3) the v1.4.270 `maxStock` line had been injected into the middle of the inventory sort ternary — hoisted above it; (4) a v1.4.272 regex sweep mangled the payroll due-date into `split(" ")dmy([0])` — repaired to `dmy(split(" ")[0])`. LESSON recorded: brace/paren balancing cannot catch balanced-but-misplaced code; a real typecheck gate is now the standing priority.
- **`test-crypto.js` DELETED** — it still contained the v1.4.22 incident password string; the file was an unreferenced scratch helper. Repo-wide grep is now clean.
- **PBKDF2 raised 100k → 310k**, matching docs/SECURITY.md and the code's own comment. Safe without migration: the stored format `pbkdf2$<iterations>$…` carries each hash's own count, so existing passwords verify at their stored strength and every new/changed password gets 310k.
- DEPLOY.bat unchanged — extract, open folder, double-click; the build step now passes.

## [1.4.279] — 2026-08-10 — DEPLOY.bat: the one-click installer

### CEO: "settle this issue!" — the deploy kept failing because the commands were run outside the project folder; so the folder problem is now removed entirely

- NEW **`DEPLOY.bat` at the repo root.** Extract the zip → open `azoneofficial-main` → **double-click DEPLOY.bat**. That is the whole procedure now.
- It always runs from its own folder (`%~dp0`), so the wrong-directory failure cannot happen; it refuses to run with a clear message if it's been moved somewhere without `wrangler.toml`.
- Steps it performs: `pnpm install` (first run only) → `wrangler d1 migrations apply azoneofficial --remote` (non-interactive via CI=true, so no y/n prompt) → `wrangler deploy` in /worker → `pnpm build`. Any failure stops with "screenshot this window"; success ends with the exact list of what to check on the portal.
- No code changes otherwise. The v1.4.278 stack (and everything before it) still switches on with this deploy.

## [1.4.278] — 2026-08-10 — Sales tracking, expenses P&L, and pipeline insights

### CEO: "I want an update coding! additionally, I want powerful system for my sales track and also expenses and business opportunities"

- **📊 Sales history (Ecommerce tab, under Sales revenue):** every month of the business, all four channels, newest first — month-over-month ▲/▼%, a bar measuring each month against your best (🏆 on the best), TOTAL footer. Frontend-only: reads the v1.4.276 `overall` block.
- **💹 Profit & loss by month (Expenses tab, above the register):** revenue − expenses − payroll − approved claims = NET (green/red). NEW worker `GET /finance/pnl` — revenue via the shared `revenueByMonth()` helper (extracted from /revenue so the arithmetic stays ONE copy), payroll via the SAME net expression the M2E salary file uses (`net_cents` with the additive fallback — never a second payroll formula), expenses by expense_date, claims = approved by claim_date; every source armored, a month appears if any source has it.
- **🎯 Pipeline insights (Social tab, above Prospects):** the funnel as bars in stage order, win rate of closed deals, WHICH SOURCE actually closes (won/total per source), and top referrers (pre-0067 safe). NEW worker `GET /prospects/insights` with the standard 409 when 0066 hasn't run.
- All three cards render null until the worker has the routes / migrations run — no red boxes, the existing deploy notices already tell that story.
- Worker + frontend. No new migration. ⛔ The deploy (0060→0067 + worker + build) is still the gate for everything.

## [1.4.277] — 2026-08-10 — Sales revenue → Ecommerce; the migration card now names ALL pending migrations

### CEO: "Sales revenue — 2026-08 move to Ecommerce" + his red migration box

- **SalesRevenueCard moved from the Dashboard to the TOP of the Ecommerce tab.** The hero band already tells today + month + overall at the top of the Dashboard, so the detailed month card was the Dashboard's third telling of the same story; on Ecommerce it now leads the channel detail (Orders → GMV → by-hour → Fulfilment → Connection).
- **The migration self-report learns the newer migrations:** probes now include **0066 (prospects / Social tab)** and **0067 (growth pack)** — his card listed 5 pending but the true set is 7. Also widened the catch to `no such table` (0066 creates a table, not a column — the old catch would have missed it).
- Frontend + worker. His action stands: `npx wrangler d1 migrations apply azoneofficial --remote` then `cd worker && wrangler deploy` then `pnpm build`.

## [1.4.276] — 2026-08-10 — 📈 Overall business sales on the hero band

### CEO: "I want to get 1 more card to monitor overall business sales"

- The Dashboard hero band gains a fourth card: **📈 Overall sales — all time** — the whole business since day one (20-07-2026), all four channels (TikTok orders, paid invoices, other shipments, manual sales), summed per MYT month **server-side by the same SQL the month figures already use** (the v1.4.226 mirror rule — revenue arithmetic is never written twice).
- The bar inside the card shows **this month against your best month** (navy; turns green the moment this month becomes the best — and the label says so). Sub-line counts the months of business.
- Worker: `/revenue` response gains `overall { total_cents, months[], best }` — each channel's all-time query armored separately, so a pending migration blanks one channel, never the card. Renders only when there's a number (never zero stats).
- Card design stays inside the band rules: Today keeps the single navy solid; Overall is a white card.
- Worker + frontend. No migration.

## [1.4.275] — 2026-08-10 — The calendar button now says on screen when the server is the blocker

### CEO tested again, still nothing in the phone calendar — because the v1.4.274 route lives on the WORKER, which hasn't been deployed; the button silently fell back to the share sheet (which cannot save on iPhone) and looked identical to the bug

- `addEventToCalendar()` gains a fourth outcome: `"stale"` — the probe found no `/events/:id/ics` route (worker predates v1.4.274). The local share/download fallback still runs, but the toast now says the truth in amber: **"Server needs the update — deploy the worker (cd worker && wrangler deploy), then this button saves properly."**
- This is the v1.4.269 rule again: a fallback must never masquerade as success when its failure is indistinguishable from the bug being reported.
- Frontend-only — but the actual calendar save still arrives with the worker deploy.

## [1.4.274] — 2026-08-10 — Add to calendar now actually lands in the phone's calendar

### CEO: "when I add calendar for the event, it doesnt save inside my calendar phone" — he's right, and the cause was the share sheet

- v1.4.264 handed the .ics to the phone's SHARE SHEET — but **iOS's share sheet does not offer Calendar as a target for .ics files** (Calendar has no share extension), and Android's rarely does. The sheet opened, Calendar wasn't in it, nothing saved.
- The door both phones actually understand is a **navigation to an HTTPS URL that answers `text/calendar`**: iOS Safari then shows its built-in event preview with an **Add All** button straight into Calendar; Android Chrome opens the file into Google Calendar's import dialog.
- NEW worker route `GET /staff/events/:id/ics` (any staff role) serves exactly that — same MYT→UTC conversion, all-day exclusive DTEND, stable UID (re-adding updates, never duplicates), both reminders (evening before + at start), `Content-Disposition: inline` because iOS only shows the calendar preview for inline responses.
- `addEventToCalendar()` now opens a tab synchronously (inside the tap, so popup blocking can't eat it), probes the route, and points the tab at the .ics. **Fallback:** a worker that predates this route (or offline) drops to the old share/download path unchanged.
- Toasts now say what to do: "tap Add All (iPhone) or Save (Android) on the page that just opened".
- Worker + frontend. No migration — but this route only exists after the worker deploy you already owe.

## [1.4.273] — 2026-08-10 — THE GROWTH PACK (CEO: "all!") — all six sales-boosting ideas, one release

### MIGRATION 0067 (prospects.referred_by · client_report_links · customers.quiet_alerted_on) + worker deploy + pnpm build

**1 · Client report links.** Every client row on the Sales tab has 🔗 Report link — one tap creates (or reuses) a token and copies `azoneofficial.com/report?t=…`. The page is public, read-only, brand-toned: live sessions this month vs last (navy hero card), RM settled this month, hours live, their best live hours (last 60 days) — empty sections simply don't render, and it ends with a WhatsApp CTA. Worker: POST `/clients/:id/report-link` (idempotent) + public GET `/api/v1/client-report?t=`.

**2 · Prospect → Quotation in one tap.** A 📄 Prepare quotation button appears on _meeting/proposal_-stage prospect rows (sales roles): it hands the brand + contact to the Sales tab via localStorage and jumps there. Sales picks the existing customer by company name if one exists (else pre-fills the new-customer form), sets doc type QT, stamps the reference "From prospect: {brand}", and toasts what to do next.

**3 · The public rate card — inside the EXISTING /packages page.** New `PublicRates` section renders the moment the CEO saves tiers on the portal (Sales tab → 📦 Packages — public rate card: up to six tiers, name / price label / bullet points). Published via `system_meta packages_json` + public GET `/api/v1/packages`; until tiers exist the page keeps its current "we quote per brand" copy — no placeholders ever. Publishing needs NO rebuild: the section fetches at runtime.

**4 · The referral loop.** Prospects gain a **Referred by** field (form + ↗ chip in the row meta + PATCH/POST allow-list, insert skew-armored for pre-0067 workers). Now the pipeline can show which channel actually closes.

**5 · Client-gone-quiet alerts.** Cron: any client with sessions on record but none in 14 days → one bell to sales_marketing + CEO ("😶 ELFIA has gone quiet — no live since …"). Deduped via `customers.quiet_alerted_on`; booking a new session clears the flag instantly; otherwise it re-arms after another 14 days.

**6 · Live-hour economics.** New Sales-tab card ⏱💰: per client — completed session hours vs PAID invoice RM this month (payment-received basis, mirroring /revenue) → RM/hour; per host — session hours vs TikTok GMV landing inside their session windows (the /gmv attribution; motivation, not payroll) → RM/hour. Worker GET `/clients/live-economics`, both halves armored separately.

All new UI uses the globals (fmtRM/rm, dmy/ym, th/td/thR2/tdR2, fieldRow, card, toasts) — the v1.4.272 sweep stays clean by construction.

## [1.4.272] — 2026-08-10 — The FULL globality sweep (CEO: "you are not checking overall! I want you audit overall system and ensure that everything is globally")

### He was right — the audit was mechanical this time (grep-driven, every file), and it found what eyeballing missed

- **ELEVEN private money formatters** were still alive after the v1.4.254 "one file for money" release: five clones inside `page.tsx` (one of them, ClientsCard's, even printed **without thousand separators** — RM 12345.67 on one card, RM 12,345.67 on the next), five across role-panels / assets / fulfilment / sales-by-hour / payroll, plus ~30 raw `toFixed(2)` templates — including the ones I wrote into the new hero band two releases ago. **All deleted or aliased to `lib/format`'s `fmtRM`/`rm`.** One arithmetic source; the hero band now prints RM 12,345.67 like everything else.
- **TWENTY-SIX hand-rolled date reversals** (`.split("-").reverse().join("-")`) across page.tsx, payroll-panel, role-panels, staff-directory, fulfilment-card → all now `dmy()`. NEW `ym()` in lib/format for month keys ("2026-08" → "08-2026") — the target editor, commission helper, and target banners use it.
- **The Assets register had a private `td` const and ad-hoc `text-right tabular-nums`** — its headers were even styled with the _cell_ const. Now on the global `th`/`td`/`thR2`/`tdR2` like every other table: same padding, same uppercase headers, numeric right with tabular figures.
- **Deliberate exceptions, documented:** the three PDF writers (doc-pdf, form-pdf, payslip-pdf) keep local copies — they are standalone by design and their output must byte-match the print templates; payroll's `n2v/n2` input-box formatters now route through the global bare formatter.
- Verification: repo-wide greps return **zero** remaining `split("-").reverse`, zero cents-`toFixed(2)` money strings, zero private td/th consts outside the PDF writers.
- Frontend-only. Migrations 0060 → 0066 + the worker deploy still owed.

## [1.4.271] — 2026-08-10 — The conflict & duplicate audit (CEO: "Do check all my system if there is any conflict or duplicate or repeated flow or card")

### Found and FIXED

- **Two "today" cards on the Dashboard.** v1.4.270's hero band and the Sales revenue card's gold 🔥 Today box both announced today's number — same figure, two designs, inches apart. The gold box is **removed**; the hero's navy card now carries its channel line ("2 TikTok orders · invoiced RM …") plus the ▲/▼ trend, and the Sales revenue card is purely the **month** view. One number, one card.
- **Two overdue chips on one prospect row.** The v1.4.267 ⏰ chip and the v1.4.270 dueChip ("3d overdue") said the same thing twice. The ⏰ chip is removed — one row, one chip, and dueChip says _how many days_.
- **Invoice stock movements bypassed the alert system** — the serious one. `deductForInvoice`/`restoreForInvoice` (v1.4.263) updated `stock` but **not the `status` column and never called `checkLowStock`** — the ONE movement path outside v1.4.191's six. An invoice could drain a SKU to zero with the row still saying _in_stock_ and **nobody notified**. Both now update status and fire/reset the low-stock bell like every other path.

### Checked and CLEAN (no action)

- **Low-stock threshold** is ≤5 consistently in all three places (status rule, alert, hero count). **Trends card** mounts exactly once (Social). **Social** present in both TAB_ROLES-side and tab-access DEFAULTS. **Unpaid invoices (money owed to you)** vs **Expenses outstanding (money you owe)** — opposite directions, not duplicates. **LiveGmvCard today (TikTok GMV, Ecommerce)** vs hero today (all channels, Dashboard) — different scope + audience, kept. **Events' daysAway** vs dueChip — kept separate on purpose: events show far-off dates ("in 12d"), dueChip stays silent beyond 7 days.

### Flagged — PROCESS rules, not code (your judgement applies)

- **Double-count risk:** if the same sale is both a TikTok order **and** a portal invoice, revenue counts it twice and stock deducts twice. Rule for the team: a sale enters the system through **one** door — TikTok sync **or** an invoice, never both.
- Same logic on **manual sales** vs invoices for the same goods.
- **OT approved but not yet fed to payroll** (the standing rounding-rule decision) — repeated flow where hours are entered once and typed again in payroll.
- Worker + frontend, no migrations. 0060 → 0066 + the worker deploy still pending.

## [1.4.270] — 2026-08-10 — The brand-toned hero band + row bars

### Added (CEO approved the plan: "firmly brand-toned, and hero band + row bars on Inventory and Social and do check all the tabs")

- **NEW `components/ui/stat-card.tsx`** — the shared primitives, global from day one: `StatCard` (tiny uppercase label, big figure, progress bar _inside_ the card; `solid` = the ONE navy hero per band — the v1.4.253 one-fill rule applied to cards), `MiniBar` (pure-div bar, gold/green/red/navy), `accentRow/CellDanger|Warn` (urgency tints), `dueChip()` ("in 3d" / "today" / "5d overdue").
- **Dashboard hero band**, above Quick actions, two-up on phones: 🔥 **Today's sales** (the one navy card — total across all four channels, bar vs yesterday, ▲/▼ line), **Month revenue** (gold bar vs the sales target when one is set — the target feature finally gets a face), **Unpaid invoices** (red-edged, only when any exist), **Needs attention** (pending leave / claims / OT, low stock, overdue follow-ups — or "✅ Nothing waiting on you"). One new worker route `GET /dashboard/summary` — five cheap COUNTs, each armored per table so a pending migration can never blank the band; the card, not the route, decides per role what to show.
- **Inventory row bars + tint**: the stock cell carries a bar scaled to the list's own largest stock — red at ≤5 (the low-stock alert line), and the whole row gets the red wash + left accent so a problem line is seen before it is read.
- **Prospect row bars + tint**: each row's meta line leads with a small bar showing the stage as a **position** through the six-stage pipeline (green full = won, red = lost); overdue follow-ups get the amber wash + left accent, and a `dueChip` joins the 📞 date.

### The all-tabs audit (what's already right, what release 2 could add)

- **Already standard, untouched:** Events ("· in 3d / TODAY" since daysAway), Expenses (paid/outstanding summary is already the KPI), the 📊 donut, Fulfilment chips, Attendance chips, sticky totals.
- **Release-2 candidates, not built:** Fulfilment chips → MiniBars; Payroll month-progress bar per staff; Claims/Leave `dueChip` on decision age; Ecommerce GMV hero mini-band; Tasks overdue tint. Say which, if any.
- Worker + frontend, no migrations. **0060 → 0066 + the worker deploy still pending — the band's status card needs the new route.**

## [1.4.269] — 2026-08-10 — "Staff route not found" named for what it is

### Fixed (CEO's screenshot: the amber box said "Staff route not found")

- That message is the **router's own 404** — proof the worker predates v1.4.266 — but the card showed it in the _Google-unreachable_ branch with a Try-again button that could never help. A router 404 now lands in the **deploy-needed** state, with the command. Only a reachable route's failure counts as a Google failure.
- Same blindspot in **Prospects**: a stale worker rendered _"No prospects yet — the first find starts the pipeline"_, which reads as an empty pipeline and invites an Add that cannot save. It now shows the deploy notice instead of the form, so nothing typed can be lost.
- Frontend-only. The actual cure is unchanged and one step: **`cd worker && wrangler deploy`** (plus the migrations, which the red System-health box will keep naming).

## [1.4.268] — 2026-08-10 — The trends card says what's wrong, and retries for real

### Fixed (CEO's screenshot: the Social tab's trends card showed only its failure line)

- The card had **one generic message for two very different failures**. It now separates them: an amber box saying **the worker doesn't have the trends route yet** (with the deploy command) when the route 404s, versus **Google could not be reached** — carrying the server's actual reason, pulled from the error log — when the fetch failed. No more guessing which half is broken.
- **↻ Try again is a real retry**: `?refresh=1` drops the server-side cache before refetching, so the button can't just re-read the same cached miss. Any staff member can press it.
- **The fetch itself is tougher**: two official Google endpoints tried in order (the current `trending/rss` and the legacy `trendingsearches/daily/rss`), a real browser user-agent and RSS `Accept` headers, per-endpoint failure reasons kept, and HTML entities decoded before tag-stripping so a headline never renders with literal `<b>` fragments. Parser verified against both feed shapes.

### Most likely cause of your screenshot

- The **worker deploy**: the trends route shipped in v1.4.266 and lives server-side. If `cd worker && wrangler deploy` hasn't run since, the card can only fail — and it will now say exactly that. If the worker _is_ current, the card will show Google's actual refusal and the ↻ button; the error log (System health, source `trends_my`) keeps the history.
- Worker + frontend, no migrations. **0060 → 0066 still pending.**

## [1.4.267] — 2026-08-07 — The Social tab: prospects + trends (MIGRATION 0066)

### Added (CEO: "Do it, and ensure that my dashboard not exploded. If necessary, then make a new tabs under Social")

- **NEW "Social" tab** between Ecommerce and Assets, visible to **every staff role** — a live host who spots a brand mid-scroll logs it in twenty seconds from their phone. The Dashboard gains **nothing**; the 🔎 Trending searches card **moved here** off the Dashboard, so market-watching and prospecting live side by side and the Dashboard is actually one card lighter than yesterday.
- **📇 Prospects — the team's lead list** (MIGRATION 0066, no FKs per house rule). Brand · found-on (TikTok Shop / Shopee / Instagram / Facebook / expo / referral) · niche · contact person, channel and number/handle · notes · owner · next follow-up date. Stages: identified → contacted → replied → meeting → proposal → won/lost, with a coloured pipeline strip whose chips filter the list.
- **The follow-up date actually follows up.** Each cron pass bell-notifies the owner on the due date — _"📞 Follow up today: {brand} — Social tab"_ — once per date, late ones flagged; editing the date re-arms the reminder. Assigning a prospect to someone else notifies them immediately. A date nobody is reminded of is a wish, not a plan.
- Rows are the house pattern: brand opens the record (WhatsApp numbers become tap-to-chat `wa.me` links), stage select + Edit + Delete in the standard wrapping button group, ⏰ overdue chip, save toasts throughout, `fieldRow` form that stacks on a phone.
- **Permissions:** all staff read and add; stage changes, assignment and delete are the sales tier (exec + hr_admin + sales_marketing + marketing). PDPA nudge built into the contact field: _"business pages only"_.
- Skew-armored: before migration 0066 runs, every prospect route returns a clear 409 naming the migration, and the panel shows a calm one-liner instead of an error.

## [1.4.266] — 2026-08-07 — What Malaysia is searching, on the Dashboard

### Added (CEO: "add Famous search product in Malaysia which is related to my product and my service… Maybe I can use Threads for the search engine. What is your suggestion?")

- **🔎 Trending searches — Malaysia** card on the Dashboard, visible to every staff member. Source: **Google Trends Malaysia's official RSS** — the country's top ~20 trending searches, refreshed hourly by Google, with an approximate traffic figure and a related headline. Free, official, no key, no scraping.
- **Rows touching the business are pinned to the top** with a 🎯 amber highlight, matched against a keyword list living in the card (`tudung, hijab, shawl, raya, baju, kurung, tiktok, live, shopee, affiliate, viral…`) — easy to extend as the client roster grows. Everything else collapses behind "All trending searches", so a quiet day for the niche doesn't fill the Dashboard.
- Worker: NEW `GET /trends/my` + a 3-hour `system_meta` cache — a Dashboard full of staff must not hammer Google on every load, and a fetch failure serves the last good copy rather than nothing.

### The Threads answer, honestly

- **Threads was evaluated and rejected as the engine.** Its keyword-search API measures what people **post**, not what they **search** — chatter, not demand — and access requires Meta App Review for advanced permission, capped at 500 searches per rolling 7 days. Google Trends is literally the "famous search" data the request describes. Threads stays useful _manually_: once the card surfaces a trend, searching it on Threads/TikTok shows the conversation around it — that's a reading habit, not an integration.
- Worker + frontend, no migrations.

## [1.4.265] — 2026-08-07 — The system tells on itself

### Added (CEO: "Do both" — error alerting + the process-debt gaps)

- **Error-spike alerts.** Every 30-minute cron pass now checks whether `error_log` grew since the last pass and bell-notifies super_admin + CEO: _"⚠ 12 new system errors since the last check (tiktok_webhook ×9, migration_skew ×3) — see System health"_. A watermark stops repeats — only NEW errors alert, and the first pass sets the watermark silently instead of alerting on history. This is what would have surfaced the 44 webhook signature retries weeks earlier.
- **Public `/api/v1/health`** for an external uptime monitor — unauthenticated on purpose (a monitor can't sign in), leaks nothing: `{ok, db}` with one cheap DB probe, `503` when the database is unreachable so the monitor can tell "worker up, DB down" from "all up". The monitor itself must live OUTSIDE Cloudflare — a system cannot report its own outage; free UptimeRobot pointed at this URL closes the loop.
- **The database names its own missing migrations.** `/system/health` probes one marker column per recent migration and the System health card turns red with the exact list — _"⛔ 6 database migrations pending"_ — plus the command, verbatim. The v1.4.218 blank-staff-directory incident was precisely a deploy that outran its schema; memory is not a deploy tool, so the schema now reports on itself.

### Fixed

- **Editing a product invoice re-balances stock** — the v1.4.263 gap, closed. The old deduction is restored in full, then the new items deduct, so the shelf always reflects the invoice as it reads _now_. Restore-then-deduct rather than a diff, because a line can change SKU, not just quantity. The edit toast reports the movement the same way creation does.

### Still yours, not codeable

- Run the migrations (the red card will now nag until they're gone), rotate the TikTok App Secret, and set up the external monitor (two minutes on UptimeRobot's free tier: HTTPS monitor → `https://azoneofficial.com/api/v1/health` → keyword `"ok":true`).
- Worker + frontend, no new migrations.

## [1.4.264] — 2026-08-07 — Company events into the phone's own calendar

### Added (CEO: "How to ensure that event calendar being saved inside users mobile calendar?")

- **📅 Add to my calendar** on every event, in both the list and the calendar view, for **every staff member** — not just managers. One tap builds a standard RFC 5545 `.ics` in the browser (no server round-trip, same pattern as the PDFs) and hands it to the phone's share sheet; picking **Calendar** finishes it. iOS opens straight into Calendar, Android offers Google Calendar, a laptop downloads the file for Outlook / Apple Calendar.
- The entry carries **two alarms** — the evening before and at the start — because the point of the exercise is that nobody has to be looking at the portal to be reminded.
- Details that make it behave: times are written as **UTC instants from Malaysia time**, so the event lands at the right hour whatever timezone the phone is set to; an event with no start time becomes a true **all-day** entry (with the RFC's exclusive end date, which some apps otherwise render as zero-length); the **UID is stable** (`event-{id}@azoneofficial.com`), so tapping the button twice _updates_ the phone's copy instead of duplicating it; long descriptions fold per RFC 5545 §3.1 so strict parsers like Outlook accept them.
- NEW `lib/event-ics.ts` (`buildEventIcs`, `addEventToCalendar`).

### The honest limitation, stated

- This is **pull, not push**: each person taps once per event they care about. If an event is later **edited or cancelled in the portal, phones do not follow** — re-tapping the button updates their copy (same UID), but nothing happens automatically. Automatic sync is a subscribed calendar feed (`webcal://` + a token URL, like the document share link) — a separate release if wanted, and the natural companion to the PWA/Capacitor conversation.
- Frontend-only, no migrations.

## [1.4.263] — 2026-08-07 — A product invoice moves stock (MIGRATION 0065)

### Added (CEO: "if sales invoice created, inventory should be deducted to tally the inventory. of the payment has been paid. the amount of sales will be reflected to the Sales revenue")

- **A product INVOICE now deducts inventory the moment it is created** — typed directly or born from a Quotation → Invoice click. Lines match inventory by **SKU first, then exact name** (the product form's datalist inserts inventory names, so most lines match by themselves). Each deduction is logged in the Manual stock movements trail as `Invoice INV-… — stock deducted on invoice`, tied to the document (MIGRATION 0065 `manual_stockouts.doc_id`).
- **The toast tells you exactly what moved** — `stock deducted: ELFIA001 −4 (now 16)` — and says loudest what did **not**: `⚠ NOT in inventory, not deducted: …` for a line that matched nothing, and `⚠ short:` when an invoice asks for more than the shelf holds (stock floors at 0 and the shortfall is written into the trail remark rather than silently invented).
- **Deleting or reversing an unpaid invoice puts the stock back** and removes its own trail rows — ↩ Undo and Delete are now stock-safe.
- **Deliberate boundaries:** only the INV deducts — a quotation is a promise, and deducting a DO too would double-deduct the same sale. Service documents never touch stock. The trail rows carry **no sale price**, because the revenue is counted by the _paid invoice_ (below) — pricing the movement would count the sale twice.

### Already true, worth confirming

- **The second half of the request has worked since v1.4.90:** invoiced revenue counts on a **payment-received basis** — the moment an invoice is marked paid (or born paid), its amount lands in Sales revenue, the P&L and the 🔥 Today box, bucketed by the payment date you now pick (v1.4.250). Nothing needed changing there.
- Worker + frontend. **MIGRATION 0065** — without it stock still moves and the trail still writes; only the doc link falls back to the remark prefix.

## [1.4.262] — 2026-08-07 — One subject per memo

### Fixed (CEO: "subject and perkara is the same thing!")

- They were. Perkara _is_ a memo's subject — the form asked for the same thing twice, and a careless publish could carry two different subjects on one memo (or, as in practice, a filled Subject and an empty Perkara, so the printed memo header lost its Perkara line entirely).
- The **Perkara box is gone**. The Subject box is the single source — in memo mode it relabels to **Subject / Perkara**, and the memo header composes `Perkara: {subject}` from it automatically. Tarikh stays, since the date genuinely is a separate field.
- The memo grid drops from four boxes to three: Kepada · Daripada · Tarikh.
- Frontend-only, no migrations. Already-published memos are untouched — their headers were composed into the body at publish time.

## [1.4.261] — 2026-08-07 — The legal name, fixed at the source

### Fixed (CEO: "birthday still not extract full staff name list as others, make it standardize to all the tabs")

- v1.4.260 fixed the two screens I could see; the Birthdays tab proved the mistake in that approach — chasing the display one screen at a time. This release fixes it **at the source instead**, so "all the tabs" means all of them, including next month's.
- **Worker:** every route that returns a staff `name` for display now applies one SQL rule — `COALESCE(NULLIF(TRIM(full_name), ''), name)`. Eight queries: both birthday routes, the `/staff-list` picker feed (sales person, claim payee, roster, task assignment — every dropdown), the attendance monitor, the corrections list, the verification export, the sign-in log, and the HR report's per-staff task table. Any screen fed by these is correct without being touched.
- **Frontend:** NEW `displayName()` in `lib/names.ts` — the same rule as one named function — used by the Birthdays tab (whose `/users` payload always carried `full_name`; the panel's local type just never declared it, which is why the fallback was invisible), and by the register and payroll sites from v1.4.260, so the rule now has one spelling everywhere instead of an inline `||` per file.
- Worker + frontend, no migrations — `full_name` has existed since 0012.

## [1.4.260] — 2026-08-06 — The legal name where it matters, and a flag where it's missing

### Fixed (CEO: "staff name not populated full staff name")

- **The staff register and the payroll rows showed the short name** while every official output — payslip, claim form, leave form, ID badge, sales-document signature and the Maybank2E salary file — already prefers `full_name`. Reading a nickname on screen and a legal name on the slip is exactly how a name that doesn't match the bank account goes unnoticed until a transfer bounces. Both now show the legal name when it's on file.
- **NEW ⚠ "no full name" flag** on any staff record without one. This is the important half: the fallback is silent by design, so a payslip printing a nickname looks completely normal and nobody notices until it's a bank rejection or a signed form with the wrong name on it. The gap is now visible in the register.

### Worth checking on your side

- If a name still shows short after this, the field is simply empty in that person's record: **Staff Details → 👤 Personal → Full name (as per IC)**. The column has existed since migration 0012; nothing in the pipeline is dropping it.
- Frontend-only, no migrations.

## [1.4.259] — 2026-08-06 — Field rows stack on a phone (audited)

### Fixed (CEO: "Placement text should be the better width size for mobile view … Audit all the files and ensure that it is globally")

- **The postage form put three fields on one line at every width.** On a 390px screen that is ~110px each, so every placeholder was clipped mid-word — `e.g. J&T, Po:` — and the hint telling you what to type was the first thing lost, exactly when you need it most. Its item lines had the same fault, where the item **name** select is the widest thing on the row and the first to be squeezed.
- NEW `fieldRow` in `lib/ui-styles.ts` — two columns on a phone, a flowing row from `sm` up. This is the v1.4.154 width standard with a name, so the next form inherits it instead of re-deriving it. Any field needing full width on a phone gets `col-span-2 sm:col-span-1`; the postage form's Order amount does.

### The audit

- Swept every `.tsx` in `app/` and `components/` for rows holding two or more fields that never stack. **Four candidates, one real offender** — the postage form. The others were already correct: the expense inline editor is `w-full sm:w-auto`, the staff vault row is a select and a button, and the payroll commission helper uses fixed narrow widths that wrap.
- Also checked every placeholder over 30 characters: all of them sit in textareas or full-width inputs, where they have the room.
- Frontend-only, no migrations.

## [1.4.258] — 2026-08-06 — Wrapped rows line up, and the last links become buttons

### Fixed (CEO: "I still can see the improper layout. And also edit/remove not globally using the same as before aligned")

- **Send PDF was filled.** A quotation row carried **two** dark blocks — → Invoice and Send PDF — which breaks v1.4.253's own rule of at most one fill per row: with two, neither reads as the main action. Send PDF is now a normal bordered button. → Invoice stays the filled one on a quotation, because converting is what that row is _for_.
- **A wrapped action group no longer strands its last button.** `rowActions` was right-aligned always, so when the group wrapped onto its own line — which is the normal case on a phone — the final button sat alone against the right edge and the row read as two ragged fragments. It now aligns left on phones (under the text, sharing its gutter) and right from `sm` up, where it still sits opposite the text.
- **Expenses Edit and Remove** were still bare underlined words sitting beside a bordered **Mark paid** — the same row, two different kinds of control. Both are now the global buttons, and the expense action group wraps like every other row.
- Also converted: the two event-list Remove buttons and the attendance-correction Save. The one remaining hand-rolled filled row button (payroll Mark paid) now imports the shared string instead of repeating it.
- Frontend-only, no migrations.

## [1.4.257] — 2026-08-06 — The payslip as a real file (tier 5, in part)

### Added (CEO: "Tier 5")

- **Send PDF on the payslip**, in three places: the payroll processing row, the staff member's own payslip card, and the HR path that already fetched the detail. NEW `lib/payslip-pdf.ts`, drawn with the same writer as the sales documents and the HR forms.
- **The arithmetic is now shared, even though the layout isn't.** NEW `payslipData()` computes every figure once — v1.4.183's hourly rule, v1.4.79's unpaid-leave deduction, v1.4.82's incomplete-month adjustment — and both the printed slip and the PDF read from it. Payroll is the one place where two implementations drifting apart isn't cosmetic; it's two different answers to "what was I paid".
- Long labels now shrink to fit their column before they can run under the next column's figures, and truncate only if 5.5pt still won't do. A number is never crowded by a label.

### Fixed

- **`×` was silently vanishing from every PDF.** "6 HRS × 1.5" printed as "6 HRS 1.5" — which on a payslip reads as a different calculation. Anything the Latin-1 fold map misses is dropped by the ASCII filter, so a missing entry is invisible rather than obviously broken. Added `× ÷ ± ≤ ≥ ≈ ™ ©`.

### Not built, deliberately

- **The ID badge and the HR attendance summary stay print-only.** A badge is a card you print on stock, and the HR summary is an internal multi-page report nobody sends. Each would have bought a fourth and fifth hand-maintained layout for no real errand.
- **The Cloudflare Browser Rendering fork is not mine to take.** It costs a Workers Paid plan (~USD 5/month) and would collapse all three PDF writers back into one template each. Until then three files mirror three templates, and every document change has to be made twice.
- Frontend-only, no migrations.

## [1.4.256] — 2026-08-06 — The row pattern reaches /admin (tier 3)

### Changed (CEO: "Tier 3")

- **Enquiries** — the enquirer's name opens the record. Every enquiry used to print its whole message inline, so ten enquiries was a wall of text and the status control — the thing you came to change — sat somewhere in the middle of it. The panel now holds email, phone, company, received date and the message; the status picker stays on the row, because it _is_ the row.
- **Services / packages / anything on CrudPanel** — the title opens the record and the panel shows every field's value. Until now the only way to read a single field was to press Edit and load the whole record into the form, which risks saving something you only meant to look at.
- **Staff directory** — the staff member's name is now the toggle, and the separate "Details ▾" button is gone. That also frees a slot in the row v1.4.209 had to teach to wrap, because with a record open it held five buttons. Multiple records stay open at once here on purpose: HR compares people side by side, which is the one place the one-at-a-time rule doesn't serve the work.

### Deliberately not converted

- **/admin Users rows** — already minimal. Name, email, a suspended chip, and the controls. There is nothing hidden behind them worth revealing, and a panel would only add a click.
- **The admin staff directory** is an always-open editing grid, not a list of records to read. Collapsing it would hide the fields that are the entire point of the panel.
- Frontend-only, no migrations.

## [1.4.255] — 2026-08-06 — Every save says what happened (tier 2)

### Changed (CEO: "Tier 2")

- **22 save sites across eight files now use the branded toast.** Until this release, /admin and the account panels saved in silence — the same complaint raised about In + in v1.4.251, just in places visited less often. Wired one site at a time, not swept, because a toast attached to the wrong branch says "Saved" on a failure and that is worse than the silence it replaces.
- **/admin** — enquiry status, every CRUD panel (create · update · remove), media upload and delete, site content, user create, and the four things `patch()` drives: role change, suspend, reinstate, force sign-out. Suspend now says _"…suspended — signed out everywhere"_ rather than nothing at all.
- **Site editor** — each field names itself: _"Hero headline updated — live on the website now"_.
- **HR admin** — adding or removing a public holiday now says so, and adds why it matters: _"payroll working days recount from this"_.
- **Staff panel** — leave approve/reject. **System health** — backup complete with table and row counts. **2FA** — on, off, and setup failure. **Change password** — confirmation, since the form otherwise just empties itself.
- **Admin staff directory** — a failed save previously did **nothing at all**: no message, no toast, the edit just sat there looking saved-but-not. It now says so.

### Deliberately excluded

- **Sign-in and the public contact form.** A toast on sign-in is pointless — the page navigates away — and the contact form's inline thank-you is the right pattern for a visitor who has never seen this system before. Both keep their own inline states.
- Frontend-only, no migrations. Existing inline messages were kept alongside the toasts rather than ripped out, so nothing that worked before stops working.

## [1.4.254] — 2026-08-06 — Two shared modules: the look and the formatting

### Changed (CEO: "Proceed this improvement so that everything is globally")

- NEW **`lib/ui-styles.ts`** — `card`, `inputClass`, `btnClass`, `th`/`td`/`thR2`/`tdR2`. These strings had been copy-pasted into **eighteen files**, and `card` had already drifted into three different paddings: the portal's own page rendered cards at `p-3.5 md:p-4` while its panels used `p-4 md:p-5`, so two cards on the _same tab_ were different sizes. Everything is now the roomier value. That is what a duplicated constant does — it doesn't break, it drifts, and nobody notices until the set sits side by side.
- NEW **`lib/format.ts`** — `dmy`, `dmyMYT`, `mytToday`, `mytDateOf`, `rm`, `fmtRM`. `dmy` was defined identically in four files, and /admin and the staff panel each had their own copy under a different name (`dmyMyt`, `dmyD`). Identical today; one edit away from a portal showing `06-08-2026` in one card and `2026-08-06` in the next. The house rules — DD-MM-YYYY display, MYT everywhere, sen in / RM out — now live in the functions instead of in the habit of whoever writes the next card.
- Two deliberate variants kept and named: `inputClassLg` for the public marketing pages (bigger type and touch target for visitors arriving cold on a phone) and `btnClassBlock` for the full-width sign-in button.
- **Row buttons finished.** The last non-standard row actions — /admin (6), assets register, tab access, HR admin, staff vault Download — now use `rowBtn` / `rowBtnDanger`. No list in either app still uses a bare underlined word as a row action.
- Boundary written into `row-button.tsx` so a later sweep doesn't overreach: **a button if it acts on a RECORD, a link if it acts on the FORM you are filling in.** Cancel beside a Save, "+ Add line", and "Refresh" stay links on purpose.
- Frontend-only, no migrations, no behaviour change — every edit is a class string or an import.

## [1.4.253] — 2026-08-06 — One button style, portal-wide

### Changed (CEO: "Make the button standardize like my own button global … Claim also need to use global button but ensure that minimalist")

- NEW `components/ui/row-button.tsx` — `rowBtn`, `rowBtnDanger`, `rowBtnGood`, `rowBtnPrimary` and the `rowActions` wrapper. The Documents list settled on this shape months ago (28px tall, rounded, bordered, 12px text) but the audit and claim lists were still bare underlined links, so the same action looked like two different controls depending on the card. On a phone an underlined word has no tap target at all.
- Converted: manual stock movements (Edit · ↩ Revert · Delete), supplier returns (Credit · Replace · Edit · Delete), inventory items (Edit · Delete), claims (📎 Attach receipt · Delete · Edit, and View receipt · Print form · Send PDF inside the record), the HR approved-claims list, expenses (Mark paid · Undo paid), and leave (Print form · Send PDF · Cancel). The Documents row now imports the shared strings instead of repeating them.
- The claim row's second line was a run-on sentence — date, then underlined words joined by `·`. It is now the date plus a proper wrapping button group, which is what makes it work at both widths.
- Kept minimalist deliberately: no shadows, and a fill only on the one action a row is _for_. Five bordered buttons on a 390px screen is already dense; five filled ones would be unreadable.

### Fixed (CEO: "the text on area total should not wrapped text")

- Numeric table columns never wrap. The stock-out TOTAL row was breaking its 🔥 chip across two lines on a phone, which read as two separate numbers. `whitespace-nowrap` now sits on the shared `thR2`/`tdR2` classes, so every numeric column in every table inherits it, and on the chip itself.
- Frontend-only, no migrations.

## [1.4.252] — 2026-08-06 — The audit lists join the row pattern

### Fixed (CEO: "I want the details inside while the button outside for me to know what is this details for")

- **Manual stock movements** and **Supplier returns** were the two lists v1.4.249 didn't reach. Both packed the date, SKU, item name, quantity and the whole reason onto one `truncate`d line, so on a phone every row read `06-08…` and nothing else — the reason you record for traceability was the first thing the screen threw away.
- Both now follow the standard: **date · SKU** identifies the row and opens it; buttons stay outside.
  - **Movements** — the panel holds item, direction and quantity, date, whether it counted as a sale, who recorded it, when, the reason in full, and whether it was reverted.
  - **Returns** — item, quantity, unit cost, total claim, supplier, return date, replaced quantity, credited amount and the defect reason.
- The chips that carry the state of the row — Sold @ / correction / ↩ reverted, Outstanding / Credited / Replaced — stay visible, per the v1.4.249 rule that a chip which _is_ the point of the row doesn't hide.
- Frontend-only, no migrations.

## [1.4.251] — 2026-08-06 — Stock in confirms itself, and variances have a reason (MIGRATION 0064)

### Fixed (CEO: "In + seem doesnt popup notifications which is I should aware if the stock has been updated in")

- **In + saved in silence.** `adjust()` only raised a toast when the delta was negative, so an out announced itself and an in did not. Both directions now confirm, and both quote **the new stock level** the server came back with — so you see `now 26 in stock`, not just "saved".

### Added (CEO: "if I want to adjust the variance … Manual Out − and what should remark I need to indicate?")

- **In + now opens the same form as Out −**, with the same mandatory reason. An unexplained stock increase was the one movement in the system that left no trail — which is exactly the case a stock count creates when the shelf holds _more_ than the system says.
- **The reason is now a picked list, not a blank box**, so a variance is always worded the same way and can be reported on later. Out: stock count variance (missing) · damaged/defective · sample or giveaway · internal use · sold offline · data entry correction · other. In: stock count variance (found extra) · restock from supplier · customer return · returned from sample/event · data entry correction · other. A free-text note underneath carries the specifics.
- MIGRATION 0064 adds `manual_stockouts.direction`, defaulting to `'out'` — every existing row keeps exactly the meaning it had, so the stock-out totals and the weighted Avg sold @ are unchanged. The traceability card is now "Manual stock movements" and shows `+21` or `−2` per row.
- Skew armor (v1.4.218 lesson) with a deliberate asymmetry: without 0064 an **out** still logs the old way, but an **in** does not log at all and records `migration_skew` instead — an unmarked row would read as an out and corrupt the totals. The stock still moves either way.
- The remark is now required on **both** directions server-side, not just outs.
- Worker + frontend.

## [1.4.250] — 2026-08-06 — Pick the date the payment landed

### Added (CEO: "I want to have a calendar for me to pick which date they make the payment for accurate tracking")

- Marking an invoice paid now asks for **the date the money was received**, not just the reference. The dialog carries a real date input, so a phone raises its own calendar. It defaults to today and cannot be set past today — you can't receive tomorrow's money.
- The date is **correctable afterwards** without unmarking the invoice: **✎ change date** sits in the payment row of the document's detail panel. Unmarking would have cleared the reference along with the date, which is why it needed its own control.
- `usePrompt()` gained an optional second field (`date: { label, initial, max }`) and now resolves to `{ value, date }`, so any future dialog needing a date gets it from the same component rather than a new one.

### Why it matters

- Revenue buckets invoices by `paid_at`. A Friday transfer entered on Monday used to count on Monday — and at a month boundary, in the wrong month. That fed the P&L, the 🔥 Today box and the commission helper.
- The chosen date is stored at **04:00 UTC — midday Malaysia**, so the `+8 hours` shift every revenue query applies can never move it onto the neighbouring day.
- An explicit date **overrides** an earlier one; without one the old COALESCE-to-now behaviour stands, so every existing invoice is untouched.
- Worker + frontend, no migrations.

## [1.4.249] — 2026-08-06 — The minimalist row, portal-wide

### Changed (CEO: "do the same pattern to the rest which is my objective is globally and standardize")

- NEW `components/ui/record-row.tsx` — `RecordToggle` and `DetailGrid`, the pattern as one shared pair so every list opens the same way and looks the same doing it. **Identity on the row · actions on the row · everything else one tap away.**
- **Documents** — refactored onto the shared pair (it was hand-rolled in v1.4.248).
- **Customers** — the company name opens contact, phone, email, billing address and delivery address. Those were in the database and invisible in this list.
- **Leave** — rows now lead with the **leave number**, the same one printed on AZOO-HR-LVE-001 and on the shared PDF, so a row, a printout and a file all name the record identically. Type, period, reason and the reviewer's note moved into the panel.
- **Claims** — the **claim number** is now the thing you click, replacing the "Details ▾" text link. The number was not even shown on the row before. The payee mark stays visible without opening the record.
- **Expenses** — the amount opens date, category, vendor, who recorded it and the recurring detail. The PAID / DUE chip stays on the row, because the paid state is the thing being tracked (v1.4.208).

### Deliberately not converted

- **Inventory, Payroll, Attendance and the Assets register are tables.** They are dense on purpose and are read by scanning and sorting columns; collapsing their rows would remove the thing that makes them useful. The rule is written into `record-row.tsx` so it survives the next sweep.
- Frontend-only, no migrations.

## [1.4.248] — 2026-08-06 — Branded prompt, and minimalist document rows

### Fixed (CEO: "still found with not standardize popup notification")

- The v1.4.240 sweep replaced every `window.confirm` but missed the one `window.prompt` — the bank transfer reference asked for when marking an invoice paid. NEW `components/ui/prompt-dialog.tsx` (`usePrompt()`), same family as the confirm dialog and the save toast: gold accent, navy card, Enter submits, Escape cancels, Cancel now leaves the status untouched rather than marking paid with no reference. No native browser panel remains anywhere in the portal.

### Changed (CEO: "a minimalist version … click at the document number can appear the details. the button remain at outside")

- A Documents row now carries only what identifies the document — number, product/service mark, customer, amount — plus its action buttons. The PAID chip, the payment and delivery pickers, the date, the sales person, the payment reference and the converted-from origin moved into a panel that opens when you click the document number.
- One document opens at a time; opening another closes the first, so the list can never grow taller than the screen.
- Actions stay on the row on purpose. Nothing has to be opened before it can be done — the panel is for reading, the row is for acting.

## [1.4.247] — 2026-08-06 — Row buttons wrap instead of running off the phone

### Fixed (CEO: "Why Invoice dont have send pdf button?")

- It did have one — it was off the right edge of the screen. The Documents row's action group carried `shrink-0` and no wrap, so it laid its buttons out in a single line whatever the screen width. A quotation row shows five controls and just fits a phone; an invoice row shows seven (the PAID chip and the payment-status select as well), and the last two — **Send PDF** and **Delete** — were pushed past the edge and clipped by the list's own scroll container.
- Every row action group in `/portal` now wraps and right-aligns instead: twelve of them across the Sales, Leave, Claims, Attendance, Inventory and Users lists. On a phone the buttons drop onto a second line; on desktop nothing moves because there was always room.
- This is the v1.4.209 lesson again, one layer out: that release fixed a non-wrapping action span in the staff directory. The rule now holds portal-wide — **a row's action group wraps; it never relies on the screen being wide enough.**
- Frontend-only, no migrations.

## [1.4.246] — 2026-08-06 — Send PDF on the claim and leave forms

### Added (CEO: "do same implementation for invoice and delivery order, claim and leave form also!")

- **Invoice and Delivery Order already had it** — v1.4.245's Send PDF sits on every Documents row and builds whichever type the row is. Nothing to add there.
- **Claim form** — Send PDF beside Print claim form. AZOO-HR-CLM-001 as a real file: the meta block, the claim detail table (padded to four rows like the printed form), total, declaration, system status with the approval chain, the three-column wet-ink signature table, and the uploaded receipt printed on the form.
- **Leave form** — Send PDF beside Print form. AZOO-HR-LVE-001 as a real file, with the same signature table and the HR / pre-approval chain line.
- NEW `lib/form-pdf.ts` for both forms, reusing the v1.4.245 PDF writer, fonts, colours and image embedding.
- The PDF writer now takes **any number of images**, so a form can carry three officers' signatures plus a receipt. **JPEG receipts** embed natively via `/DCTDecode` (the bytes pass through untouched, only the dimensions are read out of the SOF marker); PNG receipts go through the existing decoder. Both are fitted inside their frame without stretching — a receipt photo is any shape.
- `sharePdfFile()` is now shared by all five documents: share the file if the phone can, otherwise download it.

### Known trade-off, restated

- `lib/form-pdf.ts` is a second implementation of the two HR forms, exactly as `lib/doc-pdf.ts` is for the sales documents. The HTML versions in `role-panels.tsx` and `app/portal/page.tsx` still drive screen and print. **A change to a form must be made in both places.**

## [1.4.245] — 2026-08-06 — Send PDF: a real file into the share sheet

### Added (CEO: "maybe we open the pdf then I can share to customer as a pdf instead of a link via mobile apps view")

- **Send PDF** now builds a genuine PDF in the browser and hands the _file_ to the phone's share sheet, so the customer receives a proper attachment in WhatsApp rather than a link. Three rungs, best first: share the file (iOS 15+ / Android Chrome) → download the file (desktop, older phones) → share the v1.4.244 link if the PDF could not be built at all.
- NEW `lib/doc-pdf.ts` — a dependency-free PDF writer, a few KB rather than the ~400KB a PDF library would add to a 4G page load, and nothing new to install in the deploy loop. Real vector text (selectable, searchable), the branded navy and gold, and the officer's signature PNG embedded with its transparency intact and deflate-compressed, so a 1MB chop travels as ~50KB.
- Text is folded to Latin-1 on the way in (— · ✔ and friends become ASCII equivalents) so a document can never print gibberish.

### Known trade-off

- This is a **second implementation of the document layout**. `lib/doc-template.ts` still drives the screen and print versions; `lib/doc-pdf.ts` draws the same design in PDF primitives. A change to one must be made in the other. That is the price of a shareable file without a paid rendering service — if we move to Cloudflare Browser Rendering later, this file goes and the HTML template becomes the only source again.

### Fixed

- PDF object numbers are fixed rather than positional. An earlier draft appended the signature image before the fonts, so a document _without_ a signature shifted `/F1` and `/F2` onto the wrong objects and printed bold and regular swapped. Caught by rendering an unsigned invoice.
- The closing block reserved too little height, so the third signer line collided with the page footer. Widened.

## [1.4.244] — 2026-08-06 — Send a document to the customer from your phone (MIGRATION 0063)

### Added (CEO: "on mobile view, if I click on PDF button I want the format can be deliver to my customer using mobile instead of I need to download using web view")

- **Send button** on every document row, beside PDF. It mints a share link and hands it straight to the phone's own share sheet — WhatsApp, Telegram, email, whichever they use. Two taps, no download, no file manager. Desktop has no share sheet, so the link goes to the clipboard with a toast instead.
- **The customer's page** (`/doc?t=…`) needs no sign-in and no app: the document renders on their phone exactly as it prints, scaled to fit the screen rather than pinch-zoomed, with a **Save as PDF** button that prints the real A4 document rather than a screenshot of the page. Invalid or revoked links get a plain message and the WhatsApp number, not an error.
- MIGRATION 0063 adds `sales_documents.share_token` with a unique index. The token is 32 random hex characters, minted on first Send and reused after that, so re-sending never changes the customer's link. `POST /docs/:id/share {revoke:true}` clears it and the link dies immediately. Both actions audited (`doc.share`, `doc.share_revoke`).
- The public read route is deliberately outside `/staff` and unauthenticated — the token is the only credential. It returns one document, exposes no internal ids, sends `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`, and `/doc` is disallowed in robots.txt so a customer's prices never reach a search engine.

### Changed

- The printed document moved out of `page.tsx` into **`lib/doc-template.ts`**, so the portal's PDF popup and the customer's link render from one template and can never drift apart. `buildDocHtml(doc, autoPrint)` — the popup raises the print dialog on open, the customer's page does not.
- Frontend + worker. Migration-skew armored (v1.4.218 lesson): on a database without 0062/0063 the share link simply does not resolve rather than throwing a 500 at a customer.

## [1.4.243] — 2026-08-06 — Malaysian-standard sales documents (MIGRATION 0062)

### Added (CEO: "can we make it like this? include invoice and delivery order based on both service and product requirement")

- **Quotation, Invoice and Delivery Order rebuilt on one template**, in the shape approved from the samples: gold rule → letterhead → borderless meta strip (Sales person · Doc no. · Date · Valid until/Payment due/Delivery · Reference · Page) → BILLING | DELIVERY-or-SERVICE address → line items → amount in words + totals ladder → closing block.
- **Line items** now carry a unit of measure, a SKU, their own discount, and up to ten detail sub-lines — the inclusions that used to be typed as extra RM 0.00 rows now print as bullets under the item they belong to.
- **Amount in words** in the Malaysian convention ("RINGGIT MALAYSIA : … ONLY"), sen included.
- **Their reference / PO no.** prints in the meta strip, "N/A" when blank. **Delivery address** prints beside the billing block, collapsing to "Same as billing address" when it matches or is empty; product documents only, since a service delivers nothing physical.
- MIGRATION 0062 adds `sales_documents.reference`, `sales_documents.delivery_address` and `customers.delivery_address`. All nullable; every existing document still parses and prints.

### Fixed

- **The signature area now reserves a fixed-height zone in every block**, signed or blank. The officer's signature PNG drops into reserved space instead of growing its own column, so "Prepared by" and "Accepted & confirmed by" sit on one baseline whether or not an auto signature is present. The counterparty block carries the same three lines, muted, so the two columns line up exactly.
- No tax line anywhere: AZ ONE OFFICIAL is not SST-registered, and charging service tax before registration is an offence. The document states the position in words instead. When registration happens the ladder gains an SST row and the letterhead an SST number; nothing else moves.
- The create-document form's state type never declared `kind`, which v1.4.234 had been setting — a type error on every build. Declared.
- Writes are armored for migration skew both ways (v1.4.218 lesson): on a database without 0062 the document still saves, minus reference and ship-to, and logs `migration_skew`.

## [1.4.242] — 2026-08-06 — Print audit across every generated document

### Checked (CEO: "all this being implemented to all the generate PDF? include, Delivery Order, Invoice, Claim, Leave Form")

- The v1.4.239 print-pipeline fix (no browser header strip, branded fills print) was applied to every template from the start: quotation, delivery order, invoice, statement of account, claim form, leave form, both payslips and the ID badges.
- The v1.4.241 width fix is quotation-only by measurement, not by oversight. Only the quotation's bottom row asks for three blocks (752px). The invoice needs 536px and the delivery order 416px, both inside A4's 688px. The claim form and leave form build their signature panels as real HTML tables with fixed column percentages, so they cannot wrap at any width.

### Fixed

- The HR "Attendance & Payroll Summary" is a staff table that can run to several pages, so v1.4.239's `@page { margin: 0 }` would have printed page 2 onward edge to edge. Reverted to a real 18mm page margin; it keeps `print-color-adjust` and accepts that the browser's header strip may still appear. Same reasoning already applied to the A4 badge sheet.
- Rule now documented in both files: margin-zero only for templates that are single-page by design; multi-page output keeps a real page margin.
- Frontend-only, no migrations.

## [1.4.241] — 2026-08-06 — Quotation signature row no longer wraps on A4

### Fixed (CEO: saved PDF vs the popup — "what is the different that cause this format incorrect")

- Nothing in the CSS differed between the two; the available width did. The popup window is around 1240px wide, while A4's printable width is 182mm — roughly 688px. The quotation's bottom row asks for TERMS (max 320px) + Prepared by (min 200px) + Accepted by (min 200px) plus two 16px gaps = 752px, so on paper `.split2` wrapped: the two signature blocks stacked vertically and TERMS dropped to the bottom-left corner. On screen there was room, so it looked right.
- The quotation row now carries a `qt` modifier sized to fit 688px — TERMS capped at 250px, signature blocks at 168px minimum, 12px gaps (610px total, comfortably inside A4). Invoice (536px) and delivery order (416px) rows already fitted and are untouched.
- Narrow viewports still wrap, which is correct on a phone.
- Frontend-only, no migrations.

## [1.4.240] — 2026-08-06 — Every confirmation is the branded dialog (and a build-breaking import)

### Fixed (CEO: "why the popup card was not standardize like the current use")

- The Sales tab still raised the browser's own "azoneofficial.com says" box for Delete document, Undo (reverse invoice) and Delete customer. All three now use the branded `useConfirm()` dialog introduced in v1.4.142 — navy card, gold accent, red confirm button on destructive actions.
- Swept the rest of the tree for the same slip: the payslip early-release warning (Payroll) and Suspend user (/admin Users) were also still native. Both converted. `window.confirm` now appears nowhere in the codebase outside the dialog component's own documentation.

### Fixed — latent build break

- `app/portal/page.tsx` called `useConfirm()` in the OT approvals card (v1.4.191) but never imported it, so `pnpm build` fails type-checking with "Cannot find name 'useConfirm'". Import added. Any frontend build attempted since v1.4.191 would have stopped here — which is consistent with v1.4.236's signature alignment not showing on printed quotations.
- Frontend-only, no migrations.

## [1.4.239] — 2026-08-06 — Printed PDFs: browser headers gone, branding restored

### Fixed (CEO: "when I save from the popup print, this is the results! it is not correct actually")

- The saved PDF carried the browser's own furniture — date and time top-left, the document number top-right, `about:blank` bottom-left, `1/1` bottom-right — and the branding was gone: the navy table header, the navy TOTAL bar, the gold bar and the shaded BILL TO panel all printed as plain white. Neither was the template's fault; both were the print pipeline.
- **Browser headers.** Chrome and Edge only draw their header/footer strip when the page has a margin, so every A4 template moved its margin off `@page` and onto the body inside `@media print` (quotation/DO/invoice and SOA 14mm, leave form and claim form 9mm, both payslips 14/18mm). Same white space on the paper, no browser furniture.
- **Lost branding.** Chrome's _Background graphics_ checkbox is off by default and it suppresses every background fill. All print templates now set `print-color-adjust: exact`, so the navy/gold prints whether or not that box is ticked — the ID badges and badge sheet included.
- Caveat: the A4 badge sheet keeps its 8mm `@page` margin on purpose (it can run to several pages and the cards must stay clear of the printer's non-printable edge), so browser headers may still appear there.
- Frontend-only, no migrations.

## [1.4.238] — 2026-08-06 — Service documents carry no Delivery / postage (CEO's conflict check)

### Fixed (CEO: "for Service, there is no Delivery / postage right? do check on both function to avoid any conflict")

- Correct — and both functions had the gap. Create: the delivery fee is now forced to 0 on service documents before the total computes. Edit: the route reads the document's stored kind and applies the same rule, so a service document can't gain delivery through an edit either (with migration-skew armor: on a pre-0061 database the kind lookup falls back gracefully and editing keeps working).
- Form: the Delivery / postage box hides in Service mode and any typed value zeroes on the switch, so nothing stale is submitted. The printed document's Delivery row only appears when the amount is non-zero, so service documents never show it. Worker + frontend, no migrations.

## [1.4.237] — 2026-08-06 — Documents: Delete with confirmation; aging follows

### Added (CEO: "once I delete then Outstanding invoices — aging will disappear following to the invoice that deleted… popup notification… before it is deleted")

- New DELETE /docs/:id (finance roles) + red **Delete** on every document row. A confirmation popup names the document and — for invoices — states it will disappear from Outstanding invoices — aging too (the aging card reads the same list, so it updates the moment the list reloads).
- ONE guard: a **PAID invoice cannot be deleted** — it's an accounting record; the message says to unmark the payment first if it's truly a mistake. Unpaid invoices, quotations and DOs delete freely. Every delete is audited with the document number and type. Worker + frontend, no migrations.

## [1.4.236] — 2026-08-06 — Printed documents: "Accepted by" aligned level with "Prepared by"

### Fixed (CEO screenshot: "accepted by was not aligned side by side to prepared by")

- The signature image made the Prepared-by block much taller, and the signature row wasn't bottom-aligned — so "Accepted by" floated to the top of its column. The QT signature row (.split2) is now bottom-aligned like the DO's, and both partner blocks ("Accepted by", DO's "Received in good order") carry the same three-line depth under the rule as the signer block — the signature lines land on the same baseline. Labels also standardised to the small-caps .lbl style. Frontend-only (`pnpm build`).

## [1.4.235] — 2026-08-06 — Customers: address on file + edit / update / delete

### Added (CEO: "I want to have address of customer and also the existing data I can edit and update or delete if require")

- Add customer gains an **Address** box (multi-line) — it stores to the existing customers.address column and prints on that customer's documents/SOA as before.
- Every customer row now has **✎ Edit** (loads the record into the form — title becomes "Editing {company}" with cancel, button becomes Update customer; emptying a box clears the stored value) and **Delete** (confirm first). PUT now supports clearing fields ("" → NULL; company itself can never be emptied) and both update + delete are audited.
- Deletion is REFUSED while the customer has any quotation/invoice/DO — records must keep their party; the message states the document count and suggests editing instead. Worker + frontend, no migrations.

## [1.4.234] — 2026-08-06 — Every sales document is for ONE business line: Product or Service (MIGRATION 0061)

### Added (CEO: "2 services which is 1 for product and 1 for service … details just filled by one details")

- Create document gains a required "This document is for" toggle: 📦 Product — ELFIA goods / 🛠 Service — agency work. One line per document, chosen up front.
- The choice steers everything: the item placeholder (Tudung Bawal Premium vs TikTok LIVE hosting — 8 sessions), inventory item suggestions (products only — service lines are free text), and **Delivery Order availability — product-only**, since a service ships nothing physical (hidden in the form, refused by the server, and picking Service while DO is selected flips the type to Quotation).
- Migration 0061: sales_documents.kind; stored on create, inherited by Quotation → Invoice conversion. The printed document states it ("For: Products / Services") and a service document's items table is headed "Description of services". Both document lists show a 📦/🛠 chip. Existing documents (kind NULL) print exactly as before. Worker + frontend.

## [1.4.233] — 2026-08-06 — Quotation signatures follow the preparer; accidental → Invoice gets an ↩ Undo (MIGRATION 0060)

### Changed — signer rule (CEO: "if prepared by CCO, then signature is CCO… other roles… the signature of prepared by need to fill by them")

- GET /docs/:id signer logic: prepared by CEO/COO/CCO → that officer's own uploaded signature + name + position (CCO was previously mis-signed as CEO). Prepared by any other role → the "Prepared by" block shows the PREPARER's own name and position over a BLANK line with "sign & date above" — they sign in ink; no officer's signature is borrowed. Invoices are the exception by design: "Authorised signature" is an authorisation act, so a non-officer's invoice still carries the CEO's signature. Old-worker split deploys print exactly as before (undefined vs null distinction in printDoc).

### Added — ↩ Undo conversion

- Migration 0060: sales_documents.converted_from — an invoice created via → Invoice remembers its source quotation.
- POST /docs/:id/unconvert (finance roles): allowed ONLY while the invoice is doc_type INV + carries converted_from + still 'unpaid' — a PAID invoice can never be reversed. Deletes the accidental invoice (audited doc.unconvert with the number and source QT); the quotation was never modified by conversion so it simply stands.
- Documents list: eligible invoices show an amber "↩ Undo" with a confirm; quotation rows unchanged. Worker + frontend.

## [1.4.232] — 2026-08-05 — Remembered tab hardened per user (CEO's security question)

### Fixed (CEO: "does it will accidentally appear the full tabs roles by accidents?")

- Straight answers first: the tab strip is computed per signed-in role + 🔐 overrides on every render, and every route re-checks permissions server-side — no role can see another role's tab list, and no data can leak regardless of what the browser shows.
- But the question exposed a shared-device edge in v1.4.231: the remembered tab was stored per DEVICE, so a lower-role account signing in after the CEO could restore a restricted tab for one render frame (server 403s everything, yet even a panel skeleton must not flash). Two fixes: the storage key is now per USER (`azone-tab:{id}` — accounts never inherit each other's last tab), and all 18 panel renders clamp through `activeTab`, which can never name a tab outside the account's visible list — effects run after a render, so the clamp lives in the render itself. Zero frames of an out-of-scope panel, ever. Frontend-only (`pnpm build`).

## [1.4.231] — 2026-08-05 — The portal remembers your last tab across refreshes

### Fixed (CEO: "when I refresh the tabs back to Dashboard instead of last tab that I open. is it due to what reason?")

- Reason: the active tab lived only in React state with "Dashboard" as the default — a refresh rebuilds the page, so it always started over. The last tab now persists per device (localStorage `azone-tab`), restores on load, and a guard falls back to Dashboard if the remembered tab isn't visible to the signed-in account (role change or a 🔐 tab-access change), so nobody lands on a tab they can no longer see. Private-browsing storage failures are swallowed harmlessly. Frontend-only (`pnpm build`).

## [1.4.230] — 2026-08-05 — Donut rendering artifacts fixed

### Fixed (CEO screenshot: "why it is looks like this???!")

- The black vertical line through the donut was the browser's default focus RECTANGLE around the clicked slice's bounding box — killed with outline:none; selection is already communicated by the slice growing and the centre readout (aria-pressed added for accessibility).
- The smeared joins were round linecaps extending strokeWidth/2 past each slice's angles and overlapping neighbours — now butt caps, with the gap angle providing the clean separation.
- Inactive-slice dimming softened 0.3 → 0.45 so colours stay recognisable while the selected slice still stands out. Frontend-only (`pnpm build`).

## [1.4.229] — 2026-08-05 — ⬇ Inventory stock-count CSV

### Added (CEO: "csv button to download the inventory list for me to perform Stock Count")

- "⬇ CSV — stock count" button in the Inventory live-status header: downloads azoo-stock-count-{date}.csv with the list in its on-screen sort — SKU, Item, Price/unit, Live rebate, Net, System stock, Status — plus the three columns a physical count needs, left blank to fill in: **Counted qty, Variance, Note**. Header rows carry the generation timestamp (MYT) so the sheet records when the system snapshot was taken; TOTAL units row at the bottom; UTF-8 BOM so Excel opens it cleanly. Client-side, no server change. Frontend-only (`pnpm build`).

## [1.4.228] — 2026-08-05 — The expenses donut becomes interactive and mobile-first

### Changed (CEO: "more beautiful, professional and graphic; click the pie to get details; suitable with the Mobile Apps view")

- Donut redesigned: gap-separated rounded slices, centre readout (Total RM — or the selected category and its subtotal), the active slice grows while the rest dim, 150ms transitions. Still pure SVG.
- Clickable everywhere: slices are real buttons (keyboard-accessible) and legend rows are tappable min-height rows; selecting a category opens its records under the chart — amount, vendor/description, date, PAID/outstanding chip — with a count + subtotal header. Click again to close.
- Mobile: layout stacks (donut centred above a full-width legend) and switches to side-by-side on larger screens; donut sized h-40→h-44. Frontend-only (`pnpm build`).

## [1.4.227] — 2026-08-05 — 📊 Expenses category pie + Marketing category surfaced

### Added (CEO: "pie chart for the expenses category… include the marketing expenses")

- "📊 Expenses by category — {month}" donut above the expense list: pure-SVG ring (no chart library, by design), slices sorted largest-first with a colour legend showing RM + % per category, following the month picker. Expense records only — payroll and claims keep their own lines above so the categories aren't drowned. Renders only when the month has expenses.
- Marketing: already existed end-to-end (frontend EXPENSE_CATEGORIES + worker catsE both include "marketing" since v1.4.87) — the dropdown lists it between Software and Equipment; it now gets its own pie slice (pink) like every category. Use it for platform ads, marketing materials, any marketing spend. Frontend-only (`pnpm build`).

## [1.4.226] — 2026-08-05 — 💰 Commission helper (1.5% of the month's sales)

### Added (CEO: "add commission which is 1.5% for me to pay the commission")

- New GET /staff/payroll/commission-base?month= (PAYROLL_PROC): the month's all-channel sales as a commission base — queries mirror /revenue verbatim (TikTok TT- excl. returned, paid INV documents by payment-landed month, other shipments, manual sales by out_date). Returns total + breakdown.
- Payroll tab gains "💰 Commission helper — {month} sales RM X × rate": rate box (default 1.5%), staff picker, live "= RM Y", and **Fill commission box** which writes the amount into that person's COMMISSION draft — CEO reviews the row, then Save all recomputes net and the payslip shows a COMMISSION line as usual. Helper hides itself on an old worker. Worker + frontend.

## [1.4.225] — 2026-08-05 — Category label "memo" (was "memo dalaman")

### Changed (CEO)

- The category option now reads plain "memo", matching the other lowercase categories. Behaviour unchanged — picking it still switches the boxes to Kepada/Daripada + Tarikh/Perkara. Frontend-only.

## [1.4.224] — 2026-08-05 — Publish news order: Category → Subject → To → From → Body

### Changed (CEO: "resort - Category, Subject, To: all the staffs, from: Management and Body")

- Form order now Category first, then Subject, then To | From, then Body. Defaults per his wording: To = "All the staffs", From = "Management" (memo dalaman still relabels to Kepada/Daripada with Tarikh + Perkara). Frontend-only.

## [1.4.223] — 2026-08-05 — Publish news: Subject / To / From / Body on every post

### Changed (CEO: "placement textbox I want: Subject, To: From: and Body")

- The form is now Subject (was Title) → Category → To ("Semua Pekerja @all") | From ("Pengurusan") → Body — the To/From placement boxes appear on EVERY post, not only memos. On publish they compose into the body as "To: … / From: …" lines, rendered with bold labels by the v1.4.215 MemoBody; blank boxes are skipped.
- Memo dalaman keeps its extras: To/From relabel to Kepada (To) / Daripada (From) and Tarikh + Perkara appear alongside. Frontend-only (`pnpm build`).

## [1.4.222] — 2026-08-05 — Fulfilment chips drill into the orders behind them

### Added (CEO: "clickable card which will appear the data of the fulfillment")

- Every Fulfilment status chip is now a button — click Shipped 4 and a table opens under the chips with those orders: ref, date/time (MYT), courier · tracking, buyer city, amount; sticky-header scroll at 200-row cap; click again (or another chip) to switch/close. Empty statuses say so.
- GET /staff/fulfilment/summary gains additive `?status=` returning `orders` for that status this month, newest first — existing consumers unaffected. Worker + frontend.

## [1.4.221] — 2026-08-05 — New panels join the standard save popup

### Fixed (CEO: "there is no save popup notification" on Tab access control)

- Tab access control and the Assets panel confirmed saves with a quiet inline line only — every other Save in the portal pops the v1.4.87 animated toast. Both now use the same useSaveToast: "Access saved — takes effect on each person's next refresh" / "Back to default" on tab access; "Asset added" / "Asset updated" (and a notice-variant popup on failure with the server's message) on assets. Inline detail lines kept as secondary. Frontend-only (`pnpm build`).

## [1.4.220] — 2026-08-05 — Webhook failures get a definitive test instead of guesswork

### Added (failures continued AFTER the secret update — 44 at ~30-min spacing = TikTok RETRYING the same undelivered event until it gets a 200)

- The webhook receipt now stores the actual signature value (derived, public in transit — previously only "present"/"absent" was kept, making any replay impossible).
- New GET /integrations/tiktok/webhook-debug (ceo/coo/admin/super_admin): replays the newest FAILED event's stored body + signature against the secret the worker holds RIGHT NOW (scheme A or B; B skips the 5-minute freshness check — the HMAC is the question, not the age) and returns a verdict.
- Connection card, when the last event failed, gains "🔍 Test the current secret against the last failed event" with four honest outcomes: ✅ current secret verifies it (update worked; the next TikTok retry passes and the card greens itself) · ❌ still mismatched (wrong copied value — re-view in Partner Center; or, if a relay header is present, it's Make/Zapier and TIKTOK_WEBHOOK_SECRET is the secret to set) · signature absent entirely (relay or foreign poster) · legacy event predating the diagnostic (test again after the next ~30-min retry). Worker + frontend.

## [1.4.219] — 2026-08-05 — 🔐 CEO tab access control

### Added (CEO: "users access control for CEO to assigned to the roles … which users need to access the tabs")

- New 🔐 Tab access control card on the Users tab (CEO + super_admin): per tab, click role chips on/off and Save, or Reset to default. Shows each tab's effective access at a glance ("custom" vs "default" badge). Changes apply on each person's next page refresh.
- Storage: one system_meta row (`tab_access`) of { tab: roles[] } overrides — GET /staff/tabs/access (any staff; the tab strip needs it) + POST (CEO/super_admin only, tab + roles validated, audited tabs.access_change). No migration.
- The portal tab strip consults overrides first, then the built-in defaults. Safety rails: Dashboard + Profile are not configurable and always visible (clock-in and payslips can never disappear); super_admin ignores overrides entirely — the escape hatch if an assignment locks even the CEO out; a fetch failure (old worker) falls back to defaults so a split deploy can never blank the tab strip. Worker + frontend.

## [1.4.218] — 2026-08-05 — Staff directory can never blank again on migration skew

### Fixed (CEO: "all staff details was gone! it is supposed to have their data" — NO DATA WAS LOST)

- Root cause: the v1.4.213 worker deployed BEFORE migrations 0058/0059 were applied, so GET /users selected columns that don't exist yet ("no such column: address") — the whole query failed and the directory rendered empty. The data was untouched the entire time.
- Migration-skew armor: GET /users (and the PATCH lock-policy SELECT) now catch "no such column" and fall back to the pre-0059 column list, logging error tag `migration_skew` with the exact fix. The directory always renders; the seven profile fields simply appear once migrations run.
- The directory itself now says WHY it's empty on a failed load (amber line: data is safe, worker/database out of step, run migrations + deploy) instead of silently showing nothing.
- THE ACTUAL FIX on your side: `cd worker && npx wrangler d1 migrations apply azoneofficial --remote` then `wrangler deploy`. Worker + frontend.

## [1.4.217] — 2026-08-05 — Ecommerce order per CEO; connection card learns "fixed, waiting for next event"

### Changed

- Ecommerce tab order (CEO): TikTok Orders → Live GMV → Sales by hour → Fulfilment → 🔌 TikTok connection last.
- CEO reported the ⚠ signature warning "still got this error even after insert the API" — the card was reporting HISTORY: the 7-day counter and the last event's verdict stay red until TikTok sends the NEXT webhook, regardless of the fixed secret. Status route gains two additive keys (last_verified_at, last_failed_at) and the card now has three honest states: newest event verified with old failures still in the window → green "✅ Secret fixed — failures age out"; newest event failed → amber explains it stays until the next event arrives and how to trigger one (small test order); no failures → nothing. Worker + frontend.

## [1.4.216] — 2026-08-05 — Sales revenue moves above Upcoming events

### Changed (CEO)

- Dashboard order: Quick actions → Pending leave | My open tasks | News → **Sales revenue** → Upcoming events. One-mount swap; frontend-only.

## [1.4.215] — 2026-08-05 — News gains a proper "memo dalaman" format

### Added (CEO pasted his real internal memo: "I want the placement text box is like this")

- New category **memo dalaman** on Publish news. Picking it reveals the formal memo header boxes — Kepada (pre-filled "Semua Pekerja @all"), Daripada ("Pengurusan"), Tarikh (today in Malay, e.g. "5 Ogos 2026"), Perkara — so a standard memo needs only Perkara + the content. On publish the headers compose into the body ("Kepada: …" lines); no schema change, worker just allows the new category.
- New MemoBody renderer for the feed: "Label: value" lines render with a bold label (Kepada, Tarikh, Masa, Lokasi Office — any short label), consecutive "* " lines become a real bullet list, blank lines space paragraphs. His pasted memo renders exactly as written. Plain announcements contain no label/bullet lines and render as before. Verified the parse rules against his actual memo lines. Worker (one word) + frontend.

## [1.4.214] — 2026-08-05 — Dashboard slimmed; new Ecommerce tab gathers every TikTok card

### Changed (CEO: "Resort and make it like this … Create new Ecommerce tabs and move all the below card into it")

- Dashboard order is now exactly: **Quick actions → Pending leave | My open tasks | News → Upcoming events**, with Sales revenue (all channels — the CEO's daily number, not TikTok-specific, so it was not on the move list) below.
- New **Ecommerce** tab (between Inventory and Assets, visible to all staff): 🔌 TikTok connection → TikTok Orders → Live GMV → 🕐 Sales by hour → 📮 Fulfilment. The revenue-gated cards keep their role gate inside the tab.
- TikTokOrdersCard exported from role-panels and MOVED out of the Inventory tab (tombstone comment left); Sync now lives on Ecommerce, Inventory keeps the stock views. Frontend-only (`pnpm build`).

## [1.4.213] — 2026-08-05 — Assets tab (team feedback) + Staff Details becomes a profile

### Added — 🧰 Assets tab (MIGRATION 0058)

- New `assets` table + routes: GET /staff/assets (list + assigned name), POST /staff/assets (auto asset-tag AZOA-001… when left blank; UNIQUE-tag guard), PATCH /staff/assets/:id. View/edit = the Staff-Details tier (hr_admin/coo/cco/ceo/admin/super_admin; CEO reads via exec_view, edits via hr tier rules on the routes). Assets are never deleted — status moves to lost/disposed so history and audit survive. All writes audited.
- New AssetsPanel (new file): summary chips (In use / Spare / In repair / Lost / Disposed + active value), collapsed "+ New asset" form SECTIONED per the CEO's ask — 🏷 Identification (tag, name*, category, brand & model, serial) → 🧾 Purchase (date, price RM, vendor, warranty until) → 📍 Assignment & status (assigned-to staff dropdown, location, status, condition note) — and a sticky-footer register table with per-row Edit. Tab registered after Inventory, same role tier as Staff Details.

### Changed — 👤 Staff Details profile look (MIGRATION 0059)

- The flat 15-field grid becomes a PROFILE: three subhead sections — 👤 Personal → 💼 Employment → 🏦 Bank & statutory — same inputs, same fill-then-lock policy, easier for HR to scan and update.
- Seven fields the record was missing (the "important details"): home address + emergency contact (name/phone/relationship) for duty of care, and EPF (KWSP) / SOCSO (PERKESO) / income-tax (LHDN) numbers — ready for the moment the pending statutory registration completes. Added to users, the GET /users select, and the PATCH allow-list with the same lock policy as everything else.

## [1.4.212] — 2026-08-05 — Three new cards from the approved architecture review (extension-only)

### Added (CEO APPROVED the review's recommended build order; zero existing components/layouts/routes altered)

- 🔌 **TikTok connection** (Dashboard, all staff): Shop authorization state, last synced order, last webhook + signature verdict, 7-day signature-failure count — with the exact fix spelled out when failures exist (re-copy secret → wrangler secret put → deploy). NEW file connection-status-card.tsx consuming the EXISTING /integrations/tiktok/status route (v1.4.48), which gained two ADDITIVE keys (last_order_at, failed_events_7d).
- 🕐 **Sales by hour** (revenue-role gate): hourly MYT histogram of the last 7 days across the same bases as the revenue card (shipments with order amounts, returned excluded, + manual sales) — pure-div bars (no chart library, by design), peak hour highlighted for scheduling LIVE sessions. NEW file + NEW route GET /staff/sales/by-hour (guard revenue_view).
- 📮 **Fulfilment** (revenue-role gate): this month's shipments by status (preparing/shipped/in_transit/delivered/returned per the 0007 schema) with the oldest still-preparing order and its age. NEW file + NEW route GET /staff/fulfilment/summary (guard revenue_view).
- Degradation: all three cards render NOTHING against an old worker (fetch fails → null) — the split-deploy skew seen on 04-08 cannot break the dashboard. No migrations. Affiliate Performance stays deferred per the review (TikTok scope not grantable).

## [1.4.211] — 2026-08-05 — Early payslip release is a first-class flow (for the right month)

### Changed (CEO: "If I want to have a function mechanism to release the payslip earlier then how?")

- The mechanism is the existing "Release now" on the month being PAID: month picker → last month → Release now. v1.4.211 makes that path friendly instead of scary: the confirm is now month-aware — releasing LAST month early (paying salaries before the 5th) gets a benign "Release {month} ahead of the automatic date? This is the normal early release…" while the current/future month keeps v1.4.210's strong wrong-month warning.
- Signpost added: when the CURRENT month is on screen, the schedule line ends with "Paying salaries early? The payslips to release are {last month} — pick that month above, then Release now." so the rule never has to be remembered.
- Undo release (v1.4.210) covers both cases unchanged. Frontend-only.

## [1.4.210] — 2026-08-05 — Payslip release flow matches the payment cycle (early-release guard + undo)

### Fixed (CEO: "if I release payslip earlier than 5th, it is for last month instead of next month — this is the correct process flow by right")

- What happened: viewing August (the default month) he pressed "Release now", which released 08-2026 payslips at 00:42 UTC on 5 Aug — but the run being PAID in early August is JULY's, and July's payslips open automatically on 05-08 10:00 MYT with no action needed. The button silently released the wrong month a month early.
- "Release now" on any month whose automatic date is still in the future now asks for confirmation, spelling out the flow: "{month} releases automatically on {date} — AFTER the month closes. The salary run you are paying now is LAST month's ({prev}) — its payslips release by themselves on the 5th. Release {month} EARLY anyway?"
- The RELEASED banner detects an early release (automatic date still in the future) and shows "⚠ Released EARLY … The salary run you pay this week is LAST month's" plus a one-click **Undo release** — POST /payroll/release { undo:true } deletes the override (audited payroll.release_undo) and the automatic gate resumes. After the automatic moment, undo is a visibility no-op by design.
- TO FIX TODAY'S ACCIDENT: open August in the Payroll tab → the banner now flags it → press Undo release. July needs nothing — it auto-released at 10:00 MYT. Worker + frontend; no migrations.

## [1.4.209] — 2026-08-04 — Staff Details action buttons wrap on phones

### Fixed (CEO's iPhone screenshot: "mobile view apps out")

- Staff directory: with a record open, the header action span holds FIVE buttons (Save, Preview badge, Print badge, Replace/Upload photo, Hide details) in a non-wrapping flex row — on a phone it ran past the right screen edge, clipping "Hide details". Now `flex-wrap justify-end` per the v1.4.154 phone width standard: buttons flow onto extra lines, right-aligned, nothing off-screen.
- Swept the file for other non-wrapping action rows: the staff-vault Download · Delete pair is two short links and cannot overflow — left as is. Frontend-only (`pnpm build`).

## [1.4.208] — 2026-08-04 — Expenses: paid / outstanding tracking per month

### Added (CEO: "track that I have paid and how many more outstanding for me to clear off … remaining amount for each month")

- Every expense row gets a green-outline "Mark paid" button; once paid the chip reads "✓ PAID {date}" and the button becomes a subtle "Undo paid" (the /expenses/:id/paid route is now a toggle — body { paid:false } clears the mark, audited either way).
- Header summary under the month Total: green "Paid RM a · bold amber Outstanding RM b (n to clear)" — outstanding counts unpaid expense rows + the payroll run if not yet Marked paid + approved claims not yet 💸 paid, i.e. the same three components as the Total. When everything is cleared it flips to "✅ All cleared — RM x paid".
- Payroll and claims keep their existing Mark-paid flows (Payments due card / Claims tab); the summary just reads their state. Worker + frontend; no migrations (paid_at existed since v1.4.88 — the UI never exposed it on rows).

## [1.4.207] — 2026-08-04 — TOTAL rows stay visible while the tables scroll

### Changed (CEO: "can you make the total fit eventho scrolling")

- globals.css: `.tbl-sticky tfoot td/th` pins to the BOTTOM of the scroll area — the mirror of v1.4.189's sticky subheads, with the same inset-shadow divider (real borders scroll away under border-collapse). Any tbl-sticky table that gains a tfoot inherits it automatically.
- The TikTok stock-out TOTAL row moved from the end of tbody into a real `<tfoot>` so the rule catches it; the Inventory live-status TOTAL already lived in a tfoot and pins with no markup change. Both cards now show sticky subheads at the top AND the TOTAL at the bottom while the rows scroll between them. Frontend-only.

## [1.4.206] — 2026-08-04 — Live engagement card removed; today's sales get a trend arrow vs yesterday

### Removed (CEO: "remove it Live engagement — TikTok since I cant get the API!")

- LiveEngagementCard deleted from the Dashboard entirely (v1.4.204's conditional hide still let non-scope errors through, e.g. TikTok "Internal error"). A tombstone comment in page.tsx records why and how to rebuild if TikTok ever grants the scope; the worker route /api/v1/live-analytics stays dormant and harmless.

### Added (CEO: "compare yesterday sales by telling the staff it is either arrow uptrend or downtrend")

- GET /staff/revenue now also returns `yesterday: { date, total_cents }` — the same four channel bases (TikTok orders, payments received, other shipments, manual sales) scoped to yesterday MYT and summed into one comparable number. The day-scoped queries were generalised to take a date instead of being hard-bound to today.
- The 🔥 Today box shows the trend under the channel line: green "▲ Uptrend — RM x above yesterday (RM y)", red "▼ Downtrend — RM x below yesterday (RM y)", or a neutral "level with yesterday". Hidden only when both days are zero. Worker + frontend; no migrations.

## [1.4.205] — 2026-08-04 — M2E file matches the CEO's real working batch exactly

### Changed (CEO's screenshots of a real generated batch: "one click download and upload without touch up")

- Favourite Recipient Code (col D) now auto-fills from each staff member's **Employee ID** (AZOOM002, AZOOA001, …) — his M2E favourite recipients are registered under the portal's employee IDs, so no new data entry is needed anywhere.
- Own Ref (col N) is now **unique per row**: `PAYROLL{MMDDYY of value date}{01,02,…}` — e.g. PAYROLL08052601…05 for value date 05082026 — matching his working batch instead of one shared reference.
- Client Batch ID is now a stored setting (his batch uses MYAONOF1D, not a generated value): new field in ⚙ M2E setup, saved to system_meta, filled into the Home sheet on every download. Setup counts as incomplete until it's saved.
- CSV fallback updated to the same columns/refs so both formats agree. Verified against the real template: Home + all five rows byte-match his screenshots (ref↔person pairing may differ since rows sort by name — refs only need to be unique within the batch). Worker + frontend; no migrations.

## [1.4.204] — 2026-08-04 — Live engagement card hides itself while the LIVE scope is ungrantable

### Changed (CEO chased the scope through Partner Center + Seller Center; conclusion documented)

- CONFIRMED: the LIVE analytics scope (package "Live Data", Scope ID 8851204, key `creator.data.live.read.public`) CANNOT be granted through the TikTok Shop **seller** authorization flow. Evidence: (a) Partner Center shows the package Active but Publish → **Available 0 / Unavailable 1**, so it never reaches the published scope set; (b) ELFIA's consent page (fresh Authorize from Seller Center → App store → My apps and incidents) lists exactly seven Shop scopes — Order Information, Fulfillment Basic, Logistics Basic, Global Shop Information, Return & Refund Basic, Shop Authorized Information, Update Delivery Status — and no Live Data. It is a creator-side scope on a Shop-seller app; only TikTok approval can change it.
- LiveEngagementCard therefore returns null on permission/scope errors instead of rendering a red error block on the CEO's dashboard every day. Other errors (network, missing route) still show their message, so a genuine fault is never silently swallowed. If the scope is ever granted, the card starts rendering again with no code change.
- Live GMV (LiveGmvCard) is unaffected — it comes from our own order data and needs no TikTok permission.
- NOTE for any future attempt: the three APIs under that package are Get Live Room Core Stats / GMV Trend / Interactive Trends, which are a DIFFERENT endpoint family from the `shop_lives/overview_performance` call in v1.4.197 — that route would need rewriting to match, not just re-authorizing. Frontend-only.

## [1.4.203] — 2026-08-04 — 💳 now generates the FILLED Maybank2E workbook itself

### Added (CEO: "I WANT the button can generate like this files!")

- NEW worker/src/m2e.ts: fills the official RCGEN2 .xlsm inside the Worker — an .xlsm is a ZIP of XML, so we unzip (DecompressionStream deflate-raw, zero dependencies), patch the Home sheet + salary rows as inline-string/numeric cells (leading zeros in value dates/ICs survive, unlike Excel paste), and rezip (STORE + hand-rolled CRC32). vbaProject.bin is never touched, so the template's own generate/upload macros keep working. Verified in Node against the real template: all 73 zip entries preserved, CRCs valid, values correct, VBA intact.
- GET /payroll/m2e-file?month= → the filled workbook: Home sheet (Corporate ID, Client Batch ID AZOO{MM}{YYYY}, payer account, Value Date per the v1.4.202 5th-or-earlier rule, ?value_date override) + every payable row from row 5 (mode IT/IG, amounts, accounts, bank codes, NRIC in col J). Staff with missing/unrecognised bank details are skipped and named in an X-M2E-Skipped header → toast. 409 with guidance when setup is incomplete.
- One-time ⚙ M2E setup (Payroll tab, payroll processors only): upload the BLANK official template once (binary POST /payroll/m2e-template → R2 private/m2e/template.xlsm, validated by a dry-run fill, added to the binary exclusion list) and save Corporate ID + payer account (GET/POST /payroll/m2e-settings → system_meta). The M2E User ID and password are login credentials and are NEVER asked for nor stored.
- 💳 button (Payroll toolbar + Expenses payments-due) now fetch-downloads the .xlsm with honest toasts; the paste-ready CSV stays as a fallback link. paymentDateFor + the bank-code map hoisted to module scope, shared by both routes.

## [1.4.202] — 2026-08-04 — Payment file Value Date follows the company payment rule

### Changed (CEO: "they payment date is always on 5th, if fall on weekend it will be earlier")

- The M2E salary file's default Value Date is no longer "today": it is now the **5th of the month after the payroll month, shifted EARLIER to the Friday before when the 5th falls on a weekend**. July payroll → 05-08-2026 (Wed); August → 04-09-2026 (5 Sep is Saturday); November → 04-12-2026; December → 05-01-2027.
- This is deliberately the opposite direction from the payslip RELEASE rule (v1.4.82–85, shifted forward) — staff see payslips on/after the day the money moves, never before it's due.
- `?value_date=YYYY-MM-DD` still overrides, and a # footer line states the computed date + the rule so it's auditable in the file itself. Worker-only.

## [1.4.201] — 2026-08-04 — Payroll payment file now matches the official Maybank2E RCGEN2 template

### Changed (CEO uploaded RCGEN2 - M2E Funds Transfer R3 V1.6.xlsm: "this is the format given by Maybank2E for me to make bulk payroll")

- GET /payroll/payment-file rebuilt around the template's "Salary Bulk Payment (MY)" sheet (headers row 4, data from row 5): the CSV's columns now mirror cols A–Q exactly — Payment Mode, Value Date (DDMMYYYY), Recipient Name 1 (≤40, sanitized), Favourite Code, Amount, Account No (digits only), Recipient Bank Code, Names 2/3, New IC No (from staff ic_number), Old IC/Biz Reg/Passport, Own Ref (AZOO{MM}{YYYY}), Recipient Description, Email, Payer Description — so the data rows paste straight into the template at A5.
- Payment Mode auto-set per row: IT (intrabank) when the staff bank maps to Maybank, else IG (GIRO/ACH) — payer account is Maybank.
- Recipient Bank Code resolved from staff free-text bank_name against the template's own "Recipient Bank Code" sheet (27 fragment mappings: Maybank/CIMB/Public/RHB/Hong Leong/AmBank/Bank Islam/Muamalat/BSN/Rakyat/Agrobank/Affin/Alliance/Al-Rajhi/MBSB/OCBC/UOB/HSBC/StanChart/Citi/KFH/BOC). Unmatched → cell says FILL-IN + a # footer names who to fix in Staff Details.
- Optional ?value_date=YYYY-MM-DD (defaults to today MYT). Footer prints the batch TOTAL + paste instructions + the Excel leading-zero apostrophe warning from the template itself.
- Filename now azoo-m2e-salary-{month}.csv; audit meta += format: m2e_salary. 💳 button renamed "M2E salary file" with paste instructions in the tooltip. Home-sheet fields (Corporate ID, Client Batch ID, Payer Account No) stay YOURS to fill in the template — the portal never stores them.

## [1.4.200] — 2026-08-04 — HOTFIX: Live engagement — TikTok rejects currency=MYR

### Fixed (user: "I already toggle on live data but still not appear!" — card showed TikTok: Currency is invalid, allowed values: USD, LOCAL)

- MY BUG in v1.4.197: the analytics call sent `currency: "MYR"`, but TikTok's overview_performance endpoint only accepts `USD` or `LOCAL` (LOCAL = the shop's own currency, i.e. MYR for us). Now sends `LOCAL`. The error itself proved the deploy + Analytics scope are fine — TikTok processed the request and complained only about this parameter.
- Error hint corrected: the "grant the Analytics scope…" suffix now only appears when TikTok's message actually reads like a permission problem; parameter errors show TikTok's message plainly.
- Errors were never cached (cache stores successes only), so the fix shows on the next card refresh after deploy.

## [1.4.199] — 2026-08-04 — Sort by clicking the column headers; sort pills removed

### Changed (per the CEO: "remove sort button, I want to click A to Z or Z to A by the subhead table instead. but need to sort based on the SKU for Inventory … and TikTok Live — stock out based on today hot sales")

- Both cards' "Sort:" pill rows are GONE — sorting now lives in the column headers themselves. Click a header to sort, click again to reverse; the active column shows ▲/▼.
  - **Inventory — live status & stock**: clickable SKU (natural 1→end / reversed) and Item (A→Z / Z→A). DEFAULT: SKU 1→end, exactly as the CEO specified.
  - **📉 TikTok Live — stock out**: clickable Out today, SKU and Item. DEFAULT: today's hot sales first (ties broken by month then SKU — deterministic), exactly as specified; click Out today again for coldest-first.
- Unused sortBtn helper removed. Frontend-only.

## [1.4.198] — 2026-08-04 — Table alignment: numeric columns right-aligned in both Inventory tables

### Fixed (per the CEO: "Do properly aligned the text in table and ensure it is fit well with the table size")

- New shared classes thR2/tdR2 — right-aligned header + cell with `tabular-nums` so digits stack in tidy columns. Applied consistently through HEADER, BODY and TOTAL FOOTER of both cards from the screenshots:
  - **Inventory — live status & stock**: Price/unit (input itself right-aligned too), Live rebate, Net (live), Stock. SKU/Item/Status/controls stay left; the v1.4.188 TOTAL footer values line up under their columns.
  - **📉 TikTok Live — stock out**: Out today, This month, All time, Avg sold @, Sold value (month), Left in stock, Last order — and the v1.4.171 weighted TOTAL row matches.
- Both tables already fill the card (w-full + min-w with horizontal scroll on phones); the ragged look was mixed alignment, now standardized. Frontend-only.

## [1.4.197] — 2026-08-04 — 📊 Live engagement from TikTok's official analytics API

### Added (per the CEO's LIVE Center screenshots: "I want to bring this data into my dashboard too, possible?")

- **GET /api/v1/live-analytics** (any signed-in staff role): last-7-days shop LIVE performance from the official `/analytics/202508/shop_lives/overview_performance` endpoint — views, impressions, likes, comments, shares, new followers, items sold, buyers, LIVE session count and TikTok's Attr. GMV. Tolerant metric extraction (structure-only diagnostic logged if TikTok changes shape); 30-minute cache in system_meta so staff views never hammer TikTok; TikTok's own error message surfaced verbatim while the **Data & Insights (Analytics) scope** isn't granted yet.
- **LiveEngagementCard on the Dashboard**, under Live GMV, 5-min refresh, metrics behind a v1.4.196 DetailsToggle. Honest notes baked in: TikTok's attribution can differ slightly from our order-window GMV (both labeled), and **LIVE Rewards (diamonds) is creator-side monetisation that the Shop API does not expose** — deliberately absent rather than faked.

### Deploy

- Worker deploy required this time (`wrangler deploy`) + `pnpm build`. User-side gate: grant the Data & Insights (Analytics) scope in Partner Center, publish, re-authorize.

## [1.4.196] — 2026-08-04 — Click-to-expand details: the minimalist-view standard

### Added (per the CEO: "by click on the data I can see the details data. if I didnt click on the data then it will hide the details data. this is to minimalist the view. Do check if the other card also need to have this feature and function like globally")

- New global `DetailsToggle` component (components/ui/details-toggle.tsx): a ▸ one-click disclosure — collapsed by default every visit, click to reveal, click to hide again. THE STANDARD: summary figures, callouts and action forms stay visible; supporting DETAIL/HISTORY lists collapse behind it.
- Applied across the portal audit: 🔥 Live GMV → "Last 7 days" rows; 👁 Attendance monitor → full per-staff list (the ⚠/⏳ callouts stay); TikTok Orders → order rows (status line + filter counts stay); Supplier returns → history list (summary strip + Record-return form stay); 🛠 Manual stock out → audit records with a live count in the label.
- Deliberately left always-visible (working surfaces, not detail): Inventory live-status table (has forms + TOTAL), TikTok stock-out performance table, Sales Pipeline, Payroll processing, Attendance verification/corrections. Frontend-only.

## [1.4.195] — 2026-08-04 — HOTFIX: v1.4.191/193 cards called routes without the /staff prefix

### Fixed (the CEO's console caught it: GET /api/v1/gmv → 404)

- MY BUG, not a deploy problem: page.tsx's api() helper is based at /api/v1 and every staff route must pass the /staff prefix explicitly — the v1.4.191 and v1.4.193 cards omitted it, so ALL their calls 404'd no matter which worker was deployed. The CEO's worker deploy (version 8a8c46b0) was correct the whole time. Fixed all nine call sites: /staff/gmv, /staff/attendance/ot/pending + /decide, /staff/live-sessions (GET/POST/PATCH), /staff/users, /staff/customers, /staff/clients/summary. Audit confirms zero non-/staff api() calls remain in page.tsx; staff-directory.tsx was already correct (its own base includes /staff). Frontend-only — `pnpm build` + hard refresh; NO worker redeploy needed.

## [1.4.194] — 2026-08-04 — Live GMV card announces itself

### Fixed (per the CEO: "I didnt see any gmv on the dashboard")

- The CEO's screenshot was the pre-v1.4.193 build — but the card ALSO rendered nothing while loading or when the worker route was missing, which would have looked identical. It now always shows: "Loading today's live GMV…" while fetching, and a clear "Live GMV needs the latest server — run the worker deploy" line if /gmv isn't there yet, instead of silently vanishing. Frontend-only on top of v1.4.193.

## [1.4.193] — 2026-08-04 — 🔥 Live GMV on the Dashboard for every staff member

### Added (per the CEO: "insert live GMV into my /portal at dashboard tabs for my staff view their live GMV daily results")

- **GET /staff/gmv** (every staff role): TikTok Live GMV — today's total + order count (gold box), this month, and the last 7 days as daily rows; from order amounts on TT- postage records, returned orders excluded, MYT scoping. When the viewer has a live session scheduled TODAY (v1.4.191 roster, end time set), a green "During your live today" box additionally shows the GMV that landed inside their session window(s) — window-based attribution for motivation, deliberately not a payroll figure; no double counting on overlapping sessions (EXISTS).
- **LiveGmvCard on the Dashboard**, mounted right under Quick actions for ALL roles, auto-refreshing every 5 minutes — the whole team sees today's live results the moment they open the portal. Uses the theme-independent solid chip palette (amber/green -100/-900) per the v1.4.178 rule.

## [1.4.192] — 2026-08-04 — Card spacing standardized on every multi-card tab

### Fixed (per the CEO: "why the card too close? check all the files ensure that all standardize")

- The v1.4.191 cards were mounted in bare fragments, so tabs stacking several components had no uniform gap between cards (visible between My attendance and Live session schedule). STANDARD applied everywhere: every multi-card tab wraps in the Profile-style `space-y-4 md:space-y-6` container — /portal Attendance (Attendance + OT approvals + Live schedule + corrections), Sales (Sales + Clients + Customer enquiries), HR (HrPanel + HrAdminPanel), and /admin Staff (StaffDirectory + HrAdminPanel + StaffPanel, previously ad-hoc mt-6 divs). The Attendance component's internal root aligned to the same scale. /admin Audit + Account and /account already followed the standard (verified). Frontend-only.

## [1.4.191] — 2026-08-04 — Eight gaps closed: OT approvals · enquiry replies · low-stock alerts · live roster · client layer · staff vault · off-site backup · PDPA

### Added (the CEO's selected gap list, all eight)

- **OT approval chain (migration 0054)** — ot_records gains status/decided_by/decided_at/decision_note. New "⏱ Overtime approvals" card on Attendance (CEO/COO + admin tier): completed day-pairs pending decision, Approve/Reject with optional note (reject = branded danger confirm), staff bell-notified either way, self-decision blocked, audited. Only APPROVED OT will feed payroll when the rounding rule lands.
- **In-app enquiry replies (migration 0055)** — enquiries gain reply/replied_by/replied_at. Staff reply inside the portal's Customer enquiries card ("↩ Reply in-app" / "✎ Update reply"); sending auto-marks new → contacted; the customer reads a green "AZ ONE OFFICIAL replied…" box in their /account thread (reply fields ride both list endpoints, pre-0055 tolerant).
- **Low-stock alerts (in migration 0056: inventory_items.low_alerted)** — bell notifications to active sales_marketing + the CEO when an item crosses to ≤5 ("⚠ Low stock… N left") or 0 ("🛑 OUT OF STOCK"). Instant on every manual movement (checkLowStock hooked after adjust/out/edit/revert/postage in staff.ts) and swept after each 30-min sync for TikTok deductions; low_alerted stops repeats and resets above 5.
- **Live session roster (migration 0056: live_sessions)** — "📺 Live session schedule" card on Attendance: managers (ceo/coo/cco/hr_admin/admin tier) schedule date · start–end · platform (tiktok/shopee/other) · host (validated active staff) · client (customers registry or free text) · notes; hosts see their own and are bell-notified on assignment; status scheduled/completed/cancelled; audited.
- **Client layer** — GET /clients/summary + "🤝 Clients" card on Sales: per-client invoiced total, collected (paid), quotations in play, live sessions scheduled — from sales_documents + the roster, customers registry as the client list.
- **Staff document vault + onboarding checklist (migration 0057)** — staff_documents (R2 private/staff-docs/) + users.onboarding_json. "📁 Documents & onboarding" inside each staff record's Details: upload (contract/offer letter/resignation/other), download, delete for hr_manage; staff can fetch their own via API. Six-item onboarding checklist persisted per staff member. Binary-body exclusion list extended for the upload route.
- **Off-Cloudflare backup (in migration 0057: system_meta)** — GET /api/v1/system/backup/download (super admin) streams the newest R2 backup; "⬇ Off-site copy" button on the /admin System health card; the card shows the last export and nags in amber when a quarter passes (or never exported).
- **PDPA** — the existing /privacy policy covered website visitors only; added Customer accounts & enquiries, Staff personal data (NRIC, bank, photos, payroll, employment documents; role-restricted, audit-logged, 2FA) and PDPA rights sections — marked DRAFT for the lawyer pile, BM version noted as required. Linked from the /account footer and the staff Profile tab.

## [1.4.190] — 2026-08-04 — Johor location fallbacks + diagnostic · Attendance verification scrolls

### Fixed (per the CEO: "location still be able to detect except in Johor. Attendance verification should scrollable")

- **Location (Johor orders blank)** — the extraction chain gains the remaining FLAT keys some regional payloads use (`district`, `town`) in both the sync and webhook paths. And because a still-blank order means TikTok sent a shape we haven't seen, a privacy-safe diagnostic now records the payload STRUCTURE (key names + district_info level names only — never any values) to the error log whenever no location can be extracted. Press **Sync from TikTok**: either the 📍 appears via the new fallbacks, or the /admin Audit → System health error log will show exactly which keys the Johor payload carries so the chain can be extended precisely.
- **Attendance verification** — the table now scrolls inside its card (max-h ≈ 28rem) with sticky column subheads per the v1.4.189 standard, instead of stretching the page.

## [1.4.189] — 2026-08-04 — Sticky subheads in every scrollable table

### Added (per the CEO: "every subhead will be remain if scrollable")

- New `.tbl-sticky` utility: inside a scrollable card the column subhead row (SKU / ITEM / PRICE… etc.) pins to the top while rows scroll beneath — solid card background, inset-shadow divider (theme-aware). Applied to ALL six capped tables: Inventory live-status, TikTok Live stock-out, Manual stock-out traceability, Sales Pipeline, Attendance corrections & back-entry, and the Payroll processing table (plus the capped claims-compilation table). Frontend-only.

## [1.4.188] — 2026-08-03 — Inventory TOTAL: stock value on hand

### Added (per the CEO: "I want to have the total of inventory prices for me to monitor how much that Stock I have for me to clear off")

- Bold **TOTAL — stock on hand** footer on the Inventory live-status table (same footer standard as the stock-out card): total units in stock, **value at list price** (Σ stock × price/unit) under Price/unit, and **value at net (live)** in green (Σ stock × (price − auto rebate)) under Net (live) — what clearing everything on TikTok Live would actually bring in. Recomputes live as prices, rebates and stock change. Frontend-only.

## [1.4.187] — 2026-08-03 — Tab rows flush with card width

### Fixed (per the CEO: "tabs width was not same with card width")

- The desktop nav was a wrap of fixed w-32 pills — 8 pills + gaps never summed to the container width, so the row's right edge fell short of the card edge below. All three navs (/portal, /admin, /account) are now full-width GRIDS of equal columns filling the container exactly: 16 portal tabs = two perfect rows of 8, flush left AND right with the cards; /admin's visible tabs span one flush row; /account's two tabs form a flush segmented pair. Pills stay uniform (equal columns replace the fixed w-32); roles with fewer tabs get equally-divided flush rows. Frontend-only.

## [1.4.186] — 2026-08-03 — Mobile view audit: date-input overflow killed, Expenses + Attendance corrections rebuilt for phones

### Fixed (per the CEO's four phone screenshots: "All this was not aligned with the correct mobile apps view. I need you to audit all the tabs")

- **Root cause across all four screenshots: iOS Safari date/datetime/month/time inputs have an intrinsic minimum width** — inside the phone's 2-column grid they refuse to shrink, overflowing the card edge (Leave End date, Tasks Deadline) or clipping (Attendance rows). Global guard in styles/globals.css: those input types are now `min-width: 0; max-width: 100%; appearance: none` — they can never overflow their container again, on ANY tab, current or future. Leave and Tasks needed nothing else (their markup was already the v1.4.154 standard).
- **Expenses form (phones)**: the Description input was squeezed to a sliver sharing one line with Monthly recurring + Due day. Phone layout now follows the v1.4.154 grid — Description full-width on its own row, recurring/due-day a clean row, Record expense full-width; desktop's single inline row unchanged.
- **Attendance — corrections & back-entry**: the ADD RECORD + filter controls predated the v1.4.154 standard (inline maxWidth styles escaped the class sweep) and wrapped raggedly. Rebuilt to the standard: phones get staff select full-width, then Clock in|Date, Time|Add, and full-width Find-staff + month rows; desktop keeps the capped inline row via sm:max-w.
- **Audit result**: swept all portal/account/admin form rows — zero inline maxWidth styles remain, every multi-field form row is on the phone-grid/desktop-flex standard, and the one intentional exception (Marketing "Material needed" input + Request button) is verified mobile-correct. Frontend-only.

## [1.4.185] — 2026-08-03 — NRIC placeholder masked

### Fixed (per the CEO: "NRIC place holder should not put my NRIC number there! it is supposed to be XXXXXX-XX-XXXX")

- The IC number field's example text used a real-looking NRIC ("e.g. 970209-01-5183") in BOTH the add-staff form and the staff-details editor — an actual number must never appear as reference text. All three occurrences (add form placeholder, details placeholder, tooltip) now show the masked format only: **XXXXXX-XX-XXXX**. Swept the codebase — no real-looking NRIC examples remain anywhere. Frontend-only.

## [1.4.184] — 2026-08-03 — Photo upload gets its save popup

### Fixed (per the CEO: "no popup successful when upload staff Photo")

- Uploading/replacing a staff photo on the Staff tab only set a subtle inline flag — the one save action still missing the v1.4.89 popup family. Success now shows the branded toast "Photo uploaded — {name} — badge photo saved"; failure shows a notice toast with the reason (inline row message kept). Frontend-only.

## [1.4.183] — 2026-08-03 — Part-time live hosts paid hourly (RM15.00/h from the clock) · live-host status rule

### Added (per the CEO: "live host I should have either part time or contract/permanent … part time live host will be counted their payroll based on their working hour which is RM15.00 per hour … defined based on their clock in-out, there is no OT eligible for live host part time")

- **Migration 0053** — `payroll_entries` += `hourly_minutes`, `hourly_rate_cents` (rate stored per entry so historic slips survive future rate changes).
- **Hourly payroll for part-time live hosts** — one server-side formula (rate constant `RM15.00/h`, single place to change): clocked minutes = Σ per MYT day (first clock-in → last clock-out; unpaired days earn nothing until corrected); pay = minutes × RM15 ÷ 60; **Net = hourly pay + commission + allowance − deduction**. No worked-days proration, no unpaid-leave maths, no OT — none of the salary concepts apply. The SAVE route recomputes these figures authoritatively from attendance regardless of what the client sent (tamper-proof), 🔧 Recompute re-derives them, and the payroll GET returns LIVE clocked figures so the panel always shows the current month's hours.
- **Panel** — hourly rows get an "⏱ hourly" chip; Basic shows read-only "225.00 · 15h 00m × RM15/h (auto from clock in–out)"; OT column shows "—" (not OT-eligible — CEO rule); Days column shows the clocked hours; the TOTAL row and Save-all use the same hourly formula, so Payroll/Expenses/P&L stay in tally.
- **Payslip** — earnings line becomes "HOURLY PAY (15H 00M × RM 15.00/HOUR)"; OT/unpaid-leave/incomplete-month lines never appear on an hourly slip. Works on "My payslip" too (hourly figures ride `p.*`).
- **Live-host status rule enforced** — an active live host is part-time, contract or permanent: setting `probation` on a live host is refused with the CEO rule spelled out (resigned/terminated stay allowed for the lifecycle). OT eligibility unchanged and now justified: part-time live hosts never (server + UI), contract/permanent live hosts remain eligible.

## [1.4.182] — 2026-08-03 — Tab layout pinned: no more sideways shift between tabs

### Fixed (per the CEO: "each tabs header keep changing their location either wide or little bit smaller … standardize like a Dashboard")

- The shift was the browser SCROLLBAR: long tabs (Dashboard, Sales…) always show it, short tabs (Profile…) don't — so the page content gains/loses ~15px and every header nudges sideways when switching tabs. All 16 tabs already share the same max-w-6xl container (verified); the width itself was moving. Fixed globally in styles/globals.css: `html { overflow-y: scroll; scrollbar-gutter: stable; }` — the scrollbar gutter is permanently reserved, so every tab renders at exactly the same width across /portal, /admin and /account. Frontend-only.

## [1.4.181] — 2026-08-03 — /account: Google password clarity · direct staff contact (WhatsApp + categorized enquiries → portal)

### Answered/fixed (per the CEO: "they can change their password? … does it require to change the password?")

- **Google customers have NO password here — nothing to change, and now nothing pointless shown.** The change-password server route already refused Google accounts (letting a hijacked session ADD a password would hand an attacker a permanent way in); the /account UI showed the form anyway with a footnote. `/auth/me` now returns an `oauth` flag and Google users see a clear info card instead: "You sign in with Google… your sign-in security is managed in your Google Account." Password accounts keep the form unchanged.

### Added ("add feature for the customer to directly contact staff for package inquiry or anything on AZ ONE OFFICIAL service")

- **💬 WhatsApp direct card** on /account Enquiries: one tap to the official +60 12-383 4821 with a prefilled greeting — the fastest human channel.
- **Categorized enquiries (migration 0052 `enquiries.category`)** — the Ask form gains "What is this about?": General / Package & pricing / Live commerce services / Order & delivery / Collaboration. Category chips on the customer's own thread list.
- **Staff are bell-notified INSTANTLY** — every new enquiry notifies active sales_marketing, marketing and the CEO ("New customer enquiry (package & pricing): Dini…"), so a customer never waits for someone to remember to check a list.
- **📨 Customer enquiries card on the portal Sales tab** — enquiries were previously visible ONLY in /admin, which sales staff can't open. New `ENQUIRY_ROLES` (business team: ceo/coo/cco/sales_marketing/marketing/hr_admin + admin tier) can list and work them in /portal: name·company, category chip, message, one-tap WhatsApp (when the customer left a phone) / Email links, and the status select (new→contacted→qualified→closed).

## [1.4.180] — 2026-08-03 — /admin role policy aligned: Google-account staff (auto part-time) + live_host_part_time option

### Fixed (per the CEO: "I cant manually assigned staff roles based on Google account … there is no roles live_host_part_time in the list!")

- **/admin was still enforcing the OLD v1.4.42 rule** (personal emails flatly refused for staff roles) — the v1.4.156–157 policy was only ever applied to the portal route. Both /admin routes (PATCH role change + user creation) now follow the same policy: a Google/personal-email account CAN be assigned a staff role, with `employment_status` FORCED to part_time; permanent staff and admin-tier roles still require an @azoneofficial.com email.
- **`live_host_part_time` in the role list** — a real dropdown option (role change + create form): maps to role `live_host` + `employment_status` part_time, assignable to any email; accounts already in that state display as `live_host_part_time` in the dropdown (users list now returns employment_status).
- **Role changes in /admin are now SUPER ADMIN only** — matching your v1.4.157 security directive (previously any admin could change roles there); other /admin actions (suspend, reset password, force logout) keep their existing admin-tier access. Audit records the forced part-time alongside the role.

## [1.4.179] — 2026-08-03 — Weekend OT all day · deeper order-location fallbacks

### Added (per the CEO: "for OT there should be appear on Weekend … except of executive")

- **Weekend OT**: Saturdays and Sundays (MYT) are rest days — any work IS overtime. OT in / OT out are now available ALL DAY on weekends, with no prior clock-in required (there is no normal shift to extend). Weekdays keep the original rule: window from 18:00 MYT after a clocked-in day. Executives (CEO/COO/CCO + admin tier) and part-time staff remain excluded on every day. Dashboard shows the OT buttons all day on weekends with a helper note: "Weekend: the whole day counts as overtime — no normal clock-in needed."

### Fixed ("why there is a missing location?")

- Some TikTok orders carry neither a flat `city` nor a `state` in their recipient data — those rows showed no 📍 at all. The extraction now falls further: district level (daerah), then ANY named area level TikTok sent. Still an area only, never the street address (privacy rule unchanged). Applies to both the sync and webhook paths; the sync's refresh pass backfills existing orders on the next "Sync from TikTok", so the missing 📍 on TT-…450950 should fill itself if TikTok provides any area level for it.

## [1.4.178] — 2026-08-03 — Readable callouts: monitor strips + payee banners

### Fixed (CEO's screenshot: "the color cant be seen")

- The monitor's amber/blue callout strips (and the claims payee banners) used pastel `-50` backgrounds with `dark:` variants. On a device with system dark mode active, the dark variants fired over the light card — dark translucent background + pale text = unreadable mud. Restyled to the same treatment as the chips in the card (which read perfectly in the same screenshot): solid `-100` background, `-900` text, visible border, semibold — one look on every device and theme. Applies to: "⚠ Not clocked in", "⏳ Past 18:00 with no clock-out yet", and the 💰 payee banners (amber pay-to, green pays-to-you) in Claims.

## [1.4.177] — 2026-08-03 — HOTFIX: attendance monitor showed everyone as not clocked in

### Fixed (CEO's screenshot: monitor claimed nobody clocked in despite real punches today)

- The v1.4.173 monitor query filtered `type = 'in'` / `'out'`, but punches are stored as **`clock_in` / `clock_out`** — the subqueries matched nothing, so every staff member showed "⚠ not clocked in" regardless of their real data. Both literals corrected; the monitor now mirrors the same values the punch routes themselves use. Swept the codebase for other bare in/out comparisons — none remain.

## [1.4.176] — 2026-08-03 — Payee always answered · set/change payee on existing claims

### Added (per the CEO: "I want to know who is the payees and to insert the payees")

- **"Who gets paid?" is always answered** — for the CEO/admin tier/hr_admin, every claim's Details now shows a payment line even when no payee was chosen: "💰 Pay to: Nursyazwani (the submitter — no separate payee)". No more inferring from silence.
- **✎ set/change payee on ANY existing claim** — new `POST /claims/:id/payee` (CEO/HR/admin tier only): an inline picker in Details sets, changes, or clears the payee on any claim regardless of status — including ones approved before the payee feature existed. The payee is payment routing, not claim content, so this never restarts the approval chain; every change is audited (`claim.payee_set`, before → after, claim status noted). The conflict-waiver logic (v1.4.174/175) reads the payee live, so a later-set payee still blocks the conflicted reviewer correctly.

## [1.4.175] — 2026-08-03 — Conflicted stage auto-waived: payee-blocked claims route straight to the CEO

### Added (per the CEO: "how to counter this?" — the CCO-payee case must not depend on remembering the override)

- **Waived, not bypassed** — when a chain stage's approver IS the payee (HR review paying hr_admin; COO/CCO pre-approval paying the COO/CCO), that stage counts as **waived by design** on CEO approval: no "bypass" wording; the decision note reads "CCO pre-approval waived — approver is the payee (conflict of interest)" and the audit records `conflict_waived` separately from `chain_override`. Genuinely skipped stages still get the full override treatment.
- **Notification reroutes** — a new/edited/resubmitted claim whose first stage is conflicted notifies the CEO directly: "(pre-approver is the payee — for your direct decision)" instead of pinging someone forbidden from acting.
- **CEO dialog softened** — approving a waived-only claim shows "Approve directly? … your direct decision is the designed route" instead of the scary incomplete-chain bypass warning (which remains for real skips, including mixed cases).
- **No dead-end buttons** — a conflicted HR/COO/CCO reviewer sees "⚖ Your stage is waived on this claim — it pays to you, so the CEO decides it directly" instead of a button the server would refuse. `payee_role` added to the claims payload (same visibility rules; stripped with the other payee fields).

## [1.4.174] — 2026-08-03 — Payee visibility: the person being paid always sees the claim

### Fixed (per the CEO: "if the payee is COO or CCO how? or on behalf of the staff how? they need to view what the claim status is")

- **The payee always sees the claim raised in their name** — every claims-list scope gains "or I am the payee", so a staff member, the COO, or the CCO whose claim HR submitted on their behalf can open Claims and track it: pending → approved → 💚 PAID. Previously a staff payee couldn't see the claim at all, and a COO/CCO payee had the payee info stripped from their own claim.
- **Payee-facing UI** — on their own rows the payee gets a green "💰 pays to you" chip beside Details and, expanded, a green banner: "This claim was raised on your behalf by {claimant} — the payment comes to YOU once the CEO approves." Everyone else's visibility is unchanged: CEO/admin tier/hr_admin see the amber remark; other roles still never receive the field on rows that aren't theirs.
- **No-self-review extended to the payee** — HR can't review and the COO/CCO can't pre-approve a claim that PAYS themselves (conflict of interest); those go to the next stage or the CEO's direct decision (override exists since v1.4.107). Pre-0051 tolerant.

## [1.4.173] — 2026-08-03 — Attendance monitor (missing punches) · claim payee remark

### Added (per the CEO)

- **👁 Today's attendance monitor** on the Attendance tab (Team-report viewers): live snapshot of every active staff member's punches today, refreshed every 2 minutes — amber "⚠ Not clocked in: …" callout, "⏳ Past 18:00 with no clock-out yet: …" after shift end, then a compact list (missing punches sorted to the top, In/Out times MYT, part-time labelled, weekend note). New `GET /attendance/monitor` (hr_manage + exec_view, same as the Team report).
- **Claim payee remark (migration 0051 `claims.payee_user_id`)** — for claims raised on behalf of someone (hr_admin's case): a "💰 Pay claim to" picker on the submit form (visible to hr_admin/CEO/admin tier only). Strictly an INTERNAL remark: **never printed on the AZOO-HR-CLM-001 form**; the server only sends the field to the CEO/admin tier + hr_admin (stripped for COO/CCO reviewers and ordinary claimants); shown as an amber "💰 Pay this claim to: …" line in Details plus a "💰 → Name" chip on the row so the CEO pays the right person at a glance. Carried through claim edit (clearable); audited on create.

## [1.4.172] — 2026-08-03 — Manual stock-out lifecycle: Revert · Edit · Delete · backdatable out date

### Added (per the CEO: "option to revert back into the inventory or sold if manual stock sales; add date of when manual out; Edit or Delete button also")

- **Migration 0050**: `manual_stockouts` += `out_date` (backdatable), `reverted` flag, `sale_id` link; `manual_sales` += `out_date`. Revenue totals now attribute manual sales by the out date.
- **Date of stock out** in the modal (default today MYT, backdatable) — shown leading each traceability row; recording timestamp on hover.
- **↩ Revert** — stock goes back on the shelf, a linked sale is removed from the totals, and the ROW STAYS marked "↩ reverted — stock restored" (struck through) — the audit trail survives the undo. Reverted rows can't be edited or re-reverted.
- **Edit** — reopens the same modal on the record: qty (stock moves by the difference, refused if the shelf lacks it), Sold @ (clearing it removes the sale; adding it creates one), remark, out date — the linked `manual_sales` row is updated/created/deleted in step so Total sales never drifts. Item itself is locked (delete + re-record for that).
- **Delete** — for wrong records: stock restored (unless already reverted), sale removed, row deleted; branded danger confirm explains that ↩ Revert is the trail-keeping undo. All three actions audited (`inventory.manual_out_edit/revert/delete`, before/after or snapshot).
- Legacy rows recorded before 0050 (no sale link) resolve their sale by exact field match — including today's four UITM rows.

## [1.4.171] — 2026-08-03 — TOTAL row on the TikTok stock-out card

### Added (per the CEO: "I want to have a total of This month, All time, Avg sold @, Sold value (month), Left in stock")

- Bold **TOTAL** footer row on 📉 TikTok Live — stock out, summing every item: Out today (🔥 badge), This month, All time, **Avg sold @ weighted by units** (Σ price × qty ÷ Σ qty — not a simple average of row averages, so one 1-unit item can't skew it), Sold value (month), Left in stock. Sums always cover ALL items regardless of the active sort.

## [1.4.170] — 2026-08-03 — Sort controls · manual stock-out modal with mandatory remark · traceability card

### Added (per the CEO)

- **Sort controls on both stock tables** — "Sort: SKU 1→end / A→Z / Z→A" pills on **Inventory — live status & stock**, and the same plus the "🔥 Today" default on **📉 TikTok Live — stock out**. SKU sorting is natural-numeric (ELFIA001 → ELFIA002 → … → ELFIA012, not lexicographic).
- **Manual stock-out MODAL (migration 0049 `manual_stockouts`)** — Out − now opens a proper form: **SKU · Item** picker (pre-selected from the row, SKU-sorted), **Quantity out**, optional **Sold @** (fills the Manual-sales channel as before), and a **MANDATORY Remark** — the server refuses an Out without a reason, so no stock ever leaves the shelf unexplained. Audit meta carries the remark too.
- **New card 🛠 Manual stock out — traceability** — every manual out as a scrollable list: date (MYT) · SKU — item · qty · remark · "Sold @ RM x" green chip or "correction" chip · by whom. `GET /inventory/manual-outs` (last 100; empty before 0049, never an error).
- **Cards minimalist/scrollable** — the main stock table now scrolls inside the card (max-h-96) like the other lists; the TikTok stock-out table capped at max-h-80; the inline "Sold @" input from v1.4.169 moved into the modal, so the table row is shorter again.

## [1.4.169] — 2026-08-03 — Total sales across ALL channels (manual outs + non-TikTok orders + invoices + TikTok)

### Added (per the CEO: "if there is any manual out without any rebate how do I know the total sales? Invoice also need to count beside of TikTok or any postage tracking — non-TikTok orders")

- **Manual sale on Out − (migration 0048 `manual_sales`)** — the Manual in/out control gains an optional **"Sold @" (RM/unit)** input: filled, the Out is recorded as a SALE (snapshot sku/name/qty/price, audited, "Sale recorded" toast) and counts in total sales; empty, it stays a plain correction (damage/samples) deliberately **excluded** so corrections never inflate revenue.
- **Non-TikTok shipments carry their value** — the manual postage form gains **"Order amount (RM)"** (Shopee/WhatsApp/direct orders); empty = RM 0 shipments like replacements stay out of the totals.
- **Revenue card now sums FOUR channels**: TikTok (synced paid amounts) + Invoiced (payments received) + **Other shipments** + **Manual sales** — two new boxes, a renamed **"Total — all channels"** box, today's gold 🔥 box includes all four, and the **KPI target bar tracks the same all-channel total** (it previously tracked TikTok + invoices only). `/staff/revenue` response += `other`, `manual`, `today.other_cents`, `today.manual_cents`; tolerant of 0048 pending.

## [1.4.168] — 2026-08-03 — Self-healing TikTok stock deduction (retry on every sync)

### Fixed (per the CEO: orders show "No stock movement recorded", stock-out card empty — "ensure inventory counted correctly without discrepancies; total of sales must match sold prices and sold item")

- **Root cause**: stock deduction only ever ran on an order's FIRST import. All 11 orders were imported before their inventory items existed / matched (SKU typos like "ELLFIA 006" vs "ELFIA006"), and the refresh pass only backfilled status/tracking — so they stayed movement-less forever, leaving the stock-out card empty and stock uncounted.
- **Fix**: every sync (manual button and 30-min cron) now **retries the deduction for movement-less orders against CURRENT inventory** — same SKU-or-name matching, same all-or-nothing shortage rule, sold price captured, rebate auto-synced, audited as `inventory.out` source `tiktok_retry`. On success the order note becomes "✔ stock deducted on retry DD-MM HH:MM MYT"; while still blocked, the note refreshes to the CURRENT reason (fix one SKU → the unmatched list shrinks next sync). Returned/restocked orders excluded. Sync summary/audit now reports `retried` alongside imported/skipped.
- Result: fix the item SKUs/names (or add missing items) → press **Sync from TikTok** → the backlog deducts retroactively, the 📉 stock-out card populates with quantities + sold prices, and stock, sold items, and sales totals all tally.

## [1.4.167] — 2026-08-03 — Users columns aligned · badge whitespace spread

### Fixed (per the CEO)

- **Users tab column misalignment** — the customer column carried a heading + description while the staff column had none, so the two list boxes started at different heights. The staff column now has its own "Staff accounts" heading + one-line description mirroring the right; both descriptions truncate to a single line (full text on hover); both boxes share max-h-80 — tops AND bottoms align. Main card description trimmed since the columns now carry the detail.
- **ID badge white gap** — content was top-packed, leaving a large white block above the pinned footer. Spacing spread downward (~7mm absorbed): card top padding 3.5→4.4mm, photo gap 1.8→3.2mm, tagline 0.8→1.4mm, rows offset 2.4→3.6mm, per-row padding 0.6→0.85mm. Verified against the worst realistic case (two-line name + full footer): ~2mm slack on the 85.6mm card, no clipping. Preview, single print, and the 3×3 sheet all share the one template so all three change together.

## [1.4.166] — 2026-08-03 — Rebate auto-computed from actual TikTok sold prices (no manual entry)

### Changed (per the CEO: "live rebate should not be manually insert — price RM 11.70, live sale RM 10.00 → rebate RM 1.70, auto updated and synced with the firm order; every inventory in-out correctly counted")

- **Migration 0047 `postage_items.unit_sale_cents`** — every TikTok stock movement now stores the **actual price the buyer paid per unit** (TikTok's `sale_price` on each order line, captured by both the sync and the webhook).
- **Rebate is now AUTO**: on every deduction, the item's `live_rebate_cents` auto-syncs to `list price − actual sold price` (never negative; untouched when no sold price arrived or no list price is set). The manual Live-rebate input is **gone** — the column is read-only "Live rebate (auto)" showing the amber "− 1.70"; Net (live) continues to show the resulting effective price. Migration-tolerant on both 0046/0047.
- **📉 TikTok Live — stock out** card gains **"Avg sold @"** (real average paid price, with the amber per-unit rebate beside it and a tooltip doing the arithmetic: "List RM 11.70 − sold RM 10.00 = rebate RM 1.70/unit") and **"Sold value (month)"** (qty × sold price). Revenue math unchanged and correct by construction: sales totals already come from TikTok's paid amounts, so RM 10.00 counts as RM 10.00 — the rebate is derived, never double-deducted.
- Audit `inventory.out` now records `unit_sale_cents` on every TikTok deduction — the in/out trail carries the sold price too.

## [1.4.165] — 2026-08-03 — "TikTok Live — stock out" card on Inventory

### Added (per the CEO: "how I will know which item are out during live sales in TikTok? this need to be added on the card box")

- New **📉 TikTok Live — stock out** card between the stock table and Supplier returns: per-item units deducted by TikTok orders — **Out today** (green 🔥 badge when >0), **This month**, **All time**, **Left in stock**, and the **Last order** timestamp (MYT). Counted from the actual stock movements the sync/webhook recorded on TT- orders (postage_items joined to TT- postage records), returned orders excluded — so it agrees exactly with the stock column. Sorted hottest-today first. New `GET /inventory/tiktok-out` (inventory/exec_view). No migration.

## [1.4.164] — 2026-08-03 — Live rebate on inventory pricing · edit supplier returns

### Added (per the CEO: "price per unit need to deduct of the rebate sales during live on TikTok" + "for this one also I should be able to edit/delete")

- **Live rebate per item (migration 0046 `inventory_items.live_rebate_cents`)** — inline "Live rebate" input beside Price/unit and a computed **"Net (live)"** column (price − rebate, green when a rebate is set) showing the effective price announced during TikTok Live. Informational for pricing: actual TikTok revenue continues to come from the amounts buyers really paid (the order sync), so the P&L stays truthful. `PATCH /inventory/:id` accepts `live_rebate`; migration-tolerant (price edits keep working pre-0046, rebate edits name the migration).
- **Supplier returns: Edit** (Delete existed since v1.4.148) — new `POST /inventory/returns/:id/edit`, outstanding rows only (credited/partially-replaced rows locked: money/goods already moved). Editable qty / unit cost / supplier / date / reason; **a qty change moves stock by the difference** — lowering puts pieces back on the shelf, raising boxes more (refused if the shelf lacks them); total recomputes; audited with before/after. UI: Edit link beside Delete opens a standard subheaded inline editor with save-toast.

## [1.4.163] — 2026-08-03 — News + Events forms brought to the Dashboard card standard

### Fixed (per the CEO: "head section is not same as Dashboard/Overview compared to News — all the tabs follow as Dashboard")

- **Publish news** was the last card with placeholder-only fields and no description under its title — it predated the subhead standard and only became CEO-visible in v1.4.153, so every sweep missed it. Now standard: muted description line ("Posted to every staff member — appears on their Dashboard and in this feed until they press Acknowledge"), **Sub labels** on Title / Body / Category, category select width-capped (sm:max-w-44), better placeholder examples.
- **Events form** — the v1.4.154 sweep added Sub labels to Category/Date/Start/End but missed **Event title, Location, Details**; all three now carry subheads with example placeholders.
- Full-page sweep re-run: the only remaining unlabeled placeholder inputs are the Sales line-item cells, which correctly share column headers (table-inline exemption). Every form card in /portal now matches the Dashboard pattern: bold title → muted description → subheaded fields.

## [1.4.162] — 2026-08-03 — Inventory: SKU-or-name TikTok matching · Edit/Delete items · missing subheads

### Fixed (per the CEO: "seem like there is a missing of subhead")

- The last two Inventory table columns had no headers — now **"Manual in / out"** over the qty + In+/Out− controls and **"Actions"** over the new Edit/Delete.

### Added (per the CEO)

- **TikTok stock matching by item description OR SKU** — the sync/webhook now resolves each TikTok line in three passes: (1) SKU, now case-insensitive + trimmed (was strict exact-match); (2) exact item-name match against the TikTok variant (sku_name) or full product name; (3) unique-contains — the inventory name appearing inside the TikTok product/variant name, but ONLY when exactly one item qualifies, so an ambiguous name can never move the wrong stock (names <3 chars never contains-match). Order notes say "matched by item name: …" when the fallback fired; unmatched lines now read "not in inventory (SKU or name)".
- **Edit / Delete on inventory rows** ("wrongly insert" fix) — Edit turns SKU + name into inline inputs (Save/Cancel, SKU-uniqueness 409, audited `inventory.edit` with before/after); Delete goes through the **standardized branded danger confirm** (v1.4.142 dialog) + save-toast. Deletion is **blocked with a clear message once the item has shipment (postage_items) or supplier-return history** — those records reference it, so history-bearing items get edited, not deleted; audited `inventory.delete` with a snapshot.

## [1.4.161] — 2026-08-03 — Users tab compacted (minimalist rows, mobile-friendly)

### Changed (per the CEO: "minimalist the card box since it is too long to scroll; mobile apps view also nice")

- **Staff + customer lists** — stacked bordered card boxes replaced with one hairline-divided box of **single-line rows** (py-1.5); name + email truncate so a phone row stays one line; the ✎ edit action shrinks to an icon.
- **Exception-only chips** — role always shows; "permanent", "active", and "2FA ✓" no longer render (they're the normal state). Chips now appear only for the exceptions: non-permanent status (part time / contract / probation / resigned / terminated, with left/rejoined dates moved into a hover title), red **disabled**, amber **2FA ✗**. Six healthy staff rows went from four chips each to one.
- **Desktop**: staff and customer lists sit **side-by-side (lg:grid-cols-2)**, cutting the page height roughly in half; they stack normally on phones.
- **User log** — rows tightened (11px, hairline dividers, smaller action chips) and the scroll boxes shortened (staff max-h-80, customers/log max-h-56) so each section scrolls internally instead of stretching the page.

## [1.4.160] — 2026-08-03 — Delivery/postage fee on QT + INV (Malaysian flow) · KPI colour tiers + progress bar

### Added (per the CEO)

- **Delivery / postage fee (migration 0045 `sales_documents.delivery_cents`)** — the Malaysian SME flow, exactly as asked: the **Quotation quotes it**, the **Invoice bills it**, and the **Delivery Order carries goods + quantities ONLY** (no prices, no charges — a DO is proof of delivery, not a bill). Form gains "Delivery / postage (RM, optional)" beside Discount/Tax (hidden for DO); fee is added **after discount + tax** (pass-through charge, not taxable goods value); QT→INV convert carries it; edit recomputes it; printed QT/INV totals show a "Delivery / postage" row.
- **Printed DO now price-free** — items table trimmed to # / Description / Qty and the totals block removed, per standard Malaysian practice ("Received in good order" signature block unchanged).
- **KPI bar upgraded** — taller progress bar with the **percentage printed on it**, traffic-light colour tiers (red <40% · amber <70% · gold <100% · green at target), and an **on-pace chip**: compares achieved % against how far through the month it is MYT ("✅ On track" / "⚠ Behind pace — day 3/31: expected ~10% by today").

## [1.4.159] — 2026-08-03 — Uniform tab widths (Dashboard as the standard)

### Changed (per the CEO: "All the tabs need to follow the standard width as Dashboard")

- Desktop tab pills were text-sized — "HR" tiny, "Attendance" wide, every row ragged. Every pill is now a **fixed-width (w-32), centre-labelled block**, identical to the Dashboard pill, wrapping into a clean app-style grid. Applied to all three navs: **/portal, /admin, /account** (mobile was already uniform: bottom nav `flex-1`, More sheet `grid-cols-3`). Longest labels ("Testimonials", "My Enquiries") verified to fit.

## [1.4.158] — 2026-08-03 — OT hidden from executive roles (CEO/COO/CCO)

### Changed (per the CEO)

- **OT in / OT out no longer appear for ceo, coo, or cco** (admin-tier system accounts likewise) — executives are not OT-paid staff. Enforced in both places: `POST /attendance/ot` refuses with "Executive roles (CEO/COO/CCO) are not eligible for OT punches." and the `ot_eligible` flag now excludes those roles, so the Dashboard buttons and the HOD note never render for them. Final eligibility rule: **a non-executive staff role whose employment status isn't part_time** — permanent/contract/probation editor, marketing, live_host, hr_admin, sales_marketing.

## [1.4.157] — 2026-08-03 — Role changes locked to super_admin only (security)

### Changed (per the CEO: "avoid any Google account breaching my system")

- **`POST /users/:id/role` is now SUPER_ADMIN ONLY** — `admin` and `ceo` removed from the v1.4.156 allowlist. Google sign-ups always land as `customer` with zero staff access (unchanged since v1.4.42's domain policy), and with promotion held outside every business account, a compromised Google or staff sign-in can never escalate itself or anyone else. The refusal message says so.
- **Users tab** — ✎ Change role / ✎ Promote render for super_admin only; the CEO's view is read-only again, with copy explaining the security reasoning. All other v1.4.156 guards stand: admin-tier accounts untouchable/unassignable, no self-change, personal emails part-time only, audited `staff.role_change`.

## [1.4.156] — 2026-08-03 — MYT timestamps on TikTok Orders · Today's sales · role changes from Users tab · OT rule by employment status

### Fixed

- **v1.4.155 bug (own goal, caught before it bit)** — the OT route and attendance GET queried a non-existent `users.status` column; the real column is `employment_status`. Deployed as-was, this would have 500'd the OT punch AND broken the Dashboard's attendance load. Both corrected.
- **TikTok Orders card showed UTC** — "last webhook" and each order's timestamp are DB UTC and were rendered raw (8 hours behind). New `dmyMYT()` shifts full timestamps to Malaysia time; the webhook line now says "… MYT" explicitly.

### Changed (per the CEO)

- **OT eligibility now follows EMPLOYMENT STATUS, not role** — permanent live hosts DO work overtime; `part_time` staff of any role (part-time live hosts, part-time designers) are not eligible. Server + `ot_eligible` flag both updated.

### Added (per the CEO)

- **Sales revenue → "🔥 Today" box** — gold-accented, leads the grid: today's TikTok orders + payments received (MYT day scope, same bases as the monthly figures), with a motivational line for the sales team. Grid is now 2-up on tablets / 4-up on desktop.
- **Role & employment-status changes from the Users tab** — new `POST /users/:id/role` (super_admin/admin/ceo): assign any staff role or demote to customer, set employment status; admin-tier accounts untouchable; no self-change; audited `staff.role_change`; takes effect on the target's next request. **Domain-policy nuance:** personal-email (Google) accounts may hold staff roles **as part_time only** — enforced server-side; permanent staff still require an @azoneofficial.com account.
- **Users tab UI** — "✎ Change role" on staff rows (CEO + super_admin; COO stays read-only) with role + employment-status selects, plus a new **"Customer accounts — Google & self sign-ups"** section with one-tap **✎ Promote** (defaults to part-time live host).

## [1.4.155] — 2026-08-03 — Overtime OT in / OT out on the Dashboard + Inventory alignment fixes

### Added (per the CEO: OT punches after 6pm, HOD approval reminder, hidden from part-time live hosts)

- **Migration 0044** — `ot_records` table (no FKs; `type` = `ot_in`/`ot_out`), separate from `attendance_records` (its CHECK constraint would need a table rebuild for new types).
- **Worker `POST /attendance/ot`** — opens **18:00 MYT** onward; requires today's clock-in ("overtime can only follow a worked day"); OT out requires OT in; one of each per day (409 confirms the recorded time); **live_host role and `part_time` status refused 403** — eligibility enforced server-side, not just hidden.
- **Worker `GET /attendance`** now also returns `ot` rows (guarded pre-migration) and `ot_eligible` for the requesting user.
- **Dashboard Quick actions** — **OT in / OT out** buttons appear from 18:00 MYT (minute tick, no refresh needed) for eligible staff only, with an amber reminder: _"OT in / OT out only with your Section HOD's approval."_ Success toast repeats the HOD condition; the Today line now includes `OT in 18:05 · OT out 20:10`.

### Fixed

- **Marketing materials** — Request button floated at label height and clipped the input's placeholder; row is now `items-end`, the field takes the remaining width, and the button matches the 38px input height.
- **Postage (non-TikTok)** — "+ Add item line" link and the "Add record" button rendered jammed on one line (both inline-level in the stacked form); the link is now block-level on its own line.

## [1.4.154] — 2026-08-03 — Width standard enforced across all tabs (/portal, /admin, /account)

### Changed (per the CEO: standardize widths on every tab, web AND mobile, no exceptions)

- Full sweep of every form row across the three apps against the house standard — **phones: 2-up full-width grid; desktop: capped inline row** — and every violator brought in line:
  - **Expenses — record form** (date / category / amount / vendor): was a wrapping row of fixed-width boxes that truncated on phones — now the standard grid; desktop widths standardized
  - **Expenses — inline edit row**: same treatment for the compact per-row editor
  - **Events — create form** (category / date / start / end): standardized AND given the portal-wide subhead labels it had been missed for
  - **Attendance — team-report staff filter**: full-width on phones
  - **Postage — item-line qty** box: full-width on phones
  - **/admin — reset-password input**: was fixed 224px (clipped on narrow phones) — full-width on mobile
- Verified clean already: /account forms (full-width inputs throughout), staff-create form (responsive grids), payroll processing, Sales, Claims, Leave, Tasks, Inventory (v1.4.150), Users, Birthdays. Compact **inside-table** controls (price/qty/working-days cells) are intentionally exempt — they live in scrollable tables, not form rows

### Deploy

- `pnpm build` → hard refresh only

## [1.4.153] — 2026-08-03 — CEO posts news · Users tab gains a user log + 2FA monitoring

### Fixed (CEO: "why I dont have access to update the news? I am CEO!")

- The `team_manage` permission list — which gates posting announcements and assigning team tasks — **never included the CEO** (an old oversight from the rank rework). Fixed on both worker and UI: the CEO now sees the compose form on the News tab and can post announcements (with the usual bell notification to all staff) and assign tasks

### Added (per the CEO: user log + 2FA awareness for monitoring)

- **User log on the Users tab:** "User log — recent sign-ins & account events" beneath the accounts list — the last 60 authentication events from the audit trail (password sign-ins, 2FA sign-ins, Google sign-ins, 2FA challenges, backup-code use, 2FA enabled/disabled), each with the person, a colour-coded action chip, and the MYT timestamp. Same readers as the tab (super_admin/CEO/COO); the full audit stays in /admin
- **2FA monitoring:** every account row now carries a **"2FA ✓" (green) or "2FA not set" (amber)** chip — only the presence of 2FA is exposed, never any secret — plus an amber summary line counting active accounts still unprotected and naming who to chase

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.152] — 2026-08-03 — Inventory tab: buttons flush with inputs · empty white space reclaimed

### Fixed (per the CEO's screenshot)

- **Button alignment:** the Add-item and Record-return buttons are now exactly the same height as the input boxes on desktop, so their bottoms sit truly flush with the field row — no more floating slightly above the line
- **Empty white space:**
  - When the inventory has **no items yet**, the bare table header followed by a blank block is replaced by a single compact line ("No items yet — add your first above…") — the card ends where its content ends
  - The Postage / Marketing pair no longer stretch to match each other's height — each card now **hugs its own content**, so the mostly-empty Marketing card stops padding the page with white
  - Table spacing tightened one step

### Deploy

- `pnpm build` → hard refresh only

## [1.4.151] — 2026-08-03 — Notification chime: race fix (no sound was ever playing)

### Fixed (CEO reported: no notification tone on web or mobile — a real v1.4.144 bug)

- **Root cause:** pressing 🔊 unlocked the audio context on finger-down, but unlocking is asynchronous — by the time the click handler tried to chime a few milliseconds later, the context still reported "suspended", and the safety guard silently swallowed the sound. The confirmation ding therefore never played on the first press, and depending on timing, poll-triggered chimes could be eaten the same way
- **Fix:** the chime now creates the audio context itself if needed and **awaits the resume before playing**. Pressed from the 🔊 toggle (a user gesture) it always sounds; fired from a background poll it sounds whenever any earlier tap has unlocked audio — same browser policy, no race. Older-Safari fallback added for the audio engine constructor
- **iPhone note (not a bug):** iOS mutes Web Audio when the **ringer switch is on silent** — the status bar in the CEO's own screenshot showed the mute icon. Flip the ringer on / volume up and the chime sounds on mobile too

### Deploy

- `pnpm build` → hard refresh, then tap 🔇→🔊 — the confirmation ding should now be audible immediately

## [1.4.150] — 2026-08-03 — Inventory forms: app-standard widths on web and mobile

### Fixed (per the CEO's screenshot: field widths inconsistent; must read as an app on both)

- Both Inventory forms — the **add-item row** and the **Supplier-returns form** — now follow one width standard:
  - **Phones:** a clean **2-up grid** with full-width fields (Item and Reason span the full row since they hold long text) and a **full-width action button** — the same app pattern as Quick actions and the Claims item cards. No more ragged wrapping or half-truncated fields
  - **Desktop:** the tidy inline row stays, with standardized column widths — the SKU box is wider so "must match TikTok" reads in full
- The subhead helper now accepts layout spans, so any future form row can reuse this exact pattern

### Deploy

- `pnpm build` → hard refresh only

## [1.4.149] — 2026-08-03 — Supplier returns: replacement outcome

### Added (CEO asked: what if the supplier does a replacement instead?)

- A supplier can now settle a return **two ways**, and the record follows either path:
  - **Credited** — money back (unchanged from v1.4.148)
  - **Replaced** — replacement goods arrive: press **Replaced** on the row, enter the qty received (blank = all remaining) → **that stock walks back onto the shelf automatically**, and the claim shrinks by the replaced value. **Partial deliveries accumulate** — the row shows "Outstanding (2/5 replaced)" until complete, then closes with a blue **Replaced** chip
- The summary strip now reads: Returned RM · Credited back RM · **Replaced in goods RM** · Outstanding RM — outstanding = returned − credited − replaced value, so the amber figure is always what's genuinely still owed, in money or goods
- Guards: can't replace more than remains; credited rows can't also be replaced (and vice versa); once any replacement is received the row becomes a permanent record (no delete — the stock has already moved). Audited (`inventory.supplier_return_replaced`)

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0042 + **0043**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.148] — 2026-08-03 — Supplier returns: rejected stock tracked for claim-back

### Added (CEO: rejected items returned to the supplier must be recorded, with the costing tracked to claim back)

- New **"Supplier returns — rejects to claim back"** card on the Inventory tab (migration **0042** `supplier_returns`):
  - **Record a return:** pick the item (unit cost auto-fills from the inventory price, adjustable to the actual purchase cost), qty rejected, supplier, return date, reason (e.g. stitching defect) → **stock is deducted immediately** (the goods left the shelf), and the record carries SKU + item-name snapshots so it stays meaningful even if the item changes later
  - **Costing summary strip:** Returned RM total · **Credited back** RM · **Outstanding RM** in amber — the outstanding figure is exactly what suppliers still owe the company
  - **Mark credited** with an inline amount box (blank = full amount) for partial refunds; credited rows become permanent records (green chip with the credited RM)
  - **Delete** (branded danger confirm) for mistaken entries — the stock walks back onto the shelf automatically; credited rows can't be deleted
  - Every action audited (`inventory.supplier_return` / `_credited` / `_deleted`); qty is guarded against exceeding current stock; a helpful `migration_missing` error names the 0042 command if the table isn't applied yet

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0042) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.147] — 2026-08-03 — Claims: present-month overview strip

### Added (CEO: "I want to see the overall of the claim submitted on the present month")

- A **summary strip** now sits at the top of the claims list showing the present month at a glance: **total count and RM**, then **Approved (count · RM) — of which paid (count · RM)**, **Pending (count · RM)** in amber, and **Rejected** in red when any exist
- Attribution follows the CEO's standing month rule: **by claim date** — so the strip's total lines up with the staff-claims figure on the Expenses tab for the same month (noted right on the strip)
- Scope matches the list below it: the CEO sees the whole company's month; each staff member sees their own. The strip hides itself when the month has no claims

### Deploy

- `pnpm build` → hard refresh only

## [1.4.146] — 2026-08-03 — Mobile fit: header on one row, tighter app rhythm

### Fixed (per the CEO's phone screenshot: too much scrolling, awkward)

- **The header no longer eats two rows on phones.** The avatar + screen title and all four controls (🔊, 🔔, theme, Sign out) now share **one compact row**: the controls shrink to app-sized buttons on mobile (back to full size on desktop), the avatar trims slightly, paddings tighten — roughly a full row of vertical space returned before any content
- **Quick actions become a 2-up grid on phones** — equal-width, thumb-friendly buttons (Clocked in / Clock out on one line, Apply leave / Create quotation on the next) instead of the ragged wrap; desktop keeps its inline row
- **Tighter mobile rhythm:** page top padding and card-to-card gaps reduced on phones only — the Dashboard now shows Quick actions, Pending leave, and My open tasks in the first viewport instead of forcing an immediate scroll
- Desktop is untouched — every change is mobile-breakpoint scoped

### Deploy

- `pnpm build` → hard refresh only

## [1.4.145] — 2026-08-03 — One-click payroll payment: 💳 bulk payment file

### Added (CEO asked how to pay payroll in one click)

- **"💳 Payment file"** button in Payroll processing (beside Recompute nets) and in the Expenses payroll due card. One click downloads `azoo-payroll-YYYY-MM.csv` — every saved entry with a positive net, each row carrying **employee full name (uppercase), bank, account number, amount, and the reference "AZOO SALARY MM-YYYY"**, plus a TOTAL row for cross-checking against the Expenses figure before approving
- **The flow:** press 💳 → upload the file to **Maybank2u Biz → Bulk Payment** → approve once → all staff paid in one transaction batch → press **Mark paid** on the Expenses card. Zero retyping of account numbers, zero one-by-one transfers
- Safety details: RM 0 rows are skipped (e.g. the CEO's own row); staff **missing bank details** are listed at the bottom of the file instead of silently dropped ("add in Staff Details, then re-download"); generation is audited (`payroll.payment_file` with payee count + total)
- **True API payouts** (money moves on the click itself, no bank portal) need a payout provider — Curlec or DuitNow corporate rails — which is a business onboarding with fees; the endpoint is designed so that step can slot in later without changing the flow

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.144] — 2026-08-03 — Notification alert sound 🔊

### Added (CEO asked: can we add an alert notification sound? Yes)

- A soft **two-tone chime** now plays whenever **new** notifications arrive at the bell — task assignments, claim/leave stage moves, announcements. Details that make it behave well:
  - **Synthesized in the browser** (Web Audio API) — a short rising A5→D6 ding, no audio file to download, instant
  - **Only on new arrivals:** it never sounds on page load, on opening the bell, or when the count shrinks from marking-as-read — strictly when the unread count increases during the 60-second polling / focus refresh
  - **🔊/🔇 toggle** in the header next to the bell — per-device preference, remembered (localStorage), and toggling ON plays the chime once as confirmation
  - **Browser autoplay rules respected:** browsers only permit audio after a user gesture, so the first tap/click anywhere unlocks the sound; anything arriving before that stays silent (the badge still updates)

### Deploy

- `pnpm build` → hard refresh only

## [1.4.143] — 2026-08-03 — Tab order revised · attendance headers aligned over the chips

### Changed

- **Tab order** revised to the CEO's new sequence — **Overview moves up to second place**, right after Dashboard: Dashboard → Overview → News → HR → Staff → Attendance → Leave → Tasks → Claims → Payroll → Expenses → Sales → Inventory → Birthdays → Profile → Users. Desktop pills, mobile bottom nav, and the More sheet all follow (they share one list)
- **Attendance column headers aligned:** the IN and OUT headers sat a chip-padding to the left of the actual times (the time chips carry their own internal padding). Both headers are now indented to sit exactly over the chip text, so DATE/IN/OUT/HOURS all read flush with their column content

### Deploy

- `pnpm build` → hard refresh only

## [1.4.142] — 2026-08-03 — Branded confirmation dialog replaces the browser popup

### Changed (per the CEO: "make this form standardize with my other card popup box. I dont like this type")

- The grey native browser `confirm()` box is gone from the portal. In its place: a **branded confirmation card** in the same visual family as the clock-in/save popups — card surface, rounded corners, gold accent bar, pop-in animation, dimmed backdrop, proper Cancel (ghost) and Confirm (navy) buttons. Tapping the backdrop cancels; the confirm button takes focus for Enter-key flow
- Applied to both portal confirmations:
  - **CEO chain-override approve** — "Approve past the incomplete chain?" with the audit-log note and an explicit "Approve as CEO" button
  - **Delete claim** — danger styling (red confirm button), stating the amount and that the receipt is removed too
- New shared component `components/ui/confirm-dialog.tsx` (`useConfirm()` hook, promise-based like the toasts) — any future confirmation uses the same card. The one remaining native confirm (admin Suspend, inside /admin) rides with the already-deferred /admin toast sweep

### Deploy

- `pnpm build` → hard refresh only

## [1.4.141] — 2026-08-03 — App-style profile avatar in the portal header

### Added (per the CEO's request: badge photo beside the welcome, nice on web and mobile)

- The staff member's **badge-card photo** now renders as a circular, gold-ringed **avatar in the portal header** — sized like a native app profile chip (40px, 44px on desktop):
  - **Desktop:** avatar sits beside "STAFF PORTAL / Welcome, {name}"
  - **Mobile:** avatar sits beside the screen title in the sticky app-style header — the same placement messaging apps use, so it reads instantly as "my profile"
  - **No photo yet?** A branded fallback: the person's initial in a navy circle with the same gold ring, so the header never looks broken while HR hasn't uploaded a photo
- Plumbing: the session lookup now carries `photo_key`, so `/auth/me` gives the header what it needs; the image itself serves through the existing authenticated media route (staff-only for private/ keys) — no new endpoints, no extra requests beyond one cached image

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.140] — 2026-08-03 — Attendance: "still in" styled as a chip

### Fixed

- "still in" no longer sits as plain outline text next to the styled time chips — it's now a **blue pill badge**, matching the visual language of the IN (green) and OUT (grey) time chips; "missing" likewise becomes an **amber pill**. The whole attendance row now reads as one consistent set of badges

### Deploy

- `pnpm build` → hard refresh only

## [1.4.139] — 2026-08-03 — Subheads completed across the remaining tabs · rows aligned

### Changed

- The v1.4.135 subhead pattern now covers the tabs it had missed:
  - **Leave — Apply for leave:** Leave type, Start date, End date, Days (0.5 = half day), Reason
  - **Tasks — Create a task:** Title, Description, Assign to (managers), Priority, Deadline
  - **Sales — Add customer:** Company *, Contact person, Phone, Email
  - **Inventory — add item:** SKU (placeholder now reminds "must match TikTok"), Item name, Opening stock, Price/unit (RM)
  - **Postage tracking:** Order reference, Courier, Tracking no.
  - **Marketing materials:** Material needed
- **Alignment fixed:** mixed-height rows (e.g. the Inventory add row where the Add-item button sat beside label-less boxes) use bottom alignment, so buttons and inputs line up under their subheads instead of floating mid-row. Placeholders across these forms now show examples/formats (e.g. J&T, Pos Laju · MY123456789 · +60 12-345 6789) rather than repeating the label

### Deploy

- `pnpm build` → hard refresh only

## [1.4.138] — 2026-08-03 — High-resolution signature scans installed

### Changed (assets)

- The CCO, HR Admin, and Sales & Marketing signatures are replaced with the **high-resolution scans** the CEO provided (591×389 / 737×399 / 737×460 after background removal and ink-trimming — versus the ~150px first versions), matching the CEO/COO source quality. Same processing pipeline: near-white → transparent, trimmed to ink
- No code changes — the standardized 46px signature box from v1.4.137 now simply renders from crisp sources, so all five signatures print sharp and equally weighted on the claim form and the Leave Application Form

### Deploy

- `pnpm build` → hard refresh

## [1.4.137] — 2026-08-03 — Signatures standardized · staff signatures on the Employee cell

### Fixed (per the CEO's printout)

- **All printed signatures now occupy the same standardized box** (46px tall, up to 150px wide, ink fitted left) — the CCO's signature no longer prints tiny next to the CEO's. Every signature source is also **trimmed to its ink** (transparent borders removed), so the five files render at comparable visual weight regardless of how each was scanned. Applied to the claim form and the Leave Application Form alike

### Changed — Employee cell uses the staff member's real signature

- When the claimant's/applicant's **role has an uploaded signature** (CEO, COO, CCO, HR Admin, Sales & Marketing), the Employee cell prints **that signature** with the "(submitted in system)" note — Nursyazwani's forms will carry the HR Admin stamp-signature rather than the script-font e-signature. Roles without an uploaded signature (editor, marketing, live host) keep the script e-signature fallback

### Deploy

- `pnpm build` → hard refresh only

## [1.4.136] — 2026-08-03 — Official signatures installed: CCO, HR Admin, Sales & Marketing

### Added (assets)

- The three uploaded company-stamped signatures are processed (near-white background made transparent, matching the CEO/COO treatment) and installed:
  - `public/signatures/cco-sign.png` — **live immediately**: the CCO's pre-approval signature now prints on claim forms and Leave Application Forms wherever the CCO pre-approved (the code has referenced this path since v1.4.133/134 with a graceful fallback — the file's arrival completes it)
  - `public/signatures/hr-admin-sign.png` and `public/signatures/sales-marketing-sign.png` — stored ready under the same naming scheme, not yet wired to any printed document (the claim/leave forms have no HR signature cell, and sales documents currently carry CEO/COO authority only)

### Deploy

- `pnpm build` → hard refresh (static assets ship with the build)

## [1.4.135] — 2026-08-03 — Subheads above every placeholder field

### Changed

- **Placeholder-only inputs now carry a small subhead label above the box**, so the field's purpose stays visible after typing (a placeholder disappears the moment text is entered — that's why forms felt confusing once half-filled). Placeholders now show the FORMAT or an example instead of repeating the label. Applied to:
  - **Add a staff member** (Staff tab): all 14 fields labeled — Company email, Full name (as per NRIC), Role, Employee ID, Position, Department, Birth date, ID issued on, Blood type, NRIC, Bank, Bank account no., Temp password, Staff photo — with example placeholders (e.g. AZOOM001, 970209-01-5183, DD-MM-YYYY)
  - **Record expense** (Expenses tab): Expense date, Category, Amount (RM), Vendor, Description
  - **Submit a claim**: Purpose gains its subhead (item fields already carry labels — the column header row on desktop, per-field labels on mobile since v1.4.132)
- One shared visual: 11px muted label, half-line gap, above the control — consistent across the portal

### Deploy

- `pnpm build` → hard refresh only

## [1.4.134] — 2026-08-03 — Attendance "still in" vs "missing" · printable Leave Application Form

### Fixed (My attendance)

- The Out column no longer lumps everything into "still in / missing": with a clock-in and no clock-out it reads **"still in"** (normal mid-day state); **"missing"** (amber) shows only when there is genuinely **no clock-in data** for the day

### Added — Leave Application Form (AZOO-HR-LVE-001)

- Every leave request now has a **"Print form"** link producing a branded A4 form in the same layout language as the claim form, driven by the same chain flow leave already follows (HR review → COO/CCO pre-approve → CEO final):
  - Header: Document No **AZOO-HR-LVE-001**, Leave No **LVE-AZOO{DDMMYY}-{running no.}**, submission date/time in **MYT**, employee, department, position, leave type, period, days, reason
  - **System status** line (approved green / rejected red / pending with the current stage) plus the chain notes ("HR reviewed by … · Pre-approved by …", MYT-stamped)
  - **Three signature cells, same rules as claims:** Employee auto-filled (name, e-signature "(submitted in system)", submission date), pre-approver's full name + signature (COO's PNG; CCO's once `cco-sign.png` is uploaded) + pre-approval date, CEO full name + signature + date on final approval — all aligned on the shared baselines, footer pinned to the A4 bottom, one page
- Server: the leave list now carries the chain actors' identities and a per-day sequence for the numbering

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.133] — 2026-08-03 — Claim delete · new categories · all three signature cells filled · CCO receipt access fixed

### Added

- **Delete on invalid claims:** the claimant can delete their own claim while it's **pending or rejected** ("Delete" with a confirm dialog; the receipt file is removed too, audited `claim.delete`). Approved/paid claims are permanent records — the server refuses their deletion outright
- **Claim categories:** += **client meeting** and **stationery**
- **Employee cell now fills itself:** Name, an e-signature (the claimant's name in script with _"(submitted in system)"_), and Date = the submission date/time in MYT — the printed form no longer has an empty employee block for a claim the system itself recorded
- **COO/CCO pre-approval cell fills on pre-approval:** the pre-approver's **full name** (uppercase), their **signature** (COO's PNG; CCO's loads from /signatures/cco-sign.png once you upload it — hidden gracefully until then), and the **pre-approval date/time in MYT**. Pending-chain claims keep the blank manual cell

### Fixed

- **The raw `{"error":"forbidden","message":"Not your claim"}` page** (Izzudin/CCO opening a receipt link): receipt visibility now mirrors claim-list visibility — anyone who can see the claim in their list (chain reviewers included: HR for staff-chain, COO for staff-chain, CCO for HR's claims) can open its receipt, instead of only claimant + CEO + HR

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Optional: upload CCO signature PNG to `public/signatures/cco-sign.png` (transparent, like the CEO/COO ones) for the CCO's pre-approval signature to print

## [1.4.132] — 2026-08-03 — Claims tab: proper mobile "app" layout

### Fixed

- On phones the claim form used the same fixed five-column grid as desktop — the Description box crushed to a sliver and nothing fit, unlike the other tabs' app-style layouts. Each claim item now **stacks on mobile** inside a light card: **Date and Category side by side, Description full width, Amount below**, each with its own small label (the desktop column-header row hides on mobile since the fields label themselves), and "✕ Remove" as a proper labeled control. From tablet width up, the original five-column grid returns unchanged
- The **Attach receipt** and **Submit claim** buttons go full-width on mobile, matching the app feel of the rest of the portal

### Deploy

- `pnpm build` → hard refresh only

## [1.4.131] — 2026-08-03 — One-click server-side repair: 🔧 Fix discrepancy now

### What the identical screenshot proved

- The Breakdown was **byte-for-byte the same** as before the last fixes — same RM 5,458.98, every row still "recomputed ⚠", same three stale amounts. The server data hadn't changed at all, which means the fix chain (migration 0041 → worker deploy → build → Save all) **hasn't completed on production**. The code fixes are correct but were never given a chance to run

### The solution — stop depending on the sequence

- **New: `POST /payroll/recompute`** — a server-side repair that recomputes the month's working days **directly from the holiday calendar** (Mon–Fri minus weekday holidays) and re-derives + **stores** every entry's `month_working_days` and `net_cents` using the shared formula. No browser state, no Save all, no fingerprints — the database fixes itself in one call. Audited (`payroll.recompute`)
- **Two buttons trigger it:** "🔧 Fix discrepancy now (recompute on server)" right inside the Expenses Breakdown (where the problem shows), and "🔧 Recompute nets" in Payroll processing next to Re-fill days
- If migration 0041 isn't applied, the button says so explicitly ("Migration 0041 is not applied — run: npx wrangler d1 migrations apply azoneofficial --remote, then press this button again") instead of failing quietly

### The single remaining sequence

1. `npx wrangler d1 migrations apply azoneofficial --remote` (0040 + 0041)
2. `npx wrangler deploy` → `pnpm build` → hard refresh
3. Open Expenses → Breakdown → press **🔧 Fix discrepancy now** → the toast reports "Recomputed 6 entries at 23 working days" → figure becomes RM 5,345.54, all ⚠ markers gone, matching the Payroll tab exactly

### Deploy

- Migrations **0040 + 0041** → `npx wrangler deploy` → `pnpm build` → hard refresh → press the 🔧 button

## [1.4.130] — 2026-08-03 — Claim form repaired: the broken signature table

### Fixed (my v1.4.127 regression, reversed properly)

- v1.4.127 put `display: flex` **directly on the signature table's `<td>` cells** — which strips their table-cell behaviour, so the three columns collapsed into the stacked narrow mess in the CEO's printout, and the extra height pushed the receipt and footer onto page 2
- The `<td>`s are table cells again; the alignment flex now lives on an **inner wrapper div** inside each cell (`.cw`), which is where it always belonged. The intended v1.4.127 result now actually renders: three equal columns side by side, Name/Signature/Date on shared baselines, CEO signature + MYT date in place, everything — receipt and footer included — back on **one A4 page**
- Rule added to the standing lessons: never set flex/grid display on `<td>`/`<tr>` — wrap the content instead

### Deploy

- `pnpm build` → hard refresh only

## [1.4.129] — 2026-08-02 — P&L payroll column = NET payroll

### Changed

- The P&L's Payroll column previously used the **entry totals** (basic + commission + allowance + OT − manual deduction, WITHOUT the unpaid-leave and incomplete-month deductions) — which is why August showed RM 13,997.72 while the real net was RM 5,345.54. Per the CEO: confusing, gone
- The column is now **"Net payroll"** and pulls the **same figure as the Expenses card**: stored per-entry nets (net_cents from migration 0041; formula fallback for older rows), same staff scope, same cash-basis month attribution (month m−1's cycle paid in m). **P&L, Expenses, and the Payroll tab total now quote one number**
- Caption updated accordingly; failures degrade and log (`pnl_payroll`) rather than blanking the card

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration (0041 assumed applied)

## [1.4.128] — 2026-08-02 — THE tally bug, found by the Breakdown: Save all skipped calendar-affected rows

### Root cause (proven by the CEO's Breakdown screenshot)

- The Breakdown showed all six staff names — **no ghost entry** — but three rows (Izzudin RM 895.45, Nursyazwani RM 954.55, Zulsyam RM 859.09) differed from the Payroll tab by **exactly the 22-vs-23 working-days delta**: their saved rows still carried 22 days from before the Hari Hol correction
- Why Save all didn't fix them: the **no-change fingerprint didn't include the month's working days**. Rows the CEO hadn't otherwise edited (unlike Zolkefli's allowance and Nasuha's OT, which re-saved at 23) fingerprinted as "unchanged", so **Save all skipped them** — permanently preserving the stale 22, which only Expenses (reading saved data) revealed

### Fixed

- The fingerprint now includes the month's working days, and the pristine snapshot anchors on each row's **saved** month_working_days — so any holiday-calendar change marks every affected row dirty and **Save all re-saves all of them** (storing the corrected net_cents too). Full-month rows (no days entered) are mirrored correctly and don't false-flag

### After deploying

- Payroll 07-2026 → **Save all** → expect "6 entries saved" → Expenses payroll line reads **RM 5,345.54**, Breakdown shows all rows without ⚠, matching the tab line by line

### Deploy

- `pnpm build` → hard refresh → Payroll: **Save all** (migrations 0040+0041 + worker deploy assumed from v1.4.124/126)

## [1.4.127] — 2026-08-02 — Claim form: aligned signature grid · every printed time in Malaysia time

### Fixed

- **Malaysia time everywhere on the form.** Timestamps are stored in UTC in the database, and the form printed them raw — so an approval at 22:45 Malaysia time printed as "14:45". Every printed timestamp now converts to **MYT (+8)** and says so: the header Date, the "APPROVED IN SYSTEM … on DD-MM-YYYY HH:MM MYT" status line, and the CEO's Date under the signature. The system already detected Malaysia time internally (attendance, payroll cutoffs, audit views all shift +8) — the claim form printout was the gap, now closed
- **Signature columns aligned.** Each of the three cells now uses the same fixed internal grid: a name zone (sized for two-line names like MOHD ALIF FARHAN BIN NAZARUDIN), an identical signature zone (the CEO's PNG sits inside it without pushing anything), and **Date pinned to the same baseline in all three cells** — flex with margin-top:auto, per the house rule. Name, Signature and Date now line up straight across the row regardless of name length or signature presence

### Deploy

- `pnpm build` → hard refresh only

## [1.4.126] — 2026-08-02 — Payroll figure breakdown: mismatches now name themselves

### Added

- The Expenses "Staff payroll" line gains an expandable **Breakdown** — every saved entry the figure is built from, with the person's name and their saved net. Comparing it against the Payroll tab makes any mismatch self-diagnosing:
  - a **name in the breakdown that isn't in the Payroll tab** = a ghost entry (test account / out-of-scope user) inflating the figure
  - a **different amount** than the tab shows = that row hasn't been re-saved since editing
  - a **"recomputed ⚠" marker** = the row was saved before the net-storing update (v1.4.124) — the server recomputed it; press Save all to store the exact net

### Reminder — the tally sequence (v1.4.124 must be live first)

The two figures only converge after ALL of: migration **0041** applied remotely → `wrangler deploy` → `pnpm build` + hard refresh → **Payroll 07-2026: Save all**. The Payroll tab shows live on-screen values (e.g. the new RM 75 allowance and 1.5h OT); Expenses reads what was last SAVED — until Save all runs on the new build, they cannot match by design

### Deploy

- Migration **0041** (with 0040) → `npx wrangler deploy` → `pnpm build` → hard refresh → Payroll: **Save all** → check the Breakdown

## [1.4.125] — 2026-08-02 — Claim form: CEO full name + signature on approval · no CUT HERE · footer at page bottom

### Changed (printed claim form)

- **CEO cell uses the FULL name** (uppercase, matching the Employee cell) — from the deciding CEO's user record, no longer the short display name
- **CEO signature auto-inserts once approved:** on approved claims the CEO's official signature PNG prints in the Signature space, and **Date fills with the decision date** — matching the QT/DO/INV signing convention. Pending/rejected forms keep the blank signing space
- **✂ CUT HERE removed** — the receipt box now sits directly below the signatures
- **Footer pinned to the bottom of the A4 page** via the flex margin-top:auto pattern (the house rule — never absolute positioning), so the company/SSM line always sits at the true page bottom regardless of how many claim rows the form has

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.124] — 2026-08-02 — Expenses payroll figure now tallies with the Payroll tab (migration **0041**)

### Root cause of the discrepancy (full-file check done)

The Expenses card and the Payroll tab used the **same formula but different scope and different data freshness**:

1. **Scope:** `/expenses` summed EVERY saved payroll entry for the month — including entries belonging to users the Payroll tab doesn't list (disabled accounts, customer/super_admin roles, staff outside their employment window). Any such row silently inflated the Expenses figure
2. **Freshness:** the Payroll tab computes live from what's on screen; `/expenses` reads what was last SAVED — edits (e.g. the 22 → 23 working-days correction) diverge the two until Save all

### Fixed — single source of truth

- **Migration 0041:** `payroll_entries.net_cents` — the panel now computes each net once (the one shared formula) and **saves it with the entry**; `/expenses` **sums the stored nets** instead of re-deriving them. After Save all, the two figures are identical by construction
- `/expenses` now applies the **same staff scope as the Payroll tab**: active users only, no customer/super_admin, employment lifecycle window applied — out-of-scope entries can no longer leak into the total (rows saved before 0041 still fall back to the formula, same scope)
- The Payments-due line now says where its number comes from: _"sum of SAVED payslip nets — after any change in the Payroll tab, press Save all there so this figure matches"_

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0041**, with 0040 if not yet) → `npx wrangler deploy` → `pnpm build` → hard refresh → **Payroll 07-2026: Re-fill days → Save all** (stores the nets; the Expenses figure then equals the tab total exactly)

## [1.4.123] — 2026-08-02 — HR compilation card: Receipt link removed

### Changed

- The **"Receipt" link is removed** from HR's "Approved claims history — compilation" card — the claimant submits the **original physical receipt** to HR, so a digital printout isn't part of the compilation. Each row keeps exactly what HR files: **Print claim form** (which still includes the receipt image in its box, for cross-checking against the original) and **Payment proof** (the CEO's bank slip)
- Server-side read access is unchanged — the printed claim form embeds the receipt image, so the form keeps printing complete

### Deploy

- `pnpm build` → hard refresh only

## [1.4.122] — 2026-08-02 — Hari Hol not observed in July (migration **0040**) · payroll description corrected

### Fixed (avoids over-paying July's prorated slips)

- **Migration 0040 removes Hari Hol Almarhum Sultan Iskandar (21-07-2026) from the holiday calendar** — per the CEO, the team did NOT take it (most staff's first reporting day was 20-07); it will be replaced in August instead. July 2026 therefore counts **23 working days**, which makes every incomplete-month deduction slightly larger and correct (e.g. worked 5 of 23 instead of 5 of 22 — leaving it at 22 would over-pay all six prorated slips)
- **After applying, in Payroll processing: confirm the auto box shows 23 → press "Re-fill days" → "Save all"** — saved entries carry their own month_working_days, so they must be re-saved to pick up 23 before the 05-08-2026 payment run. Payslips then read "WORKED X OF 23 PAYABLE DAYS"
- **The August replacement:** when the replacement date is decided, add it in the HR holiday calendar (e.g. "Hari Hol — replacement day") — August's working-day count drops by one automatically, and if August payroll was already filled, Re-fill days + Save all there too

### Changed

- The Payroll processing description no longer hardcodes "July 2026 = 22". It now explains the rule generally — including exactly this case: an unobserved holiday must be deleted from its month (making that day count as working) and added on the actual replacement date, followed by Re-fill days + Save all so no slip keeps stale figures

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0040**) → `npx wrangler deploy` → `pnpm build` → hard refresh → Payroll: Re-fill days + Save all for 07-2026

## [1.4.121] — 2026-08-02 — HR's read-only approved-claims history for compilation

### Added

- **hr_admin now sees every CEO-approved claim** (including paid ones) in a dedicated card: **"Approved claims history — compilation"**. Strictly read-only — no edit, no approve/reject, no mark-paid, no attach — with exactly what HR needs for records: the claim number (CLM-AZOO…), claimant, amount, a **PAID {date}** or **payment due** chip, and three links per row: **Print claim form**, **Receipt**, and **Payment proof** (the CEO's bank slip)
- Server-side, the access is scoped precisely: HR's claim list gains approved claims only (pending/rejected claims of the exec chain remain invisible to HR as before); the receipt file is readable by HR **only for approved claims**; the payout proof is readable by HR (its existence already implies paid). All writes remain locked to the existing roles — claimant for receipts, CEO for decisions/payment/proof
- HR's own "My claims" list stays personal (their claims + their review queue) — the history lives in its own card so the compilation view never mixes with day-to-day work

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.120] — 2026-08-02 — Payslip: zero rows hidden · working days = clocked-in only

### Changed

- **"Working days" on the slip means one thing now: the clocked-in total.** The old "WORKING DAYS IN MONTH (MON–FRI LESS HOLIDAYS)" row was already removed in v1.4.118 — the screenshot showing it was a pre-rebuild print. What remained was the deduction note reusing the phrase; it now reads "INCOMPLETE MONTH (WORKED 5 OF 22 **PAYABLE DAYS**)" so the words "working days" belong solely to the clocked-in figure. (The 22 stays in the note because the incomplete-month formula you approved in v1.4.84 divides by the month's payable days — the note exists precisely so the math on the slip is self-explanatory)
- **Zero rows no longer print.** PUBLIC HOLIDAY, ANNUAL LEAVE, MEDICAL LEAVE, EMERGENCY LEAVE (PAID) and UNPAID LEAVE appear **only when they have data (> 0)** — a clean month shows just "WORKING DAYS (TOTAL CLOCKED IN)" plus the balances. The Public Holiday row itself stays (v1.4.119) — it simply hides when the count is zero

### Deploy

- `pnpm build` → hard refresh only

## [1.4.119] — 2026-08-02 — Public Holiday row restored

### Fixed (my misreading, reversed)

- v1.4.118 removed the payslip's **PUBLIC HOLIDAY** row after misreading the CEO's comment — "there is no public holiday" referred to the July FIGURE looking wrong, not the row itself. The row is **restored**. The v1.4.118 improvements stay: single "WORKING DAYS (TOTAL CLOCKED IN)" line, no duplicate Days-Present row
- Note on the July figure: the 1.00 shown comes from the seeded Johor calendar — **Hari Hol Almarhum Sultan Iskandar (31-07-2026)** from the official gazette. If the company does not observe it, delete that entry in the holidays calendar and the slip (and the working-days computation) will show 0 / 23 accordingly

### Deploy

- `pnpm build` → hard refresh only

## [1.4.118] — 2026-08-02 — Payslip Others simplified · CLM-AZOODDMMYY numbering · payout proof (migration **0039**)

### Payslip (Others column)

- Per the CEO: one line — **"WORKING DAYS (TOTAL CLOCKED IN)"** — showing the person's attended days from the clock-in data. The separate "DAYS PRESENT" row is removed (it duplicated the same figure), and the **"PUBLIC HOLIDAY" row is removed** entirely. The leave rows (annual/medical/emergency/unpaid) and balances stay; the deductions column still self-explains "WORKED X OF Y WORKING DAYS" where a shortfall applies

### Claim numbering

- Claim numbers now follow the company scheme: **CLM-AZOO{DDMMYY}-{running number that day}** (e.g. CLM-AZOO020826-1), matching the QT/DO/INV pattern — on the printed form's Claim No., the editing header, and everywhere the number shows. Computed from the creation date + that day's sequence; existing claims renumber consistently under the same rule

### Payout proof — the answer to "should I insert the receipt paid?"

- **Yes — and now you can.** After 💸 Mark paid, the CEO sees **"📎 Attach payment receipt (bank slip)"** on the claim (migration 0039: `payment_proof_key`): the transfer slip uploads (image/PDF, 8 MB cap), the claimant is bell-notified, and both the claimant and deciders get a **"View payment receipt (payout proof)"** link. The claim record then tells the whole story end to end: staff receipt in → approval chain → PAID + date → payout proof. Audited `claim.payment_proof`. (Binary route added to the JSON-parse exclusion list — the v1.4.115 lesson, applied)

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0039**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.117] — 2026-08-02 — Receipt attach resubmits a rejected claim · claim form fits ONE A4

### Changed (Claims)

- **Attaching a receipt to a REJECTED claim now resubmits it automatically.** The missing receipt was the reason for rejection — once it's attached the claim goes straight back to pending, the previous decision and any chain stamps are cleared, the first stage of the approval chain is notified ("Resubmitted with receipt"), and the staff member sees "Receipt attached — claim RESUBMITTED for approval". Audited `claim.resubmit` (via receipt_attach). "Edit & resubmit" remains for when the claim's content itself needs fixing
- The 📎 attach on a _pending_ claim behaves as before — attaches quietly without restarting anything

### Changed (printed claim form — one A4 page)

- The whole form **including the receipt** now fits a single A4 sheet: page margins 14mm → 9mm, tightened header/table/signature spacing (signature boxes 78 → 64px), receipt box capped at 72×58mm, and break-inside guards on the receipt box and footer so nothing spills onto a second page. All content — meta grid, up to 10 item rows, declaration, status line, three signatures, ✂ CUT HERE, receipt, footer — on page 1

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.116] — 2026-08-02 — "Hide" is a proper button

### Changed

- The Add-a-staff-member card's tiny underlined "hide" text link is now a real button — "**Hide form ▲**", bordered, h-8, hover state, sitting flush right of the card header — matching the "+ New staff record — show details" button that opens it

### Deploy

- `pnpm build` → hard refresh only

## [1.4.115] — 2026-08-02 — THE receipt bug, found and fixed

### Fixed (root cause of every failed receipt upload)

- `handleStaff` JSON-parses every POST body **except** the binary `/photo` route. The receipt route ends `/receipt`, so `request.json()` ran on the **binary image** first — the parse error was swallowed, but the read **consumed the request stream**, so the R2 upload received a disturbed/empty body and failed **every single time**, for every file, at any size. The `/receipt` route is now excluded from JSON pre-parsing exactly like `/photo`, and the handler explicitly refuses an empty body
- This was never a size problem and never a migration problem — my earlier diagnoses were wrong on this point, and the size popup/limits from v1.4.110 remain as genuine safeguards, but the upload itself was broken at the stream level since the claims module shipped. It works now: choose the file (via the form, Edit, or 📎 Attach receipt) and it lands in R2, ticks the ☑ checkbox, and prints on the form

### Deploy

- `npx wrangler deploy` → hard refresh (worker-only fix; run migrations 0037+0038 first if not yet applied — they're still required for the expenses/claims features)

## [1.4.114] — 2026-08-02 — Why the tab looked empty: unapplied migrations. Hardened + one-tap receipt attach

### Root cause (both complaints, one cause)

- v1.4.109–112 read columns/tables created by **migrations 0037 and 0038** (claims.paid_at, chain columns, payroll_payments). If those migrations are **not applied** on the remote D1, `/expenses` throws → the whole endpoint 500s → the tab renders EMPTY with no message (looks exactly like data loss), and claim **edit/resubmit** 500s too (blocking the attach-via-edit path). The data itself is untouched
- **Run this first:** `npx wrangler d1 migrations apply azoneofficial --remote` — then `npx wrangler deploy` → `pnpm build` → hard refresh

### Hardened (so this class of failure can never blank the tab again)

- `/expenses` and `/pnl` now **degrade instead of dying**: the new payroll-payment and claims lookups are individually guarded — if their tables/columns are missing, the core expense list still returns and the failure is written to the error log (`expenses_claims`, `expenses_payroll_paid`; visible in /admin → System health)
- A failed `/expenses` load now shows a **loud amber line** ("⚠ Server error — expenses could not be loaded…") instead of a silent empty list

### Added — 📎 one-tap "Attach receipt"

- Staff no longer need to edit the claim to add a missing receipt: their own pending/rejected claims without one show **📎 Attach receipt** directly on the row — pick the photo/PDF, it compresses, size-checks (8 MB popup with the WhatsApp tip on failure, including server refusals), uploads, and confirms "Receipt attached to your claim"

### Deploy

- **Migrations 0037 + 0038** → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.113] — 2026-08-02 — Clock-in-first flow with a popup

### Added

- **The punch flow is now enforced: clock IN first, then clock OUT.** Tapping "Clock out" without today's clock-in shows an instant popup — _"Clock in first — You haven't clocked in today — clock in first, then clock out at the end of your shift."_ — in the same animated toast style as the punch confirmations
- **Server-enforced too**, not just hidden in the UI: the worker refuses a clock-out with no clock-in on record for the day (HTTP 400 `no_clock_in`), so a stale tab or a direct API call can't create an out-without-in. If the server refusal fires (e.g. an old tab open since yesterday), the same popup shows rather than a quiet error line
- The one-in/one-out-per-day rule and all lateness/early-out classifications are unchanged

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.112] — 2026-08-02 — Month attribution rules set by the CEO

### The three rules, as stated

1. **July payroll counts in AUGUST** — this was already the design (the "Staff payroll — 07-2026" line lives inside the 08-2026 card and joins the August Total). What the screenshot exposed: the amount showed nothing because **July payroll hasn't been processed yet** — the figure comes from the Payroll tab's entries. The line now says so explicitly: _"(figure appears once 07-2026 payroll is processed in the Payroll tab — it counts in THIS month's total)"_
2. **Utilities and other expenses belong to the month they're recorded in** — already the behaviour: recording in August books to August; recurring items carry forward to each month's Payments due until recorded for that month. Unchanged
3. **Claims belong to the month their claim dates fall in (1st → month end)** — CHANGED from v1.4.109's paid-date basis: an **approved** claim now counts in the month of its claim date, whether the money has moved yet or not. The Expenses Total and the P&L Claims column both follow claim-date attribution ("+ staff claims RM X (N, by claim date)"). Payments due (approved-unpaid) and ✅ Payments completed (actual payment dates) keep tracking the cash movements separately

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.111] — 2026-08-02 — "Missing" expenses explained · News label on desktop

### Clarified (not a data loss)

- The Expenses tab shows **one month at a time** and defaults to the current month. On 02-08-2026 it opens on August — a fresh, empty month — while July's records sit safely under the **month picker** (top right). The empty state now says exactly that: _"No expenses recorded for this month. This tab shows ONE month at a time — earlier records (e.g. July) are under the month picker at the top right."_ Nothing was deleted; the DB and nightly backups are untouched

### Fixed

- The **desktop** nav pills and the More sheet rendered the raw tab key "Announcements" — only the mobile renderer had the "News" label. One shared `tabLabel()` now feeds every nav renderer, so **News** shows on desktop too (spotted on the CEO's screenshot)

### Deploy

- `pnpm build` → hard refresh only

## [1.4.110] — 2026-08-02 — Receipt-too-large popup with the WhatsApp fix

### Fixed

- Oversized receipt uploads previously **failed silently** — the claim went through and the staff member never knew the receipt didn't. Every failure path now speaks up

### Added

- **Clear size limit: 8 MB** (generous — receipts compress to ~200 KB), enforced in three layers with the same friendly message everywhere: _"Receipt too large — the maximum is 8 MB. Easy fix: send the photo to yourself on WhatsApp, save it from the chat back to your gallery (WhatsApp shrinks it a lot), then upload that copy."_
  1. **On file selection** — an oversized PDF (no client compression possible) or an extreme photo (>40 MB) is refused immediately with the popup, before any waiting
  2. **On submit** — photos are auto-compressed first (longest side 1600px, as since v1.4.76, typically 5–15× smaller); if one still exceeds 8 MB (e.g. iPhone HEIC that couldn't be decoded), the claim submits WITHOUT it and the popup says so, adding "then use Edit on your claim to attach it"
  3. **On the server** — a hard 8 MB cap (HTTP 413) with the same tip, so nothing oversized slips through by any route; a failed upload after a successful claim is now also reported instead of swallowed

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.109] — 2026-08-02 — Staff claims are expenses too

### Added (Expenses tab)

- **Paid staff claims now count in the month's expenses** — cash basis, consistent with the rest of the tab: a claim becomes an expense in the month the CEO presses 💸 Mark paid. The month **Total** includes them, with the breakdown reading "incl. staff payroll … + expenses … + staff claims RM X (N)"
- **Approved-but-unpaid claims appear under 💳 Payments due** — amount, "staff claim" chip, claimant name, approval date, and a DUE pill, with the instruction to pay the claimant then press Mark paid on the Claims tab
- **Paid claims join ✅ Payments completed** — 🧾 lines with claimant and payment date, included in the completed total

### Changed (Overview P&L)

- The 6-month P&L gains a **Claims column**: claims paid in each month now sit on the cost side alongside Expenses and Payroll, so Profit reflects them

### Repaired

- Restored two TypeScript type additions (`staff_payroll.paid_at`) that a v1.4.101 edit batch had asserted but never written to disk — without this the build would have failed on the Payments-completed code

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.108] — 2026-08-02 — Full registered address on the badge (and every printed footer)

### Changed

- The staff ID badge footer now carries the **full registered address** on two lines — "34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika," / "81200 Johor Bahru, Johor, Malaysia" — replacing the short "Setia Tropika, Johor Bahru, Malaysia"
- The same full address replaces the compact form on the **payslip footer** and the **claim form footer**, so every printed document now states the identical registered address as the QT/DO/INV and SOA. No compact variant remains anywhere

### Deploy

- `pnpm build` → hard refresh only (re-print badges to see it)

## [1.4.107] — 2026-08-02 — CEO override on the claim chain

### Changed

- **The CEO can approve directly, chain finished or not** — as the company's final authority, an incomplete chain no longer blocks the Approve button. But a bypass is never silent: the button asks for confirmation ("Approve anyway as CEO? The bypass will be recorded"), the claim's decision note gains "**CEO direct approval (HR review + COO pre-approval bypassed)**", and the audit log stores the skipped stages (`chain_override`). The normal flow is unchanged — stages still get notified, chips still show progress, and an approval after a completed chain records nothing extra
- Reject remains available at any point, as before

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.106] — 2026-08-02 — Role-based claim approval chains (migration **0038**)

### The chains (mirroring the leave approval chain)

- **marketing / sales_marketing / editor / live_host** → **HR review** → **COO pre-approval** → **CEO final approval**
- **hr_admin** → **CCO pre-approval** → **CEO final approval**
- **COO / CCO** → **CEO final approval** directly
- This also means **every staff role can now submit claims** (previously only hr_admin and above) — the Claims tab opens to editor/marketing/live_host/sales_marketing

### How it works

- On submission the **first stage is notified** (HR for staff claims, CCO for HR's claims, CEO otherwise) — no more everything landing straight on the CEO
- **HR** sees staff-chain claims in a Pending-approvals queue with **"✔ HR review OK — pass to COO"**; the COO is then notified and sees **"✔ Pre-approve — pass to CEO"**; the CCO gets the same button on hr_admin claims. No self-review — the server refuses reviewing your own claim
- Every pending claim shows a **chain progress chip**: "awaiting HR review" → "HR ✓ — awaiting COO" → "HR ✓ · COO ✓ — CEO next"
- The **CEO's Approve is gated server-side**: approving before the chain completes returns "HR review is still pending" / "COO (or CCO) pre-approval is still pending" — surfaced as a toast. **Reject stays available at any point** (no need to run a chain for a claim you can already see is wrong)
- **Editing/resubmitting restarts the chain**: v1.4.104's edit now clears the review + pre-approval stamps and notifies stage one again
- The printed claim form's System-status line adds **"HR reviewed by … · Pre-approved by …"** — matching its three signature boxes
- Audited: `claim.hr_review`, `claim.preapprove`; admin tier can backstop any stage

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0038**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.105] — 2026-08-02 — Format hints in every box · short labels

### Changed (Staff Details + phone fields everywhere)

- **Format examples now live inside the boxes** — an empty field shows exactly the shape HR/CEO/COO should type: NRIC "**YYMMDD-PB-#### · e.g. 970209-01-5183**", phone "**+60 12-345 6789**", Employee ID "e.g. AZOOM001", dates "DD-MM-YYYY · e.g. 09-02-1997", bank account "**numbers only** · e.g. 551100338444", blood type "e.g. O / A+ / B−", position/department examples
- **Labels shortened, as asked** — the long explanations no longer stretch the layout: "Effective end date (DD-MM-YYYY — resigned/terminated)" became "**End date (resign/terminate)**", "Re-joined on (DD-MM-YYYY — payroll resumes)" became "**Re-joined on**", and the date labels dropped their repeated (DD-MM-YYYY). The detail moved into the box placeholder and a **hover tooltip** (e.g. NRIC explains the YYMMDD-PB-#### parts; End date says payroll runs up to and including it)
- Phone hints standardized across tabs: Staff Details record + create form, **Profile** phone, and the Sales **customer** phone (which also feeds the WhatsApp reminder links — the +60 format there makes wa.me work first time)

### Deploy

- `pnpm build` → hard refresh only

## [1.4.104] — 2026-08-02 — Claim editing lifecycle: edit before approval · locked once approved · edit & resubmit after rejection

### Added

- **Before the CEO decides**: the claimant sees an **Edit** link on their own pending claim — it loads the claim back into the form ("Editing AZOO-CLM-0001 · cancel"), purpose and every item line prefilled; **Update claim** saves the changes (audited `claim.edit`) and the CEO is notified of the updated figures. A new receipt can be attached during the edit
- **Once approved (or paid): locked.** The worker refuses edits on approved claims outright — "Approved claims are locked — submit a new claim instead"
- **After a rejection**: the claim is no longer a dead end — the claimant sees **Edit & resubmit**, fixes the form, and **Resubmit for approval** sends it back to **pending**: the previous decision (decided-by, note) is cleared, the CEO is bell-notified _"Resubmitted after rejection awaiting your approval"_, and the cycle runs again (audited `claim.resubmit`). Receipt uploads are now also allowed on rejected claims so the missing proof can be added before resubmitting
- Only the **claimant themselves** can edit — checked server-side against the session, not just hidden in the UI

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.103] — 2026-08-02 — Receipt below the CUT HERE line

### Changed

- The printed receipt box now sits **below the ✂ CUT HERE line**, bottom right — the top section (the formal claim form with the Receipt ☑/☐ checkbox, details, signatures) can be cut and filed on its own, with the receipt on the detachable lower portion. The **Receipt checkbox stays in the meta grid** exactly as before, auto-ticking ☑ Yes / ☑ No from whether a receipt is attached — the form always states whether proof exists even after the halves are separated

### Deploy

- `pnpm build` → hard refresh only

## [1.4.102] — 2026-08-02 — Receipt prints on the claim form

### Added

- The staff-uploaded receipt now prints **on the Employee Claim Form itself** — a bordered "RECEIPT (UPLOADED BY STAFF)" box at the **bottom right**, above the ✂ CUT HERE line. The image is fetched fully (as a blob, with your session) **before** the print dialog opens and rendered at up to 80×78mm — clearly visible, never a half-loaded blank. Because compressed receipt photos can't be inlined when they're PDFs, a PDF receipt prints a note instead ("Receipt attached as PDF in the system — printed separately"); use View receipt to print that PDF on its own page. The receipt checkbox in the meta grid keeps auto-ticking as before
- The print window now opens immediately on the click (popup-blocker safe) with a brief "Preparing claim form…" while the receipt loads

### Deploy

- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)

## [1.4.101] — 2026-08-02 — The big one: full address · News · sales clarity · client money management · staff lifecycle · claim payments · payments completed · inventory pricing · birthdays everywhere · tab re-sort · Users tab · P&L (migration **0037**)

### Company address (portal / admin / account / documents)

- The full registered address — **34-02, Jalan Setia Tropika 1/1, Taman Setia Tropika, 81200 Johor Bahru, Johor** — now prints on the QT/DO/INV header and the new Statement of Account. (The public site's structured data already carried it; the payslip/claim-form footers keep the compact one-line form)

### Tabs

- **Re-sorted to the CEO's order**: Dashboard → News → HR → Staff Details → Attendance → Leave → _(Tasks — kept after Leave; task-only roles depend on it)_ → Claims → Payroll → Expenses → Sales → Inventory → Birthdays → Overview → Profile → **Users**
- **Announcements is now "News"** everywhere it displays (dashboard card, publish form, nav)
- **New Users tab** (super_admin / CEO / COO): read-only list of every staff account — proper-case name, email, role chip, employment status (with end/re-join dates), active/disabled — account management itself stays in /admin

### Sales

- **Walk-in mystery solved**: "🚶 Walk-in / general buyer" (dropdown) and "Walk-in Customer" (customer list) were the _same shared record_ — the list row is now hidden server-side, leaving only the dropdown option. One concept, one place
- **Sales person captures your login**: the default now reads "**Alif — me (auto from login)**" — it always recorded the logged-in creator; the label finally says so. All salesperson displays (dropdown, list, printed doc) use **first names**
- **Item description suggests from Inventory**: typing opens live suggestions (name · SKU · price); picking one **auto-fills the unit price** from inventory; free typing still works for items not stocked yet
- **Client money management**: **SOA button** per customer prints a branded Statement of Account (invoice list, paid/outstanding status, balance band, bank details); **⏳ aging card** buckets unpaid invoices 1–30/31–60/61–90/90+ days with a **WhatsApp reminder** link pre-written with the invoice number, amount and account number; **→ Invoice** button on quotations converts one-click (same items/customer/salesperson, fresh INV number, audited `doc.convert_qt_inv`)

### HR / Staff Details / Payroll

- **Names display in Proper Case across the tabs** (payroll, corrections, team report, birthdays, staff lists, claims, dropdowns) via a shared helper that keeps _bin/binti/a/l/a/p_ lowercase — formal printed documents (payslip, claim form, badge, signer block) deliberately stay uppercase
- **Staff Details creation form hidden** behind "+ New staff record — show details" (HR/CEO/COO click to reveal; minimalist by request)
- **Employment status** gains **Resigned** and **Terminated** (the DB already accepted them), plus two new dated fields (migration 0037): **Effective end date** and **Re-joined on**. Payroll follows the lifecycle: the person is processed **through the month of the effective date** (final salary via days worked, as the formula already does), disappears for the gap, and **returns from the re-join month**. Status chips on the staff list show "resigned · 15-09-2026" / "re-joined 01-11-2026"

### Claims

- After approval, the CEO can press **💸 Mark paid (money released)** — the claim shows a green **PAID + date** chip to the claimant (who is bell-notified), on top of the approved status. Audited `claim.paid`

### Expenses

- **Staff payroll gets its own Mark paid** button on the 💳 Payments-due line — pressing it clears the DUE pill (audited `payroll.paid`) and the payment moves to a new **✅ Payments completed** section listing everything released this month (payroll with its month + date, each paid expense with category/vendor/date) and the completed total

### Inventory

- **Price per unit (RM)** column (migration 0037: `unit_price_cents`): set it on creation or edit it inline in the table — it feeds the Sales item suggestions

### Birthdays

- Staff birthdays now appear on the **dashboard events calendar** (🎂 pink markers, legend entry, tap-day chip) with a **"🎂 Coming up"** strip for the next 30 days — and a new **09:00 MYT daily cron** bell-notifies every staff member on the day itself, so the team can prepare the celebration

### Overview

- **📊 P&L card** — last 6 months, month by month: TikTok + paid invoices (cash basis) against expenses + the payroll cycle paid in the month, with a green/red profit column. (Note: the P&L payroll column uses entry totals; the Expenses tab remains the exact net figure)

### Standardization

- Save popups: the portal already uses the animated SaveToast family everywhere; **/account now joins it** (enquiry confirmation). /admin keeps its inline confirmations for now — a full admin toast sweep is queued as its own pass. Mobile app-view (bottom nav + sticky app bar) was verified present on /portal, /admin and /account since v1.4.55

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0037**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.100] — 2026-08-02 — Documents list rows standardized

### Changed

- The Documents rows are re-laid: document info (number · customer · amount · date · sales person) on the left, growing to fill the row, and a single right-aligned **controls group** — PAID chip · status dropdown · Edit · PDF — every element the **same 28px height**, same rounding, consistent spacing, vertically centred. The chip no longer floats at a different height than the dropdown or the buttons, and on narrow screens the whole controls group wraps together as one unit instead of scattering
- The list date also drops the stray "00:00" (dates only), matching the printed documents

### Deploy

- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)

## [1.4.99] — 2026-08-02 — Official signature PNGs · signer name + position under the Authorised signature

### Changed

- **Your clean transparent PNGs replace the extracted ones**: `public/signatures/ceo-sign.png` and `coo-sign.png` are now the files you supplied (signature + AZ ONE OFFICIAL chop, properly cut), and the image prints larger (112px tall) so the chop is legible — the previous render was too small
- **Signer identity under the line, standardized on all three documents**: each signature block now reads — signature image → line → small caps label (_Authorised signature_ / _Delivered by_ / _Prepared by_) → **FULL NAME** in bold → **Position** → AZ ONE OFFICIAL. The worker returns the signer automatically: the **COO's full name and position on the COO's own documents, the CEO's on everything else** (pulled live from Staff Details `full_name` + `position`, so a title change updates every future print; sensible fallbacks if the position field is empty)

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Make sure your and the COO's **Position** fields are filled in Staff Details — that's what prints under the name

## [1.4.98] — 2026-08-02 — Maybank account on invoices · payment details + signature pinned to the page bottom (full A4, standardized)

### Added / Changed

- **Bank account on the invoice payment box**: A/C No **5516 2328 7032** (grouped for readability) joins Method · Bank (MAYBANK) · Name (AZ ONE OFFICIAL) — customers finally have the full transfer details on the document itself
- **Full-A4 layout, standardized across INV / QT / DO**: the printed page is now a flex column at full A4 height, and the bottom block — payment details + Authorised signature on invoices, the signature pairs on Delivery Orders and Quotations — is **pinned to the bottom of the page** with `margin-top:auto` (per the house rule: flex pinning, never absolute). Short documents no longer end mid-page; every document type shares the same structure: header → bill-to → items → totals → notes → bottom block at the page foot → footer line
- **Dates on printed documents show the date only** — "24-07-2026", not "24-07-2026 00:00" — in the meta box (Date / Valid until / Payment due), the ✔ PAID line, and the quotation validity sentence

### Deploy

- `pnpm build` → hard refresh only (frontend change; no worker deploy, no migration)

## [1.4.97] — 2026-08-02 — Documents list fixed · authorised signatures on QT/DO/INV · sales_marketing invoicing

### Fixed — why the Documents list stayed empty

- A stray fragment from a v1.4.93 automated edit had corrupted `printDoc`'s closing line and left the document-list type incomplete — depending on build settings this either broke the frontend build or the list rendering. The fragment is **removed and both types repaired**; additionally the list now refreshes **awaited** right after creation (the new document appears instantly), the Documents card gains a **Refresh** button, and any loading error is shown in amber instead of a silent "No documents yet." — so a problem can never masquerade as an empty list again. View + reprint: every row keeps its **Edit** and **PDF** buttons; PDF reprints any document at any time

### Added

- **Authorised signatures, auto-assigned** (from the two photos provided): both signatures were extracted to **transparent-background PNGs** (paper lighting normalised, black ink + blue AZ ONE OFFICIAL company chop preserved, cropped) at `public/signatures/ceo-sign.png` and `coo-sign.png`. The printed documents place the image above the signature line per your rule — **COO-created documents carry the COO's signature; documents created by CEO, CCO, HR admin or sales & marketing carry the CEO's** — on the Invoice's _Authorised signature_, the DO's _Delivered by_, and the Quotation's _Prepared by_ blocks. The worker returns the creator's role for the selection
- **sales_marketing can now create invoices**: added to the worker's finance permission and the Invoice option restored in their form, per instruction — with the signature rule above ensuring their documents still print under the CEO's authority

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. (If your previous `pnpm build` reported errors, the v1.4.93 fragment was the cause — this build is clean)

## [1.4.96] — 2026-08-02 — Delete item lines · the "Insufficient" invoice error fixed (CEO now in finance)

### Fixed — the "Insufficient rights" error, root cause

- The worker's **finance permission (invoice creation + mark-paid) omitted the CEO** while the form offered him the Invoice option — so the CEO himself was the one being refused. `finance` now includes **ceo** (super_admin, admin, hr_admin, coo, cco, ceo). The same mismatch showed Invoice to sales_marketing who would also be refused — the option is now hidden for them so the UI and the worker agree
- **Creating sales on their behalf — the intended flow**: sales & marketing staff create Quotations and Delivery Orders themselves; **Invoices are created by finance roles (you, COO, CCO, HR) with the "Sales person" dropdown attributing the sale** to whoever actually sold — exactly the on-their-behalf mechanism, and the documents list + printed doc credit them

### Added

- **✕ delete on sales item lines**: accidentally added lines can be removed (the ✕ appears whenever there's more than one line; the last line can't be deleted — a document needs at least one item)
- **Claims already had it** (as asked to check): each claim item row has carried a ✕ since the multi-item form shipped in v1.4.95, visible whenever there's more than one row

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration — then retry the same Tudung invoice as CEO; it will create, auto-open the PDF, and credit Zolkefli as sales person

## [1.4.95] — 2026-08-02 — Monthly KPI cycle (last month's result stays visible) · multi-item claims, minimalist

### Changed — KPI as a monthly cycle

- Targets were already **per-month**, so each new month starts fresh (an automatic reset) — what was missing was the cycle around it, now added: **last month's KPI result stays on the Sales Revenue card all month** as a motivation banner — 🏆 green _"Last month (07-2026): RM 18,540.00 of RM 15,000.00 — 124% TARGET HIT — keep the streak going!"_ or 📈 amber _"… — 62% — this month is the comeback."_ And **from the 25th onward**, if next month's target isn't set yet, leadership sees an ⏰ _"Month-end soon — set 09-2026's target before the 30th/31st"_ nudge with a one-click **Set next month's target** editor (same inline editor, posts to the next month). Once set, the card confirms "Next month's target already set"

### Changed — Claims, matching the paper form

- **Multi-item claims** (migration **0036**: `items` JSON on claims): one form now takes several expense lines — Date · Category · Description · Amount (RM) per row, **+ Add item** (up to 10), live **Total**, a **Purpose** field (prints on the form) — mirroring the AZOO-HR-CLM-001 details table. The stored total is the sum; the CEO's notification carries the total; old single-line claims keep working
- **Minimalist list, as asked**: claim rows collapse to one line — claimant · total · "3 items" (or category) chip · status · date · **Details ▾**. Expanding shows the purpose, each item line, the receipt link, Print claim form and the decision trail. Approve/Reject stay visible on pending rows without expanding
- The printed **AZOO-HR-CLM-001** now lists every item as its own row (blank rows pad to the form's minimum), with the grand total

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0036**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.94] — 2026-08-02 — "Nothing saved" fixed loudly · backdated invoices · document editing · PDF straight after create

### Fixed — why "Create with auto number" seemed to do nothing

- The form had **silent stops**: with "Choose customer…" still selected (or an empty item line) the button returned without a word, and a server error (e.g. **migration 0035 not yet applied** — the new salesperson column makes the insert fail until it runs) vanished equally silently. Now every stop speaks: amber toasts for "Choose a customer first (Walk-in counts)", "Every line needs an item description", "Enter a unit price (RM)", and any server error message; success shows a green toast with the new document number. **Run migration 0035 before testing** — that is very likely the actual reason yours didn't save

### Added

- **Backdated documents**: a "Document date (backdate allowed)" field (past dates only, capped at today) — an invoice for a payment received before this system existed carries its true date; with "Payment already received" ticked, a "Payment received date" field backdates `paid_at` too, so the revenue card books it in the correct month
- **Edit documents**: an **Edit** button on every row loads the document back into the form ("Editing INV-AZOO… · cancel"), lets you fix items, prices, discount, tax, customer, sales person or date, and **Update** recomputes totals — the document number NEVER changes, edits are audited (`doc.edit`), and invoice edits require finance rights just like invoice creation
- **PDF immediately**: after creating or updating, the print view opens by itself with the fresh figures — create → PDF in one motion, exactly the flow asked for

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (applies **0035** if not yet run) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.93] — 2026-08-02 — Professional KPI editor · sales form clarity + Sales person · walk-in repair

### Fixed (honesty note)

- The v1.4.91 walk-in patch was **partially lost before it was written to disk** (a scripting slip on my side): the "Payment received" checkbox and the create/reset logic shipped, but the customer dropdown never gained the walk-in option and the form state was missing its field — which is exactly why the Create document form felt confusing and un-submittable. Both are now properly in place and verified

### Changed

- **KPI target input**: the browser `prompt()` box is gone. "Set target" now opens a clean inline editor inside the KPI block — RM field, **Save target** button, Cancel, Esc to close — with the save-toast confirmation and an honest "No changes" when the figure is identical
- **Create document, readable**: every field is labelled — Document type · Customer (with **🚶 Walk-in / general buyer** for unidentified buyers) · **Sales person (who made this sale)** · Item / service description · Qty · **Unit price (RM)** · Discount (RM, optional) · Tax % (optional). Prices are typed in **RM now, not sen** (stored in sen underneath, so nothing else changes)
- **Sales person on every document** (migration **0035**: `salesperson_id`): a dropdown lists every staff member (CEO, COO, CCO, sales & marketing, marketing, HR — any staff role) with **"Me (default)"** preselected; the worker defaults to the creator when untouched. The documents list shows "· sales: <name>" and the printed QT/DO/INV carries a **Sales person** row in the meta box — you always know who sold. Backed by a new minimal `/staff-list` endpoint (id + name + role only; no phone/IC/bank/salary exposed)

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0035**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.92] — 2026-08-02 — Printable Employee Claim Form (AZOO-HR-CLM-001)

### Added

- Every claim in the Claims tab now has a **"Print claim form"** link producing the CEO's paper form as a print-ready PDF, matching the AZOO-HR-CLM-001 / Version 002 layout: branded header with gold bar and tagline, the meta grid (Document No · Version · Claim No `AZOO-CLM-0001` · Date · Employee · Department · Position · Purpose · Receipt ☑/☐, auto-ticked from whether a receipt is attached in-system), the Claim Details table with the claim's line plus blank rows for hand additions, **Total Claimed**, the declaration, and the three signature boxes — Employee / COO·CCO / CEO — with the employee's and deciding CEO's names pre-filled and space for wet-ink signatures. A **✂ CUT HERE** line and footer close it, A4 print CSS + mobile-friendly viewport like the sales documents
- **The system stays authoritative, as specified**: the form carries a coloured _System status_ line — green "APPROVED IN SYSTEM by <name> on <date>", red "REJECTED IN SYSTEM", or amber "PENDING SYSTEM APPROVAL" — so the paper copy always states that approval happens in the system and ink is for the record. `/claims` now returns the claimant's full name, position and department to fill the form

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration

## [1.4.91] — 2026-08-02 — Walk-in invoices · payroll amount inside the expenses total · expense editing

### Added

- **Invoice for an unidentified buyer**: the customer dropdown gains **"🚶 Walk-in / unidentified buyer"** — pick it and the invoice bills a shared "Walk-in Customer" record (created automatically the first time), so a received payment can always be invoiced even when you don't know who the buyer is. Paired with a new **"Payment already received (bank transfer)"** checkbox on invoice creation: tick it and the invoice is born **PAID** — stamped bank transfer, counted in revenue immediately, green chip and PAID stamp from the start. (If the buyer later identifies themselves, add them as a proper customer for the next document)
- **Staff payroll inside the expenses total**: the 💳 Payments-due payroll line now shows the actual amount (previous month's payroll, computed with the exact payslip formula — basic + commission + allowance + OT − deductions − unpaid leave − incomplete month), and the month's **Total** includes it with a breakdown: "incl. staff payroll RM 4,653.84 (07-2026) + expenses RM 2,140.00". Money out is finally one number
- **Edit expenses** (typo fixes): every recorded expense gains an **Edit** link — date, category, amount, vendor and description editable inline with Save/Cancel, honest "No changes" toast, audited `expense.update`. **Staff payroll is deliberately not editable here** — its figures live in the Payroll tab, exactly as specified

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration (0034 already covers everything)

## [1.4.90] — 2026-08-02 — Invoice payments (bank transfer) · true sales figure + KPI target · branded QT/DO/INV templates

### Added (migration **0034**: `payment_method`, `payment_ref`, `paid_at` on sales_documents + `sales_targets`)

- **Payment received, recorded properly**: marking an invoice **paid** now asks for the bank-transfer reference (optional), stamps method = bank transfer + the payment moment, and shows a green **PAID · bank transfer** chip on the document (hover for date + reference). Reverting to unpaid clears all of it
- **The correct sales figure**: the revenue card's Invoiced box now counts **payments received** — paid invoices, in the month the transfer landed — labelled "Invoiced (paid)", with **outstanding** (billed, unpaid) shown alongside. TikTok + paid invoices = a Total that is genuinely comparable with the Expenses tab, cash against cash
- **KPI sales target**: CEO/COO set a monthly target on the revenue card ("Set target" → RM figure, audited); everyone with revenue access sees a gold progress bar — % achieved, RM to go, green + 🎉 at 100%
- **Branded documents**: QT / DO / INV all print on a redesigned AZOO template — gold accent bar, navy header with tagline + SSM + Setia Tropika address + contact, doc meta box, gold-edged BILL TO / DELIVER TO card, striped item table with navy TOTAL band, and per-type blocks: **QT** validity + terms + Prepared/Accepted-by signature lines; **DO** Delivered-by / Received-in-good-order signatures; **INV** payment-details box (Bank transfer · MAYBANK · AZ ONE OFFICIAL, receipt-via-WhatsApp note) and a diagonal green **PAID** stamp once paid. Mobile-friendly: responsive on the phone screen, strict A4 when printed or saved to PDF — the PDF button works from the phone's share/print sheet
- Note for the CEO: the invoice payment box prints the bank + account name but **no account number yet** — send it over and it goes on the template

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0034**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.89] — 2026-08-02 — Payroll & payslip calendars follow the payroll cycle

### Changed

- **Both month pickers now open on the payroll-cycle month, exactly as specified**: a month's payroll runs until the 5th of the following month, so **until the 5th, Payroll processing and My payslip open on the PREVIOUS month** (today, 02-08: July — the cycle still in progress / the slip releasing on the 5th). **From the 5th, the present month takes over.** My payslip's month cap follows the same rule, so before the 5th staff can no longer even select the current month and meet a pointless "available next month" lock (the 08-2026 → 07-09-2026 screen goes away until August's cycle actually opens). Payroll processors can still navigate to any month manually

### Deploy

- `pnpm build` → publish → hard refresh. Frontend-only; no worker deploy, no migration

## [1.4.88] — 2026-08-02 — Recurring expenses, due dates & a Payments-due board

### Category guidance (as asked)

- **Internet (monthly bill)** → `utilities` — it's a utility service like water/electricity/phone
- **Printer on monthly rental/lease** → `equipment`; printer **ink, toner and paper** → `supplies`

### Added (migration **0033**: `recurring`, `due_day`, `paid_at` on expenses)

- **Monthly recurring** checkbox + **Due day** (1–31) on the expense form. A recurring expense recorded last month **automatically reappears this month** in a new **💳 Payments due** card — with its amount, due date and "↻ recurring" chip — until you press **Record for this month** (one click copies it into the month on its due date, keeping the recurrence)
- **Due tracking**: recorded expenses with a due day show an amber **DUE dd-mm** chip that turns red **OVERDUE** past the date; **Mark paid** stamps it (audited `expense.paid`) and flips the chip to green **PAID**
- **Payroll on the same board**: the Payments-due card leads with **Staff payroll** for the previous month — "Pay by 05-08-2026, 10:00 MYT" (the exact payslip-release moment, holidays respected) with a DUE/RELEASED status chip — so the biggest monthly commitment sits beside rent and internet where the CEO/COO plan payments

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0033**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then re-add your Mr Wing rent with "Monthly recurring" ticked and due day 18 — September will surface it by itself

## [1.4.87] — 2026-08-02 — Save toasts everywhere (with honest "No changes") · Expenses tab for CEO/COO

### Added

- **Save confirmation toast** — the same animated notification family as clock-in (centred card, ring draw, tick) now confirms saves, and when nothing actually changed it shows an amber **"No changes"** with an "i" instead of pretending to work. Shared component (`components/ui/save-toast.tsx`); wired with REAL change-detection into:
  - **Payroll**: row Save (per-person, compares against the loaded snapshot), **Save all** (skips unchanged rows, reports "Saved — N entries" or "No changes"), **Base salaries** ("updated for N staff" / "already match")
  - **Staff Details**: record Save ("Saved — <name>" / "No changes — nothing to save")
  - **Attendance corrections**: row Save ("record updated" / "time unchanged") and Add/Remove
  - **Profile**: phone Save ("updated" / "unchanged")
  - Claims submit, event add and expense add show success toasts (forms are always changes by nature)
- **Expenses tab** (migration **0032**, `expenses`) for **CEO and COO** (+admin tier): record company operating costs — date, category (rent / utilities / software / marketing / equipment / logistics / supplies / other), amount, vendor, description — with a month filter and month TOTAL; audited (`expense.create/delete`). Clarified in-app: **Expenses ≠ Claims** — Claims are staff reimbursements routed to the CEO for approval (that tab already existed); Expenses are what the company itself pays

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0032**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.86] — 2026-08-02 — My payslip: future months no longer selectable

### Fixed

- The month picker on **My payslip** allowed choosing months in advance (September while it's August) and then showed a lock card for a payslip that cannot exist yet — an incorrect flow, as the CEO flagged. The picker is now capped at the **current month** (`max`), floored at the person's **joining month** (`min`), and the value is clamped in code as well, since some browsers render `max` but still allow typing past it. Past months behave exactly as before: visible once released, 🔒 otherwise

### Deploy

- `pnpm build` → publish → hard refresh. Frontend-only; no worker deploy, no migration

## [1.4.85] — 2026-08-02 — Overtime in Payroll

### Added

- **OT (hrs) column** in Payroll (migration **0031**: `ot_hours` + `ot_cents` on the entry): enter the month's overtime hours (halves allowed) and the amount computes itself at the **Employment Act normal-working-day rate — 1.5 × hourly ORP**, where hourly ORP = monthly wage ÷ 26 ÷ 8. The computed RM shows live under the hours box, NET and the TOTAL row include it, and both the hours and the computed sen are stored so the slip reproduces the figure forever
- **Payslip**: EARNINGS gains `OVERTIME (H HRS × 1.5 × HOURLY ORP)`; gross, TOTAL and NETT include it; the staff self-view summary shows OT too
- Scope note: 1.5× covers OT on **normal working days**. Rest-day (2.0×) and public-holiday (3.0×) OT rates exist in the Act — if live sessions start landing on those days, say the word and the column grows the rate split

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0031**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.84] — 2026-08-02 — Working days computed truthfully · one-pass payroll flow (proper HRM behaviour)

### The "26 days" problem, resolved

- The CEO is right that Mon–Fri staff will dispute "5 OF 26 DAYS": **26 is NOT the month's working days** — it's the Employment Act's fixed statutory divisor (1/26 of monthly wages per day) that applies ONLY to the unpaid-leave rate. The month's real working days for a Mon–Fri company are computed: **weekdays minus every calendar holiday** — July 2026 = 23 weekdays − Hari Hol (21-07) = **22**. The two numbers now never masquerade as each other:
  - Payslip deduction line reads `UNPAID LEAVE (N DAYS × 1/26 MONTHLY WAGE)` — the statutory rate named explicitly
  - Incomplete-month line reads `INCOMPLETE MONTH (WORKED 5 OF 22 WORKING DAYS)` — the true count
  - OTHERS box now opens with `WORKING DAYS IN MONTH (MON–FRI LESS HOLIDAYS): 22` and `DAYS PRESENT (CLOCKED IN): 5` — the slip explains its own arithmetic, which is the dispute prevention
- Consequence: July nets computed on the honest 22-day basis change slightly (Izzudin 5/22 → net RM 895.45, not RM 773.08) — the previous figures silently under-paid against a Mon–Fri interpretation, exactly the dispute risk being closed

### One-pass payroll (no more one-by-one)

- **Everything auto-fills on opening the month**: Basic from base salaries (v1.4.78) · **Working days (auto)** computed by the server from the calendar · **days worked auto-filled from attendance** (saved values always win; staff with zero punches stay blank = full month, so a non-punching account is never silently zeroed). Flow is now: open month → glance → **Save all** → payslips correct → auto-release on the 5th
- "Auto days from clock-ins" relabelled **Re-fill days** (it now only re-overwrites manual edits); **Save all was already there** and remains the single-click save
- Still deliberately absent, as specified: **no KWSP/SOCSO/EIS** lines — registration pending; the payslip structure gains them the day it lands

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No migration. Then open July: working days shows 22, days are pre-filled, press **Save all** once and reprint

## [1.4.83] — 2026-08-02 — Payslip lock now applies to EVERYONE, no processor bypass

### Fixed

- **Why the CEO still saw "My payslip" before the 5th**: v1.4.80 deliberately let payroll processors (CEO/COO/admin tier) bypass the lock on the reasoning that they type the figures anyway. Per the CEO's correction, that exception is **removed** — "My payslip" is now locked for every account, processors included, until the 5th-of-next-month 10:00 MYT moment (or a manual "Release now"). One uniform rule, no early view for anyone
- Unavoidable and stated plainly: the **Payroll processing tab** still shows figures to processors before release — they are the ones entering them. The lock governs the payslip view; the processing tab is already restricted to ceo/coo/admin tier only

### Deploy

- `npx wrangler deploy` → hard refresh. No frontend rebuild strictly required (worker-only change), no migration

## [1.4.82] — 2026-08-02 — Payroll logic correction: full basic + explicit incomplete-month deduction

### The logic review (done before touching code, as requested)

1. The old **Prorate button OVERWROTE Basic** with the reduced figure — the slip then presented RM 673.08 as if it were Izzudin's salary. Money was right, presentation was wrong/unfair
2. The reduced basic wasn't reproducible later (days weren't stored), so a payslip printed next month couldn't show WHY the figure was small
3. **Double-deduction risk found and closed**: unpaid leave already deducts at basic ÷ 26 (v1.4.79); if the incomplete-month adjustment also counted those same missing days, one day would be deducted twice. The formula now excludes unpaid-leave days from the adjustment
4. The panel's NET column ignored the unpaid-leave auto-deduction (slip and table disagreed since v1.4.79) — now every surface uses ONE shared formula
5. Blank days box previously risked being read as 0 days → full deduction; blank now explicitly means "full month, no adjustment"

### Changed

- **One formula everywhere** (`incompleteMonthAdj`, migration **0030** persists `worked_days` + `month_working_days` on the entry): missing = workingDays − workedDays; adjustable = missing − unpaidLeaveDays (never negative); **adjustment = FULL basic × adjustable ÷ workingDays**. Net = basic + commission + allowance − manual deduction − unpaid leave − adjustment. Same net as before (RM 3,500 × 5⁄26 = RM 673.08 either way) — but the payslip now shows **BASIC PAY 3,500.00** and **INCOMPLETE MONTH (5 OF 26 DAYS WORKED) 2,826.92** instead of a shrunken basic
- **Prorate / Prorate all buttons removed** (they were the bug). Flow now: set working days → Auto days from clock-ins → review → Save all; NET updates live and shows "−RM … auto" in red under it when auto-deductions apply
- **Fixing July's already-prorated rows**: a **"Base"** button appears on any row whose Basic differs from the fixed base salary — one click restores the full figure, then set days and Save
- Table NET, footer TOTAL, staff "My payslip" summary and the printed slip all agree by construction now

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0030**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then in July: click **Base** on each shrunken row, confirm the days boxes, Save all, reprint payslips

## [1.4.81] — 2026-08-02 — Johor public holidays on the events calendar · auto-replacement rule

### Added

- **Johor 2026 public holidays seeded** (migration **0029**) from the official state gazette (johor.gov.my, circular 10 Dec 2025): all 18 gazetted days — Thaipusam through Hari Krismas — plus replacement days per **company policy: a holiday on Saturday or Sunday is replaced on Monday, or the next free working day when Monday is itself a holiday** (2026 replacements: 02-02 Thaipusam, 24-03 + 25-03 Hari Raya Puasa I & II, 02-06 Wesak, 09-11 Deepavali). Honest note: the official state rule replaces **Sundays only** (Saturdays are not replaced by the gazette) — the company rule as specified is more generous; delete a Saturday replacement row in HR → holidays to follow the gazette instead
- **Calendar shows holidays**: red date number, red name chip on desktop / red dot on phones, "Public holiday" in the legend, and the tap-day agenda shows 🏖 with the holiday's name. Everyone sees them — awareness solved
- **Auto-replacement on create**: adding a public holiday that lands on Sat/Sun now auto-creates "<name> (Replacement)" on the computed day, audit-logged. **Manual creation already existed** (as asked to check): HR → "Public holidays & company calendar" has had an Add form with kind = replacement since v1.4.16 — it now sits alongside the automatic rule, and Remove deletes any row

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0029**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.80] — 2026-08-02 — Click-to-sort table headers · payslip release control (5th, 10:00 MYT)

### Changed

- **Sorting moved into the table headers** on the attendance corrections table (Staff · Type · Time (MYT) · Mark) and the Team report (Staff · Type · Time): click a header to sort ▲, click again to reverse ▼; combines with the Find-staff filter; the separate Sort dropdowns are gone. Default remains chronological until a header is clicked

### Added

- **Payslip release control** (migration **0028**, `payslip_releases`): staff can view a month's payslip only from the **5th of the following month at 10:00 MYT** (July payroll → visible 05-08-2026 10:00). If the 5th lands on a **weekend or public holiday, the release shifts FORWARD to the next working day** — never earlier, per the requirement that staff must not learn salaries early. For those cases (or any early release the CEO chooses), Payroll shows the month's release status and a **"Release now"** action (payroll processors only, one-way, audited `payroll.release`). Before release, "My payslip" shows a 🔒 lock card with the exact availability date-time; payroll processors bypass the lock (they set the figures). Months already past their release moment stay visible as normal

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0028**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.79] — 2026-08-02 — Unpaid leave shows as an explicit payslip deduction · emergency leave confirmed paid

### Changed

- **Unpaid leave now appears ON the payslip as its own deduction line** — `UNPAID LEAVE (N DAYS)` in the DEDUCTIONS box, computed automatically from approved unpaid-leave requests at **basic ÷ 26 per day** (the Employment Act 1955 s.60I ordinary-rate divisor; uses the fixed base salary, falling back to the month's saved basic). Basic stays FULL and the slip shows exactly why nett pay is lower — the fairness the old silent proration lacked. The manual Deduction field's line is relabelled **LATE / OTHER DEDUCTION**; the deductions TOTAL and NETT PAY include both. Applies to processor prints and every staff member's own "My payslip" identically
- **Emergency leave stays PAID and is never deducted** — shown in OTHERS as `EMERGENCY LEAVE (PAID)` with the month's count, alongside a new UNPAID LEAVE day-count row. Legal position: the Employment Act 1955 has **no "emergency leave" category** — it's company practice, most commonly paid against its own small entitlement (ours: 3 days/year) or taken from annual leave; there is no statutory obligation either way, so the 3-day paid policy is a company decision (worth confirming in the employee handbook the lawyer reviews)
- **Payroll panel**: rows with approved unpaid leave show a red **UL:N** flag warning that the payslip deducts it automatically — keep Basic full, don't deduct again (double-punishment guard); header caption updated. `/payroll/attendance-days` now also returns unpaid-leave day counts

### Deploy

- `npx wrangler deploy` → `pnpm build` → hard refresh. No new migration (uses 0027's base salary)

## [1.4.78] — 2026-08-02 — Fixed base salaries (no more monthly retyping) · staff finder on attendance

### Added

- **Base salaries** (migration **0027**: `users.base_salary_cents`): each staff member now has a fixed monthly basic. Every new payroll month **auto-fills Basic from it** — nothing to retype. A **"Base salaries"** button in Payroll opens the editor (one RM figure per person, Save writes only what changed, audited `payroll.base_update`). **Increments happen there**: change the figure once and it applies from the next unsaved month onward — months already saved keep exactly what was saved (history never rewrites itself). Any single month can still be overridden by editing Basic in the table as before (prorating, unpaid days, etc.)
- **"Find staff" filter** on both attendance views: the corrections & back-entry table gains a staff dropdown (from the same list as Add record) showing one person's punches only, with a clear "no records this month" line; the Team report gains the same filter built from the month's names. Both combine with the existing A–Z sort — pick a person, see their whole month in seconds

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0027**) → `npx wrangler deploy` → `pnpm build` → hard refresh. Then open Payroll → Base salaries and enter each person's fixed basic once

## [1.4.77] — 2026-08-02 — Payroll days auto-calculated from clock-ins · Attendance redesigned · Details toggle right-aligned

### Added

- **Payroll ⇄ Attendance auto-calculation**: new `GET /payroll/attendance-days` counts each person's distinct clock-in days for the month (MYT). In Payroll: **"Auto days from clock-ins"** fills every days box in one press, a small **⏱N** beside each box always shows the recorded count, and **"Prorate all"** applies Basic × days ÷ working days to every row at once. The days boxes stay fully editable — that is the manual-correction path for wrong or dishonest punches — and the permanent fix is Attendance → corrections & back-entry, where every amendment is marked and audit-logged. Flow: set working days → Auto days → review/adjust → Prorate all → Save all

### Changed

- **Attendance tab redesigned**: personal view is now a real report — one row per DAY (Date | In | Out | Hours), green In chips, first-in→last-out hour counting, "still in / missing" flag for open days, and a footer totalling days + hours for the month (payroll cross-check at a glance). Team report is now a proper table (Staff | In/Out chip | Time) with the sort control, and the month picker + controls live in the card header instead of floating above it
- **Staff Details**: the Details ▾ / Hide details ▴ toggle moved to the RIGHT end of the button row, as requested
- Corrections card: "Add record" controls now labelled

### Deploy

- `npx wrangler deploy` (new payroll endpoint) → `pnpm build` → hard refresh. No new migration

## [1.4.76] — 2026-08-02 — R2 slimming (image compression + gzipped backups) · events calendar · density polish

### Added

- **Client-side image compression before every R2 upload** (`lib/compress-image.ts`): longest side capped at 1600px, JPEG quality 0.82 — sharp enough for staff photos, claim receipts and site media, typically 5–15× smaller than phone-camera originals. Wired into staff photos (add form + record row), claim receipts, and admin site media. Safety rails: PDFs, videos, documents, GIFs and SVGs pass through untouched; any failure or a larger result falls back to the original. PDFs are NOT recompressed (no reliable in-browser way without quality loss) — they're usually small; if a huge scanned PDF becomes a problem, photograph the receipt as an image instead
- **Nightly backups now gzipped**: `backups/db-YYYY-MM-DD.json.gz` via CompressionStream — JSON dumps shrink ~85–90%, so 30 retained backups cost a fraction of the free-tier 10 GB. Audit records both stored and raw byte counts
- **Events month calendar** — the Dashboard events card now defaults to a professional calendar with a Calendar | List toggle: 7-column month grid (‹ › navigation), today ringed in navy, category-coloured markers (title snippets on desktop, colour dots on phones), colour legend, tap/click a day for its agenda below (with Remove for managers). Events API now returns from the previous month onward so recent history is visible; the list view still shows upcoming only

### Changed

- **Density pass across /portal, /admin and /account** (~40 spots): card padding p-5 → p-4 md:p-5 (p-4 → p-3.5 md:p-4), section stacks space-y-6 → space-y-4 md:space-y-6, grid gaps gap-6 → gap-4 md:gap-6, stat grids gap-4 → gap-3 md:gap-4, page shells px-5 py-6 → px-4 py-4 md:px-5 md:py-6. Phones lose the oversized white space; desktop keeps its comfortable rhythm

### Deploy

- `npx wrangler deploy` (gzip backups) → `pnpm build` → hard refresh. No new migration

## [1.4.75] — 2026-08-02 — Payroll totals · Claims (CEO approves) · Sales revenue on the Dashboard

### Added

- **Payroll month totals**: a bold TOTAL row under the table — Basic / Commission / Allowance / Deduction and the final **NET** payout for the whole month, updating live as figures are typed
- **Claims tab** (migration **0026**, `claims`): CEO, COO, CCO and HR (+admin tier) submit expense claims — date, category (travel/meal/accommodation/equipment/medical/other), amount, description, optional receipt (image/PDF → R2). **Every decision is the CEO's alone** (super_admin retained solely as system-recovery fallback; admin deliberately excluded from deciding). CEO gets a bell notification on each submission and sees a Pending approvals queue with Approve / Reject + optional note; the claimant is notified of the outcome. All actions audited (`claim.create/approve/reject`)
- **Sales revenue card on the Dashboard** for CEO, COO, CCO, sales_marketing, marketing and hr_admin (+admin tier): TikTok Shop revenue (synced order amounts, returned orders excluded), Invoiced revenue (INV documents), and combined Total — this month vs last with a ▲/▼ % change
- **TikTok order amounts now captured** (migration 0026: `postage_records.order_amount_cents`): the sync reads `payment.total_amount` on insert and backfills existing TT- records via COALESCE on the next pass

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0023–**0026**) → `npx wrangler deploy` → `pnpm build` → hard refresh. TikTok amounts for the existing 7 orders appear after the next 30-minute sync (or press Sync)

## [1.4.74] — 2026-08-01 — Minimalist Staff Details (collapsed records) · A–Z sorting

### Changed

- **Staff Details is now minimalist: every record collapsed to one line by default** — checkbox, name · role, and a small Employee ID · Position summary. A **"Details ▾"** button expands the full field grid with the Save / Preview badge / Print badge / photo actions; **"Hide details ▴"** collapses it again. Multi-badge printing via the checkboxes still works entirely from the collapsed view
- **Sorting added where names are listed:**
  - **Staff Details**: Sort: Rank (default) · Name A–Z · Name Z–A
  - **Attendance → corrections & back-entry table**: Sort: Time (default) · Name A–Z · Name Z–A (name sort keeps each person's punches in time order)
  - **Attendance → Team report**: same three options (appears only in report mode — your own punch list stays chronological)
- Reviewed the other tabs: Birthdays is already date-ordered (its purpose), leave queues are already stage-ordered, HR staff lists stay rank-sorted per v1.4.36 — adding name sort there would fight orderings that exist for a reason; say the word if any specific list should get it too

### Deploy

- Frontend rebuild only: `pnpm build` → publish → hard refresh

## [1.4.73] — 2026-08-01 — Company events: trainings, classes and important dates every staff member sees

### Added

- **Events module** (migration **0025**, `events` — no foreign keys by policy): title, category (training / class / meeting / event), date, optional start–end time, location, details
- **Upcoming events card on every staff Dashboard** — the first screen after login, so nothing gets missed: date shown DD-MM-YYYY with a **TODAY / Tomorrow / in N days** countdown (TODAY in amber), time, location, who added it. Past events drop off automatically
- **Everyone is bell-notified when an event is created** ("Upcoming training: … on DD-MM-YYYY") — same notification machinery as announcements, including the off-platform relay once NOTIFY_WEBHOOK is configured
- **Inline management** for super_admin / admin / hr_admin / **ceo** / coo / cco: "+ Add event" form and Remove on the Dashboard card; API `GET/POST /api/v1/staff/events`, `PATCH/DELETE /api/v1/staff/events/:id`; all changes audited (`event.create/update/delete`)

### Changed

- **Overview (CEO monitor): the BD-pipeline block is replaced by Upcoming events** (next 60 days) and the "Open BD deals" stat becomes **"Events next 30 days"**. The BD deal pipeline itself is untouched — the CCO's Commercial tab still manages it in full; only the Overview summary changed

### What "BD pipeline" was

- Business-Development deal tracker: prospective client deals by status — open, pending, **kiv** ("keep in view" — parked for later), closed won/lost. The numbers in the screenshot were deal counts entered by the CCO in the Commercial tab

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0023–**0025**) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.72] — 2026-08-01 — Nightly backups · error log + System health card · security recovery checklist

### Added

- **Automated nightly database backups** (03:20 MYT cron): every application table dumped as JSON to R2 under `backups/db-YYYY-MM-DD.json`, newest 30 kept, older pruned. On-demand **"Back up now"** button in /admin. Every backup audited (`system.backup`). D1 Time Travel remains a second, independent recovery path
- **Error log** (migration **0024**, `error_log` — deliberately NO foreign keys so it stays writable even when referential integrity is the problem): auto-records unexpected API 500s (with path), failed audit writes in both worker modules, TikTok cron failures (pre-setup "not configured/authorized" stays silent), and backup failures. Newest 500 kept
- **System health card** in /admin → Audit: last 20 errors + last-backup status with an amber warning when the newest backup is older than 2 days. Endpoints `GET /api/v1/system/health` + `POST /api/v1/system/backup` (admin tier + CEO)
- **Security recovery checklist** written up in SECURITY.md §v1.4.72 — the master-password recovery steps and the `PRAGMA foreign_key_check` orphan cleanup (preserve-history UPDATEs where nullable, targeted DELETEs where not), start to finish

### Changed

- `scheduled()` now branches on the cron expression: `*/30 * * * *` → TikTok sync (failures now recorded), `20 19 * * *` → backup

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0023 + **0024**) → `npx wrangler deploy` (registers the new cron) → `pnpm build` → hard refresh → then run the SECURITY.md §v1.4.72 checklist once

## [1.4.71] — 2026-08-01 — Buyer city on TikTok orders · scrollable non-TikTok postage list

### Added

- **Buyer city on TikTok order rows** (📍 beside the date). Migration **0023** adds `buyer_city`; the sync and the webhook path both capture it from TikTok's `recipient_address` — **city only, never the street address** (staff need the rough destination, not the buyer's home; falls back to state if TikTok returns no city level). Existing TT- records backfill automatically on the next sync pass
- Empty-state line for the non-TikTok list ("No non-TikTok postage records yet")

### Changed

- **"Postage tracking — non-TikTok orders" list is now scrollable** (same max-height scroll area as the TikTok card) and shows the full history instead of only the latest 8
- That list now **excludes TT- records** — TikTok orders already live in their own card directly above, so showing them twice was noise

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0023) → `npx wrangler deploy` → `pnpm build` → hard refresh

## [1.4.70] — 2026-08-01 — TikTok Orders: tracking numbers shown + status filter (New / Shipped / Delivered)

### Added

- **Tracking number on every TikTok order row.** The sync has captured TikTok tracking numbers since v1.4.67 — the card now displays them: `Tracking: <number> · TikTok`. Orders TikTok hasn't assigned tracking to yet show "No tracking number yet" (it backfills automatically on the next 30-minute sync once the parcel is handed to the courier)
- **Status filter chips** above the order list: **All · New · Shipped · Delivered**, each with a live count. "New" = orders still preparing/awaiting shipment. Returned orders remain visible under All
- Order list capacity raised 20 → 100 (scroll area unchanged) so filters have the full recent history to work with

### About the "(signature FAILED — check app secret)" note on the status line

- That warning means TikTok's **webhook** signature didn't verify against the stored `TIKTOK_APP_SECRET` — unverified pushes are logged then rejected (by design, v1.4.44). The 30-minute pull sync is unaffected, which is why orders still appear
- Fix: Partner Center → your app → copy the **App Secret** exactly → `npx wrangler secret put TIKTOK_APP_SECRET` → paste → `npx wrangler deploy`. The next webhook shows verified. (If the secret was ever regenerated in Partner Center, the stored copy is stale — this is the usual cause)

### Buyer notifications (no code needed)

- TikTok notifies buyers **automatically**: when the order ships (tracking uploaded) and when it's delivered, TikTok Shop pushes in-app/push notifications to the buyer. The statuses this system reads are the same events TikTok has already announced to the buyer — nothing to send from our side
- Manual buyer chat happens in **TikTok Seller Center → Chat** (or the TikTok Shop Seller app). Sending messages via API would require the Customer Service (IM) scope — a sensitive-data scope this system deliberately does not request

### Deploy

- Frontend rebuild only: `pnpm build` → publish → hard refresh. (Plus the one-time `wrangler secret put` above if the signature warning is showing)

## [1.4.69] — 2026-08-01 — Google login: FK failure isolated; audit writes can never break actions

### Fixed

- **The Google-login 500 identified itself as a FOREIGN KEY constraint failure.** Three inserts happen in that flow (audit trail, session, or first-time signup). The most likely culprit after the recent users-table rebuild is the **audit-log insert** — and an audit write should never take down the action it records. Audit writes are now non-fatal everywhere (both worker modules): a failed write logs for the operator and the action proceeds
- If the failure is elsewhere, it now **names its step**: "session insert for user N: …" or "customer signup insert: …" — no more anonymous 500s in this flow
- Session housekeeping (expired-session purge) also made non-fatal

### Diagnose the data side (run once)

- `npx wrangler d1 execute azoneofficial --remote --command "PRAGMA foreign_key_check;"` lists any orphaned rows left by table rebuilds or manual deletions — likely the underlying cause
- `npx wrangler d1 migrations list azoneofficial --remote` confirms 0020–0022 are applied

### Deploy

- `npx wrangler deploy` → retry Google sign-in. Expected: login succeeds; if not, the error names the exact step

## [1.4.68] — 2026-08-01 — Diagnosable 500s (Google sign-in "Something went wrong")

### Changed

- **Unexpected server errors now name the actual failure** in the response (e.g. a database "no such column …" message) instead of only "Something went wrong". Message text only — no stack traces or internals beyond what the engine reports. The Google sign-in failure will identify itself on the next attempt
- The worker already logs the full exception; `npx wrangler tail azoneofficial-api` while reproducing shows it live even before redeploying

### Deploy

- `npx wrangler deploy` → retry Google sign-in → the error message now states the cause

## [1.4.67] — 2026-08-01 — Postage from TikTok is automatic; manual form is for other channels

### Clarified + improved

- **Correct: TikTok postage should not be typed in — and it isn't.** TikTok orders arrive automatically (webhook + the 30-minute sync) as TT- records with their items and stock movement. The manual "Postage tracking" form now says what it's actually for: **non-TikTok channels** — Shopee, WhatsApp/direct sales, replacements
- **TikTok tracking numbers are now captured automatically** wherever TikTok includes them in the order data — no more typing those either
- **Every sync pass refreshes existing TikTok orders**: shipping status progresses (preparing → shipped → delivered) and a missing tracking number backfills, with stock untouched (it moved on first import; returns stay final)

### Deploy

- `npx wrangler deploy` → rebuild site

## [1.4.66] — 2026-08-01 — Automatic TikTok inventory sync + per-order quantities

### Added — automatic sync

- **The worker now syncs TikTok orders automatically every 30 minutes** (Cloudflare cron): new orders become TT- postage records and deduct stock by SKU without anyone pressing anything. The manual Sync button remains for on-demand pulls; both run the identical logic, and cron runs audit as source: tiktok_cron. Until the TikTok setup completes, the schedule is a harmless no-op

### Added — see exactly what shipped

- **Each TikTok order in the Inventory tab now lists its items and quantities** (e.g. "2× ELFIA Satin Square, 1× ELFIA Bawal") — the shipped goods behind every stock deduction, so the available inventory is verifiable per order
- Orders with **no stock movement** say so explicitly; unmatched SKUs in notes now include the ordered quantity ("2× TT-SKU-123"), so even unmapped items show how many units the order wanted

### Deploy

- `npx wrangler deploy` (registers the cron trigger too) → rebuild site

## [1.4.65] — 2026-08-01 — Inventory opened to six roles; TikTok orders move into Inventory

### Changed

- **The Inventory tab is now visible and editable by CEO, COO, CCO, sales_marketing, marketing, and hr_admin** (admin tier as backstop) — items, stock adjustments, postage records and materials. The API enforces the same list, so it's real access, not just a visible tab
- **TikTok Orders moved from Sales into Inventory** — TikTok orders move stock, so the tracker now sits beside the stock it moves: status line, Sync from TikTok, and the TT- order list all live at the top of the Inventory tab. A successful Sync refreshes the stock list beneath it immediately
- Sync permission aligned with the same six roles

### Deploy

- `npx wrangler deploy` (permission gates) → rebuild site

## [1.4.64] — 2026-08-01 — More sheet: reliable close + friendlier touch (and an /admin build fix)

### Fixed

- **"Close not function" — real iOS bug, now fixed.** iPhone Safari doesn't fire taps on plain backdrop layers, so tapping the dimmed area never closed the sheet. The backdrop is now a genuine button (iOS honours it), and the sheet also gains an explicit **✕ Close button** and a tappable drag-handle — three reliable ways out, plus selecting any section still closes it
- **/admin build error introduced in v1.4.55**: the mobile menu referenced state that was never declared (my scripting slip — the declaration step never wrote to disk). If your `pnpm build` failed recently, this was why. Declared and verified
- **Background no longer scrolls** while the sheet is open — it behaves like a native menu, not a floating layer

### Changed — touch ergonomics

- Bottom-bar buttons: taller (56 px minimum), larger labels, centred — comfortably thumb-sized on all three surfaces (/portal, /admin, /account)
- Sheet grid buttons: taller with more spacing between them

### Deploy

- Rebuild the site (`pnpm build`) — this build should succeed even if the previous one errored on /admin

## [1.4.63] — 2026-08-01 — Badge: DEPARTMENT row added

### Changed

- **DEPARTMENT : row added directly below POSITION** on the badge, in the same aligned three-column style. Rows now: NAME / EMP. NO / NRIC / DATE JOIN / DATE ISSUED / POSITION / DEPARTMENT

### Deploy

- Rebuild the site only

## [1.4.62] — 2026-08-01 — Badge final polish: aligned columns + small tagline

### Changed

- **Every row now aligns on three true columns** — label, colon, value — so all colons sit in one vertical line and a wrapped value's second line starts exactly under its first, never under the colon
- **Small gold LIVE · CONNECT · GROW** returns beneath the logo, subtle and letter-spaced as requested
- Vertical rhythm evened out (row padding, photo spacing) for the organized, professional finish

### Deploy

- Rebuild the site only

## [1.4.61] — 2026-08-01 — TikTok shop lookup tries both endpoint families

### Changed

- **The shop-cipher lookup now tries both of TikTok's shops endpoints** (`/authorization/202309/shops`, then `/seller/202309/shops`) — they live under different scope families, so whichever scope the app has active can supply the identifier. Each attempt's result is reported, so a failure names both causes precisely
- Note on Partner Center's Manage API search: filtering by package name for "authorization" shows 0 because no scope is _named_ that — clear the search to see all 25 scopes and look for the shop/seller-info one by browsing (or search "shop" / "seller")

### Deploy

- `npx wrangler deploy` → press **Sync from TikTok** again

## [1.4.60] — 2026-08-01 — Badge in the classic ID layout (label rows); footer split per spec

### Changed

- **Badge follows the classic Malaysian staff-ID layout** (per the provided sample): logo header, centred photo, then bold left-aligned label rows — **NAME : / EMP. NO : / NRIC : / DATE JOIN : / DATE ISSUED : / POSITION :**
- **Footer split exactly as specified**: office location (Setia Tropika, Johor Bahru, Malaysia) bottom-left, **company registration (SSM 202603168673 / JM1046169-H) bottom-right**
- Overlap-proof structure retained from v1.4.58 (flex column, footer in flow) — long names wrap within their row and push the footer down, never under it
- Preview remains the sandboxed iframe of the exact print document

### Deploy

- Rebuild the site only

## [1.4.59] — 2026-08-01 — TikTok shop resolution: real diagnostics + both response shapes

### Fixed

- **"Could not resolve the authorized shop" was hiding TikTok's actual answer.** The shop-cipher lookup now reports exactly what TikTok said — an API code + message (e.g. a scope/permission refusal), or "authorized shop list came back empty" (meaning the Seller authorization never completed for the shop). No more guessing
- **Both authorized-shops response shapes are accepted** (`shops[].cipher` and `shop_list[].shop_cipher`) — TikTok's API versions differ on this, and if the shape was the issue, this release fixes it outright
- The authorization audit entry now records the cipher-resolution outcome for later inspection

### Deploy

- `npx wrangler deploy` → press **Sync from TikTok** again. Either it works, or the message now names the exact TikTok-side cause

## [1.4.58] — 2026-08-01 — Badge layout made overlap-proof; gold line + tagline removed

### Fixed

- **The footer could still collide with the details grid** (visible over the NRIC/Joined row): the footer was absolutely positioned, so growing content ran underneath it. The card is now a **flex column and the footer is part of the flow, pinned to the bottom by spacing** — content can only push it down within the card, never overlap it. This holds for any name/position length, structurally
- **Gold divider line and LIVE · CONNECT · GROW removed** per instruction — the card reads logo → photo → name → role → details → footer, clean and professional
- Space freed by the removals goes to breathing room: slightly larger photo (22×26 mm), name, and grid spacing

### Deploy

- Rebuild the site only

## [1.4.57] — 2026-08-01 — Fix: TikTok "Missing identifier / shop_cipher" on Sync

### Fixed

- **The authorization callback stored the access token but never the shop identifier.** TikTok's token response doesn't include shop_cipher — it must be fetched separately via **Get Authorized Shops** — so every order API call failed with "Missing identifier. The 'shop_cipher' query parameter is required". (Your "Connected" status was genuine: authorization succeeded; only the shop identifier was missing)
- The callback now resolves and stores **shop_id + shop_cipher** immediately after the token, and **Sync self-heals**: if the stored token lacks a cipher (your current state), it fetches and stores one before calling the orders API — **no re-authorization needed**
- If the cipher can't be resolved, Sync now says exactly that ("ensure the Seller authorization completed and the order/shop scopes are active") instead of a downstream API error

### Deploy

- `npx wrangler deploy` → press **Sync from TikTok** once more. No migration, no rebuild required

## [1.4.56] — 2026-08-01 — Badge restored to the clean brand design (v1.4.53 layout reverted)

### Fixed

- **v1.4.53's decorative redesign is reverted** — in practice the corner sweep collided with long values (a two-line position pushed Department/Phone into the artwork and under the footer), and the preview's stylesheet leaked into the page. Apologies for that regression; two structural fixes make sure neither can recur:
- **Back to the clean brand-profile design**: white card, navy border and details, gold divider line + gold LIVE · CONNECT · GROW tagline under the logo — the look that worked — while keeping **NRIC and Joined on** in the details grid (with Employee ID, Position, Department, Phone) and the issue date in the footer
- **The preview is now a sandboxed iframe** rendering the exact print document: badge CSS can no longer leak into the admin page, page styles can no longer distort the badge, and preview vs print are one document by construction
- Field text sizes tuned so even long positions/names wrap within their cell without invading the footer

### Deploy

- Rebuild the site only

## [1.4.55] — 2026-08-01 — App view on all three surfaces; mobile fit sweep

### Added — /admin and /account now match /portal's app view (phones only)

- **/admin**: sticky app bar showing the current section title, bottom tab bar with the first four sections + **More** sheet holding the rest (respecting role visibility of Users/Staff/Audit), screen transitions, safe-area padding, bottom clearance. Desktop unchanged
- **/account** (customers): sticky app bar, two-tab bottom bar (Account · My Enquiries), screen transitions, bottom clearance
- /portal already had all of this (v1.4.49–50) — the three surfaces now feel consistent

### Fixed — mobile fit

- **The public packages comparison table couldn't scroll on phones** (overflow was hidden, cutting columns off) — now scrolls horizontally
- **WhatsApp button on /account lifts above the new bottom bar** on phones instead of overlapping it (desktop position unchanged; still absent from /portal and /admin per v1.4.52)
- **The corner back-to-top button is hidden on all three app-view surfaces** — the bottom bar owns that corner, and tab taps already return to top
- Audited every data table across portal/admin: all already scroll horizontally in place, so wide tables (payroll, attendance, audit) pan within their card instead of breaking the screen

### Deploy

- Rebuild the site only. No worker change, no migration

## [1.4.54] — 2026-08-01 — Date audit: DD-MM-YYYY + Malaysia time everywhere

### Fixed — every display date now DD-MM-YYYY, every timestamp Malaysia time

Audit of every file found and fixed these violations:

- **HR Staff birthdays** rendered raw ISO (1997-02-09) → now 09-02-1997
- **Overview's latest ops report date** rendered raw ISO → DMY
- **/admin enquiries and audit lists** rendered raw UTC database timestamps → DD-MM-YYYY HH:mm in MYT
- **/admin audit panel** used slashes (01/08/2026) → dashes
- **Attendance PDF footer** ("Generated …") used the browser's locale and timezone → MYT DMY
- **/admin staff panel leave ranges** rendered raw ISO → DMY
- **Blog dates** long-form → DD-MM-YYYY
- **Portal notification timestamps** showed day + short month without year → DD-MM-YYYY HH:mm MYT

### Fixed — "today" and "this month" now computed in Malaysia time

Defaults previously used UTC, so between **midnight and 8 AM MYT** the portal thought it was still _yesterday_ — on the 1st of a month, payroll/attendance/report defaults pointed at the **previous month**. All defaults (payroll months ×3, attendance month, HR pay month, task report dates ×2) now compute in MYT. Server-side attendance/payslip queries already used MYT (+8) — verified unchanged

### Known boundary

- Native date-picker _inputs_ render per the phone/browser locale (a browser behaviour that can't be styled); the values stored and every date the system itself displays are consistent DMY/MYT

### Deploy

- Rebuild the site only. No worker change, no migration

## [1.4.53] — 2026-08-01 — Badge redesigned to the brand card, with NRIC + join date

### Changed

- **Badge now follows the brand-card design**: cream ivory base, the navy sweep with gold edging across the bottom corner, a thin gold arc top-right, and the gold **LIVE · CONNECT · GROW** tagline under the logo — matching the provided artwork
- **Text is never interrupted**: the decorative sweep occupies only the bottom 13 mm as a background layer; all details sit in a content layer above it, and the footer line stops at 14 mm — so the curves stay purely decorative at any content length
- **NRIC and Joined on are now on the badge**, joining Employee ID, Position, Department and Phone in the details grid; the issue date moved to the footer line
- **Preview = print, guaranteed**: the on-screen badge preview now renders the exact same markup and CSS as the print version, so what you approve is what prints — individually or 9-per-A4

### Deploy

- Rebuild the site only. Fill Joined on + IC in Staff Details for each person so the badge shows them

## [1.4.52] — 2026-08-01 — WhatsApp button off the internal surfaces

### Changed

- **The floating WhatsApp button no longer appears on /portal or /admin** — those are internal staff surfaces where a customer-contact button has no business. It remains on the public site and on **/account** (customers), exactly as specified. Implemented path-aware inside the button itself, so any page added later inherits the right behaviour automatically

### Deploy

- Rebuild the site only. No worker change, no migration

## [1.4.51] — 2026-08-01 — IC number (NRIC) across staff record, payslip, and badge

### Added (migration 0022)

- **Staff record**: IC number (NRIC) field, right beside the full name, in both the record grid and the add-staff form. Amendment-lock applies like every identity field
- **Payslip**: an **I/C #** row in the header block (below the employee name), matching the standard Malaysian payslip layout
- **Badge**: IC No. joins the badge grid (with the issue date moving up beside it), on both individual and multi-badge A4 printing

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0022**) → `npx wrangler deploy` → rebuild. Then fill each staff member's IC in Staff Details

## [1.4.50] — 2026-08-01 — Mobile view now reads as an app, nothing to install

### Changed (phones only; desktop untouched)

- **App-style top bar**: on phones the header is a compact sticky bar showing the current screen's title (Dashboard, Attendance, …) with the bell and sign-out beside it — like a native app's title bar, with background blur as content scrolls under it. The desktop "Welcome" header is unchanged
- **Screen transitions**: switching tabs plays a quick slide-up fade (0.18s), the way app screens change — honours reduced-motion settings
- **Native touch feel**: no grey tap-highlight flash, no rubber-band overscroll, no long-press callout — small things that make a web page feel like a web page, now gone
- Together with v1.4.49's **bottom tab bar + More sheet**, the mobile portal now looks and behaves like an app view in the browser itself — no installation involved

### Deploy

- Rebuild the site only. No worker change, no migration

## [1.4.49] — 2026-08-01 — Mobile-app experience: installable PWA + bottom navigation

### Added — install it like an app

- **The site is now an installable PWA**: manifest (AZ ONE, navy theme, portrait, opens straight into /portal), 192/512 app icons generated from the logo on the navy brand background, Apple web-app meta (black-translucent status bar), and a minimal network-first service worker. On a phone: **Chrome/Android → menu → Add to Home Screen**; **iPhone Safari → Share → Add to Home Screen**. It then launches fullscreen from its own icon — no browser bar — which is the native-app feel
- The service worker is deliberately network-first: live data (attendance, payroll, stock) is never served stale; it exists to enable installation and keep the shell reachable

### Added — app-style bottom navigation (phones only)

- **A fixed bottom tab bar** replaces the pill row on small screens: this person's first four tabs one thumb-tap away, a gold indicator on the active tab, safe-area padding for gesture-bar phones
- **"More" opens a bottom sheet** with the rest of their tabs in a grid — so every role still reaches everything, just organised the way mobile apps do it
- Desktop (md and up) keeps the pill tabs exactly as before; content gets bottom clearance on mobile so nothing hides behind the bar

### Deploy

- Rebuild the site only (`pnpm build` → push → hard refresh). No worker change, no migration. After deploying, staff must visit the site once and use Add to Home Screen to get the app icon

## [1.4.48] — 2026-08-01 — Customer demotion restored; TikTok sync + status; API signing fixed

### Fixed (security-relevant)

- **The /admin Users role dropdown had no "customer" option** — so a personal-email account holding a staff role could not be demoted through the UI at all, exactly the gap that alarmed you. "customer" is now in the dropdown; combined with the v1.4.42 domain policy this closes the loop: personal emails can be pushed down to customer, and can never be pushed back up. (Reassurance on the other half: self-registration has only ever created customer accounts — nobody registers into a staff role)
- **TikTok API calls are now signed.** TikTok requires every API request to carry a timestamp and an HMAC-SHA256 `sign` parameter; v1.4.44's order-detail call omitted this and would have been rejected. All calls now go through a signing helper

### Added — why "No TikTok orders yet" and the fix for it

- Webhooks only push orders **created after** the subscription is live — and the app is still Draft with 0 active scopes, so nothing has ever been able to flow. Two additions close the gap:
- **Integration status line** on the Sales → TikTok Orders card: shows not-configured / not-authorized (with what to do) / connected + last webhook (and flags a failed signature explicitly)
- **"Sync from TikTok" button** (super_admin/admin/ceo/coo/sales_marketing): pulls the **last 30 days of orders** via Get Order List once the app is live — creates TT- records, deducts stock by SKU (all-or-nothing, race-guarded, audited as tiktok_sync), skips orders already imported, and reports "Imported N (M already in)" plus any unmatched SKUs

### Deploy

- `npx wrangler deploy` → rebuild site. Migrations 0020+0021 from earlier releases still required if pending

## [1.4.47] — 2026-08-01 — Payslip header proper fields + confidentiality marking

### Changed

- **Payslip header restructured into distinct labelled rows**: EMP'EE # · EMP'EE NAME · DEPT. · SECTION · STATUS · PERIOD · **BANK NAME** · **BANK ACCOUNT** — each its own field instead of the combined "#/NAME" and "DEPT./SECTION" pairs. Department maps to DEPT., position to SECTION
- **Confidentiality per Malaysian practice**: a red **SULIT / PRIVATE & CONFIDENTIAL** mark at the top of the slip, and a footer statement citing issuance under the Employment Act 1955 and personal-data protection under the PDPA 2010, prohibiting disclosure without written consent

### Notes on the sample printed

- STATUS showed ACTIVE because migration **0021** wasn't applied yet — after it, the value reads PERMANENT (or contract/part time as set)
- BANK showed "—" because the record's bank fields were empty — fill Bank + account in Staff Details and they print

### Deploy

- Rebuild the site only (print template change). Migrations 0020/0021 still required from the previous releases if pending

## [1.4.46] — 2026-08-01 — Fix: staff record saves failed on employment status; bank fields on creation

### Fixed (the "Something went wrong" on Save)

- **Root cause**: v1.4.43 introduced permanent / contract / part_time in the UI, but the users table still enforced the original database CHECK ('active','probation','resigned','terminated'). Every save carrying a new status value was rejected by the database itself, surfacing as a generic 500. Migration **0021** rebuilds the constraint to accept both sets, defaults new staff to 'permanent', and maps existing legacy 'active' rows to 'permanent' (probation/resigned/terminated untouched)
- The staff PATCH now **validates employment_status up front** and returns a clear 400 naming the allowed values — a bad value can never again surface as "Something went wrong"

### Added

- **Add-staff form gains Bank (Malaysian bank dropdown, Maybank first) and Bank account no.** — captured at creation instead of requiring a second edit; the create endpoint stores both

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0021** — required, this is the fix) → `npx wrangler deploy` → rebuild site

## [1.4.45] — 2026-08-01 — TikTok app key committed to config

### Changed

- **worker/wrangler.toml now carries `TIKTOK_APP_KEY = "6kraboau1veif"`** (Partner Center service ID 7668934538403645205). The app key is a public identifier — it travels in the query string of every TikTok API call — so it belongs in versioned config alongside GOOGLE_CLIENT_ID. Only `TIKTOK_APP_SECRET` is a secret and it is never committed
- Deploy notes corrected accordingly: one secret to set, not two

### Still required in Partner Center before orders flow

- **API scopes: 25 inactive, 0 active.** The app cannot call any endpoint until the order and product scopes are applied for and approved — order read (Get Order List / Get Order Detail) drives the SKU lookup, product/inventory read supports reconciliation. Customer Service scope is flagged as sensitive personal data and is **not** needed for stock movement — leave it off
- Publish the app, then authorize the shop through the redirect URL

### Deploy

- `npx wrangler deploy` (picks up the new var). No migration

## [1.4.44] — 2026-08-01 — TikTok integration made compatible with TikTok's actual protocol

### Fixed — the v1.4.40 webhook could not have worked with TikTok directly

- **TikTok signs its own webhooks; there is no custom header to configure.** The previous endpoint required `x-webhook-secret`, which TikTok never sends — every real TikTok call would have been rejected. The endpoint now verifies TikTok's **tiktok-signature** header (HMAC-SHA256 with the app secret), checking both signing conventions in use across TikTok's platforms, with a 5-minute timestamp window against replay. The relay path (`x-webhook-secret`, for Make/Zapier) still works
- **Order webhooks carry only order_id + status — not the line items.** Stock could never have been deducted from the webhook alone. The worker now calls **Get Order Detail** with the stored seller token to resolve SKUs and quantities, then moves stock exactly as before (all-or-nothing, race-guarded, audited)

### Added (migration 0020)

- **Seller authorization callback** at `/api/v1/integrations/tiktok/callback` — set this as the app's Redirect URL; it exchanges TikTok's auth code for the access token and stores it (integration_tokens)
- **webhook_events log**: every receipt is recorded with its verified flag and raw body — including rejected ones — so a signature mismatch is diagnosable instead of silent
- Shipping/delivery status events now update the postage record's status without touching stock

### Configuration

- App key lives in worker/wrangler.toml; `npx wrangler secret put TIKTOK_APP_SECRET` (from Partner Center)
- Partner Center → Redirect URL: `https://azoneofficial.com/api/v1/integrations/tiktok/callback`
- Partner Center → Manage Webhook → subscribe **Order status change**, URL `https://azoneofficial.com/api/v1/integrations/tiktok/webhook`
- Publish the app, then authorize the shop; scopes must include order read and (for reconciliation) product/inventory read

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0020**) → secrets → `npx wrangler deploy`

## [1.4.43] — 2026-08-01 — Multi-badge printing, bank details, proration, payslip month integrity

### Staff Details (migration 0019)

- **Multi-badge printing**: checkboxes on each record + "Print selected badges — up to 9 per A4" (3×3 sheet of 54×85.6 mm cards, page-break safe). Individual Print badge stays on every record
- **Bank details**: Bank (Malaysian bank dropdown, **Maybank first** as the company's primary bank) + account number — feed payroll and print on the payslip's BANK line. Amendment-lock applies like every record field
- **Employment status is now a proper choice**: permanent / contract / part time — and prints as the payslip STATUS
- **Joined on (DD-MM-YYYY)** records when each person started at AZ ONE OFFICIAL

### Payslip

- Prints the **full name (as per IC)**, falling back to display name only if empty
- **BANK : MAYBANK · account** line in the header block
- **Leave balances are computed for the payroll month**, not the print date — leave taken after that month no longer wrongly reduces an earlier month's slip (correct flow: the August slip shows August's eligibility even if printed in October)

### Payroll

- **Working-day proration**: enter the month's working days once (default 26 — e.g. July 2026 in Malaysia), enter a person's days worked on their row, press **Prorate** → basic becomes basic × worked/total. Example: RM2,100 basic, joined 20 July, 10 of 26 working days → **RM807.69**
- **Save all** button stores every row's entry for the month in one click (upserts — refreshing a month never duplicates)
- **Months before joining are greyed** in My payslip, with the joining date shown — no payslip is offered for months before employment began

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0019**) → `npx wrangler deploy` → rebuild site

## [1.4.42] — 2026-08-01 — Domain policy: staff roles require a company email

### Changed (security)

- **Staff and admin roles can only be held by @azoneofficial.com emails.** Personal emails (gmail etc.) are customer accounts — they belong in /account, never /portal or /admin. Enforced in all three assignment paths: the /admin Users role dropdown, the /admin create-user form, and HR's staff creation. Demoting any account **to customer is always allowed**, so cleaning up existing personal-email staff assignments works with the same dropdown
- Self-registration already always creates customer (v1.4.35); this closes the remaining path — an admin assigning a staff role to a personal email by mistake

### How to correct the two flagged accounts (in /admin → Users)

1. **First confirm you can sign in as a company super admin** (admin@azoneofficial.com or alif.farhan@azoneofficial.com) — the gmail super_admin is your Google-login access, and demoting it removes that
2. Set **alyffarhan1997@gmail.com** → customer
3. Set **aliffarhan1997@gmail.com** → customer (this account can then still sign in with Google, landing in /account as a customer)

### Deploy

- `npx wrangler deploy` → no rebuild strictly needed (server-side policy). Migrations 0014–0018 if pending

## [1.4.41] — 2026-08-01 — Payslip redesigned to the Malaysian boxed format

### Changed

- **Payslip now follows the standard Malaysian boxed layout** (per the provided sample): header block (EMP'EE #/NAME · DEPT./SECTION · STATUS · PERIOD from/to), three ruled columns **EARNINGS / INCOME | DEDUCTIONS | OTHERS**, per-column TOTAL row, ANNL. BAL. / SICK BAL., a boxed **NETT PAY**, and the company line (AZ ONE OFFICIAL · SSM) at the bottom
- **Deductions appear only when late** — the deduction amount is labelled LATE DEDUCTION and the column reads NO DEDUCTION otherwise
- **No employer-contribution section** — KWSP/SOCSO/EIS registration is in progress, so the slip carries none of those rows; fields from the sample that don't apply (I/C, EPF#, SOCSO#, Tax#, bank code, PCB, sex/race) are deliberately omitted
- **The OTHERS column is computed from real data**: working days (distinct clock-in days that month), public holidays on the calendar, approved annual/medical leave days — and the balances use the same accrual rules as the Leave tab, so payslip and portal never disagree

### Deploy

- `npx wrangler deploy` (payroll/self + payroll/detail extras) → rebuild site. No migration

## [1.4.40] — 2026-07-31 — 2FA for all staff, payroll access rework, Sales edit roles, TikTok integration

### Changed — two-factor for everyone

- **2FA is now available to every staff role** (only customer accounts excluded) — staff accounts populate company data, so integrity demands the protection for all. Enrolment sits in each person's Profile tab; admins also have it under /admin → Account. (Also: the NEW announcement pill now aligns with the title text)

### Changed — payroll access rework

- **The Payroll tab appears only for its processors: CEO and COO** (admin tier as backstop). hr_admin and CCO no longer see the tab — and the API no longer lets them read other people's pay
- **Every staff member gets "My payslip" in their Profile**: pick a month, see the amounts, **print the branded payslip** — strictly view-only, because editable pay figures invite cheating. Editing exists solely inside payroll processing
- COO now **edits** payroll (was read-only) — CEO and COO are the processors

### Changed — Sales

- **CEO, COO, CCO, hr_admin and sales_marketing all read AND edit Sales**: customers, quotations, delivery orders and invoices. The CEO read-only carve-outs from v1.4.33/39 are removed, and sales_marketing (previously inventory-only) now has the Sales tab

### Added — TikTok order integration

- **Webhook endpoint** `/api/v1/integrations/tiktok/webhook` (secured by a shared secret): an order event creates postage record **TT-{order_id}** and **deducts inventory by SKU** (duplicate SKUs merged; all-or-nothing — on shortage the order is still recorded with a note so tracking never loses it, but nothing deducts); **cancelled/returned restocks** the order's lines once; unknown SKUs are noted, every movement audit-logged as source: tiktok
- Setup: `npx wrangler secret put TIKTOK_WEBHOOK_SECRET`, then point TikTok Seller Center's order webhook (or your relay) at the endpoint with header `x-webhook-secret`. Full API pull (polling TikTok for orders) needs TikTok Shop Partner app credentials — the webhook is the foundation either way

### Deploy

- Migrations 0014–**0018** if pending → `npx wrangler secret put TIKTOK_WEBHOOK_SECRET` (optional, enables TikTok) → `npx wrangler deploy` → rebuild site

## [1.4.39] — 2026-07-31 — Fix: CEO's Sales tab rendered nothing

### Fixed

- **The CEO's Sales tab opened to a blank page.** v1.4.33 added the CEO to the tab list, but the content had a _second_ role check that still excluded the CEO — so the button appeared and clicking it rendered nothing. The content gate now matches the tab gate. Audited every other tab for the same mismatch: Sales was the only one
- **Sales for the CEO is now a proper read-only view**: the documents list with statuses and PDF printing, plus a **customer list** (company + contact). The Add customer form joins Create document in being hidden for the CEO — the API would have rejected those writes anyway, so offering them was misleading

### Deploy

- Rebuild the site (`pnpm build`) and hard refresh. No worker change, no migration

## [1.4.38] — 2026-07-31 — Repeat-punch popup + revised shift thresholds

### Changed

- **Attendance thresholds revised**: clocking in **after 12:00** now counts the day as a **half day** (was 13:00); clocking out **before 18:00** is an **early out**. The HR verification table uses the identical rules, so a staff member's confirmation and HR's report can never disagree
- **Clock in / Clock out stay clickable after use.** Instead of greying out, tapping again opens a popup that confirms what already happened — "Already clocked in · Recorded at 13:08 MYT" — with an amber ring-and-exclamation animation matching the success card. Staff are never left wondering whether their tap registered
- Buttons now show their state at a glance: **Clocked in ✓** / **Clocked out ✓** once done
- Punch result labels spell the rule out: "Half day (after 12:00)", "Early out (before 18:00)"

### Deploy

- `npx wrangler deploy` → rebuild site. No migration

## [1.4.37] — 2026-07-31 — CRITICAL backdoor removal + two-factor authentication

### Security — CRITICAL (act on deploy)

- **Removed a master-password backdoor that was live in the code.** The login handler accepted the literal string `SuperSecretPassword123` as a valid password for **any active account**, and the change-password handler accepted it as the "current password" — meaning anyone who knew it could sign into any account and change its password. This is the same string removed in v1.4.12; it re-entered the codebase through the v1.4.21 fork this line was rebased onto, and has been present in every build since v1.4.22. Both occurrences are now gone
- **Required after deploying**: force all sessions out, then change the passwords of every privileged account (see SECURITY.md recovery sequence). Treat any password set while that string was live as compromised

### Added — two-factor authentication (migration 0018)

- **TOTP 2FA for super_admin, admin and CEO accounts** — RFC 6238, compatible with Google Authenticator, Authy, 1Password and Microsoft Authenticator
- **Password alone no longer creates a session** on a 2FA account: login returns a 5-minute challenge and the session is minted only after a valid code (max 5 attempts, rate-limited per IP)
- **Eight single-use backup codes**, shown exactly once at enrolment and stored only as hashes, for a lost phone
- **Turning 2FA off requires the account password** — a stolen session cannot strip the second factor
- Enrolment panel in **/admin → Account** and **/portal → Profile**; every 2FA event (enable, disable, challenge, backup-code use, 2FA login) is audit-logged

### Changed

- Payslip footnote now states plainly that **no statutory deductions (EPF/SOCSO/EIS) apply at present and basic salary is paid in full**

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0018**) → `npx wrangler deploy` → rebuild site → **then run the credential recovery above**

## [1.4.36] — 2026-07-31 — DD-MM-YYYY everywhere, rank-sorted staff, unpaid leave, Payroll processing

### Changed

- **Date format audit — DD-MM-YYYY across the system**: announcements, documents lists and printed QT/DO/INV headers, notifications, leave requests (start → end), enquiries, task reports, HR attendance times, holidays, audit trail, and the new payslip. Dates in the database stay ISO; native date pickers already follow the device's Malaysian locale
- **Staff Details sorted by rank**: CEO → COO → CCO → Administrative (HR) → Sales & Marketing → remaining staff roles, then by name within the same rank (Payroll uses the same order)
- **Unpaid leave is fully eligible** — it is unpaid, so it never pro-rates; the whole entitled total is available from day one (joins medical as non-accruing)

### Added — Payroll processing (migration 0017)

- New **Payroll** tab: month picker, every staff member with **Basic + Commission + Allowance − Deduction = Net** (RM inputs, stored in sen, one entry per person per month, upsert on save, audit-logged)
- **Branded AZ ONE OFFICIAL payslip**: A4 print with logo, SSM number and Setia Tropika address, employee details, earnings/deductions table, bold NET PAY band in brand navy, and a statutory-contributions footnote
- **Who processes**: the CEO and hr_admin (plus admin tier) — matching the handover plan (CEO this month, hr_admin from next month); COO & CCO see the tab read-only

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (**0017**) → `npx wrangler deploy` → rebuild site

## [1.4.35] — 2026-07-31 — Self-registration is always customer

### Fixed (security)

- **Every self-registration now creates a customer account — no exceptions.** Google sign-in previously auto-assigned the _marketing_ staff role to any company-domain Google email, active immediately with no approval: an unattended path into the staff side. Removed. Email registration was already customer-only by design
- **Role assignment is now exclusively explicit**: /admin → Users (admin tier) or HR staff creation. Existing staff who sign in with Google on an email an admin already elevated keep their assigned role — that path is unchanged
- Note: no self-registration path ever assigned super_admin; if any account holds an unexpected role today, correct it in /admin → Users (role changes are audit-logged)

### Deploy

- `npx wrangler deploy` only. No migration, no site rebuild required

## [1.4.34] — 2026-07-31 — Bell backfill, NEW announcement animation, rank rework

### Fixed

- **Announcement notifications now populate regardless of publish/deploy order.** The bell no longer depends on the fan-out having run at publish time: reading notifications backfills a row for any announcement from the last 7 days that lacks one (poster excluded, original timestamp kept). The existing "PERUBAHAN WAKTU…" announcement will appear in every staff member's bell after this deploy

### Added

- **NEW animation on announcements**: unacknowledged announcements carry a pulsing amber **NEW** chip and a soft amber highlight on the card; both clear the moment the staff member clicks Acknowledge — the tab makes unread news unmissable

### Changed — rank rework

- **The CEO (higher rank) now EDITS Staff, HR and Staff Details**: full record editing including amendments and photo replacement (same authority as admin tier in these areas), the add-staff form, and the HR tools — leave entitlements, public holidays, payslip generation — now rendered in the portal HR tab for hr_admin and the CEO (previously these tools were only reachable in /admin, which hr_admin cannot enter — that gap is closed)
- **COO & CCO become read-only** on staff data: they keep every view (staff records, badges, HR verification tables, attendance report via exec view, CSV export) but no longer edit records or create staff
- Deliberately unchanged: the **leave approval chain** — COO/CCO still pre-approve leave (that's a workflow role, not data editing); Sales stays read-only for the CEO (the edit grant covered Staff/HR/Staff Details)

### Deploy

- `npx wrangler deploy` → rebuild site. No migration

## [1.4.33] — 2026-07-31 — Statutory medical leave, CEO visibility, clickable dashboard, account tabs

### Changed

- **Medical leave is fully eligible from day one** — sick leave under Malaysia's Employment Act is a statutory entitlement, not an accrued benefit, so it no longer pro-rates: 14/14 available immediately. Annual/emergency/others keep the monthly release
- **CEO now sees HR, Sales and Staff Details tabs** — all read-only: the Sales tab hides the create-document form for the CEO (documents list, statuses and PDFs visible); Staff Details renders fully read-only for the CEO (records and badge preview/print visible, no edits, no add form); HR's verification tables were already readable. Backing API reads (sales docs, customers) opened to exec_view; writes unchanged
- **Dashboard cards are clickable** — Pending leave → Leave, My open tasks → Tasks, Announcements → Announcements (keyboard accessible too)
- **Notifications**: show the announcement message, keep only the **last 7 days** (older ones disappear automatically), and the dropdown shows about **5 rows with scrolling** for more
- **super_admin no longer appears in staff lists** (Staff Details, Birthdays, attendance-correction picker) — it belongs to the Admin side, not the staff directory
- **/account now has tabs**: **Account** (details, password, ELFIA) and **My Enquiries** (the Ask AZ ONE form + enquiry thread) — the enquiry area customers were promised has its own tab

### Deploy

- `npx wrangler deploy` → rebuild site. No migration

## [1.4.32] — 2026-07-31 — Multi-item orders with guaranteed-accurate deduction

### Changed

- **A postage order now carries multiple item lines**, each with its own quantity (**+ Add item line** in the form, up to 20 lines). Rows show the full contents: "AZ-1023 · J&T · 2× Signature Shawl Taupe, 1× Corporate Series Grey"

### How accuracy is guaranteed (the four rules)

1. **Duplicate lines merge before checking** — 2× A + 3× A is treated as 5× A, so the check can't be fooled by splitting
2. **All-or-nothing validation** — every line is checked against current stock first; if ANY line is short, the whole order is refused with the exact shortages listed ("Signature Shawl: only 3 in stock, order needs 5"). No partial deduction ever happens
3. **Race-proof deduction** — each deduction is a guarded UPDATE (`AND stock >= qty`); if two people ship the same item at the same instant, the slower order is rolled back and refused rather than pushing stock negative
4. **Every movement is audit-logged** with the item, quantity and order reference — verifiable any time in /admin → Audit under the inventory filter

- Returns restock **every line** of the order, once (legacy single-item records from v1.4.31 restock too)
- Migration **0016** (postage_items line table)

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0014/0015 if pending + **0016**) → `npx wrangler deploy` → rebuild site

## [1.4.31] — 2026-07-31 — Stock moves with postage; the bell actually alerts

### Added — inventory ↔ postage logic

- **Shipping deducts stock automatically.** The postage form can name the inventory item and quantity shipped; creating the record subtracts the stock and recomputes the status (0 = out of stock, ≤5 = low). If there isn't enough stock, the record is refused with "Only N in stock for ITEM — cannot ship M" — no silent negative stock
- **Returns restock automatically.** Marking a shipment _returned_ puts its quantity back — exactly once (a restocked flag prevents double-counting on repeated saves)
- **Manual Stock in / Stock out** per inventory row with a quantity box (restock deliveries, corrections). Every movement — automatic or manual — is audit-logged as inventory.in / inventory.out with the quantity
- Postage rows show what they shipped ("2× Signature Shawl Taupe"); migration **0015** links postage_records to inventory
- Fixed a latent flaw: audit detail objects (quantities, roles) were silently dropped — audit() now stores them as JSON in audit_log.detail

### Changed — notifications

- **The bell now alerts without a reload**: notifications refresh every 60 seconds and whenever the tab regains focus, and unread items show a **pulsing amber count badge** on the bell itself. Staff see an announcement land while they work, not only after a refresh
- Honest scope reminder: announcement fan-out shipped in v1.4.26 and is **not retroactive** — only announcements published after that worker deploy create bell notifications. Off-platform delivery still awaits the NOTIFY_WEBHOOK variable

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0014 if pending + **0015**) → `npx wrangler deploy` → rebuild site

## [1.4.30] — 2026-07-31 — Accrual anchored to the company start (20 Jul 2026)

### Changed

- **Leave accrual now divides over the months the company actually operates.** AZ ONE started 20 July 2026, so the 2026 annual entitlement releases across **July–December (6 months)** instead of a January-anchored twelve: 14 annual days → **2.0 eligible by end of July**, 4.5 by August, 7.0 by September, 9.0 by October, 11.5 by November, the full 14 by December (half-day steps; 3 emergency days → 0.5 in July). From **2027** the window is the normal January–December twelve months automatically — no code change needed at year-end
- The company start lives as one constant (COMPANY_START) in the balance endpoint

### Deploy

- `npx wrangler deploy` → hard refresh (computation only; no migration, no rebuild strictly required but harmless)

## [1.4.29] — 2026-07-31 — One punch per day + animated punch confirmation

### Changed

- **Clock in / clock out can each be recorded once per day.** Enforced server-side (a second attempt returns "You already clocked in today"), so a double-click, a stale tab, or a direct API call cannot duplicate a punch. The dashboard buttons also disable after use: Clock in greys once punched; Clock out greys until there's a clock-in and after it's used

### Added

- **Professional punch confirmation**: clocking in/out opens a centered card with an animated ring-and-check draw in brand navy — "Clock-in recorded · On time · 09:58 MYT" — which auto-dismisses after ~2.5 s. Pure CSS keyframes, no library. Failures (including the once-per-day rule) show a clear inline message instead

### Note

- The v1.4.28 attendance corrections panel (amend/back-entry for CEO + admin) is included in this zip — if the Attendance tab shows only your own punches, the deployed build predates v1.4.28: apply migration 0014 and redeploy

### Deploy

- `npx wrangler deploy` (duplicate guard) → rebuild site. Migration 0014 required if not yet applied (from v1.4.28)

## [1.4.28] — 2026-07-31 — CEO attendance corrections & back-entry

### Added

- **Attendance corrections panel** in the Attendance tab (CEO + admin tier): view every staff punch for a month, **amend a wrong clock in/out time**, **remove** a bad record, or **add clock in/out for past days** — covering days staff worked before this system existed. Times entered in Malaysia time; stored UTC like real punches
- **Honest trail**: migration 0014 adds manual_by / amended_by / amended_at. Every row shows its mark — _punch_ (a real device punch), _manual_ (back-entered, by whom), or _amended_ (corrected, by whom, when) — and every add/amend/remove is audit-logged. A correction never masquerades as an original punch
- This is the CEO's second deliberate write exception (after birthdays); all other CEO surfaces remain read-only. HR keeps its verification table read-only as before

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0014) → `npx wrangler deploy` → rebuild site

## [1.4.27] — 2026-07-31 — Monthly leave accrual, CEO birthdays fix, clearer overview, dashboard pulses

### Changed

- **Leave releases monthly, not as a lump sum.** Entitlement accrues pro-rata through the year (half-day steps): by end of month M, entitled × M/12 is eligible — e.g. 14 annual days/year ≈ 2 days eligible by end of February. The cards now show **"N eligible now"** big, with the annual total and used count beneath ("14/year · 1 used"), so staff see both the year's total and this month's eligibility. Storage and approvals unchanged; this is how the balance is computed and presented
- **Overview "Documents issued" explained**: renamed to **"Sales documents issued to clients"** with a one-line description, and QT/DO/INV spelled out as Quotations / Delivery orders / Invoices — it counts what the team has created in the Sales module
- **Overview stat tiles sit two-up on phones** (were stacking one per row)

### Fixed

- **Birthdays tab was empty for the CEO** — the staff list endpoint only allowed HR-tier roles, so the CEO's Birthdays (and Overview per-staff data) fetched nothing. The list is now readable by exec_view roles as well; writes still require HR/admin (and the amendment lock still applies)

### Added

- **Dashboard attention cues**: Pending leave and My open tasks show a pulsing amber count badge when something is waiting; Announcements shows a pulsing dot when any exist — the eye lands where action is needed

### Deploy

- `npx wrangler deploy` (balance + users endpoints) → rebuild site. No migration

## [1.4.26] — 2026-07-31 — Bell rings for announcements

### Changed

- **Publishing an announcement now notifies every active staff member** — the bell shows "New announcement: TITLE" for everyone except the poster. Previously announcements only appeared in their own tab; the bell never knew about them
- **Announcement notifications are clickable** — selecting one jumps straight to the Announcements tab to read and acknowledge
- Because this goes through the standard notification path, the **off-platform relay** (NOTIFY_WEBHOOK, when configured) carries announcements too — staff who aren't signed in can still hear about them

### Deploy

- `npx wrangler deploy` (announcement handler) → rebuild site. No migration

## [1.4.25] — 2026-07-31 — Scrollable lists, photo at create, quieter dashboard

### Changed

- **Long lists now scroll inside a fixed height** instead of stretching the page: staff records in Staff Details, leave history and the approval queue, tasks, announcements, birthdays, the HR attendance table, holidays, and the audit trail. Each area stays compact; the page keeps its shape as data grows
- **Dashboard Quick actions no longer shows the shift-rule text** (the 10:00/10:05/13:00/18:00 explanation). The punch still confirms its result after each clock in/out — only the standing rules paragraph is gone

### Added

- **Staff photo at creation**: the add-staff form has a photo picker; the image uploads automatically the moment the account is created (one step instead of create-then-upload). If the photo part fails, the account still exists and the row's Upload photo remains the fallback

### Deploy

- Rebuild site only — no migration, no Worker change

## [1.4.24] — 2026-07-31 — DD-MM-YYYY dates, richer create form, password eye

### Changed

- **Dates display and enter as DD-MM-YYYY** across the staff list and badge (birth date, ID issued). The database keeps ISO (YYYY-MM-DD) — conversion happens at the edge, so sorting, payroll queries and existing data are untouched
- **Blood type returns as record data** (list grid + create form) after being removed in v1.4.22 — that removal was meant for the badge card only. It stays **off the badge**: field label reads "record only, not on badge"

### Added

- **Add-staff form** now captures birth date (DD-MM-YYYY), ID issued (DD-MM-YYYY) and blood type at creation — the create endpoint stores them, so a new person's record is complete in one step
- **Temp password has the show/hide eye** — the shared PasswordInput component used everywhere else now covers the create form too

### Deploy

- `npx wrangler deploy` (create endpoint fields) → rebuild. No new migration

## [1.4.23] — 2026-07-31 — Portrait badge, staff photo, company location

### Changed

- **Badge is now portrait** (54 × 85.6 mm — the ID-1 card rotated, lanyard style): logo on top, photo, name, role chip, details, footer. Preview and print share the layout, both portrait
- **Company location on the badge**: the footer now shows "Setia Tropika, Johor Bahru, Malaysia" above the SSM number and issue date (one constant in the component — COMPANY_LOCATION — if the office ever moves)

### Added

- **Staff photo upload** per row (Upload photo). Stored in R2 under `private/staff-photos/` — serving requires staff sign-in, so photos are not publicly fetchable. Shown in the live preview and printed on the badge; a placeholder box prints if no photo is set
- New endpoint `POST /api/v1/staff/users/:id/photo` (HR tier). The **amendment lock applies**: HR uploads the first photo; replacing an existing one is admin-only, same as record fields. The route reads the raw image stream (exempted from the JSON body parse)
- Migration **0013** — `users.photo_key`

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0013) → `npx wrangler deploy` → rebuild site

## [1.4.22] — 2026-07-31 — Badge preview, amendment lock, badge redesign

### Added

- **Live badge preview**: each staff row has a **Preview badge** toggle that renders the ID card on screen at true size (85.6 × 54 mm), updating live as you type — see exactly what will print before printing. Print uses the identical layout
- **Full name and phone number** on the record and the badge. New `users.full_name` column (migration 0012) holds the name as per IC (e.g. "Mohd Alif Farhan Bin Nazarudin") separate from the short display name; the badge prints the full name and phone

### Changed

- **Amendment lock**: once a field is saved it greys out (🔒) for HR — filling empty fields stays open, but changing a set value is **admin-only** (/admin → Staff). Enforced server-side (the API rejects locked-field changes for non-admin with a clear message), not just visually. Applies to birthdays too, including the CEO's birthday tab
- **Badge uses the AZ ONE OFFICIAL logo** (public/logo.png) instead of the text wordmark
- **Blood type retired** from the form, the record grid, and the badge. The database column stays (append-only schema policy) but is no longer shown or edited

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0012) → `npx wrangler deploy` → rebuild site

## [1.4.21] — 2026-07-31 — Update existing staff from the add form

### Changed

- **"Email already exists" is no longer a dead end.** When the add-staff form hits an existing account, it now identifies who owns the email and offers **"Update NAME's record instead"** — applying the filled-in employee ID, position and department to that account via the normal staff PATCH. So the same form serves both onboarding a new person and completing an existing person's record (e.g. an account created earlier in /admin → Users without employee details)
- Deliberately NOT applied through this path: **role and password.** Roles change in /admin, passwords via the person's own change-password or an admin reset — the update-instead button only touches employee record fields
- If the email belongs to a customer account, the form says so and points to /admin → Users instead of offering the update
- Changing the email field clears a pending update offer, so the button can never target the wrong person

### Deploy

- Rebuild site only — no migration, no Worker change

## [1.4.20] — 2026-07-31 — HR can create staff accounts

### Added

- **Add a staff member** form at the top of the Staff Details tab (hr_admin / coo / cco + admin tier). HR onboards staff directly — email, name, staff role, optional employee ID / position / department, and a temporary password — via a new HR-scoped endpoint `POST /api/v1/staff/users`. The list then populates with the new person
- The endpoint is deliberately scoped: HR can create **staff roles only** (editor, marketing, live_host, hr_admin, sales_marketing, ceo, coo, cco) — never admin, super_admin, or customer. Those remain in /admin → Users. Same escalation logic as everywhere: onboarding power without privilege-granting power

### Why not auto-populate from the domain

- azoneofficial.com is not on Google Workspace, so @azoneofficial.com addresses are not Google accounts and there is no company directory to import. Staff must be created (here or in /admin) — the form makes that a one-step HR action. The note in the form explains this to whoever is onboarding

### Deploy

- `npx wrangler deploy` (new endpoint) → rebuild site. No migration

## [1.4.19] — 2026-07-31 — Staff Details tab for HR

### Added

- **Staff Details tab** in /portal (hr_admin / coo / cco, plus admin tier): the staff directory as its own dedicated tab instead of being appended to the bottom of the HR tab. Shows the full staff list with editable employee ID, position, department, birth date, ID issue date and blood type — and the government-size ID badge print. Birth date is now an editable field in the record (it flows to the Birthdays view and back)

### Changed

- The staff directory was removed from the foot of the HR tab (it now has its own tab) to keep the HR tab focused on attendance, task reports and leave

### Deploy

- Rebuild site only — no migration, no Worker change (the /users list + PATCH already carry these fields)

## [1.4.18] — 2026-07-31 — Profile layout, CEO birthdays, mobile view, exec summary

### Changed

- **Profile no longer wastes space.** It was a single narrow column with a tall change-password form beneath, leaving the right side empty. Now a two-column layout (details grid + phone on the left, change password on the right) that stacks on mobile
- **CEO can manage staff birthdays.** A dedicated **Birthdays** tab (CEO + hr_admin/coo/cco) lets the CEO set and view birthdays directly — their one write exception to read-only, already permitted by the API
- **Mobile view** across /admin, /portal, /account: tab bars scroll horizontally instead of stacking into a tall block; wide tables (attendance, audit, task progress) scroll sideways; stat grids use two columns on phones; headers tighten. Content already reduced to less padding in v1.4.5/1.4.16

### Added

- **Executive summary** for CEO / COO / CCO in the Overview tab: company-wide **task progress** (open / pending / closed totals plus per-staff open and done counts) and **inventory status** breakdown for monitoring, on top of the existing attendance / leave / documents / pipeline figures. `/api/v1/staff/overview` now returns task_summary, task_by_staff, and inventory_status

### Deploy

- `npx wrangler deploy` (overview endpoint) → rebuild site. No migration

## [1.4.17] — 2026-07-31 — Staff directory reaches HR; save feedback

### Fixed / Changed

- **hr_admin (and coo/cco) can now fill in employee ID, position, department and badge details.** The staff directory + ID badge tool previously lived only in /admin (super_admin/admin). It is now also in the portal **HR** tab, so hr_admin manages it in their own interface. The API already permitted them (`hr_manage` includes hr_admin) — only the UI was missing
- The directory component moved to a shared location (`components/staff/staff-directory.tsx`) so /admin and /portal share one implementation
- **Save now reports failure.** A failed field save was silent; it now shows "Save failed — check access" so the cause is visible instead of looking like nothing happened

### Note

- If the Staff tab still shows only leave admin + module cards (no editable employee fields), the deployed build predates v1.4.15 — deploy this build to get the directory and badge tool

## [1.4.16] — 2026-07-31 — Payroll, calendar, audit viewer, document PDFs

### Added

- **Leave entitlement editor** (/admin → Staff): set days per staff per type per year. Balances already deduct approved leave from these numbers — this gives them a source instead of a hardcoded default. Confirmed the deduction works: the balance endpoint computes entitled − approved-days-used
- **Public holidays / company calendar** (`/api/v1/staff/holidays`, HR-managed): dates staff can see, and a basis for leave day-counting and attendance so a holiday is not treated as a working day
- **Payslip / payroll summary** (`/api/v1/staff/payslip`): per-staff monthly attendance breakdown (days present, on-time, late, half-days, early-outs) plus approved leave days — viewable in /admin → Staff and printable at A4
- **Audit-log viewer** (/admin → **Audit**, admin tier): a window onto the trail every action already writes — sign-ins, leave approvals, role changes, password resets, suspensions — with filter chips and MYT timestamps. No new logging; this surfaces what existed
- **Off-platform notifications**: `notify()` now also posts to an optional `NOTIFY_WEBHOOK` relay (email/WhatsApp) when configured, so leave approvals and task assignments can reach people who are not signed in. No-op until the webhook var is set — safe to ship first
- **Document PDFs**: QT/DO/INV can be printed as branded A4 documents (company mark, SSM number, line items, totals, customer block) from /portal → Sales → **PDF**. Backed by a new single-document endpoint `GET /api/v1/staff/docs/:id`

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0011) → `npx wrangler deploy` → rebuild site
- Optional: set `NOTIFY_WEBHOOK` (a Worker var / secret pointing at your email or WhatsApp relay URL) to turn on off-platform delivery

## [1.4.15] — 2026-07-31 — Badges, self-tasks, attendance policy, leave approval chain

### Added

- **Staff ID badge** at government card size (85.6 × 54 mm, ISO/IEC 7810 ID-1): /admin → Staff → Staff directory → **Print badge**. Admin sets employee_id, position, department, issue date, blood type per person; the badge prints at true dimensions with the company mark and SSM number
- **Admin sets employee fields** (employee_id / position / department + badge extras) inline in the new Staff directory
- **Staff create their own tasks** with a deadline and status (open / pending / closed). Managers can still assign to others; a plain staff member self-assigns
- **Customer enquiries from /account** — an "Ask AZ ONE OFFICIAL" box posts a question tied to the signed-in customer's name and email (`POST /api/v1/account/enquiries`), and the thread shows below
- **Attendance CSV export** for payroll stays (hr_admin/coo/cco/admin)

### Changed

- **Attendance policy** (lunch not monitored — break in/out removed). Clock rules in Malaysia time: clock-in ≤10:00 on time · after 10:05 late · from 13:00 half day; clock-out 13:00 half day · before 18:00 early out · 18:00 completed. The dashboard confirms the result after each punch and prints the rule
- **Leave approval chain** replaces single approve/reject:
  - Staff: applied → HR review → CCO/COO pre-approve → CEO final approve
  - COO/CCO applicant: applied → HR review → CEO final approve (skips pre-approval — no self-tier approval)
  - Reject at any stage ends the request; the owner may cancel while it is still moving. No one reviews their own request. Each stage records its actor for a full audit trail
  - Reviewers see only requests currently at a stage they can act on; the button label reflects the stage (Mark reviewed / Pre-approve / Final approve)
- **Staff birthdays** may be maintained by hr_admin, coo, cco (via HR) and by ceo (birthday-only exception to CEO read-only)
- **Reduced white space** across /admin, /portal, /account (tighter padding, wider content columns)

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0010) → `npx wrangler deploy` → rebuild site

## [1.4.14] — 2026-07-31 — Role model overhaul

### Changed — roles (breaking; migration required)

- **Reduced to 11 roles.** Removed managing_director, business_dev, finance_admin, live_manager. Migration `0009_role_cleanup.sql` reassigns any existing holders (MD→admin, business_dev→cco, finance_admin→hr_admin, live_manager→live_host) and tightens the users.role CHECK constraint to the final set
- **editor / marketing moved fully to /portal** as task/pipeline roles with **no inventory visibility**; website and content editing now require **super_admin or admin** only (they left the content team)
- **hr_admin** gains **attendance CSV export for payroll** (`GET /api/v1/staff/attendance/export?month=YYYY-MM`, MYT-converted, shift-flagged) alongside docs (QT/DO/INV), leave, birthdays, task reports
- **sales_marketing** keeps inventory/postage/materials; explicitly cannot see editor/marketing work
- **ceo** is read-only across all role features (except admin/super_admin surfaces) — **no write**; leave decisions and suspensions stay with the admin tier (the drafted CEO kill switch was declined)
- **coo & cco** are now identical HR-level oversight roles: docs, leave, attendance CSV, and task view across roles (excluding CEO exec data). Their earlier Operations/Commercial modules are retired; those endpoints remain reachable to the admin tier only
- Login routing, /admin and /portal gates, role dropdowns, and portal tab gating all updated to the new set

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0009) → `npx wrangler deploy` → rebuild site. 0009 rewrites the users table (data preserved) and reassigns removed roles — review /admin → Users afterwards

## [1.4.13] — 2026-07-31 — Complete interface separation (audited)

### Fixed — interface boundaries

- **/portal now redirects content-only roles (editor, marketing) to /admin.** Previously it only bounced customers, so a content role opening /portal saw a staff surface it had no modules for. admin/super_admin are intentionally allowed through, since they open portal modules from the admin Staff bridge
- **/account now bounces any non-customer to their own interface** (staff → /portal, content team → /admin). Previously any signed-in role could view the customer area

### Verified — the security boundary (already correct, now documented)

This release is mostly an audit. Every role was checked against every interface. The data protection was already enforced server-side and did not depend on the redirects:

- `/api/v1/staff/*` rejects customers at the entrance, then each module endpoint checks its own permission (`hr_manage`, `inventory`, `bd_manage`, `ops_manage`, `exec_view`, `task_reports`) — a staff role cannot read or write another function's data even by calling the API directly
- content/dashboard/media/CRUD endpoints require `isContentTeam` (super_admin, admin, editor, marketing) — no staff role can reach content management
- `/account/*` endpoints check per-user ownership; password accounts see only enquiries created after their own registration, so no one can register a stranger's email to read their history
- Interface redirects are user-experience and defence-in-depth; the API checks are the actual boundary. Both now agree for every role

### Role → interface map

- **/admin**: super_admin, admin, editor, marketing
- **/portal**: ceo, coo, cco, managing_director, hr_admin, sales_marketing, business_dev, finance_admin, live_manager, live_host (admin/super_admin may deep-link in via the Staff bridge)
- **/account**: customer

## [1.4.12a] — 2026-07-31 — Docs: session integrity after the backdoor fix

### Documentation

- SECURITY.md now answers directly whether sessions must be cleared after the v1.4.12 fix: yes for backdoor-era sessions (handled by the recovery sequence's password resets + Force logout), no for stored data — the flaw was authentication, not data. Confirmed by audit that the session lifecycle is otherwise correct: hashed tokens, expiry + active-user re-checks per request, automatic purging, and session revocation on every password change / reset / suspend

## [1.4.12] — 2026-07-31 — SECURITY: hardcoded master password removed from login

### Security — critical

- **The login handler contained a hardcoded universal password**: any active account, including super admin, could be signed into with a fixed literal string, bypassing password verification entirely. This backdoor is removed — login now verifies only the account's real stored password. Discovery came through symptoms: sign-ins with the master string succeeded, while change-password (which checks the real hash and has no backdoor) reported the current password as incorrect
- **Follow-up required after deploying**: (1) the string lived in the repository, so treat it and any account password that may have been shared alongside it as compromised — reset account passwords via /admin → Users; (2) Force logout all accounts to end any session created via the backdoor; (3) if the string was reused anywhere else, rotate it there too. The recovery order that avoids locking yourself out is in SECURITY.md

## [1.4.11] — 2026-07-31 — Full admin authority: Staff tab in /admin

### Added

- **Staff tab in /admin** (admin + super admin): direct **leave administration** — every request (annual/medical/emergency/unpaid/replacement) with a pending queue, approve/reject with an optional comment the requester sees, decision history, and a pending counter. Uses the same guarded API as the portal (`hr_manage`), so every decision stays audit-logged and notifies the staff member
- A **staff-modules bridge** in the same tab: admin accounts hold full rights in every portal module (HR attendance verification, inventory/postage, commercial pipeline, operations, overview) — the bridge opens them in /portal, where they live

### Security model (unchanged, now written down)

- Admin authority is granted by explicit server-side permission sets, not by the interface: `hr_manage` includes admin and super admin, every approval is audit-logged, escalation guards keep super admin above admin, and the v1.4.9 separation still bars staff roles from /admin. Full authority and containment are the same design, viewed from opposite sides

## [1.4.10] — 2026-07-31 — Fix: change-password showed a generic error for every failure

### Fixed

- The change-password form compared the API's nested error object (`{error:{code,message}}`) against plain strings, so no specific case ever matched and **every** rejection displayed "Could not change the password" — hiding the actual reason (most commonly a wrong current password). The form now reads the nested code, names the wrong-current-password case explicitly (with a hint to use the eye icon), and falls back to the server's own message for anything else. Same bug class as the v1.4.7 admin-create fix; a repo-wide search confirms no other form misreads the error shape

## [1.4.9] — 2026-07-31 — Role/interface separation, MYT attendance display, password UX

### Fixed — data integrity

- **Staff roles could enter /admin.** The login router's staff list predated v1.4.4 (missing cco, ceo, hr_admin, sales_marketing), so those roles fell through to /admin; the /admin page only turned away customers; and content endpoints were guarded by rank, which rank-1 staff roles satisfied. Now enforced at all three layers: the login router's staff list is complete; /admin redirects every portal role to /portal; and content/dashboard/media/CRUD endpoints require the content team explicitly (super_admin, admin, editor, marketing) via `isContentTeam` instead of rank — staff roles keep their own /portal modules and permissions, and cannot read or write content management data even by calling the API directly

### Fixed — attendance timezone

- **Clock in/out now displays in Malaysia time (Asia/Kuala_Lumpur).** Timestamps are stored in UTC (correct for storage) but were shown raw — a 10:00am MYT clock-in read 02:00. Portal dashboard and Attendance tab now format in MYT (labelled), and the "Today" grouping uses the Malaysian calendar day. HR's verification table already reported MYT + shift flags (v1.4.4); the staff-facing views now match

### Added — password UX

- **Eye (show/hide) toggle on every password box**: change-password form (all three fields), admin Add user, admin Reset password — one shared `PasswordInput` component, matching the login page
- **Customers can change their password** in /account (shared form; Google accounts get a clear explanation)
- **docs/PASSWORD-GUIDE.md** — who changes what where: staff (portal Profile), admin team (/admin Account), customers (/account), and the admin reset procedure with handover guidance

## [1.4.7] — 2026-07-31 — Fix: false "Email already exists" for new roles

### Fixed

- **Creating a user with a v1.4.4 role (cco, ceo, hr_admin, sales_marketing) failed with "Email already exists" even for brand-new emails.** Two bugs stacked: (1) migration 0007 added the new roles to the code but the users table still carried the 0004-era CHECK constraint listing only the old roles, so the insert was rejected by the database; (2) the API's catch-all translated _every_ insert failure into an email conflict, so the true cause was hidden. Migration `0008_expand_role_check.sql` rebuilds the users table with the full role list (all data preserved — 0004's own rebuild pattern, plus the 0007 `birthday` column); the API now checks the email conflict explicitly and reports any remaining database rejection as what it is, with the fix in the message; the admin form displays the server's actual error instead of guessing

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0008) → `npx wrangler deploy` → rebuild site. Until 0008 runs, creating users with the new roles keeps failing — now with an honest message saying exactly that

## [1.4.6] — 2026-07-31 — Admin password reset

### Added

- **Reset password** action per user in /admin → Users, for forgotten passwords. Inline field (10+ characters), uses the existing guarded `PATCH /users/:id` — the server hashes the new password and revokes every session the user had, so the old credential is dead the moment the new one is set. Escalation guards from v1.4.3 apply unchanged: an admin cannot reset a super admin's password
- Guidance shown in the flow: hand the new password over directly (WhatsApp / in person) and have the user change it themselves in Profile after signing in

## [1.4.5] — 2026-07-31 — Admin matches the website; friendly editing

### Added

- **Website tab in /admin** — a labelled editor for the live site's text: hero headline and sub-headline, both About paragraphs, Services and Showcase section headings/intros, footer strapline, and the statistics list. Every field names where it appears on the page, saves individually with a visible "Saved ✓", and an empty field simply means the site shows its built-in default — an editor cannot break the page from here. Content flows through the existing CMS (site_content → Editable), so changes appear on the next page load with no rebuild
- Homepage Services and Showcase section headings/intros are now CMS-backed (previously hardcoded)
- A plain-language purpose line under the tab bar for every admin tab

### Changed

- **Products tab removed from /admin** — the site has no /products routes any more, so that tab edited data nothing rendered; this desync is what made the admin feel disconnected from the webpage. The raw key/value editor is retained as the **Advanced** tab for anything the Website tab does not cover
- Dashboard cards now reflect the real site: the permanent "0 Products" card is replaced by Portfolio items; the summary endpoint counts portfolio_items instead of products
- Tab order regrouped around daily work: Dashboard, Website, Enquiries, Portfolio, Testimonials, Posts, Media, Users, Account, Advanced

### Note

- The screenshot reviewed was v1.4.2 in production — the Account tab (change password), kill switch, and the five staff role modules shipped in v1.4.3/v1.4.4 and appear after this build is deployed

## [1.4.4] — 2026-07-30 — Company role modules

### Added

- **Five business roles with their own portal modules**, assignable from /admin → Users and enforced server-side:
  - **HR & Administrative** (`hr_admin`) — HR tab: attendance verification table for all company accounts with every event flagged against the working shift (10:00am–6:00pm MYT, Mon–Fri: ok / late / early out / weekend); daily/weekly/monthly task reports; staff birthdays. Leave administration in the Leave tab (Annual/Medical/Emergency approve/reject); QT/DO/INV creation in the Sales tab
  - **Sales & Marketing** (`sales_marketing`) — Inventory tab: real-time stock with auto status (in_stock/low/out_of_stock), postage tracking records (preparing→shipped→in_transit→delivered/returned), and a marketing-materials request pipeline
  - **Chief Commercial Officer** (`cco`) — Commercial tab: business development pipeline with the exact statuses requested (open / pending / KIV / closed won / closed lost) plus per-deal strategy and next action
  - **Chief Operation Officer** (`coo`) — Operations tab: daily operational status + daily sales results (one report per day; resubmitting updates it) and operation strategy for sales & marketing
  - **Chief Executive Officer** (`ceo`) — Overview tab: read-only monitoring of the whole company (clocked-in count, pending leave, documents issued, low stock, BD pipeline, latest ops report). Deliberately no edit rights
- All staff roles clock in/out in the existing Attendance tab and apply for Annual/Medical/Emergency leave in the Leave tab
- Migration `0007_role_modules.sql`: inventory_items, postage_records, material_requests, bd_pipeline, ops_reports, task_reports, users.birthday

### Changed

- **Document numbering** now `{TYPE}-AZOO{DDMMYY}-{X}` (e.g. `QT-AZOO300726-1`), running number per type per Malaysian business day. Previously issued numbers are untouched — see DOCUMENT-NUMBERING.md history
- `/attendance/report` annotates each event with Malaysia time and a shift flag so HR verifies at a glance
- Role lists, portal tab gating, and the admin role dropdown extended accordingly

### Deploy

- `npx wrangler d1 migrations apply azoneofficial --remote` (0007) **before** `npx wrangler deploy`, then rebuild the site

## [1.4.3] — 2026-07-30 — Admin control, kill switch, self-service passwords

### Added

- **Kill switch for suspicious accounts.** Two levels in the admin Users panel:
  - _Force logout_ — revokes every session for the account server-side, instantly, without deactivating it. The first response to "this login looks odd"
  - _Suspend_ — blocks sign-in AND revokes all sessions in one action (with a confirm dialog); a suspended badge shows on the account; _Reinstate_ undoes it. Endpoint: `POST /api/v1/users/:id/revoke-sessions`; suspension audit-logged as before, force-logout logged as `user.force_logout` with the session count
- **Change-password interface** for every signed-in user: an **Account** tab in `/admin` and a section inside the portal **Profile**. Requires the current password, enforces the 10+ character minimum, and on success revokes every _other_ session — a stolen session dies the moment the password rotates — while re-issuing the current browser's session so the user isn't logged out by their own change. Google-only accounts get a clear explanation instead of a cryptic failure (they manage credentials with Google; letting a hijacked session ADD a password would hand an attacker a permanent way in). Endpoint: `POST /api/v1/auth/change-password`

### Changed

- **`admin` role now has full user management** (previously super-admin-only): view, create, role changes, suspend/reinstate, force logout, admin-set passwords — with escalation guards enforced server-side: an admin can never modify a super admin, create or grant `super_admin`, or change their own role. The Users tab is now visible to admins; super-admin-only options are hidden from their role menus and the API rejects them regardless
- Self-deactivation remains blocked; deactivation and admin password resets still revoke the target's sessions

## [1.4.2] — 2026-07-30

### Fixed

- **`/api/v1/auth/google` 404 in production.** The Worker had no route bound to the domain, so `/api/*` fell through to the static Pages site, which has no such path. `worker/wrangler.toml` now declares `azoneofficial.com/api/*` (and `www.`) routes, so `wrangler deploy` attaches them automatically — the manual dashboard step that was missed can no longer be missed

### Added

- `docs/AUTH-SETUP.md` — the complete path from 404 to working Google login: deploy checklist (migrations → secrets → vars → deploy), exact Google Console origin/redirect values, what happens on first login for `@azoneofficial.com` staff vs customers, verification commands, and the www cookie caution

### Notes

- No application code changed. Staff auto-provisioning already worked as designed: company-domain Google logins create active staff accounts (role `marketing`, admin-elevatable); other emails create customer accounts

## [1.4.1] — 2026-07-29 — Shopee Live added to the live showcase

### Added

- **Shopee channel panel** in the homepage live showcase, alongside the TikTok embed. Shows the shop handle (`shopee.com.my/azoneoff`), what a Shopee session includes, and a "Watch on Shopee Live" CTA. `LIVE_SHOWCASE.shopeeLiveUrl` set; leaving it `""` hides the panel and the TikTok embed spans the section
- Section restructured into two equal-height channel panels (`items-stretch` + `h-full`), each carrying its own full-width CTA at the base so the two columns align

### Notes — why Shopee is a card and not an embed

- Shopee sends `X-Frame-Options` / `frame-ancestors` headers that block its shop and live pages from being framed by another site, and publishes no embed or oEmbed API. An `<iframe>` would render blank or refuse to load, so the panel is a branded card that links straight to the shop, where the live badge appears during a session
- TikTok's official creator embed is used on its side because TikTok does publish one — the asymmetry is a platform limitation, not a design choice
- Neither platform exposes a public "live now?" API, so both CTAs are written to read correctly whether or not a session is running. The constraint is documented in `LIVE_SHOWCASE` so it isn't re-litigated later
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.4.0] — 2026-07-29 — Live embed, problems section, ELFIA into Portfolio

### Added

- **TikTok embedded on the homepage.** The live showcase now embeds the official TikTok **creator widget** for @azoneofficialhq — the account with its latest videos, always current, no manual updates. Platform constraint stated in-code: a LIVE stream itself cannot play inside another website (TikTok blocks the /live page in iframes) and no public live-status API exists; the gold "Watch us live on TikTok" CTA carries that job via the self-routing /live URL. `LIVE_SHOWCASE.videoUrl` still overrides the widget with one specific video if ever wanted
- **"The problems we solve, live"** (`components/home/problems.tsx`) — four equal-weight pain→solution cards between About and Services: nobody bought / no team or time / views without conversion / content dies after the stream. Copy in `PROBLEMS` (`constants/content.ts`)
- **Client logo strip in the hero** — "Brands we run live for" with a generated temporary ELFIA serif wordmark (`public/clients/elfia-wordmark.svg`, gold underline accent) linking to elfiaofficialstore.com. Swap the SVG for the official logo when supplied; no code change needed

### Changed

- **Navbar CTA:** "Book a consultation" → **"Get a free live audit"** (`CTA_LABEL`); the matching FAQ answer updated
- **Hero subheadline** no longer names ELFIA in text — the clause "featured client ELFIA, a premium hijab label" is replaced by the logo strip
- **ELFIA folded into Portfolio.** The standalone `/portfolio/elfia` page is removed (301 → `/portfolio`); the ELFIA portfolio card is now clickable and opens **elfiaofficialstore.com**. The "ELFIA" navbar item is removed (nav: About, Services, Packages, Portfolio, Blog, Contact). `/products` legacy redirects retargeted to `/portfolio`. The challenge/approach/result write-up remains available on `/case-studies`
- `PortfolioItem` gained an optional `href`; cards render as external links when set

### Notes

- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.3] — 2026-07-29 — Live showcase section on the homepage

### Added

- **`components/home/live-showcase.tsx`** — new dark section between the session showcase and the process steps: "See a live session, live". Gold CTA "Watch us live on TikTok" points at `tiktok.com/@azoneofficialhq/live`, which TikTok itself routes to the live room during a session and to the profile otherwise — correct in both states with no status detection. Optional Shopee Live button appears when `LIVE_SHOWCASE.shopeeLiveUrl` is set
- **Process video slot** using TikTok's official video embed (blockquote + embed.js). Configured by `LIVE_SHOWCASE.videoUrl` in `constants/content.ts`; while it is unset (current state) or while the embed is still loading, a styled preview card renders instead — the section never shows a broken player
- `LIVE_SHOWCASE` constant block documenting the platform constraint: TikTok/Shopee LIVE streams cannot be embedded on external sites and there is no public live-status API a static export could poll — the /live URL carries that job

### Action needed

- Set `LIVE_SHOWCASE.videoUrl` to the TikTok video that best shows the AZ ONE process (session highlight / behind-the-scenes); optionally set `shopeeLiveUrl`

### Notes

- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.2] — 2026-07-29 — ELFIA removed from the landing page

### Changed

- **Homepage no longer carries the ELFIA showcase section** (dark section with slogan and product gallery). A full brand section with product imagery on the agency's own landing page still read as a house line; a prospective client should meet ELFIA as _proof_, not as a product. The homepage now runs Hero → About → Services → Packages → Showcase → Process → FAQ → CTA
- ELFIA remains presented as the existing successful client everywhere it counts: the hero subheadline mention, the "Operators, not observers" trust signal, the FAQ answer, the nav item, /portfolio, /case-studies, and the full case study at `/portfolio/elfia` (which keeps the work gallery — showing client work in a case study is the point)
- **ELFIA's own landing page is elfiaofficialstore.com** — the case-study outbound link and the customer-area "ELFIA drops" card now point there (previously elfia.com.my)
- `components/home/elfia.tsx` deleted (no longer referenced)

### Notes

- `/products` 301s and the `ELFIA` nav → `/portfolio/elfia` routing from v1.3.0 are unchanged
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.3.1] — 2026-07-29 — ESLint build errors fixed

### Fixed

Cloudflare Pages runs ESLint as part of `next build`; 14 rule violations caused the build to fail with exit code 1. All fixes are semantically equivalent — no copy, layout, or logic changed.

- `react/no-unescaped-entities`: apostrophes and quotation marks in JSX text replaced with HTML entities (`&apos;`, `&ldquo;`, `&rdquo;`) in `app/careers/page.tsx`, `app/portal/page.tsx`, `app/portfolio/page.tsx`, `app/privacy/page.tsx`, `app/services/page.tsx`, `app/terms/page.tsx`, `components/home/showcase.tsx`
- `@next/next/no-html-link-for-pages`: `<a href="/">` in `app/login/page.tsx` replaced with `<Link href="/">` (Next.js `next/link`); import added
- `@typescript-eslint/no-unused-vars`: `goTo` function in `components/ui/packages-carousel.tsx` prefixed `_goTo` (dots navigation was dropped in v1.2.22; the function was left in but never called)

## [1.3.0] — 2026-07-29 — ELFIA repositioned as client; catalogue removed

Applied directly on the stable v1.2.29 build. **No layout, section sizing,
spacing, animation, or component structure was touched** — this release is
copy, links, data, and one additive page. (The abandoned v1.4/v1.5 workspace
branch attempted the same repositioning with a repo restructure that broke the
deployed layout; this release supersedes that branch from the v1.2.29 base.)

### Changed — business positioning

- **ELFIA is a client of AZ ONE OFFICIAL, not a product.** The agency needs to pitch brands that compete with its clients (including other hijab labels), so nothing on this site may read as AZ ONE selling hijabs itself
- Site description: "Home of ELFIA, our premium hijab brand" → "Featured client: ELFIA"
- Hero subheadline: "home of ELFIA, our premium hijab brand" → "featured client ELFIA, a premium hijab label" (same length band, no layout shift)
- About copy: "We are also a brand owner ourselves" → operator framing (we built and run the client's channel end to end)
- Trust signal "Brand owners, not just an agency" → "Operators, not observers"
- Homepage ELFIA section: eyebrow "Our house brand" → "Featured client"; body rewritten as a channel we built and run; gold CTA now "View the ELFIA case study" → `/portfolio/elfia`. **Markup, grid, gallery, animation, and sizing are byte-identical**
- FAQ "What is ELFIA?" reframed as a client engagement and featured case study
- `SITE_CONFIG.brand.hijab` → `SITE_CONFIG.featuredClient` (the agency owns no product line)

### Added

- **`/portfolio/elfia`** — featured case study (the brand, challenge, approach, result, the work, CTA), built entirely from existing design-system pieces: `PageShell`, `Button`, `ButtonGroup`, `ElfiaGallery`
- **`PORTFOLIO_ITEMS` and `CASE_STUDIES` populated** with the ELFIA engagement — `/portfolio` and `/case-studies` move from "in preparation" empty states to real client work with **zero changes to their page code**

### Removed

- **`/products` and `/products/[slug]`** — an agency site cannot credibly host a product catalogue in a client's category. All catalogue URLs (including the pre-v1.2.11 slugs, via chained redirects) 301 to `/portfolio/elfia` in `public/_redirects`
- Catalogue routes removed from the sitemap; `/portfolio/elfia` added
- Nav item "ELFIA" now points at `/portfolio/elfia` (label and position unchanged)
- ELFIA gallery centre card links to the case study instead of product pages (same markup); customer-area "ELFIA drops" card now links out to elfia.com.my
- `ELFIA_DROP_STEPS` kept in constants but unused — reserved for hand-off to the standalone ELFIA site

### Notes

- Case study copy is deliberately qualitative; publish figures only with the client's approval
- Not built in this environment: run `pnpm install && pnpm build` before deploying

## [1.2.29] — 2026-07-27

### Changed

- **Footer strapline now centres under the logo.** The logo and "LIVE . CONNECT . GROW." were separate block elements in a left-aligned column, so the strapline aligned to the column's left edge rather than to the mark above it. They're now wrapped in an `inline-block` lockup that shrinks to the logo's width, with the strapline centred inside it — so it sits centred beneath the logo regardless of either element's width. The rest of the footer column (slogan, address, CTA) stays left-aligned as before

## [1.2.28] — 2026-07-27

### Fixed

- **`/about` "Why brands choose us" left a third of the frame empty.** `PageShell` carried a blanket `[&_section>ul]:max-w-3xl` rule, added in v1.2.13 to keep bullet lists readable — but it also caught _card grids_, capping them at 768px inside the 1152px frame. The rule now excludes lists that are themselves layouts (`:not([class*=grid]):not([class*=flex])`), so prose lists stay readable while grids use the full width. Cards go from ~243px to ~355px each. Same fix applies anywhere a grid list sits directly inside a section

### Changed

- **Footer strapline is now clearly subordinate to the logo.** "LIVE . CONNECT . GROW." rendered at `text-xs` with `0.35em` tracking — roughly 256px wide against a logo drawing only ~107px, so the strapline dominated the mark. The logo is now `h-12` (~161px wide) and the strapline `9px` at `0.08em` tracking (~150px), so it sits narrower than the logo above it, matching the lockup used in the OG banner

## [1.2.27] — 2026-07-26

### Fixed

- **Refresh a product page, then press Back → landed on the wrong homepage section.** v1.2.23's scroll memory only restored on in-app `popstate` events. But once a product page has been _reloaded_, the client router cache is gone, so Back becomes a **full document load** (`navigation.type === "back_forward"`), not an in-app navigation — the restore never ran, and the browser's own restoration clamped to a shorter, still-loading document, dropping the visitor at About instead of ELFIA.
  Both halves now handle that case: the inline script takes over restoration on `back_forward` loads _only when a stored offset exists for that path_, and `ScrollMemory` treats a `back_forward` document load the same as a popstate, applying the offset once the page is genuinely tall enough. Control is handed back to the browser (`scrollRestoration = "auto"`) as soon as the restore completes, so ordinary navigation is unaffected
- Layout-settle window widened from ~1s to ~1.5s for slower connections

### Changed

- **Product breadcrumb given a proper position.** It sat inside the main content block below ~96px of top padding, floating in empty space. It now has its own compact strip directly under the navbar, separated by a hairline rule, using a semantic `<ol>` with a chevron separator, `aria-current="page"`, and truncation so long product names don't wrap on mobile. Content padding reduced accordingly (`py-16/24` → `py-12/16`)

## [1.2.26] — 2026-07-26

### Changed

- **ELFIA English strapline** is now _At First Sight. Forever in Your Heart._ (was "Premium hijabs, born live"). It reads as the meaning of the Malay slogan rather than a competing line, so the two are presented as a pair: _Dekat Di Mata, Menarik Di Hati_ leads in gold, with the English beneath it. Restyled from uppercase label to italic sentence case, since it's now a sentence, not a tag
- `/products` meta description carries both lines

### Added — ELFIA buying experience

- **"How an ELFIA drop works"** on `/products`: a four-step sequence — drop announced, fabric styled live on camera with comments answered, price revealed in-session, checkout through the pinned link. Buying live is unfamiliar to many shoppers, and not knowing what happens if they show up is what stops them joining a session at all
- **Drop alerts via WhatsApp** — "Get drop alerts on WhatsApp" replaces the generic "Ask about ELFIA" CTA, capturing interest between drops with no email service required
- **Product CTAs now prefill context**: `whatsappUrl()` accepts an optional message, so "Ask about this piece" arrives naming the exact product and asking when the next drop is — the enquiry lands qualified instead of as a bare "hi"

## [1.2.25] — 2026-07-26

### Changed

- **Package carousel progress bar now spans the full width of the section** (was capped at 220px and sharing a row with a counter, so it sat oddly to the left)
- **Counter removed** — the bar alone communicates position
- The bar now reflects the carousel's **actual scroll position and visible fraction** rather than the snapped card index: the thumb's width equals the proportion of the track on screen (75% of the bar when 3 of 4 cards are visible, 25% on mobile where one shows), and it moves continuously while dragging instead of jumping between steps. Recalculated on resize so it stays correct across breakpoints

## [1.2.24] — 2026-07-26

### Fixed

- **Product gallery frame no longer mismatches the photo.** `aspect-[4/5]` set the frame ratio, but the `max-h-[62vh]` added alongside it clamped the frame's _height_ while its _width_ stayed at the column width. The frame stopped being 4:5 and became landscape, so the portrait photo could not fill it — leaving a band of empty navy beside the image.
  The frame now has a single source of truth: one fixed `aspect-[4/5]` box sized by `max-width` alone (360px mobile / 400px tablet / 420px desktop), with no height cap. Frame ratio and image ratio can no longer diverge, and the gallery is a predictable fixed size at every breakpoint — roughly 48–58% of viewport height across phone, tablet, laptop, and wide desktop
- Main images given explicit `block` + `object-center` alongside `object-cover` so they always fill the frame regardless of intrinsic dimensions
- Audited every other `aspect-[…]` box in the codebase for the same width/height conflict — none found

## [1.2.23] — 2026-07-26

### Fixed

- **Back from an ELFIA product no longer lands at the top of `/products`.** Root cause: the App Router restores scroll from its own cache, but it does so before the returning page has finished laying out — the saved offset is taller than the document at that instant, so the scroll silently clamps to 0. New `components/ui/scroll-memory.tsx` records the offset per path and, on popstate navigations only, retries across animation frames until the document is genuinely tall enough to honour it. Forward navigation still starts at the top, and reload still starts at the top (unchanged inline script)
- **Product gallery was oversized.** The 3:4 main image filled a half-page column, running taller than the viewport on laptops and pushing the price/CTA block below the fold. Now 4:5, capped at `62vh`, with the gallery constrained to 380px (440px at desktop) — roughly half the viewport height on a phone and ~60% on a laptop

### Changed

- **Package carousel affordance replaced.** The "Swipe or drag to see all 4" sentence was instructional and read awkwardly on desktop, where nobody swipes. Replaced with self-evident cues: a right-edge fade that shows only while more cards remain, a progress bar, and a plain "2 of 4" counter. Card width at desktop widened the peek so a sliver of the next tier is always visible
- Carousel track is now keyboard-focusable (`tabIndex={0}` with a descriptive label), since removing the arrows left keyboard users without a way to move it

## [1.2.22] — 2026-07-26

### Added

- **ELFIA brand slogan** — _Dekat Di Mata, Menarik Di Hati_ — added as `ELFIA.slogan` and displayed on the homepage ELFIA section and `/products`, leading above the English tagline. Also carried into the "What is ELFIA?" FAQ answer and the `/products` meta description
- **Professional product gallery** (`components/ui/product-gallery.tsx`) on ELFIA product pages: one large main image with a thumbnail strip, swipe on mobile, image counter, neighbour preloading. Replaces the 2-column grid, which showed every angle at once and left none of them large enough to judge fabric drape

### Changed

- **ELFIA aligned as a hijab brand everywhere.** Audited every file: "our premium fashion brand" → "our premium hijab brand" (hero + site description), "premium fashion label" → "premium hijab label" (About copy), `SITE_CONFIG.brand.fashion` → `brand.hijab`, keyword "ELFIA fashion" → "ELFIA hijab", `/about` meta description, and README
- **Package carousel is now scroll-only** — the `< >` arrows are gone. Swipe on touch, and pointer drag-to-scroll on desktop (mice can't swipe, and with no arrows they need a way to move the track), with clickable dots and a "Swipe or drag" hint
- **Button widths fully standardised.** `Button` now renders a real `<button>` when `href` is omitted, so the contact form submit — the last hand-rolled CTA, at `h-11` with no minimum width — uses the shared metrics. Both ELFIA pages' CTA pairs moved to `ButtonGroup` for equal widths. Audit confirms no hand-rolled button-like elements remain on public pages
- **`/about` rebuilt to remove dead space.** It was a single narrow column inside the 6xl frame, leaving the right half empty. Now the story runs left with a "short version" facts panel alongside, "Why brands choose us" is a 3-column grid at desktop, and the closing text link became a proper CTA pair

## [1.2.21] — 2026-07-26

### Changed

- **Package tiers are now a carousel** (`components/ui/packages-carousel.tsx`) on both the homepage and `/packages` — one card at a time on mobile, two on tablet, three on desktop, with arrows and dots. Replaces the four-across grid, which was a long stack on phones and a dense wall on desktop. Built on native scroll-snap rather than the ELFIA coverflow transform: these cards are text, and scaled/partial neighbours would hurt readability. Deliberately not autoplaying — package details need reading time
- The `/packages` comparison matrix is unchanged and still desktop-only

### Fixed

- **Refreshing no longer restores the old scroll position.** Browsers restore scroll on reload, so a refresh mid-page left visitors where they were instead of at the top. A pre-paint script in `app/layout.tsx` now sets `history.scrollRestoration = "manual"` for reloads only, jumps to the top on load, then immediately hands control back to the browser
- **Back navigation still returns you to where you were** — critically, that means tapping an ELFIA product and pressing back lands on the ELFIA section, not the top of the page. `scrollRestoration` is a property of the history _entry_, so leaving it on `"manual"` would have disabled that; it's reset to `"auto"` straight after the reload jump
- URLs with a `#anchor` are left alone, so in-page links (e.g. `#packages`) still work
- Reload jump is instant rather than animated: `html { scroll-behavior: smooth }` was making the correction visibly scroll. A `data-scroll-reset` attribute disables smooth scrolling for that one moment

## [1.2.20] — 2026-07-26

### Changed — information architecture

- **Packages moved to a dedicated `/packages` page.** They were appended to `/services`, which mixed two different questions: "what can you do for me?" (capability) and "what do I get and what does it cost?" (commercial). Separating them means each page answers one question, and a prospect can be sent a direct link to `/packages` from WhatsApp — the primary sales channel
- **`/services` now ends with a short "How we package this" strip** linking to `/packages`, instead of duplicating the tier cards
- **Homepage packages section** now leads to `/packages` ("Compare packages") rather than repeating the detail
- **Navigation**: `Packages` added; `FAQ` moved out of the primary nav to keep it at seven items. FAQ remains reachable from the homepage FAQ section link and is now an explicit footer link
- FAQ content split by intent: homepage shows the five general questions, `/packages` shows the six cost/logistics questions, `/faq` still shows all twelve

### Added

- `PACKAGE_MATRIX` + comparison table on `/packages`: sessions, hours, host, reporting, creative, consultation, on-site, WhatsApp support across all four tiers. Desktop only — the tier cards already carry the same information on mobile, where a five-column table is unusable
- `FaqList` gained an `offset` prop so a page can render a specific slice of the FAQ set
- `/packages` added to the sitemap

## [1.2.19] — 2026-07-26

### Changed

- **Carousel photos are now tappable.** Side cards were `pointer-events: none`, so only the centre image responded. Tapping a side photo now brings it to centre; tapping the centre photo opens its product page (with an `aria-label` and pointer cursor so it reads as interactive). Position dots became real buttons that jump straight to a product, instead of decoration
- **Paired CTAs render at equal width** (`components/ui/button-group.tsx`). `min-w-[180px]` was only a floor, so "Get a free live audit" and "See packages" came out different sizes. `ButtonGroup` lays them out in equal-fraction columns — every button matches the widest in the group. Applied to hero, closing CTA, and the packages section
- **Floating buttons aligned.** The back-to-top button was 44px and the WhatsApp button 48px at the same right offset, so their centres didn't line up; back-to-top is now 48px and both share the same right offset at every breakpoint, with the WhatsApp button exactly one button + 12px gap above
- **Homepage FAQ shortened to 5 questions** with a "See all questions" link to `/faq`. With the six new cost FAQs the list had grown to 12 accordions — a long scroll on a phone for a section near the bottom of the page. `/faq` still shows all 12; `FaqList` takes an optional `limit`
- FAQ accordions now start fully collapsed (the first item was open by default), so the section occupies less of a mobile screen on arrival
- **Homepage testimonials trimmed to 3** of 7, for the same reason

## [1.2.18] — 2026-07-26

### Fixed — credibility (highest priority)

- **Homepage no longer renders "0+ / 0 / 0x".** The About counters animated up from 0 toward placeholder targets (500+ sessions, 12 hosts, 3x GMV) that were never real; on the live site they displayed as zeroes, reading as "an agency with zero experience". `STATISTICS` is now an empty array and `About` falls back to `TRUST_SIGNALS` — SSM registration (202603168673 / JM1046169-H), brand owners via ELFIA, Johor Bahru based team, BM/English hosts. All true on day one, no numbers invented. When real figures exist, repopulate `STATISTICS` and the counters return automatically

### Added

- **Packages published** (`PACKAGES` in `constants/content.ts`, `components/home/packages.tsx`): Starter / Growth / Scale / Enterprise, each with cadence plus hours, live host, reporting, creative, and consultation lines. Shown on the homepage and `/services`. No prices — quotes stay per brand, but visitors can now see scope. ⚠️ Session counts and inclusions are a first draft and need confirming against the real package sheet before launch
- **Floating WhatsApp button** (`components/ui/whatsapp-fab.tsx`), mounted site-wide. Stacks above the back-to-top button and hides over the footer where contact links already exist
- **Six cost/logistics FAQs**: how much, session length and time to results, using your own host, studio, on-site sessions, and whether sales are guaranteed (answered honestly — no guarantee, with what is committed instead)

### Changed

- **Stronger CTAs.** Hero: "Book free consultation" → "Get a free live audit", secondary now "See packages" (anchors to the new section). Closing CTA: single button → "Get a free live audit" + "Book a strategy call", plus an inline "WhatsApp us now" link. `CTA_LABEL` still drives the navbar button

## [1.2.17] — 2026-07-25

### Fixed

- **Carousel autoplay never ran on phones.** The v1.2.16 pause logic was written for desktop input and left the carousel permanently paused on touch devices. Four separate causes:
  1. `touchcancel` was not handled — when the browser converts a touch that starts on the carousel into a page scroll (very common, since the carousel is full-width on mobile) it fires `touchcancel`, not `touchend`, so the pause set in `touchstart` was never cleared
  2. `onMouseEnter` fired from the emulated mouse events touch devices send on tap, while `onMouseLeave` frequently never fired — one tap paused playback for good. Hover pause now applies only to `pointerType === "mouse"`
  3. `onFocusCapture` paused on any focus; Android Chrome focuses the arrow buttons on tap and keeps that focus, so tapping an arrow stopped autoplay permanently. Focus pause now requires `:focus-visible` (keyboard focus), wrapped in a try/catch for browsers without support
  4. Touch pause used the same `paused` flag as hover, so a stuck value from any of the above could not be recovered — swiping now has its own `swiping` state
- Added a 6s watchdog: if paused/swiping somehow persists with no further interaction, playback resumes anyway, so no future event bug can freeze the carousel indefinitely

## [1.2.16] — 2026-07-25

### Added

- **ELFIA carousel autoplay** — advances every 3.5s by default (`autoPlay` / `interval` props on `ElfiaGallery`). Manual arrows, dots, swipe, and keyboard all still work exactly as before and reset the timer on use. Autoplay pauses on hover, on keyboard focus, while swiping, when the browser tab is hidden, and when the carousel is scrolled off screen; it is disabled entirely for `prefers-reduced-motion`. The screen-reader live region switches to `off` during autoplay so it doesn't announce a new product every 3.5s

### Changed

- **Service icons redesigned** for a consistent professional set: 24px grid, 1.5px stroke, round caps, optically centred, geometric — nothing glyph- or emoji-like
  - **TikTok strategy** icon replaced: the target-plus-diagonal-arrow read as a ♂ symbol; it is now concentric rings with a solid centre dot (positioning/targeting, fully symmetric)
  - **Business consultation** changed from a briefcase-with-trend-line to a conversation bubble — the trend line duplicated the bars in the Live commerce management icon
  - Microphone, dashboard, pen nib, and clapperboard redrawn on the same grid with matched proportions
- Icon chips refined to `rounded-xl` at 48px with 22px icons on both the home services section and `/services`, tuned for the lighter 1.5px stroke

## [1.2.15] — 2026-07-25

### Fixed (mobile)

- **iOS input zoom**: contact form fields were `text-sm` (14px); Safari auto-zooms the whole page on focus below 16px. Now `text-base` on mobile, `sm:text-sm` on desktop
- **Footer email overflow**: `admin@azoneofficial.com` (~150px) did not fit the 2-column footer grid on 320–390px screens. Column gap reduced to `gap-6` on mobile, `min-w-0` added, and the address now wraps via `[overflow-wrap:anywhere]`
- **Mobile menu could exceed the viewport** with no way to reach the last items — now `max-h-[calc(100svh-4rem)] overflow-y-auto`
- **ELFIA gallery caption clipped** between ~430px and the `sm` breakpoint (card grew to 400px inside a 420px stage). Stage is now `h-[440px] sm:h-[500px]` and the mobile card caps at `max-w-[260px]`; verified to fit at 320/390/430/600/640/768px
- **Vertical scrolling while swiping the gallery** — added `touch-pan-y` so a vertical drag scrolls the page instead of being captured by the carousel
- **Buttons sat ~16px from overflowing at 320px** — mobile padding reduced to `px-6` (`sm:px-8` unchanged)
- **Back-to-top button** now respects the iOS home indicator via `bottom-[max(1.25rem,env(safe-area-inset-bottom))]`

### Added

- Explicit `viewport` export in `app/layout.tsx`: `viewport-fit=cover` (notched phones) and `theme-color: #1a2946`, so the browser chrome matches the brand on Android/iOS
- `overflow-x: hidden` on `body` as a safety net against stray horizontal scroll (no sticky positioning in use, so no side effects)

## [1.2.14] — 2026-07-25

### Added

- **Back-to-top button** (`components/ui/scroll-to-top.tsx`, mounted site-wide in `app/layout.tsx`) — fades in after ~500px of scroll, hides while the footer is on screen so it never covers footer links, and reappears once the footer scrolls out of view. Footer detection via IntersectionObserver on `#site-footer`; smooth scroll respects `prefers-reduced-motion`; removed from the tab order while hidden

### Changed

- **FAQ**: the accordion was capped at `max-w-3xl` inside the 6xl frame, leaving a large dead area on the right. It now spans the full container width on both the home section and `/faq`; answer text stays capped at `max-w-3xl` for readability
- **Footer spacing tightened**: `py-16` → `py-12`, column gap `12` → `8/10`, CTA `mt-6` → `mt-5`, bottom bar `mt-12` → `mt-10`
- **Footer layout rebalanced**: the brand block and link columns used `md:justify-between`, which pushed them to opposite edges and left a dead centre gap. Now an even 4-column grid (brand spans 2, Explore + Follow us span 2)
- Footer legal links wrap gracefully (`flex-wrap`) instead of overflowing on narrow screens

## [1.2.13] — 2026-07-25

### Changed

- **Page width standardised across the site.** `PageShell` rebuilt on the `/products` frame — `main pt-16` → `mx-auto max-w-6xl px-6 py-16 sm:py-24` → header → content. Every inner page now shares one width and vertical rhythm: /about, /services, /portfolio, /products, /blog (+ posts), /faq, /contact, /careers, /case-studies, /privacy, /terms (was `max-w-3xl` with different top padding)
- Running text is capped at `max-w-3xl` inside the wide frame, so line length stays readable — wide frame, readable measure
- `PageShell` gained `intro` (lead paragraph under the h1) and `dark` (navy background) props; header markup is now identical on every page
- **/faq** rebuilt on `PageShell` — it previously had no page header at all and reused the home section, which double-padded the layout. Accordion extracted to `components/ui/faq-list.tsx` and shared by the home section and the page, so both render identical markup
- **/services**: lead line promoted to `intro`; service cards now a 2-column grid in the wider frame
- **/blog**: post cards now a 2-column grid with equal-height cards; `intro` added
- **/portfolio**: `intro` added
- **/contact**: message form and location map now sit side by side on large screens instead of stacking
- Icon chips standardised to navy + gold (`bg-brand text-gold`) on /services and /about, matching the home services section (were `bg-gold-soft` + black icons)

### Note

- `/products` keeps its bespoke ELFIA header typography; its frame values already match `PageShell` exactly, so the two stay visually in sync

## [1.2.12] — 2026-07-25

### Changed

- `public/og.png` rebuilt from the master OG artwork at exactly 1200×630, alpha flattened onto the cream background (transparency can render as black in some scrapers), no horizontal stretching — 37px of empty cream trimmed from the top so the gold/navy curves stay fully intact

### Diagnosis note

- The small-thumbnail WhatsApp preview was NOT a broken og.png: the live site still runs pre-1.2.9 metadata, which declares both `og.png` and `og-square.png`, and WhatsApp was picking the square — rendering it as a cropped small-thumbnail card. The landscape-only fix from [1.2.9] resolves it and takes effect on deploy.

## [1.2.11] — 2026-07-25

### Changed

- ELFIA product names updated in `constants/content.ts`:
  - "The Signature Shawl — Taupe" → **"The Signature Shawl — Mocha"** (slug `signature-shawl-taupe` → `signature-shawl-mocha`)
  - "The Signature Shawl — Grey" → **"The Signature Shawl — Soft Grey"** (slug `signature-shawl-grey` → `signature-shawl-soft-grey`)
  - "Corporate Series — Blush" → **"Corporate Series — Khaki"** (slug `corporate-blush` → `corporate-khaki`)
  - "The Signature Shawl — Beige" unchanged; Active Hijab and Neutral Collection unchanged
- Alt text and product descriptions reworded to match the new colour names; The Neutral Collection copy now reads "black, mocha, beige, and soft grey"

### Added

- `public/_redirects` — 301s from the three old product URLs to the new slugs, so any link already shared keeps working

### Note

- Image filenames in `/public/elfia/` unchanged (`shawl-taupe.jpg`, `corporate.jpg`, …) — internal references only, not visible to visitors. Swap the photos if the new colours are different fabric, not a rename.

## [1.2.10] — 2026-07-25

### Changed

- Hero: "We sell live" pill badge replaced with the transparent company logo (`/logo.png`, no pill background, h-16/h-20 responsive) — hero now opens logo → "LIVE . CONNECT . GROW." eyebrow → headline, mirroring the OG banner layout. Logo has no tagline baked in, so the eyebrow is kept (no duplication)

## [1.2.9] — 2026-07-25

### Fixed

- WhatsApp link preview inconsistency: openGraph now declares only the landscape `og.png` (1200×630). With both landscape and square variants listed, WhatsApp sometimes picked `og-square.png` and rendered the compact small-thumbnail layout instead of the large banner card. `og-square.png` stays in `/public` (unreferenced) in case it's wanted later.

### Note

- WhatsApp caches previews per exact URL (with/without trailing slash are separate entries) for up to ~30 days — after deploy, re-scrape via Facebook Sharing Debugger and/or share the link once with `?v=2` to force a fresh fetch

## [1.2.8] — 2026-07-25

### Deployed

- azoneofficial.com live — v0.1 under-construction page retired

### Changed

- `/products`: grid replaced by the coverflow gallery; "Explore the range" link list added beneath it (all six detail pages remain one tap away); "Where to buy" CTAs migrated to shared Button

## [1.2.7] — 2026-07-25

### Changed

- Sales document numbering: new format `{TYPE}{YYYYMMDD}-{NN}-AZOO` (e.g. `DO20260725-01-AZOO`) — date-readable, daily sequence (KL time), issuer code. Legacy numbers (`QT202600001`) remain valid, never renumbered. Spec: `DOCUMENT-NUMBERING.md`

### Added

- Migration `0005_doc_numbering_daily.sql` — `doc_counters_daily` table; old `doc_counters` kept untouched
- `DOCUMENT-NUMBERING.md` — format spec, rationale, migration rules, future doc types (OR/CN/PO)
- `FEATURE-SUGGESTIONS.md` — 15 candidate features with sequencing (Live Session module, host commission, ELFIA live-stock, MyInvois e-Invoice readiness, SST, payments/OR, CN, WhatsApp enquiry alerts, D1 backup, 2FA, more)

### Policy

- Docs are append-only for history: version entries are never removed

## [1.2.6] — 2026-07-25

### Changed

- ELFIA gallery: grid replaced by coverflow carousel (`components/ui/elfia-gallery.tsx`) on the home ELFIA section — centre card full size and linked to its detail page, neighbours peek behind, infinite wrap, touch-swipe + keyboard + aria-live, motion-reduce respected, zero dependencies
- Service icons: all six cards now use one professional icon family (`components/ui/service-icons.tsx`, 1.6px stroke, 24px grid) on navy chips with gold strokes (was mixed lucide icons on gold-soft chips)
- Buttons standardised via `components/ui/button.tsx` (h-12, rounded-lg, min-w-[180px] on ≥sm, full-width stacked on mobile) — migrated hero, home CTA, ELFIA, /products, product detail, and contact page (which was drifting with rounded-full)

### Added

- `REVIEW.md` — improvement suggestions for client site, staff portal, customer area, with priority order

## [1.2.5] — 2026-07-24

### Added

- Official brand tagline "Live . Connect . Grow." — in constants/site.ts as SITE_CONFIG.brandTagline, displayed as gold uppercase eyebrow above the hero headline and beneath the footer logo; used in OG image alt text
- OG share images replaced with the official corporate design (cream + navy + gold curves) — landscape 1200×630 (public/og.png) and square 1080×1080 for WhatsApp (public/og-square.png)

### Note

- The descriptive tagline "Malaysia's Premium Live Commerce Agency" remains as the primary SEO/meta description; the brand tagline is used for identity moments (hero eyebrow, footer, share preview)

## [1.2.4] — 2026-07-24

### Changed

- /login: mode switcher moved to a persistent top-of-form Sign in / Create account tab pair (was a text link buried under the submit button). Both modes visible from arrival — clearer wayfinding, no more "New here?" line

## [1.2.3] — 2026-07-24

### Added

- `public/og.png` (1200×630) redesigned — logo enlarged, cleaner corporate layout, navy tagline, gold accent band
- `public/og-square.png` (1080×1080) new — square variant for WhatsApp centre-crop on mobile chat lists
- `MILESTONES.md` — comprehensive milestone log recording every version, asset, and decision from inception
- After deploy: use Facebook Sharing Debugger or WhatsApp's link cache reset (add ?v=2 once) to force social platforms to re-fetch

## [1.2.2] — 2026-07-24

### Changed

- Configuration discipline: no credentials or IDs in source. `wrangler.toml` now lists only variable names with instructions; all values (including GOOGLE_CLIENT_ID as a plaintext variable) live in the Cloudflare dashboard or as secrets. Added `.dev.vars.example` for local dev; `.dev.vars` is git-ignored.

## [1.2.1] — 2026-07-24

### Fixed

- Login/register error handling: 400s now show the API's real reason (was hidden as a misleading "password needs 10+ characters" for every failure); network/route-missing errors now say so plainly, so users can tell "not deployed yet" apart from "check your input"
- Password minimum harmonised to 10 characters everywhere (setup was inconsistently 12)

### Added

- Show/hide password eye toggle on login/register + live character counter with progress feedback (X of 10 — Y more needed) when registering
- Live length feedback on the admin Create User form

## [1.2.0] — 2026-07-24 — Security audit & hardening

### Added

- One-time super admin bootstrap: POST /auth/setup guarded by SETUP_TOKEN secret + timing-safe compare; self-disables once a super admin exists (no hardcoded credentials anywhere)
- Static security headers (public/_headers): nosniff, X-Frame-Options DENY, strict referrer, permissions policy

### Security

- Sessions stored as SHA-256 hashes (leak-resistant) with opportunistic expiry purge
- /account/enquiries: unverified accounts limited to post-registration enquiries (email-squatting history leak closed)
- R2 `private/` prefix requires staff auth
  Full audit report in SECURITY.md.

## [1.1.1] — 2026-07-24

### Changed

- Official social handles confirmed and applied site-wide: TikTok/Instagram/Facebook → @azoneofficialhq (footer, contact page, ELFIA "Watch the next drop live" buttons)

## [1.1.0] — 2026-07-24 — General login & role-routed access

### Added

- General /login (one door for everyone) with role-based routing after sign-in: customer → /account, staff-only roles → /portal, CMS roles → /admin; Google callback routes the same way
- Customer role (migration 0004) + /account page: own details and enquiry history (matched by email); GET /api/v1/account/enquiries
- Public registration now creates an ACTIVE customer account and signs the person in immediately (safe: customers see only their own data; staff/admin roles are assigned only by super admins)

### Changed

- Navbar/footer point to /login; /admin and /portal redirect unauthenticated visitors to /login and customers to /account; customers blocked from all /staff API routes

### Removed

- Pending-approval registration flow (replaced by customer accounts); embedded login screen inside /admin

## [1.0.0] — 2026-07-24 — Staff Portal (BMS) v1

### Added

- Migration 0003: full BMS schema — expanded 10-role users (+staff profile fields), attendance, leave (+balances), announcements (+acks), tasks (+comments), customers, sales_documents with per-year auto numbering (QT/DO/INV 202600001), notifications
- Staff API (`/api/v1/staff/*`, worker/src/staff.ts) with module-level RBAC: profile, staff directory (HR), attendance clock in/out/break (IP+device captured) + monthly history + team report, leave apply/cancel/approve/reject with notifications and balance tracking, announcements + acknowledgements, tasks assign/progress/comments, CRM customers, QT/DO/INV creation with auto numbering + delivery/payment status, in-app notifications
- Staff Portal UI at /portal (noindexed, robots-blocked): personalized dashboard (quick actions clock in/out, pending leave, tasks, announcements), Attendance, Leave (balances, apply, approvals), Tasks, Announcements, Sales (customers + document builder with live RM total), Profile; notification bell; light/dark mode

### Security

- New roles ranked into existing CMS RBAC (live_host lowest — no CMS/finance/admin access); all staff routes require auth; every mutating action audited

## [0.9.0] — 2026-07-24

### Added

- No-code content editing is live end-to-end: public `/content-public` endpoint (60s cache) + `<Editable>` component; hero headline/subheadline, About paragraphs, CTA heading, footer slogan, and Contact intro now read D1 overrides with static fallback
- Visitor analytics: Cloudflare Web Analytics beacon, token-gated in `constants/site.ts` (inert until token set)

## [0.8.0] — 2026-07-24

### Changed — UI/UX redesign pass (premium corporate principles)

- WCAG 2.1 AA contrast: new deep-gold token (#7D6027, 5.0:1) for accent text on light backgrounds; footer text raised from 40% to 60% white; navy focus-visible outlines site-wide
- Consistent radius system: pill buttons replaced with 8px-radius buttons; cards on the same scale; only true dots remain circular
- 8px spacing grid: all section/page paddings normalized to multiples of 8
- Subtle shadows only (shadow-sm on hover)
- Every page ends with a clear next step: About and FAQ pages gained consultation CTAs

## [0.7.0] — 2026-07-24

### Added

- Google OAuth sign-in for /admin (state-cookie CSRF protection, verified-email requirement); company-domain Google accounts auto-activate
- Self-registration on /admin (rate-limited): any valid email, created pending until super-admin approval
- Login screen: Continue with Google, register mode, pending/oauth notices

### Changed

- Contact email: hello@ → admin@azoneofficial.com

## [0.6.0] — 2026-07-24

### Added

- User management: API (super_admin only — create, role change, activate/deactivate with session revocation, password reset) + admin Users tab
- Admin Media tab: upload to R2, image previews, copy-URL, delete
- Admin Content tab: key-value site content editor (dot-notation keys, JSON or text values)
- Dashboard: posts/testimonials counts + recent-activity feed from audit log
- ELFIA individual product pages (/products/[slug]) with descriptions, galleries (grey shawl: 4 angles), "price announced live" panel, cross-links; added to sitemap
- Public D1 reads: /portfolio and homepage testimonials render published D1 items at runtime with graceful static fallback

### Changed

- Product cards on homepage and /products now link to detail pages

## [0.5.0] — 2026-07-24

### Added

- Rate limiting (D1 fixed-window): login 10/15min, enquiries 5/hour per IP (migration 0002)
- Full CRUD API: products, posts, portfolio, testimonials (editor+ write, admin+ delete, public reads filtered to published/visible)
- Site content API: GET public, PUT editor+ (upsert with audit)
- Media API: R2 upload (editor+), public cached serving, delete
- Contact form on /contact posting to /api/v1/enquiries with WhatsApp fallback on failure
- Admin UI at /admin (noindexed): login, dashboard, enquiry management with status workflow, CRUD panels for products/posts/portfolio/testimonials

### Security

- /admin disallowed in robots.txt and noindexed; all admin API writes audited

## [0.4.0] — 2026-07-24

### Added

- ELFIA product photos (9, web-optimized) wired into homepage + /products; brand copy corrected to premium chiffon hijabs/shawls
- Phase 3 architecture DECIDED: static site + separate admin/API Worker (`/worker`)
- Worker scaffold: wrangler.toml with real D1/R2 bindings, migration 0001 (full schema), API v0 — auth (PBKDF2 sessions), public enquiries endpoint, enquiry management, dashboard summary, audit logging

### Security

- PBKDF2-SHA256 310k iterations + pepper (argon2 deviation documented in SECURITY.md); origin checks on mutations; HttpOnly/Secure/SameSite cookies

## [0.3.0] — 2026-07-24

### Added

- Full public website (Phase 2): `/about`, `/services`, `/portfolio`, `/case-studies`, `/products` (ELFIA), `/blog` (+2 starter posts), `/careers`, `/faq`, `/contact`, `/privacy`, `/terms`
- SEO: sitemap.xml, robots.txt, JSON-LD Organization schema, Open Graph + Twitter card images
- Brand assets: OG share image (`public/og.png`), favicon/app icon
- Mandatory documentation set (this file and 11 siblings)

### Changed

- Navigation switched from homepage anchors to dedicated pages
- Footer: legal links, Case Studies, Careers added

## [0.2.0] — 2026-07-24

### Added

- Full landing page: Hero, About + stats, Services, Showcase, ELFIA, Process, FAQ, CTA, Navbar, Footer
- Real contact data from Master Project Prompt: WhatsApp +60 12-383 4821, official slogan, Setia Tropika address
- Services aligned to master list (6 services)

### Changed

- Hero copy per master prompt ("Grow your sales through live commerce")

## [0.1.0] — baseline

- Next.js 15 scaffold with design tokens, coming-soon page, Cloudflare static deploy
