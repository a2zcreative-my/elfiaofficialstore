"use client";

/**
 * Home — v1.4.0.
 *
 * The CEO's layout: a soft blush hero, a three-fact trust strip, horizontal
 * rails of New Arrivals and studio picks, the collections strip, and then the
 * catalogue. On a phone this is the app's Home tab; on a desktop it is the
 * shop's front page — same markup, two shapes.
 *
 * Carousel (CEO: "make carousel slide automatically on the main"): the brand
 * campaign slides first, then every product an admin marks Featured.
 * Auto-advances every 5s, pauses while the pointer is over it, arrows + dots
 * for manual control, and a featured slide clicks through to its product.
 *
 * NOTHING on this page invents a fact. There is no "best seller" rail because
 * the shop does not yet count sales — the second rail shows what the studio
 * actually marked Featured, which is a real answer to the same question.
 */
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import {
  BRAND_SLIDES, CATEGORIES, GROUPS, fmtRM, imageUrl, slideFraming, splitName,
  type PortalSlide, type Product,
} from "@/lib/config";

import { CardSkeleton, Icon, ProductCard, SectionHeader, type IconName } from "./ui";

interface Slide {
  image: string; title: string; subtitle: string; href?: string;
  /** CSS object-position — which part of the photo survives the crop. */
  position?: string;
  /** v1.9.0 — how far the photo is zoomed in. 1 = every edge visible. */
  scale?: number;
}

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
    <div className="group/car relative overflow-hidden rounded-3xl bg-elfia-blush shadow-sm ring-1 ring-elfia-line"
      onMouseEnter={() => { paused.current = true; }}
      onMouseLeave={() => { paused.current = false; }}>
      <div className="flex transition-transform duration-700 ease-out" style={{ transform: `translateX(-${idx * 100}%)` }}>
        {slides.map((s, i) => {
          const inner = (
            <div className="relative aspect-[4/3] w-full sm:aspect-[21/9]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {/* v1.9.0 — the portal's zoom. The photo is laid in whole
                  (object-contain) and then scaled up around its focus point,
                  so 100% shows every edge against the blush and anything
                  higher fills and crops. One dial, no switch. */}
              <img src={s.image} alt={s.title}
                className="h-full w-full object-contain"
                style={{
                  objectPosition: s.position ?? "50% 50%",
                  transform: s.scale && s.scale !== 1 ? `scale(${s.scale})` : undefined,
                  transformOrigin: s.position ?? "50% 50%",
                }}
                loading={i === 0 ? "eager" : "lazy"} />
              {/* A rose wash rather than a black scrim — the blush palette
                  stays intact and the type still passes contrast. */}
              <div className="absolute inset-0 bg-gradient-to-r from-[#40292f]/75 via-[#40292f]/35 to-transparent" />
              <div className="absolute right-5 bottom-6 left-5 max-w-md sm:bottom-10 sm:left-10">
                <p className="text-2xl leading-tight font-bold text-white drop-shadow-sm sm:text-4xl">{s.title}</p>
                <p className="mt-1.5 text-sm text-white/85 sm:text-base">{s.subtitle}</p>
                <span className="mt-4 inline-flex h-10 items-center rounded-full bg-white px-5 text-xs font-semibold text-elfia-deep sm:text-sm">
                  {s.href ? "View this shade" : "Shop now"}
                </span>
              </div>
            </div>
          );
          return (
            <div key={i} className="w-full shrink-0">
              {s.href ? <Link href={s.href}>{inner}</Link> : <Link href="/shop">{inner}</Link>}
            </div>
          );
        })}
      </div>
      {slides.length > 1 && (
        <>
          <button type="button" aria-label="Previous slide"
            className="absolute top-1/2 left-3 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-elfia-deep transition-opacity hover:bg-white sm:flex sm:opacity-0 sm:group-hover/car:opacity-100"
            onClick={() => setIdx((i) => (i - 1 + slides.length) % slides.length)}>
            <Icon name="chevron" size={16} strokeWidth={2} className="rotate-180" />
          </button>
          <button type="button" aria-label="Next slide"
            className="absolute top-1/2 right-3 hidden h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-elfia-deep transition-opacity hover:bg-white sm:flex sm:opacity-0 sm:group-hover/car:opacity-100"
            onClick={() => setIdx((i) => (i + 1) % slides.length)}>
            <Icon name="chevron" size={16} strokeWidth={2} />
          </button>
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

/** A rail of tiles that scrolls sideways on a phone and lays out as a grid on
    a desktop — the app pattern the CEO's layout uses for New Arrivals. */
function ProductRail({ items }: { items: Product[] }) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="rail -mx-4 px-4 sm:hidden">
        {items.map((p) => (
          <div key={p.id} className="rail-item w-[43vw] max-w-[190px]">
            <ProductCard p={p} compact />
          </div>
        ))}
      </div>
      <div className="hidden gap-5 sm:grid sm:grid-cols-3 lg:grid-cols-4">
        {items.slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />)}
      </div>
    </>
  );
}

