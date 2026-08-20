"use client";

/**
 * Home — hero carousel, a short trust row, and the catalogue with collection
 * tabs.
 *
 * Carousel (CEO: "make carousel slide automatically on the main"): the brand
 * campaign slides first, then every product an admin marks Featured.
 * Auto-advances every 5s, pauses while the pointer is over it (nobody likes a
 * slide escaping mid-read), arrows + dots for manual control, and a featured
 * slide clicks through to its product page.
 *
 * v0.6.0 — the cards were square crops of portrait photography with a
 * truncated one-line name ("Bawal Premium — …"). They are now 4:5 frames that
 * match how the range was shot, with the shade name large and the series
 * small, so the grid reads like a lookbook instead of a stock list.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { BRAND_SLIDES, CATEGORIES, fmtRM, imageUrl, splitName, type Product } from "@/lib/config";

interface Slide { image: string; title: string; subtitle: string; href?: string; position?: string }

function Carousel({ slides }: { slides: Slide[] }) {
  const [idx, setIdx] = useState(0);
  const paused = useRef(false);

  useEffect(() => {
    if (slides.length <= 1) return;
    const t = setInterval(() => {
      if (!paused.current) setIdx((i) => (i + 1) % slides.length);
    }, 5000);
    return () => clearInterval(t);
  }, [slides.length]);

  if (slides.length === 0) return null;
  return (
    <div className="group/car relative overflow-hidden rounded-3xl bg-stone-900 shadow-sm"
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}>
      <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {slides.map((s, i) => {
          const inner = (
            <div className="relative aspect-[4/3] w-full sm:aspect-[16/9]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={s.image} alt={s.title} className="h-full w-full object-cover"
                style={{ objectPosition: s.position ?? "50% 0%" }}
                loading={i === 0 ? "eager" : "lazy"} />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
              <div className="absolute right-5 bottom-6 left-5 sm:bottom-9 sm:left-9">
                <p className="text-2xl font-bold text-white drop-shadow-sm sm:text-4xl">{s.title}</p>
                <p className="mt-1.5 text-sm text-white/85 sm:text-base">{s.subtitle}</p>
                <span className="mt-4 inline-flex h-9 items-center rounded-full bg-white/95 px-4 text-xs font-semibold text-stone-900">
                  {s.href ? "View this shade" : "Shop the collection"}
                </span>
              </div>
            </div>
          );
          return (
            <div key={i} className="w-full shrink-0">
              {s.href ? <Link href={s.href}>{inner}</Link> : <a href="#shop">{inner}</a>}
            </div>
          );
        })}
      </div>
      {slides.length > 1 && (
        <>
          <button type="button" aria-label="Previous slide"
            className="absolute top-1/2 left-3 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg font-bold text-stone-800 transition-opacity hover:bg-white sm:flex sm:opacity-0 sm:group-hover/car:opacity-100"
            onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)}>‹</button>
          <button type="button" aria-label="Next slide"
            className="absolute top-1/2 right-3 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-lg font-bold text-stone-800 transition-opacity hover:bg-white sm:flex sm:opacity-0 sm:group-hover/car:opacity-100"
            onClick={() => setIdx((i) => (i + 1) % slides.length)}>›</button>
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
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

/** One catalogue card. The whole tile is the link. */
function ProductCard({ p }: { p: Product }) {
  const { series, shade } = splitName(p.name);
  const out = p.stock <= 0;
  return (
    <Link href={`/p?id=${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-stone-100 ring-1 ring-stone-200/70">
        {p.image_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(p.image_key)} alt={p.name}
            className={`h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04] ${out ? "opacity-70" : ""}`}
            loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl font-bold tracking-widest text-stone-300">ELFIA</div>
        )}
        {out ? (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold tracking-wider text-stone-700 uppercase">
            Sold out
          </span>
        ) : p.stock <= 5 ? (
          <span className="absolute top-3 left-3 rounded-full bg-amber-500/95 px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase">
            {p.stock} left
          </span>
        ) : null}
      </div>
      <div className="mt-3">
        {/* SKU alone — the series name repeats on every card and only ever
            wrapped to a second line on a phone. */}
        {(p.sku ?? series) && (
          <p className="text-[10px] font-medium tracking-[0.18em] text-stone-400 uppercase">{p.sku ?? series}</p>
        )}
        <p className="mt-1 line-clamp-2 text-[15px] leading-snug font-medium text-stone-800 group-hover:text-[#7a2648]">
          {shade}
        </p>
        <p className="mt-1 text-sm font-bold text-[#7a2648]">{fmtRM(p.price_cents)}</p>
      </div>
    </Link>
  );
}

const TRUST = [
  { title: "Direct from ELFIA", note: "No middleman, no markup" },
  { title: "Ships across Malaysia", note: "Tracked, straight to your door" },
  { title: "Bank transfer or FPX", note: "Confirmed on WhatsApp" },
];

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
      .map((p) => ({ image: imageUrl(p.image_key), title: splitName(p.name).shade, subtitle: `${fmtRM(p.price_cents)} — shop now`, href: `/p?id=${p.id}` })),
  ];

  const shown = (products ?? []).filter((p) => tab === "all" || (p.category ?? "bawal") === tab);
  const counts = (key: string) => (products ?? []).filter((p) => key === "all" || (p.category ?? "bawal") === key).length;

  return (
    <main className="px-4 pt-5 pb-10 sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-5xl">
        <Carousel slides={slides} />

        <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-2xl bg-stone-200/70">
          {TRUST.map((t) => (
            <div key={t.title} className="bg-white px-2 py-3.5 text-center sm:px-4">
              <p className="text-[11px] leading-tight font-semibold text-stone-800 sm:text-[13px]">{t.title}</p>
              <p className="mt-1 text-[10px] leading-tight text-stone-500 sm:text-[11px]">{t.note}</p>
            </div>
          ))}
        </div>

        <div id="shop" className="mt-14 scroll-mt-28 text-center">
          <p className="text-[11px] font-semibold tracking-[0.28em] text-[#7a2648]/70 uppercase">The collection</p>
          <h1 className="mt-2 text-3xl font-bold text-stone-900 sm:text-4xl">Shop ELFIA</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            Lightweight, opaque, and easy to style — order direct and we deliver nationwide.
          </p>
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-2" data-testid="category-tabs">
          {[{ key: "all", label: "All" }, ...CATEGORIES].map((c) => (
            <button key={c.key} type="button"
              className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                tab === c.key ? "bg-[#7a2648] text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"}`}
              onClick={() => setTab(c.key)}>
              {c.label}
              {products && <span className="ml-1.5 text-[11px] opacity-60">{counts(c.key)}</span>}
            </button>
          ))}
        </div>

        {products === null && (
          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[4/5] rounded-2xl bg-stone-200/70" />
                <div className="mt-3 h-3 w-1/3 rounded bg-stone-200/70" />
                <div className="mt-2 h-3.5 w-2/3 rounded bg-stone-200/70" />
              </div>
            ))}
          </div>
        )}
        {products !== null && shown.length === 0 && (
          <p className="mt-12 text-center text-sm text-stone-500">Nothing in this collection yet — check back after the next live.</p>
        )}

        <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-grid">
          {shown.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      </div>
    </main>
  );
}
