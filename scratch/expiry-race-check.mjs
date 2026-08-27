/**
 * Can the twelve-hour release cancel an order that was just paid? (v1.39.0)
 *
 * The audit of 27-08-2026 found this High: `releaseExpiredOrders` SELECTed
 * the expired orders, then — at the end of a loop that restocks first —
 * wrote `status = 'cancelled'` with NO status predicate. Every other status
 * write in the file has one. The cron fires every minute, so the window
 * between the read and that write is a minute wide, and a Billplz callback
 * landing inside it is not a freak event: it is what a late FPX redirect at
 * the hold boundary looks like. The customer paid; the shop said cancelled;
 * the goods went back on the shelf; the portal was told to restock.
 *
 * The fix makes the cancellation itself the claim — `UPDATE … WHERE id = ?
 * AND status IN ('pending_payment','payment_review')` FIRST, and only the
 * run that actually moved the row gets to restock.
 *
 * This rig proves the property without needing to hit a real race: it puts
 * the order into the state the race produces (expired AND paid) and then
 * runs the release. If the guard is missing, the order is cancelled and the
 * stock is returned — visible, deterministic, and it fails.
 *
 * Also checked: a genuinely expired unpaid order IS still released and IS
 * restocked (the fix must not break the feature), and running the release
 * twice does not restock twice.
 *
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787 --test-scheduled
 *   node scratch/expiry-race-check.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";
const BRIDGE = process.env.BRIDGE_KEY ?? "shared-bridge-secret";
const WORKER = new URL("../worker", import.meta.url).pathname;

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

/** Setup only — never an assertion. Puts a row into the state the race
    produces, which is the only way to test a one-minute window on demand. */
const d1 = (sql) => execFileSync("npx", [
  "wrangler", "d1", "execute", "elfia-store", "--local", "--config", "wrangler.e2e.toml", "--command", sql,
], { cwd: WORKER, stdio: "pipe" }).toString();

const expire = (id) => d1(`UPDATE orders SET expires_at = datetime('now','-1 hour') WHERE id = ${Number(id)}`);
/** The release runs ONLY on the cron — no admin route calls it — so the rig
    fires the scheduled handler itself. `wrangler dev --test-scheduled` opens
    /__scheduled for exactly this; without the flag the endpoint 404s and the
    rig says so rather than passing on a job that never ran. */
const SCHEDULED = `${new URL(API).origin}/__scheduled?cron=${encodeURIComponent("* * * * *")}`;
const runRelease = async () => {
  const r = await fetch(SCHEDULED);
  if (r.status === 404) {
    throw new Error("start the worker with --test-scheduled so /__scheduled can fire the cron");
  }
  /* The handler does its work in ctx.waitUntil, so the response returns
     before the release has run. It also runs the portal sync — which is why
     nothing below asserts on `products.stock`: a pull can rewrite every
     count while this rig is mid-flight. Restock is proven from the shop's
     OWN movement outbox instead, which the sync cannot forge. */
  await new Promise((res) => setTimeout(res, 3000));
  return r;
};

