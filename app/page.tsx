"use client";

/**
 * Home — hero carousel + the catalogue with collection tabs.
 *
 * Carousel (CEO: "make carousel slide automatically on the main"): the
 * brand campaign slides first, then every product an admin marks Featured.
 * Auto-advances every 4.5s, pauses while the pointer is over it (nobody
 * likes a slide escaping mid-read), arrows + dots for manual control, and
 * a featured slide clicks through to its product page.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BRAND_SLIDES, CATEGORIES, fmtRM, imageUrl, type Product } from "@/lib/config";

interface Slide { image: string; title: string; subtitle: string; href?: string }

function Carousel({ slides }: { slides: Slide[] }) {
  const [idx, setIdx] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => {
      if (!paused.current) setIdx((i) => (i + 1) % slides.length);
    }, 4500);
    return () => clearInterval(t);
  }, [slides.length]);

  if (slides.length === 0) return null;
  return (
    <div className="relative overflow-hidden rounded-2xl bg-stone-900"
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}>
      <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {slides.map((s, i) => {
          const inner = (
            <div className="relative aspect-[16/10] w-full sm:aspect-[21/9]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt={s.title} className="h-full w-full object-cover object-top" loading={i === 0 ? "eager" : "lazy"} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
              <div className="absolute bottom-5 left-5 right-5 sm:bottom-8 sm:left-8">
                <p className="text-xl font-bold text-white sm:text-3xl">{s.title}</p>
                <p className="mt-1 text-sm text-white/80">{s.subtitle}</p>
              </div>
            </div>
          );
          return (
            <div key={i} className="w-full shrink-0">
              {s.href ? <Link href={s.href}>{inner}</Link> : inner}
            </div>
          );
        })}
      </div>
      {slides.length > 1 && (
        <>
          <button type="button" aria-label="Previous slide"
            className="absolute top-1/2 left-3 -translate-y-1/2 rounded-full bg-white/80 px-3 py-1.5 text-lg font-bold text-stone-800 hover:bg-white"
            onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)}>‹</button>
          <button type="button" aria-label="Next slide"
            className="absolute top-1/2 right-3 -translate-y-1/2 rounded-full bg-white/80 px-3 py-1.5 text-lg font-bold text-stone-800 hover:bg-white"
            onClick={() => setIdx((i) => (i + 1) % slides.length)}>›</button>
          <div className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1.5">
            {slides.map((_, i) => (
              <button key={i} type="button" aria-label={`Slide ${i + 1}`}
                className={`h-1.5 rounded-full transition-all ${i === idx ? "w-6 bg-white" : "w-1.5 bg-white/50"}`}
                onClick={() => setIdx(i)} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [tab, setTab] = useState<string>("all");

  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products))
      .catch(() => setProducts([]));
  }, []);

  const slides: Slide[] = [
    ...BRAND_SLIDES,
    ...(products ?? [])
      .filter((p) => p.featured === 1 && p.image_key)
      .map((p) => ({ image: imageUrl(p.image_key), title: p.name, subtitle: `${fmtRM(p.price_cents)} — shop now`, href: `/p?id=${p.id}` })),
  ];

  const shown = (products ?? []).filter((p) => tab === "all" || (p.category ?? "bawal") === tab);

  return (
    <main className="px-6 py-8">
      <div className="mx-auto w-full max-w-5xl">
        <Carousel slides={slides} />

        <div className="mt-10 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[#7a2648]">Shop ELFIA</h1>
            <p className="mt-1 text-sm text-stone-500">Order direct — delivered nationwide.</p>
          </div>
          <div className="flex gap-1.5" data-testid="category-tabs">
            {[{ key: "all", label: "All" }, ...CATEGORIES].map((c) => (
              <button key={c.key} type="button"
                className={`rounded-full px-4 py-1.5 text-sm font-medium ${tab === c.key ? "bg-[#7a2648] text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}
                onClick={() => setTab(c.key)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>

        {products === null && <p className="mt-10 text-sm text-stone-400">Loading…</p>}
        {products !== null && shown.length === 0 && (
          <p className="mt-10 text-sm text-stone-500">Nothing in this collection yet — check back after the next live.</p>
        )}

        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-grid">
          {shown.map((p) => (
            <Link key={p.id} href={`/p?id=${p.id}`} className="group rounded-2xl border border-stone-200 bg-white p-3 transition-shadow hover:shadow-md">
              <div className="aspect-square overflow-hidden rounded-xl bg-stone-100">
                {p.image_key ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={imageUrl(p.image_key)} alt={p.name} className="h-full w-full object-cover object-top transition-transform group-hover:scale-105" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-2xl font-bold tracking-widest text-stone-300">ELFIA</div>
                )}
              </div>
              <p className="mt-2.5 truncate text-sm font-medium">{p.name}</p>
              {p.sku && <p className="text-[10px] tracking-wider text-stone-400 uppercase">{p.sku}</p>}
              <div className="mt-1 flex items-center justify-between">
                <p className="text-sm font-bold text-[#7a2648]">{fmtRM(p.price_cents)}</p>
                {p.stock <= 0 ? (
                  <span className="text-[10px] font-semibold text-red-600 uppercase">Sold out</span>
                ) : p.stock <= 5 ? (
                  <span className="text-[10px] font-semibold text-amber-600 uppercase">{p.stock} left</span>
                ) : null}
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
