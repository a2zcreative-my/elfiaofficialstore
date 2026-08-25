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
  /* v1.9.0 — clear any explicit web price a previous run left behind (the
     "Update the shop now" step sets one), so the seeded RM 55 is the
     baseline every run measures against. */
  await portalStaff(`/inventory/${pShawl.id}/bridge`, { method: "PATCH", body: JSON.stringify({ elfia_price: "" }) });
  await portalStaff(`/inventory/${pShawl.id}/elfia`, {
    method: "PATCH", body: JSON.stringify({ description: "Long-cut, lightweight and opaque. Finished by hand.", discount: "" }),
  });
  /* The rig needs a photo to exist ON THE PORTAL for the copy step below to
     mean anything. A freshly seeded database has none, so one is put there
     rather than assumed — a missing fixture should not read as a broken
     bridge. */
  if (!pShawl.elfia_image_key) {
    const PNG1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    await fetch(`${PORTAL}/staff/inventory/${pShawl.id}/elfia/photo`, {
      method: "POST", headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "image/png" }, body: PNG1,
    });
  }

  /* v1.46.0 — slides and discounts survive in the portal's D1 between runs;
     a leftover would turn this run's "create" into "refresh". */
  const sl = await (await portalStaff(`/elfia/slides`)).json();
  for (const s of sl.slides ?? []) {
    await portalStaff(`/elfia/slides/${s.id}`, { method: "PATCH", body: JSON.stringify({ remove: true }) });
  }
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
  /* v1.8.0 — the CEO's rule: the portal's Publish tick IS the decision, so
     a feed item arrives LIVE. (The feed only carries bridge_enabled rows.) */
  ok("live immediately — the portal already published it", shawl.active === 1 && shawl.portal_pending === 0,
     JSON.stringify({ a: shawl.active, p: shawl.portal_pending }));
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

step("v1.6.0 — a portal photo TAKES OVER a store-made product");
{
  /* The CEO's 25-08 rule: matching a portal item to a store SKU is the
     instruction to take it over — name, photo, collection. LUMI001 is a
     store-made product with the shipped campaign shot; the portal now
     photographs it, and the shop must show the portal's photo on the next
     pull. */
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const portalInv = await (await portalStaff(`/inventory`)).json();
  const pLumi = portalInv.items.find((x) => x.sku === "LUMI 001");
  const before = (await bySku("LUMI001")).image_key;
  const up = await fetch(`${PORTAL}/staff/inventory/${pLumi.id}/elfia/photo`, {
    method: "POST", headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "image/png" }, body: PNG,
  });
  ok("portal accepted the photo", up.status === 201, `${up.status}`);
  await syncNow();
  const after = await bySku("LUMI001");
  ok("the store's product now wears the portal's photo",
    after.image_key !== before && String(after.image_key).startsWith("products/"),
    `${before} -> ${after.image_key}`);
}

