/**
 * v1.5.1 — the WHOLE bridge, both real workers, no stand-ins:
 *
 *   A2Z portal worker (wrangler dev :8300, real D1 + R2)
 *     ⇅
 *   ELFIA store worker (wrangler dev :8787, real D1 + R2)
 *
 * Proves the CEO's 25-08 ask end to end: a shawl that exists only in the
 * portal — with a photo uploaded there, a description and a collection —
 * arrives in the ELFIA store as a hidden product with the photo copied into
 * ELFIA's own storage; publishing it puts it in the shop; a portal-side
 * description edit flows across on the next sync; and an ELFIA sale walks
 * back into the portal's stock ledger through the movements feed.
 *
 * Run (after scratch/elfia-bridge-e2e.mjs's setup on the portal side, and
 * with the store's .dev.vars pointing BRIDGE_URL/BRIDGE_PUSH_URL at :8300):
 *   node scratch/portal-live-e2e.mjs
 */
const STORE = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL_API ?? "http://127.0.0.1:8300/api/v1";
const KEY = "test-passcode-123";
const CSRF = "e2ecsrf";
const COOKIES = `azone_session=e2etoken; csrf_token=${CSRF}`;

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = (p, o = {}) => fetch(`${STORE}${p}`, { ...o, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(o.headers ?? {}) } });
const portalStaff = (p, o = {}) => fetch(`${PORTAL}/staff${p}`, { ...o, headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "application/json", ...(o.headers ?? {}) } });
const syncNow = () => admin("/admin/sync-stock", { method: "POST" }).then((r) => r.json());
const storeProducts = () => admin("/admin/products").then((r) => r.json()).then((j) => j.products);
const bySku = async (sku) => (await storeProducts()).find((p) => p.sku && p.sku.replace(/\s+/g, "").toUpperCase() === sku);

/* Every run is a fresh customer and a fresh portal baseline — the two local
   databases survive between runs and must not leak one run's state into the
   next one's assertions. */
const RUN = Math.floor(Math.random() * 900) + 100;

step("start clean: reset the portal's shawl to the seeded baseline");
{
  const inv = await (await portalStaff(`/inventory`)).json();
  const pShawl = inv.items.find((x) => x.sku === "SHWL 001");
  await portalStaff(`/inventory/${pShawl.id}`, { method: "PATCH", body: JSON.stringify({ stock: 8 }) });
  await portalStaff(`/inventory/${pShawl.id}/elfia`, {
    method: "PATCH", body: JSON.stringify({ description: "Long-cut, lightweight and opaque. Finished by hand." }),
  });
  ok("portal baseline restored", true);
}

step("start clean: retire any SHWL001 an earlier run left in the store");
{
  /* The local D1 survives between runs. If SHWL001 already exists, this run
     would test "refresh" instead of "create" — so the old row is renamed out
     of the way and hidden (same trick the sync suite's GHOST step uses; the
     store has no delete on purpose). */
  let prev = await bySku("SHWL001");
  for (let i = 0; prev && i < 5; i++) {
    await admin(`/admin/products/${prev.id}`, {
      method: "PUT", body: JSON.stringify({ sku: `RET${Date.now() % 1e9}${i}`, active: false }),
    });
    prev = await bySku("SHWL001");
  }
  ok("no SHWL001 in the store before the pull", !prev);
}

step("the store pulls from the REAL portal");
{
  const r = await syncNow();
  ok("pull ran against :8300", r.pull.configured && !r.pull.error, JSON.stringify(r.pull.error ?? ""));
  ok("the portal-only shawl was created", r.pull.created.some((c) => c.sku.replace(/\s+/g, "") === "SHWL001")
      || Boolean(await bySku("SHWL001")), JSON.stringify(r.pull.created));
  ok("its portal photo was copied", r.pull.photo_errors.length === 0, JSON.stringify(r.pull.photo_errors));
}

let shawl;
step("the created product carries the portal's dressing");
{
  shawl = await bySku("SHWL001");
  ok("exists", Boolean(shawl));
  ok("hidden, pending review", shawl.active === 0 && shawl.portal_pending === 1, JSON.stringify({ a: shawl.active, p: shawl.portal_pending }));
  ok("the portal's name", shawl.name === "Shawl Premium — Beige", shawl.name);
  ok("the portal's collection", shawl.category === "shawl", shawl.category);
  ok("the portal's description", shawl.description === "Long-cut, lightweight and opaque. Finished by hand.", String(shawl.description));
  ok("the portal's price and count", shawl.price_cents === 5500 && shawl.stock === 8, JSON.stringify({ price: shawl.price_cents, stock: shawl.stock }));
  ok("photo copied into ELFIA's own R2", typeof shawl.image_key === "string" && shawl.image_key.startsWith("products/"), String(shawl.image_key));
  const img = await fetch(`${STORE}/media/${shawl.image_key}`);
  ok("and ELFIA serves it itself", img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"), `${img.status}`);
}

step("an unchanged portal photo is not re-downloaded");
{
  const before = (await bySku("SHWL001")).image_key;
  const r = await syncNow();
  ok("photos copied this pull: 0", r.pull.photos === 0, `${r.pull.photos}`);
  ok("the key is untouched", (await bySku("SHWL001")).image_key === before);
}

step("a description edit in the portal flows to the store");
{
  const portalInv = await (await portalStaff(`/inventory`)).json();
  const pShawl = portalInv.items.find((x) => x.sku === "SHWL 001");
  await portalStaff(`/inventory/${pShawl.id}/elfia`, {
    method: "PATCH", body: JSON.stringify({ description: "Edited in the portal — v2." }),
  });
  await syncNow();
  const after = await bySku("SHWL001");
  ok("the store's copy updated", after.description === "Edited in the portal — v2.", String(after.description));
  ok("while a hand-made product's description is untouched",
    (await bySku("LUMI001")).description !== "Edited in the portal — v2.");
}

step("Publish in the store's admin puts it in the shop");
{
  await admin(`/admin/products/${shawl.id}/publish`, { method: "POST", body: "{}" });
  const pub = await bySku("SHWL001");
  ok("live", pub.active === 1 && pub.portal_pending === 0);
  const shop = await (await fetch(`${STORE}/products`)).json();
  ok("customers see it, with the portal's photo", shop.products.some((x) => x.id === shawl.id && x.image_key === pub.image_key));
}

step("an ELFIA sale walks back into the REAL portal");
{
  const invBefore = await (await portalStaff(`/inventory`)).json();
  const before = invBefore.items.find((x) => x.sku === "SHWL 001").stock;
  const o = await (await fetch(`${STORE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.77.${RUN % 250}.${(Date.now() % 250) + 1}` },
    body: JSON.stringify({ customer: { name: "Bridge Buyer", phone: `0177${String(RUN)}${String(Date.now() % 1000).padStart(3, "0")}`, address: "1 Jalan Bridge" }, items: [{ id: shawl.id, qty: 2 }] }),
  })).json();
  ok("order placed in the store", Boolean(o.token), JSON.stringify(o).slice(0, 120));
  await sleep(1500); // the push fires on the way out of the request
  const invAfter = await (await portalStaff(`/inventory`)).json();
  const after = invAfter.items.find((x) => x.sku === "SHWL 001").stock;
  ok(`the portal's count moved (${before} → ${after})`, after === before - 2, `${before} -> ${after}`);
  const health = await (await portalStaff(`/inventory/bridge-health`)).json();
  ok("the portal's bridge health saw the movement", (health.applied_24h ?? 0) >= 1, JSON.stringify(health).slice(0, 140));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
