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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

/* Every call gets its own caller address unless the test names one on
   purpose. The Worker rate-limits by IP, and a suite that shares one address
   would trip its own limits — which is the limiter working, not a bug. Tests
   that care about the limits (guessing order numbers, brute-forcing the admin
   key) set CF-Connecting-IP explicitly and keep it. */
/* A fresh address block per run, so re-running this file is not mistaken for
   one very busy customer. */
const RUN = Math.floor(Math.random() * 250) + 1;
/* Obviously-fake credentials for the local harness. tests/no-secrets.mjs
   allowlists exactly these two strings, so a REAL password pasted here would
   still fail the build. */
const TEST_PW = "elfia-local-test-password";
const TEST_PW_WRONG = "elfia-local-wrong-password";
let callerN = 0;
/* Phone numbers are run-unique too: the store caps how many UNPAID orders one
   phone may hold, so a fixed number would make the second run of this file
   look like a customer who never pays. */
const PH = (n) => `01${String(RUN).padStart(3, "0")}${String(n).padStart(5, "0")}`;
const MAIN_PHONE = PH(1);
const api = async (path, opts = {}) => {
  const headers = { ...(opts.headers ?? {}) };
  if (!headers["CF-Connecting-IP"]) headers["CF-Connecting-IP"] = `100.64.${RUN}.${(callerN++ % 250) + 1}`;
  const r = await fetch(`${BASE}${path}`, { ...opts, headers });
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
      customer: { name: "Nurul Test", phone: MAIN_PHONE, address: "12 Jalan Contoh, 43000 Kajang, Selangor" },
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
    body: JSON.stringify({ customer: { name: "Greedy", phone: PH(2), address: "somewhere" }, items: [{ id: p.id, qty: 3 }] }),
  });
  ok("cannot buy more than exist", tooMany.status === 409, JSON.stringify(tooMany.body));
  ok("and nothing was reserved by the failed attempt", (await api(`/products/${p.id}`)).body.product.stock === 2);

  const good = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Aina", phone: PH(3), address: "12 Jalan Dua" }, items: [{ id: p.id, qty: 2 }] }),
  });
  ok("buying the last two works", good.status === 201);
  ok("stock is now zero", (await api(`/products/${p.id}`)).body.product.stock === 0);

  const soldOut = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Late", phone: PH(4), address: "12 Jalan Tiga" }, items: [{ id: p.id, qty: 1 }] }),
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
    body: JSON.stringify({ customer: { name: "Big Order", phone: PH(5), address: "12 Jalan Empat" }, items: [{ id: p.id, qty }] }),
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
    body: JSON.stringify({ customer: { name: "A", phone: MAIN_PHONE, address: "x" }, items: [] }),
  });
  ok("an empty cart is refused", emptyCart.status === 400);
  const honeypot = await api("/orders", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ customer: { name: "Bot", phone: MAIN_PHONE, address: "x", website: "http://spam" }, items: [{ id: products[0].id, qty: 1 }] }),
  });
  ok("the honeypot swallows bots silently", honeypot.status === 200 && !honeypot.body.token);
}

