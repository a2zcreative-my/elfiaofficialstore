/**
 * Live end-to-end test of the ELFIA store API.
 *
 * Runs the REAL worker against a REAL (local) D1 — no mocks — and walks the
 * whole customer journey plus the admin side, asserting the rules the store
 * depends on: server-side pricing, atomic stock, always-available products,
 * forward-only order states, restock on unpaid cancel, and the admin key.
 *
 * How to run (from worker/):
 *   npx wrangler d1 migrations apply elfia-store --local
 *   echo ADMIN_KEY = "test-passcode-123" > .dev.vars
 *   npx wrangler dev --local --port 8787
 * then, from the project root:
 *   node scratch/store-e2e-live.mjs
 *
 * It writes to whatever database the worker is pointed at — LOCAL ONLY.
 */
const BASE = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const api = async (path, opts = {}) => {
  const r = await fetch(`${BASE}${path}`, opts);
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: r.status, body };
};
const admin = (path, opts = {}) =>
  api(path, { ...opts, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(opts.headers ?? {}) } });

const RM = (c) => `RM ${(c / 100).toFixed(2)}`;

step("health + config");
{
  const h = await api("/health");
  ok("health is ok", h.body.ok === true, JSON.stringify(h.body));
  ok("worker reports a version", /^\d+\.\d+\.\d+$/.test(h.body.version ?? ""), h.body.version);
  console.log(`     → elfia-api ${h.body.version}`);
  const c = await api("/store-config");
  ok("shipping + free-delivery threshold are served", c.body.shipping_cents > 0 && c.body.free_above_cents > 0);
}

step("catalogue");
let products = [];
{
  const r = await api("/products");
  products = r.body.products;
  ok("ten designs are live", products.length === 10, `got ${products.length}`);
  ok("every one is always-available", products.every((p) => p.track_stock === 0));
  ok("SKUs run LUMI001–LUMI010", products.filter((p) => /^LUMI0(0[1-9]|10)$/.test(p.sku)).length === 10);
  const one = await api(`/products/${products[0].id}`);
  ok("a single product loads", one.body.product?.id === products[0].id);
  const missing = await api("/products/999999");
  ok("an unknown product 404s", missing.status === 404);
}

step("a customer places an order (always-available stock)");
let token, orderNo;
{
  const a = products[0], b = products[6]; // RM 49 and RM 59
  const stockBefore = a.stock;
  const r = await api("/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      customer: { name: "Nurul Test", phone: "0123456789", address: "12 Jalan Contoh, 43000 Kajang, Selangor" },
      // A tampered cart: the browser also sends a price. The worker must ignore it.
      items: [{ id: a.id, qty: 2, price_cents: 1 }, { id: b.id, qty: 1, price_cents: 1 }],
    }),
  });
  ok("order accepted", r.status === 201, JSON.stringify(r.body));
  token = r.body.token; orderNo = r.body.order_number;
  ok("order number looks like ELF-DDMMYY-N", /^ELF-\d{6}-\d+$/.test(orderNo ?? ""), orderNo);

  const view = await api(`/orders/${token}`);
  const expectSub = a.price_cents * 2 + b.price_cents;
  ok("priced from the database, not the request", view.body.subtotal_cents === expectSub,
     `${RM(view.body.subtotal_cents)} vs ${RM(expectSub)}`);
  const cfg = view.body.config;
  const expectShip = expectSub >= cfg.free_above_cents ? 0 : cfg.shipping_cents;
  ok("delivery charged per the store rule", view.body.shipping_cents === expectShip);
  ok("total = subtotal + delivery", view.body.total_cents === expectSub + expectShip);
  ok("starts awaiting payment", view.body.status === "pending_payment");

  const after = (await api("/products")).body.products.find((p) => p.id === a.id);
  ok("an always-available design is NOT decremented", after.stock === stockBefore, `${stockBefore} -> ${after.stock}`);
  ok("and it still does not read sold out", after.track_stock === 0);
}

step("the order page is private to its token");
{
  const bad = await api(`/orders/${"0".repeat(32)}`);
  ok("a wrong token 404s", bad.status === 404);
  const noKey = await api("/admin/orders");
  ok("admin needs the key", noKey.status === 401);
  const wrongKey = await api("/admin/orders", { headers: { "X-Admin-Key": "nope" } });
  ok("a wrong key is refused", wrongKey.status === 401);
}