export default function Home() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [portalSlides, setPortalSlides] = useState<PortalSlide[]>([]);
  const [tab, setTab] = useState<string>("all");

  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[]; slides?: PortalSlide[] }) => {
        setProducts(j.products);
        if (Array.isArray(j.slides)) setPortalSlides(j.slides);
      })
      .catch(() => setProducts([]));
  }, []);

  const all = products ?? [];

  /* v1.7.0 — the carousel is the portal's when the portal has authored one:
     the slides uploaded in its ELFIA tab replace the shipped campaign
     shots. No portal slides = the shipped pair, exactly as before. Featured
     products ride after either set, unchanged. */
  const heroSlides: Slide[] = portalSlides.length > 0
    ? portalSlides.map((s) => {
        /* v1.8.0 (CEO: "I want to adjustable the photo … it is look too zoom")
           — the crop is no longer this file's guess. The portal aims it. */
        const f = slideFraming(s);
        return {
          image: imageUrl(s.image_key),
          title: s.title ?? "",
          subtitle: s.subtitle ?? "",
          position: f.position,
          scale: f.scale,
        };
      })
    : [...BRAND_SLIDES];

  const slides: Slide[] = [
    ...heroSlides,
    ...all
      .filter((p) => p.featured === 1 && p.image_key)
      .map((p) => ({
        image: imageUrl(p.image_key),
        title: splitName(p.name).shade,
        subtitle: `${fmtRM(p.price_cents)} — shop now`,
        href: `/p?id=${p.id}`,
      })),
  ];

  /* "New" = most recently added, which is what the id order means here.
     "Studio picks" = what an admin actually marked Featured. Both are facts
     the shop already holds; neither is a made-up ranking. */
  const newest = [...all].sort((a, b) => b.id - a.id).slice(0, 6);
  const picks = all.filter((p) => p.featured === 1).slice(0, 6);

  const TRUST: { icon: IconName; title: string; note: string }[] = [
    { icon: "truck", title: "Nationwide delivery", note: "Tracked to your door" },
    { icon: "shield", title: "Premium material", note: "Lightweight & opaque" },
    { icon: "spark", title: "Direct from ELFIA", note: "No middleman, no markup" },
  ];

  const groups = GROUPS.map((g) => ({ g, items: all.filter(g.match) })).filter((x) => x.items.length > 0);

  const shown = all.filter((p) => tab === "all" || (p.category ?? "bawal") === tab);
  const counts = (key: string) => all.filter((p) => key === "all" || (p.category ?? "bawal") === key).length;

  return (
    <main className="px-4 pt-4 pb-10 sm:px-6 sm:pt-8">
      <div className="mx-auto w-full max-w-6xl">
        <Carousel slides={slides} />

        {/* trust strip */}
        <div className="mt-5 grid grid-cols-3 gap-2.5 sm:gap-4">
          {TRUST.map((t) => (
            <div key={t.title} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white px-2 py-3.5 text-center ring-1 ring-elfia-line sm:flex-row sm:gap-3 sm:px-4 sm:text-left">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                <Icon name={t.icon} size={18} />
              </span>
              <span>
                <span className="block text-[11px] leading-tight font-semibold text-elfia-ink sm:text-[13px]">{t.title}</span>
                <span className="mt-0.5 block text-[10px] leading-tight text-elfia-muted sm:text-[11px]">{t.note}</span>
              </span>
            </div>
          ))}
        </div>

        {/* collections strip */}
        {groups.length > 0 && (
          <section className="mt-9">
            <SectionHeader title="Shop by collection" href="/categories" />
            <div className="rail -mx-4 px-4 sm:mx-0 sm:grid sm:grid-cols-4 sm:gap-4 sm:px-0">
              {groups.map(({ g, items }) => (
                <Link key={g.key} href={`/shop?c=${g.key}`}
                  className="rail-item group flex w-48 items-center gap-3 rounded-2xl bg-white p-2.5 ring-1 ring-elfia-line transition-colors hover:ring-elfia-rose sm:w-auto">
                  <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-elfia-veil">
                    {items[0]?.image_key && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(items[0].image_key)} alt="" className="h-full w-full object-cover object-top" />
                    )}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-semibold text-elfia-ink group-hover:text-elfia-deep">{g.label}</span>
                    <span className="block text-[11px] text-elfia-muted">{items.length} item{items.length === 1 ? "" : "s"}</span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* new arrivals */}
        <section className="mt-10">
          <SectionHeader title="New arrivals" href="/shop" hint="The latest shades into the shop" />
          {products === null
            ? <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4"><CardSkeleton n={4} /></div>
            : <ProductRail items={newest} />}
        </section>

        {/* studio picks */}
        {picks.length > 0 && (
          <section className="mt-10">
            <SectionHeader title="Studio picks" href="/shop?c=featured" hint="Hand-picked from the range" />
            <ProductRail items={picks} />
          </section>
        )}

        {/* the catalogue */}
        <section className="mt-14 scroll-mt-28" id="shop">
          <div className="text-center">
            <p className="text-[11px] font-semibold tracking-[0.28em] text-elfia-rose uppercase">The collection</p>
            <h2 className="mt-2 text-3xl font-bold text-elfia-ink sm:text-4xl">Shop ELFIA</h2>
            <p className="mx-auto mt-2 max-w-md text-sm text-elfia-muted">
              Lightweight, opaque, and easy to style — order direct and we deliver nationwide.
            </p>
          </div>

          {/* The collection tabs (v0.2.0) stay on the home page: they are the
              coarse Bawal / Shawl split, while /shop does the finer filtering
              and sorting. */}
          <div className="mt-7 flex flex-wrap justify-center gap-2" data-testid="category-tabs">
            {[{ key: "all", label: "All" }, ...CATEGORIES].map((c) => (
              <button key={c.key} type="button"
                className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                  tab === c.key ? "bg-elfia-deep text-white" : "bg-white text-elfia-body ring-1 ring-elfia-line hover:ring-elfia-rose"}`}
                onClick={() => setTab(c.key)}>
                {c.label}
                {products && <span className="ml-1.5 text-[11px] opacity-60">{counts(c.key)}</span>}
              </button>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4" data-testid="product-grid">
            {products === null
              ? <CardSkeleton n={8} />
              : shown.slice(0, 8).map((p) => <ProductCard key={p.id} p={p} />)}
          </div>

          {products !== null && shown.length === 0 && (
            <p className="mt-12 text-center text-sm text-elfia-muted">
              Nothing in this collection yet — check back after the next live.
            </p>
          )}

          {shown.length > 8 && (
            <div className="mt-8 text-center">
              <Link href={tab === "all" ? "/shop" : `/shop?c=${tab}`}
                className="inline-flex h-12 items-center justify-center rounded-full border border-elfia-line bg-white px-7 text-sm font-semibold text-elfia-deep transition-colors hover:border-elfia-rose">
                See all {shown.length} products
              </Link>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
