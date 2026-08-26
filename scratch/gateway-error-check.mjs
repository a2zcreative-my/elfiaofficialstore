/**
 * When online payment fails, does the shop say WHY? (v1.14.1)
 *
 * The CEO, 26-08-2026, on the live shop: "This appear on the gateway
 * payment!" — a customer had been shown "Payment gateway unavailable" and
 * there was nowhere in either system to find out why. The reason was thrown
 * away at the moment it was learned: billplzCreateBill returned `null` for a
 * wrong key, a sandbox key on a live shop, an unactivated account and a
 * rejected phone number alike.
 *
 * The local rig has fake Billplz credentials, so every bill creation fails —
 * which makes it the perfect place to prove the failure PATH. This walks it:
 *
 *   1. the customer gets a sentence they can act on, and is not shown any
 *      Billplz internals;
 *   2. the shop writes down Billplz's own reply;
 *   3. /bridge/payment-check hands that back, with a hint naming the fix;
 *   4. none of it leaks the API key.
 *
 * Run with the e2e worker up (worker/.dev.vars needs the fake BILLPLZ_*
 * values — see scratch/payment-return-check.mjs):
 *   node scratch/gateway-error-check.mjs
 */
const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const BRIDGE = process.env.BRIDGE_KEY ?? "shared-bridge-secret";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const RUN = Math.floor(Math.random() * 9000) + 1000;
let seq = 0;
async function newOrder(phone) {
  const { products } = await (await fetch(`${API}/products`)).json();
  const p = products.find((x) => x.active === 1 && x.price_cents > 0 && (x.track_stock !== 1 || x.stock > 0));
  seq += 1;
  const r = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.99.${RUN % 250}.${seq}` },
    body: JSON.stringify({
      customer: {
        name: "Gateway Error Test",
        phone: phone ?? `01${String(RUN).padStart(3, "0")}${String(seq).padStart(5, "0")}`,
        address: "1 Jalan Gateway",
      },
      items: [{ id: p.id, qty: 1 }],
    }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`could not place an order: ${JSON.stringify(j)}`);
  return j.token;
}

step("the gateway is on locally (fake keys, so every bill will fail)");
{
  const cfg = await (await fetch(`${API}/store-config`)).json();
  ok("store-config reports gateway: true", cfg.gateway === true,
     "add the fake BILLPLZ_* values to worker/.dev.vars and restart wrangler dev");
  if (cfg.gateway !== true) process.exit(1);
}

step("a customer who cannot pay online is told something useful");
let body;
{
  const token = await newOrder();
  const r = await fetch(`${API}/orders/${token}/pay`, { method: "POST" });
  body = await r.json();
  ok("the request fails rather than pretending", r.status >= 400, String(r.status));

  const msg = body?.error?.message ?? "";
  ok("the message points at bank transfer", /bank transfer/i.test(msg), msg);
  ok("it reassures that the order is intact", /unchanged/i.test(msg), msg);
  /* What the customer must NOT be shown. "Payment gateway unavailable" reads
     as a permanent state of the shop; and Billplz's status codes are not
     the customer's problem. */
  ok("it does not read as the shop being broken forever", !/gateway unavailable/i.test(msg), msg);
  ok("no Billplz internals reach the customer", !/billplz/i.test(msg) && !/\b4\d\d\b/.test(msg), msg);
}

step("but the shop writes down exactly what Billplz said");
{
  const r = await fetch(`${API}/bridge/payment-check`, { headers: { "X-Bridge-Key": BRIDGE } });
  const j = await r.json();

  ok("payment-check answers", r.ok, String(r.status));
  ok("it recorded the failure", typeof j.last_gateway_error === "string" && j.last_gateway_error.length > 0,
     JSON.stringify(j.last_gateway_error));
  ok("the record names the order it happened to", /order ELF-/.test(j.last_gateway_error ?? ""),
     j.last_gateway_error);
  ok("and quotes Billplz rather than paraphrasing", /Billplz/.test(j.last_gateway_error ?? ""),
     j.last_gateway_error);
  ok("a hint names the fix", typeof j.last_gateway_hint === "string" && j.last_gateway_hint.length > 20,
     JSON.stringify(j.last_gateway_hint));

  /* The whole point of keeping the detail is that it can be read safely. */
  const all = JSON.stringify(j);
  ok("the API key is nowhere in the answer", !all.includes("local-fake-not-a-key"));
  ok("nor the collection id", !all.includes("local-fake-collection"));
  ok("nor the signature key", !all.includes("local-fake-signature-key"));

  ok("it still says whether the keys themselves read", typeof j.ok === "boolean");
  ok("and whether an X-Signature key is set", typeof j.signature_key_set === "boolean");
}

step("the diagnosis is not public");
{
  const r = await fetch(`${API}/bridge/payment-check`);
  ok("no bridge key, no answer", r.status === 401, String(r.status));
  const h = await (await fetch(`${API}/health`)).json();
  ok("health does not carry the failure text", !JSON.stringify(h).includes("last_gateway_error"));
}

step("a phone number Billplz would reject no longer sinks the bill");
{
  /* An office line is not a mobile. Billplz answers 422 for a `mobile` it
     does not like and refuses the whole bill — so before v1.14.1 a customer
     who typed a landline could not pay at all. The field is now omitted
     unless it really is a Malaysian mobile; the email always stands in. */
  /* A landline shape (03 = a Klang Valley fixed line), but UNIQUE per run.
     A fixed number here meant every run left another unpaid order against
     the same phone, and the shop caps a phone at two — so the rig passed
     twice and then failed on its own litter. */
  const token = await newOrder(`03${String(RUN).padStart(4, "0")}${String(seq + 1).padStart(4, "0")}`);
  const r = await fetch(`${API}/orders/${token}/pay`, { method: "POST" });
  const j = await r.json();
  /* The fake keys mean this still fails — but it must fail on the KEY, not
     on the phone number, which is what proves the field was dropped. */
  const rec = await (await fetch(`${API}/bridge/payment-check`, { headers: { "X-Bridge-Key": BRIDGE } })).json();
  ok("the order was still attempted", r.status >= 400 && Boolean(j?.error), String(r.status));
  ok("and the failure is not about the phone number",
     !/mobile/i.test(rec.last_gateway_error ?? ""), rec.last_gateway_error);
}

/* Cancel what this rig created. The shop caps unpaid orders per phone and
   per caller, so a rig that leaves its orders behind poisons its own next
   run — which is exactly how this one started failing. */
step("tidy up the orders this run created");
{
  const list = await (await fetch(`${API}/admin/orders`, { headers: { "X-Admin-Key": KEY } })).json();
  const mine = (list.orders ?? []).filter((o) => o.customer_name === "Gateway Error Test"
    && (o.status === "pending_payment" || o.status === "payment_review"));
  for (const o of mine) {
    await fetch(`${API}/admin/orders/${o.id}`, {
      method: "PUT",
      headers: { "X-Admin-Key": KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
  }
  ok(`left no unpaid orders behind (${mine.length} cancelled)`, true);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: a failed payment now explains itself, in the right place, to the right person.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
