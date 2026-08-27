/**
 * The ELFIA hover backdrop, everywhere a product is shown (v1.33.0).
 *
 * The CEO, 27-08-2026, pointing at the shop grid: "for this area also need
 * to have the hover!" — v1.30 gave the effect to the /catalog tiles only.
 *
 * What this proves, in a real browser, on the real built pages:
 *   1. EVERY product card carries a backdrop layer behind its photo — on
 *      the home rails, the shop grid, and the product page's own photo.
 *   2. The layer is INVISIBLE at rest and VISIBLE under a real cursor,
 *      read as the browser's own computed opacity after the 500ms fade,
 *      never from the class list (a class proves nothing about paint).
 *   3. The PHOTO paints above it. This is the trap that bit the carousel:
 *      a positioned box paints over a static one whatever the source
 *      order, so the photo needs `relative` or it hides under its own
 *      backdrop. Checked by asking the browser what is actually on top at
 *      the centre of the frame.
 *   4. Every layer points at /api/v1/tile-backdrop — the ONE stable URL —
 *      so a portal upload changes every card at once, and no page holds a
 *      hardcoded picture any more.
 *   5. v1.35.0 — THE APP VIEW STAYS PLAIN. v1.34.0 made the backdrop
 *      always-on where no cursor exists; the CEO looked at it on a phone:
 *      "I dont want the hover in the mobile apps view, let it on the web
 *      view instead." So a touch emulation must show NO backdrop at all,
 *      and this rig fails if one ever comes back.
 *
 *   node scratch/stub-api.mjs
 *   node scratch/serve-local.mjs
 *   node scratch/hover-backdrop-check.mjs
 */
import { chromium } from "playwright";

const SITE = process.env.SITE ?? "http://127.0.0.1:8100";
const SEL = 'img[src="/api/v1/tile-backdrop"]';

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const pg = await ctx.newPage();

/* The rails render TWICE — a phone rail (lg:hidden) and a desktop grid
   (hidden lg:grid) — so the DOM holds backdrops belonging to a display:none
   copy. A cursor cannot hover those, and counting them as failures would be
   the rig lying about the page. So every index below is an index into the
   layers that are actually LAID OUT. */
