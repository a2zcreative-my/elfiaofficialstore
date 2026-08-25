/**
 * Proves the two-way inventory sync (v0.8.0) against a stand-in portal that
 * implements PORTAL-BRIDGE-SPEC.md. Real Worker, real D1, real HTTP.
 *
 * The questions it answers:
 *   - Does a web sale actually reach the portal?
 *   - Does a cancelled order put the pieces back there?
 *   - If the portal is DOWN when the sale happens, is the sale lost?  (No.)
 *   - While a sale is undelivered, can a stale portal count overwrite it? (No.)
 *   - Does a retried movement get counted twice?  (No — idempotency.)
 *   - Does an unknown SKU get retried forever?  (No — it is reported.)
 *
 * Run (from the project root, three terminals):
 *   1. node scratch/fake-portal.mjs
 *   2. cd worker
 *      npx wrangler d1 migrations apply elfia-store --local --config wrangler.e2e.toml
 *      echo 'ADMIN_KEY = "test-passcode-123"'   > .dev.vars
 *      echo 'BRIDGE_KEY = "shared-bridge-secret"' >> .dev.vars
 *      npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *      (wrangler.e2e.toml points BRIDGE_URL/BRIDGE_PUSH_URL at :8200)
 *   3. node scratch/store-sync-test.mjs
 */
import { execFileSync } from "node:child_process";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL ?? "http://127.0.0.1:8200";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);
const jget = async (u, o = {}) => (await fetch(u, o)).json();
const admin = (p, o = {}) => fetch(`${API}${p}`, { ...o, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(o.headers ?? {}) } });
const portalState = () => jget(`${PORTAL}/_state`);
const portalSet = (sku, stock) => fetch(`${PORTAL}/_set`, { method: "POST", body: JSON.stringify({ sku, stock }) });
const portalDown = (down) => fetch(`${PORTAL}/_down`, { method: "POST", body: JSON.stringify({ down }) });
/* v1.5.0 controls: introduce a SKU the STORE has never had, and attach or
   replace its photo. */
const portalAdd = (body) => fetch(`${PORTAL}/_add`, { method: "POST", body: JSON.stringify(body) });
const portalPhoto = (body) => fetch(`${PORTAL}/_photo`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.json());
const portalRemove = (sku) => fetch(`${PORTAL}/_remove`, { method: "POST", body: JSON.stringify({ sku }) });
/* GET-only retry. `wrangler dev` occasionally drops a keep-alive socket —
   especially right after an external `wrangler d1 execute` has touched the
   same local database — and a dropped socket on a READ is not a finding
   about the store. Writes are never retried: a repeated POST would invent a
   second order. */
const getRetry = async (path, tries = 3) => {
  for (let i = 1; ; i++) {
    try { return await admin(path).then((r) => r.json()); }
    catch (e) { if (i >= tries) throw e; await new Promise((r) => setTimeout(r, 300 * i)); }
  }
};
const adminProducts = () => getRetry("/admin/products").then((j) => j.products);
const bySku = async (sku) => (await adminProducts()).find((p) => p.sku && p.sku.replace(/\s+/g, "").toUpperCase() === sku);
const syncNow = () => admin("/admin/sync-stock", { method: "POST" }).then((r) => r.json());
const status = () => getRetry("/admin/sync-status");
/* v1.0.0 — the store now caps unpaid orders per phone and orders per IP, so
   this harness gives every order its own caller and its own number. They are
   different customers, which is the truth of what is being tested. */
