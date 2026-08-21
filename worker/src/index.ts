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
import {
  billplzCheck, billplzConfigured, billplzCreateBill, billplzSignatureConfigured,
  billplzSignatureOk, billplzVerifyPaid, storeUrl,
} from "./billplz";
import {
  callerIp, clearLimit, createSession, currentCustomer, destroySession, hashPassword, hitLimit,
  looksLikeEmail, normaliseEmail, normalisePhone, sessionCookie, clearCookie, sweepAuth,
  timingSafeEqual, verifyPassword, type Customer,
} from "./auth";
import {
  flushStockEvents, getState, pullConfigured, pushConfigured, recordStockEvents, syncNow,
} from "./portal";

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
  /** v1.0.0 — the X Signature Key from the Billplz dashboard. Used to verify
      that a callback or redirect really came from Billplz before the order is
      re-queried. `wrangler secret put BILLPLZ_XSIGN`. */
  BILLPLZ_XSIGN?: string;
  /** v1.0.0 — this shop's public origin, e.g. "https://elfiaofficialstore.my".
      Billplz callback/redirect URLs are built from it, so no domain is
      hardcoded in the source. */
  STORE_URL?: string;
  /** v1.0.0 — hours an unpaid order holds its stock before the cron releases
      it. Default 12. */
  ORDER_HOLD_HOURS?: string;
  /** v1.0.0 — how many unpaid orders one phone number may hold. Default 2. */
  MAX_OPEN_ORDERS?: string;
  /** Inventory + price sync with the agency portal. ALL THREE are Wrangler
      secrets (v1.1.0) — the portal's domain must never live in a committed
      file, and tests/brand-isolation.mjs enforces that. Any of them unset =
      that direction reports "not configured" and does nothing.
        BRIDGE_URL       the portal's inventory feed (GET; counts + prices)
        BRIDGE_PUSH_URL  where this store posts its sales (POST; deltas)
        BRIDGE_KEY       shared secret, equal to the portal's ELFIA_BRIDGE_KEY */
  BRIDGE_URL?: string;
  BRIDGE_PUSH_URL?: string;
  BRIDGE_KEY?: string;
  STORE_ORIGIN?: string;     // override for local testing
}

const VERSION = "1.1.2";
const STATUSES = ["pending_payment", "payment_review", "paid", "shipped", "completed", "cancelled"] as const;
type Status = (typeof STATUSES)[number];

/** Origins allowed to POST. STORE_URL (and its www. twin) is the real one;
    the rest are for local work. STORE_ORIGIN adds one more for a test rig. */
function originAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return true;                       // server-to-server, curl
  const store = storeUrl(env);
  const host = new URL(store).host;
  const allowed = new Set([
    store,
    `https://www.${host.replace(/^www\./, "")}`,
    "http://localhost:3000",
    env.STORE_ORIGIN ?? "",
  ]);
  return allowed.has(origin);
}

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
    hold_hours: intVar(env.ORDER_HOLD_HOURS, 12),
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

/** v0.9.0 — one row per movement in an order's life. Written for EVERY
    transition, including the ones the system makes on its own (a receipt
    upload, an FPX payment verified against Billplz), because a history with
    gaps is not a history. Never edited, never deleted. */
async function recordOrderEvent(env: Env, orderId: number, status: string, note: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO order_events (order_id, status, note) VALUES (?1, ?2, ?3)`,
  ).bind(orderId, status, note).run().catch(() => null); // pre-0009: no history, order still moves
}

/**
 * v1.0.0 — release unpaid orders whose hold has run out ("no joy buyer").
 *
 * This is the same code path as an admin cancelling: stock goes back (only
 * for products that count it), the portal is told, and the order records why
 * it moved. It is NOT a separate silent status, because a customer who comes
 * back must be able to see what happened and re-order.
 *
 * Only pending_payment and payment_review are eligible. An order whose
 * receipt is sitting in payment_review is included on purpose — a receipt
 * nobody could match is still an unpaid order — but the note says so, and
 * twelve hours is long enough for the shop to have looked.
 */
async function releaseExpiredOrders(env: Env): Promise<number> {
  const { results: due } = await env.DB.prepare(
    `SELECT id, order_number, items FROM orders
     WHERE status IN ('pending_payment', 'payment_review')
       AND expires_at IS NOT NULL AND expires_at <= datetime('now')
     LIMIT 50`,
  ).all<{ id: number; order_number: string; items: string }>().catch(() => ({ results: [] as { id: number; order_number: string; items: string }[] }));

  for (const o of due) {
    const items = JSON.parse(o.items) as { product_id: number; qty: number }[];
    for (const it of items) {
      await env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2 AND track_stock = 1`)
        .bind(it.qty, it.product_id).run().catch(() => null);
    }
    const { results: skus } = await env.DB.prepare(
      `SELECT id, sku FROM products WHERE id IN (${items.map((_, i) => `?${i + 1}`).join(",")})`,
    ).bind(...items.map((it) => it.product_id)).all<{ id: number; sku: string | null }>()
      .catch(() => ({ results: [] as { id: number; sku: string | null }[] }));
    await recordStockEvents(
      env,
      items.map((it) => ({ sku: skus.find((p) => p.id === it.product_id)?.sku, qty: it.qty })),
      "cancel", o.order_number,
    );
    await env.DB.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?1`,
    ).bind(o.id).run();
    await recordOrderEvent(env, o.id, "cancelled", "Released — payment was not received in time. You are welcome to order again.");
  }
  return due.length;
}

/** Malaysian couriers the shop actually uses, so "Shipped" carries a working
    link instead of a number the customer must paste somewhere themselves.
    Anything not listed shows the number alone — a wrong link is worse than
    none. */
const COURIERS: Record<string, { label: string; url: (n: string) => string }> = {
  jnt:      { label: "J&T Express", url: (n) => `https://www.jtexpress.my/tracking?billcode=${encodeURIComponent(n)}` },
  ninjavan: { label: "Ninja Van",   url: (n) => `https://www.ninjavan.co/en-my/tracking?id=${encodeURIComponent(n)}` },
  poslaju:  { label: "Pos Laju",    url: (n) => `https://track.pos.com.my/postal-services/quick-access/?track-trace=${encodeURIComponent(n)}` },
  dhl:      { label: "DHL",         url: (n) => `https://www.dhl.com/my-en/home/tracking.html?tracking-id=${encodeURIComponent(n)}` },
  flash:    { label: "Flash Express", url: (n) => `https://www.flashexpress.my/fle/tracking?se=${encodeURIComponent(n)}` },
  citylink: { label: "City-Link",   url: (n) => `https://www.citylinkexpress.com/tracking-result/?track=${encodeURIComponent(n)}` },
};

