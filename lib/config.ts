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
}

export const CATEGORIES = [
  { key: "bawal", label: "Bawal" },
  { key: "shawl", label: "Shawl" },
] as const;

/* Hero carousel brand slides — the CEO's campaign shots, shipped with the
   site. Featured products (admin toggle) are appended after these. */
export const BRAND_SLIDES = [
  { image: "/collection/collection.jpg", title: "The Bawal Collection", subtitle: "Four shades. One standard." },
  { image: "/collection/corporate.jpg", title: "Made for every day", subtitle: "Office-ready, live-tested." },
  { image: "/collection/active.jpg", title: "Move freely", subtitle: "Light, breathable, opaque." },
] as const;

export interface StoreConfig {
  bank_line: string;
  whatsapp_digits: string;
  shipping_cents: number;
  free_above_cents: number;
  gateway: boolean; // Stage B: true once the Billplz secrets are configured
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
  created_at: string;
  config: StoreConfig;
}

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

export const writeCart = (lines: CartLine[]): void => {
  try { localStorage.setItem(CART_KEY, JSON.stringify(lines.slice(0, 20))); } catch { /* private mode */ }
};

export const addToCart = (id: number, qty: number): void => {
  const cart = readCart();
  const line = cart.find((l) => l.id === id);
  if (line) line.qty = Math.min(99, line.qty + qty);
  else cart.push({ id, qty: Math.min(99, qty) });
  writeCart(cart);
};

export const cartCount = (): number => readCart().reduce((n, l) => n + l.qty, 0);

/* ---- shared styles ---- */
export const inputClass =
  "h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900 outline-none focus:border-[#7a2648] focus:ring-2 focus:ring-[#7a2648]/20";
export const labelClass = "mb-1 block text-xs font-medium text-stone-500";
export const btnClass =
  "inline-flex h-11 items-center justify-center rounded-lg bg-[#7a2648] px-6 text-sm font-semibold text-white transition-colors hover:bg-[#8f2e55] disabled:opacity-50";
export const btnGhost =
  "inline-flex h-11 items-center justify-center rounded-lg border border-stone-300 px-6 text-sm font-semibold text-stone-700 hover:bg-stone-50";