const RUN = Math.floor(Math.random() * 250) + 1;
let n = 0;
const order = (id, qty, name = "Sync Test") => {
  n += 1;
  return jget(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.66.${RUN}.${n}` },
    body: JSON.stringify({
      customer: { name, phone: `01${String(RUN).padStart(3, "0")}${String(n).padStart(5, "0")}`, address: "1 Jalan Sync" },
      items: [{ id, qty }],
    }),
  });
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* v1.8.0 — the ONE thing this rig cannot make over HTTP any more: a row in
   the OLD hidden review queue. v1.5.0 created those; v1.8.0 does not, by
   design. So the legacy state is built straight in the local D1 — fixture
   setup only, never an assertion — because "a row the previous version
   left behind" is exactly what the release path has to cope with. */
/* Same idea for an event the push loop has given up on: 25 real failures
   would take minutes and prove nothing extra. */
const exhaustAttempts = (sku) => execFileSync("npx", [
  "wrangler", "d1", "execute", "elfia-store", "--local", "--config", "wrangler.e2e.toml",
  "--command", `UPDATE stock_events SET attempts = 99 WHERE sent_at IS NULL AND REPLACE(UPPER(sku),' ','') = '${String(sku).toUpperCase()}'`,
], { cwd: new URL("../worker", import.meta.url).pathname, stdio: "pipe" });

const legacyPending = (id) => execFileSync("npx", [
  "wrangler", "d1", "execute", "elfia-store", "--local", "--config", "wrangler.e2e.toml",
  "--command", `UPDATE products SET active = 0, portal_pending = 1 WHERE id = ${Number(id)}`,
], { cwd: new URL("../worker", import.meta.url).pathname, stdio: "pipe" });

step("both directions are configured");
{
  const h = await jget(`${API}/health`);
  ok("store can read the portal", h.bridge_pull_configured === true);
  ok("store can report to the portal", h.bridge_push_configured === true);
  await portalDown(false);
}

step("start from a settled outbox");
{
  /* Deliver anything left over from earlier work before measuring, so the
     assertions below are about THIS run. Each call sends a batch of 50. */
  const retry = () => admin("/admin/sync-retry", { method: "POST" }).then((r) => r.json());
  let st = await status();
  for (let i = 0; i < 25 && (st.pending > 0 || st.stuck > 0); i++) {
    if (st.stuck > 0) await retry();      // give up-on rows one more chance
    await syncNow();
    st = await status();
  }
  ok("no sales are waiting to be delivered", st.pending === 0 && st.stuck === 0,
     `${st.pending} pending, ${st.stuck} stuck`);
}

step("start clean: retire fixtures other suites left in the store");
{
  /* scratch/portal-live-e2e.mjs (the real-portal rig) publishes a SHWL001.
     The stand-in portal here does not carry that SKU, so a leftover row
     would show up as "unknown there" in every reconciliation below. Same
     retire trick as that suite uses: rename the SKU away and hide it. */
  /* v1.8.0 — this has to sweep WIDER than SHWL001 now. Portal-created rows
     are live from birth, so a run that died half way leaves an ACTIVE shawl
     the stand-in portal has since forgotten, and every reconciliation below
     would report it as "unknown there" forever. Every SHWL* fixture goes. */
  for (let i = 0; i < 12; i++) {
    const left = (await adminProducts()).find(
      (x) => x.sku && /^SHWL/i.test(x.sku.replace(/\s+/g, "")) && (x.active === 1 || x.portal_pending === 1));
    if (!left) break;
    await admin(`/admin/products/${left.id}`, {
      method: "PUT", body: JSON.stringify({ sku: `RET${Date.now() % 1e9}${i}`, active: false }),
    });
  }
  const stillLive = (await adminProducts()).filter(
    (x) => x.sku && /^SHWL/i.test(x.sku.replace(/\s+/g, "")) && (x.active === 1 || x.portal_pending === 1));
  ok("no cross-suite fixture is still live", stillLive.length === 0, JSON.stringify(stillLive.map((x) => x.sku)));
}

let products, target;
step("first pull: the store takes the portal's counts");
{
  await portalSet("LUMI001", 24);
  const r = await syncNow();
  ok("pull ran", r.pull.configured && !r.pull.error, JSON.stringify(r.pull.error ?? ""));
  ok("every SKU matched on both sides", r.pull.unmatched_portal.length === 0 && r.pull.unmatched_store.length === 0,
     JSON.stringify({ portal: r.pull.unmatched_portal, store: r.pull.unmatched_store }));
  products = (await jget(`${API}/products`)).products;
  target = products.find((p) => p.sku === "LUMI001");
  ok("LUMI001 now reads the portal's 24 in the store", target.stock === 24, `store has ${target.stock}`);
  /* v1.1.2 — the fake portal spells its SKUs "LUMI 001", with a space, the
     way the real portal does. Matching anyway IS the fix under test. */
  ok("the portal's spaced spelling (LUMI 001) matched the store's LUMI001",
     !r.pull.unmatched_portal.some((s) => /LUMI/i.test(s)), JSON.stringify(r.pull.unmatched_portal));
  ok("a portal-carried SKU is switched to counted (v1.1.2)", target.track_stock === 1,
     `track_stock=${target.track_stock}`);
}

step("a web sale reaches the portal by itself");
{
  const before = (await portalState()).stock.LUMI001;
  const o = await order(target.id, 2);
  ok("order placed", Boolean(o.token));
  await sleep(1200); // the push happens on the way out of the request
  const after = (await portalState()).stock.LUMI001;
  ok(`portal deducted the sale (${before} → ${after})`, after === before - 2);
  const st = await status();
  ok("nothing left waiting", st.pending === 0, `${st.pending} pending`);
}

step("cancelling an unpaid order gives the pieces back");
{
  const before = (await portalState()).stock.LUMI001;
  const list = await (await admin("/admin/orders")).json();
  const id = list.orders.find((x) => x.customer_name === "Sync Test").id;
  await admin(`/admin/orders/${id}`, { method: "PUT", body: JSON.stringify({ action: "cancel" }) });
  await sleep(1200);
  const after = (await portalState()).stock.LUMI001;
  ok(`portal restored the pieces (${before} → ${after})`, after === before + 2);
}

step("the portal is DOWN when a sale happens");
let downSaleQty = 3;
{
  const portalBefore = (await portalState()).stock.LUMI001;
  await portalDown(true);
  const o = await order(target.id, downSaleQty, "Offline Sale");
  ok("the customer's order still succeeds", Boolean(o.token));
  await sleep(1000);
  const st = await status();
  ok("the sale is held in the outbox, not lost", st.pending === 1, `${st.pending} pending`);
  await portalDown(false);
  ok("portal's count is untouched so far", (await portalState()).stock.LUMI001 === portalBefore);

  step("  …and a stale portal count cannot undo it");
  const r = await syncNow();
  ok("the sale was delivered on the next sync", r.push.sent === 1, JSON.stringify(r.push));
  const afterPortal = (await portalState()).stock.LUMI001;
  ok(`portal deducted it late (${portalBefore} → ${afterPortal})`, afterPortal === portalBefore - downSaleQty);
  /* Three right answers, depending on timing: the pull deferred the SKU
     (outbox still unsent), the pull applied the post-sale count, or — v1.1.2,
     now the SKU is counted — the store already decremented its own shelf at
     checkout and the pull found both sides agreeing. What is NEVER right is
     the store showing the stale pre-sale count, checked just below. */
  const storeNow = (await jget(`${API}/products/${target.id}`)).product.stock;
  ok("the stale portal count did not undo the sale",
     r.pull.deferred.includes("LUMI001")
       || r.pull.updated.some((u) => u.sku === "LUMI001" && u.to === afterPortal)
       || storeNow === afterPortal,
     JSON.stringify({ deferred: r.pull.deferred, updated: r.pull.updated, storeNow }));

  // one more sync now that the outbox is empty — the two must agree exactly
  await syncNow();
  const store = (await jget(`${API}/products/${target.id}`)).product.stock;
  ok(`store and portal agree (${store} = ${afterPortal})`, store === afterPortal);
}

step("a retried movement is never counted twice");
{
  const before = (await portalState()).stock.LUMI001;
  // A fresh id each run — the whole point is that the SAME id sent twice
  // moves the count once, not that a hard-coded id is remembered forever.
  const ev = { event_id: crypto.randomUUID(), sku: "LUMI001", delta: -1, reason: "order", reference: "ELF-TEST", occurred_at: "2026-08-20 12:00:00" };
  const send = () => jget(`${PORTAL}/bridge/elfia-movements`, {
    method: "POST", headers: { "X-Bridge-Key": "shared-bridge-secret", "Content-Type": "application/json" },
    body: JSON.stringify({ movements: [ev] }),
  });
  const first = await send();
  const second = await send();
  ok("first delivery is applied", first.applied.includes(ev.event_id));
  ok("the repeat is ignored, not applied again", second.ignored.includes(ev.event_id));
  ok(`the count moved once, not twice (${before} → ${before - 1})`, (await portalState()).stock.LUMI001 === before - 1);
  await portalSet("LUMI001", before); // put the test's piece back
}

step("a SKU the portal does not know is reported, not retried forever");
{
  const created = await (await admin("/admin/products", {
    method: "POST",
    body: JSON.stringify({ name: "Ghost — Test", price_cents: 1000, stock: 5, sku: "GHOST001", track_stock: false }),
  })).json();
  await order(created.id, 1, "Ghost Buyer");
  await sleep(1200);
  const st = await status();
  ok("the movement is not stuck in the retry loop", st.pending === 0, `${st.pending} pending`);
  ok("and the mismatch is surfaced for a human", /GHOST001/i.test(st.last_push_error ?? ""), st.last_push_error ?? "(no message)");
  const r = await syncNow();
  ok("the sync report names the SKU the portal is missing", r.pull.unmatched_store.includes("GHOST001"),
     JSON.stringify(r.pull.unmatched_store));
  await admin(`/admin/products/${created.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
}

step("prices are controlled in the portal");
{
  const p2 = (await jget(`${API}/products`)).products.find((x) => x.sku === "LUMI002");
  const before = p2.price_cents;

  // The portal starts sending a price for LUMI002 — the store must take it.
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI002", price_cents: 5500 }) });
  let r = await syncNow();
  ok("the portal's price is applied on the next pull",
     r.pull.price_updated.some((u) => u.sku === "LUMI002" && u.to === 5500),
     JSON.stringify(r.pull.price_updated));
  ok("the storefront now sells at the portal's price",
     (await jget(`${API}/products/${p2.id}`)).product.price_cents === 5500);

  // An admin edit is overridden on the next pull — the portal owns this SKU's
  // price now, which is exactly what the CEO asked for.
  await admin(`/admin/products/${p2.id}`, { method: "PUT", body: JSON.stringify({ price_cents: 9999 }) });
  r = await syncNow();
  ok("a store-side price edit is corrected back to the portal's",
     (await jget(`${API}/products/${p2.id}`)).product.price_cents === 5500,
     JSON.stringify(r.pull.price_updated));

  // Garbage from the feed must not zero the shop.
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI002", price_cents: 0 }) });
  await syncNow();
  ok("a zero/garbage price is refused, the last good price stands",
     (await jget(`${API}/products/${p2.id}`)).product.price_cents === 5500);

  // The portal stops sending a price — the store's own price stands again.
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI002", price_cents: null }) });
  await admin(`/admin/products/${p2.id}`, { method: "PUT", body: JSON.stringify({ price_cents: before }) });
  const r2 = await syncNow();
  ok("a SKU without a portal price keeps the store's own",
     (await jget(`${API}/products/${p2.id}`)).product.price_cents === before &&
     !r2.pull.price_updated.some((u) => u.sku === "LUMI002"));
}

step("the portal can pull every web order");
{
  const feed = (q = "") => fetch(`${API}/bridge/orders${q}`, { headers: { "X-Bridge-Key": "shared-bridge-secret" } });

  const noKey = await fetch(`${API}/bridge/orders`);
  ok("no key, no orders", noKey.status === 401 || noKey.status === 501, `${noKey.status}`);
  const badKey = await fetch(`${API}/bridge/orders`, { headers: { "X-Bridge-Key": "wrong" } });
  ok("a wrong key is refused", badKey.status === 401);

  /* Make sure there IS something to sell before selling it. Earlier steps
     (and earlier runs) move this SKU around, and an out-of-stock 400 here
     would fail three assertions that are about the ORDER FEED, not stock. */
  await portalSet("LUMI003", 40);
  await syncNow();
  const feedProducts = (await jget(`${API}/products`)).products;
  const placed = await order(feedProducts.find((x) => x.sku === "LUMI003").id, 1, "Feed Test");
  ok("the order under test was accepted", Boolean(placed.order_number), JSON.stringify(placed).slice(0, 140));
  await sleep(400);
  let page = await (await feed()).json();
  let cursor = page.cursor;
  let all = [...page.orders];
  for (let i = 0; i < 30 && page.orders.length; i++) {         // walk the cursor to the end
    page = await (await feed(`?since=${encodeURIComponent(cursor)}`)).json();
    cursor = page.cursor ?? cursor;
    all = all.concat(page.orders);
  }
  const mine = all.find((o) => o.order_number === placed.order_number);
  ok("the new order appears in the feed", Boolean(mine), placed.order_number);
  ok("with its items and the price actually charged",
     mine && Array.isArray(mine.items) && mine.items[0].qty === 1 && mine.items[0].price_cents > 0,
     JSON.stringify(mine?.items));
  ok("and without the customer's private token", mine && !("token" in mine));

  // A status change re-surfaces the order after the cursor.
  const list = await (await admin("/admin/orders")).json();
  const id = list.orders.find((x) => x.order_number === placed.order_number).id;
  await sleep(1100);                                            // datetime('now') is second-resolution
  await admin(`/admin/orders/${id}`, { method: "PUT", body: JSON.stringify({ action: "confirm_paid" }) });
  const next = await (await feed(`?since=${encodeURIComponent(cursor)}`)).json();
  const again = next.orders.find((o) => o.order_number === placed.order_number);
  ok("a status change re-surfaces the order past the cursor", again?.status === "paid",
     JSON.stringify(next.orders.map((o) => [o.order_number, o.status])));
}

step("a portal-managed SKU shows and enforces the portal's exact count (v1.1.2)");
{
  // Give it a known count first: repeated runs of this file would otherwise
  // drain the stand-in portal to zero, where a deduction cannot be seen.
  await portalSet("LUMI005", 15);
  await syncNow();
  const p = (await jget(`${API}/products`)).products.find((x) => x.sku === "LUMI005");
  ok("LUMI005 is counted now that the portal carries it", p.track_stock === 1, `track_stock=${p.track_stock}`);
  ok("and the store shows the portal's exact quantity (15)", p.stock === 15, `store has ${p.stock}`);
  const before = (await portalState()).stock.LUMI005;
  await order(p.id, 2, "Counted Buyer");
  await sleep(1200);
  const after = (await portalState()).stock.LUMI005;
  ok(`the portal heard about the sale (${before} → ${after})`, after === before - 2);
  const mineNow = (await jget(`${API}/products/${p.id}`)).product.stock;
  ok(`the store's shelf moved with it (${mineNow})`, mineNow === before - 2);
}

/* ------------------------------------------------------------------ v1.5.0
   The CEO, 25-08-2026: "on portal I want an option for me to upload the photo
   and also to bridge directly to ELFIA … Shawl seem not yet being sync yet."

   The shawls were never a sync failure — the store simply had no shawl
   products, and a pull can only refresh what already exists. These steps prove
   the feed can now bring one INTO existence, with its photo, without letting
   the portal put anything in front of a customer unreviewed. */

/* A code this store has never seen, fresh every run. The local D1 keeps
   products between runs, so a fixed SHWL001 would test creation exactly once
   and then quietly test nothing. Letters-then-digits so the stand-in portal
   still spells it with a space ("SHWL 123456") — the whitespace match matters
   on the creation path too. */
const stamp = String(Date.now() % 1_000_000).padStart(6, "0");
const SHAWL = `SHWL${stamp}`;
const SHAWL_B = `SHWL${String((Number(stamp) + 1) % 1_000_000).padStart(6, "0")}`;
let shawlId = null;

step("the store's /admin has no publishing screen any more (v1.8.1)");
{
  /* The CEO: "/admin → From portal this should not be appear in ELFIA
     system! all inside the portal … dont make this system conflict and
     become unstable!!!" Two screens deciding what is published is how a
     catalogue drifts. The route answers 410 with a sentence pointing at the
     portal, rather than 404-ing an old bookmark into a mystery. */
  const any = (await adminProducts())[0];
  const res = await admin(`/admin/products/${any.id}/publish`, { method: "POST", body: "{}" });
  ok("publishing from the store is gone", res.status === 410, `${res.status}`);
  const j = await res.json().catch(() => ({}));
  ok("and it says where publishing lives now", /portal/i.test(j?.error?.message ?? ""), JSON.stringify(j));
  const st = await status();
  ok("the sync status no longer counts a review queue", st.portal_pending === undefined,
     JSON.stringify(st.portal_pending));
}

step("a SKU the store has never had is CREATED, live (v1.8.0)");
{
  await portalAdd({ sku: SHAWL, name: "Shawl Premium — Beige", category: "shawl", price_cents: 5500, stock: 8, photo: "beige", marker: "v1" });
  const r = await syncNow();
  ok("the pull reports it as created", r.pull.created.some((c) => c.sku.replace(/\s+/g, "") === SHAWL),
     JSON.stringify(r.pull.created));
  ok("it is NOT reported as unmatched any more", !r.pull.unmatched_portal.some((x) => /SHWL/i.test(x)),
     JSON.stringify(r.pull.unmatched_portal));

  const p = await bySku(SHAWL);
  shawlId = p?.id ?? null;
  ok("the product exists in the store", Boolean(p));
  ok("with the portal's name", p?.name === "Shawl Premium — Beige", p?.name);
  ok("in the shawl collection", p?.category === "shawl", p?.category);
  ok("at the portal's price and count", p?.price_cents === 5500 && p?.stock === 8,
     JSON.stringify({ price: p?.price_cents, stock: p?.stock }));
  ok("counted, not always-available", p?.track_stock === 1);
  ok("marked as the portal's creation", p?.portal_created === 1);

  /* v1.8.0 — REVERSED on the CEO's instruction. v1.5.0 created this hidden
     and demanded a second approval in /admin; the feed only ever carries
     items the portal has ticked Publish on, so that gate asked her to
     approve her own approval — and on 25-08 it silently held back twelve
     published shawls. The portal's tick IS the publish decision. */
  ok("it is LIVE — the portal already published it", p?.active === 1, `active=${p?.active}`);
  ok("and nothing is parked in a review queue", p?.portal_pending === 0);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("the public catalogue carries it straight away", shopfront.some((x) => x.id === shawlId));
}

step("its photo was copied into the store's own storage");
{
  const p = await bySku(SHAWL);
  ok("the product has a photo", Boolean(p?.image_key), String(p?.image_key));
  ok("stored under the store's own key, not the portal's URL",
     typeof p?.image_key === "string" && p.image_key.startsWith("products/") && !/^https?:/i.test(p.image_key),
     String(p?.image_key));
  /* Both spellings of the same key. The storefront used to build the second
     one — encodeURIComponent over the whole key, slash and all — and the
     Worker answered 404, which meant every uploaded photo was invisible.
     Fixed on both sides in v1.5.0; asserted here so it cannot come back. */
  const plain = await fetch(`${API}/media/${p.image_key}`);
  ok("the store serves it", plain.status === 200, `${plain.status}`);
  ok("as an image", (plain.headers.get("content-type") ?? "").startsWith("image/"), plain.headers.get("content-type"));
  const encoded = await fetch(`${API}/media/${encodeURIComponent(p.image_key)}`);
  ok("and serves it when the slash arrives percent-encoded", encoded.status === 200, `${encoded.status}`);
}

step("an unchanged marker costs nothing");
{
  const before = (await bySku(SHAWL)).image_key;
  const r = await syncNow();
  ok("no photo was downloaded again", r.pull.photos === 0, `photos=${r.pull.photos}`);
  ok("and the photo is untouched", (await bySku(SHAWL)).image_key === before);
}

step("a changed marker replaces the photo");
{
  const before = (await bySku(SHAWL)).image_key;
  await portalPhoto({ sku: SHAWL, photo: "beige2", marker: "v2" });
  const r = await syncNow();
  ok("the new photo was fetched", r.pull.photos === 1, `photos=${r.pull.photos}`);
  const after = (await bySku(SHAWL)).image_key;
  ok("and the product points at it", after && after !== before, `${before} -> ${after}`);
}

step("the portal's photo takes over a matched product (v1.6.0, CEO's rule)");
{
  /* v1.5.x protected a photo uploaded in /admin from the feed. The CEO
     reversed that on 25-08 ("SKU doesnt sync with the portal!!"): she runs
     the catalogue from the portal's ELFIA tab, and a portal item matched to
     a store SKU is meant to TAKE IT OVER. Sent = applied; omitted = the
     store keeps what it has. */
  const p3 = await bySku("LUMI003");
  const before = p3.image_key;
  /* The marker must be new EVERY run — the store remembers the last one it
     stored, and an already-seen marker is (correctly) not re-downloaded. */
  await portalPhoto({ sku: "LUMI 003", photo: "takeover", marker: `x1-${Date.now()}` });
  const r = await syncNow();
  const after = await bySku("LUMI003");
  ok("the portal's photo replaced the store's", after.image_key !== before && String(after.image_key).startsWith("products/"),
     `${before} -> ${after.image_key}`);
  ok("counted as one copy", r.pull.photos >= 1, `photos=${r.pull.photos}`);

  /* …and once the feed stops sending one, the store keeps the last photo —
     absence is "keep", never "delete". */
  await portalPhoto({ sku: "LUMI 003", photo: null });
  await syncNow();
  ok("dropping image_url from the feed deletes nothing", (await bySku("LUMI003")).image_key === after.image_key);
}

step("a matched product follows the portal's name and collection too (v1.6.0)");
{
  /* The fake portal names everything "Portal <SKU>" — under the new rule the
     matched store product takes that name on the pull above. */
  const p4 = await bySku("LUMI004");
  ok("the portal's name landed on a store-made product", p4.name === "Portal LUMI 004", p4.name);
}

step("a hidden product keeps syncing while it waits for review");
{
  await portalSet(SHAWL, 20);
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: SHAWL, price_cents: 5900 }) });
  await syncNow();
  const p = await bySku(SHAWL);
  ok("its count followed the portal (20)", p.stock === 20, `stock=${p.stock}`);
  ok("its price followed the portal (RM 59)", p.price_cents === 5900, `price=${p.price_cents}`);
  ok("it stays live while the portal keeps sending it", p.active === 1);
}

