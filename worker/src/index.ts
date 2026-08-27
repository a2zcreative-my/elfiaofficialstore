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
  billplzCheck, billplzConfigured, billplzCreateBill, billplzFailureHint,
  billplzSignatureConfigured, billplzSignatureOk, billplzVerifyPaid, storeUrl,
} from "./billplz";
import {
  callerIp, clearLimit, createSession, currentCustomer, destroySession, hashPassword, hitLimit,
  looksLikeEmail, normaliseEmail, normalisePhone, sessionCookie, clearCookie, sweepAuth,
  timingSafeEqual, verifyPassword, type Customer,
} from "./auth";
import {
  flushStockEvents, getState, pullConfigured, pushConfigured, recordStockEvents, setState, syncNow,
} from "./portal";
import { parseUploadedMap, patchCatalogPdf, patchUploadedCatalog, type CatalogProduct } from "./catalog-pdf";
import { recordHit, rollupTraffic, trafficFeed } from "./traffic";

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
  /** v1.22.0 — what the downloaded catalog file is CALLED ("Catalog ELFIA
      v1"); ".pdf" is appended in code. Set in wrangler.toml so a new
      catalog version is a one-line edit, never a code change. */
  CATALOG_FILENAME?: string;
}

const VERSION = "1.34.0";
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

/**
 * v1.13.0 — the delivery numbers are the PORTAL's to set.
 *
 * The CEO, 26-08-2026: "I want to have the authority to update the shipping
 * fees which is above RM45.00, I will provide a free delivery fees."
 *
 * Both used to live in wrangler.toml, which made changing what delivery
 * costs a code edit and a deploy — something she has to ask someone for.
 * Prices, stock, photos and collections already come from the portal;
 * delivery was the odd one out, and it is the number most likely to change
 * during a campaign.
 *
 * They now come from `sync_state`, written by the bridge pull (portal.ts)
 * whenever the feed carries a `settings` block. The wrangler var is the
 * FALLBACK: used until the first pull lands, and if the portal ever stops
 * sending them — absent means "keep what you have", the feed's oldest rule.
 * No new table and no migration; sync_state has been the store's key/value
 * scratchpad since 0008.
 *
 * Async because it reads the database now. The checkout caller is the one
 * that matters: this is the number the customer is actually charged, and it
 * must be the same number the shop quoted.
 */
