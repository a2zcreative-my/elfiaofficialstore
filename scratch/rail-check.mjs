/**
 * Phone-layout guard (v1.12.2).
 *
 * The CEO, 25-08-2026, with three screenshots: "Whatsapp button overlapped
 * with the arrow up button. Carousel photo on mobile offset, shop by
 * collection, new arrival and studio pick still offset!!!!"
 *
 * overflow-check.mjs already proves the PAGE cannot be dragged sideways.
 * That is a different fault from the one in those screenshots, where the page
 * is the right width but the first tile of every horizontal rail is sliced
 * off by the left edge of the screen. So this rig measures the two things
 * that were never measured:
 *
 *   1. RAILS — a rail is inset from the screen with `-mx-4 px-4`, so its
 *      first tile must start at the same x as ordinary page content (16px).
 *      Anything less means the rail has scrolled itself and eaten its own
 *      padding, which is exactly what `scroll-snap-type: mandatory` does when
 *      no scroll-padding tells it where the content really starts.
 *
 *   2. FLOATING BUTTONS — the WhatsApp bubble and the back-to-top button are
 *      both fixed to the bottom-right. Their boxes must not intersect.
 *
 * Both are read off the live layout with getBoundingClientRect, so the answer
 * is the browser's, not mine.
 *
 *   node scratch/stub-api.mjs &
 *   node scratch/serve-local.mjs &
 *   node scratch/rail-check.mjs
 */
import { inflateSync } from "node:zlib";
import { chromium } from "playwright";

/**
 * Just enough PNG to read Playwright's own screenshot back as pixels.
 *
 * The banner check below is a LOOK-AT-THE-PIXELS test, not a geometry
 * argument, and it is that way because the geometry argument was wrong. The
 * first version of the blurred backdrop measured as covering the banner on
 * every side and still let the background show through: a CSS blur samples
 * past its element's edge, finds nothing, and fades out, so the box was
 * covering and the paint was not. Nothing short of the rendered pixel
 * catches that.
 *
 * Playwright writes 8-bit, non-interlaced, and picks RGB or RGBA per shot
 * depending on whether anything is transparent — so both are handled, and
 * anything else is refused rather than read as quiet nonsense.
 */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || (colour !== 6 && colour !== 2) || interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${depth}, colour ${colour}, interlace ${interlace})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = colour === 6 ? 4 : 3, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, bpp, data: out };
}

const BASE = process.env.SITE ?? "http://127.0.0.1:8100";
const PAGES = ["/", "/shop"];
/* The CEO asks for the phone AND the web view every time, and the banner
   fault is worse on the web: the same portrait photo has to fill a 21:9 strip
   there instead of a 4:3 box. */
const SIZES = [
  { name: "iPhone SE", width: 320, height: 700, mobile: true },
  { name: "iPhone 12", width: 390, height: 844, mobile: true },
  { name: "iPhone Max", width: 430, height: 900, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "desktop", width: 1280, height: 900, mobile: false },
];

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};

const browser = await chromium.launch({
  executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
});

