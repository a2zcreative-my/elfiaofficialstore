/**
 * Is the catalog PDF real, current, and actually on the page? (v1.18.0)
 *
 * The CEO: "I want my own PDF without create any new catalog, I want PDF to
 * be embedded with this website! I also want to make sure this PDF able to
 * fetch the actual prices of my Product!!!"
 *
 * A file cannot do all three, so /api/v1/catalog.pdf BUILDS one on every
 * request from the live database. This rig proves the three claims
 * separately, because they can fail separately:
 *
 *   real     — it is a valid PDF, with pages, that a viewer can open
 *   current  — change a price in the portal, and the NEXT download has it
 *   embedded — the page actually carries it, and the CSP does not block it
 *
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/catalog-pdf-check.mjs
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

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

/* The PDF is cached for a minute, so a rig checking "it changed" must ask
   for a fresh one rather than the cached copy. A cache-busting query is what
   a browser does on a hard reload; it is not a special back door. */
const grab = async (tag) => {
  const r = await fetch(`${API}/catalog.pdf?t=${tag}`, { headers: { "Cache-Control": "no-cache" } });
  return { status: r.status, type: r.headers.get("content-type"), bytes: Buffer.from(await r.arrayBuffer()) };
};
/* Read the words back out of the PDF, which is the only way to know a price
   really is IN the document rather than merely in the database. */
const textOf = (buf) => {
  const f = `/tmp/catcheck-${Date.now()}.pdf`;
  writeFileSync(f, buf);
  try { return execFileSync("pdftotext", [f, "-"], { encoding: "utf8", maxBuffer: 20e6 }); }
  finally { try { unlinkSync(f); } catch { /* already gone */ } }
};

const all = (await (await fetch(`${API}/products`)).json()).products;
const target = all.find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU && p.active === 1);
if (!target) { console.log(`no active ${SKU} — run store-sync-test.mjs first`); process.exit(1); }
const ORIGINAL = target.price_cents;

try {
  step("it is a real PDF");
  {
    const { status, type, bytes } = await grab("a");
    ok("the route answers", status === 200, String(status));
    ok("as application/pdf", (type ?? "").includes("application/pdf"), String(type));
    ok("with the PDF magic header", bytes.subarray(0, 5).toString() === "%PDF-", bytes.subarray(0, 8).toString());
    ok("and real weight to it", bytes.length > 20_000, `${bytes.length} bytes`);
    const info = execFileSync("pdfinfo", ["-"], { input: bytes, encoding: "utf8" });
    ok("a viewer can read its page count", /Pages:\s+[1-9]/.test(info), info.split("\n")[0]);
    ok("it is titled for the shop", /ELFIA Catalog/.test(info), info.match(/Title:.*/)?.[0] ?? "");
    ok("its pages are A4", /\(A4\)/.test(info), info.match(/Page size:.*/)?.[0] ?? "");
  }

  step("its prices are the shop's, right now");
  {
    const before = textOf((await grab("b")).bytes);
    ok(`it carries ${SKU}`, before.includes(SKU), "SKU not in the document text");
    ok("at the current price", before.includes(rm(ORIGINAL)), `expected ${rm(ORIGINAL)}`);

    const next = ORIGINAL + 900;
    await portalPost("/_price", { sku: SKU, price_cents: next });
    await syncNow();

    const after = textOf((await grab("c")).bytes);
    /* THE claim. A file could never do this. */
    ok("a price changed in the portal is in the NEXT PDF", after.includes(rm(next)), `expected ${rm(next)}`);
  }

  step("a promotion reaches the PDF as a sale");
  {
    const base = ORIGINAL + 900;
    await portalPost("/_discount", { sku: SKU, discount_cents: 700 });
    await syncNow();
    const t = textOf((await grab("d")).bytes);
    ok("the discounted price is printed", t.includes(rm(base - 700)), `expected ${rm(base - 700)}`);
    ok("beside the price it came down from", t.includes(rm(base)), `expected ${rm(base)}`);
  }

  step("it says when it was made");
  {
    const t = textOf((await grab("e")).bytes);
    const today = new Date().toISOString().slice(0, 10);
    /* A PDF outlives the tab it came from — somebody will still have this
       file in a month. It has to say what day its prices were true. */
    ok("the footer stamps the date", t.includes(`Prices as at ${today}`), `looking for ${today}`);
    ok("and names the shop", /elfiaofficialstore\.my/.test(t));
  }

  step("the page embeds it, and the CSP allows it");
  {
    const browser = await chromium.launch({
      executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    });
    /* Desktop: the embed is lg-only, because a phone browser draws a blank
       box instead of a PDF and a blank box is worse than a button. */
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const blocked = [];
    page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) blocked.push(m.text()); });

    await page.goto(`${SITE}/catalog`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);

    ok("the desktop page carries the embed",
       (await page.locator('object[type="application/pdf"]').count()) === 1);
    ok("pointed at the generated route",
       (await page.locator('object[type="application/pdf"]').getAttribute("data"))?.includes("/api/v1/catalog.pdf"));
    /* object-src was 'none' until this release, which would have blocked the
       embed silently — the page would have looked fine and shown nothing. */
    ok("the CSP does not block it", blocked.length === 0, blocked.join(" | "));
    ok("and a button opens it too", (await page.locator(`main a[href="/api/v1/catalog.pdf"]`).count()) >= 1);

    const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const pp = await phone.newPage();
    await pp.goto(`${SITE}/catalog`, { waitUntil: "networkidle" });
    await pp.waitForTimeout(1600);
    /* A phone must get something that works, not an empty rectangle. */
    ok("a phone is not shown an empty frame",
       !(await pp.locator('object[type="application/pdf"]').first().isVisible().catch(() => false)));
    const text = await pp.locator("main").innerText();
    ok("it gets the live tiles instead", text.includes(SKU), "no product tiles on the phone");
    ok("and the PDF is still one tap away", /open the pdf/i.test(text));
    await browser.close();
  }
} finally {
  await portalPost("/_discount", { sku: SKU, discount_cents: null }).catch(() => null);
  await portalPost("/_price", { sku: SKU, price_cents: ORIGINAL }).catch(() => null);
  await syncNow().catch(() => null);
}

const back = (await (await fetch(`${API}/products`)).json()).products.find((p) => p.id === target.id);
ok("the rig put the price back", back?.price_cents === ORIGINAL, `${back?.price_cents} vs ${ORIGINAL}`);

console.log(fail === 0
  ? `\nPASS - ${pass} checks: the PDF is real, it is hers, and it prices itself.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
