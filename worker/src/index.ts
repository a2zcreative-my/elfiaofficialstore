/**
 * elfia-api — the Worker behind elfiaofficialstore.my/api/*
 *
 * The rules this file enforces, in order of importance:
 *
 *  1. PRICES AND STOCK ARE DECIDED HERE. The browser sends product IDs and
 *     quantities only; every order is priced from the database at the
 *     moment of purchase and the price snapshot is frozen into the order
 *     row. A tampered cart cannot buy below list.
 *  2. STOCK IS RESERVED ATOMICALLY. Each line decrements with
 *     `stock = stock - qty WHERE stock >= qty`; if any line misses, the
 *     lines that did decrement are compensated back and the order fails
 *     with a message naming the product. Two buyers cannot share the last
 *     piece.
 *  3. MONEY STATES MOVE FORWARD ONLY. pending_payment → payment_review →
 *     paid → shipped → completed, plus cancelled. A paid order cannot be
 *     cancelled here (refund is a human decision, made on WhatsApp, then
 *     recorded); an unpaid cancel restocks automatically.
 *  4. The order TOKEN is the customer's only key: 32 hex chars from
 *     crypto.randomUUID, unguessable, never enumerable (no order listing
 *     without the admin key).
 *
 * Stage B (Billplz FPX — the CEO's chosen gateway) lives in billplz.ts and
 * stays inert until both secrets exist — see that file's header.
 */
import { billplzConfigured, billplzCreateBill, billplzVerifyPaid } from "./billplz";

export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ADMIN_KEY?: string;        // wrangler secret put ADMIN_KEY
  BANK_LINE?: string;        // wrangler.toml var — "MAYBANK 1234 5678 9012 — ELFIA"
  WHATSAPP_DIGITS?: string;  // wrangler.toml var — "60123456789"
  SHIPPING_CENTS?: string;   // wrangler.toml var — flat rate, e.g. "1000"
  FREE_ABOVE_CENTS?: string; // wrangler.toml var — free delivery threshold
  BILLPLZ_SECRET?: string;     // Stage B — wrangler secret put (API Secret Key)
  BILLPLZ_COLLECTION?: string; // Stage B — wrangler secret put (Collection ID)
  BILLPLZ_SANDBOX?: string;    // wrangler.toml var — "1" = sandbox account
  /** v0.4.0 — stock sync from the agency portal that runs ELFIA's live
      sessions. BRIDGE_URL is a wrangler.toml var (the portal's bridge
      endpoint, pasted at setup so no other company's domain lives in this
      repo); BRIDGE_KEY is a secret, same value as the portal side. Both
      unset = the Sync button reports "not configured" and nothing else. */
  BRIDGE_URL?: string;
  BRIDGE_KEY?: string;
  STORE_ORIGIN?: string;     // override for local testing
}

const VERSION = "0.4.0";
const STATUSES = ["pending_payment", "payment_review", "paid", "shipped", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

const ALLOWED_ORIGINS = new Set([
  "https://elfiaofficialstore.my",
  "https://www.elfiaofficialstore.my",
  "http://localhost:3000",
]);

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
const err = (code: string, message: string, status: number): Response => json({ error: { code, message } }, status);

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 && t.length <= max ? t : null;
};

const intVar = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : fallback;
};

async function keyOk(request: Request, env: Env): Promise<boolean> {
  const given = request.headers.get("X-Admin-Key");
  if (!given || !env.ADMIN_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(given)),
    crypto.subtle.digest("SHA-256", enc.encode(env.ADMIN_KEY)),
  ]);
  const va = new Uint8Array(a), vb = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= (va[i] ?? 0) ^ (vb[i] ?? 0);
  return diff === 0;
}

function storeConfig(env: Env) {
  return {
    bank_line: env.BANK_LINE ?? "REPLACE — set BANK_LINE in worker/wrangler.toml",
    whatsapp_digits: env.WHATSAPP_DIGITS ?? "60000000000",
    shipping_cents: intVar(env.SHIPPING_CENTS, 1000),
    free_above_cents: intVar(env.FREE_ABOVE_CENTS, 15000),
    gateway: billplzConfigured(env),
  };
}

