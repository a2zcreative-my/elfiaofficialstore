/**
 * A stand-in for the A2Z portal's bridge, implementing PORTAL-BRIDGE-SPEC.md
 * exactly — including the idempotency rule. Used by scratch/store-sync-test.mjs
 * to prove the two-way inventory sync without touching the real portal.
 *
 *   node scratch/fake-portal.mjs            (listens on :8200)
 *
 * Endpoints (per the spec):
 *   GET  /bridge/elfia-inventory   -> { items: [{ sku, name, stock, price_cents?,
 *                                       category?, image_url?, image_updated_at? }] }
 *   POST /bridge/elfia-movements   -> { applied, ignored, unknown_sku }
 *   GET  /media/<file>             -> a product photo, PUBLIC (v1.5.0 — the
 *                                     spec requires an unauthenticated URL)
 * Test controls (NOT part of the spec):
 *   GET  /_state                   -> counts, prices, applied event ids
 *   POST /_set   { sku, stock }    -> force a count
 *   POST /_price { sku, price_cents } -> set a price (null clears it, so the
 *                                        feed omits the field for that SKU)
 *   POST /_down  { down: true }    -> pretend the portal is unreachable
 *   POST /_add   { sku, name, category, price_cents, stock, photo }
 *                                  -> a product the STORE has never had, which
 *                                     is the shawl case (v1.5.0)
 *   POST /_photo { sku, photo, marker }
 *                                  -> attach/replace a photo. `photo` is one of
 *                                     "png" | "html" | "huge" | null, so the
 *                                     store's refusals can be tested too.
 */
import http from "node:http";

const KEY = process.env.BRIDGE_KEY ?? "shared-bridge-secret";
/* Keys are stored normalized; the FEED serves them with a space ("LUMI 001"),
   exactly the way the real portal spells them (the CEO's screenshots show
   "SKU: LUMI 004"). The store must match them anyway — v1.1.2's fix. */
const norm = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, "");
const spaced = (sku) => sku.replace(/^([A-Z]+)(\d+)$/, "$1 $2");
const stock = new Map([
  ["LUMI001", 24], ["LUMI002", 12], ["LUMI003", 8], ["LUMI004", 30], ["LUMI005", 15],
  ["LUMI006", 6], ["LUMI007", 9], ["LUMI008", 11], ["LUMI009", 4], ["LUMI010", 7],
]);
const applied = new Set();   // event ids already counted — the dedupe store
const prices = new Map();    // sku -> price_cents; absent = feed omits the field
let down = false;
let downOnly = null;   // null = everything is down; "movements" = writes only

/* v1.5.0 — per-SKU metadata the feed may carry: a real name, a collection and
   a photo. `meta` only holds what a test has set; everything absent falls back
   to the old behaviour, so the pre-v1.5.0 assertions are untouched. */
const meta = new Map();      // sku -> { name?, category?, photo?, marker?, description?, discount? }
/* v1.7.0 — the carousel. Test control _slide sets the whole list. */
let slidesList = [];         // [{ id, photo, marker, title?, subtitle?, sort? }]
/* v1.13.0 — what delivery costs, set in the portal. `undefined` models a
   portal older than its 0052 that sends no `settings` key at all, which the
   store must read as "keep your own numbers". */
let settings;                // undefined | { shipping_cents?, free_above_cents? }

