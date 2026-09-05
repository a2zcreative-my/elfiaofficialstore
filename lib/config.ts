/**
 * ELFIA OFFICIAL STORE — shared front-end constants and helpers.
 *
 * Money facts (bank account, shipping rate, WhatsApp number) deliberately do
 * NOT live in this file: the Worker owns them (wrangler.toml vars) and the
 * pages fetch them from GET /api/v1/store-config. One source of truth,
 * server-side — a stale cached page can never show an old bank account.
 */

export const STORE = {
  name: "ELFIA OFFICIAL STORE",
  /* v1.5.2 — the CEO: "ELFIA branding name is First Sight, Forever Yours". */
  tagline: "First Sight, Forever Yours",
  url: "https://elfiaofficialstore.my",
} as const;

export interface Product {
  id: number;
  name: string;
  description: string | null;
  price_cents: number;
  stock: number;
  image_key: string | null;
  active: number;
  sort: number;
  /* v0.2.0 — collections. sku: Bawal codes start with LUMI (LUMI001…);
     category: 'bawal' | 'shawl'; featured: 1 = in the home hero carousel. */
  sku?: string | null;
  category?: string;
  featured?: number;
  /* v0.7.0 — 0 = always available (the stock number is ignored and the
     product never reads Sold out); 1 = count pieces. Absent on a worker
     deployed ahead of migration 0007, where everything counted. */
  track_stock?: number;
  /* v1.5.0 — products the portal bridge created (migration 0013).
     portal_created: made by the bridge rather than by hand in /admin.
     portal_pending: still waiting in /admin -> Products -> From portal;
                     it is hidden from the shop until someone publishes it.
     image_marker:   the portal's change-marker for the photo we last copied.
     All absent on a worker deployed ahead of 0013. */
  portal_created?: number;
  portal_pending?: number;
  image_marker?: string | null;
  /* v1.7.0 — the pre-discount price. Set by the portal sync when a discount
     runs; the storefront draws the struck-through number and a SALE badge
     from it. NULL/absent = no sale. */
  compare_price_cents?: number | null;
  /* v1.41.0 — when a FLASH sale on this product ends, as an ISO timestamp.
     Mirrored from the portal, which sends it only while it is still ahead;
     NULL/absent = no flash sale. It never decides the price — the portal has
     already stopped applying the discount by the time this clears — it only
     drives the red pill and its countdown. */
  flash_until?: string | null;
}

/** v1.7.0 — one hero-carousel slide, authored in the portal and mirrored by
    the sync. Served inside GET /api/v1/products; an empty/absent list means
    the shipped campaign slides carry the carousel, exactly as before. */
export interface PortalSlide {
  portal_id: number;
  image_key: string;
  title?: string | null;
  subtitle?: string | null;
  sort: number;
  /* v1.8.0 — framing, chosen in the portal by clicking the photo. Optional
     because a store worker older than 0015 sends neither. */
  focus_x?: number | null;
  focus_y?: number | null;
  fit?: string | null;
  /** v1.9.0 — per cent. 100 = the whole photo fits in the hero. */
  zoom?: number | null;
  /* v1.11.0 — the cut-out model who steps out of the banner. A PNG with a
     transparent background, drawn over the slide and above its top edge.
     Absent = the slide draws as a plain banner, exactly as before. */
  cutout_key?: string | null;
  cutout_side?: string | null;
  cutout_scale?: number | null;
}

/** v1.11.0 — how far above the banner the tallest cut-out reaches, as a
    fraction of the banner's height. The hero reserves exactly this much room
    above the cards so nobody is decapitated by the carousel's own clipping —
    and reserves NOTHING when no slide has a cut-out. */
export const cutoutHeadroom = (slides: { cutout_key?: string | null; cutout_scale?: number | null }[]): number => {
  let most = 0;
  for (const s of slides) {
    if (!s.cutout_key) continue;
    const n = Math.round(Number(s.cutout_scale));
    most = Math.max(most, (Number.isFinite(n) ? Math.min(160, Math.max(100, n)) : 118) - 100);
  }
  return most / 100;
};

/** v1.8.0 — the CSS a slide's framing turns into. Kept next to the type so
    the hero and any future banner frame a photo the same way, and so the
    "portal said nothing" answer lives in exactly one place: fill the banner
    from its middle, which is what the shop did before framing existed. */
