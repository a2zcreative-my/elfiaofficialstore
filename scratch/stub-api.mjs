/**
 * A stand-in for the Worker's read-only endpoints, on :8787 (v1.12.2).
 *
 * The layout rigs (overflow-check, rail-check) only need the shop to LOOK
 * like the live one: 22 products across two collections, a portal carousel
 * with framing, and a store-config with a real WhatsApp number so the bubble
 * is drawn. Standing up wrangler + D1 + R2 to measure a padding bug is a lot
 * of machinery for a number the browser can report on its own.
 *
 * It answers exactly three routes and nothing that writes. serve-local.mjs
 * proxies /api/* here, so a browser sees one origin, as it does live.
 *
 *   node scratch/stub-api.mjs &
 *   node scratch/serve-local.mjs &
 *   node scratch/rail-check.mjs
 *
 * LOCAL ONLY. Never deployed, never imported by the site.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const PUB = new URL("../public", import.meta.url).pathname;

const BAWAL = [
  "LUMI LILAC", "LUMI AURORA", "LUMI DAWN", "LUMI MAUVE", "LUMI OLIVE",
  "LUMI NAVY", "LUMI PERIWINKLE", "LUMI SILVER", "LUMI MIDNIGHT", "LUMI ROSE",
];
const SHAWL = [
  "DARK BROWN", "SOFT PINK", "ASH GREY", "BEIGE", "TAUPE", "CHARCOAL",
  "SAGE", "CARAMEL", "PLUM", "IVORY", "DENIM", "TERRACOTTA",
];
const SHOT = (i) => [
  "bawal-lavender.jpg", "bawal-aurora.jpg", "bawal-dawn-blue.jpg", "bawal-mauve-floral.jpg",
  "bawal-olive-floral.jpg", "bawal-navy-gold.jpg", "bawal-periwinkle.jpg", "bawal-silver-grey.jpg",
  "bawal-midnight-gold.jpg", "bawal-dusty-rose.jpg", "shawl-beige.jpg", "shawl-taupe.jpg",
][i % 12];

const products = [
  ...BAWAL.map((shade, i) => ({
    id: 100 + i,
    name: `Bawal Premium — ${shade}`,
    description: "Lightweight, opaque, holds its shape all day.",
    price_cents: 3300,
    compare_price_cents: 3600,
    stock: 12,
    image_key: `/collection/${SHOT(i)}`,
    active: 1, sort: i,
    sku: `LUMI${String(i + 1).padStart(3, "0")}`,
    category: "bawal",
    featured: i < 2 ? 1 : 0,
    track_stock: 1,
  })),
  ...SHAWL.map((shade, i) => ({
    id: 200 + i,
    name: `Shawl Premium — ${shade}`,
    description: "Long-cut, lightweight and opaque.",
    price_cents: 1050,
    stock: i === 0 ? 5 : 20,
    image_key: `/collection/${SHOT(i + 10)}`,
    active: 1, sort: i,
    sku: `ELFIA${String(i + 1).padStart(3, "0")}`,
    category: "shawl",
    featured: i === 3 ? 1 : 0,
    track_stock: 1,
  })),
];

/* One portal slide, framed the way the CEO's live carousel is: zoomed past
   100% so it fills, focus a little above centre. */
const slides = [{
  id: 1,
  image_key: "/collection/campaign-studio.jpg",
  title: "Shawl Collection Studio",
  subtitle: "First Sight, Forever Yours",
  focus_x: 50, focus_y: 42, fit: "cover", zoom: 150,
  cutout_key: null, cutout_side: "right", cutout_scale: 118,
}];

const json = (res, body) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
};

http.createServer((req, res) => {
  const u = new URL(req.url, "http://localhost");
  if (u.pathname === "/api/v1/products") return json(res, { products, slides });
  /* v1.33.0 — one product, so the PRODUCT PAGE can be driven by a rig too
     (hover-backdrop-check). The real worker answers the same shape. */
  const one = u.pathname.match(/^\/api\/v1\/products\/(\d+)$/);
  if (one) {
    const p = products.find((x) => String(x.id) === one[1]);
    if (p) return json(res, { product: p, ...p });
    res.writeHead(404, { "content-type": "application/json" });
    return res.end('{"error":{"code":"not_found"}}');
  }
  /* v1.33.0 — the hover backdrop's stable URL. The real worker serves the
     portal's upload here and falls back to this same shipped file. */
  if (u.pathname === "/api/v1/tile-backdrop") {
    const file = path.join(PUB, "collection", "elfia-backdrop.jpg");
    if (fs.existsSync(file)) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(fs.readFileSync(file));
    }
  }
  if (u.pathname === "/api/v1/store-config") {
    return json(res, {
      bank_line: "1234 5678 9012 - Test Payee (fixture)",
      whatsapp_digits: "60123456789",
      shipping_cents: 800,
      free_above_cents: 15000,
      gateway: false,
      hold_hours: 24,
    });
  }
  if (u.pathname.startsWith("/api/v1/media/")) {
    const file = path.join(PUB, "collection", path.basename(u.pathname));
    if (fs.existsSync(file)) {
      res.writeHead(200, { "content-type": "image/jpeg" });
      return res.end(fs.readFileSync(file));
    }
  }
  res.writeHead(404, { "content-type": "application/json" });
  res.end('{"error":"stub-api serves products, store-config and media only"}');
}).listen(8787, () => console.log("stub-api on 8787"));
