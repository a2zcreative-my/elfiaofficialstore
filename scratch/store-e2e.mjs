/* ELFIA store smoke — full purchase loop on the BUILT static output with a
   mocked API: catalogue renders products → product page → add to cart ×2 →
   cart totals (incl. free-shipping rule) → checkout POSTs ids+qty ONLY (no
   prices from the browser) → lands on the order page → bank details +
   WhatsApp shown. Then admin: login, see the order, confirm payment. */
import { chromium } from 'playwright-core';

const PRODUCTS = [
  { id: 1, name: 'Bawal Premium — Dusty Rose', description: 'Soft premium bawal.', price_cents: 4900, stock: 10, image_key: '/collection/shawl-beige.jpg', active: 1, sort: 1, sku: 'LUMI001', category: 'bawal', featured: 1 },
  { id: 2, name: 'Bawal Premium — Emerald', description: null, price_cents: 4900, stock: 3, image_key: null, active: 1, sort: 2, sku: 'LUMI002', category: 'bawal', featured: 0 },
  { id: 9, name: 'Shawl — Grey', description: null, price_cents: 5900, stock: 8, image_key: '/collection/shawl-grey-front.jpg', active: 1, sort: 9, sku: null, category: 'shawl', featured: 0 },
];
const CONFIG = { bank_line: 'MAYBANK 1111 2222 3333 — ELFIA', whatsapp_digits: '60111222333', shipping_cents: 1000, free_above_cents: 15000, gateway: true };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await (await b.newContext({ viewport: { width: 1280, height: 950 } })).newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));

let orderPost = null;
const ORDER = {
  order_number: 'ELF-190826-1', status: 'pending_payment',
  customer_name: 'Aina', phone: '0123456789', address: '1 Jalan Test, JB',
  items: [ { name: PRODUCTS[0].name, qty: 2, price_cents: 4900 }, { name: PRODUCTS[1].name, qty: 1, price_cents: 4900 } ],
  subtotal_cents: 14700, shipping_cents: 1000, total_cents: 15700,
  receipt_uploaded: false, tracking_no: null, created_at: '2026-08-19 15:00:00', config: CONFIG,
};

await page.route('**/api/v1/**', async (route) => {
  const req = route.request();
  const u = new URL(req.url()).pathname;
  const reply = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (u.endsWith('/products') && req.method() === 'GET') return reply({ products: PRODUCTS });
  if (/\/products\/1$/.test(u)) return reply({ product: PRODUCTS[0] });
  if (/\/products\/2$/.test(u)) return reply({ product: PRODUCTS[1] });
  if (u.endsWith('/store-config')) return reply(CONFIG);
  if (u.endsWith('/orders') && req.method() === 'POST') {
    orderPost = JSON.parse(req.postData() ?? '{}');
    return reply({ token: 'a'.repeat(32), order_number: ORDER.order_number }, 201);
  }
  if (/\/orders\/a{32}$/.test(u)) return reply(ORDER);
  if (u.includes('/admin/orders') && req.method() === 'GET') {
    return reply({ orders: [{ id: 7, ...ORDER, items: JSON.stringify(ORDER.items), receipt_key: 'receipts/x.jpg', payment_method: null, admin_notes: null }] });
  }
  if (u.includes('/admin/products')) return reply({ products: PRODUCTS });
  if (/\/admin\/orders\/7$/.test(u) && req.method() === 'PUT') {
    ORDER.status = 'paid';
    return reply({ ok: true, status: 'paid' });
  }
  return reply({}, 200);
});