step("a waiting product is not accused of being unknown to the portal");
{
  const r = await syncNow();
  ok("the report leaves the pending row out of 'unknown there'",
     !r.pull.unmatched_store.some((x) => /SHWL/i.test(x)), JSON.stringify(r.pull.unmatched_store));
}

step("a row left in the OLD review queue is released by the next pull (v1.8.0)");
{
  /* The migration path that matters to her right now: twelve shawls she
     published in the portal are sitting hidden in this store from the
     v1.5.0 rule. Hiding one by hand and pulling again must set it free —
     no /admin visit, which is the whole point, since ADMIN_KEY is not even
     configured on the live store. */
  legacyPending(shawlId);
  await sleep(400);   // let the worker notice the file changed under it
  const before = await bySku(SHAWL);
  ok("the fixture is hidden and pending again", before.active === 0 && before.portal_pending === 1,
     JSON.stringify({ a: before.active, p: before.portal_pending }));
  const r = await syncNow();
  ok("the pull says it released it", r.pull.published.some((x) => x.replace(/\s+/g, "") === SHAWL),
     JSON.stringify(r.pull.published));
  const p = await bySku(SHAWL);
  ok("it is live", p.active === 1);
  ok("and out of the review queue", p.portal_pending === 0);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("customers can now see it", shopfront.some((x) => x.id === shawlId));
}