async function storeConfig(env: Env) {
  const got = await env.DB.prepare(
    `SELECT key, value FROM sync_state WHERE key IN ('shipping_cents', 'free_above_cents')`,
  ).all<{ key: string; value: string }>().catch(() => ({ results: [] as { key: string; value: string }[] }));
  const portal = Object.fromEntries((got.results ?? []).map((r) => [r.key, r.value]));

  /* A stored value only wins if it parses to a sane number of sen. A blank
     or corrupted row must never silently make delivery free, or charge
     RM 10,000 for it. */
  const pick = (key: string, fallback: number): number => {
    const n = Number(portal[key]);
    return Number.isFinite(n) && n >= 0 && n <= 100_000 ? Math.round(n) : fallback;
  };

  return {
    bank_line: env.BANK_LINE ?? "REPLACE — set BANK_LINE in worker/wrangler.toml",
    whatsapp_digits: env.WHATSAPP_DIGITS ?? "60000000000",
    shipping_cents: pick("shipping_cents", intVar(env.SHIPPING_CENTS, 1000)),
    free_above_cents: pick("free_above_cents", intVar(env.FREE_ABOVE_CENTS, 4500)),
    gateway: billplzConfigured(env),
    hold_hours: intVar(env.ORDER_HOLD_HOURS, 12),
    /** Which of the two answered — so /admin and the health probe can tell
        "the portal set this" apart from "nobody has set it yet". */
    delivery_source: portal.shipping_cents === undefined ? "store" : "portal",
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

/* v1.12.0 — ONE implementation of "move this order forward", shared by the
   store's own /admin and by the portal over the bridge. The CEO runs the
   shop from the portal, so the portal must be able to confirm a payment and
   enter a tracking number — and the day those two screens disagree about
   what "cancel" does to the shelf is the day the counts drift. So there is
   one copy, and both callers go through it. */
const ORDER_MOVES: Record<string, { from: Status[]; to: Status }> = {
  confirm_paid: { from: ["pending_payment", "payment_review"], to: "paid" },
  ship:         { from: ["paid"], to: "shipped" },
  complete:     { from: ["shipped"], to: "completed" },
  cancel:       { from: ["pending_payment", "payment_review"], to: "cancelled" },
};

async function applyOrderAction(
  env: Env, ctx: ExecutionContext, o: OrderRow, action: string,
  body: Record<string, unknown> | null,
): Promise<Response> {
  const mv = ORDER_MOVES[action];
  if (!mv) return err("invalid_input", "Unknown action", 400);
  if (!mv.from.includes(o.status)) {
    return err("invalid_input", `Cannot ${action} an order that is ${o.status}. Paid orders are refunded manually (WhatsApp), never silently cancelled.`, 409);
  }
  if (action === "cancel") {
    /* The order never got paid — its reservation goes back on the shelf.
       `track_stock = 1` mirrors checkout: an always-available line never
       reserved anything, so putting stock back would invent pieces that were
       never taken. */
    const items = JSON.parse(o.items) as { product_id: number; qty: number }[];
    for (const it of items) {
      await env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2 AND track_stock = 1`)
        .bind(it.qty, it.product_id).run()
        .catch(() => env.DB.prepare(`UPDATE products SET stock = stock + ?1 WHERE id = ?2`)
          .bind(it.qty, it.product_id).run()); // pre-0007 schema
    }
    /* …and tell the portal the pieces came back, mirroring the movement the
       order sent. SKUs are read now rather than from the order snapshot,
       because a code can be corrected between the order and the
       cancellation. */
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
  return json({ ok: true, status: mv.to, tracking_no: tracking ?? o.tracking_no ?? null });
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
      /* v1.2.0 — fold the last few minutes of visits into the day's
         aggregates and prune raw hits past retention. Last on purpose: the
         inventory sync moves money and stock; this only moves a map. */
      await rollupTraffic(env);
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
      /* Column probes for migrations that only ALTER (0012 adds columns, so
         table() cannot see it). */
      const probe = async (q: string): Promise<boolean> => {
        try { await env.DB.prepare(q).first(); return true; } catch { return false; }
      };
      const [accounts, progress, syncReady, traffic, consent, portalProducts, saleSlides, framing, slideZoom, cutout] = await Promise.all([
        table("customers"), table("order_events"), table("stock_events"), table("traffic_hits"),
        probe("SELECT marketing_consent_at FROM customers LIMIT 1"),
        probe("SELECT portal_pending FROM products LIMIT 1"),
        probe("SELECT compare_price_cents FROM products LIMIT 1"),
        probe("SELECT focus_x FROM portal_slides LIMIT 1"),
        probe("SELECT zoom FROM portal_slides LIMIT 1"),
        probe("SELECT cutout_key FROM portal_slides LIMIT 1"),
      ]);
      const migrationsCurrent = accounts && progress && syncReady && traffic && consent && portalProducts && saleSlides && framing && slideZoom && cutout;
      const cfg = await storeConfig(env);
      return json({
        ok: db && migrationsCurrent, version: VERSION, db, r2,
        migrations_current: migrationsCurrent,
        ...(migrationsCurrent ? {} : {
          migrations_fix: "cd worker && npx wrangler d1 migrations apply elfia-store --remote",
          missing: [
            ...(accounts ? [] : ["customers (0010 — sign in/sign up will fail)"]),
            ...(progress ? [] : ["order_events (0009 — order progress will fail)"]),
            ...(syncReady ? [] : ["stock_events (0008 — inventory sync will fail)"]),
            ...(traffic ? [] : ["traffic_hits (0011 — visitor traffic will not count)"]),
            ...(consent ? [] : ["marketing_consent (0012 — PDPA consent will not record)"]),
            ...(portalProducts ? [] : ["portal_products (0013 — the portal cannot create products or send photos)"]),
            ...(saleSlides ? [] : ["sale_price_and_slides (0014 — discounts and the portal carousel will not show)"]),
            ...(framing ? [] : ["slide_framing (0015 — the portal cannot aim or un-crop a carousel photo)"]),
            ...(slideZoom ? [] : ["slide_zoom (0016 — the portal cannot zoom a carousel photo out)"]),
            ...(cutout ? [] : ["slide_cutout (0017 — the carousel cannot show a cut-out model)"]),
          ],
        }),
        admin_key_configured: Boolean(env.ADMIN_KEY),
        bank_line_configured: !cfg.bank_line.startsWith("REPLACE"),
        gateway_configured: cfg.gateway,
        gateway_signature_configured: billplzSignatureConfigured(env),
        store_url: storeUrl(env),
        order_hold_hours: intVar(env.ORDER_HOLD_HOURS, 12),
        /* v1.13.0 — what delivery costs, and WHICH side decided it. On the
           live health endpoint this is how you confirm a change made in the
           portal actually landed, without opening the shop and squinting at
           the announcement bar. "store" means nobody has set it in the
           portal yet and wrangler.toml is still answering. */
        shipping_cents: cfg.shipping_cents,
        free_above_cents: cfg.free_above_cents,
        delivery_from: cfg.delivery_source,
        bridge_pull_configured: pullConfigured(env),
        bridge_push_configured: pushConfigured(env),
      });
    }

    if (path === "/store-config" && method === "GET") return json(await storeConfig(env));

    /* ---- the catalog, as a real PDF, priced now (v1.18.0) ----
     *
     * The CEO: "I want my own PDF ... I also want to make sure this PDF able
     * to fetch the actual prices of my Product!!!"
     *
     * A PDF sitting in a folder cannot fetch anything, ever — it is a
     * photograph of a moment. So the file is BUILT WHEN SOMEBODY ASKS FOR
     * IT, from the prices in this database a second earlier. Every copy
     * anyone views, prints or forwards on WhatsApp was correct when it was
     * made, and nobody re-exports anything by hand.
     *
     * Cached for a minute: the portal syncs on that same cadence, so a
     * shorter cache would only rebuild a document that could not have
     * changed. Nothing here is private — it is the products and prices
     * /api/v1/products already serves to anyone. */
    if (path === "/catalog.pdf" && (method === "GET" || method === "HEAD")) {
      /* v1.22.0 — the document's NAME (CEO: "Catalog PDF will be name as
         Catalog ELFIA v1"). Whoever downloads, saves or forwards this file
         gets that name — on the pretty link and on the old /api/v1/ one
         alike, so copies already shared benefit too. Sanitised because a
         header value must stay a single clean line whatever the toml says. */
      const catalogName = `${(env.CATALOG_FILENAME || "Catalog ELFIA v1").replace(/["\\\r\n]/g, "").trim() || "ELFIA Catalog"}.pdf`;

      /* v1.23.0 — the share THUMBNAIL (CEO: "catalog missing thumbnail for
         the PDF share!"). A PDF cannot carry og: tags, so a link to it never
         gets a preview card — the platforms' crawlers need HTML. So the
         crawlers GET HTML: when the request comes from a link-preview bot
         (WhatsApp, Facebook, Telegram, X, LinkedIn, Slack, Discord — they
         all announce themselves), this route answers with a tiny page whose
         og:image is the SAME stable cover the /catalog page previews with
         (/api/v1/catalog-cover — the uploaded cover when one exists, the
         shipped page-1 otherwise). Every human, and every other client,
         still gets the PDF itself. One cover route feeds every surface, so
         the thumbnails can never disagree. */
      const shareUA = request.headers.get("User-Agent") ?? "";
      const isPreviewBot = /WhatsApp|facebookexternalhit|Facebot|Twitterbot|TelegramBot|LinkedInBot|Slackbot|Discordbot|SkypeUriPreview|Pinterestbot/i.test(shareUA);
      if (isPreviewBot) {
        const shareBase = storeUrl(env);
        const shareTitle = catalogName.replace(/\.pdf$/i, "");
        const previewHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${shareTitle} — ELFIA</title>
<meta property="og:type" content="website">
<meta property="og:site_name" content="ELFIA">
<meta property="og:title" content="${shareTitle}">
<meta property="og:description" content="Every shade we make, with today's prices. First Sight, Forever Yours.">
<meta property="og:url" content="${shareBase}/catalog.pdf">
<meta property="og:image" content="${shareBase}/api/v1/catalog-cover">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:image:width" content="1100">
<meta property="og:image:height" content="1556">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${shareTitle}">
<meta name="twitter:image" content="${shareBase}/api/v1/catalog-cover">
</head><body><p><a href="${shareBase}/catalog.pdf">${shareTitle} (PDF)</a></p></body></html>`;
        return new Response(method === "HEAD" ? null : previewHtml, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            /* Five minutes, same as the cover route: a new uploaded catalog
               should change the card without a long wait, and the platforms
               cache previews on their own side anyway. */
            "Cache-Control": "public, max-age=300",
            "X-Catalog-Preview": "bot",
          },
        });
      }

      if (method === "HEAD") {
        /* v1.25.0 — a HEAD probe names the SOURCE too (two cheap R2 head
           calls, no document built): the /catalog page asks this before
           deciding whether to draw the CEO's uploaded pages inline or its
           own tile grid, and must not download megabytes to find out. */
        const [hSrc, hMap] = await Promise.all([
          env.MEDIA.head("catalog/source.pdf"), env.MEDIA.head("catalog/map.json"),
        ]);
        return new Response(null, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${catalogName}"`,
            "Cache-Control": "public, max-age=60",
            "X-Catalog-Source": hSrc && hMap ? "portal" : "shipped",
          },
        });
      }
      const { results: rows } = await env.DB.prepare(
        `SELECT id, name, price_cents, compare_price_cents, sku
           FROM products
          WHERE active = 1 AND price_cents > 0
          ORDER BY id
          LIMIT 500`,
      ).all<CatalogProduct>().catch(() => ({ results: [] as CatalogProduct[] }));

      try {
        /* v1.21.0 — the CEO's own upload wins when one has arrived over the
           bridge (PDF + map together in R2, marker-gated by the pull); the
           shipped designer file with its extracted PRICE_SITES is the
           standing fallback. Either way the document is patched fresh from
           the database on every request. */
        let r;
        let sourceName = "shipped";
        const upSrc = await env.MEDIA.get("catalog/source.pdf");
        const upMapRaw = upSrc ? await env.MEDIA.get("catalog/map.json") : null;
        const upMap = upMapRaw ? parseUploadedMap(await upMapRaw.text()) : null;
        if (upSrc && upMap) {
          r = await patchUploadedCatalog(await upSrc.arrayBuffer(), upMap, rows, {
            linkBase: storeUrl(env),
            generatedAt: new Date(),
          });
          sourceName = "portal";
        } else {
          r = await patchCatalogPdf(rows, {
            origin: env.STORE_ORIGIN || url.origin,
            /* Links always carry the PUBLIC shop. A saved PDF travels; its
               links must work wherever the copy ends up, which a local or
               preview address never would. */
            linkBase: storeUrl(env),
            generatedAt: new Date(),
          });
        }
        return new Response(r.bytes, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": `inline; filename="${catalogName}"`,
            "Cache-Control": "public, max-age=60",
            "X-Content-Type-Options": "nosniff",
            /* Which printed prices could not be matched to a live product,
               so a rename that silently un-links a tile is visible in one
               curl rather than discovered in print. Headers, not the body:
               the body is her document. */
            "X-Catalog-Patched": String(r.patched.length),
            "X-Catalog-Links": String(r.links),
            "X-Catalog-Source": sourceName,
            "X-Catalog-Unmatched": r.unmatched.map((u) => u.label).join("; ").slice(0, 900) || "none",
          },
        });
      } catch (e) {
        return err("catalog_failed",
          `The catalog could not be built just now (${e instanceof Error ? e.message : "unknown"}).`, 500);
      }
    }

    /* v1.21.0 — the catalog's cover, for the share preview and the /catalog
       page. The CEO's uploaded cover when one exists; the shipped cover
       otherwise. One stable URL, so a new catalog changes the WhatsApp
       preview with no site rebuild. */
    if (path === "/catalog-cover" && method === "GET") {
      const up = await env.MEDIA.get("catalog/cover.jpg");
      if (up) {
        return new Response(up.body, {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" },
        });
      }
      const shipped = await fetch(`${env.STORE_ORIGIN || url.origin}/lookbook/page-1.jpg`);
      if (shipped.ok) {
        return new Response(shipped.body, {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" },
        });
      }
      return err("not_found", "No cover available", 404);
    }

    /* v1.21.0 — remove an uploaded catalog and return to the shipped one.
       Bridge-key gated: the portal (and the test rig) may do this; the
       public may not. */
    if (path === "/bridge/catalog" && method === "DELETE") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const givenCat = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(givenCat, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      await env.MEDIA.delete("catalog/source.pdf");
      await env.MEDIA.delete("catalog/map.json");
      await env.MEDIA.delete("catalog/cover.jpg");
      await setState(env, "catalog_marker", "");
      return json({ ok: true, source: "shipped" });
    }

    /* v1.32.0 — the /catalog hover backdrop (CEO: "for the cut out
       background I want to have an option for me to add this background if
       require and this I can upload by myself in portal!"). One stable URL,
       same shape as /catalog-cover: the portal's uploaded image when one
       exists, the shipped ELFIA backdrop otherwise — so the page never has
       to know which it is getting, and an upload swaps every tile's hover
       with no site rebuild. */
    if (path === "/tile-backdrop" && method === "GET") {
      const up = await env.MEDIA.get("catalog/backdrop.img");
      if (up) {
        return new Response(up.body, {
          headers: {
            "Content-Type": up.httpMetadata?.contentType ?? "image/jpeg",
            "Cache-Control": "public, max-age=300",
          },
        });
      }
      const shipped = await fetch(`${env.STORE_ORIGIN || url.origin}/collection/elfia-backdrop.jpg`);
      if (shipped.ok) {
        return new Response(shipped.body, {
          headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=300" },
        });
      }
      return err("not_found", "No backdrop available", 404);
    }

    /* v1.32.0 — remove an uploaded backdrop and return to the shipped one.
       Bridge-key gated, exactly like /bridge/catalog above. */
    if (path === "/bridge/backdrop" && method === "DELETE") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const givenBd = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(givenBd, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      await env.MEDIA.delete("catalog/backdrop.img");
      await setState(env, "backdrop_marker", "");
      return json({ ok: true, source: "shipped" });
    }

    /* v1.2.0 — the visit beacon. Anonymous by construction (see traffic.ts:
       no IP stored, daily-rotating hash, no cookie); always 204, because the
       storefront must never wait on, or surface, analytics. */
    if (path === "/t" && method === "POST") {
      if (!originAllowed(request.headers.get("Origin"), env)) return new Response(null, { status: 204 });
      return recordHit(request, env, new URL(storeUrl(env)).host);
    }

    if (path === "/products" && method === "GET") {
      /* v0.2.0 columns (sku/category/featured) with a pre-0002 fallback, so
         a worker deployed ahead of its migration degrades instead of 500s. */
      let results: Record<string, unknown>[];
      try {
        /* v1.7.0 — compare_price_cents (the struck-through sale price). */
        results = (await env.DB.prepare(
          `SELECT id, name, description, price_cents, compare_price_cents, stock, image_key, active, sort, sku, category, featured, track_stock
           FROM products WHERE active = 1 ORDER BY sort, id DESC LIMIT 200`,
        ).all()).results;
      } catch {
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
      }
      /* v1.7.0 — the portal-run hero carousel rides the same response the
         home page already fetches: one request paints the whole shopfront.
         Empty/absent = the page falls back to its shipped campaign slides. */
      let slides: Record<string, unknown>[] = [];
      try {
        /* v1.8.0 — framing columns, with the pre-0015 fallback: a worker
           published ahead of its migration must still draw the carousel,
           just without the portal's aiming. */
        try {
          slides = (await env.DB.prepare(
            `SELECT portal_id, image_key, title, subtitle, sort, focus_x, focus_y, fit, zoom,
                    cutout_key, cutout_side, cutout_scale
               FROM portal_slides ORDER BY sort, portal_id LIMIT 12`,
          ).all()).results;
        } catch {
          slides = (await env.DB.prepare(
            `SELECT portal_id, image_key, title, subtitle, sort FROM portal_slides ORDER BY sort, portal_id LIMIT 12`,
          ).all()).results;
        }
      } catch { /* pre-0014 */ }
      return json({ products: results, ...(slides.length ? { slides } : {}) });
    }

    const prodMatch = path.match(/^\/products\/(\d+)$/);
    if (prodMatch && method === "GET") {
      let product: unknown;
      try {
        product = await env.DB.prepare(
          `SELECT id, name, description, price_cents, compare_price_cents, stock, image_key, active, sort, sku, category, featured, track_stock
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

    /* Product photos are public; receipts are NOT under this route.

       v1.5.0 — the pattern is matched against the DECODED path. The
       storefront builds this URL with encodeURIComponent over the whole key,
       which turns the slash in "products/12-….jpg" into %2F, and
       URL.pathname keeps it that way — so every photo uploaded in /admin was
       answered 404 while every photo shipped under /collection/ (which never
       comes through here) looked fine. It surfaced the moment the portal
       started delivering photos in v1.5.0. lib/config.ts no longer encodes
       the slash either; this side stays tolerant so an already-deployed page
       is not left broken. */
    let decodedPath = path;
    try { decodedPath = decodeURIComponent(path); } catch { /* malformed % — match the raw form */ }
    /* v1.7.0: slides/ joined products/ — both are public product imagery
       copied from the portal into our own R2. Receipts stay elsewhere. */
    const mediaMatch = decodedPath.match(/^\/media\/((?:products|slides)\/[\w.-]+)$/);
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
      const cfg = await storeConfig(env);
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

      /* v1.3.0 — PDPA marketing consent at checkout: recorded only when the
         box was ticked. Kept on the ORDER (a guest has no account row), and
         stamped onto the account too when the buyer is signed in — first
         consent date wins. Armored: pre-0012 places the order and simply
         cannot record consent yet. */
      if (body.customer?.marketing === true) {
        await env.DB.prepare(`UPDATE orders SET marketing_consent = 1 WHERE token = ?1`)
          .bind(token).run().catch(() => null);
        if (signedIn) {
          await env.DB.prepare(
            `UPDATE customers SET marketing_consent_at = COALESCE(marketing_consent_at, datetime('now')) WHERE id = ?1`,
          ).bind(signedIn.id).run().catch(() => null);
        }
      }

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
        created_at: o.created_at, config: await storeConfig(env),
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
    /* v1.9.0 — "still the discount is not live update!!!!"
       The bridge refreshes on a schedule, so a price the CEO changes in the
       portal reaches the shop on the next tick, not the instant she types
       it. That is correct behaviour and it still felt broken, because there
       was no way to say "now" from the portal — the only sync button lived
       behind ADMIN_KEY in a store screen she does not use.
       This is that button's engine: same shared bridge key as every other
       bridge route, no admin key, and it does exactly what the cron does. */
    /* v1.9.0 — a link a customer can SHARE, whose preview is the product.
       The CEO: "thumbnail also should take the actual photo of based on the
       product that customer want to share on the WhatsApp or any social
       platform."
       WhatsApp, Messenger, Telegram and the rest read og: tags out of the
       HTML at the URL itself. The shopfront is a static export where every
       product lives at /p?id=N — one file, one set of tags — so every shared
       product showed the same campaign photo. This route answers with a tiny
       page whose tags are THAT product's, then sends a real visitor straight
       on to the product page. Public on purpose: a share link people cannot
       open is not a share link. */
    const shareMatch = path.match(/^\/share\/(\d+)$/);
    if (shareMatch && (method === "GET" || method === "HEAD")) {
      const row = await env.DB.prepare(
        `SELECT id, name, description, price_cents, image_key FROM products WHERE id = ?1 AND active = 1`,
      ).bind(shareMatch[1]!).first<{
        id: number; name: string; description: string | null; price_cents: number; image_key: string | null;
      }>().catch(() => null);

      const origin = storeUrl(env) || "";
      const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      const target = row ? `${origin}/p?id=${row.id}` : `${origin}/shop`;
      const title = row ? `${row.name} — ELFIA` : "ELFIA OFFICIAL STORE";
      const price = row ? `RM ${(row.price_cents / 100).toFixed(2)}` : "";
      const desc = row
        ? `${price} · ${(row.description ?? "First Sight, Forever Yours").replace(/\s+/g, " ").slice(0, 160)}`
        : "First Sight, Forever Yours";
      /* Per-segment encoding, the same rule the storefront uses — a raw
         slash inside the key would 404 the crawler's fetch and the preview
         would silently fall back to nothing. */
      const img = row?.image_key
        ? `${origin}/api/v1/media/${row.image_key.split("/").map(encodeURIComponent).join("/")}`
        : `${origin}/collection/campaign-studio.jpg`;

      const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="product">
<meta property="og:site_name" content="ELFIA OFFICIAL STORE">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${esc(img)}">
<meta property="og:image:width" content="900">
<meta property="og:image:height" content="1125">
<meta property="og:url" content="${esc(target)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${esc(img)}">
<meta http-equiv="refresh" content="0; url=${esc(target)}">
<link rel="canonical" href="${esc(target)}">
</head><body style="font-family:system-ui;padding:2rem;text-align:center">
<p>Opening ${esc(row ? row.name : "the shop")}…</p>
<p><a href="${esc(target)}">Continue to ELFIA</a></p>
<script>location.replace(${JSON.stringify(target)});</script>
</body></html>`;
      return new Response(method === "HEAD" ? null : html, {
        status: 200,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          /* Crawlers cache previews hard; five minutes is long enough to
             survive a burst of shares and short enough that a photo changed
             in the portal shows up the same day. */
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    /* v1.12.0 — the portal moves an order forward.
       The CEO: "elfia web order should be able to update the tracking number
       so that customer can track the order based on the order number that
       filled by staff in the portal". Her Web Orders tab could only WATCH;
       confirming a payment and entering a tracking number still needed the
       store's /admin, which is unreachable because ADMIN_KEY was never set.
       So the same shared transition used by /admin is exposed here, behind
       the same bridge key as every other bridge route — no admin key, no
       second implementation that could drift.
       Addressed by ORDER NUMBER, which is what the portal shows and what a
       human types, rather than by the store's internal row id. */
    const bridgeOrder = path.match(/^\/bridge\/orders\/([A-Za-z0-9-]{1,40})$/);
    if (bridgeOrder && method === "POST") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const given = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(given, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
      const action = str(body?.action, 20) ?? "";
      const o = await env.DB.prepare(`SELECT * FROM orders WHERE order_number = ?1`)
        .bind(decodeURIComponent(bridgeOrder[1]!)).first<OrderRow>();
      if (!o) return err("not_found", "No order with that number", 404);
      if (!ORDER_MOVES[action]) return err("invalid_input", "Unknown action", 400);
      return applyOrderAction(env, ctx, o, action, body);
    }

    /* v1.14.0 — prove the gateway credentials WITHOUT taking a payment.
     *
     * billplzCheck() already existed but only /admin could reach it, and
     * ADMIN_KEY is not set on this shop — so the first person to discover a
     * mistyped API key would have been a customer, halfway through paying.
     * This is the same read-only check behind the bridge key, which IS set.
     * It reads one collection with the secret key: it creates nothing,
     * charges nothing and moves no money.
     *
     * The response deliberately carries no key material — only whether the
     * key works, which account mode it is in, and a sentence saying what to
     * fix if it does not. */
    if (path === "/bridge/payment-check" && method === "GET") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const givenPc = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(givenPc, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      const check = await billplzCheck(env);
      /* v1.14.1 — the last real failure, in Billplz's own words, plus the
         sentence that names the fix. "The key works" is not the same claim
         as "the last customer could pay": a bill can be refused for reasons
         a collection read never sees. */
      const st = await getState(env);
      return json({
        ...check,
        last_gateway_error: st.last_gateway_error ?? null,
        last_gateway_hint: st.last_gateway_hint ?? null,
        signature_key_set: billplzSignatureConfigured(env),
        /* Live money and a sandbox key is the one combination that looks
           fine in testing and fails in front of a customer. */
        warning: check.ok && check.sandbox
          ? "This shop is pointed at the Billplz SANDBOX. Real customers cannot pay. Remove BILLPLZ_SANDBOX from wrangler.toml and redeploy."
          : check.ok && !billplzSignatureConfigured(env)
            ? "Working, but BILLPLZ_XSIGN is not set — callbacks are accepted on the authenticated re-query alone. Set it."
            : null,
      });
    }

    if (path === "/bridge/sync-now" && method === "POST") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const given = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(given, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      const r = await syncNow(env);
      return json({
        ok: !r.pull.error,
        updated: r.pull.updated.length,
        prices: r.pull.price_updated.length,
        created: r.pull.created.length,
        photos: r.pull.photos,
        error: r.pull.error ?? null,
      });
    }

    if (path === "/bridge/orders" && method === "GET") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const given = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(given, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);

      const since = str(url.searchParams.get("since"), 40);
      /* v1.3.0: marketing_consent rides along so the portal's marketing
         lists carry ONLY people who ticked the PDPA box. Fallback query for
         a pre-0012 database keeps the feed alive without the column. */
      let results: (Record<string, unknown> & { changed_at: string; items: string })[];
      try {
        results = (await env.DB.prepare(
          `SELECT order_number, status, customer_name, phone, address, items,
                  subtotal_cents, shipping_cents, total_cents, payment_method,
                  tracking_no, tracking_courier, marketing_consent, created_at, updated_at,
                  COALESCE(updated_at, created_at) AS changed_at
           FROM orders
           ${since ? "WHERE COALESCE(updated_at, created_at) > ?1" : ""}
           ORDER BY changed_at, id LIMIT 200`,
        ).bind(...(since ? [since] : [])).all<Record<string, unknown> & { changed_at: string; items: string }>()).results;
      } catch {
        results = (await env.DB.prepare(
          `SELECT order_number, status, customer_name, phone, address, items,
                  subtotal_cents, shipping_cents, total_cents, payment_method,
                  tracking_no, tracking_courier, created_at, updated_at,
                  COALESCE(updated_at, created_at) AS changed_at
           FROM orders
           ${since ? "WHERE COALESCE(updated_at, created_at) > ?1" : ""}
           ORDER BY changed_at, id LIMIT 200`,
        ).bind(...(since ? [since] : [])).all<Record<string, unknown> & { changed_at: string; items: string }>()).results;
      }

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

    /* ---- traffic feed for the agency portal (v1.2.0, bridge feed D) ----
       Same key, same constant-time check, same pull shape as the orders
       feed above. `since` is the newest FINAL day the portal already holds
       (final = older than the Malaysian yesterday); the response carries
       every later day's aggregate rows. Today is included as a RUNNING
       total — the portal must overwrite its copy of any day it receives,
       never add to it, and advance its cursor only to `final_through`. */
    if (path === "/bridge/traffic" && method === "GET") {
      if (!env.BRIDGE_KEY) return err("not_configured", "Set the BRIDGE_KEY secret first", 501);
      const given = request.headers.get("X-Bridge-Key") ?? "";
      if (!timingSafeEqual(given, env.BRIDGE_KEY)) return err("unauthorized", "Bad key", 401);
      const since = str(url.searchParams.get("since"), 10);
      return json(await trafficFeed(env, since && /^\d{4}-\d{2}-\d{2}$/.test(since) ? since : null));
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

      /* v1.3.0 — PDPA marketing consent: recorded ONLY when the box was
         ticked, with its timestamp; an untouched form consents to nothing.
         A separate armored UPDATE (not part of the INSERT) so a pre-0012
         database still signs people up — it just cannot record consent yet. */
      if (body?.marketing === true) {
        await env.DB.prepare(`UPDATE customers SET marketing_consent_at = datetime('now') WHERE id = ?1`)
          .bind(created.id).run().catch(() => null);
      }

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
      /* v1.3.0 — the account page shows the marketing toggle's real state.
         Armored: pre-0012 simply reports false. */
      const consent = await env.DB.prepare(`SELECT marketing_consent_at FROM customers WHERE id = ?1`)
        .bind(me.id).first<{ marketing_consent_at: string | null }>().catch(() => null);
      return json({ customer: { id: me.id, email: me.email, name: me.name, phone: me.phone, address: me.address, marketing: Boolean(consent?.marketing_consent_at) } });
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
      /* v1.3.0 — PDPA: consent is withdrawable in the same place it was
         given. `marketing: true` stamps now (keeping an earlier date if one
         exists — the FIRST consent is the legal fact); `false` clears it;
         absent leaves it untouched. Armored pre-0012.

         Consent is a fact about the PERSON, and the orders feed is how it
         travels to the marketing list — so both directions also rewrite the
         flag on this customer's ORDERS and bump updated_at, which makes the
         feed re-send them. Withdrawal therefore reaches the portal within
         one poll, not never. Phone-matched guest orders are included on
         withdrawal (stop-marketing must catch everything) but NOT on grant
         (a tick today cannot consent an order someone placed as a guest
         under a phone number that may have changed hands). */
      let marketing: boolean | undefined;
      if (body?.marketing === true) {
        await env.DB.prepare(
          `UPDATE customers SET marketing_consent_at = COALESCE(marketing_consent_at, datetime('now')) WHERE id = ?1`,
        ).bind(me.id).run().catch(() => null);
        await env.DB.prepare(
          `UPDATE orders SET marketing_consent = 1, updated_at = datetime('now') WHERE customer_id = ?1 AND marketing_consent = 0`,
        ).bind(me.id).run().catch(() => null);
        marketing = true;
      } else if (body?.marketing === false) {
        await env.DB.prepare(`UPDATE customers SET marketing_consent_at = NULL WHERE id = ?1`)
          .bind(me.id).run().catch(() => null);
        const digits = normalisePhone(phone);
        await env.DB.prepare(
          `UPDATE orders SET marketing_consent = 0, updated_at = datetime('now')
           WHERE marketing_consent = 1 AND (customer_id = ?1 OR (?2 != '' AND phone_digits = ?2))`,
        ).bind(me.id, digits).run().catch(() => null);
        marketing = false;
      }
      return json({ customer: { id: me.id, email: me.email, name, phone, address, ...(marketing === undefined ? {} : { marketing }) } });
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
      if (!bill.ok) {
        /* v1.14.1 — WRITE DOWN WHY.
         *
         * The CEO, 26-08, on the live shop: "This appear on the gateway
         * payment!" — the customer-facing "Payment gateway unavailable".
         * That message was the whole of what the shop knew, because the
         * failure reason was thrown away at the point it was learned. A
         * wrong key, a sandbox key on a live shop, an unactivated account
         * and a rejected phone number all produced the same dead end.
         *
         * Billplz's own reply is kept in sync_state, where the portal reads
         * it (ELFIA tab) and /bridge/payment-check reports it. It never
         * reaches the customer: they get a sentence they can act on, and
         * bank transfer, which works. */
        await setState(env, "last_gateway_error",
          `${new Date().toISOString()} · order ${o.order_number} · Billplz ${bill.status || "unreachable"}: ${bill.detail}`);
        await setState(env, "last_gateway_hint", billplzFailureHint(bill.status, env.BILLPLZ_SANDBOX === "1"));
        return err("gateway_error",
          "Online banking isn't going through at the moment — please pay by bank transfer below. Your order and its prices are unchanged.",
          502);
      }
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
      /* v1.14.0 — `bill` tells the page whether there is anything to wait
         FOR. No bill was ever created for this order, so no payment can be
         in flight, and polling for thirty seconds would only delay telling
         the customer the truth. */
      if (!billplzConfigured(env) || !o.bill_id) return json({ status: o.status, paid: false, bill: false });
      if (await billplzVerifyPaid(env, o.bill_id)) {
        await env.DB.prepare(
          `UPDATE orders SET status = 'paid', payment_method = 'fpx', updated_at = datetime('now')
           WHERE id = ?1 AND status IN ('pending_payment', 'payment_review')`,
        ).bind(o.id).run();
        await recordOrderEvent(env, o.id, "paid", "Paid online (FPX) — confirmed with the bank");
        return json({ status: "paid", paid: true });
      }
      /* A bill exists and Billplz has not (yet) said it is paid. The page
         keeps polling on this answer, because this is the one case where
         waiting is the right thing to do. */
      return json({ status: o.status, paid: false, bill: true });
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

      /* v1.8.1 — the "From portal" review queue is GONE.
         The CEO: "/admin → From portal this should not be appear in ELFIA
         system! all inside the portal … dont make this system conflict and
         become unstable!!!" She is right: two screens that both decide what
         is published is how the catalogue drifts. Publishing lives in the
         portal's ELFIA tab and nowhere else. The route is answered rather
         than deleted so an old bookmark or a cached admin page gets a plain
         explanation instead of a 404 that looks like a broken shop. */
      const adminPublish = path.match(/^\/admin\/products\/(\d+)\/publish$/);
      if (adminPublish && method === "POST") {
        return err("gone",
          "Publishing moved to the portal's ELFIA Store tab — tick Publish there and the shop follows within 5 minutes.",
          410);
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
          /* v1.5.0 — photo trouble is reported on its own line so a clean
             count sync cannot make a failed photo look like success. */
          last_photo_error: state.last_photo_error || null,
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

        if (action && ORDER_MOVES[action]) {
          return applyOrderAction(env, ctx, o, action, body);
        }
        if (body?.admin_notes !== undefined) {
          await env.DB.prepare(`UPDATE orders SET admin_notes = ?1, updated_at = datetime('now') WHERE id = ?2`)
            .bind(typeof body.admin_notes === "string" ? body.admin_notes.slice(0, 1000) : null, o.id).run();
          return json({ ok: true });
        }
        /* v1.3.0 — PDPA withdrawal for a GUEST (no account page to untick):
           they WhatsApp the shop, the shop clears it here. Clears every order
           under the same phone and, if the order belongs to an account, that
           account's consent too — withdrawal must catch everything. The
           updated_at bump re-sends the rows through the orders feed, so the
           portal's marketing list drops them within one poll. */
        if (body?.action === "withdraw_marketing") {
          await env.DB.prepare(
            `UPDATE orders SET marketing_consent = 0, updated_at = datetime('now')
             WHERE marketing_consent = 1 AND (id = ?1 OR (phone_digits != '' AND phone_digits = (SELECT phone_digits FROM orders WHERE id = ?1)))`,
          ).bind(o.id).run().catch(() => null);
          await env.DB.prepare(
            `UPDATE customers SET marketing_consent_at = NULL
             WHERE id = (SELECT customer_id FROM orders WHERE id = ?1 AND customer_id IS NOT NULL)`,
          ).bind(o.id).run().catch(() => null);
          return json({ ok: true });
        }
        return err("invalid_input", "Unknown action", 400);
      }
    }

    return err("not_found", "No such endpoint", 404);
}
