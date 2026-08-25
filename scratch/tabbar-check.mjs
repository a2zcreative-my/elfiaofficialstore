/**
 * v1.4.1 — proves the phone tab bar never covers the end of a page, including
 * on a notched iPhone where the bar grows by env(safe-area-inset-bottom).
 * Chromium cannot emulate that inset, so the notch case is simulated by
 * injecting the same 34px of padding the real device adds.
 *
 *   npx next build && node scratch/preview-server.mjs
 *   node scratch/tabbar-check.mjs
 */
import { chromium } from 'playwright';

const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PAGES = ['/', '/shop', '/categories', '/wishlist', '/cart', '/account', '/track', '/p?id=1', '/order?t=demo'];

let pass = 0;
const fail = [];
const ok = (cond, what) => { if (cond) pass += 1; else fail.push(what); };

const b = await chromium.launch({ executablePath: CHROME });

for (const notch of [0, 34]) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  for (const url of PAGES) {
    const pg = await ctx.newPage();
    await pg.addInitScript(() => {
      localStorage.setItem('elfia-cart', JSON.stringify([{ id: 1, qty: 2 }]));
      localStorage.setItem('elfia-wishlist', JSON.stringify([5, 10]));
    });
    await pg.goto('http://localhost:8100' + url, { waitUntil: 'networkidle' });
    if (notch) {
      await pg.addStyleTag({ content: `nav[aria-label="Main"]{padding-bottom:${notch}px !important}` });
    }
    await pg.waitForTimeout(400);

    const m = await pg.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]');
      const navBox = nav.getBoundingClientRect();
      const varPx = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--elfia-tabbar')) || 0;
      const wrap = document.querySelector('body > div.pb-tabbar');
      const pad = parseFloat(getComputedStyle(wrap).paddingBottom) || 0;
      // the lowest thing the page itself draws, ignoring fixed furniture
      const fixedish = [...document.querySelectorAll('nav[aria-label="Main"], a[aria-label*="WhatsApp"], button[aria-label="Back to top"]')];
      let lowest = 0;
      for (const el of wrap.querySelectorAll('*')) {
        if (fixedish.some((f) => f === el || f.contains(el))) continue;
        if (getComputedStyle(el).position === 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;
        lowest = Math.max(lowest, r.bottom + window.scrollY);
      }
      return { navH: navBox.height, varPx, pad, lowest, docH: document.documentElement.scrollHeight };
    });

    ok(Math.abs(m.varPx - m.navH) < 1.5, `${url} notch=${notch}: --elfia-tabbar ${m.varPx} != bar height ${m.navH}`);
    ok(m.pad >= m.navH, `${url} notch=${notch}: page clearance ${m.pad} < bar height ${m.navH}`);
    // scrolled to the very bottom, the last content must sit above the bar
    await pg.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await pg.waitForTimeout(250);
    const clear = await pg.evaluate(() => {
      const nav = document.querySelector('nav[aria-label="Main"]');
      const navTop = nav.getBoundingClientRect().top;
      const wrap = document.querySelector('body > div.pb-tabbar');
      let worst = -1e9;
      for (const el of wrap.querySelectorAll('*')) {
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed' || nav.contains(el)) continue;
        if (!el.textContent?.trim() && el.tagName !== 'IMG') continue;
        const r = el.getBoundingClientRect();
        if (r.height === 0 || r.width === 0) continue;
        worst = Math.max(worst, r.bottom - navTop);
      }
      return worst;
    });
    ok(clear <= 1, `${url} notch=${notch}: content overlaps the bar by ${clear.toFixed(1)}px`);
    await pg.close();
  }
  await ctx.close();
}

await b.close();
console.log(fail.length ? `FAIL (${pass} passed)\n - ${fail.join('\n - ')}` : `PASS — ${pass} assertions`);
process.exit(fail.length ? 1 : 0);