step("no /admin visit is needed — it is already in the shop (v1.8.0)");
{
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

step("v1.46.0 — a discount set in the portal becomes a slashed price in the shop");
{
  const inv = await (await portalStaff(`/inventory`)).json();
  const pShawl = inv.items.find((x) => x.sku === "SHWL 001");
  const set = await portalStaff(`/inventory/${pShawl.id}/elfia`, { method: "PATCH", body: JSON.stringify({ discount: 5 }) });
  ok("the portal accepted the RM 5 discount", set.status === 200, `${set.status}`);
  await syncNow();
  const s = await bySku("SHWL001");
  ok("the customer pays the net price (RM 50)", s.price_cents === 5000, `${s.price_cents}`);
  ok("the old price rides along for the strike-through", s.compare_price_cents === 5500, `${s.compare_price_cents}`);
  const shop = await (await fetch(`${STORE}/products`)).json();
  const pub = shop.products.find((x) => x.id === s.id);
  ok("the shopfront carries both numbers", Boolean(pub) && pub.price_cents === 5000 && pub.compare_price_cents === 5500,
     JSON.stringify({ price: pub?.price_cents, was: pub?.compare_price_cents }));

  await portalStaff(`/inventory/${pShawl.id}/elfia`, { method: "PATCH", body: JSON.stringify({ discount: "" }) });
  await syncNow();
  const cleared = await bySku("SHWL001");
  ok("clearing it in the portal takes the badge off", cleared.price_cents === 5500 && (cleared.compare_price_cents ?? null) === null,
     JSON.stringify({ price: cleared.price_cents, was: cleared.compare_price_cents }));
}

step("v1.46.0 — a slide uploaded in the portal becomes the shop's carousel");
{
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  const up = await fetch(`${PORTAL}/staff/elfia/slides/photo`, {
    method: "POST", headers: { Cookie: COOKIES, "X-CSRF-Token": CSRF, "Content-Type": "image/png" }, body: PNG,
  });
  ok("the portal accepted the slide photo", up.status === 201, `${up.status}`);
  const slide = await up.json();
  await portalStaff(`/elfia/slides/${slide.id}`, {
    method: "PATCH", body: JSON.stringify({ title: "Raya Drop", subtitle: "Koleksi terbaru" }),
  });
  await syncNow();
  const shop = await (await fetch(`${STORE}/products`)).json();
  const got = (shop.slides ?? []).find((x) => x.portal_id === slide.id);
  ok("the shopfront now carries the slide", Boolean(got), JSON.stringify(shop.slides ?? null));
  ok("with the portal's captions", got?.title === "Raya Drop" && got?.subtitle === "Koleksi terbaru",
     JSON.stringify({ t: got?.title, s: got?.subtitle }));
  ok("its photo was copied into ELFIA's own R2", typeof got?.image_key === "string" && got.image_key.startsWith("slides/"),
     String(got?.image_key));
  const img = got ? await fetch(`${STORE}/media/${got.image_key}`) : { status: 0, headers: new Headers() };
  ok("and ELFIA serves it itself", img.status === 200 && (img.headers.get("content-type") ?? "").startsWith("image/"), `${img.status}`);

  /* v1.47.0/v1.8.0 — the CEO aims the photo in the portal and the shop
     crops to match; "whole photo" turns the crop off altogether. */
  await portalStaff(`/elfia/slides/${slide.id}`, {
    method: "PATCH", body: JSON.stringify({ focus_x: 25, focus_y: 75 }),
  });
  await syncNow();
  const framed = ((await (await fetch(`${STORE}/products`)).json()).slides ?? [])
    .find((x) => x.portal_id === slide.id);
  ok("the aim point reached the shop", framed?.focus_x === 25 && framed?.focus_y === 75,
     JSON.stringify({ x: framed?.focus_x, y: framed?.focus_y }));
  await portalStaff(`/elfia/slides/${slide.id}`, { method: "PATCH", body: JSON.stringify({ fit: "contain" }) });
  await syncNow();
  const whole = ((await (await fetch(`${STORE}/products`)).json()).slides ?? [])
    .find((x) => x.portal_id === slide.id);
  ok("and 'show the whole photo' reached it too", whole?.fit === "contain", String(whole?.fit));

  /* v1.48.0/v1.9.0 — the zoom dial: 100 shows every edge of the photo. */
  await portalStaff(`/elfia/slides/${slide.id}`, { method: "PATCH", body: JSON.stringify({ zoom: 100 }) });
  await syncNow();
  const wide = ((await (await fetch(`${STORE}/products`)).json()).slides ?? [])
    .find((x) => x.portal_id === slide.id);
  ok("zoomed out to the whole photo", wide?.zoom === 100, String(wide?.zoom));
  ok("and the old crop switch was kept in step", wide?.fit === "contain", String(wide?.fit));
  await portalStaff(`/elfia/slides/${slide.id}`, { method: "PATCH", body: JSON.stringify({ zoom: 190 }) });
  await syncNow();
  const tight = ((await (await fetch(`${STORE}/products`)).json()).slides ?? [])
    .find((x) => x.portal_id === slide.id);
  ok("and zoomed back in", tight?.zoom === 190 && tight?.fit === "cover",
     JSON.stringify({ z: tight?.zoom, f: tight?.fit }));

  /* Remove in the portal — the ONE feed section where absence means delete. */
  await portalStaff(`/elfia/slides/${slide.id}`, { method: "PATCH", body: JSON.stringify({ remove: true }) });
  await syncNow();
  const after = await (await fetch(`${STORE}/products`)).json();
  ok("removing it in the portal removes it from the shop", !(after.slides ?? []).some((x) => x.portal_id === slide.id),
     JSON.stringify(after.slides ?? null));
}

step("v1.48.0 — the portal's own 'Update the shop now' button");
{
  /* The CEO: "still the discount is not live update!!!!". This proves the
     whole path she will actually use: set a price in the portal, press the
     button, and the shop has it — no waiting for a scheduled sync, no admin
     key, no store screen. */
  const inv = await (await portalStaff(`/inventory`)).json();
  const pShawl = inv.items.find((x) => x.sku === "SHWL 001");
  const target = 4321;
  await portalStaff(`/inventory/${pShawl.id}/bridge`, {
    method: "PATCH", body: JSON.stringify({ elfia_price: (target / 100).toFixed(2) }),
  });
  const res = await portalStaff(`/elfia/sync-now`, { method: "POST", body: "{}" });
  ok("the portal reached the shop", res.status === 200, `${res.status}`);
  const shawlNow = await bySku("SHWL001");
  ok("and the new price is already live", shawlNow.price_cents === target,
     `${shawlNow.price_cents} (wanted ${target})`);
  // put the seeded price back so the next run starts where this one did
  await portalStaff(`/inventory/${pShawl.id}/bridge`, { method: "PATCH", body: JSON.stringify({ elfia_price: "" }) });
  await portalStaff(`/elfia/sync-now`, { method: "POST", body: "{}" });
}

step("v1.51.0 — the portal fulfils an order: paid, tracking, delivered");
{
  /* The CEO: "elfia web order should be able to update the tracking number
     so that customer can track the order based on the order number that
     filled by staff in the portal". This is that whole path against the two
     real workers — and the customer's own order page is checked at the end,
     because a tracking number nobody can see is not tracking. */
  const shawlNow = await bySku("SHWL001");
  const o = await (await fetch(`${STORE}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.88.${RUN % 250}.${(Date.now() % 250) + 1}` },
    body: JSON.stringify({
      customer: { name: "Tracking Buyer", phone: `0188${String(RUN)}${String(Date.now() % 1000).padStart(3, "0")}`, address: "1 Jalan Track" },
      items: [{ id: shawlNow.id, qty: 1 }],
    }),
  })).json();
  ok("order placed in the shop", Boolean(o.token) && Boolean(o.order_number), JSON.stringify(o).slice(0, 120));

  const act = (action, extra = {}) => portalStaff(`/web-orders/${encodeURIComponent(o.order_number)}/action`, {
    method: "POST", body: JSON.stringify({ action, ...extra }),
  });

  /* Shipping before payment must be refused BY THE STORE, and the refusal
     must reach the portal in words a person can act on. */
  const early = await act("ship", { tracking_no: "TOOSOON", tracking_courier: "jnt" });
  ok("the store refuses to ship an unpaid order", early.status === 409, `${early.status}`);
  const earlyBody = await early.json().catch(() => ({}));
  ok("and says why, in plain words", /cannot ship|pending_payment/i.test(earlyBody?.error?.message ?? ""),
     JSON.stringify(earlyBody).slice(0, 140));

  const paid = await act("confirm_paid");
  ok("the portal can confirm the payment", paid.status === 200, `${paid.status}`);

  const TRACK = `EP${Date.now() % 100000000}MY`;
  const shipped = await act("ship", { tracking_no: TRACK, tracking_courier: "jnt" });
  ok("the portal can enter the tracking number", shipped.status === 200, `${shipped.status}`);

  /* The customer's own page — the reason any of this exists. */
  const view = await (await fetch(`${STORE}/orders/${o.token}`)).json();
  ok("the customer's order page shows it as shipped", view?.status === "shipped", String(view?.status));
  ok("with the tracking number the staff typed", view?.tracking_no === TRACK,
     `${view?.tracking_no} (wanted ${TRACK})`);

  const done = await act("complete");
  ok("the portal can mark it delivered", done.status === 200, `${done.status}`);
  const after = await (await fetch(`${STORE}/orders/${o.token}`)).json();
  ok("and the customer sees that too", after?.status === "completed", String(after?.status));

  /* A finished order cannot be moved again — the store's forward-only rule
     holds no matter which screen is asking. */
  const again = await act("ship", { tracking_no: "AGAIN", tracking_courier: "jnt" });
  ok("a finished order cannot be shipped again", again.status === 409, `${again.status}`);
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
