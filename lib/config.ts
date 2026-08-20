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
  tagline: "Modest wear, made to last.",
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
}

/** The single answer to "can this be bought right now?". Everything on the
    storefront asks this rather than testing `stock <= 0` on its own — that
    was the bug the CEO hit: ten in-stock designs all reading Sold out
    because their counts were never filled in. */
export const isSoldOut = (p: Product): boolean => (p.track_stock ?? 1) === 1 && p.stock <= 0;

/** Show "only N left" only when N is a number somebody maintains. */
export const lowStock = (p: Product): number | null =>
  (p.track_stock ?? 1) === 1 && p.stock > 0 && p.stock <= 5 ? p.stock : null;

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
  { image: "/collection/campaign-studio.jpg", title: "The Bawal Collection", subtitle: "Ten shades. One standard.", position: "50% 45%" },
  { image: "/collection/campaign-salon.jpg", title: "Made for every day", subtitle: "Office-ready, live-tested.", position: "50% 38%" },
] as const;

export interface StoreConfig {
  bank_line: string;
  whatsapp_digits: string;
  shipping_cents: number;
  free_above_cents: number;
  gateway: boolean; // Stage B: true once the Billplz secrets are configured
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
  // key served through the worker (admin uploads).
  return key.startsWith("/") ? key : `/api/v1/media/${encodeURIComponent(key)}`;
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

/* ---- navigation ---- */
export const NAV_LINKS = [
  { href: "/", label: "Shop" },
  { href: "/track", label: "Track order" },
  { href: "/policies", label: "Delivery & returns" },
] as const;

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
  "h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#7a2648] focus:ring-2 focus:ring-[#7a2648]/20";
export const labelClass = "mb-1 block text-xs font-medium text-stone-500";
export const btnClass =
  "inline-flex h-11 items-center justify-center rounded-full bg-[#7a2648] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#8f2e55] disabled:opacity-50";
export const btnGhost =
  "inline-flex h-11 items-center justify-center rounded-full border border-stone-300 px-6 text-sm font-semibold text-stone-700 transition-colors hover:border-stone-400 hover:bg-white";
