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
const adminProducts = () => admin("/admin/products").then((r) => r.json()).then((j) => j.products);
const bySku = async (sku) => (await adminProducts()).find((p) => p.sku && p.sku.replace(/\s+/g, "").toUpperCase() === sku);
const syncNow = () => admin("/admin/sync-stock", { method: "POST" }).then((r) => r.json());
const status = () => admin("/admin/sync-status").then((r) => r.json());
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

  const placed = await order(products.find((x) => x.sku === "LUMI003").id, 1, "Feed Test");
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

step("start clean: retire fixtures other suites left in the store");
{
  /* scratch/portal-live-e2e.mjs (the real-portal rig) publishes a SHWL001.
     The stand-in portal here does not carry that SKU, so a leftover row
     would show up as "unknown there" in every reconciliation below. Same
     retire trick as that suite uses: rename the SKU away and hide it. */
  for (let i = 0; i < 5; i++) {
    const left = await bySku("SHWL001");
    if (!left) break;
    await admin(`/admin/products/${left.id}`, {
      method: "PUT", body: JSON.stringify({ sku: `RET${Date.now() % 1e9}${i}`, active: false }),
    });
  }
  ok("no cross-suite fixture is still live", !(await bySku("SHWL001")));
}

step("start from an empty review queue");
{
  /* The same reasoning as "start from a settled outbox" above: the local
     database survives between runs, and a row an earlier run left waiting
     would make this one's counts read wrong. Dismissing leaves them hidden. */
  for (const p of await adminProducts()) {
    if (p.portal_pending === 1) {
      await admin(`/admin/products/${p.id}/publish`, { method: "POST", body: JSON.stringify({ publish: false }) });
    }
  }
  ok("nothing is waiting to be published", (await status()).portal_pending === 0);
}

step("a SKU the store has never had is CREATED, hidden (v1.5.0)");
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

  /* The whole safety of this feature: the portal can propose, only a human
     can publish. */
  ok("it is HIDDEN — no customer can see it yet", p?.active === 0, `active=${p?.active}`);
  ok("and it is waiting in the review queue", p?.portal_pending === 1);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("the public catalogue does not carry it", !shopfront.some((x) => x.id === shawlId));
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

step("the portal never overwrites a photo chosen in /admin");
{
  /* LUMI003 ships with a hand-picked campaign shot. The portal offering one
     must not be able to wipe it — prices moved to the portal, photography
     did not. */
  const p3 = await bySku("LUMI003");
  const before = p3.image_key;
  ok("the store's own photo is not a portal one to begin with", !p3.image_marker, String(p3.image_marker));
  await portalPhoto({ sku: "LUMI 003", photo: "hijack", marker: "x1" });
  const r = await syncNow();
  const after = await bySku("LUMI003");
  ok("the store's photo stands", after.image_key === before, `${before} -> ${after.image_key}`);
  ok("and nothing was counted as copied", r.pull.photos === 0, `photos=${r.pull.photos}`);
  await portalPhoto({ sku: "LUMI 003", photo: null });
}

step("a hidden product keeps syncing while it waits for review");
{
  await portalSet(SHAWL, 20);
  await fetch(`${PORTAL}/_price`, { method: "POST", body: JSON.stringify({ sku: SHAWL, price_cents: 5900 }) });
  await syncNow();
  const p = await bySku(SHAWL);
  ok("its count followed the portal (20)", p.stock === 20, `stock=${p.stock}`);
  ok("its price followed the portal (RM 59)", p.price_cents === 5900, `price=${p.price_cents}`);
  ok("it is still hidden", p.active === 0);
}

step("a waiting product is not accused of being unknown to the portal");
{
  const r = await syncNow();
  ok("the report leaves the pending row out of 'unknown there'",
     !r.pull.unmatched_store.some((x) => /SHWL/i.test(x)), JSON.stringify(r.pull.unmatched_store));
}

step("Publish puts it in the shop");
{
  const pendingBefore = (await status()).portal_pending;
  const res = await admin(`/admin/products/${shawlId}/publish`, { method: "POST", body: "{}" });
  ok("publish accepted", res.status === 200, `${res.status}`);
  const p = await bySku(SHAWL);
  ok("it is live", p.active === 1);
  ok("and out of the review queue", p.portal_pending === 0);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("customers can now see it", shopfront.some((x) => x.id === shawlId));
  const st = await status();
  ok("the review counter went down by one", st.portal_pending === pendingBefore - 1,
     `${pendingBefore} -> ${st.portal_pending}`);
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
  ok("and it joined the review queue", st.portal_pending === pendingBefore + 1,
     `${pendingBefore} -> ${st.portal_pending}`);
}

step("an oversized photo is refused too");
{
  await portalPhoto({ sku: SHAWL_B, photo: "huge", marker: "h2" });
  const r = await syncNow();
  ok("the 6 MB file is refused", r.pull.photo_errors.some((e) => /5 MB/i.test(e)), JSON.stringify(r.pull.photo_errors));
  ok("nothing was stored", !(await bySku(SHAWL_B)).image_key);
}

step("Dismiss clears the queue without publishing");
{
  const p = await bySku(SHAWL_B);
  await admin(`/admin/products/${p.id}/publish`, { method: "POST", body: JSON.stringify({ publish: false }) });
  const after = await bySku(SHAWL_B);
  ok("still hidden", after.active === 0);
  ok("but out of the queue", after.portal_pending === 0);
  const shopfront = (await jget(`${API}/products`)).products;
  ok("and still invisible to customers", !shopfront.some((x) => x.id === after.id));
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