export const slideFraming = (s: Pick<PortalSlide, "focus_x" | "focus_y" | "fit" | "zoom">): {
  position: string; scale: number;
} => {
  const pct = (v: unknown): number => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 50;
  };
  /* v1.9.0 — one number replaces the crop/no-crop switch. The photo is laid
     in with object-fit: contain (so 100% = every edge visible, the CEO's
     "at least I can see the full") and then scaled up around the focus
     point. A slide the portal has not zoomed yet has no number, and the old
     switch still answers for it — 160% is what filled the banner before. */
  const z = Math.round(Number(s.zoom));
  const scale = Number.isFinite(z) && z >= 100 ? Math.min(300, z) / 100
              : s.fit === "contain" ? 1 : 1.6;
  return { position: `${pct(s.focus_x)}% ${pct(s.focus_y)}%`, scale };
};

/** The struck-through number, only when it is genuinely bigger than the
    price — a "sale" from RM 36 down to RM 36 is not a sale. */
export const comparePrice = (p: Product): number | null =>
  typeof p.compare_price_cents === "number" && p.compare_price_cents > p.price_cents
    ? p.compare_price_cents : null;

/* ---- v1.41.0 — flash sales ----
   The portal owns the price and the deadline; the shopfront owns the clock
   in between pulls. Nothing here decides a price — these only answer "is a
   flash sale running right now, and how long is left". */

/** Milliseconds left in this product's flash sale, or null when none runs.
    A deadline already passed reads as null, so the pill goes the instant it
    expires even though the next sync may be minutes away. */
export const flashLeftMs = (p: Product, now: number = Date.now()): number | null => {
  const raw = typeof p.flash_until === "string" ? p.flash_until.trim() : "";
  if (raw === "") return null;
  const t = Date.parse(raw);
  if (!Number.isFinite(t)) return null;
  const left = t - now;
  /* A flash pill with no reduced price behind it would be a promise the
     price does not keep, so the struck-through number is part of the test. */
  return left > 0 && comparePrice(p) !== null ? left : null;
};

export const isFlashSale = (p: Product, now: number = Date.now()): boolean =>
  flashLeftMs(p, now) !== null;

/** "1d 4h" / "3h 12m" / "9m 05s" — the last hour counts seconds, because
    that is when it matters. Deliberately short: this sits inside a pill. */
export const flashCountdown = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
  return `${sec}s`;
};

/** The single answer to "can this be bought right now?". Everything on the
    storefront asks this rather than testing `stock <= 0` on its own — that
    was the bug the CEO hit: ten in-stock designs all reading Sold out
    because their counts were never filled in. */
export const isSoldOut = (p: Product): boolean => (p.track_stock ?? 1) === 1 && p.stock <= 0;

/** Show "only N left" only when N is a number somebody maintains. */
export const lowStock = (p: Product): number | null =>
  (p.track_stock ?? 1) === 1 && p.stock > 0 && p.stock <= 5 ? p.stock : null;

/** v1.1.2 — the exact live count, when somebody maintains it. Products synced
    from the portal are counted (the pull flips them to track_stock = 1), so
    the product page can show the same number the portal shows. Null for
    always-available products, where inventing a number would be a lie. */
export const countedStock = (p: Product): number | null =>
  (p.track_stock ?? 1) === 1 && p.stock > 0 ? p.stock : null;

/** Quantity ceiling for the pickers. Always-available products cap at 99. */
export const maxQty = (p: Product): number => ((p.track_stock ?? 1) === 1 ? Math.min(99, p.stock) : 99);

/* v1.10.0 — the home page's filter chips. Derived from the same portal
   collections as everything else; the old fixed Bawal/Shawl pair is gone,
   because a shop whose owner names her own collections cannot have its
   filters hard-coded here. ELFIA Exclusive is left out: it is a curation,
   and the strip below it already features those. */
export const categoryChips = (products: Product[]): { key: string; label: string }[] =>
  collectionsOf(products).filter((g) => g.key !== FEATURED_KEY)
    .map((g) => ({ key: g.key, label: g.label }));

/* v1.32.0 — BRAND_SLIDES is gone. The pair of shipped campaign shots that
   used to carry the hero carousel when the portal had no slides was the last
   hardcoded content on the homepage, and the CEO asked for it out ("Homepage
   carousel only appear for my uploaded!"). The carousel now renders portal
   slides plus Featured products, or nothing at all. The campaign photos
   themselves stay in public/collection/ — the categories page, the account
   page, and the share-preview fallback still use them as decoration. */