step("a photo the store will not accept is reported, and stops nothing");
{
  const pendingBefore = (await status()).portal_pending;
  await portalAdd({ sku: SHAWL_B, name: "Shawl Premium — Taupe", category: "shawl", price_cents: 5500, stock: 5, photo: "html", marker: "h1" });
  const r = await syncNow();
  ok("the product is still created", r.pull.created.some((c) => c.sku.replace(/\s+/g, "") === SHAWL_B), JSON.stringify(r.pull.created));
  ok("the pull itself did not fail", !r.pull.error, String(r.pull.error));
  ok("the bad photo is named for a human", r.pull.photo_errors.some((e) => /SHWL/i.test(e)), JSON.stringify(r.pull.photo_errors));
  ok("and it says what was wrong", r.pull.photo_errors.some((e) => /JPEG|PNG|WEBP|type/i.test(e)), JSON.stringify(r.pull.photo_errors));
  const p = await bySku(SHAWL_B);
  ok("the product simply has no photo yet", !p.image_key, String(p.image_key));
  const st = await status();
  ok("/admin sees the photo problem on its own line", /SHWL/i.test(st.last_photo_error ?? ""), st.last_photo_error ?? "(none)");
  ok("and it went straight into the shop, queue untouched", st.portal_pending === pendingBefore,
     `${pendingBefore} -> ${st.portal_pending}`);
}