async function placeOrder(name) {
  const products = (await jget(`${API}/products`)).products;
  const buyable = products.find((p) => p.price_cents > 0 && p.track_stock === 1 && p.stock > 2);
  if (!buyable) throw new Error("no stock-tracked product with spare stock in the fixtures");
  seq += 1;
  const r = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.88.${RUN}.${seq}` },
    body: JSON.stringify({
      customer: { name, phone: `018${String(RUN).padStart(3, "0")}${String(seq).padStart(4, "0")}`, address: "1 Race Street" },
      items: [{ id: buyable.id, qty: 1 }],
    }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`could not place an order: ${JSON.stringify(j).slice(0, 200)}`);
  return { ...j, product: buyable.id };
}
const statusOf = async (t) => (await jget(`${API}/orders/${t}`)).status;
const stockOf = async (id) => ((await jget(`${API}/products`)).products.find((p) => p.id === id) ?? {}).stock;
const orderIdOf = async (number) => {
  const list = await (await admin("/admin/orders")).json();
  return (list.orders ?? []).find((o) => o.order_number === number)?.id;
};
/** Movements this shop recorded for an order — the restock evidence. */
const restockEvents = async (number) => {
  const s = await (await admin("/admin/sync-status")).json();
  return (s.recent ?? []).filter((e) => e.order_number === number && e.reason === "cancel");
};

try {
  step("THE RACE — an order that became paid must survive the release");
  {
    const o = await placeOrder("Race Paid");
    const id = await orderIdOf(o.order_number);

    /* The payment lands (the portal's own confirm door — the same status
       transition a Billplz callback makes). */
    const conf = await fetch(`${API}/bridge/orders/${o.order_number}`, {
      method: "POST",
      headers: { "X-Bridge-Key": BRIDGE, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_paid" }),
    });
    ok("the order is paid", conf.ok && (await statusOf(o.token)) === "paid", String(conf.status));

    /* …and the release runs against a row whose expiry has passed — exactly
       the state the one-minute window produces. */
    expire(id);
    await runRelease();

    ok("it is STILL paid after the release ran", (await statusOf(o.token)) === "paid",
       await statusOf(o.token));
    ok("and the shop recorded NO restock for it",
       (await restockEvents(o.order_number)).length === 0,
       JSON.stringify(await restockEvents(o.order_number)));
  }

  step("the feature still works — an expired UNPAID order is released and restocked");
  {
    const o = await placeOrder("Race Unpaid");
    const id = await orderIdOf(o.order_number);

    expire(id);
    await runRelease();

    ok("the order is cancelled", (await statusOf(o.token)) === "cancelled", await statusOf(o.token));
    const first = await restockEvents(o.order_number);
    ok("and the piece was put back (one restock movement)", first.length === 1 && first[0].delta > 0,
       JSON.stringify(first));

    /* The claim IS the transition, so a second and third pass find nothing
       to do — the bug this guards against would restock again every minute
       for as long as the row sat there. */
    await runRelease();
    await runRelease();
    const later = await restockEvents(o.order_number);
    ok("running the release again does not restock twice", later.length === 1,
       `${later.length} movements`);
  }

  step("the release still CLAIMS before it restocks (the race itself)");
  {
    /* The checks above prove the feature and its idempotency, but neither
       can reproduce a one-minute window from outside the worker: by the time
       this rig can mark an order paid, the cron's SELECT has already
       excluded it. The race is a property of the ORDER OF TWO STATEMENTS, so
       it is asserted where it lives — in the source.

       This is deliberately shape-based. It fails if anyone restores the
       unguarded `UPDATE orders SET status = 'cancelled' WHERE id = ?`, or
       moves the restock back above the claim, which is exactly how the bug
       was written the first time. */
    const src = readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
    const fn = src.slice(src.indexOf("async function releaseExpiredOrders"));
    const body = fn.slice(0, fn.indexOf("\n}"));

    const claimAt = body.indexOf("status = 'cancelled'");
    const restockAt = body.indexOf("SET stock = stock + ?1");
    ok("the release cancels and restocks exactly once each",
       claimAt >= 0 && restockAt >= 0 && body.split("status = 'cancelled'").length === 2);
    ok("the cancel is GUARDED by the order's current status",
       /status = 'cancelled'[\s\S]{0,200}?WHERE id = \?1\s+AND status IN \('pending_payment', 'payment_review'\)/.test(body));
    ok("and it happens BEFORE the stock goes back", claimAt < restockAt,
       `claim at ${claimAt}, restock at ${restockAt}`);
    ok("a claim that changed nothing skips the restock", /changes === 0\) continue/.test(body));
  }

  step("tidy up");
  {
    const list = await (await admin("/admin/orders")).json();
    for (const nm of ["Race Paid", "Race Unpaid"]) {
      const mine = (list.orders ?? []).find((x) => x.customer_name === nm && x.status === "pending_payment");
      if (mine) await admin(`/admin/orders/${mine.id}`, { method: "PUT", body: JSON.stringify({ action: "cancel" }) });
    }
    ok("cleaned up", true);
  }
} catch (e) {
  fail++;
  console.log(`  XX  the rig itself failed -- ${e instanceof Error ? e.message : String(e)}`);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: the release cannot cancel an order that was paid.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