export interface StoreConfig {
  bank_line: string;
  whatsapp_digits: string;
  shipping_cents: number;
  free_above_cents: number;
  gateway: boolean; // Stage B: true once the Bayarcash secrets are configured
  /** v1.0.0 — hours an unpaid order holds its stock before it is released. */
  hold_hours?: number;
}

/**
 * The account NUMBER out of the payee line, for the Copy button beside it.
 *
 * v1.12.3 — BANK_LINE gained its bank name on 26-08-2026, so it now reads
 * as a sentence: "<bank> <account> — <holder>". Copy used to put that whole
 * sentence on the clipboard, which was survivable while the line was mostly
 * digits and is not now: a customer taps Copy, pastes into their banking
 * app's account field, and it is refused — or worse, they trim it by hand
 * and mistype. Beside a payee line, Copy means "give me the number".
 *
 * The longest run of digits wins, and it must be at least 8 long. Both
 * halves of that rule matter, because holders' names contain digits: on a
 * line ending "— A 2 Z Trading", stripping every non-digit welds that 2 onto
 * the account and returns a number that is the wrong one and still looks
 * like the right one. Taking runs instead leaves it out.
 *
 * Returns null when the line holds no plausible number, and the caller then
 * copies it whole — an odd clipboard beats an empty one.
 *
 * The real account is NOT written here, or anywhere in this repo except
 * BANK_LINE in worker/wrangler.toml; tests/brand-isolation.mjs enforces
 * that, and caught the first draft of this very comment.
 */
export const accountDigits = (bankLine: string): string | null => {
  let best: string | null = null;
  for (const run of bankLine.match(/\d[\d\s-]*\d/g) ?? []) {
    const digits = run.replace(/\D/g, "");
    if (digits.length >= 8 && (!best || digits.length > best.length)) best = digits;
  }
  return best;
};

/* ---- customer accounts (v1.0.0) ----
   Optional everywhere: a guest can buy without one. */

export interface Account {
  id: number;
  email: string;
  name: string;
  phone: string | null;
  address: string | null;
  /** v1.3.0 — PDPA marketing consent state (true = consent on record). */
  marketing?: boolean;
}

export interface AccountOrder {
  order_number: string;
  token: string;
  status: string;
  total_cents: number;
  created_at: string;
  tracking_no: string | null;
}

export interface OrderEvent {
  status: string;
  note: string | null;
  created_at: string;
}

export interface OrderView {
  order_number: string;
  status: string;
  customer_name: string;
  phone: string;
  address: string;
  items: { name: string; qty: number; price_cents: number }[];
  subtotal_cents: number;
  shipping_cents: number;
  total_cents: number;
  receipt_uploaded: boolean;
  tracking_no: string | null;
  /* v0.9.0 — progress. `events` is the order's own history, oldest first;
     tracking_url is only present when the courier is one we have a link for. */
  tracking_courier?: string | null;
  tracking_url?: string | null;
  events?: OrderEvent[];
  /** When an unpaid order releases its stock (v1.0.0). */
  expires_at?: string | null;
  created_at: string;
  config: StoreConfig;
}

/** "20-08-2026 13:04" from the Worker's "2026-08-20 13:04:11" (UTC). Shown in
    Malaysian time, because that is where every customer of this shop is. */
export const fmtWhen = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const t = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`);
  if (Number.isNaN(t)) return iso;
  return new Date(t).toLocaleString("en-MY", {
    timeZone: "Asia/Kuala_Lumpur", day: "2-digit", month: "short",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
};

export const fmtRM = (cents: number): string =>
  `RM ${(cents / 100).toLocaleString("en-MY", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const imageUrl = (key: string | null | undefined): string => {
  if (!key) return "";
  // "/collection/…" = a file shipped with the site; anything else is an R2
  // key served through the worker (admin uploads, and from v1.5.0 photos the
  // portal delivers).
  //
  // v1.5.0 — encode each SEGMENT, not the whole key. encodeURIComponent over
  // "products/12-….jpg" turns the slash into %2F, which stays encoded in
  // URL.pathname, so the Worker's media route never matched and every
  // uploaded photo came back 404. Only the shipped /collection/ files, which
  // return above, ever worked.
  return key.startsWith("/") ? key : `/api/v1/media/${key.split("/").map(encodeURIComponent).join("/")}`;
};

/* ---- cart (browser-only; the server re-prices everything at checkout) ---- */

export interface CartLine { id: number; qty: number }

const CART_KEY = "elfia-cart";

export const readCart = (): CartLine[] => {
  try {
    const raw = localStorage.getItem(CART_KEY);
    const parsed = raw ? (JSON.parse(raw) as CartLine[]) : [];
    return Array.isArray(parsed) ? parsed.filter((l) => l && l.id > 0 && l.qty > 0) : [];
  } catch { return []; }
};

/* The header's cart badge listens for this. `storage` only fires in OTHER
   tabs, so a same-tab "Add to cart" needs its own nudge. */
export const CART_EVENT = "elfia-cart-changed";

export const writeCart = (lines: CartLine[]): void => {
  try { localStorage.setItem(CART_KEY, JSON.stringify(lines.slice(0, 20))); } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(CART_EVENT)); } catch { /* SSR */ }
};

