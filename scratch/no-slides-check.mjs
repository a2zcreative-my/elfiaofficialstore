/**
 * The homepage carousel is the portal's ALONE (v1.32.0).
 *
 * The CEO, 27-08-2026: "this should not appear in Homepage carousel, I think
 * this is hardcoded. I want Homepage carousel only appear for my uploaded!"
 *
 * The shipped BRAND_SLIDES fallback is deleted; this rig proves the two
 * states that replace it, in a real browser against the built export:
 *   1. portal silent + nothing Featured -> NO carousel is rendered at all,
 *      no campaign photo, no shipped caption — and the rest of the page
 *      still stands. (The og:image meta tag legitimately keeps a campaign
 *      photo for share previews; only RENDERED images are checked.)
 *   2. portal silent + one Featured product -> that product IS the carousel.
 *
 *   node scratch/stub-api.mjs        (:8787 — its payload is intercepted)
 *   node scratch/serve-local.mjs     (:8100)
 *   node scratch/no-slides-check.mjs
 */
import { chromium } from "playwright";
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
let pass = 0, fail = 0;
const ok = (l, c, e="") => { if (c) { pass++; console.log("  ok  " + l); } else { fail++; console.log("  XX  " + l + (e?` -- ${e}`:"")); } };

// Case 1: no portal slides, no featured products -> NO carousel, no campaign photos
{
  const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pg.route("**/api/v1/products", async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    delete j.slides;                              // portal silent = no slides key
    j.products = j.products.map(p => ({ ...p, featured: 0 }));
    await route.fulfill({ response: r, json: j });
  });
  await pg.goto("http://127.0.0.1:8100/", { waitUntil: "domcontentloaded" });
  await pg.waitForSelector("text=Nationwide delivery");
  ok("no carousel is rendered at all", await pg.locator("img[data-slide-backdrop]").count() === 0);
  /* The og:image meta tag legitimately keeps a campaign photo (the share
     preview); what must be gone is any RENDERED one. */
  const imgs = await pg.$$eval("img", (els) => els.map((e) => e.getAttribute("src") ?? ""));
  ok("no shipped campaign photo is rendered",
     !imgs.some((s) => s.includes("campaign-studio") || s.includes("campaign-salon")), imgs.join(","));
  const body = await pg.locator("body").innerText();
  ok("no shipped slide caption appears", !body.includes("The Bawal Collection") && !body.includes("Made for every day"));
  ok("the rest of the page still renders (trust strip)", await pg.locator("text=Nationwide delivery").count() === 1);
  await pg.close();
}

// Case 2: no portal slides but ONE featured product -> that product IS the carousel
{
  const pg = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  await pg.route("**/api/v1/products", async (route) => {
    const r = await route.fetch();
    const j = await r.json();
    delete j.slides;
    j.products = j.products.map((p, i) => ({ ...p, featured: i === 0 ? 1 : 0 }));
    await route.fulfill({ response: r, json: j });
  });
  await pg.goto("http://127.0.0.1:8100/", { waitUntil: "domcontentloaded" });
  await pg.waitForSelector("img[data-slide-backdrop]");
  ok("a Featured product still gets a slide", await pg.locator("img[data-slide-backdrop]").count() === 1);
  const imgs2 = await pg.$$eval("img", (els) => els.map((e) => e.getAttribute("src") ?? ""));
  ok("and still no campaign photos rendered",
     !imgs2.some((s) => s.includes("campaign-studio") || s.includes("campaign-salon")), imgs2.join(","));
  await pg.close();
}
await b.close();
console.log(fail === 0 ? `PASS - ${pass} checks: the carousel is the portal's alone.` : `${fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
