/**
 * Design preview rig — serves out/ on :8100 and answers /api/v1/* with the
 * real LUMI001–LUMI010 catalogue shape, so the redesign can be looked at
 * without a Worker, a database or a Billplz key. Never deployed; nothing here
 * ever runs in production.
 *
 *   npx next build && node scratch/preview-server.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../out', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };

const P = (id, sku, shade, price, file, opts = {}) => ({
  id, sku, name: `Bawal Premium — ${shade}`, description: 'Lightweight, opaque and easy to style. Finished by hand in Malaysia.',
  price_cents: price * 100, stock: opts.stock ?? 20, image_key: `/collection/${file}`,
  active: 1, sort: id, category: opts.category ?? 'bawal', featured: opts.featured ?? 0, track_stock: 1,
});

const PRODUCTS = [
  P(1, 'LUMI001', 'Dusty Rose', 49, 'bawal-dusty-rose.jpg', { featured: 1, stock: 20 }),
  P(2, 'LUMI002', 'Periwinkle', 49, 'bawal-periwinkle.jpg', { stock: 21 }),
  P(3, 'LUMI003', 'Lavender', 49, 'bawal-lavender.jpg', { stock: 19 }),
  P(4, 'LUMI004', 'Silver Grey', 49, 'bawal-silver-grey.jpg', { stock: 4 }),
  P(5, 'LUMI005', 'Pastel Aurora', 49, 'bawal-aurora.jpg', { featured: 1, stock: 12 }),
  P(6, 'LUMI006', 'Dawn Blue', 49, 'bawal-dawn-blue.jpg', { stock: 0 }),
  P(7, 'LUMI007', 'Navy Gold', 59, 'bawal-navy-gold.jpg', { featured: 1, stock: 9 }),
  P(8, 'LUMI008', 'Midnight Gold', 59, 'bawal-midnight-gold.jpg', { stock: 7 }),
  P(9, 'LUMI009', 'Olive Floral', 59, 'bawal-olive-floral.jpg', { stock: 15 }),
  P(10, 'LUMI010', 'Mauve Floral', 59, 'bawal-mauve-floral.jpg', { featured: 1, stock: 6 }),
  P(11, 'SHWL001', 'Beige', 55, 'shawl-beige.jpg', { category: 'shawl', stock: 8 }),
  P(12, 'SHWL002', 'Taupe', 55, 'shawl-taupe.jpg', { category: 'shawl', stock: 5 }),
];

const CONFIG = {
  bank_line: 'Maybank 5644 XXXX XXXX — ELFIA ENTERPRISE',
  whatsapp_digits: '60123456789',
  shipping_cents: 800,
  free_above_cents: 15000,
  gateway: true,           // shows the Billplz FPX option
  hold_hours: 12,
};

const ORDER = {
  order_number: 'ELF-250826-4', status: 'pending_payment',
  customer_name: 'Nur Syazwani', phone: '012 345 6789',
  address: 'No 12, Jalan Melati 3, Taman Seri Indah, 81300 Skudai, Johor',
  items: [
    { name: 'Bawal Premium — Dusty Rose', qty: 2, price_cents: 4900 },
    { name: 'Bawal Premium — Navy Gold', qty: 1, price_cents: 5900 },
  ],
  subtotal_cents: 15700, shipping_cents: 0, total_cents: 15700,
  receipt_uploaded: false, tracking_no: null,
  events: [{ status: 'pending_payment', note: 'Order placed', created_at: '2026-08-25 09:12:00' }],
  expires_at: '2026-08-25 21:12:00',
  created_at: '2026-08-25 09:12:00',
  config: CONFIG,
};

const json = (res, body, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://localhost');
  const p = u.pathname;

  if (p === '/api/v1/products') return json(res, { products: PRODUCTS });
  if (p.startsWith('/api/v1/products/')) {
    const found = PRODUCTS.find((x) => String(x.id) === p.split('/').pop());
    return found ? json(res, { product: found }) : json(res, { error: { message: 'not found' } }, 404);
  }
  if (p === '/api/v1/store-config') return json(res, CONFIG);
  if (p.startsWith('/api/v1/orders/')) return json(res, ORDER);
  /* PREVIEW_SIGNED_IN=1 shows the dashboard instead of the sign-in form. */
  if (p === '/api/v1/auth/me') {
    if (!process.env.PREVIEW_SIGNED_IN) return json(res, { error: { message: 'signed out' } }, 401);
    return json(res, { customer: { id: 1, email: 'syazwani@example.com', name: 'Nur Syazwani', phone: '012 345 6789', address: 'No 12, Jalan Melati 3, Taman Seri Indah, 81300 Skudai, Johor', marketing: true } });
  }
  if (p === '/api/v1/auth/orders') {
    return json(res, { orders: [
      { order_number: 'ELF-250826-4', token: 'demo', status: 'pending_payment', total_cents: 15700, created_at: '2026-08-25 09:12:00', tracking_no: null },
      { order_number: 'ELF-230826-2', token: 'demo2', status: 'shipped', total_cents: 9800, created_at: '2026-08-23 14:02:00', tracking_no: 'JT0012938471' },
      { order_number: 'ELF-190826-7', token: 'demo3', status: 'completed', total_cents: 5900, created_at: '2026-08-19 11:31:00', tracking_no: 'JT0012811233' },
    ] });
  }
  if (p.startsWith('/api/')) return json(res, { ok: true });

  let file = path.join(ROOT, p === '/' ? '/index.html' : p);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
    else { res.writeHead(404); res.end('not found'); return; }
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8100, () => console.log('preview on http://localhost:8100'));
