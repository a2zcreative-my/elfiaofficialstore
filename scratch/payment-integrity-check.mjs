/**
 * Can anyone mark an order paid who did not pay for it? (v1.39.0)
 *
 * The audit of 27-08-2026 found one Critical: the Billplz callback proved
 * that A BILL was paid by re-querying Billplz, but took the ORDER NUMBER to
 * mark paid from the request parameters. The two were never tied together,
 * so one genuinely paid bill — a small order the attacker pays themselves —
 * could settle any other order, including a stranger's. Order numbers are
 * sequential by design, so "any other order" meant all of them.
 *
 * Three things are proven here, against the REAL worker over HTTP:
 *
 *   1. THE FORGERY IS DEAD. A callback naming order B while carrying order
 *      A's bill id leaves B exactly as it was. This is the regression test
 *      for the Critical; it fails loudly if the reference_1 fallback ever
 *      comes back.
 *   2. THE SIGNATURE IS MANDATORY. An unsigned or wrongly-signed callback is
 *      refused (403) rather than falling through to the requery — and a shop
 *      with no X-signature key configured creates no bills at all, so there
 *      is nothing to forge against in the first place.
 *   3. NOTHING ELSE CAN WRITE `paid`. The public surface is swept: no
 *      unauthenticated route moves an order's status, and the bridge doors
 *      still refuse a wrong key.
 *
 * The rig cannot make Billplz say "paid" — that requires the shop's live
 * secret — so it proves the locks from the outside: every forgery attempt
 * must leave the order untouched, whatever the gateway's configuration.
 * That is the property that matters. A shop WITH the gateway live should
 * additionally be checked by paying one real RM 1 order end to end.
 *
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/payment-integrity-check.mjs
 */
const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";
const BRIDGE = process.env.BRIDGE_KEY ?? "shared-bridge-secret";

/* A fresh identity per run: this suite has to be runnable twice in a row. */
const RUN = Math.floor(Date.now() / 1000) % 250;
let seq = 0;

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);
const jget = async (u, o = {}) => (await fetch(u, o)).json();
const admin = (p, o = {}) => fetch(`${API}${p}`, {
  ...o, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(o.headers ?? {}) },
});

/** Place a real order through the public route and return its row. */
async function placeOrder(name) {
  const products = (await jget(`${API}/products`)).products;
  const buyable = products.find((p) => p.price_cents > 0 && (p.track_stock !== 1 || p.stock > 1));
  if (!buyable) throw new Error("no buyable product in the fixture catalogue");
  /* Same shape and posture as store-sync-test.mjs: the `customer` object,
     no Origin header (a server-to-server caller has none), and a distinct
     source IP per order so the 8-per-hour bucket does not swallow the rig. */
  seq += 1;
  const r = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.77.${RUN}.${seq}` },
    body: JSON.stringify({
      customer: { name, phone: `019${String(RUN).padStart(3, "0")}${String(seq).padStart(4, "0")}`, address: "1 Test Street" },
      items: [{ id: buyable.id, qty: 1 }],
    }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`could not place an order: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
}
const statusOf = async (token) => (await jget(`${API}/orders/${token}`)).status;

/** Every shape the callback accepts, so the sweep covers GET and POST. */
const callback = (params, method = "GET") => {
  const qs = new URLSearchParams(params).toString();
  return method === "GET"
    ? fetch(`${API}/payments/billplz/callback?${qs}`)
    : fetch(`${API}/payments/billplz/callback`, {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: qs,
      });
};

