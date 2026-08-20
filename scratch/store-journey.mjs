/**
 * Browser journey — drives a REAL purchase through a REAL worker in Chromium:
 * home → scroll-up button → product → add to cart → cart totals and the
 * free-delivery bar → checkout → the order page with its progress timeline →
 * finding that order again at /track → the cart empties → it appears in /admin.
 *
 * Setup (three terminals, from the project root):
 *   1. cd worker && npx wrangler d1 migrations apply elfia-store --local --config wrangler.e2e.toml
 *      echo 'ADMIN_KEY = "test-passcode-123"' > .dev.vars
 *      npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   2. npx next build && node scratch/serve-local.mjs
 *   3. npm i -D playwright && node scratch/store-journey.mjs
 * Screenshots land in /tmp/elfia-journey-*.png. LOCAL ONLY — it places orders.
 */
import pw from 'playwright';
const { chromium } = pw;
const B = 'http://127.0.0.1:8100';
const b = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const pg = await b.newPage({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
  // The Worker rate-limits /orders/lookup by CF-Connecting-IP. Behind
  // Cloudflare that header is always real; locally we set one so this run is
  // independent of whatever the API suite has been doing.
  extraHTTPHeaders: { 'CF-Connecting-IP': '198.51.100.7' },
});
const log = [];
const step = async (label, fn, shot) => {
  try { await fn(); log.push(`✓ ${label}`); }
  catch (e) { log.push(`✗ ${label} — ${e.message.split('\n')[0]}`); }
  if (shot) await pg.screenshot({ path: `/tmp/elfia-journey-${shot}.png`, fullPage: true });
};

await step('home loads with the catalogue', async () => {
  await pg.goto(`${B}/`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('[data-testid="product-grid"] a', { timeout: 10000 });
  const n = await pg.locator('[data-testid="product-grid"] a').count();
  if (n !== 10) throw new Error(`expected 10 cards, got ${n}`);
  const soldOut = await pg.getByText('Sold out').count();
  if (soldOut !== 0) throw new Error(`${soldOut} cards still read Sold out`);
});

await step('scroll-up button appears after scrolling', async () => {
  await pg.evaluate(() => window.scrollTo(0, 1400));
  const btn = pg.getByLabel('Back to top');
  if (!(await btn.isVisible())) throw new Error('not visible');
  let op = '0';                                   // wait out the fade-in
  for (let i = 0; i < 30 && op !== '1'; i++) {
    op = await btn.evaluate((el) => getComputedStyle(el).opacity);
    if (op !== '1') await pg.waitForTimeout(150);
  }
  if (op !== '1') throw new Error(`opacity ${op}`);
}, 'scrolltop');

await step('scroll-up button returns to the top', async () => {
  await pg.getByLabel('Back to top').click();
  await pg.waitForTimeout(900);
  const y = await pg.evaluate(() => window.scrollY);
  if (y > 10) throw new Error(`scrollY ${y}`);
});

await step('open a product and add it to the cart', async () => {
  await pg.locator('[data-testid="product-grid"] a').first().click();
  await pg.waitForSelector('button:has-text("Add to cart")', { timeout: 10000 });
  await pg.getByRole('button', { name: 'Increase quantity' }).click();
  await pg.getByRole('button', { name: 'Add to cart' }).click();
  await pg.waitForTimeout(400);
}, 'product');

await step('cart shows the line, the total and the free-delivery bar', async () => {
  await pg.goto(`${B}/cart`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('text=Subtotal', { timeout: 10000 });
  const body = await pg.textContent('body');
  if (!/RM\s?98\.00/.test(body)) throw new Error('expected RM 98.00 subtotal for 2 x RM 49');
  if (!/more for free delivery/.test(body)) throw new Error('no free-delivery bar');
}, 'cart');

await step('checkout places a real order', async () => {
  await pg.getByRole('link', { name: 'Checkout' }).click();
  await pg.waitForSelector('text=Delivery details', { timeout: 10000 });
  await pg.locator('input').nth(1).fill('Nurul Journey');       // 0 = honeypot
  await pg.locator('input').nth(2).fill('0123456789');
  await pg.locator('textarea').fill('88 Jalan Bunga Raya, 43000 Kajang, Selangor');
  await pg.getByRole('button', { name: 'Place order' }).click();
  await pg.waitForURL(/\/order\?t=/, { timeout: 15000 });
});

await step('the order page shows the bank details and the right total', async () => {
  await pg.waitForSelector('text=How to pay', { timeout: 10000 });
  const body = await pg.textContent('body');
  if (!/ELF-\d{6}-\d+/.test(body)) throw new Error('no order number');
  if (!/MAYBANK/.test(body)) throw new Error('no bank line');
  if (!/RM\s?108\.00/.test(body)) throw new Error('expected RM 108.00 total (RM 98 + RM 10 delivery)');
  if (!/Order placed/.test(body)) throw new Error('no status timeline');
}, 'order');

let orderNo = null;
await step('the order number is shown, and the progress timeline with it', async () => {
  // Read it from its own heading: textContent('body') runs elements together,
  // so "ELF-200826-28" followed by the step badge "1" reads as "…-281".
  orderNo = (await pg.locator('h1').first().textContent())?.trim() ?? '';
  if (!/^ELF-\d{6}-\d+$/.test(orderNo)) throw new Error(`no order number on the page (got ${JSON.stringify(orderNo)})`);
  const body = await pg.textContent('body');
  if (!/Order placed/.test(body)) throw new Error('no "Order placed" step');
  if (!/Pay and upload your receipt/.test(body)) throw new Error('no next-step hint');
});

await step('a customer who lost the link finds it again at /track', async () => {
  await pg.goto(`${B}/track`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('text=Track my order', { timeout: 10000 });
  await pg.locator('input').first().fill(orderNo);
  await pg.locator('input').nth(1).fill('0123456789');
  await pg.getByRole('button', { name: 'Find my order' }).click();
  await pg.waitForURL(/\/order\?t=/, { timeout: 15000 });
  await pg.waitForSelector('text=How to pay', { timeout: 10000 });   // wait for the order to load
  const landed = (await pg.locator('h1').first().textContent())?.trim();
  if (landed !== orderNo) throw new Error(`landed on ${landed}, expected ${orderNo}`);
}, 'track');

await step('a wrong phone number does not open someone else\'s order', async () => {
  await pg.goto(`${B}/track`, { waitUntil: 'networkidle' });
  await pg.locator('input').first().fill(orderNo);
  await pg.locator('input').nth(1).fill('0198887777');
  await pg.getByRole('button', { name: 'Find my order' }).click();
  await pg.waitForSelector('text=could not find that order', { timeout: 10000 });
  if (/\/order\?t=/.test(pg.url())) throw new Error('it let us in!');
});

await step('the cart is empty after ordering', async () => {
  await pg.goto(`${B}/cart`, { waitUntil: 'networkidle' });
  await pg.waitForSelector('text=Nothing here yet', { timeout: 10000 });
});

await step('admin can see the new order', async () => {
  await pg.goto(`${B}/admin`, { waitUntil: 'networkidle' });
  await pg.locator('input[type="password"]').fill('test-passcode-123');
  await pg.getByRole('button', { name: 'Enter' }).click();
  await pg.waitForSelector('text=Nurul Journey', { timeout: 10000 });
}, 'admin');

await b.close();
console.log(log.join('\n'));
console.log(log.some((l) => l.startsWith('✗')) ? '\nFAILURES' : '\nALL PASS');