step("an oversized photo is refused too");
{
  await portalPhoto({ sku: SHAWL_B, photo: "huge", marker: "h2" });
  const r = await syncNow();
  ok("the 6 MB file is refused", r.pull.photo_errors.some((e) => /5 MB/i.test(e)), JSON.stringify(r.pull.photo_errors));
  ok("nothing was stored", !(await bySku(SHAWL_B)).image_key);
}

step("the store's own /admin can still retire a product (v1.8.0)");
{
  /* The portal decides what is published; the store keeps its own off
     switch for an emergency. Un-ticking Publish in the portal drops the
     SKU from the feed, which is the everyday way — this is the other one. */
  const p = await bySku(SHAWL_B);
  await admin(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
  const after = await bySku(SHAWL_B);
  ok("hidden by hand", after.active === 0);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("and invisible to customers", !shopfront.some((x) => x.id === after.id));
}

step("a feed item with no name is reported, never invented");
{
  await portalAdd({ sku: "NONAME 001", name: null, price_cents: 4900, stock: 3 });
  const r = await syncNow();
  ok("it is reported as unknown here", r.pull.unmatched_portal.some((x) => /NONAME/i.test(x)),
     JSON.stringify(r.pull.unmatched_portal));
  ok("and no nameless product was created", !r.pull.created.some((c) => /NONAME/i.test(c.sku)));
  ok("the store did not make one up", !(await bySku("NONAME001")));
  await portalRemove("NONAME 001");
}

step("a feed item with no price is reported, never sold for nothing");
{
  await portalAdd({ sku: "NOPRICE 001", name: "Shawl Premium — Nothing", stock: 3 });
  const r = await syncNow();
  ok("it is reported rather than created", r.pull.unmatched_portal.some((x) => /NOPRICE/i.test(x)),
     JSON.stringify(r.pull.unmatched_portal));
  ok("no priceless product exists", !(await bySku("NOPRICE001")));
  await portalRemove("NOPRICE 001");
}

/* ------------------------------------------------------------------ v1.7.0
   The discount and the carousel, run from the portal. */

step("a portal discount becomes a slashed price on the shop (v1.7.0)");
{
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI006", price_cents: 3900 }) });
  await fetch(`${PORTAL}/_discount`, { method: "POST", body: JSON.stringify({ sku: "LUMI006", discount_cents: 300 }) });
  await syncNow();
  const p6 = await bySku("LUMI006");
  ok("the customer pays the net price", p6.price_cents === 3600, `${p6.price_cents}`);
  ok("and the old price is kept for the strike-through", p6.compare_price_cents === 3900, `${p6.compare_price_cents}`);
  const pub = (await jget(`${API}/products`)).products.find((x) => x.id === p6.id);
  ok("the public catalogue carries both numbers", pub && pub.price_cents === 3600 && pub.compare_price_cents === 3900,
     JSON.stringify({ p: pub?.price_cents, c: pub?.compare_price_cents }));

  await fetch(`${PORTAL}/_discount`, { method: "POST", body: JSON.stringify({ sku: "LUMI006", discount_cents: null }) });
  await syncNow();
  const off = await bySku("LUMI006");
  ok("clearing the discount takes the badge off", off.compare_price_cents == null && off.price_cents === 3900,
     JSON.stringify({ p: off.price_cents, c: off.compare_price_cents }));
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI006", price_cents: null }) });
}

step("the portal's slides become the shop's carousel (v1.7.0)");
{
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 1, photo: "hero1", marker: "h1", title: "Raya Drop", subtitle: "First Sight, Forever Yours", sort: 10 },
    { id: 2, photo: "hero2", marker: "h2", sort: 20 },
  ] }) });
  const r = await syncNow();
  ok("two slide photos were copied", r.pull.error === undefined || !r.pull.error, JSON.stringify(r.pull.photo_errors));
  const feed = await jget(`${API}/products`);
  ok("the public payload now carries the slides", Array.isArray(feed.slides) && feed.slides.length === 2,
     JSON.stringify(feed.slides));
  ok("in the portal's order, with captions", feed.slides?.[0]?.title === "Raya Drop" && feed.slides?.[0]?.portal_id === 1,
     JSON.stringify(feed.slides?.[0]));
  const img = await fetch(`${API}/media/${feed.slides[0].image_key}`);
  ok("and the store serves the slide photo itself", img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"), `${img.status}`);

  // unchanged markers cost nothing
  const before = feed.slides[0].image_key;
  await syncNow();
  const again = await jget(`${API}/products`);
  ok("an unchanged slide is not re-downloaded", again.slides[0].image_key === before);

  // a caption edit without a photo change flows too
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 1, photo: "hero1", marker: "h1", title: "Merdeka Sale", sort: 10 },
    { id: 2, photo: "hero2", marker: "h2", sort: 20 },
  ] }) });
  await syncNow();
  const cap = await jget(`${API}/products`);
  ok("a caption edit lands without touching the photo",
     cap.slides[0].title === "Merdeka Sale" && cap.slides[0].image_key === before, JSON.stringify(cap.slides[0]));

  // removal in the portal removes on the shop
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 2, photo: "hero2", marker: "h2", sort: 20 },
  ] }) });
  await syncNow();
  const one = await jget(`${API}/products`);
  ok("a slide removed in the portal leaves the shop", one.slides.length === 1 && one.slides[0].portal_id === 2,
     JSON.stringify(one.slides));

  // empty list = the shop falls back to its shipped campaign slides
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [] }) });
  await syncNow();
  const none = await jget(`${API}/products`);
  ok("no portal slides = no slides key (the shop uses its built-ins)", !("slides" in none), JSON.stringify(none.slides));
}