export const addToCart = (id: number, qty: number): void => {
  const cart = readCart();
  const line = cart.find((l) => l.id === id);
  if (line) line.qty = Math.min(99, line.qty + qty);
  else cart.push({ id, qty: Math.min(99, qty) });
  writeCart(cart);
};

export const cartCount = (): number => readCart().reduce((n, l) => n + l.qty, 0);

/* ---- navigation ----
   v1.4.0. Two shapes of the same shop: a phone gets an app with a bottom tab
   bar (TABS), a desktop gets a web header (NAV_LINKS). Both point at the same
   routes — there is one storefront, not two. */
export const NAV_LINKS = [
  { href: "/shop", label: "Shop" },
  { href: "/categories", label: "Collections" },
  /* v1.15.0 — the lookbook (CEO, 26-08: "a new slug for Catalog so that
     customer has option to view the catalog"). It sits next to Collections
     because that is what someone browsing is already looking at. */
  { href: "/catalog", label: "Catalog" },
  { href: "/track", label: "Track order" },
  { href: "/policies", label: "Delivery & returns" },
] as const;

export type TabKey = "home" | "shop" | "categories" | "wishlist" | "account";

export const TABS: { key: TabKey; href: string; label: string }[] = [
  { key: "home", href: "/", label: "Home" },
  { key: "shop", href: "/shop", label: "Shop" },
  { key: "categories", href: "/categories", label: "Collections" },
  { key: "wishlist", href: "/wishlist", label: "Wishlist" },
  { key: "account", href: "/account", label: "Profile" },
];

/* ---- wishlist (v1.4.0) ----
   The heart on every card. Kept on the device, like the cart: a customer can
   save shades without an account, and nothing personal leaves the browser.
   Signing in does not yet merge these into the account — that needs a table
   on the Worker (CHANGELOG v1.4.0, "still open"). */

const WISH_KEY = "elfia-wishlist";
export const WISH_EVENT = "elfia-wishlist-changed";

export const readWishlist = (): number[] => {
  try {
    const v = JSON.parse(localStorage.getItem(WISH_KEY) ?? "[]") as number[];
    return Array.isArray(v) ? v.filter((n) => typeof n === "number" && n > 0).slice(0, 100) : [];
  } catch { return []; }
};

const writeWishlist = (ids: number[]): void => {
  try { localStorage.setItem(WISH_KEY, JSON.stringify(ids.slice(0, 100))); } catch { /* private mode */ }
  try { window.dispatchEvent(new Event(WISH_EVENT)); } catch { /* SSR */ }
};

/** Returns the new state, so a card can animate the heart it just filled. */
export const toggleWish = (id: number): boolean => {
  const ids = readWishlist();
  const has = ids.includes(id);
  writeWishlist(has ? ids.filter((n) => n !== id) : [id, ...ids]);
  return !has;
};

export const wishCount = (): number => readWishlist().length;

/* ---- collections (v1.10.0 — named in the portal) ----
   The CEO: "why it is Bawal plain? I think I should be able to add the
   category in the portal so that easier for me to categorized it."

   She was right to be annoyed. Until now this file HARD-CODED four
   collections and split the bawal range by running a regex over the product
   NAME — so every LUMI shade, none of which says "floral" or "gold", fell
   into a bucket called "Bawal Plain" that nobody had chosen. A collection
   the shop invents from a product's spelling is not a collection.

   Collections are now simply the distinct Collection values the portal
   sends, in the portal's own spelling. Type "Bawal Printed" there and it
   exists here; rename it there and it renames here; stop using it and it
   disappears. Nothing is invented, and an empty collection cannot exist
   because a collection IS its products.

   The one addition the shop still makes is ELFIA Exclusive — the /admin
   "featured" tick, a curation rather than a category — and it is always
   listed last. */