/** ELF-DDMMYY-N — one counter row per Malaysian business day. */
async function orderNumber(env: Env): Promise<string> {
  const now = new Date(Date.now() + 8 * 3600 * 1000); // Malaysia UTC+8
  const day = now.toISOString().slice(0, 10).replace(/-/g, "");
  await env.DB.prepare(
    `INSERT INTO order_counters (day, counter) VALUES (?1, 1)
     ON CONFLICT(day) DO UPDATE SET counter = counter + 1`,
  ).bind(day).run();
  const row = await env.DB.prepare(`SELECT counter FROM order_counters WHERE day = ?1`)
    .bind(day).first<{ counter: number }>();
  return `ELF-${day.slice(6, 8)}${day.slice(4, 6)}${day.slice(2, 4)}-${row?.counter ?? 1}`;
}

interface OrderRow {
  id: number; order_number: string; token: string; customer_name: string; phone: string;
  address: string; email: string | null; notes: string | null; items: string;
  subtotal_cents: number; shipping_cents: number; total_cents: number; status: Status;
  receipt_key: string | null; payment_method: string | null; tracking_no: string | null;
  admin_notes: string | null; created_at: string; updated_at: string | null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method;

    /* ---------------- public ---------------- */

    if (path === "/health" && method === "GET") {
      let db = false, r2 = false;
      try { await env.DB.prepare("SELECT 1").first(); db = true; } catch { /* not yet */ }
      try { await env.MEDIA.head("health-probe"); r2 = true; } catch { /* not yet */ }
      const cfg = storeConfig(env);
      return json({
        ok: db, version: VERSION, db, r2,
        admin_key_configured: Boolean(env.ADMIN_KEY),
        bank_line_configured: !cfg.bank_line.startsWith("REPLACE"),
        gateway_configured: cfg.gateway,
        bridge_configured: Boolean(env.BRIDGE_URL && env.BRIDGE_KEY && !env.BRIDGE_URL.startsWith("REPLACE")),
      });
    }

    if (path === "/store-config" && method === "GET") return json(storeConfig(env));

    if (path === "/products" && method === "GET") {
      /* v0.2.0 columns (sku/category/featured) with a pre-0002 fallback, so
         a worker deployed ahead of its migration degrades instead of 500s. */
      let results: Record<string, unknown>[];
      try {
        results = (await env.DB.prepare(
          `SELECT id, name, description, price_cents, stock, image_key, active, sort, sku, category, featured
           FROM products WHERE active = 1 ORDER BY sort, id DESC LIMIT 200`,
        ).all()).results;
      } catch {
        results = (await env.DB.prepare(
          `SELECT id, name, description, price_cents, stock, image_key, active, sort
           FROM products WHERE active = 1 ORDER BY sort, id DESC LIMIT 200`,
        ).all()).results;
      }
      return json({ products: results });
    }

    const prodMatch = path.match(/^\/products\/(\d+)$/);
    if (prodMatch && method === "GET") {
      let product: unknown;
      try {
        product = await env.DB.prepare(
          `SELECT id, name, description, price_cents, stock, image_key, active, sort, sku, category, featured
           FROM products WHERE id = ?1 AND active = 1`,
        ).bind(prodMatch[1]).first();
      } catch {
        product = await env.DB.prepare(
          `SELECT id, name, description, price_cents, stock, image_key, active, sort
           FROM products WHERE id = ?1 AND active = 1`,
        ).bind(prodMatch[1]).first();
      }
      if (!product) return err("not_found", "Product not found", 404);
      return json({ product });
    }