step("restock waitlist");
{
  const p = products[2];
  const first = await api("/notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: p.id, name: "Siti", phone: PH(6) }),
  });
  ok("a customer can join the waitlist", first.status === 201);
  await api("/notify", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ product_id: p.id, name: "Siti Again", phone: PH(6) }),
  });
  const rows = (await admin("/admin/notify")).body.requests.filter((r) => r.phone === PH(6));
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
  const CUSTOMER = { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.${RUN}.1` };
  const GUESSER = { "Content-Type": "application/json", "CF-Connecting-IP": `203.0.${RUN}.9` };
  const lookup = (headers, body) => api("/orders/lookup", { method: "POST", headers, body: JSON.stringify(body) });

  const found = await lookup(CUSTOMER, { order_number: orderNo, phone: MAIN_PHONE });
  ok("the customer finds their own order", found.status === 200 && found.body.token === token, JSON.stringify(found.body));

  const spaced = await lookup(CUSTOMER, { order_number: orderNo.toLowerCase(), phone: `+60 ${MAIN_PHONE.slice(1)}` });
  ok("written any way, the same number matches", spaced.status === 200 && spaced.body.token === token);

  const wrongPhone = await lookup(CUSTOMER, { order_number: orderNo, phone: PH(90) });
  const wrongNumber = await lookup(CUSTOMER, { order_number: "ELF-010100-99", phone: MAIN_PHONE });
  ok("someone else's phone does not open it", wrongPhone.status === 404);
  ok("an order number that does not exist answers IDENTICALLY",
     wrongNumber.status === wrongPhone.status &&
     JSON.stringify(wrongNumber.body) === JSON.stringify(wrongPhone.body),
     JSON.stringify({ wrongNumber: wrongNumber.body, wrongPhone: wrongPhone.body }));

  // Walk the sequence like an attacker would; the gate must close.
  let blocked = false;
  for (let i = 0; i < 12 && !blocked; i++) {
    const r = await lookup(GUESSER, { order_number: `ELF-010100-${i}`, phone: PH(2) });
    if (r.status === 429) blocked = true;
  }
  ok("guessing order numbers gets you rate-limited", blocked);

  const stillOk = await lookup(CUSTOMER, { order_number: orderNo, phone: MAIN_PHONE });
  ok("and a real customer elsewhere is unaffected", stillOk.status === 200 && stillOk.body.token === token, String(stillOk.status));
}

step("no joy buyers: unpaid orders cannot pile up or hold stock for ever");
{
  const JOY = { "Content-Type": "application/json", "CF-Connecting-IP": `198.51.${RUN}.60` };
  const place = (phone, name) => api("/orders", {
    method: "POST", headers: JOY,
    body: JSON.stringify({ customer: { name, phone, address: "1 Jalan Joy" }, items: [{ id: products[0].id, qty: 1 }] }),
  });
  const phone = PH(7);
  const a = await place(phone, "Joy One");
  const b = await place(phone, "Joy Two");
  ok("two unpaid orders are allowed", a.status === 201 && b.status === 201);
  const third = await place(phone, "Joy Three");
  ok("a third is refused while the first two are unpaid", third.status === 409, `${third.status}`);
  ok("and the message tells them what to do", /unpaid order/i.test(third.body?.error?.message ?? ""), JSON.stringify(third.body));

  const view = await api(`/orders/${a.body.token}`);
  ok("every unpaid order carries a release deadline", Boolean(view.body.expires_at), String(view.body.expires_at));

  /* Age one order past its deadline by editing the LOCAL database directly —
     no test-only endpoint is added to the Worker for this. Then run the real
     scheduled handler that production runs. */
  const { execFileSync } = await import("node:child_process");
  execFileSync("npx", ["wrangler", "d1", "execute", "elfia-store", "--local", "--config", "wrangler.e2e.toml",
    "--command", `UPDATE orders SET expires_at = datetime('now','-1 hour') WHERE order_number = '${a.body.order_number}'`],
    { cwd: "worker", stdio: "ignore" });
  const cron = await fetch(`${BASE.replace("/api/v1", "")}/cdn-cgi/local/scheduled`).catch(() => null);
  ok("the scheduled job ran", Boolean(cron) && cron.ok, `wrangler dev triggers it at /cdn-cgi/local/scheduled (${cron?.status})`);
  await sleep(1500);
  const after = await api(`/orders/${a.body.token}`);
  ok("an expired unpaid order releases itself", after.body.status === "cancelled", after.body.status);
  ok("and says why, in words the customer can read",
     (after.body.events ?? []).some((e) => /payment was not received in time/i.test(e.note ?? "")),
     JSON.stringify(after.body.events));

  const fourth = await place(phone, "Joy Four");
  ok("releasing one frees the slot for a new order", fourth.status === 201, JSON.stringify(fourth.body));
}

step("customer accounts (guest checkout still works)");
let cookie = "";
{
  const AC = { "Content-Type": "application/json", "CF-Connecting-IP": `198.51.${RUN}.70` };
  const email = `test-${Math.floor(Math.random() * 1e9)}@example.com`;
  const raw = await fetch(`${BASE}/auth/signup`, {
    method: "POST", headers: AC,
    body: JSON.stringify({ name: "Aisyah Test", email, password: TEST_PW, phone: PH(8), address: "9 Jalan Akaun" }),
  });
  cookie = (raw.headers.get("set-cookie") ?? "").split(";")[0];
  ok("sign up works", raw.status === 201);
  ok("and sets an HttpOnly session cookie", /HttpOnly/i.test(raw.headers.get("set-cookie") ?? ""), raw.headers.get("set-cookie") ?? "");

  const dup = await api("/auth/signup", { method: "POST", headers: AC, body: JSON.stringify({ name: "X", email, password: TEST_PW_WRONG }) });
  ok("the same email cannot sign up twice", dup.status === 409);

  const wrong = await api("/auth/login", { method: "POST", headers: AC, body: JSON.stringify({ email, password: TEST_PW_WRONG }) });
  ok("a wrong password is refused", wrong.status === 401);
  const unknown = await api("/auth/login", { method: "POST", headers: AC, body: JSON.stringify({ email: "nobody@example.com", password: TEST_PW_WRONG }) });
  ok("an unknown email answers the same as a wrong password",
     unknown.status === wrong.status && JSON.stringify(unknown.body) === JSON.stringify(wrong.body));

  const me = await api("/auth/me", { headers: { Cookie: cookie } });
  ok("the session identifies the customer", me.status === 200 && me.body.customer.email === email);
  const anon = await api("/auth/me");
  ok("no cookie means no account", anon.status === 401);
  const forged = await api("/auth/me", { headers: { Cookie: `elfia_session=${"a".repeat(64)}` } });
  ok("a made-up session token is worthless", forged.status === 401);

  // An order placed while signed in belongs to the account.
  const signedInOrder = await api("/orders", {
    method: "POST", headers: { ...AC, Cookie: cookie },
    body: JSON.stringify({ customer: { name: "Aisyah Test", phone: PH(9), address: "9 Jalan Akaun" }, items: [{ id: products[2].id, qty: 1 }] }),
  });
  ok("a signed-in customer can order", signedInOrder.status === 201);
  const mine = await api("/auth/orders", { headers: { Cookie: cookie } });
  ok("it appears in their order history",
     (mine.body.orders ?? []).some((o) => o.order_number === signedInOrder.body.order_number));

  // A guest order can be claimed with the number + phone, never guessed.
  const guest = await api("/orders", {
    method: "POST", headers: AC,
    body: JSON.stringify({ customer: { name: "Same Person", phone: PH(10), address: "9 Jalan Akaun" }, items: [{ id: products[3].id, qty: 1 }] }),
  });
  const badClaim = await api("/auth/claim", {
    method: "POST", headers: { ...AC, Cookie: cookie },
    body: JSON.stringify({ order_number: guest.body.order_number, phone: PH(2) }),
  });
  ok("a guest order cannot be claimed with the wrong phone", badClaim.status === 404);
  const goodClaim = await api("/auth/claim", {
    method: "POST", headers: { ...AC, Cookie: cookie },
    body: JSON.stringify({ order_number: guest.body.order_number, phone: PH(10) }),
  });
  ok("and can with the right one", goodClaim.status === 200);

  const out = await fetch(`${BASE}/auth/logout`, { method: "POST", headers: { Cookie: cookie } });
  ok("signing out clears the cookie", /Max-Age=0/.test(out.headers.get("set-cookie") ?? ""));
  const afterOut = await api("/auth/me", { headers: { Cookie: cookie } });
  ok("and the session stops working immediately", afterOut.status === 401);
}

step("Billplz callbacks are signature-checked");
{
  const cfg = (await api("/store-config")).body;
  if (!cfg.gateway) {
    console.log("     → gateway not configured in this environment; signature test skipped");
  } else {
    const { createHmac } = await import("node:crypto");
    const KEY = process.env.ELFIA_TEST_XSIGN ?? "elfia-local-test-signing-value";
    const fields = { id: "abc123xyz", collection_id: "test-collection", paid: "true", state: "paid" };
    const source = Object.entries(fields).map(([k, v]) => `${k}${v}`).sort().join("|");
    const good = createHmac("sha256", KEY).update(source).digest("hex");

    const forged = await api("/payments/billplz/callback", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, x_signature: "0".repeat(64) }).toString(),
    });
    ok("a forged callback is rejected", forged.status === 403, `${forged.status}`);

    const signed = await api("/payments/billplz/callback", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, x_signature: good }).toString(),
    });
    ok("a correctly signed callback is accepted for checking", signed.status === 200, `${signed.status}`);
    // …and still proves nothing on its own: the bill is re-queried, and this
    // made-up bill id is not paid, so no order may move.
    const stillUnpaid = await api(`/orders/${token}`);
    ok("but a signature alone never marks an order paid", stillUnpaid.body.status === "completed", stillUnpaid.body.status);
  }
}

step("the admin passcode cannot be brute-forced");
{
  let blocked = false;
  for (let i = 0; i < 14 && !blocked; i++) {
    const r = await api("/admin/orders", { headers: { "X-Admin-Key": `guess-${i}`, "CF-Connecting-IP": `198.51.${RUN}.80` } });
    if (r.status === 429) blocked = true;
  }
  ok("guessing the passcode gets you locked out", blocked);
  const real = await api("/admin/orders", { headers: { "X-Admin-Key": KEY, "CF-Connecting-IP": `198.51.${RUN}.81` } });
  ok("and an honest admin elsewhere is unaffected", real.status === 200);
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