export interface Group {
  key: string;
  label: string;
  blurb?: string;
  match: (p: Product) => boolean;
}

/** The key two spellings of the same collection share. Case and spacing are
    noise: "Bawal Printed", "bawal printed" and "BAWAL  PRINTED" are one. */
export const collectionKey = (v: unknown): string =>
  String(v ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** A product with no Collection set is Bawal — the range this shop started
    as, and what the bridge writes at creation when the portal omits one. */
export const collectionOf = (p: Product): string => (p.category ?? "").trim() || "Bawal";

/** Portal spelling, tidied for display: an all-lowercase legacy value
    ("bawal", "shawl") is title-cased; anything typed with capitals is left
    exactly as the person typed it. */
const prettyCollection = (raw: string): string =>
  raw === raw.toLowerCase()
    ? raw.replace(/\b[a-z]/g, (c) => c.toUpperCase())
    : raw;

export const FEATURED_KEY = "featured";

/** Every collection the live catalogue actually contains, alphabetical, with
    ELFIA Exclusive last. Derived on each render from the products in hand —
    there is no list to keep in step. */
export const collectionsOf = (products: Product[]): Group[] => {
  const seen = new Map<string, string>(); // key -> the first spelling seen
  for (const p of products) {
    const raw = collectionOf(p);
    const key = collectionKey(raw);
    if (!seen.has(key)) seen.set(key, prettyCollection(raw));
  }
  const groups: Group[] = [...seen.entries()]
    .map(([key, label]) => ({
      key,
      label,
      match: (p: Product) => collectionKey(collectionOf(p)) === key,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));

  if (products.some((p) => p.featured === 1)) {
    groups.push({
      key: FEATURED_KEY,
      label: "ELFIA Exclusive",
      blurb: "Hand-picked by the studio",
      match: (p: Product) => p.featured === 1,
    });
  }
  return groups;
};

/** Filter by a collection key. Unknown key = everything, so a stale link
    shows the shop instead of an empty page. */
export const inGroup = (products: Product[], key: string | null): Product[] => {
  if (!key) return products;
  const g = collectionsOf(products).find((x) => x.key === key);
  return g ? products.filter(g.match) : products;
};

/* ---- listing sorts (v1.4.0) ---- */
export type SortKey = "featured" | "price_asc" | "price_desc" | "name";

export const SORTS: { key: SortKey; label: string }[] = [
  { key: "featured", label: "Featured" },
  { key: "price_asc", label: "Price: low to high" },
  { key: "price_desc", label: "Price: high to low" },
  { key: "name", label: "Name A–Z" },
];

export const sortProducts = (list: Product[], key: SortKey): Product[] => {
  const out = [...list];
  switch (key) {
    case "price_asc": return out.sort((a, b) => a.price_cents - b.price_cents);
    case "price_desc": return out.sort((a, b) => b.price_cents - a.price_cents);
    case "name": return out.sort((a, b) => splitName(a.name).shade.localeCompare(splitName(b.name).shade));
    default: return out.sort((a, b) => (b.featured ?? 0) - (a.featured ?? 0) || a.sort - b.sort || a.id - b.id);
  }
};

/* ---- what this device remembers (v1.0.0) ----
   The CEO watched a customer refresh mid-checkout and lose everything. An
   account fixes that across devices; these two fix it on THIS device, for
   everyone, with no sign-up. Both are conveniences only — the server still
   owns every price, every total and every order.

   v1.40.0 (security audit ST4) — WHERE they are kept changed, and why.
   An order token is a bearer key: whoever holds it can open that order and
   read the customer's name, phone and full address. Keeping tokens and a
   cleartext checkout draft in localStorage meant they survived for ever on
   the device — readable by any script on the origin, and still there for the
   next person on a shared or shop-counter phone. Both now live in
   sessionStorage (gone when the tab closes) and the remembered orders carry
   an explicit expiry as well, so a token cannot outlive its usefulness.
   Losing them costs a customer nothing: /track finds any order again from
   its number and the phone that placed it, and signed-in customers get their
   real history from the server. */

const DRAFT_KEY = "elfia-checkout-draft";
const RECENT_KEY = "elfia-recent-orders";
/** How long a remembered order stays on this device. Long enough to cover
    paying, checking back and the parcel arriving; short enough that a
    borrowed phone does not keep somebody's address for ever. */
const RECENT_TTL_MS = 30 * 24 * 3600 * 1000;

/** sessionStorage, with localStorage swept once so anything written by an
    older version of the store does not linger for ever on a real customer's
    phone. Every access is guarded: private mode throws on both. */
const store = (): Storage | null => {
  try { return window.sessionStorage; } catch { return null; }
};
const forgetLegacy = (key: string): void => {
  try { window.localStorage.removeItem(key); } catch { /* private mode */ }
};

export interface CheckoutDraft { name: string; phone: string; address: string; email: string; notes: string }

export const readDraft = (): Partial<CheckoutDraft> => {
  try {
    const raw = store()?.getItem(DRAFT_KEY);
    if (raw) return JSON.parse(raw) as Partial<CheckoutDraft>;
    /* One-time migration: an older build kept the draft in localStorage.
       Honour it once so nobody loses a half-typed address on upgrade, then
       clear it from the persistent store. */
    const legacy = window.localStorage.getItem(DRAFT_KEY);
    forgetLegacy(DRAFT_KEY);
    return legacy ? (JSON.parse(legacy) as Partial<CheckoutDraft>) : {};
  } catch { return {}; }
};
export const writeDraft = (d: Partial<CheckoutDraft>): void => {
  try { store()?.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
};
export const clearDraft = (): void => {
  try { store()?.removeItem(DRAFT_KEY); } catch { /* private mode */ }
  forgetLegacy(DRAFT_KEY);
};

export interface RecentOrder { order_number: string; token: string; at: string }

const freshOrders = (v: unknown): RecentOrder[] => {
  if (!Array.isArray(v)) return [];
  const cutoff = Date.now() - RECENT_TTL_MS;
  return (v as RecentOrder[])
    .filter((o) => o?.token && o?.order_number)
    .filter((o) => {
      const t = Date.parse(o.at ?? "");
      return !Number.isFinite(t) || t >= cutoff;   // undated (pre-v1.40.0) rows are kept
    })
    .slice(0, 10);
};

export const readRecent = (): RecentOrder[] => {
  try {
    const raw = store()?.getItem(RECENT_KEY);
    if (raw) return freshOrders(JSON.parse(raw));
    const legacy = window.localStorage.getItem(RECENT_KEY);
    forgetLegacy(RECENT_KEY);   // never leave order tokens in persistent storage
    const carried = legacy ? freshOrders(JSON.parse(legacy)) : [];
    if (carried.length) { try { store()?.setItem(RECENT_KEY, JSON.stringify(carried)); } catch { /* private mode */ } }
    return carried;
  } catch { return []; }
};
export const rememberOrder = (order_number: string, token: string): void => {
  try {
    const next = [{ order_number, token, at: new Date().toISOString() },
                  ...readRecent().filter((o) => o.token !== token)].slice(0, 10);
    store()?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
};
/** Signing out must not leave the previous person's orders on the device. */
export const clearRemembered = (): void => {
  try { store()?.removeItem(RECENT_KEY); } catch { /* private mode */ }
  forgetLegacy(RECENT_KEY);
};

/** Product names read "Bawal Premium — Dusty Rose". On a card the series
    prefix is repeated noise, so the grid shows the shade large and the series
    small. Names without the em dash come back whole. */
export const splitName = (name: string): { series: string | null; shade: string } => {
  const i = name.indexOf(" — ");
  return i > 0 ? { series: name.slice(0, i), shade: name.slice(i + 3) } : { series: null, shade: name };
};

/** wa.me link for the store's own number. Digits only — wa.me rejects
    spaces, "+" and dashes. */
export const waLink = (digits: string, text: string): string =>
  `https://wa.me/${digits.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

/* ---- shared styles ---- */
export const inputClass =
  "h-12 w-full rounded-xl border border-elfia-line bg-white px-3.5 text-sm text-elfia-ink outline-none transition-colors placeholder:text-elfia-muted/70 focus:border-elfia-rose focus:ring-2 focus:ring-elfia-rose/25";
export const labelClass = "mb-1.5 block text-xs font-medium text-elfia-muted";
export const btnClass =
  "inline-flex h-12 items-center justify-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white shadow-sm shadow-elfia-deep/20 transition-colors hover:bg-elfia-deeper disabled:opacity-50";
export const btnGhost =
  "inline-flex h-12 items-center justify-center rounded-full border border-elfia-line bg-white px-6 text-sm font-semibold text-elfia-body transition-colors hover:border-elfia-rose hover:text-elfia-deep";
/** The white panel every screen is built from. */
export const cardClass = "rounded-2xl border border-elfia-line bg-white";