step("a sale nobody could deliver stops freezing the shelf (v1.8.0)");
{
  /* THE BUG the CEO hit on 25-08: the portal said 20, the shop said SOLD
     OUT, and it stayed that way through two deploys.
     An unsent movement rightly holds its SKU's count — until the push loop
     gives up on it at MAX_ATTEMPTS and stops retrying. From that moment the
     old rule deadlocked: the push would never send it, the pull would never
     overwrite it, and only /admin/sync-retry could break the tie — in an
     /admin the live store cannot even open, because ADMIN_KEY is unset.
     Now: still in flight = deferred; given up on = the portal's count wins
     and the stuck SKU is REPORTED instead of silently freezing. */
  const p3 = await bySku("LUMI003");
  await portalDown(true);
  await order(p3.id, 1, "Stuck Sale");
  await sleep(900);
  await portalDown(false);

  /* Age the event out by hand — 25 real failed attempts would be the same
     state, several minutes slower. Fixture setup, not an assertion. */
  exhaustAttempts("LUMI003");
  await sleep(400);

  await portalSet("LUMI003", 77);
  const r = await syncNow();
  ok("the stuck SKU is named, not hidden", r.pull.stuck_skus.some((x) => /LUMI\s*003/i.test(x)),
     JSON.stringify(r.pull.stuck_skus));
  ok("and it is NOT deferred any more", !r.pull.deferred.some((x) => /LUMI\s*003/i.test(x)),
     JSON.stringify(r.pull.deferred));
  const after = await bySku("LUMI003");
  ok("the shelf follows the portal again (77)", after.stock === 77, `stock=${after.stock}`);

  /* …while a sale still IN FLIGHT is protected exactly as before. */
  /* Readable, but refusing our sales — the only state in which a pull can
     be watched while a sale is genuinely still in flight. */
  /* Same guard as the order-feed step: earlier steps and earlier runs move
     this SKU's count around, and an out-of-stock 400 here would fail an
     assertion that is about DEFERRAL, not stock. */
  await portalSet("LUMI004", 40);
  await syncNow();
  await fetch(`${PORTAL}/_down`, { method: "POST", body: JSON.stringify({ down: true, only: "movements" }) });
  const p4 = await bySku("LUMI004");
  const o4 = await order(p4.id, 1, "In Flight");
  ok("the in-flight order was accepted", Boolean(o4.token), JSON.stringify(o4).slice(0, 160));
  await sleep(900);
  await portalSet("LUMI004", 55);
  const r2 = await syncNow();
  ok("the pull itself ran fine", !r2.pull.error, String(r2.pull.error));
  ok("an in-flight sale still defers its SKU", r2.pull.deferred.some((x) => /LUMI\s*004/i.test(x)),
     JSON.stringify(r2.pull.deferred));
  ok("its count was left alone", (await bySku("LUMI004")).stock !== 55);
  await portalDown(false);
  for (let i = 0; i < 6; i++) { await syncNow(); if ((await status()).pending === 0) break; }
}

