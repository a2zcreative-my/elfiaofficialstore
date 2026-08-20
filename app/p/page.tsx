"use client";

/** Product detail — /p?id=N (query param keeps the site fully static). */
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { addToCart, btnClass, btnGhost, fmtRM, imageUrl, type Product } from "@/lib/config";

function ProductInner() {
  const params = useSearchParams();
  const id = Number(params.get("id"));
  const [p, setP] = useState<Product | null | "missing">(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!id) { setP("missing"); return; }
    void fetch(`/api/v1/products/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { product: Product }) => setP(j.product))
      .catch(() => setP("missing"));
  }, [id]);

  if (p === null) return <main className="px-6 py-16 text-center text-sm text-stone-400">Loading…</main>;
  if (p === "missing") {
    return (
      <main className="px-6 py-16 text-center">
        <p className="text-sm text-stone-500">This product is no longer available.</p>
        <Link href="/" className={`${btnClass} mt-4`}>Back to the shop</Link>
      </main>
    );
  }

  const out = p.stock <= 0;
  return (
    <main className="px-6 py-10">
      <div className="mx-auto grid w-full max-w-4xl gap-8 sm:grid-cols-2">
        <div className="aspect-square overflow-hidden rounded-2xl bg-stone-100">
          {p.image_key ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={imageUrl(p.image_key)} alt={p.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full items-center justify-center text-3xl font-bold tracking-widest text-stone-300">ELFIA</div>
          )}
        </div>
        <div>
          {p.sku && <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">{p.sku} · {(p.category ?? "bawal") === "shawl" ? "Shawl" : "Bawal"} collection</p>}
          <h1 className="mt-1 text-2xl font-bold">{p.name}</h1>
          <p className="mt-2 text-xl font-bold text-[#7a2648]">{fmtRM(p.price_cents)}</p>
          {p.description && <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-stone-600">{p.description}</p>}
          <p className="mt-3 text-xs text-stone-500">
            {out ? "Sold out — check back after the next live." : p.stock <= 5 ? `Only ${p.stock} left` : "In stock"}
          </p>
          {!out && (
            <div className="mt-6 flex items-center gap-3">
              <div className="flex items-center rounded-lg border border-stone-300">
                <button type="button" className="h-11 w-10 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                <span className="w-8 text-center text-sm font-semibold">{qty}</span>
                <button type="button" className="h-11 w-10 text-lg" onClick={() => setQty((q) => Math.min(Math.min(99, p.stock), q + 1))}>+</button>
              </div>
              <button type="button" className={btnClass} onClick={() => { addToCart(p.id, qty); setAdded(true); }}>
                Add to cart
              </button>
            </div>
          )}
          {added && (
            <div className="mt-4 flex gap-3">
              <Link href="/cart" className={btnClass}>Go to cart</Link>
              <Link href="/" className={btnGhost}>Keep shopping</Link>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-stone-400">Loading…</main>}>
      <ProductInner />
    </Suspense>
  );
}