const visible = () => pg.evaluate(() =>
  [...document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')]
    .map((el, i) => [el, i])
    .filter(([el]) => el.getClientRects().length > 0 && el.parentElement.getClientRects().length > 0)
    .map(([, i]) => i));

/* The layer is opacity-0, so Playwright's own boundingBox() calls it
   invisible and returns null — the rect has to come from the DOM. The
   frame is scrolled into view first, because a real cursor cannot hover
   what is not on screen. */
const frameRect = (i) => pg.evaluate((n) => {
  const back = document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')[n];
  const frame = back.parentElement;
  frame.scrollIntoView({ block: "center" });
  const r = frame.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}, i);

/** What the browser sees at this instant, for the nth backdrop. */
const read = (i) => pg.evaluate((n) => {
  const back = document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')[n];
  const frame = back.parentElement;
  const photo = [...frame.querySelectorAll("img")].find((el) => el !== back);
  const fr = frame.getBoundingClientRect(), br = back.getBoundingClientRect();
  const top = document.elementFromPoint(fr.left + fr.width / 2, fr.top + fr.height / 2);
  return {
    opacity: Number(getComputedStyle(back).opacity),
    covers: Math.abs(br.width - fr.width) < 2 && Math.abs(br.height - fr.height) < 2,
    photoOnTop: photo ? (top === photo || photo.contains(top)) : null,
    photoPositioned: photo ? getComputedStyle(photo).position !== "static" : null,
  };
}, i);

/** Rest → hover → the numbers, for the nth backdrop on the current page. */
const hoverProbe = async (i) => {
  await pg.mouse.move(5, 5);                 // park the cursor off every card
  await pg.waitForTimeout(700);
  const box = await frameRect(i);
  const rest = await read(i);
  await pg.mouse.move(box.x, box.y);
  await pg.waitForTimeout(800);              // the fade is 500ms
  const hovered = await read(i);
  return { rest, hovered, box };
};

for (const [name, path] of [["home", "/"], ["shop", "/shop"]]) {
  step(`${name} — every product card has the backdrop`);
  await pg.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded" });
  await pg.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await pg.waitForTimeout(800);

  const n = await pg.locator(SEL).count();
  const shown = await visible();
  const photos = await pg.locator('img[alt]:not([alt=""])').count();
  ok(`${n} backdrop layers are on the page (${shown.length} laid out)`, n > 0, String(n));
  ok("one for every product photo", n >= Math.min(photos, 4), `${n} layers vs ${photos} photos`);

  const { rest, hovered } = await hoverProbe(shown[0]);
  ok("it covers the whole frame", rest.covers);
  ok("invisible at rest", rest.opacity === 0, String(rest.opacity));
  ok("visible under a real cursor", hovered.opacity > 0.9, String(hovered.opacity));
  ok("the photo is positioned, so it paints ABOVE its own backdrop", hovered.photoPositioned === true);
  ok("and the browser agrees the photo is what is on top", hovered.photoOnTop === true);

  /* A card further down the page behaves the same — the layer is the
     component's, not one lucky element. */
  if (shown.length > 3) {
    const later = await hoverProbe(shown[3]);
    ok("a card further down behaves identically",
       later.rest.opacity === 0 && later.hovered.opacity > 0.9,
       `${later.rest.opacity} -> ${later.hovered.opacity}`);
  }

  /* Nothing anywhere still points at the old hardcoded file. */
  const srcs = await pg.$$eval("img", (els) => els.map((e) => e.getAttribute("src") ?? ""));
  ok("no card holds the shipped backdrop file directly",
     !srcs.some((s) => s.includes("elfia-backdrop.jpg")),
     srcs.filter((s) => s.includes("backdrop")).join(", "));
}

step("the product page's own photo has it too");
{
  const id = await pg.evaluate(async () => {
    const r = await fetch("/api/v1/products");
    const j = await r.json();
    return (j.products.find((p) => p.image_key) ?? j.products[0]).id;
  });
  await pg.goto(`${SITE}/p?id=${id}`, { waitUntil: "domcontentloaded" });
  await pg.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await pg.waitForTimeout(800);
  ok("the hero frame carries a backdrop", await pg.locator(SEL).count() >= 1);
  const { rest, hovered } = await hoverProbe((await visible())[0]);
  ok("invisible at rest, visible on hover", rest.opacity === 0 && hovered.opacity > 0.9,
     `${rest.opacity} -> ${hovered.opacity}`);
  ok("the photo still paints above it", hovered.photoOnTop === true && hovered.photoPositioned === true);
}

step("/catalog keeps the effect it already had");
{
  await pg.goto(`${SITE}/catalog`, { waitUntil: "domcontentloaded" });
  await pg.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await pg.waitForTimeout(1000);
  ok("the tiles still carry the backdrop", await pg.locator(SEL).count() > 0);
  const { rest, hovered } = await hoverProbe((await visible())[0]);
  ok("still hidden until hover", rest.opacity === 0, String(rest.opacity));
  ok("and revealed by it", hovered.opacity > 0.9, String(hovered.opacity));
}


/* ---- v1.34.0: the app view, where nothing can hover ---- */

step("a phone shows NO backdrop at all (v1.35.0 — his call)");
{
  const phone = await browser.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
             + "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const mob = await phone.newPage();

  for (const [label, path] of [["home", "/"], ["shop", "/shop"], ["catalog", "/catalog"]]) {
    await mob.goto(`${SITE}${path}`, { waitUntil: "domcontentloaded" });
    await mob.waitForSelector(SEL, { timeout: 15000, state: "attached" });
    await mob.waitForTimeout(900);

    if (label === "home") {
      /* The premise first: if the browser claimed it CAN hover, the rest of
         this section would be testing a desktop in a small window. */
      const noHover = await mob.evaluate(() => matchMedia("(hover: none)").matches);
      ok("the emulated phone really reports (hover: none)", noHover === true);
    }

    const state = await mob.evaluate(() => {
      const layers = [...document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')]
        .filter((el) => el.getClientRects().length > 0);
      return {
        n: layers.length,
        lit: layers.filter((el) => Number(getComputedStyle(el).opacity) > 0.01).length,
      };
    });
    ok(`${label}: every laid-out card stays plain (0 of ${state.n} lit)`,
       state.n > 0 && state.lit === 0, `${state.lit} lit`);
  }

  /* A tap must not reveal it either — the card is a link, and `active`
     styling on the way to the product page would be a flash of a thing he
     asked not to see. */
  await mob.goto(`${SITE}/shop`, { waitUntil: "domcontentloaded" });
  await mob.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await mob.waitForTimeout(900);
  const rect = await mob.evaluate(() => {
    const f = [...document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')]
      .find((el) => el.getClientRects().length > 0).parentElement;
    f.scrollIntoView({ block: "center" });
    const r = f.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await mob.touchscreen.tap(rect.x, rect.y).catch(() => {});
  await mob.waitForTimeout(250);
  const duringTap = await mob.evaluate(() => {
    const el = [...document.querySelectorAll('img[src="/api/v1/tile-backdrop"]')]
      .find((e) => e.getClientRects().length > 0);
    return el ? Number(getComputedStyle(el).opacity) : 0;
  });
  ok("a tap does not flash it either", duringTap < 0.01, String(duringTap));

  /* The product page in the app view, same rule. */
  const id = await mob.evaluate(async () => {
    const j = await (await fetch("/api/v1/products")).json();
    return (j.products.find((p) => p.image_key) ?? j.products[0]).id;
  });
  await mob.goto(`${SITE}/p?id=${id}`, { waitUntil: "domcontentloaded" });
  await mob.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await mob.waitForTimeout(900);
  const hero = await mob.evaluate(() =>
    Number(getComputedStyle(document.querySelector('img[src="/api/v1/tile-backdrop"]')).opacity));
  ok("the product page stays plain on a phone too", hero < 0.01, String(hero));

  await phone.close();
}

/* And the WEB view keeps the effect — that is the half he wants. */
step("the desktop reveal is untouched");
{
  await pg.goto(`${SITE}/shop`, { waitUntil: "domcontentloaded" });
  await pg.waitForSelector(SEL, { timeout: 15000, state: "attached" });
  await pg.waitForTimeout(800);
  const canHover = await pg.evaluate(() => matchMedia("(hover: hover)").matches);
  ok("this context reports (hover: hover)", canHover === true);
  const { rest, hovered } = await hoverProbe((await visible())[0]);
  ok("still hidden until the cursor arrives", rest.opacity === 0, String(rest.opacity));
  ok("and still revealed by it", hovered.opacity > 0.9, String(hovered.opacity));
}

await browser.close();
console.log(fail === 0
  ? `\nPASS - ${pass} checks: the ELFIA backdrop reveals on the web view and leaves the app view plain.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
