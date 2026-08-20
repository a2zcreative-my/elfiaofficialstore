"use client";

/** Cart — quantities live in the browser; every price on this page is
    re-fetched from the server, and checkout re-prices AGAIN server-side. */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  btnClass, btnGhost, fmtRM, imageUrl, readCart, writeCart,
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

  return (
    <main className="px-6 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-[#7a2648]">Your cart</h1>
        {loaded && rows.length === 0 && (
          <div className="mt-8">
            <p className="text-sm text-stone-500">Nothing here yet.</p>
            <Link href="/" className={`${btnClass} mt-4`}>Browse the shop</Link>
          </div>
        )}
        <div className="mt-6 space-y-3">
          {rows.map(({ line, product }) => (
            <div key={line.id} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                {product.image_key && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(product.image_key)} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{product.name}</p>
                <p className="text-sm font-bold text-[#7a2648]">{fmtRM(product.price_cents)}</p>
                {line.qty > product.stock && (
                  <p className="text-xs font-medium text-red-600">Only {product.stock} in stock — reduce the quantity</p>
                )}
              </div>
              <div className="flex items-center rounded-lg border border-stone-300">
                <button type="button" className="h-9 w-9" onClick={() => setQty(line.id, line.qty - 1)}>−</button>
                <span className="w-7 text-center text-sm font-semibold">{line.qty}</span>
                <button type="button" className="h-9 w-9" onClick={() => setQty(line.id, Math.min(99, line.qty + 1))}>+</button>
              </div>
            </div>
          ))}
        </div>
        {rows.length > 0 && (
          <div className="mt-6 rounded-xl border border-stone-200 bg-white p-4">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-semibold">{fmtRM(subtotal)}</span></div>
            <div className="mt-1 flex justify-between text-sm">
              <span>Delivery</span>
              <span className="font-semibold">{shipping === null ? "…" : shipping === 0 ? "FREE" : fmtRM(shipping)}</span>
            </div>
            {config && shipping !== 0 && subtotal > 0 && (
              <p className="mt-1 text-xs text-stone-500">Free delivery above {fmtRM(config.free_above_cents)}</p>
            )}
            <div className="mt-2 flex justify-between border-t border-stone-100 pt-2 text-base font-bold">
              <span>Total</span><span className="text-[#7a2648]">{fmtRM(subtotal + (shipping ?? 0))}</span>
            </div>
            <div className="mt-4 flex gap-3">
              <Link href="/checkout" className={`${btnClass} flex-1`}>Checkout</Link>
              <Link href="/" className={btnGhost}>Keep shopping</Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