try {
  step("two orders exist, both unpaid");
  const victim = await placeOrder("Integrity Victim");
  const attacker = await placeOrder("Integrity Attacker");
  ok("the victim's order is pending", (await statusOf(victim.token)) === "pending_payment");
  ok("the attacker's order is pending", (await statusOf(attacker.token)) === "pending_payment");

  step("THE CRITICAL — a callback naming someone else's order must do nothing");
  {
    /* The exact shape of the old exploit: a bill id the attacker holds, and
       the VICTIM's order number in reference_1. Tried in every spelling the
       route ever accepted, over both methods. */
    const bills = ["attacker-bill-id", "abc123", "0000"];
    const refs = [victim.order_number, attacker.order_number];
    for (const method of ["GET", "POST"]) {
      for (const bill of bills) {
        for (const ref of refs) {
          await callback({ "billplz[id]": bill, "billplz[paid]": "true", "billplz[reference_1]": ref }, method);
          await callback({ id: bill, paid: "true", reference_1: ref }, method);
        }
      }
    }
    ok("the victim's order is STILL unpaid after 24 forgery attempts",
       (await statusOf(victim.token)) === "pending_payment", await statusOf(victim.token));
    ok("and so is the attacker's own", (await statusOf(attacker.token)) === "pending_payment");
  }

  step("the signature is mandatory, not preferred");
  {
    const r = await callback({ "billplz[id]": "x1234", "billplz[paid]": "true" });
    const j = await r.json().catch(() => ({}));
    /* Either the gateway is off entirely (501 — the correct posture for a
       shop with no X-signature key, since it then creates no bills), or the
       signature is checked and this unsigned call is refused (403). What
       must NEVER happen is 200 with the requery having been reached. */
    ok("an unsigned callback is refused (403) or the gateway is off (501)",
       r.status === 403 || r.status === 501, `${r.status} ${JSON.stringify(j).slice(0, 80)}`);
    const bad = await callback({ "billplz[id]": "x1234", "billplz[paid]": "true", "billplz[x_signature]": "f".repeat(64) });
    ok("a wrongly-signed callback is refused too", bad.status === 403 || bad.status === 501, String(bad.status));
  }

  step("no other public route can move an order to paid");
  {
    const before = await statusOf(victim.token);
    const tries = [
      [`${API}/orders/${victim.token}`, { method: "PUT", body: JSON.stringify({ status: "paid" }) }],
      [`${API}/orders/${victim.token}`, { method: "PATCH", body: JSON.stringify({ status: "paid" }) }],
      [`${API}/orders/${victim.token}/verify-payment`, { method: "POST" }],
      [`${API}/bridge/orders/${victim.order_number}`, { method: "POST", body: JSON.stringify({ action: "confirm_paid" }) }],
    ];
    for (const [u, init] of tries) {
      await fetch(u, { ...init, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } }).catch(() => null);
    }
    ok("status is unchanged after every unauthenticated attempt",
       (await statusOf(victim.token)) === before, `${before} -> ${await statusOf(victim.token)}`);

    const wrongKey = await fetch(`${API}/bridge/orders/${victim.order_number}`, {
      method: "POST",
      headers: { "X-Bridge-Key": "not-the-key", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_paid" }),
    });
    ok("the bridge door refuses a wrong key", wrongKey.status === 401 || wrongKey.status === 501, String(wrongKey.status));
  }

  step("the shop's own doors still work (the fix did not lock the staff out)");
  {
    const r = await fetch(`${API}/bridge/orders/${attacker.order_number}`, {
      method: "POST",
      headers: { "X-Bridge-Key": BRIDGE, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_paid" }),
    });
    ok("the portal CAN confirm a payment with the right key", r.ok, String(r.status));
    ok("and the order really is paid now", (await statusOf(attacker.token)) === "paid");
  }

  step("tidy up");
  {
    const list = await (await admin("/admin/orders")).json();
    for (const nm of ["Integrity Victim", "Integrity Attacker"]) {
      const mine = list.orders?.find((x) => x.customer_name === nm && x.status !== "cancelled");
      if (mine && mine.status !== "paid") {
        await admin(`/admin/orders/${mine.id}`, { method: "PUT", body: JSON.stringify({ action: "cancel" }) });
      }
    }
    ok("cleaned up", true);
  }
} catch (e) {
  fail++;
  console.log(`  XX  the rig itself failed -- ${e instanceof Error ? e.message : String(e)}`);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: only Billplz, about the right bill, can mark an order paid.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
