/**
 * Order tracking guard (store v1.43.0).
 *
 * A tracking number is the one thing on an order that a customer actively
 * uses, and every way it goes wrong is quiet:
 *
 *   1. The courier URL map is the SINGLE definition of a tracking link. The
 *      portal deliberately does not build these — it takes `tracking_url`
 *      from feed C. If this map stops being the only builder, a courier
 *      changing its URL becomes two edits in two repositories, and the one
 *      nobody remembers keeps sending customers to a dead page.
 *   2. `update_tracking` changes a number on a parcel that has already gone.
 *      It must be reachable (both callers gate on the action set, not on
 *      ORDER_MOVES) and it must stay limited to a SHIPPED order — before
 *      that there is nothing to correct, after delivery it rewrites what the
 *      customer was told.
 *   3. It must bump `updated_at`, or the portal's cursor-based feed never
 *      re-sends the order and the two systems disagree about the number.
 *
 *   node tests/order-tracking.mjs
 */
import { readFileSync } from "node:fs";

const src = readFileSync("worker/src/index.ts", "utf8");
const spec = readFileSync("PORTAL-BRIDGE-SPEC.md", "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

/* ---- 1. the courier map, and the couriers the CEO actually uses ---- */
{
  const m = src.match(/const COURIERS: Record<string, \{ label: string; url: \(n: string\) => string \}> = \{([\s\S]*?)\n\};/);
  ok("the COURIERS map is still here", Boolean(m));
  const keys = m ? [...m[1].matchAll(/^\s{2}([a-z]+):/gm)].map((x) => x[1]) : [];
  for (const k of ["jnt", "ninjavan"]) {
    ok(`${k} is in the courier map`, keys.includes(k),
       "the CEO named J&T and Ninja Van specifically — losing one silently drops the link for every parcel sent with it");
  }
  ok("every courier link is https", (m?.[1].match(/url: \(n\) => `http:/g) ?? []).length === 0);
  ok("every courier encodes the number into the URL",
     keys.length > 0 && keys.length === (m[1].match(/encodeURIComponent\(n\)/g) ?? []).length,
     "a raw tracking number in a URL breaks on the first courier that uses a slash");
}

/* ---- 2. one builder, used everywhere a link is produced ---- */
ok("there is a single trackingUrl() builder",
   /function trackingUrl\(/.test(src));
{
  /* Anywhere else that calls `.url(` on a courier is a second builder. The
     map's own definition is allowed; nothing else is. */
  const callSites = (src.match(/courier\.url\(/g) ?? []).length;
  ok("nothing assembles a courier URL outside trackingUrl()", callSites === 0,
     `${callSites} call site(s) still build a link by hand — they will drift from the map`);
  ok("the customer's order page uses the builder",
     /tracking_url: trackingUrl\(o\.tracking_courier, o\.tracking_no\)/.test(src));
  ok("the orders feed carries the finished link",
     /tracking_url: trackingUrl\(o\.tracking_courier as string \| null, o\.tracking_no as string \| null\)/.test(src),
     "without it the portal has a number it cannot turn into a link, or builds one of its own");
  ok("the action response carries the link too",
     /tracking_url: trackingUrl\(courier \?\? o\.tracking_courier, finalNo\)/.test(src),
     "the portal offers to send it the moment a parcel is shipped, not five minutes later");
}

/* ---- 3. update_tracking ---- */
{
  ok("update_tracking is in the action set",
     /const ORDER_ACTIONS = new Set\(\[\.\.\.Object\.keys\(ORDER_MOVES\), "update_tracking"\]\)/.test(src));
  const gates = (src.match(/ORDER_ACTIONS\.has\(action\)/g) ?? []).length;
  ok("both callers gate on the action set, not on ORDER_MOVES", gates === 2,
     `${gates} gate(s) found — the bridge and /admin must both admit it, or the portal button 400s`);
  ok("no caller still gates on ORDER_MOVES alone",
     !/if \(!ORDER_MOVES\[action\]\) return err/.test(src) && !/if \(action && ORDER_MOVES\[action\]\)/.test(src));
  const i = src.indexOf('if (action === "update_tracking")');
  ok("update_tracking is handled in the shared implementation", i > 0);
  const body = i > 0 ? src.slice(i, i + 1800) : "";
  ok("it is refused unless the order is shipped",
     /o\.status !== "shipped"[\s\S]{0,200}?Only a shipped order/.test(body),
     "correcting a delivered order rewrites what the customer was already told");
  ok("an empty tracking number is refused",
     /A tracking number is required/.test(body));
  ok("an unknown courier key is dropped, not stored",
     /COURIERS\[ck\] \? ck : null/.test(body),
     "a key with no builder would be stored and shown as a courier with no link");
  ok("it bumps updated_at",
     /UPDATE orders SET tracking_no = \?1, updated_at = datetime\('now'\)/.test(body),
     "feed C is cursor-based on updated_at — without the bump the portal never learns the number changed");
  ok("the correction is written into the order's own history",
     /recordOrderEvent\(env, o\.id, o\.status, `Tracking number updated/.test(body),
     "the customer sees a number change rather than finding a different one than they were given");
  ok("the status is NOT changed", !/status = \?1/.test(body.slice(0, body.indexOf("recordOrderEvent"))));
}

/* ---- 4. the contract is written down ---- */
ok("the bridge spec documents tracking_url", /tracking_url/.test(spec));
ok("the bridge spec documents update_tracking", /update_tracking/.test(spec));
ok("the spec tells the portal not to build the URL itself",
   /must not assemble this\s*\n?\s*URL itself|must not assemble this URL itself/.test(spec));

console.log(
  fails.length === 0
    ? `PASS — one courier map, one link builder, and a tracking number that can be corrected exactly once it exists (${pass} checks)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
