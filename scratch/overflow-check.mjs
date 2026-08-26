/**
 * Horizontal-overflow guard (v1.10.1).
 *
 * The CEO, 25-08-2026: "Mobile view apps why looks like this? Seem like
 * offset!!! Check on the webpage also to ensure no outspec!!!!"
 *
 * A phone page that scrolls sideways looks broken in a way no screenshot
 * review reliably catches: everything is a few pixels off and the eye reads
 * it as "shifted". So this measures instead of judging — for every page, at
 * phone and desktop widths, it compares the document's scrollWidth with its
 * clientWidth and NAMES the elements sticking out past the right edge.
 *
 * Run (site built and served — scratch/serve-local.mjs on :8100):
 *   node scratch/overflow-check.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.SITE ?? "http://127.0.0.1:8100";
const PAGES = ["/", "/shop", "/categories", "/catalog", "/wishlist", "/cart", "/track"];
const SIZES = [
  { name: "iPhone SE", width: 320, height: 700, mobile: true },
  { name: "iPhone 12", width: 390, height: 844, mobile: true },
  { name: "iPhone Max", width: 430, height: 900, mobile: true },
  { name: "tablet", width: 768, height: 1024, mobile: false },
  { name: "desktop", width: 1280, height: 900, mobile: false },
];

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const size of SIZES) {
  console.log(`\n${size.name} (${size.width}px)`);
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.mobile,
    deviceScaleFactor: size.mobile ? 3 : 1,
  });
  const page = await ctx.newPage();

  for (const path of PAGES) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" }).catch(() => {});
    await page.waitForTimeout(900);

    const report = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;
      /* An element is "out of spec" when its painted box crosses the right
         edge of the viewport AND nothing above it clips the overflow. A
         horizontal rail that scrolls on purpose (overflow-x: auto) is fine:
         it clips its own children, so the PAGE never scrolls. */
      const clipped = (el) => {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const ov = getComputedStyle(n).overflowX;
          if (ov === "hidden" || ov === "auto" || ov === "scroll") return true;
        }
        return false;
      };
      const offenders = [];
      for (const el of document.querySelectorAll("body *")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const over = Math.round(r.right - vw);
        const under = Math.round(-r.left);
        if ((over > 1 || under > 1) && !clipped(el)) {
          offenders.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.getAttribute("class") ?? "").slice(0, 70),
            text: (el.textContent ?? "").trim().slice(0, 30),
            over, under,
          });
        }
      }
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: vw,
        bodyScroll: document.body.scrollWidth,
        offenders: offenders.slice(0, 6),
      };
    });

    const slop = report.scrollWidth - report.clientWidth;
    ok(`${path} does not scroll sideways`, slop <= 1,
       `${slop}px past the edge · ${JSON.stringify(report.offenders)}`);
  }
  await ctx.close();
}

await browser.close();
console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