// 1. catalogue + carousel + collection tabs
await page.goto('http://localhost:8932/index.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
const catalogueShows = await page.locator('text=Dusty Rose').count() > 0;
const lowStockBadge = /3 left/i.test(await page.evaluate(() => document.body.innerText));
// carousel: brand slides + the featured product slide, and it AUTO-advances
const dots = await page.locator('button[aria-label^="Slide"]').count();      // 3 brand + 1 featured = 4
const slide1Title = await page.locator('text=The Bawal Collection').count() > 0;
const before = await page.evaluate(() => {
  const track = document.querySelector('.flex.transition-transform');
  return track ? track.style.transform : '';
});
await page.waitForTimeout(5200); // > 4.5s auto-advance interval
const after = await page.evaluate(() => {
  const track = document.querySelector('.flex.transition-transform');
  return track ? track.style.transform : '';
});
const autoSlides = before !== after;
// tabs: Shawl shows only the shawl, Bawal hides it
await page.locator('[data-testid="category-tabs"] button', { hasText: 'Shawl' }).click();
await page.waitForTimeout(300);
const cards = (t) => page.locator('[data-testid="product-grid"] a', { hasText: t }).count();
const shawlTabOk = (await cards('Shawl — Grey')) > 0 && (await cards('Dusty Rose')) === 0;
await page.locator('[data-testid="category-tabs"] button', { hasText: 'Bawal' }).click();
await page.waitForTimeout(300);
const bawalTabOk = (await cards('LUMI001')) > 0 && (await cards('Shawl — Grey')) === 0;
await page.locator('[data-testid="category-tabs"] button', { hasText: 'All' }).click();
await page.waitForTimeout(300);

// 2. product page → add 2
await page.goto('http://localhost:8932/p.html?id=1', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.locator('button', { hasText: '+' }).first().click();
await page.locator('button', { hasText: 'Add to cart' }).click();
await page.waitForTimeout(300);
// add product 2 as well
await page.goto('http://localhost:8932/p.html?id=2', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.locator('button', { hasText: 'Add to cart' }).click();
await page.waitForTimeout(300);

// 3. cart
await page.goto('http://localhost:8932/cart.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
const cartText = await page.evaluate(() => document.body.innerText);
const subtotalOk = /RM\s?147\.00/.test(cartText);
const shippingOk = /RM\s?10\.00/.test(cartText);
const totalOk = /RM\s?157\.00/.test(cartText);

// 4. checkout
await page.locator('a', { hasText: 'Checkout' }).click();
await page.waitForTimeout(1200);
const inputs = page.locator('input.h-11, textarea');
await page.locator('input').nth(1).fill('Aina');           // after honeypot
await page.locator('input').nth(2).fill('0123456789');
await page.locator('textarea').first().fill('1 Jalan Test, JB');
await page.locator('button', { hasText: 'Place order' }).click();
await page.waitForTimeout(1500);

const postedIdsOnly = orderPost && Array.isArray(orderPost.items)
  && orderPost.items.every((i) => 'id' in i && 'qty' in i && !('price_cents' in i));
const onOrderPage = page.url().includes('/order');
const orderText = await page.evaluate(() => document.body.innerText);
const bankShown = orderText.includes(CONFIG.bank_line);
const waShown = await page.locator('a[href*="wa.me/60111222333"]').count() > 0;
const cartCleared = await page.evaluate(() => JSON.parse(localStorage.getItem('elfia-cart') ?? '[]').length === 0);

// Billplz: the pay-online button is there when gateway:true, and one click
// POSTs /pay then navigates to the returned Billplz URL
let payPosted = false;
await page.route('**/pay', (route) => { payPosted = true; route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: 'http://localhost:8932/policies.html' }) }); });
const payBtn = page.locator('button', { hasText: 'Pay online now' });
const payBtnShown = (await payBtn.count()) === 1 && /RM\s?157\.00/.test(await payBtn.innerText());
await payBtn.click();
await page.waitForTimeout(1200);
const redirectedToGateway = page.url().includes('/policies');

// logo present in the header (v0.4.0)
const logoShown = (await page.locator('header img[alt="ELFIA"]').count()) === 1;

// 5. admin: login, confirm payment
await page.goto('http://localhost:8932/admin.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await page.locator('input[type="password"]').fill('test-key');
await page.locator('button', { hasText: 'Enter' }).click();
await page.waitForTimeout(1200);
const adminSeesOrder = (await page.locator('text=ELF-190826-1').count()) > 0;
await page.locator('button', { hasText: 'ELF-190826-1' }).click();
await page.waitForTimeout(400);
const hasConfirm = (await page.locator('button', { hasText: 'Confirm payment' }).count()) > 0;
await page.locator('button', { hasText: 'Confirm payment' }).click();
await page.waitForTimeout(800);
const nowPaid = /paid/.test(await page.evaluate(() => document.body.innerText));

// 6. admin: stock sync button reports by SKU
await page.route('**/admin/sync-stock', (route) => route.fulfill({ status: 200, contentType: 'application/json',
  body: JSON.stringify({ updated: [{ sku: 'LUMI001', from: 10, to: 7 }], unchanged: 2, unmatched_portal: ['ELFIA009'], unmatched_store: [] }) }));
await page.locator('button', { hasText: 'products' }).click();
await page.waitForTimeout(400);
const syncBtn = page.locator('button', { hasText: 'Sync stock from portal' });
const syncBtnShown = (await syncBtn.count()) === 1;
await syncBtn.click();
await page.waitForTimeout(800);
const syncText = await page.evaluate(() => document.body.innerText);
const syncReported = /LUMI001 10→7/.test(syncText) && /ELFIA009/.test(syncText);

const report = { catalogueShows, lowStockBadge, logoShown, syncBtnShown, syncReported, carouselDots: dots === 4, slide1Title, autoSlides, shawlTabOk, bawalTabOk, payBtnShown, payPosted, redirectedToGateway, subtotalOk, shippingOk, totalOk, postedIdsOnly, onOrderPage, bankShown, waShown, cartCleared, adminSeesOrder, hasConfirm, nowPaid, pageErrors: errs.slice(0, 3) };
console.log(JSON.stringify(report, null, 1));
const pass = Object.entries(report).every(([k, v]) => k === 'pageErrors' ? v.length === 0 : v === true);
console.log(pass ? 'PASS' : 'FAIL');
await b.close();
process.exit(pass ? 0 : 1);