step("the portal frames the carousel photo (v1.8.0)");
{
  /* The CEO: "I want to adjustable the photo so that I can focus on what I
     want. it is look too zoom and which is cause the photo cant be seen the
     overall!!" — the crop is no longer the storefront's guess. */
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 41, photo: "hero1", marker: "f1", title: "Framed", focus_x: 20, focus_y: 80, fit: "cover" },
    { id: 42, photo: "hero2", marker: "f2", fit: "contain" },
  ] }) });
  await syncNow();
  const j = await jget(`${API}/products`);
  const a = (j.slides ?? []).find((x) => x.portal_id === 41);
  const b = (j.slides ?? []).find((x) => x.portal_id === 42);
  ok("the aim point crossed over", a?.focus_x === 20 && a?.focus_y === 80,
     JSON.stringify({ x: a?.focus_x, y: a?.focus_y }));
  ok("cropping stays the default", a?.fit === "cover", String(a?.fit));
  ok("and 'show the whole photo' crossed over too", b?.fit === "contain", String(b?.fit));

  /* Re-aiming is a caption-style edit: no marker change, so no re-download. */
  const key = a.image_key;
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 41, photo: "hero1", marker: "f1", title: "Framed", focus_x: 65, focus_y: 15, fit: "cover" },
    { id: 42, photo: "hero2", marker: "f2", fit: "contain" },
  ] }) });
  await syncNow();
  const j2 = await jget(`${API}/products`);
  const a2 = (j2.slides ?? []).find((x) => x.portal_id === 41);
  ok("re-aiming lands", a2?.focus_x === 65 && a2?.focus_y === 15, JSON.stringify({ x: a2?.focus_x, y: a2?.focus_y }));
  ok("without re-downloading the photo", a2?.image_key === key);

  /* A portal older than its framing migration sends neither field, and the
     honest answer is the middle of the photo, filling the banner. */
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 41, photo: "hero1", marker: "f1", title: "Framed", noFraming: true },
  ] }) });
  await syncNow();
  const j3 = await jget(`${API}/products`);
  const a3 = (j3.slides ?? []).find((x) => x.portal_id === 41);
  ok("no framing from the portal = the middle, filling", a3?.focus_x === 50 && a3?.focus_y === 50 && a3?.fit === "cover",
     JSON.stringify({ x: a3?.focus_x, y: a3?.focus_y, fit: a3?.fit }));
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [] }) });
  await syncNow();
}

step("the portal can zoom a carousel photo out (v1.9.0)");
{
  /* The CEO: "Instead of clickable, I want to zoom out at least I can see
     the full instead of like this!!!" — one number, 100 = every edge of the
     photo visible inside the hero. */
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 51, photo: "hero1", marker: "z1", title: "Zoomed", zoom: 100 },
    { id: 52, photo: "hero2", marker: "z2", zoom: 175, focus_x: 40, focus_y: 60 },
  ] }) });
  await syncNow();
  const j = await jget(`${API}/products`);
  const a = (j.slides ?? []).find((x) => x.portal_id === 51);
  const b = (j.slides ?? []).find((x) => x.portal_id === 52);
  ok("the whole photo setting crossed over", a?.zoom === 100, String(a?.zoom));
  ok("and a part-way zoom crossed over with its aim", b?.zoom === 175 && b?.focus_x === 40 && b?.focus_y === 60,
     JSON.stringify({ z: b?.zoom, x: b?.focus_x, y: b?.focus_y }));

  // re-zooming is a caption-style edit: no new photo download
  const key = a.image_key;
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 51, photo: "hero1", marker: "z1", title: "Zoomed", zoom: 230 },
  ] }) });
  const r = await syncNow();
  const a2 = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 51);
  ok("re-zooming lands without re-downloading", a2?.zoom === 230 && a2?.image_key === key,
     JSON.stringify({ z: a2?.zoom, same: a2?.image_key === key }));
  ok("the pull did not report a photo copy", r.pull.photos === 0, String(r.pull.photos));

  // an out-of-range number is clamped rather than trusted
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 51, photo: "hero1", marker: "z1", zoom: 9000 },
  ] }) });
  await syncNow();
  const a3 = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 51);
  ok("a mad zoom is clamped, never trusted", a3?.zoom === 300, String(a3?.zoom));

  // a portal older than 0089 sends nothing, and the old crop switch answers
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 51, photo: "hero1", marker: "z1", noZoom: true, fit: "contain" },
  ] }) });
  await syncNow();
  const a4 = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 51);
  ok("no zoom from the portal leaves the old switch in charge", (a4?.zoom ?? null) === null && a4?.fit === "contain",
     JSON.stringify({ z: a4?.zoom, f: a4?.fit }));
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [] }) });
  await syncNow();
}

step("the portal can say SYNC NOW without an admin key (v1.9.0)");
{
  /* The CEO: "still the discount is not live update!!!!" — the shop refreshes
     on a schedule, and there was no way to hurry it from the portal because
     the only sync button lived behind ADMIN_KEY in a store screen she does
     not use. This route takes the shared bridge key instead. */
  const p2 = await bySku("LUMI002");
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: "LUMI002", price_cents: 4321 }) });
  const res = await fetch(`${API}/bridge/sync-now`, {
    method: "POST", headers: { "X-Bridge-Key": "shared-bridge-secret" },
  });
  ok("the portal's request was accepted", res.status === 200, `${res.status}`);
  const body = await res.json();
  ok("and it reports what moved", typeof body.prices === "number", JSON.stringify(body));
  ok("the new price is live immediately", (await bySku("LUMI002")).price_cents === 4321,
     `${(await bySku("LUMI002")).price_cents} (was ${p2.price_cents})`);

  const bad = await fetch(`${API}/bridge/sync-now`, { method: "POST", headers: { "X-Bridge-Key": "wrong" } });
  ok("a wrong key is refused", bad.status === 401, `${bad.status}`);
  const none = await fetch(`${API}/bridge/sync-now`, { method: "POST" });
  ok("no key at all is refused", none.status === 401, `${none.status}`);
}