    // Product photos are public; receipts are NOT under this route.
    const mediaMatch = path.match(/^\/media\/(products\/[\w.-]+)$/);
    if (mediaMatch && method === "GET") {
      const obj = await env.MEDIA.get(mediaMatch[1]!);
      if (!obj) return err("not_found", "No such file", 404);
      return new Response(obj.body, {
        headers: {
          "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    /* ---- place an order ---- */
    if (path === "/orders" && method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && !ALLOWED_ORIGINS.has(origin) && origin !== env.STORE_ORIGIN) {
        return err("forbidden", "Bad origin", 403);
      }
      let body: { customer?: Record<string, unknown>; items?: { id?: unknown; qty?: unknown }[] };
      try { body = (await request.json()) as typeof body; } catch { return err("invalid_input", "JSON body required", 400); }
      if (str(body.customer?.website, 500)) return json({ ok: true }); // honeypot
      const name = str(body.customer?.name, 120);
      const phone = str(body.customer?.phone, 40);
      const address = str(body.customer?.address, 500);
      if (!name || !phone || !address) return err("invalid_input", "Name, phone and address are required", 400);

      // Normalise lines: positive ids, qty 1..99, max 20 distinct, merged.
      const wanted = new Map<number, number>();
      for (const raw of Array.isArray(body.items) ? body.items : []) {
        const id = Math.round(Number(raw?.id)), qty = Math.round(Number(raw?.qty));
        if (id > 0 && qty > 0) wanted.set(id, Math.min(99, (wanted.get(id) ?? 0) + qty));
      }
      if (wanted.size === 0 || wanted.size > 20) return err("invalid_input", "Cart is empty or too large", 400);

      // Price from the database — never from the request.
      const ids = [...wanted.keys()];
      const { results } = await env.DB.prepare(
        `SELECT id, name, price_cents, stock FROM products
         WHERE active = 1 AND id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`,
      ).bind(...ids).all<{ id: number; name: string; price_cents: number; stock: number }>();
      if (results.length !== wanted.size) return err("invalid_input", "A product in your cart is no longer available — refresh and try again", 409);

      // Reserve stock line by line; compensate on any miss.
      const taken: { id: number; qty: number }[] = [];
      for (const p of results) {
        const qty = wanted.get(p.id)!;
        const res = await env.DB.prepare(
          `UPDATE products SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1`,
        ).bind(qty, p.id).run();
        if (res.meta.changes === 0) {
          for (const t of taken) {
            await env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2`).bind(t.qty, t.id).run();
          }
          return err("out_of_stock", `"${p.name}" has only ${p.stock} left — adjust your cart`, 409);
        }
        taken.push({ id: p.id, qty });
      }

      const items = results.map((p) => ({ product_id: p.id, name: p.name, qty: wanted.get(p.id)!, price_cents: p.price_cents }));
      const subtotal = items.reduce((n, it) => n + it.price_cents * it.qty, 0);
      const cfg = storeConfig(env);
      const shipping = subtotal >= cfg.free_above_cents ? 0 : cfg.shipping_cents;
      const number = await orderNumber(env);
      const token = crypto.randomUUID().replace(/-/g, "");

      await env.DB.prepare(
        `INSERT INTO orders (order_number, token, customer_name, phone, address, email, notes,
                             items, subtotal_cents, shipping_cents, total_cents, status)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'pending_payment')`,
      ).bind(
        number, token, name, phone, address,
        str(body.customer?.email, 200), str(body.customer?.notes, 300),
        JSON.stringify(items), subtotal, shipping, subtotal + shipping,
      ).run();

      return json({ token, order_number: number }, 201);
    }

    /* ---- the customer's own order (token = auth) ---- */
    const tokMatch = path.match(/^\/orders\/([a-f0-9]{32})$/);
    if (tokMatch && method === "GET") {
      const o = await env.DB.prepare(`SELECT * FROM orders WHERE token = ?1`).bind(tokMatch[1]).first<OrderRow>();
      if (!o) return err("not_found", "Order not found", 404);
      return json({
        order_number: o.order_number, status: o.status,
        customer_name: o.customer_name, phone: o.phone, address: o.address,
        items: JSON.parse(o.items) as unknown[],
        subtotal_cents: o.subtotal_cents, shipping_cents: o.shipping_cents, total_cents: o.total_cents,
        receipt_uploaded: Boolean(o.receipt_key), tracking_no: o.tracking_no,
        created_at: o.created_at, config: storeConfig(env),
      });
    }

    const rcptMatch = path.match(/^\/orders\/([a-f0-9]{32})\/receipt$/);
    if (rcptMatch && method === "POST") {
      const o = await env.DB.prepare(`SELECT id, status FROM orders WHERE token = ?1`)
        .bind(rcptMatch[1]).first<{ id: number; status: Status }>();
      if (!o) return err("not_found", "Order not found", 404);
      if (o.status !== "pending_payment" && o.status !== "payment_review") {
        return err("invalid_input", "This order is already confirmed", 400);
      }
      const ct = request.headers.get("Content-Type") ?? "";
      const okTypes: Record<string, string> = {
        "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf",
      };
      if (!okTypes[ct]) return err("invalid_input", "Only JPEG/PNG/WEBP images or PDF are accepted", 400);
      const len = Number(request.headers.get("Content-Length") ?? "0");
      if (len > 5 * 1024 * 1024) return err("invalid_input", "Maximum 5 MB", 400);
      if (!request.body) return err("invalid_input", "File body required", 400);
      // receipts/ prefix: NEVER served by the public /media route — only the
      // admin endpoint below can read it back.
      const key = `receipts/${o.id}-${Date.now()}.${okTypes[ct]}`;
      await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
      await env.DB.prepare(
        `UPDATE orders SET receipt_key = ?1, status = 'payment_review', updated_at = datetime('now') WHERE id = ?2`,
      ).bind(key, o.id).run();
      return json({ ok: true }, 201);
    }

    /* ---- Stage B: pay online (inert until secrets exist) ---- */
    const payMatch = path.match(/^\/orders\/([a-f0-9]{32})\/pay$/);
    if (payMatch && method === "POST") {
      if (!billplzConfigured(env)) return err("not_configured", "Online payment is not enabled yet", 501);
      const o = await env.DB.prepare(`SELECT * FROM orders WHERE token = ?1`).bind(payMatch[1]).first<OrderRow>();
      if (!o) return err("not_found", "Order not found", 404);
      if (o.status !== "pending_payment" && o.status !== "payment_review") {
        return err("invalid_input", "Order is not awaiting payment", 400);
      }
      const bill = await billplzCreateBill(env, {
        order_number: o.order_number, token: o.token, total_cents: o.total_cents,
        customer_name: o.customer_name, phone: o.phone, email: o.email,
      });
      if (!bill) return err("gateway_error", "Payment gateway unavailable — pay by bank transfer instead", 502);
      /* Remember which bill belongs to this order, so the callback can flip
         the order by BILL id (which we verify) rather than by an order
         number the caller typed. */
      await env.DB.prepare(`UPDATE orders SET bill_id = ?1, updated_at = datetime('now') WHERE id = ?2`)
        .bind(bill.id, o.id).run().catch(() => null); // pre-0003: still payable, callback falls back to reference
      return json({ url: bill.url });
    }

    if (path === "/payments/billplz/callback" && (method === "POST" || method === "GET")) {
      if (!billplzConfigured(env)) return err("not_configured", "Not enabled", 501);
      /* NEVER trust callback parameters. Billplz POSTs billplz[id],
         billplz[paid], billplz[x_signature] — we take only the bill ID and
         then ask Billplz's authenticated API whether that bill is truly
         paid (billplz.ts). Anyone can POST here; only Billplz can make
         GET /bills/{id} answer paid:true. */
      const params = method === "GET" ? url.searchParams : new URLSearchParams(await request.text());
      const billId = params.get("billplz[id]") ?? params.get("id") ?? "";
      if (billId && (await billplzVerifyPaid(env, billId))) {
        const res = await env.DB.prepare(
          `UPDATE orders SET status = 'paid', payment_method = 'fpx', updated_at = datetime('now')
           WHERE bill_id = ?1 AND status IN ('pending_payment', 'payment_review')`,
        ).bind(billId).run().catch(() => null);
        if (!res || res.meta.changes === 0) {
          /* pre-0003 schema or bill created before the column existed: fall
             back to the order number Billplz echoes back in reference_1 —
             still safe, because the PAID fact came from the requery. */
          const ref = params.get("billplz[reference_1]") ?? params.get("reference_1") ?? "";
          if (/^ELF-\d{6}-\d+$/.test(ref)) {
            await env.DB.prepare(
              `UPDATE orders SET status = 'paid', payment_method = 'fpx', updated_at = datetime('now')
               WHERE order_number = ?1 AND status IN ('pending_payment', 'payment_review')`,
            ).bind(ref).run();
          }
        }
      }
      return json({ ok: true });
    }

    /* ---------------- admin ---------------- */
    if (path.startsWith("/admin/")) {
      if (!(await keyOk(request, env))) return err("unauthorized", "Bad key", 401);

      if (path === "/admin/products" && method === "GET") {
        const { results } = await env.DB.prepare(`SELECT * FROM products ORDER BY sort, id DESC LIMIT 500`).all();
        return json({ products: results });
      }
      if (path === "/admin/products" && method === "POST") {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const name = str(body?.name, 200);
        const price = Math.round(Number(body?.price_cents));
        const stock = Math.round(Number(body?.stock ?? 0));
        if (!name || !Number.isFinite(price) || price <= 0) return err("invalid_input", "name and a positive price_cents are required", 400);
        const category = body?.category === "shawl" ? "shawl" : "bawal";
        const res = await env.DB.prepare(
          `INSERT INTO products (name, description, price_cents, stock, active, sort, sku, category, featured)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id`,
        ).bind(name, str(body?.description, 2000), price, Math.max(0, stock),
               body?.active === false ? 0 : 1, Math.round(Number(body?.sort ?? 100)),
               str(body?.sku, 40), category, body?.featured ? 1 : 0).first<{ id: number }>();
        return json({ id: res?.id }, 201);
      }
      const adminProd = path.match(/^\/admin\/products\/(\d+)$/);
      if (adminProd && method === "PUT") {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const sets: string[] = []; const vals: (string | number | null)[] = [];
        const push = (col: string, val: string | number | null) => { sets.push(`${col} = ?${sets.length + 1}`); vals.push(val); };
        if (str(body?.name, 200)) push("name", body!.name as string);
        if (body?.description !== undefined) push("description", str(body.description, 2000));
        if (Number.isFinite(Number(body?.price_cents)) && Number(body?.price_cents) > 0) push("price_cents", Math.round(Number(body!.price_cents)));
        if (Number.isFinite(Number(body?.stock))) push("stock", Math.max(0, Math.round(Number(body!.stock))));
        if (body?.active !== undefined) push("active", body.active ? 1 : 0);
        if (Number.isFinite(Number(body?.sort))) push("sort", Math.round(Number(body!.sort)));
        if (body?.sku !== undefined) push("sku", str(body.sku, 40));
        if (body?.category !== undefined) push("category", body.category === "shawl" ? "shawl" : "bawal");
        if (body?.featured !== undefined) push("featured", body.featured ? 1 : 0);
        if (sets.length === 0) return err("invalid_input", "Nothing to update", 400);
        await env.DB.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ?${sets.length + 1}`)
          .bind(...vals, adminProd[1]!).run();
        return json({ ok: true });
      }
      const adminPhoto = path.match(/^\/admin\/products\/(\d+)\/photo$/);
      if (adminPhoto && method === "POST") {
        const ct = request.headers.get("Content-Type") ?? "";
        const ext = ct === "image/jpeg" ? "jpg" : ct === "image/png" ? "png" : ct === "image/webp" ? "webp" : null;
        if (!ext) return err("invalid_input", "Only JPEG/PNG/WEBP", 400);
        if (!request.body) return err("invalid_input", "Image body required", 400);
        const key = `products/${adminPhoto[1]}-${Date.now()}.${ext}`;
        await env.MEDIA.put(key, request.body, { httpMetadata: { contentType: ct } });
        await env.DB.prepare(`UPDATE products SET image_key = ?1 WHERE id = ?2`).bind(key, adminPhoto[1]!).run();
        return json({ image_key: key }, 201);
      }

      if (path === "/admin/orders" && method === "GET") {
        const status = url.searchParams.get("status");
        const stmt = status && (STATUSES as readonly string[]).includes(status)
          ? env.DB.prepare(`SELECT * FROM orders WHERE status = ?1 ORDER BY created_at DESC LIMIT 300`).bind(status)
          : env.DB.prepare(`SELECT * FROM orders ORDER BY created_at DESC LIMIT 300`);
        const { results } = await stmt.all();
        return json({ orders: results });
      }

      /* v0.4.0 (CEO: "how to update all the inventory to match with
         inventory in A2Zcreative??"): PULL stock from the agency portal's
         read-only bridge and update matching products BY SKU. Deliberate
         properties:
           - STOCK ONLY. Prices, names, photos, categories stay the store's
             own — the portal counts pieces; this store decides how to sell
             them.
           - Matching is by SKU, case-insensitive. Anything that does not
             match on either side is REPORTED, never guessed — a silent
             mismatch is how two systems drift apart while everyone believes
             they agree.
           - Admin-triggered, never automatic: the CEO presses Sync when the
             portal's count is the truth (e.g. after a stocktake), not while
             a live session is actively selling. */
      if (path === "/admin/sync-stock" && method === "POST") {
        if (!env.BRIDGE_URL || !env.BRIDGE_KEY || env.BRIDGE_URL.startsWith("REPLACE")) {
          return err("not_configured", "Set BRIDGE_URL (wrangler.toml) and the BRIDGE_KEY secret first — see README", 501);
        }
        let items: { sku: string; name: string; stock: number }[];
        try {
          const r = await fetch(env.BRIDGE_URL, { headers: { "X-Bridge-Key": env.BRIDGE_KEY } });
          if (!r.ok) return err("bridge_error", `Portal answered ${r.status} — check the key matches on both sides`, 502);
          items = ((await r.json()) as { items: typeof items }).items ?? [];
        } catch {
          return err("bridge_error", "Could not reach the portal bridge", 502);
        }
        const { results: mine } = await env.DB.prepare(
          `SELECT id, sku, stock FROM products WHERE sku IS NOT NULL`,
        ).all<{ id: number; sku: string; stock: number }>();
        const bySku = new Map(mine.map((m) => [m.sku.toUpperCase(), m]));
        const updated: { sku: string; from: number; to: number }[] = [];
        const unmatched_portal: string[] = [];
        for (const it of items) {
          const sku = String(it.sku ?? "").toUpperCase();
          const stock = Math.max(0, Math.round(Number(it.stock)));
          const m = sku ? bySku.get(sku) : undefined;
          if (!m || !Number.isFinite(stock)) { if (sku) unmatched_portal.push(sku); continue; }
          if (m.stock !== stock) {
            await env.DB.prepare(`UPDATE products SET stock = ?1 WHERE id = ?2`).bind(stock, m.id).run();
            updated.push({ sku: m.sku, from: m.stock, to: stock });
          }
          bySku.delete(sku);
        }
        const unmatched_store = [...bySku.values()].map((m) => m.sku);
        return json({ updated, unchanged: items.length - updated.length - unmatched_portal.length,
                      unmatched_portal, unmatched_store });
      }

      const adminRcpt = path.match(/^\/admin\/orders\/(\d+)\/receipt$/);
      if (adminRcpt && method === "GET") {
        const o = await env.DB.prepare(`SELECT receipt_key FROM orders WHERE id = ?1`)
          .bind(adminRcpt[1]).first<{ receipt_key: string | null }>();
        if (!o?.receipt_key) return err("not_found", "No receipt uploaded", 404);
        const obj = await env.MEDIA.get(o.receipt_key);
        if (!obj) return err("not_found", "Receipt file missing", 404);
        return new Response(obj.body, {
          headers: { "Content-Type": obj.httpMetadata?.contentType ?? "application/octet-stream", "Cache-Control": "no-store" },
        });
      }

      const adminOrder = path.match(/^\/admin\/orders\/(\d+)$/);
      if (adminOrder && method === "PUT") {
        const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
        const action = str(body?.action, 20);
        const o = await env.DB.prepare(`SELECT * FROM orders WHERE id = ?1`).bind(adminOrder[1]).first<OrderRow>();
        if (!o) return err("not_found", "Order not found", 404);

        /* Forward-only transitions — the whole money-safety model: */
        const moves: Record<string, { from: Status[]; to: Status }> = {
          confirm_paid: { from: ["pending_payment", "payment_review"], to: "paid" },
          ship:         { from: ["paid"], to: "shipped" },
          complete:     { from: ["shipped"], to: "completed" },
          cancel:       { from: ["pending_payment", "payment_review"], to: "cancelled" },
        };
        if (action && moves[action]) {
          const mv = moves[action]!;
          if (!mv.from.includes(o.status)) {
            return err("invalid_input", `Cannot ${action} an order that is ${o.status}. Paid orders are refunded manually (WhatsApp), never silently cancelled.`, 409);
          }
          if (action === "cancel") {
            // The order never got paid — its reservation goes back on the shelf.
            const items = JSON.parse(o.items) as { product_id: number; qty: number }[];
            for (const it of items) {
              await env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2`).bind(it.qty, it.product_id).run();
            }
          }
          const tracking = action === "ship" ? str(body?.tracking_no, 60) : null;
          await env.DB.prepare(
            `UPDATE orders SET status = ?1, payment_method = COALESCE(payment_method, ?2),
                    tracking_no = COALESCE(?3, tracking_no), updated_at = datetime('now') WHERE id = ?4`,
          ).bind(mv.to, action === "confirm_paid" ? "bank_transfer" : null, tracking, o.id).run();
          return json({ ok: true, status: mv.to });
        }
        if (body?.admin_notes !== undefined) {
          await env.DB.prepare(`UPDATE orders SET admin_notes = ?1, updated_at = datetime('now') WHERE id = ?2`)
            .bind(typeof body.admin_notes === "string" ? body.admin_notes.slice(0, 1000) : null, o.id).run();
          return json({ ok: true });
        }
        return err("invalid_input", "Unknown action", 400);
      }
    }

    return err("not_found", "No such endpoint", 404);
  },
};