step("admin walks the order forward");
let orderId;
{
  const list = await admin("/admin/orders");
  const o = list.body.orders.find((x) => x.order_number === orderNo);
  orderId = o?.id;
  ok("the order appears in admin", Boolean(orderId));

  const cancelPaid = await admin(`/admin/orders/${orderId}`, { method: "PUT", body: JSON.stringify({ action: "ship" }) });
  ok("cannot ship an unpaid order", cancelPaid.status === 409, JSON.stringify(cancelPaid.body));

  ok("confirm payment", (await admin(`/admin/orders/${orderId}`, { method: "PUT", body: JSON.stringify({ action: "confirm_paid" }) })).status === 200);
  ok("paid orders cannot be cancelled", (await admin(`/admin/orders/${orderId}`, { method: "PUT", body: JSON.stringify({ action: "cancel" }) })).status === 409);
  ok("ship with tracking", (await admin(`/admin/orders/${orderId}`, { method: "PUT", body: JSON.stringify({ action: "ship", tracking_no: "NJV123456789", tracking_courier: "ninjavan" }) })).status === 200);
  ok("mark delivered", (await admin(`/admin/orders/${orderId}`, { method: "PUT", body: JSON.stringify({ action: "complete" }) })).status === 200);

  const view = await api(`/orders/${token}`);
  ok("customer sees it completed with tracking", view.body.status === "completed" && view.body.tracking_no === "NJV123456789");
}

step("a counted product: overselling, sell-out and restock");
{
  const p = products[1];
  await admin(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ track_stock: true, stock: 2 }) });
  const now = (await api(`/products/${p.id}`)).body.product;
  ok("switched to counting stock", now.track_stock === 1 && now.stock === 2);

  const tooMany = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Greedy", phone: "0111111111", address: "somewhere" }, items: [{ id: p.id, qty: 3 }] }),
  });
  ok("cannot buy more than exist", tooMany.status === 409, JSON.stringify(tooMany.body));
  ok("and nothing was reserved by the failed attempt", (await api(`/products/${p.id}`)).body.product.stock === 2);

  const good = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Aina", phone: "0122222222", address: "12 Jalan Dua" }, items: [{ id: p.id, qty: 2 }] }),
  });
  ok("buying the last two works", good.status === 201);
  ok("stock is now zero", (await api(`/products/${p.id}`)).body.product.stock === 0);

  const soldOut = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Late", phone: "0133333333", address: "12 Jalan Tiga" }, items: [{ id: p.id, qty: 1 }] }),
  });
  ok("a sold-out design refuses the order", soldOut.status === 409);

  const id2 = (await admin("/admin/orders")).body.orders.find((o) => o.customer_name === "Aina").id;
  ok("cancelling the unpaid order restocks", (await admin(`/admin/orders/${id2}`, { method: "PUT", body: JSON.stringify({ action: "cancel" }) })).status === 200);
  ok("the two pieces are back on the shelf", (await api(`/products/${p.id}`)).body.product.stock === 2);

  // Leave it as the CEO expects: always available.
  await admin(`/admin/products/${p.id}`, { method: "PUT", body: JSON.stringify({ track_stock: false }) });
}

step("free delivery above the threshold");
{
  const cfg = (await api("/store-config")).body;
  const p = products[0];
  const qty = Math.ceil(cfg.free_above_cents / p.price_cents);
  const r = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Big Order", phone: "0144444444", address: "12 Jalan Empat" }, items: [{ id: p.id, qty }] }),
  });
  ok("large order accepted", r.status === 201);
  const v = await api(`/orders/${r.body.token}`);
  ok(`delivery is free above ${RM(cfg.free_above_cents)}`, v.body.shipping_cents === 0, RM(v.body.shipping_cents));
}

step("bad input is refused");
{
  const noName = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { phone: "0123", address: "x" }, items: [{ id: products[0].id, qty: 1 }] }),
  });
  ok("name/phone/address are required", noName.status === 400);
  const emptyCart = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "A", phone: "0123456789", address: "x" }, items: [] }),
  });
  ok("an empty cart is refused", emptyCart.status === 400);
  const honeypot = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Bot", phone: "0123456789", address: "x", website: "http://spam" }, items: [{ id: products[0].id, qty: 1 }] }),
  });
  ok("the honeypot swallows bots silently", honeypot.status === 200 && !honeypot.body.token);
}

