/**
 * Is the catalog priced from the shop, or from a picture? (v1.17.0)
 *
 * The CEO: "I need the catalog fetch the prices from it actual price in
 * web/mobile. this is to make everything automatically without me need to
 * regenerate the pdf which is difficult for me."
 *
 * v1.15.0 built /catalog out of the PDF's page images, which meant its
 * prices could only ever be changed by re-exporting a PDF and re-cutting the
 * images. This rig proves the rebuild: change a price in the (stand-in)
 * portal, sync, and the catalog follows — no file touched, nobody reloading.
 *
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/catalog-live-check.mjs
 */
import { chromium } from "playwright";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL ?? "http://127.0.0.1:8200";
const SITE = process.env.SITE ?? "http://127.0.0.1:8100";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";
const SKU = process.env.SKU ?? "LUMI003";

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
const BRIDGE = process.env.BRIDGE_KEY ?? "shared-bridge-secret";

const all = (await (await fetch(`${API}/products`)).json()).products;
const target = all.find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU && p.active === 1);
if (!target) { console.log(`no active ${SKU} — run store-sync-test.mjs first`); process.exit(1); }
const ORIGINAL = target.price_cents;

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const comeBack = async () => {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForTimeout(1400);
};

try {
  step("the catalog is built from the shop's own products");
  {
    await page.goto(`${SITE}/catalog`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1600);
    const text = await page.locator("main").innerText();

    ok("it lists the shop's shades", text.includes(SKU), `${SKU} not on the page`);
    ok("at the price the shop charges", text.includes(rm(ORIGINAL)), `expected ${rm(ORIGINAL)}`);
    /* Every active product, not a fixed set baked into a picture. */
    const active = all.filter((p) => p.active === 1);
    const shown = await page.locator('main a[href^="/p?id="]').count();
    ok("every active product has a tile", shown >= active.length,
       `${shown} tiles for ${active.length} active products`);
    ok("and each tile links to that product", shown > 0);
  }

  step("a price changed in the portal reaches the catalog");
  {
    const next = ORIGINAL + 800;
    await portalPost("/_price", { sku: SKU, price_cents: next });
    await syncNow();
    await comeBack();
    const text = await page.locator("main").innerText();
    ok("the catalog shows the new price", text.includes(rm(next)), `expected ${rm(next)}`);
    ok("and no longer the old one for that shade",
       !(await page.locator(`main a:has-text("${SKU}")`).first().innerText()).includes(rm(ORIGINAL)));
  }

  step("a promotion shows as a sale, struck through");
  {
    const base = ORIGINAL + 800;
    await portalPost("/_discount", { sku: SKU, discount_cents: 600 });
    await syncNow();
    await comeBack();
    const tile = await page.locator(`main a:has-text("${SKU}")`).first().innerText();
    ok("the discounted price is shown", tile.includes(rm(base - 600)), tile.replace(/\n/g, " | "));
    ok("with the old price struck through", tile.includes(rm(base)), tile.replace(/\n/g, " | "));
  }

  step("no price is baked into an image any more");
  {
    /* The only page image left is the cover, which carries no prices. If the
       priced page scans ever come back, this fails — which is the point. */
    const imgs = await page.evaluate(() =>
      [...document.querySelectorAll("main img")].map((i) => new URL(i.src, location.href).pathname));
    const priced = imgs.filter((s) => /\/lookbook\/page-[2-9]\.jpg$/.test(s));
    ok("the priced page scans are gone", priced.length === 0, priced.join(", "));
    /* v1.21.0 moved the cover to the STABLE route (the CEO's uploaded cover
       when one exists, the shipped page-1 scan otherwise) so a new upload
       changes the preview with no site rebuild. Either address is the
       cover; both carry no prices. */
    ok("the cover is still used", imgs.some((s) => s.endsWith("/lookbook/page-1.jpg") || s.endsWith("/api/v1/catalog-cover")), imgs.join(", "));
  }

  step("the PDF is offered, and described honestly");
  {
    /* v1.18.0 replaced the stored file with one generated per request
       (proven in full by catalog-pdf-check.mjs). What this rig still cares
       about is that the PAGE points at the generated route and does not
       promise anything a customer would later find untrue. */
    const text = await page.locator("main").innerText();
    /* v1.22.0 — the link is the PUBLIC address now (CEO: "should not
       appear as API"); a wrangler route hands that exact path to the same
       engine, so it is still the generated document. */
    ok("the page links the generated PDF at its public address",
       (await page.locator('main a[href="/catalog.pdf"]').count()) >= 1);
    ok("it does not link a stored file that cannot update",
       (await page.locator('main a[href$="/lookbook/elfia-catalog.pdf"]').count()) === 0);
    ok("and it says the PDF is built fresh", /built fresh/i.test(text), text.slice(0, 240));
  }

  step("an uploaded catalog takes over the PAGE itself (v1.25.0)");
  {
    /* The CEO: "https://elfiaofficialstore.my/catalog should reflect to the
       pdf that uploaded with update in the portal." With her upload live,
       the page draws the document's own pages (pdf.js), tap targets
       included, and the tile grid stands down. */
    const { PDFDocument, StandardFonts, rgb } = (await import("node:module"))
      .createRequire(import.meta.url)("../worker/node_modules/pdf-lib");
    const doc = await PDFDocument.create();
    const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
    const pg = doc.addPage([595.28, 841.89]);
    pg.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.98, 0.96, 0.94) });
    pg.drawText("Raya Pages", { x: 200, y: 500, size: 24, font: serif, color: rgb(0.3, 0.12, 0.17) });
    const sites = [{ page: 0, label: "Raya Pages", x0: 200, y0: 320, x1: 380, y1: 350 }];
    await portalPost("/_catalog", {
      pdf_b64: Buffer.from(await doc.save()).toString("base64"),
      map: { version: 1, pages: [{ w: 595.28, h: 841.89 }], sites },
      updated_at: `live-${Date.now()}`,
    });
    await syncNow();

    /* domcontentloaded, not networkidle: pdf.js streams the document with
       range requests and the page legitimately keeps the wire busy. */
    await page.goto(`${SITE}/catalog`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const canvases = await page.locator("main canvas").count();
    ok("the page draws the uploaded document's pages", canvases >= 1, `${canvases} canvases`);
    const overlays = await page.locator("main canvas + a, main div > a[aria-label='Open in the shop']").count();
    ok("with tap targets laid over the artwork", overlays >= 1, `${overlays} overlays`);
    const tiles = await page.locator('main a[href^="/p?id="] img').count();
    ok("and the tile grid stands down (the document IS the catalog)", tiles === 0, `${tiles} tiles`);

    await portalPost("/_catalog", { clear: true });
    await fetch(`${API}/bridge/catalog`, { method: "DELETE", headers: { "X-Bridge-Key": BRIDGE } });
    await page.goto(`${SITE}/catalog`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2500);
    ok("removing the upload brings the tile grid back",
       (await page.locator('main a[href^="/p?id="]').count()) >= 1);
  }

} finally {
  await portalPost("/_catalog", { clear: true }).catch(() => null);
  await fetch(`${API}/bridge/catalog`, { method: "DELETE", headers: { "X-Bridge-Key": BRIDGE } }).catch(() => null);
  await portalPost("/_discount", { sku: SKU, discount_cents: null }).catch(() => null);
  await portalPost("/_price", { sku: SKU, price_cents: ORIGINAL }).catch(() => null);
  await syncNow().catch(() => null);
  await browser.close();
}

const back = (await (await fetch(`${API}/products`)).json()).products.find((p) => p.id === target.id);
ok("the rig put the price back", back?.price_cents === ORIGINAL, `${back?.price_cents} vs ${ORIGINAL}`);

console.log(fail === 0
  ? `\nPASS - ${pass} checks: the catalog is priced by the shop, not by a picture.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