for (const size of SIZES) {
  console.log(`\n${size.name} (${size.width}px)`);
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.mobile, hasTouch: size.mobile, deviceScaleFactor: size.mobile ? 3 : 1,
  });
  const page = await ctx.newPage();

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(700);

    /* ---- 1. rails ---- */
    const rails = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll(".rail")) {
        const cs = getComputedStyle(el);
        if (cs.display !== "flex") continue; // laid out as a grid on wide screens
        const first = el.firstElementChild;
        if (!first) continue;
        /* A label for the human reading the failure: the nearest heading
           above this rail, which is how the CEO named them. */
        let label = "(rail)";
        for (let n = el; n; n = n.parentElement) {
          const h = n.querySelector("h2, h3, [data-rail-label]");
          if (h && h.textContent.trim()) { label = h.textContent.trim().slice(0, 28); break; }
          if (n.tagName === "MAIN") break;
        }
        /* What the eye actually compares: the first tile against the block
           of text directly above it. That reference is the rail's parent
           content edge, which is 16px in from a phone screen, 24px on a
           tablet and wherever the centred column starts on a desktop — so
           the check works at every width without hard-coding any of them. */
        const par = el.parentElement;
        const pcs = getComputedStyle(par);
        const refLeft = par.getBoundingClientRect().left + parseFloat(pcs.paddingLeft);

        out.push({
          label,
          scrollLeft: Math.round(el.scrollLeft),
          padLeft: Math.round(parseFloat(cs.paddingLeft)),
          scrollPadLeft: cs.scrollPaddingLeft,
          railLeft: Math.round(el.getBoundingClientRect().left),
          refLeft: Math.round(refLeft),
          firstLeft: Math.round(first.getBoundingClientRect().left),
        });
      }
      return out;
    });

    for (const r of rails) {
      ok(`${path} rail "${r.label}" first tile lines up with the copy above it`,
         Math.abs(r.firstLeft - r.refLeft) <= 1,
         `firstLeft=${r.firstLeft}px vs gutter ${r.refLeft}px, scrollLeft=${r.scrollLeft}, padding-left=${r.padLeft}, scroll-padding-left=${r.scrollPadLeft}`);
      ok(`${path} rail "${r.label}" is not pre-scrolled`,
         r.scrollLeft === 0, `scrollLeft=${r.scrollLeft}px`);
    }

    /* ---- 2. the carousel banner is full-bleed ---- */
    if (path === "/") {
      const hero = await page.evaluate(() => {
        const back = document.querySelector("img[data-slide-backdrop]");
        if (!back) return { missing: true };
        const card = back.parentElement;
        const b = back.getBoundingClientRect(), c = card.getBoundingClientRect();
        const cs = getComputedStyle(back);
        return {
          fit: cs.objectFit,
          covers: b.left <= c.left + 0.5 && b.right >= c.right - 0.5
               && b.top <= c.top + 0.5 && b.bottom >= c.bottom - 0.5,
          box: `${Math.round(b.width)}x${Math.round(b.height)} over ${Math.round(c.width)}x${Math.round(c.height)}`,
        };
      });
      ok(`${path} the banner has a backdrop layer`, !hero.missing);
      if (!hero.missing) {
        ok(`${path} the backdrop is cover-fitted`, hero.fit === "cover", `object-fit: ${hero.fit}`);
        ok(`${path} the backdrop's box overhangs the banner`, hero.covers, hero.box);

        /* And now the part that actually decides it. The banner's own
           background is painted an impossible green and the screenshot is
           read back: any green pixel left is a hole the photograph does not
           fill, which is the fault the CEO photographed — a portrait shot
           floating in a landscape banner with the shop's blush showing down
           both sides. The geometry check above passed while the banner was
           still full of holes, so it is kept only as the more legible
           failure message, not as the verdict. */
        const box = await page.evaluate(() => {
          const card = document.querySelector("img[data-slide-backdrop]").parentElement;
          card.dataset.gapProbe = "1";
          card.style.backgroundColor = "#00ff00";
          const r = card.getBoundingClientRect();
          return { x: r.left, y: r.top, width: r.width, height: r.height };
        });
        await page.waitForTimeout(250);
        const png = decodePng(await page.screenshot({ clip: box }));
        let green = 0;
        for (let i = 0; i < png.data.length; i += png.bpp) {
          const [r, g, b] = [png.data[i], png.data[i + 1], png.data[i + 2]];
          if (g > 170 && r < 140 && b < 140) green++;
        }
        const total = png.width * png.height;
        await page.evaluate(() => {
          const card = document.querySelector('[data-gap-probe="1"]');
          card.style.backgroundColor = "";
          delete card.dataset.gapProbe;
        });
        ok(`${path} no gap shows through the banner`, green === 0,
           `${green} of ${total} pixels (${(green / total * 100).toFixed(1)}%) are the banner's bare background`);
      }
    }

    /* ---- 3. the floating buttons ---- */
    if (path === "/") {
      await page.evaluate(() => window.scrollTo(0, 1600));
      await page.waitForTimeout(500);
      const fabs = await page.evaluate(() => {
        const pick = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          const cs = getComputedStyle(el);
          return {
            top: Math.round(r.top), bottom: Math.round(r.bottom),
            left: Math.round(r.left), right: Math.round(r.right),
            visible: cs.opacity !== "0" && cs.visibility !== "hidden" && r.width > 0,
          };
        };
        /* The tab bar is display:none on a desktop, where a hidden element
           reports a zero-sized box at the top of the page. Reading that as
           "the bar starts at y=0" would fail the clearance check on the one
           layout that has no bar at all. */
        const tab = document.querySelector('nav[aria-label="Main"]');
        const barShown = tab && getComputedStyle(tab).display !== "none";
        return {
          wa: pick('a[aria-label*="WhatsApp"]'),
          up: pick('button[aria-label="Back to top"]'),
          tabTop: barShown ? Math.round(tab.getBoundingClientRect().top) : null,
        };
      });

      ok(`${path} the WhatsApp bubble is drawn`, !!fabs.wa && fabs.wa.visible,
         "a real number is configured, so it should be");
      ok(`${path} the back-to-top button is drawn once scrolled`, !!fabs.up && fabs.up.visible);

      if (fabs.wa && fabs.up && fabs.wa.visible && fabs.up.visible) {
        const overlap = !(fabs.up.bottom <= fabs.wa.top || fabs.up.top >= fabs.wa.bottom
                       || fabs.up.right <= fabs.wa.left || fabs.up.left >= fabs.wa.right);
        ok(`${path} the two floating buttons do not overlap`, !overlap,
           `whatsapp ${fabs.wa.top}-${fabs.wa.bottom}, back-to-top ${fabs.up.top}-${fabs.up.bottom}`);
        ok(`${path} there is a real gap between them`,
           !overlap && fabs.wa.top - fabs.up.bottom >= 6,
           `gap=${fabs.wa.top - fabs.up.bottom}px`);
        /* v1.13.0, the CEO: "WhatsApp button should same size as Arrow
           button size". Both read --elfia-fab, so this also catches the
           stacking offset drifting away from the height it stacks on. */
        const waH = fabs.wa.bottom - fabs.wa.top, upH = fabs.up.bottom - fabs.up.top;
        ok(`${path} the two floating buttons are the same size`,
           waH === upH && fabs.wa.right - fabs.wa.left === fabs.up.right - fabs.up.left,
           `whatsapp ${fabs.wa.right - fabs.wa.left}x${waH}, back-to-top ${fabs.up.right - fabs.up.left}x${upH}`);
        ok(`${path} they are right-aligned with each other`,
           fabs.wa.right === fabs.up.right, `${fabs.wa.right} vs ${fabs.up.right}`);
      }
      if (fabs.wa && fabs.tabTop !== null) {
        ok(`${path} the WhatsApp bubble clears the tab bar`,
           fabs.wa.bottom <= fabs.tabTop, `bubble ends ${fabs.wa.bottom}, bar starts ${fabs.tabTop}`);
      }
    }
  }
  await ctx.close();
}

await browser.close();
console.log(fail === 0
  ? `\nPASS - ${pass} checks: every rail starts at the gutter and the floating buttons are clear of each other.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