/* A genuine 1x1 PNG — the store checks the Content-Type and the byte length,
   so the bytes have to be real. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const HUGE = Buffer.alloc(6 * 1024 * 1024, 7);   // 6 MB — over the store's 5 MB cap

const body = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
};
const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/_state") {
    return send(res, 200, { stock: Object.fromEntries(stock), prices: Object.fromEntries(prices), applied: [...applied], down });
  }
  if (url.pathname === "/_price") {
    const b = await body(req);
    const sku = norm(b.sku);
    if (b.price_cents === null) prices.delete(sku); else prices.set(sku, Number(b.price_cents));
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_set") {
    const b = await body(req); stock.set(norm(b.sku), Number(b.stock));
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_down") {
    /* v1.8.0 — `only: "movements"` models the state that actually bit the
       CEO: the portal is perfectly readable, but it will not accept our
       sales. That is the only way to watch a pull run while a sale is
       genuinely still in flight. */
    const b = await body(req); down = Boolean(b.down);
    downOnly = down && b.only === "movements" ? "movements" : null;
    return send(res, 200, { down, downOnly });
  }
  if (url.pathname === "/_add") {
    const b = await body(req);
    const sku = norm(b.sku);
    stock.set(sku, Number(b.stock ?? 0));
    if (b.price_cents !== undefined && b.price_cents !== null) prices.set(sku, Number(b.price_cents));
    meta.set(sku, {
      ...(b.name !== undefined ? { name: b.name } : {}),
      ...(b.category ? { category: b.category } : {}),
      ...(b.photo ? { photo: b.photo, marker: b.marker ?? `m-${Date.now()}` } : {}),
    });
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_photo") {
    const b = await body(req);
    const sku = norm(b.sku);
    const m = meta.get(sku) ?? {};
    if (b.photo === null) { delete m.photo; delete m.marker; }
    else { m.photo = b.photo; m.marker = b.marker ?? `m-${Date.now()}`; }
    meta.set(sku, m);
    return send(res, 200, { ok: true, marker: m.marker ?? null });
  }
  if (url.pathname === "/_settings") {
    const b = await body(req);
    settings = b.settings === null ? undefined : b.settings;
    return send(res, 200, { ok: true, settings: settings ?? null });
  }
  if (url.pathname === "/_slides") {
    const b = await body(req);
    slidesList = Array.isArray(b.slides) ? b.slides : [];
    return send(res, 200, { ok: true, n: slidesList.length });
  }
  if (url.pathname === "/_discount") {
    const b = await body(req);
    const m = meta.get(norm(b.sku)) ?? {};
    if (b.discount_cents == null) delete m.discount; else m.discount = Number(b.discount_cents);
    meta.set(norm(b.sku), m);
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_remove") {
    const b = await body(req);
    const sku = norm(b.sku);
    stock.delete(sku); prices.delete(sku); meta.delete(sku);
    return send(res, 200, { ok: true });
  }

  /* PUBLIC by contract — the spec says the store's Worker must be able to
     fetch a photo without a session, so this route sits ABOVE the key check.
     The filename decides what is served, which is how the store's refusals
     (wrong type, too large) get exercised. */
  const media = url.pathname.match(/^\/media\/([\w.-]+)$/);
  if (media && req.method === "GET") {
    const kind = media[1].split(".")[0];
    if (kind === "html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<h1>not a photo</h1>"); }
    if (kind === "huge") { res.writeHead(200, { "content-type": "image/png", "content-length": HUGE.length }); return res.end(HUGE); }
    if (kind === "missing") { res.writeHead(404); return res.end("gone"); }
    res.writeHead(200, { "content-type": "image/png", "content-length": PNG_1PX.length });
    return res.end(PNG_1PX);
  }

  if (down && (downOnly === null || url.pathname.endsWith("/elfia-movements"))) {
    res.writeHead(503); return res.end("portal down");
  }
  if (req.headers["x-bridge-key"] !== KEY) return send(res, 401, { error: "bad key" });

  if (url.pathname === "/bridge/elfia-inventory" && req.method === "GET") {
    return send(res, 200, {
      items: [...stock].map(([sku, s]) => {
        const m = meta.get(sku) ?? {};
        return {
          sku: spaced(sku),
          /* A test may set name to null on purpose: a feed item with no name
             is not enough to create a product, and the store must say so
             rather than invent one. */
          ...("name" in m ? (m.name === null ? {} : { name: m.name }) : { name: `Portal ${spaced(sku)}` }),
          stock: s,
          ...(prices.has(sku) ? { price_cents: prices.get(sku) } : {}),
          ...(m.category ? { category: m.category } : {}),
          ...(m.photo ? {
            image_url: `http://127.0.0.1:8200/media/${m.photo}.png`,
            image_updated_at: m.marker,
          } : {}),
          /* v1.7.0 — a discount nets the price and sends the list alongside,
             exactly the way the real serializer does. */
          ...(m.discount > 0 && prices.has(sku) && m.discount < prices.get(sku)
            ? { price_cents: prices.get(sku) - m.discount, list_price_cents: prices.get(sku) }
            : {}),
        };
      }),
      /* v1.7.0 — the carousel. Always emitted (empty list included — that is
         how "portal removed every slide" is expressed). */
      slides: slidesList.map((sl, i) => ({
        id: sl.id ?? i + 1,
        image_url: `http://127.0.0.1:8200/media/${sl.photo}.png`,
        image_updated_at: sl.marker ?? "s1",
        ...(sl.title ? { title: sl.title } : {}),
        ...(sl.subtitle ? { subtitle: sl.subtitle } : {}),
        sort: sl.sort ?? (i + 1) * 10,
        /* v1.47.0 framing. The real portal ALWAYS sends these three (the
           serializer defaults them), so the rig does too — except when a
           test asks for the old shape by setting `noFraming`, which is how
           "a portal older than 0088" is expressed. */
        ...(sl.noFraming ? {} : {
          focus_x: sl.focus_x ?? 50,
          focus_y: sl.focus_y ?? 50,
          fit: sl.fit ?? "cover",
          /* v1.48.0 — zoom. `noZoom` models a portal older than its 0089. */
          ...(sl.noZoom ? {} : { zoom: sl.zoom ?? 100 }),
          /* v1.50.0 — the cut-out. Sent as a pair (URL + marker) or not at
             all, exactly as the real serializer does. */
          ...(sl.cutout ? {
            cutout_url: `http://127.0.0.1:8200/media/${sl.cutout}.png`,
            cutout_updated_at: sl.cutoutMarker ?? "c1",
            cutout_side: sl.cutoutSide ?? "right",
            cutout_scale: sl.cutoutScale ?? 118,
          } : {}),
        }),
      })),
      /* v1.13.0 — omitted entirely unless a test sets it, which is how a
         portal that does not own delivery pricing yet is expressed. */
      ...(settings ? { settings } : {}),
    });
  }

  if (url.pathname === "/bridge/elfia-movements" && req.method === "POST") {
    const b = await body(req);
    const out = { applied: [], ignored: [], unknown_sku: [] };
    for (const m of b.movements ?? []) {
      const sku = norm(m.sku);   // spec: case- AND whitespace-insensitive
      if (applied.has(m.event_id)) { out.ignored.push(m.event_id); continue; }  // THE RULE
      if (!stock.has(sku)) { out.unknown_sku.push(m.event_id); continue; }
      stock.set(sku, Math.max(0, stock.get(sku) + Number(m.delta)));
      applied.add(m.event_id);
      out.applied.push(m.event_id);
    }
    return send(res, 200, out);
  }

  res.writeHead(404); res.end("not found");
}).listen(8200, () => console.log("fake portal on :8200"));
