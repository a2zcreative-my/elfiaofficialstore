/**
 * The journey BACK from the payment gateway (v1.14.0).
 *
 * Everything up to Billplz was already tested. Coming back was not, and that
 * is where the holes were: a customer who cancelled at their bank returned to
 * a page identical to the one they left — same Pay button, no acknowledgement
 * — because the old code polled for eighteen seconds and then went quiet
 * whatever the answer. "It worked", "it failed" and "the bank is slow" were
 * all rendered as silence.
 *
 * They are three different situations and they need three different things
 * from the customer, so this rig walks all three in a real browser and reads
 * what is actually on the screen:
 *
 *   declined — no payment happened. Must say so, must say the customer was
 *              NOT charged, must offer both ways forward.
 *   slow     — the bank says paid, our authenticated re-query has not agreed
 *              yet. Must NOT invite a second payment: that is how somebody
 *              gets charged twice.
 *   checking — while either is being decided, Pay must be unavailable.
 *
 * It needs the gateway switched ON locally. That is fake credentials in
 * worker/.dev.vars — no bill is ever created and no real Billplz account is
 * touched; the store answers `bill: false` and the page settles at once.
 *
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/payment-return-check.mjs
 */
import { chromium } from "playwright";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const SITE = process.env.SITE ?? "http://127.0.0.1:8100";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

/* A fresh unpaid order per case: these screens only exist while an order is
   waiting to be paid, and a shared one would carry state between cases. */
const RUN = Math.floor(Math.random() * 9000) + 1000;
let seq = 0;
async function newOrder() {
  const products = await (await fetch(`${API}/products`)).json();
  const p = products.products.find((x) => x.active === 1 && x.price_cents > 0 && (x.track_stock !== 1 || x.stock > 0));
  if (!p) throw new Error("no buyable product in the catalogue");
  seq += 1;
  /* The shop caps unpaid orders per phone and per IP, so each case is its
     own customer — which is the truth of what is being tested. */
  const r = await fetch(`${API}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": `100.77.${RUN % 250}.${seq}` },
    body: JSON.stringify({
      customer: {
        name: "Payment Return Test",
        phone: `01${String(RUN).padStart(3, "0")}${String(seq).padStart(5, "0")}`,
        address: "1 Jalan Return",
      },
      items: [{ id: p.id, qty: 1 }],
    }),
  });
  const j = await r.json();
  if (!j.token) throw new Error(`could not place an order: ${JSON.stringify(j)}`);
  return j.token;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

/* The gateway has to be on, or the FPX row is not drawn at all and every
   assertion below would pass by being absent. */
step("the local shop has the gateway switched on");
{
  const cfg = await (await fetch(`${API}/store-config`)).json();
  ok("store-config reports gateway: true", cfg.gateway === true,
     "put fake BILLPLZ_SECRET and BILLPLZ_COLLECTION in worker/.dev.vars and restart wrangler dev");
  if (cfg.gateway !== true) { await browser.close(); process.exit(1); }
}

async function visit(token, query) {
  await page.goto(`${SITE}/order?t=${token}${query}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(2500); // the settle is immediate once bill:false comes back
  return page.locator("main").innerText();
}

step("returning with a payment that did NOT go through");
{
  const token = await newOrder();
  const text = await visit(token, "&billplz[id]=fakebill1&billplz[paid]=false");

  ok("the page says the payment did not go through", /didn.t go through/i.test(text), text.slice(0, 160));
  /* The single most important sentence on this screen. A customer who is not
     told this will assume the money left and will not try again. */
  ok("it states plainly that they have NOT been charged", /have not been charged/i.test(text));
  ok("it offers to try again", /try again/i.test(text));
  ok("it offers bank transfer as the other way", /bank transfer/i.test(text));
  ok("it does NOT claim the payment is being confirmed", !/still verifying/i.test(text));

  const payBtn = page.getByRole("button", { name: /pay|try again/i }).first();
  ok("the pay button is available again", await payBtn.isEnabled());
}

step("returning when the bank says paid but we cannot confirm it yet");
{
  const token = await newOrder();
  const text = await visit(token, "&billplz[id]=fakebill2&billplz[paid]=true");

  ok("the page says the bank confirmed it", /bank confirmed the payment/i.test(text), text.slice(0, 160));
  ok("it is explicit that we are still verifying", /still verifying/i.test(text));
  /* The rule this screen exists to keep. Telling somebody whose bank has
     already taken the money to "try again" is how they pay twice. */
  ok("it TELLS THEM NOT TO PAY AGAIN", /do not pay\s*again/i.test(text));
  ok("it does not say the payment failed", !/didn.t go through/i.test(text));
  ok("it offers a way to check again", /check again/i.test(text));
  ok("it offers to send the receipt on WhatsApp", /send us the receipt/i.test(text));

  /* The sentence is only worth as much as the button agrees with it. A live
     Pay button underneath "do not pay again" is an invitation to be charged
     twice, and the words would be the thing that was wrong. */
  const pay = page.getByRole("button", { name: /pay|confirming/i }).first();
  ok("the Pay button is DISABLED, not just discouraged", await pay.isDisabled(),
     await pay.innerText().catch(() => "(no button)"));
  ok("and it says why", /already received/i.test(await pay.innerText().catch(() => "")));
  /* Bank transfer stays open — it is the escape hatch if something really
     has gone wrong, and locking every route would strand the customer. */
  ok("bank transfer is still available as a way out", /bank transfer/i.test(text));
}

step("the order link is clean afterwards");
{
  const url = page.url();
  ok("billplz parameters are stripped from the address bar", !url.includes("billplz"), url);
  ok("the order token survives, so the link still works", /[?&]t=[a-f0-9]{32}/.test(url), url);
}

step("arriving normally shows none of these screens");
{
  const token = await newOrder();
  const text = await visit(token, "");
  ok("no failure notice on a fresh order", !/didn.t go through/i.test(text));
  ok("no confirmation notice either", !/still verifying/i.test(text));
  ok("the pay button is offered", /pay rm/i.test(text), text.slice(0, 160));
}

await browser.close();
console.log(fail === 0
  ? `\nPASS - ${pass} checks: every way back from the bank says something true.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
