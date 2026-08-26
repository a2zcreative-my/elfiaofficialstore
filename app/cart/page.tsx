"use client";

/** Cart — quantities live in the browser; every price on this page is
    re-fetched from the server, and checkout re-prices AGAIN server-side.
    v0.6.0 added the free-delivery progress bar; the threshold is the Worker's
    fact (free_above_cents), never a number typed into this file.
    v1.4.0 — blush layout, "Save for later" straight into the wishlist, and
    one Checkout button rather than a second pinned copy: two buttons with the
    same name in one page is ambiguous for a screen reader and for the
    end-to-end test that clicks it by name. */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  fmtRM, imageUrl, maxQty, readCart, splitName, toggleWish, writeCart,
  type CartLine, type Product, type StoreConfig,
} from "@/lib/config";

import { EmptyState, Icon, useDataRefresh } from "./../ui";

export default function Cart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  /* v1.16.0 — `refresh` re-runs this same fetch when the customer returns
     to the tab or 90s of reading has passed, so a price or discount changed
     in the portal reaches a page that is already open. */
  const refresh = useDataRefresh();
  useEffect(() => {
    setLines(readCart());
    void fetch("/api/v1/products").then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products)).finally(() => setLoaded(true));
    void fetch("/api/v1/store-config").then((r) => r.json())
      .then((j: StoreConfig) => setConfig(j)).catch(() => null);
  }, [refresh]);

  const rows = lines
    .map((l) => ({ line: l, product: products.find((p) => p.id === l.id) }))
    .filter((r): r is { line: CartLine; product: Product } => Boolean(r.product));

  const setQty = (id: number, qty: number) => {
    const next = lines.map((l) => (l.id === id ? { ...l, qty } : l)).filter((l) => l.qty > 0);
    setLines(next); writeCart(next);
  };

  const subtotal = rows.reduce((n, r) => n + r.product.price_cents * r.line.qty, 0);
  const shipping = config ? (subtotal >= config.free_above_cents ? 0 : config.shipping_cents) : null;
  const toFree = config ? Math.max(0, config.free_above_cents - subtotal) : 0;
  const pct = config && config.free_above_cents > 0
    ? Math.min(100, Math.round((subtotal / config.free_above_cents) * 100)) : 0;

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-xl font-bold text-elfia-ink sm:text-2xl">Your cart</h1>
        <p className="text-xs text-elfia-muted">
          {loaded ? `${rows.reduce((n, r) => n + r.line.qty, 0)} item${rows.reduce((n, r) => n + r.line.qty, 0) === 1 ? "" : "s"}` : "Loading…"}
        </p>

        {loaded && rows.length === 0 && (
          <div className="mt-6">
            <EmptyState icon="cart" title="Nothing here yet"
              note="Add a shade from the shop — your wishlist is a good place to start."
              cta={{ href: "/shop", label: "Browse the shop" }} />
          </div>
        )}

        {/* Free-delivery progress — only once the server's threshold is known. */}
        {rows.length > 0 && config && config.free_above_cents > 0 && (
          <div className="mt-4 rounded-2xl border border-elfia-line bg-white p-4">
            <p className="flex items-center gap-2 text-sm font-medium text-elfia-body">
              <Icon name="truck" size={16} className="shrink-0 text-elfia-rose" />
              <span>
                {toFree === 0
                  ? <span className="font-semibold text-emerald-700">Delivery is on us</span>
                  : <>Add <span className="font-bold text-elfia-deep">{fmtRM(toFree)}</span> more for free delivery</>}
              </span>
            </p>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-elfia-blush">
              <div className={`h-full rounded-full transition-all duration-500 ${toFree === 0 ? "bg-emerald-600" : "bg-elfia-deep"}`}
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {rows.map(({ line, product }) => {
            const { series, shade } = splitName(product.name);
            return (
              <div key={line.id} className="flex items-center gap-3 rounded-2xl border border-elfia-line bg-white p-3">
                <Link href={`/p?id=${product.id}`} className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-elfia-veil">
                  {product.image_key && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl(product.image_key)} alt="" className="h-full w-full object-cover object-top" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  {(product.sku ?? series) && (
                    <p className="text-[10px] tracking-[0.15em] text-elfia-muted uppercase">{product.sku ?? series}</p>
                  )}
                  <Link href={`/p?id=${product.id}`} className="block truncate text-sm font-medium text-elfia-ink hover:text-elfia-deep">{shade}</Link>
                  <p className="text-sm font-bold text-elfia-deep">{fmtRM(product.price_cents)}</p>
                  {line.qty > maxQty(product) && (
                    <p className="text-xs font-medium text-red-600">Only {maxQty(product)} available — reduce the quantity</p>
                  )}
                  <div className="mt-1.5 flex gap-3">
                    <button type="button" onClick={() => { toggleWish(product.id); setQty(line.id, 0); }}
                      className="text-[11px] text-elfia-muted underline-offset-2 hover:text-elfia-deep hover:underline">
                      Save for later
                    </button>
                    <button type="button" onClick={() => setQty(line.id, 0)}
                      className="text-[11px] text-elfia-muted underline-offset-2 hover:text-elfia-deep hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
                <div className="flex shrink-0 items-center rounded-full border border-elfia-line">
                  <button type="button" aria-label="Decrease quantity" className="h-9 w-9 text-elfia-body" onClick={() => setQty(line.id, line.qty - 1)}>−</button>
                  <span className="w-7 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                  <button type="button" aria-label="Increase quantity" className="h-9 w-9 text-elfia-body" onClick={() => setQty(line.id, Math.min(maxQty(product), line.qty + 1))}>+</button>
                </div>
              </div>
            );
          })}
        </div>

        {rows.length > 0 && (
          <>
            <div className="mt-5 rounded-2xl border border-elfia-line bg-white p-5">
              <div className="flex justify-between text-sm"><span className="text-elfia-body">Subtotal</span><span className="font-semibold tabular-nums">{fmtRM(subtotal)}</span></div>
              <div className="mt-1.5 flex justify-between text-sm">
                <span className="text-elfia-body">Delivery</span>
                <span className="font-semibold tabular-nums">{shipping === null ? "…" : shipping === 0 ? <span className="text-emerald-700">FREE</span> : fmtRM(shipping)}</span>
              </div>
              <div className="mt-3 flex justify-between border-t border-elfia-line pt-3 text-base font-bold">
                <span>Total</span><span className="tabular-nums text-elfia-deep">{fmtRM(subtotal + (shipping ?? 0))}</span>
              </div>
              <Link href="/checkout" className="mt-5 flex h-12 w-full items-center justify-center rounded-full bg-elfia-deep text-sm font-semibold text-white hover:bg-elfia-deeper">
                Checkout
              </Link>
              <Link href="/shop" className="mt-3 block text-center text-sm text-elfia-muted underline-offset-2 hover:text-elfia-deep hover:underline">
                Keep shopping
              </Link>
            </div>

          </>
        )}
      </div>
    </main>
  );
}