interface OrderRow {
  id: number; order_number: string; token: string; customer_name: string; phone: string;
  address: string; email: string | null; notes: string | null; items: string;
  subtotal_cents: number; shipping_cents: number; total_cents: number; status: Status;
  receipt_key: string | null; payment_method: string | null; tracking_no: string | null;
  admin_notes: string | null; created_at: string; updated_at: string | null;
}

export default {
  /* v0.8.0 — the inventory sync runs on a schedule (see [triggers] in
     wrangler.toml), not only when someone presses a button in /admin.
     Deliver outstanding sales first, then refresh counts: pulling before
     pushing would read numbers the portal computed without our sales. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      /* Release first: an expired order puts stock back, and that movement
         should be in the outbox before the push runs. */
      await releaseExpiredOrders(env);
      await sweepAuth(env);
      await syncNow(env);
    })());
  },

  /* v1.1.0 — no request may crash into an HTML error page. The CEO's phone
     showed "Network problem — please try again" where the real story was a
     missed database migration: an uncaught throw became Cloudflare's HTML
     error page, which the storefront cannot read. Every failure now leaves
     this worker as JSON, and /health names the missing piece. */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    try {
      return await handleRequest(request, env, ctx);
    } catch (e) {
      console.error("unhandled:", e instanceof Error ? e.stack ?? e.message : String(e));
      return json({ error: { code: "server_error", message: "Something went wrong on our side — please try again in a moment." } }, 500);
    }
  },
};

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = request.method;

    /* ---------------- public ---------------- */

    if (path === "/health" && method === "GET") {
      let db = false, r2 = false;
      try { await env.DB.prepare("SELECT 1").first(); db = true; } catch { /* not yet */ }
      try { await env.MEDIA.head("health-probe"); r2 = true; } catch { /* not yet */ }
      /* Which migrations have actually reached THIS database. `db: true` only
         proves the database answers; a worker deployed ahead of its
         migrations is the failure that looked like "Network problem" on the
         CEO's phone, so the health line now names it. */
      const table = async (name: string): Promise<boolean> => {
        try { await env.DB.prepare(`SELECT 1 FROM ${name} LIMIT 1`).first(); return true; } catch { return false; }
      };
      const [accounts, progress, syncReady] = await Promise.all([
        table("customers"), table("order_events"), table("stock_events"),
      ]);
      const migrationsCurrent = accounts && progress && syncReady;
      const cfg = storeConfig(env);
      return json({
        ok: db && migrationsCurrent, version: VERSION, db, r2,
        migrations_current: migrationsCurrent,
        ...(migrationsCurrent ? {} : {
          migrations_fix: "cd worker && npx wrangler d1 migrations apply elfia-store --remote",
          missing: [
            ...(accounts ? [] : ["customers (0010 — sign in/sign up will fail)"]),
            ...(progress ? [] : ["order_events (0009 — order progress will fail)"]),
            ...(syncReady ? [] : ["stock_events (0008 — inventory sync will fail)"]),
          ],
        }),
        admin_key_configured: Boolean(env.ADMIN_KEY),
        bank_line_configured: !cfg.bank_line.startsWith("REPLACE"),
        gateway_configured: cfg.gateway,
        gateway_signature_configured: billplzSignatureConfigured(env),
        store_url: storeUrl(env),
        order_hold_hours: intVar(env.ORDER_HOLD_HOURS, 12),
        bridge_pull_configured: pullConfigured(env),
        bridge_push_configured: pushConfigured(env),
      });
    }

    if (path === "/store-config" && method === "GET") return json(storeConfig(env));

    if (path === "/products" && method === "GET") {
      /* v0.2.0 columns (sku/category/featured) with a pre-0002 fallback, so
         a worker deployed ahead of its migration degrades instead of 500s. */
      let results: Record<string, unknown>[];
      try {
        results = (await env.DB.prepare(
          `SELECT id, name, description, price_cents, stock, image_key, active, sort, sku, category, featured, track_stock
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
          `SELECT id, name, description, price_cents, stock, image_key, active, sort, sku, category, featured, track_stock
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

    /* ---- restock waitlist (v0.6.0) ----
       A sold-out design collects a name + WhatsApp number instead of losing
       the customer. Same origin check and honeypot as checkout. The unique
       (product_id, phone) index means a second submission REPLACES the first
       and resets it to "still waiting", so a refreshed form cannot flood the
       list. Nothing is ever sent from here — the shop messages people by
       hand from /admin, which is also why no email address is collected. */
    if (path === "/notify" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      let body: Record<string, unknown>;
      try { body = (await request.json()) as Record<string, unknown>; } catch { return err("invalid_input", "JSON body required", 400); }
      if (str(body.website, 500)) return json({ ok: true }); // honeypot
      const name = str(body.name, 120);
      const phone = str(body.phone, 40);
      const productId = Math.round(Number(body.product_id));
      if (!name || !phone || !(productId > 0)) return err("invalid_input", "Name, phone and product are required", 400);
      if (phone.replace(/\D/g, "").length < 9) return err("invalid_input", "That phone number looks incomplete", 400);
      const exists = await env.DB.prepare(`SELECT id FROM products WHERE id = ?1 AND active = 1`)
        .bind(productId).first<{ id: number }>();
      if (!exists) return err("not_found", "Product not found", 404);
      await env.DB.prepare(
        `INSERT INTO restock_requests (product_id, name, phone) VALUES (?1, ?2, ?3)
         ON CONFLICT(product_id, phone) DO UPDATE
           SET name = ?2, created_at = datetime('now'), notified_at = NULL`,
      ).bind(productId, name, phone).run();
      return json({ ok: true }, 201);
    }

    /* ---- place an order ---- */
    if (path === "/orders" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      let body: { customer?: Record<string, unknown>; items?: { id?: unknown; qty?: unknown }[] };
      try { body = (await request.json()) as typeof body; } catch { return err("invalid_input", "JSON body required", 400); }
      if (str(body.customer?.website, 500)) return json({ ok: true }); // honeypot
      const name = str(body.customer?.name, 120);
      const phone = str(body.customer?.phone, 40);
      const address = str(body.customer?.address, 500);
      if (!name || !phone || !address) return err("invalid_input", "Name, phone and address are required", 400);

      /* v1.0.0 — the two rules that stop an order costing the shop nothing to
         place. Neither can touch a customer who is actually buying. */
      const ip = callerIp(request);
      const burst = await hitLimit(env, `order:${ip}`, 8, 60);
      if (!burst.allowed) {
        return err("too_many", "That is a lot of orders in one hour. Finish the ones you have, or WhatsApp us and we will help.", 429);
      }
      const phoneDigits = normalisePhone(phone);
      const maxOpen = intVar(env.MAX_OPEN_ORDERS, 2);
      const open = await env.DB.prepare(
        `SELECT COUNT(*) AS n FROM orders
         WHERE phone_digits = ?1 AND status IN ('pending_payment', 'payment_review')`,
      ).bind(phoneDigits).first<{ n: number }>().catch(() => null);
      if ((open?.n ?? 0) >= maxOpen) {
        return err(
          "open_orders",
          `You already have ${open!.n} unpaid order${open!.n === 1 ? "" : "s"} waiting. Pay for ${open!.n === 1 ? "it" : "them"} first — find ${open!.n === 1 ? "it" : "them"} under Track order — and this one will go through.`,
          409,
        );
      }

      // Normalise lines: positive ids, qty 1..99, max 20 distinct, merged.
      const wanted = new Map<number, number>();
      for (const raw of Array.isArray(body.items) ? body.items : []) {
        const id = Math.round(Number(raw?.id)), qty = Math.round(Number(raw?.qty));
        if (id > 0 && qty > 0) wanted.set(id, Math.min(99, (wanted.get(id) ?? 0) + qty));
      }
      if (wanted.size === 0 || wanted.size > 20) return err("invalid_input", "Cart is empty or too large", 400);

      // Price from the database — never from the request.
      const ids = [...wanted.keys()];
      const placeholders = ids.map((_, i) => `?${i + 1}`).join(",");
      type Line = { id: number; name: string; price_cents: number; stock: number; track_stock?: number; sku?: string | null };
      let results: Line[];
      try {
        results = (await env.DB.prepare(
          `SELECT id, name, price_cents, stock, track_stock, sku FROM products
           WHERE active = 1 AND id IN (${placeholders})`,
        ).bind(...ids).all<Line>()).results;
      } catch {
        // pre-0007 schema: everything counts stock, same as before.
        results = (await env.DB.prepare(
          `SELECT id, name, price_cents, stock, sku FROM products
           WHERE active = 1 AND id IN (${placeholders})`,
        ).bind(...ids).all<Line>()).results;
      }
      if (results.length !== wanted.size) return err("invalid_input", "A product in your cart is no longer available — refresh and try again", 409);

      /* Reserve stock line by line; compensate on any miss.
         v0.7.0: a product with track_stock = 0 is "always available" — its
         count is not maintained, so decrementing it would invent a shortage.
         Those lines skip the reservation entirely and are never compensated,
         which is why `taken` records only the tracked ones. */
      const taken: { id: number; qty: number }[] = [];
      for (const p of results) {
        const qty = wanted.get(p.id)!;
        if ((p.track_stock ?? 1) === 0) continue;
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

      /* An account is optional. If the buyer happens to be signed in the order
         remembers them, so it shows up in their history on any device. */
      const signedIn = await currentCustomer(env, request);
      const holdHours = intVar(env.ORDER_HOLD_HOURS, 12);
      await env.DB.prepare(
        `INSERT INTO orders (order_number, token, customer_name, phone, phone_digits, address, email, notes,
                             items, subtotal_cents, shipping_cents, total_cents, status,
                             customer_id, expires_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending_payment', ?13,
                 datetime('now', ?14))`,
      ).bind(
        number, token, name, phone, phoneDigits, address,
        str(body.customer?.email, 200), str(body.customer?.notes, 300),
        JSON.stringify(items), subtotal, shipping, subtotal + shipping,
        signedIn?.id ?? null, `+${holdHours} hours`,
      ).run();

      const created = await env.DB.prepare(`SELECT id FROM orders WHERE token = ?1`).bind(token).first<{ id: number }>();
      if (created) await recordOrderEvent(env, created.id, "pending_payment", "Order placed");

      /* v0.8.0 — tell the portal these pieces left the shelf. Written to the
         outbox synchronously (so a crash between here and delivery loses
         nothing) and delivered on the way out, without making the customer
         wait for the portal to answer. Recorded for EVERY line, including
         always-available ones: the store does not count its own pieces, but
         the portal still needs to know they sold. */
      await recordStockEvents(env, results.map((p) => ({ sku: p.sku, qty: wanted.get(p.id)! })), "order", number);
      ctx.waitUntil(flushStockEvents(env).then(() => undefined));

      return json({ token, order_number: number }, 201);
    }

    /* ---- the customer's own order (token = auth) ---- */
    const tokMatch = path.match(/^\/orders\/([a-f0-9]{32})$/);
    if (tokMatch && method === "GET") {
      const o = await env.DB.prepare(`SELECT * FROM orders WHERE token = ?1`)
        .bind(tokMatch[1]).first<OrderRow & { tracking_courier?: string | null }>();
      if (!o) return err("not_found", "Order not found", 404);
      /* v0.9.0 — the order's own history, oldest first, so the page can show
         WHEN each step happened rather than only which one is current. */
      const { results: events } = await env.DB.prepare(
        `SELECT status, note, created_at FROM order_events WHERE order_id = ?1 ORDER BY created_at, id`,
      ).bind(o.id).all<{ status: string; note: string | null; created_at: string }>()
        .catch(() => ({ results: [] as { status: string; note: string | null; created_at: string }[] }));
      const courier = o.tracking_courier && COURIERS[o.tracking_courier] ? COURIERS[o.tracking_courier]! : null;
      return json({
        order_number: o.order_number, status: o.status,
        customer_name: o.customer_name, phone: o.phone, address: o.address,
        items: JSON.parse(o.items) as unknown[],
        subtotal_cents: o.subtotal_cents, shipping_cents: o.shipping_cents, total_cents: o.total_cents,
        receipt_uploaded: Boolean(o.receipt_key), tracking_no: o.tracking_no,
        /* When an unpaid order releases its stock. The page turns this into a
           countdown; the cron turns it into a cancellation. */
        expires_at: (o as { expires_at?: string | null }).expires_at ?? null,
        tracking_courier: courier?.label ?? null,
        tracking_url: courier && o.tracking_no ? courier.url(o.tracking_no) : null,
        events,
        created_at: o.created_at, config: storeConfig(env),
      });
    }

    /* ---- orders feed for the agency portal (v1.1.0) ----
       CEO: "Order should be able to send into the portal so that I can
       easily monitor everything." The portal PULLS from here rather than the
       store pushing whole orders out: an order is not a delta, it is a
       record that keeps changing (paid, shipped, delivered), and a poll with
       a cursor picks up every change without an outbox per status.

       Auth is the same shared bridge key as the inventory sync, compared in
       constant time. The customer's order TOKEN is deliberately absent —
       that is the customer's private key to their order page, and the portal
       has no use for it.

       `since` is the cursor: the `cursor` value from the previous response
       (an updated-at watermark). First call: omit it and page from the
       start. Rows come back oldest-change-first, at most 200 per call; keep
       calling with the new cursor until `orders` comes back empty. The same
       order reappears whenever its status moves — upsert by order_number. */
    if (path === "/bridge/orders" && method === "GET") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const given = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(given, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);

      const since = str(url.searchParams.get("since"), 40);
      const { results } = await env.DB.prepare(
        `SELECT order_number, status, customer_name, phone, address, items,
                subtotal_cents, shipping_cents, total_cents, payment_method,
                tracking_no, tracking_courier, created_at, updated_at,
                COALESCE(updated_at, created_at) AS changed_at
         FROM orders
         ${since ? "WHERE COALESCE(updated_at, created_at) > ?1" : ""}
         ORDER BY changed_at, id LIMIT 200`,
      ).bind(...(since ? [since] : [])).all<Record<string, unknown> & { changed_at: string; items: string }>();

      const orders = results.map((o) => ({
        ...o,
        items: JSON.parse(o.items) as unknown[],   // qty + the price actually charged
      }));
      return json({
        orders,
        cursor: results.length ? results[results.length - 1]!.changed_at : since ?? null,
        store: "elfia",
      });
    }

    /* ---------------- customer accounts (v1.0.0) ----------------
       An account is optional everywhere. Nothing below is required to buy;
       it exists so a customer's address and order history survive a new
       phone, and so a half-finished checkout is not lost on refresh. */

    if (path === "/auth/signup" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      const gate = await hitLimit(env, `signup:${callerIp(request)}`, 5, 60);
      if (!gate.allowed) return err("too_many", "Too many sign-ups from here. Try again later.", 429);

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      if (str(body?.website, 500)) return json({ ok: true });        // honeypot
      const email = normaliseEmail(str(body?.email, 200) ?? "");
      const name = str(body?.name, 120);
      const password = typeof body?.password === "string" ? body.password : "";
      if (!looksLikeEmail(email)) return err("invalid_input", "That email address does not look right.", 400);
      if (!name) return err("invalid_input", "Please tell us your name.", 400);
      if (password.length < 8) return err("invalid_input", "Please use a password of at least 8 characters.", 400);
      if (password.length > 200) return err("invalid_input", "That password is too long.", 400);

      const phone = str(body?.phone, 40);
      const { hash, salt, iter } = await hashPassword(password);
      let created: { id: number } | null = null;
      try {
        created = await env.DB.prepare(
          `INSERT INTO customers (email, name, phone, phone_digits, address, pw_hash, pw_salt, pw_iter)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`,
        ).bind(email, name, phone, normalisePhone(phone), str(body?.address, 500), hash, salt, iter)
         .first<{ id: number }>();
      } catch (e) {
        /* Two very different failures land here and must not share a message:
           a missing table (migration 0010 never ran — the shop's problem) and
           a duplicate email (the customer's). Telling a customer "email
           taken" when the real fault is an unmigrated database sends them
           chasing a password they never made. */
        if (/no such table/i.test(String(e))) {
          return err("not_ready", "Accounts are not switched on yet — the shop needs to finish its setup. You can still order as a guest.", 503);
        }
        // UNIQUE(email). Say so plainly: an attacker can discover the same
        // fact by trying to sign in, so hiding it only confuses real people.
        return err("email_taken", "There is already an account with that email. Sign in instead.", 409);
      }
      if (!created) return err("server_error", "Could not create the account — please try again.", 500);

      const token = await createSession(env, created.id, request.headers.get("User-Agent"));
      return new Response(JSON.stringify({ customer: { id: created.id, email, name, phone, address: str(body?.address, 500) } }), {
        status: 201,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token, url) },
      });
    }

    if (path === "/auth/login" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      const ip = callerIp(request);
      /* Counts every attempt, not just the failures: a limit that forgives a
         correct guess is not a limit. */
      const gate = await hitLimit(env, `login:${ip}`, 10, 15);
      if (!gate.allowed) return err("too_many", "Too many attempts — wait fifteen minutes.", 429);

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const email = normaliseEmail(str(body?.email, 200) ?? "");
      const password = typeof body?.password === "string" ? body.password : "";
      const row = await env.DB.prepare(
        `SELECT id, email, name, phone, phone_digits, address, created_at, pw_hash, pw_salt, pw_iter
         FROM customers WHERE email = ?1`,
      ).bind(email).first<Customer & { pw_hash: string; pw_salt: string; pw_iter: number }>().catch(() => null);

      /* Same answer for "no such account" and "wrong password", and the hash
         is still computed when the account does not exist so the two take the
         same time. */
      const okPassword = row
        ? await verifyPassword(password, row.pw_hash, row.pw_salt, row.pw_iter)
        : await verifyPassword(password, "0".repeat(64), "00", 100_000);
      if (!row || !okPassword) return err("bad_login", "That email and password do not match.", 401);

      await env.DB.prepare(`UPDATE customers SET last_login_at = datetime('now') WHERE id = ?1`).bind(row.id).run();
      await clearLimit(env, `login:${ip}`);
      const token = await createSession(env, row.id, request.headers.get("User-Agent"));
      return new Response(JSON.stringify({
        customer: { id: row.id, email: row.email, name: row.name, phone: row.phone, address: row.address },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": sessionCookie(token, url) },
      });
    }

    if (path === "/auth/logout" && method === "POST") {
      await destroySession(env, request);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store", "Set-Cookie": clearCookie(url) },
      });
    }

    if (path === "/auth/me" && method === "GET") {
      const me = await currentCustomer(env, request);
      if (!me) return err("unauthorized", "Not signed in", 401);
      return json({ customer: { id: me.id, email: me.email, name: me.name, phone: me.phone, address: me.address } });
    }

    if (path === "/auth/me" && method === "PUT") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      const me = await currentCustomer(env, request);
      if (!me) return err("unauthorized", "Not signed in", 401);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const name = str(body?.name, 120) ?? me.name;
      const phone = body?.phone === undefined ? me.phone : str(body.phone, 40);
      const address = body?.address === undefined ? me.address : str(body.address, 500);
      await env.DB.prepare(
        `UPDATE customers SET name = ?1, phone = ?2, phone_digits = ?3, address = ?4 WHERE id = ?5`,
      ).bind(name, phone, normalisePhone(phone), address, me.id).run();
      return json({ customer: { id: me.id, email: me.email, name, phone, address } });
    }

    /* The customer's own orders. Only ever their own: the query is keyed on
       the session's customer id, never on anything the browser sent. */
    if (path === "/auth/orders" && method === "GET") {
      const me = await currentCustomer(env, request);
      if (!me) return err("unauthorized", "Not signed in", 401);
      const { results } = await env.DB.prepare(
        `SELECT order_number, token, status, total_cents, created_at, tracking_no
         FROM orders WHERE customer_id = ?1 ORDER BY created_at DESC LIMIT 100`,
      ).bind(me.id).all();
      return json({ orders: results });
    }

    /* Attach a guest order to the signed-in account — proved the same way
       /track proves it: order number plus the phone that placed it. Orders
       are never auto-claimed by matching a phone number, because that hands
       one customer another customer's history. */
    if (path === "/auth/claim" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      const me = await currentCustomer(env, request);
      if (!me) return err("unauthorized", "Not signed in", 401);
      const ip = callerIp(request);
      const gate = await hitLimit(env, `claim:${ip}`, 8, 15);
      if (!gate.allowed) return err("too_many", "Too many attempts — wait fifteen minutes.", 429);

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const number = str(body?.order_number, 40)?.toUpperCase().trim() ?? "";
      const phone = normalisePhone(str(body?.phone, 40) ?? "");
      const nope = err("not_found", "We could not find that order. Check the order number and the phone number used at checkout.", 404);
      if (!number || phone.length < 9) return nope;
      const o = await env.DB.prepare(`SELECT id, phone, customer_id FROM orders WHERE order_number = ?1`)
        .bind(number).first<{ id: number; phone: string; customer_id: number | null }>();
      if (!o) return nope;
      if (normalisePhone(o.phone).slice(-9) !== phone.slice(-9)) return nope;
      if (o.customer_id && o.customer_id !== me.id) return err("already_claimed", "That order already belongs to another account.", 409);
      await env.DB.prepare(`UPDATE orders SET customer_id = ?1 WHERE id = ?2`).bind(me.id, o.id).run();
      await clearLimit(env, `claim:${ip}`);
      return json({ ok: true, order_number: number });
    }

    /* ---- "Track my order" (v0.9.0) ----
       Most customers lose the link from checkout. Order number + the phone
       they gave finds it again.

       This is a guessing surface — ELF-DDMMYY-1, -2, -3 is a sequence — so:
         * the phone must match too, compared on digits alone (0123456789,
           +60 12-345 6789 and 60123456789 are the same person);
         * a wrong number and a wrong order number produce the SAME answer,
           so nobody can use it to learn how many orders the shop has;
         * eight misses in fifteen minutes and that IP is turned away. */
    if (path === "/orders/lookup" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return err("forbidden", "Bad origin", 403);
      const ip = callerIp(request);
      const gate = await hitLimit(env, `lookup:${ip}`, 8, 15);
      if (!gate.allowed) {
        return err("too_many", "Too many attempts — wait fifteen minutes, or WhatsApp us and we will find your order.", 429);
      }

      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const number = str(body?.order_number, 40)?.toUpperCase().trim() ?? "";
      const phone = (str(body?.phone, 40) ?? "").replace(/\D/g, "");
      // Deliberately identical whether the order number exists or not — this
      // endpoint must never reveal which order numbers are real.
      const miss = (): Response =>
        err("not_found", "We could not find that order. Check the order number and the phone number you used at checkout.", 404);
      if (!number || phone.length < 9) return miss();

      const o = await env.DB.prepare(`SELECT token, phone FROM orders WHERE order_number = ?1`)
        .bind(number).first<{ token: string; phone: string }>();
      if (!o) return miss();
      const stored = o.phone.replace(/\D/g, "");
      // Compare the last 9 digits: the same number written with or without
      // the 60 country code must still match.
      const same = stored.slice(-9) === phone.slice(-9) && phone.slice(-9).length === 9;
      if (!same) return miss();

      await clearLimit(env, `lookup:${ip}`);   // a customer who found their own order is not a guesser
      return json({ token: o.token });
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
      await recordOrderEvent(env, o.id, "payment_review", "Receipt uploaded — we are checking it");
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

    /* v0.7.0 — the customer's own "did my payment land?" check.
       Billplz redirects the payer back to /order?t=… immediately, but the
       server-to-server callback can arrive a moment later (or get lost). The
       order page calls this a few times after a redirect; it re-queries
       Billplz with our secret — the same authenticated read the callback
       uses — so the answer is never taken from the browser's URL. Safe to
       call at any time: it can only move an unpaid order to paid. */
    const verifyMatch = path.match(/^\/orders\/([a-f0-9]{32})\/verify-payment$/);
    if (verifyMatch && method === "POST") {
      const o = await env.DB.prepare(`SELECT * FROM orders WHERE token = ?1`).bind(verifyMatch[1]).first<OrderRow & { bill_id?: string | null }>();
      if (!o) return err("not_found", "Order not found", 404);
      if (o.status !== "pending_payment" && o.status !== "payment_review") {
        return json({ status: o.status, paid: o.status !== "cancelled" });
      }
      if (!billplzConfigured(env) || !o.bill_id) return json({ status: o.status, paid: false });
      if (await billplzVerifyPaid(env, o.bill_id)) {
        await env.DB.prepare(
          `UPDATE orders SET status = 'paid', payment_method = 'fpx', updated_at = datetime('now')
           WHERE id = ?1 AND status IN ('pending_payment', 'payment_review')`,
        ).bind(o.id).run();
        await recordOrderEvent(env, o.id, "paid", "Paid online (FPX) — confirmed with the bank");
        return json({ status: "paid", paid: true });
      }
      return json({ status: o.status, paid: false });
    }

    if (path === "/payments/billplz/callback" && (method === "POST" || method === "GET")) {
      if (!billplzConfigured(env)) return err("not_configured", "Not enabled", 501);
      /* NEVER trust callback parameters. Billplz POSTs billplz[id],
         billplz[paid], billplz[x_signature] — we take only the bill ID and
         then ask Billplz's authenticated API whether that bill is truly
         paid (billplz.ts). Anyone can POST here; only Billplz can make
         GET /bills/{id} answer paid:true. */
      const params = method === "GET" ? url.searchParams : new URLSearchParams(await request.text());

      /* LOCK 1 — X-Signature. A GET here is the browser redirect (parameters
         arrive as billplz[id]); a POST is Billplz's server callback (flat
         parameters). Either way a bad signature is thrown out before we spend
         a network call on it. With no key configured we fall through to the
         requery alone, which is still safe — just noisier. */
      const sig = await billplzSignatureOk(env, params, method === "GET");
      if (sig === false) return err("forbidden", "Bad signature", 403);

      const billId = params.get("billplz[id]") ?? params.get("id") ?? "";
      /* LOCK 2 — only Billplz's own authenticated answer marks an order paid. */
      if (billId && (await billplzVerifyPaid(env, billId))) {
        const res = await env.DB.prepare(
          `UPDATE orders SET status = 'paid', payment_method = 'fpx', updated_at = datetime('now')
           WHERE bill_id = ?1 AND status IN ('pending_payment', 'payment_review')`,
        ).bind(billId).run().catch(() => null);
        if (res && res.meta.changes > 0) {
          const paidRow = await env.DB.prepare(`SELECT id FROM orders WHERE bill_id = ?1`).bind(billId).first<{ id: number }>();
          if (paidRow) await recordOrderEvent(env, paidRow.id, "paid", "Paid online (FPX) — confirmed with the bank");
        }
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
            const refRow = await env.DB.prepare(`SELECT id FROM orders WHERE order_number = ?1`).bind(ref).first<{ id: number }>();
            if (refRow) await recordOrderEvent(env, refRow.id, "paid", "Paid online (FPX) — confirmed with the bank");
          }
        }
      }
      return json({ ok: true });
    }

    /* ---------------- admin ---------------- */
    if (path.startsWith("/admin/")) {
      /* v1.0.0 — the admin passcode is the one secret protecting every order
         in the shop, so guessing it must cost something. Ten wrong keys in
         fifteen minutes and this address is refused until the window passes.
         A correct key clears the count. */
      const adminIp = callerIp(request);
      if (!(await keyOk(request, env))) {
        const gate = await hitLimit(env, `admin:${adminIp}`, 10, 15);
        return gate.allowed
          ? err("unauthorized", "Bad key", 401)
          : err("too_many", "Too many attempts — wait fifteen minutes.", 429);
      }
      await clearLimit(env, `admin:${adminIp}`);

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
          `INSERT INTO products (name, description, price_cents, stock, active, sort, sku, category, featured, track_stock)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10) RETURNING id`,
        ).bind(name, str(body?.description, 2000), price, Math.max(0, stock),
               body?.active === false ? 0 : 1, Math.round(Number(body?.sort ?? 100)),
               str(body?.sku, 40), category, body?.featured ? 1 : 0,
               body?.track_stock === false || body?.track_stock === 0 ? 0 : 1).first<{ id: number }>();
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
        /* v0.7.0 — 0 = always available (stock ignored), 1 = count pieces. */
        if (body?.track_stock !== undefined) push("track_stock", body.track_stock ? 1 : 0);
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

      /* v0.6.0 — the restock waitlist. Open requests first, oldest first:
         the person who has waited longest is the one to message next. */
      if (path === "/admin/notify" && method === "GET") {
        const { results } = await env.DB.prepare(
          `SELECT r.id, r.product_id, r.name, r.phone, r.created_at, r.notified_at,
                  p.name AS product_name, p.sku, p.stock
           FROM restock_requests r LEFT JOIN products p ON p.id = r.product_id
           ORDER BY (r.notified_at IS NOT NULL), r.created_at LIMIT 500`,
        ).all();
        return json({ requests: results });
      }
      const adminNotify = path.match(/^\/admin\/notify\/(\d+)$/);
      if (adminNotify && method === "PUT") {
        // Mark told. The row stays so you can see who was already contacted.
        await env.DB.prepare(`UPDATE restock_requests SET notified_at = datetime('now') WHERE id = ?1`)
          .bind(adminNotify[1]!).run();
        return json({ ok: true });
      }
      if (adminNotify && method === "DELETE") {
        await env.DB.prepare(`DELETE FROM restock_requests WHERE id = ?1`).bind(adminNotify[1]!).run();
        return json({ ok: true });
      }

      /* v0.7.0 — prove the gateway credentials without spending money.
         Read-only: reads the collection, creates no bill. */
      if (path === "/admin/billplz-test" && method === "POST") {
        return json(await billplzCheck(env));
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
         inventory in the portal??"): PULL stock from the agency portal's
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
        const r = await syncNow(env);
        const status = r.pull.configured || r.push.configured ? 200 : 501;
        return json(r, status);
      }

      /* v0.8.0 — is the sync actually alive? Unsent movements and the last
         pull time are the two numbers that tell you the two systems still
         agree; a sync that fails quietly is worse than no sync at all. */
      if (path === "/admin/sync-status" && method === "GET") {
        const state = await getState(env);
        /* `pending` means "still being retried" and `stuck` means "given up on
           until a human helps" — the same split flushStockEvents reports, so
           the two never disagree. Counting stuck rows in both made the numbers
           look twice as bad as they were. */
        const row = await env.DB.prepare(
          `SELECT SUM(CASE WHEN attempts <  25 THEN 1 ELSE 0 END) AS pending,
                  SUM(CASE WHEN attempts >= 25 THEN 1 ELSE 0 END) AS stuck,
                  MIN(created_at) AS oldest
           FROM stock_events WHERE sent_at IS NULL`,
        ).first<{ pending: number | null; stuck: number | null; oldest: string | null }>().catch(() => null);
        const { results: recent } = await env.DB.prepare(
          `SELECT sku, delta, reason, order_number, created_at, sent_at, attempts, last_error
           FROM stock_events ORDER BY created_at DESC LIMIT 20`,
        ).all().catch(() => ({ results: [] as unknown[] }));
        return json({
          pull_configured: pullConfigured(env),
          push_configured: pushConfigured(env),
          pending: row?.pending ?? 0,
          stuck: row?.stuck ?? 0,
          oldest_unsent: row?.oldest ?? null,
          last_pull_at: state.last_pull_at ?? null,
          last_pull_result: state.last_pull_result ?? null,
          last_push_at: state.last_push_at ?? null,
          last_push_error: state.last_push_error || null,
          recent,
        });
      }

      /* Give a stuck movement another go — after the SKU has been corrected
         on one side or the other. It resets the attempt count, never the
         event itself: the piece still moved. */
      if (path === "/admin/sync-retry" && method === "POST") {
        await env.DB.prepare(`UPDATE stock_events SET attempts = 0, last_error = NULL WHERE sent_at IS NULL`).run();
        return json(await flushStockEvents(env));
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
            /* The order never got paid — its reservation goes back on the
               shelf. `track_stock = 1` mirrors checkout: an always-available
               line never reserved anything, so putting stock back would
               invent pieces that were never taken. */
            const items = JSON.parse(o.items) as { product_id: number; qty: number }[];
            for (const it of items) {
              await env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2 AND track_stock = 1`)
                .bind(it.qty, it.product_id).run()
                .catch(() => env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2`)
                  .bind(it.qty, it.product_id).run()); // pre-0007 schema
            }
            /* …and tell the portal the pieces came back, mirroring the
               movement the order sent. SKUs are read now rather than from the
               order snapshot, because a code can be corrected in /admin
               between the order and the cancellation. */
            const { results: skus } = await env.DB.prepare(
              `SELECT id, sku FROM products WHERE id IN (${items.map((_, i) => `?${i + 1}`).join(",")})`,
            ).bind(...items.map((it) => it.product_id)).all<{ id: number; sku: string | null }>();
            await recordStockEvents(
              env,
              items.map((it) => ({ sku: skus.find((p) => p.id === it.product_id)?.sku, qty: it.qty })),
              "cancel", o.order_number,
            );
            ctx.waitUntil(flushStockEvents(env).then(() => undefined));
          }
          const tracking = action === "ship" ? str(body?.tracking_no, 60) : null;
          const courierKey = action === "ship" ? str(body?.tracking_courier, 20) : null;
          const courier = courierKey && COURIERS[courierKey] ? courierKey : null;
          await env.DB.prepare(
            `UPDATE orders SET status = ?1, payment_method = COALESCE(payment_method, ?2),
                    tracking_no = COALESCE(?3, tracking_no), updated_at = datetime('now') WHERE id = ?4`,
          ).bind(mv.to, action === "confirm_paid" ? "bank_transfer" : null, tracking, o.id).run();
          if (courier) {
            await env.DB.prepare(`UPDATE orders SET tracking_courier = ?1 WHERE id = ?2`)
              .bind(courier, o.id).run().catch(() => null); // pre-0009
          }
          const NOTES: Record<string, string> = {
            confirm_paid: "Payment confirmed — we are packing your order",
            ship: tracking ? `Handed to the courier — tracking ${tracking}` : "Handed to the courier",
            complete: "Delivered",
            cancel: "Order cancelled",
          };
          await recordOrderEvent(env, o.id, mv.to, NOTES[action] ?? null);
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
}