step("restock waitlist");
{
  const p = products[2];
  const first = await api("/notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: p.id, name: "Siti", phone: "0155555555" }),
  });
  ok("a customer can join the waitlist", first.status === 201);
  await api("/notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: p.id, name: "Siti Again", phone: "0155555555" }),
  });
  const rows = (await admin("/admin/notify")).body.requests.filter((r) => r.phone === "0155555555");
  ok("a repeat submission updates instead of stacking", rows.length === 1 && rows[0].name === "Siti Again");
  ok("admin sees which design they want", rows[0].product_name === p.name);
  const short = await api("/notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: p.id, name: "Typo", phone: "012" }),
  });
  ok("an incomplete phone number is refused", short.status === 400);
  ok("mark told", (await admin(`/admin/notify/${rows[0].id}`, { method: "PUT" })).status === 200);
  ok("remove", (await admin(`/admin/notify/${rows[0].id}`, { method: "DELETE" })).status === 200);
}

step("order progress history");
{
  const v = await api(`/orders/${token}`);
  const seq = (v.body.events ?? []).map((e) => e.status);
  ok("every step was recorded, in order",
     JSON.stringify(seq) === JSON.stringify(["pending_payment", "paid", "shipped", "completed"]), JSON.stringify(seq));
  ok("each step carries a time", (v.body.events ?? []).every((e) => Boolean(e.created_at)));
  ok("the shipped step carries the tracking number", (v.body.events ?? []).some((e) => e.status === "shipped" && /NJV123456789/.test(e.note ?? "")));
  ok("the courier is named", v.body.tracking_courier === "Ninja Van", String(v.body.tracking_courier));
  ok("a courier link is offered", typeof v.body.tracking_url === "string" && v.body.tracking_url.includes("NJV123456789"), String(v.body.tracking_url));
}

step("track my order");
{
  /* Two different callers. The Worker rate-limits by CF-Connecting-IP, so the
     guesser being shut out must not shut out the real customer. */
  const CUSTOMER = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.1" };
  const GUESSER = { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.9" };
  const lookup = (headers, body) => api("/orders/lookup", { method: "POST", headers, body: JSON.stringify(body) });

  const found = await lookup(CUSTOMER, { order_number: orderNo, phone: "0123456789" });
  ok("the customer finds their own order", found.status === 200 && found.body.token === token, JSON.stringify(found.body));

  const spaced = await lookup(CUSTOMER, { order_number: orderNo.toLowerCase(), phone: "+60 12-345 6789" });
  ok("written any way, the same number matches", spaced.status === 200 && spaced.body.token === token);

  const wrongPhone = await lookup(CUSTOMER, { order_number: orderNo, phone: "0199999999" });
  const wrongNumber = await lookup(CUSTOMER, { order_number: "ELF-010100-99", phone: "0123456789" });
  ok("someone else's phone does not open it", wrongPhone.status === 404);
  ok("an order number that does not exist answers IDENTICALLY",
     wrongNumber.status === wrongPhone.status &&
     JSON.stringify(wrongNumber.body) === JSON.stringify(wrongPhone.body),
     JSON.stringify({ wrongNumber: wrongNumber.body, wrongPhone: wrongPhone.body }));

  // Walk the sequence like an attacker would; the gate must close.
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    const r = await lookup(GUESSER, { order_number: `ELF-010100-${i}`, phone: "0111111111" });
    if (r.status === 429) blocked = true;
  }
  ok("guessing order numbers gets you rate-limited", blocked);

  const stillOk = await lookup(CUSTOMER, { order_number: orderNo, phone: "0123456789" });
  ok("and a real customer elsewhere is unaffected", stillOk.status === 200 && stillOk.body.token === token, String(stillOk.status));
}

step("online payment (Billplz) reports its own state honestly");
{
  const t = await admin("/admin/billplz-test", { method: "POST" });
  ok("the gateway self-test answers", t.status === 200 && typeof t.body.message === "string", JSON.stringify(t.body));
  console.log(`     → ${t.body.message}`);
  const cfg = (await api("/store-config")).body;
  if (!cfg.gateway) {
    const pay = await api(`/orders/${token}/pay`, { method: "POST" });
    ok("pay-online is inert until the secrets exist", pay.status === 501);
  }
  const v = await api(`/orders/${token}/verify-payment`, { method: "POST" });
  ok("verify-payment never invents a payment", v.status === 200 && v.body.paid !== false === (v.body.status !== "pending_payment"));
}

console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
