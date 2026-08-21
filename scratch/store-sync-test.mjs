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

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