step("a shared product link previews THAT product (v1.9.0)");
{
  /* The CEO: "thumbnail also should take the actual photo of based on the
     product that customer want to share on the WhatsApp or any social
     platform". WhatsApp reads og: tags from the URL itself, and the shop is
     one static page for every product — so the share link is served here. */
  const withPhoto = (await jget(`${API}/products`)).products.find((x) => x.image_key);
  const html = await (await fetch(`${API}/share/${withPhoto.id}`)).text();
  const og = (prop) => (html.match(new RegExp(`property="og:${prop}" content="([^"]*)"`)) ?? [])[1];
  ok("the preview title is the product", (og("title") ?? "").includes(withPhoto.name), String(og("title")));
  ok("the preview photo is the product's own", (og("image") ?? "").includes(withPhoto.image_key.split("/").pop()),
     String(og("image")));
  ok("the preview price is in the description", /RM\s?\d/.test(og("description") ?? ""), String(og("description")));
  ok("and the link points a real visitor at the product page", (og("url") ?? "").includes(`/p?id=${withPhoto.id}`),
     String(og("url")));
  ok("a crawler is not redirected away before reading the tags", /http-equiv="refresh"/.test(html));

  /* An unknown or retired product must not 404 a link somebody has already
     sent — it lands on the shop with the house preview. */
  const missing = await fetch(`${API}/share/99999`);
  ok("an unknown id still answers", missing.status === 200, `${missing.status}`);
  const mh = await missing.text();
  ok("with the shop's own preview", /og:url" content="[^"]*\/shop"/.test(mh));
}

step("the portal names its own collections (v1.10.0)");
{
  /* The CEO: "why it is Bawal plain? I think I should be able to add the
     category in the portal so that easier for me to categorized it."
     The store used to accept two words and then split the bawal range by
     running a regex over the product NAME — which is where the shelf called
     "Bawal Plain" came from. Any name the portal sends is now the shelf. */
  await fetch(`${PORTAL}/_add`, { method: "POST", body: JSON.stringify({
    sku: "LUMI001", category: "Bawal Printed" }) });
  await syncNow();
  ok("a collection she invented lands on the product", (await bySku("LUMI001")).category === "Bawal Printed",
     String((await bySku("LUMI001")).category));

  // renaming it in the portal renames the shelf here
  await fetch(`${PORTAL}/_add`, { method: "POST", body: JSON.stringify({
    sku: "LUMI001", category: "Raya Exclusive" }) });
  await syncNow();
  ok("renaming it in the portal renames it here", (await bySku("LUMI001")).category === "Raya Exclusive",
     String((await bySku("LUMI001")).category));

  // the customer-facing payload carries the name as typed
  const pub = (await jget(`${API}/products`)).products.find((x) => x.sku === "LUMI001");
  ok("and the shopfront sees it", pub?.category === "Raya Exclusive", String(pub?.category));

  // a portal that says nothing leaves the shelf alone — the feed's oldest rule
  await fetch(`${PORTAL}/_add`, { method: "POST", body: JSON.stringify({ sku: "LUMI001" }) });
  await syncNow();
  ok("saying nothing leaves the collection standing", (await bySku("LUMI001")).category === "Raya Exclusive",
     String((await bySku("LUMI001")).category));

  /* A brand-new SKU with a collection is created into it; without one it
     lands in Bawal, the range this shop started as. */
  const NEWSKU = `COLL${String(Date.now() % 100000).padStart(5, "0")}`;
  await portalAdd({ sku: NEWSKU, name: "Collection Test", category: "Shawl Premium", price_cents: 4200, stock: 3 });
  await syncNow();
  const made = await bySku(NEWSKU);
  ok("a new SKU is created into the portal's collection", made?.category === "Shawl Premium", String(made?.category));

  // tidy: retire the fixture and put LUMI001 back where it started
  await admin(`/admin/products/${made.id}`, { method: "PUT", body: JSON.stringify({ sku: `RET${Date.now() % 1e9}`, active: false }) });
  await portalRemove(NEWSKU);
  await fetch(`${PORTAL}/_add`, { method: "POST", body: JSON.stringify({ sku: "LUMI001", category: "bawal" }) });
  await syncNow();
}

step("a cut-out model steps out of the banner (v1.11.0)");
{
  /* The CEO's reference image: the model standing OUT of the carousel. It
     is a second picture, not an effect — a PNG with a see-through
     background, drawn over the slide and above its top edge. */
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 61, photo: "hero1", marker: "k1", title: "New Arrivals",
      cutout: "model", cutoutMarker: "c1", cutoutSide: "left", cutoutScale: 135 },
  ] }) });
  await syncNow();
  const a = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 61);
  ok("the cut-out was copied into the store's own storage",
     typeof a?.cutout_key === "string" && a.cutout_key.startsWith("slides/cut-"), String(a?.cutout_key));
  ok("with the side and height the portal chose", a?.cutout_side === "left" && a?.cutout_scale === 135,
     JSON.stringify({ side: a?.cutout_side, scale: a?.cutout_scale }));
  const img = await fetch(`${API}/media/${a.cutout_key}`);
  ok("and the store serves it itself", img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"),
     `${img.status}`);

  // an unchanged marker costs nothing
  const key = a.cutout_key;
  const r = await syncNow();
  const again = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 61);
  ok("an unchanged cut-out is not re-downloaded", again?.cutout_key === key, String(again?.cutout_key));
  ok("the pull reports no copies", r.pull.photos === 0, String(r.pull.photos));

  // moving her to the other side is a cheap edit, no re-download
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 61, photo: "hero1", marker: "k1", title: "New Arrivals",
      cutout: "model", cutoutMarker: "c1", cutoutSide: "right", cutoutScale: 160 },
  ] }) });
  await syncNow();
  const moved = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 61);
  ok("moving and resizing her costs no download", moved?.cutout_side === "right"
     && moved?.cutout_scale === 160 && moved?.cutout_key === key,
     JSON.stringify({ side: moved?.cutout_side, scale: moved?.cutout_scale }));

  // removing it in the portal returns the slide to a plain banner
  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [
    { id: 61, photo: "hero1", marker: "k1", title: "New Arrivals" },
  ] }) });
  await syncNow();
  const plain = ((await jget(`${API}/products`)).slides ?? []).find((x) => x.portal_id === 61);
  ok("removing it leaves a plain banner", (plain?.cutout_key ?? null) === null, String(plain?.cutout_key));
  ok("and the slide itself is untouched", plain?.image_key === a.image_key);

  await fetch(`${PORTAL}/_slides`, { method: "POST", body: JSON.stringify({ slides: [] }) });
  await syncNow();
}

step("tidy up after this run");
{
  /* The store keeps products; the stand-in portal forgets everything when it
     restarts. Left alone, this run's two shawls would show up as "unknown
     there" at the start of the next one — the same reason the GHOST001 step
     retires its product. */
  for (const sku of [SHAWL, SHAWL_B]) {
    const p = await bySku(sku);
    if (p) await admin(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
    await portalRemove(sku);
  }
  const r = await syncNow();
  ok("the store and the portal agree again", r.pull.unmatched_store.length === 0 && r.pull.unmatched_portal.length === 0,
     JSON.stringify({ store: r.pull.unmatched_store, portal: r.pull.unmatched_portal }));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
