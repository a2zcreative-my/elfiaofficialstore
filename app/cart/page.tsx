"use client";

/** Cart — quantities live in the browser; every price on this page is
    re-fetched from the server, and checkout re-prices AGAIN server-side.
    v0.6.0 adds the free-delivery progress bar; the threshold is the Worker's
    fact (free_above_cents), never a number typed into this file. */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  btnClass, btnGhost, fmtRM, imageUrl, readCart, splitName, writeCart,
  type CartLine, type Product, type StoreConfig,
} from "@/lib/config";

export default function Cart() {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setLines(readCart());
    void fetch("/api/v1/products").then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products)).finally(() => setLoaded(true));
    void fetch("/api/v1/store-config").then((r) => r.json())
      .then((j: StoreConfig) => setConfig(j)).catch(() => null);
  }, []);

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
    <main className="px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-stone-900">Your cart</h1>

        {loaded && rows.length === 0 && (
          <div className="mt-10 rounded-2xl border border-stone-200 bg-white px-6 py-12 text-center">
            <p className="text-sm text-stone-500">Nothing here yet.</p>
            <Link href="/" className={`${btnClass} mt-5`}>Browse the shop</Link>
          </div>
        )}

        {/* Free-delivery progress — only once the server's threshold is known. */}
        {rows.length > 0 && config && config.free_above_cents > 0 && (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-4">
            <p className="text-sm font-medium text-stone-700">
              {toFree === 0
                ? <span className="font-semibold text-green-700">Delivery is on us</span>
                : <>Add <span className="font-bold text-[#7a2648]">{fmtRM(toFree)}</span> more for free delivery</>}
            </p>
            <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-stone-100">
              <div className={`h-full rounded-full transition-all duration-500 ${toFree === 0 ? "bg-green-600" : "bg-[#7a2648]"}`}
                style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        <div className="mt-4 space-y-3">
          {rows.map(({ line, product }) => {
            const { series, shade } = splitName(product.name);
            return (
              <div key={line.id} className="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3">
                <Link href={`/p?id=${product.id}`} className="h-20 w-16 shrink-0 overflow-hidden rounded-xl bg-stone-100">
                  {product.image_key && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={imageUrl(product.image_key)} alt="" className="h-full w-full object-cover object-top" />
                  )}
                </Link>
                <div className="min-w-0 flex-1">
                  {series && <p className="text-[10px] tracking-[0.15em] text-stone-400 uppercase">{product.sku ?? series}</p>}
                  <Link href={`/p?id=${product.id}`} className="block truncate text-sm font-medium hover:text-[#7a2648]">{shade}</Link>
                  <p className="text-sm font-bold text-[#7a2648]">{fmtRM(product.price_cents)}</p>
                  {line.qty > product.stock && (
                    <p className="text-xs font-medium text-red-600">Only {product.stock} in stock — reduce the quantity</p>
                  )}
                </div>
                <div className="flex items-center rounded-full border border-stone-300">
                  <button type="button" aria-label="Decrease quantity" className="h-9 w-9" onClick={() => setQty(line.id, line.qty - 1)}>−</button>
                  <span className="w-7 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
                  <button type="button" aria-label="Increase quantity" className="h-9 w-9" onClick={() => setQty(line.id, Math.min(99, line.qty + 1))}>+</button>
                </div>
              </div>
            );
          })}
        </div>

        {rows.length > 0 && (
          <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
            <div className="flex justify-between text-sm"><span className="text-stone-600">Subtotal</span><span className="font-semibold tabular-nums">{fmtRM(subtotal)}</span></div>
            <div className="mt-1.5 flex justify-between text-sm">
              <span className="text-stone-600">Delivery</span>
              <span className="font-semibold tabular-nums">{shipping === null ? "…" : shipping === 0 ? <span className="text-green-700">FREE</span> : fmtRM(shipping)}</span>
            </div>
            <div className="mt-3 flex justify-between border-t border-stone-100 pt-3 text-base font-bold">
              <span>Total</span><span className="text-[#7a2648] tabular-nums">{fmtRM(subtotal + (shipping ?? 0))}</span>
            </div>
            <Link href="/checkout" className={`${btnClass} mt-5 w-full`}>Checkout</Link>
            <Link href="/" className="mt-3 block text-center text-sm text-stone-500 underline-offset-2 hover:text-[#7a2648] hover:underline">
              Keep shopping
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
