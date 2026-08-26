/**
 * Does an open page follow a price change? (v1.16.0)
 *
 * The CEO: "How to make all the pages automatically update the prices and
 * promotion/discount?"
 *
 * Most of that chain was already built and is proven elsewhere — the portal's
 * edits reach the store within a minute (store-sync-test.mjs), and every page
 * fetches its prices on mount with `Cache-Control: no-store`, so nothing
 * anywhere caches a number. The case nobody had tested is the one nobody
 * sees: a page that was ALREADY OPEN when the price changed.
 *
 * So this rig drives the WHOLE chain and never touches the browser's data
 * directly: it changes the price in the (stand-in) portal, syncs, and asks
 * whether the page a customer is still looking at followed.
 *
 *   portal price change -> bridge sync -> store database -> open page
 *
 * It also checks the header's announcement bar, which had a staleness bug of
 * its own: the store config was cached at module scope for the life of the
 * tab, so the free-delivery figure a customer saw was frozen at whatever it
 * had been when they arrived.
 *
 * Needs the same rig as store-sync-test.mjs:
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/live-price-check.mjs
 */
import { chromium } from "playwright";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL ?? "http://127.0.0.1:8200";
const SITE = process.env.SITE ?? "http://127.0.0.1:8100";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const admin = (p, init = {}) => fetch(`${API}${p}`, {
  ...init, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const portalPost = (path, body) => fetch(`${PORTAL}${path}`, { method: "POST", body: JSON.stringify(body) });
const syncNow = () => admin("/admin/sync-stock", { method: "POST" }).then((r) => r.json());
const rm = (c) => `RM ${(c / 100).toFixed(2)}`;

/* A portal-managed product: this rig is about the portal->shop path, so the
   product has to be one the portal actually prices. */
const SKU = process.env.SKU ?? "LUMI003";
const all = (await (await fetch(`${API}/products`)).json()).products;
const target = all.find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU && p.active === 1);
if (!target) { console.log(`no active product with SKU ${SKU} — run store-sync-test.mjs first`); process.exit(1); }
const ORIGINAL = target.price_cents;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();

/* The refresh fires on tab-focus, on becoming visible again, and on a 90s
   timer while the tab is being looked at. A test cannot wait 90 seconds an
   assertion, so it fires the same window `focus` event the browser would.
   That is the real code path — nothing here is mocked or stubbed. */
const comeBack = async () => {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1400);
};
/* The price of THIS product, read from its own element rather than from the
   whole page: "You may also like" carries other prices, and an assertion
   against the page's full text would pass or fail on those by accident. */
const shownPrice = () => page.locator('[data-testid="product-price"]').first().innerText();
const shownWas = async () =>
  (await page.locator('[data-testid="product-was"]').count())
    ? page.locator('[data-testid="product-was"]').first().innerText() : "";

try {
  step(`${SKU} is on the shop and priced`);
  {
    await page.goto(`${SITE}/p?id=${target.id}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    ok("the page opens at the current price", (await shownPrice()).includes(rm(ORIGINAL)),
       `showing ${await shownPrice()}, expected ${rm(ORIGINAL)}`);
  }

  step("the CEO changes the price in the portal while the customer is reading");
  {
    const next = ORIGINAL + 700;
    await portalPost("/_price", { sku: SKU, price_cents: next });
    await syncNow();

    /* The page must NOT have moved on its own — this is a shop, not a
       ticker, and a price changing under a reader's eyes mid-sentence would
       be its own problem. It updates when they come back to it. */
    ok("the open page has not moved yet", (await shownPrice()).includes(rm(ORIGINAL)));

    await comeBack();
    ok("coming back to the tab re-prices it", (await shownPrice()).includes(rm(next)),
       `showing ${await shownPrice()}, expected ${rm(next)}`);
  }

  step("a discount started mid-visit appears as a sale");
  {
    const base = ORIGINAL + 700;
    await portalPost("/_discount", { sku: SKU, discount_cents: 500 });
    await syncNow();
    await comeBack();

    ok("the customer sees the discounted price", (await shownPrice()).includes(rm(base - 500)),
       `showing ${await shownPrice()}, expected ${rm(base - 500)}`);
    ok("with the old price struck through beside it", (await shownWas()).includes(rm(base)),
       `showing "${await shownWas()}", expected ${rm(base)}`);
  }

  step("the shop listing follows the same change");
  {
    await page.goto(`${SITE}/shop`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1400);
    await portalPost("/_discount", { sku: SKU, discount_cents: null });
    await portalPost("/_price", { sku: SKU, price_cents: ORIGINAL + 1500 });
    await syncNow();
    await comeBack();
    ok("the listing shows the newest price",
       (await page.locator("main").innerText()).includes(rm(ORIGINAL + 1500)),
       `expected ${rm(ORIGINAL + 1500)}`);
  }

  step("the announcement bar follows the delivery threshold");
  {
    const cfg = await (await fetch(`${API}/store-config`)).json();
    ok("the bar opens on the current threshold",
       (await page.locator("header").innerText()).includes(rm(cfg.free_above_cents)),
       `header does not mention ${rm(cfg.free_above_cents)}`);

    /* This is the header's own bug, separate from the pages: the store config
       used to be cached at module scope for the lifetime of the tab. */
    const moved = cfg.free_above_cents === 4500 ? 6000 : 4500;
    await portalPost("/_settings", { settings: { shipping_cents: cfg.shipping_cents, free_above_cents: moved } });
    await syncNow();
    await comeBack();
    ok("and follows it when the portal moves it",
       (await page.locator("header").innerText()).includes(rm(moved)),
       `header still reads: ${(await page.locator("header").innerText()).split("\n")[0]}`);

    await portalPost("/_settings", { settings: { shipping_cents: cfg.shipping_cents, free_above_cents: cfg.free_above_cents } });
    await syncNow();
  }
} finally {
  /* Always put the price back, whatever happened above. A rig that leaves a
     wrong price behind is worse than no rig at all. */
  await portalPost("/_discount", { sku: SKU, discount_cents: null }).catch(() => null);
  await portalPost("/_price", { sku: SKU, price_cents: ORIGINAL }).catch(() => null);
  await syncNow().catch(() => null);
  await browser.close();
}

const back = (await (await fetch(`${API}/products`)).json()).products.find((p) => p.id === target.id);
ok("the rig put the original price back", back?.price_cents === ORIGINAL,
   `${back?.price_cents} vs ${ORIGINAL}`);

console.log(fail === 0
  ? `\nPASS - ${pass} checks: a portal price change reaches a page nobody reloaded.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
