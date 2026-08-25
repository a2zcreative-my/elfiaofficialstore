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
}

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

export const CATEGORIES = [
  { key: "bawal", label: "Bawal" },
  { key: "shawl", label: "Shawl" },
] as const;

/* Hero carousel brand slides — the CEO's campaign shots, shipped with the
   site. Featured products (admin toggle) are appended after these.

   `position` is the CSS object-position for the slide's crop. The campaign
   shots are portrait group photos: cropped from the top they would show mostly
   ceiling, so they sit lower in frame. Product slides keep the default "top",
   which is where the hijab is. */
export const BRAND_SLIDES = [
  { image: "/collection/campaign-studio.jpg", title: "The Bawal Collection", subtitle: "First Sight, Forever Yours", position: "50% 45%" },
  { image: "/collection/campaign-salon.jpg", title: "Made for every day", subtitle: "Office-ready, live-tested.", position: "50% 38%" },
] as const;

export interface StoreConfig {
  bank_line: string;
  whatsapp_digits: string;
  shipping_cents: number;
  free_above_cents: number;
  gateway: boolean; // Stage B: true once the Billplz secrets are configured
  /** v1.0.0 — hours an unpaid order holds its stock before it is released. */
  hold_hours?: number;
}

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

/* ---- collections (v1.4.0) ----
   The CEO's layout has a Collections screen. ELFIA's real catalogue is one
   Bawal range plus a Shawl category, so the groups below are DERIVED from the
   live data rather than typed in: nothing here invents a collection the shop
   cannot fill, and an empty group is never shown. When the range grows, name
   the products the way the rule expects — or add a group here. */

export interface Group {
  key: string;
  label: string;
  blurb: string;
  match: (p: Product) => boolean;
}

const PRINTED = /(floral|print|gold|batik|motif)/i;

export const GROUPS: Group[] = [
  {
    key: "printed",
    label: "Bawal Printed",
    blurb: "Florals and gold-line designs",
    match: (p) => (p.category ?? "bawal") === "bawal" && PRINTED.test(p.name),
  },
  {
    key: "plain",
    label: "Bawal Plain",
    blurb: "Solid and gradient shades",
    match: (p) => (p.category ?? "bawal") === "bawal" && !PRINTED.test(p.name),
  },
  {
    key: "shawl",
    label: "Shawl",
    blurb: "The long-cut collection",
    match: (p) => (p.category ?? "bawal") === "shawl",
  },
  {
    key: "featured",
    label: "ELFIA Exclusive",
    blurb: "Hand-picked by the studio",
    match: (p) => p.featured === 1,
  },
];

export const groupOf = (key: string): Group | undefined => GROUPS.find((g) => g.key === key);

/** Everything in a group, or the whole catalogue when the key is unknown. */
export const inGroup = (products: Product[], key: string | null): Product[] => {
  const g = key ? groupOf(key) : undefined;
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
   owns every price, every total and every order. */

const DRAFT_KEY = "elfia-checkout-draft";
const RECENT_KEY = "elfia-recent-orders";

export interface CheckoutDraft { name: string; phone: string; address: string; email: string; notes: string }

export const readDraft = (): Partial<CheckoutDraft> => {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as Partial<CheckoutDraft>; }
  catch { return {}; }
};
export const writeDraft = (d: Partial<CheckoutDraft>): void => {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)); } catch { /* private mode */ }
};
export const clearDraft = (): void => {
  try { localStorage.removeItem(DRAFT_KEY); } catch { /* private mode */ }
};

export interface RecentOrder { order_number: string; token: string; at: string }

export const readRecent = (): RecentOrder[] => {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as RecentOrder[];
    return Array.isArray(v) ? v.filter((o) => o?.token && o?.order_number).slice(0, 10) : [];
  } catch { return []; }
};
export const rememberOrder = (order_number: string, token: string): void => {
  try {
    const next = [{ order_number, token, at: new Date().toISOString() },
                  ...readRecent().filter((o) => o.token !== token)].slice(0, 10);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch { /* private mode */ }
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
