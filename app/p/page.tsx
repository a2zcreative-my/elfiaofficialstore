"use client";

/** Product detail — /p?id=N (query param keeps the site fully static).
 *
 *  v0.6.0: sold out is no longer a dead end — it collects a name and a
 *  WhatsApp number so the shop can message the customer on restock.
 *  v1.4.0: blush layout, the wishlist heart, and — on a phone — a sticky
 *  buy bar so "Add to cart" is reachable without scrolling back up. */
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  addToCart, btnClass, btnGhost, countedStock, fmtRM, imageUrl, inputClass, isSoldOut, labelClass, lowStock,
  maxQty, splitName, type Product,
} from "@/lib/config";

import { Icon, ProductCard, SectionHeader, WishHeart } from "./../ui";

function NotifyMe({ product }: { product: Product }) {
  const [form, setForm] = useState({ name: "", phone: "", website: "" });
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim()) return;
    setState("sending"); setError("");
    try {
      const r = await fetch("/api/v1/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_id: product.id, ...form }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
        setError(j?.error?.message ?? "Could not save that — please try again.");
        setState("idle");
        return;
      }
      setState("done");
    } catch {
      setError("Network problem — please try again.");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div className="mt-6 rounded-2xl border border-elfia-rose/30 bg-elfia-veil p-4">
        <p className="text-sm font-semibold text-elfia-deep">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-elfia-body">
          We&apos;ll WhatsApp you the moment {splitName(product.name).shade} is back in stock.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-elfia-line bg-white p-4">
      <p className="text-sm font-semibold text-elfia-ink">Tell me when it&apos;s back</p>
      <p className="mt-0.5 text-xs text-elfia-muted">
        We message you on WhatsApp when this shade is restocked. Nothing else, ever.
      </p>
      <input type="text" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
        className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Your name</span>
          <input className={inputClass} value={form.name} maxLength={120} required
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="block">
          <span className={labelClass}>WhatsApp number</span>
          <input className={inputClass} value={form.phone} maxLength={40} required inputMode="tel" placeholder="012 345 6789"
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        </label>
      </div>
      <button type="submit" className={`${btnClass} mt-3 w-full sm:w-auto`} disabled={state === "sending"}>
        {state === "sending" ? "Saving…" : "Notify me"}
      </button>
      {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
    </form>
  );
}

function ProductInner() {
  const params = useSearchParams();
  const id = Number(params.get("id"));
  const [p, setP] = useState<Product | null | "missing">(null);
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState(false);
  const [others, setOthers] = useState<Product[]>([]);
  /* The phone buy bar exists ONLY while the real Add-to-cart button is off
     screen, and only on a phone. Rendering both at once would put two
     "Add to cart" buttons in the page at the same time — confusing for a
     screen reader, and ambiguous for the end-to-end test that clicks it by
     name (scratch/store-e2e.mjs). */
  const buyRef = useRef<HTMLDivElement | null>(null);
  const [showBar, setShowBar] = useState(false);
  useEffect(() => {
    const el = buyRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const phone = () => window.matchMedia("(max-width: 639px)").matches;
    const io = new IntersectionObserver(([e]) => setShowBar(Boolean(e && !e.isIntersecting && phone())), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [p]);

  useEffect(() => {
    if (!id) { setP("missing"); return; }
    setAdded(false); setQty(1);
    void fetch(`/api/v1/products/${id}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((j: { product: Product }) => setP(j.product))
      .catch(() => setP("missing"));
    /* "You may also like" — same collection, never this product. */
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setOthers(j.products))
      .catch(() => setOthers([]));
  }, [id]);

  if (p === null) return <main className="px-6 py-16 text-center text-sm text-elfia-muted">Loading…</main>;
  if (p === "missing") {
    return (
      <main className="px-6 py-16 text-center">
        <p className="text-sm text-elfia-muted">This product is no longer available.</p>
        <Link href="/shop" className={`${btnClass} mt-4`}>Back to the shop</Link>
      </main>
    );
  }

  const out = isSoldOut(p);
  const low = lowStock(p);
  /* The live piece count, shown whenever it is maintained (portal-synced
     products are). The CEO's ask: the shop must show the qty "as per
     inventory in my portal", not a vague "in stock". */
  const counted = countedStock(p);
  const { series, shade } = splitName(p.name);
  const collection = (p.category ?? "bawal") === "shawl" ? "Shawl" : "Bawal";
  const also = others.filter((o) => o.id !== p.id && (o.category ?? "bawal") === (p.category ?? "bawal")).slice(0, 4);

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-5xl">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-elfia-muted">
          <Link href="/shop" className="flex items-center gap-1 hover:text-elfia-deep">
            <Icon name="back" size={14} /> Shop
          </Link>
          <span className="text-elfia-line">/</span>
          <span className="truncate text-elfia-body">{shade}</span>
        </nav>

        <div className="grid gap-7 sm:grid-cols-2 sm:gap-10">
          {/* 3:4 — the shape of the product photography, so the whole shot
              shows here even though the catalogue grid frames it 4:5. */}
          <div className="relative aspect-[3/4] overflow-hidden rounded-3xl bg-elfia-veil ring-1 ring-elfia-line">
            {p.image_key ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(p.image_key)} alt={p.name} className="h-full w-full object-cover object-top" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-bold tracking-widest text-elfia-rose/40">ELFIA</div>
            )}
            <div className="absolute top-3.5 right-3.5"><WishHeart id={p.id} className="h-10 w-10 shadow-sm" /></div>
            {out && (
              <span className="absolute top-4 left-4 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-bold tracking-wider text-elfia-body uppercase">
                Sold out
              </span>
            )}
          </div>

          <div className="sm:pt-2">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-elfia-muted uppercase">
              {[p.sku, `${collection} collection`].filter(Boolean).join(" · ")}
            </p>
            <h1 className="mt-2 text-3xl leading-tight font-bold text-elfia-ink">{shade}</h1>
            {series && <p className="mt-1 text-sm text-elfia-muted">{series}</p>}
            <p className="mt-4 text-2xl font-bold text-elfia-deep">{fmtRM(p.price_cents)}</p>

            {p.description && (
              <p className="mt-5 text-sm leading-relaxed whitespace-pre-wrap text-elfia-body">{p.description}</p>
            )}

            <p className={`mt-4 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
              out ? "bg-elfia-blush text-elfia-body" : low ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
              <span className={`h-1.5 w-1.5 rounded-full ${out ? "bg-elfia-muted" : low ? "bg-amber-500" : "bg-emerald-500"}`} />
              {out ? "Sold out — join the list below and we'll tell you first."
                : low ? `Only ${low} left — order soon`
                : counted ? `${counted} pieces available — ready to ship`
                : "In stock — ready to ship"}
            </p>

            {!out && (
              <div ref={buyRef} className="mt-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center rounded-full border border-elfia-line bg-white">
                  <button type="button" aria-label="Decrease quantity" className="h-12 w-12 text-lg text-elfia-body" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <button type="button" aria-label="Increase quantity" className="h-12 w-12 text-lg text-elfia-body" onClick={() => setQty((q) => Math.min(maxQty(p), q + 1))}>+</button>
                </div>
                <button type="button" className={`${btnClass} flex-1 sm:flex-none`} onClick={() => { addToCart(p.id, qty); setAdded(true); }}>
                  Add to cart
                </button>
              </div>
            )}

            {added && (
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/cart" className={btnClass}>Go to cart</Link>
                <Link href="/shop" className={btnGhost}>Keep shopping</Link>
              </div>
            )}

            {out && <NotifyMe product={p} />}

            <ul className="mt-8 space-y-2 border-t border-elfia-line pt-5 text-xs text-elfia-muted">
              <li className="flex items-center gap-2"><Icon name="truck" size={15} className="shrink-0 text-elfia-rose" /> Delivered across Malaysia with tracking.</li>
              <li className="flex items-center gap-2"><Icon name="shield" size={15} className="shrink-0 text-elfia-rose" /> Pay by FPX online banking or bank transfer.</li>
              <li className="flex items-center gap-2">
                <Icon name="receipt" size={15} className="shrink-0 text-elfia-rose" />
                <span>See the <Link href="/policies" className="underline hover:text-elfia-deep">delivery &amp; returns policy</Link>.</span>
              </li>
            </ul>
          </div>
        </div>

        {also.length > 0 && (
          <section className="mt-14">
            <SectionHeader title="You may also like" href="/shop" />
            <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-4">
              {also.map((o) => <ProductCard key={o.id} p={o} compact />)}
            </div>
          </section>
        )}
      </div>

      {/* phone: the buy bar, pinned just above the tab bar. Appears only once
          the real button has scrolled away — see the observer above. */}
      {!out && showBar && (
        <div className="animate-rise above-tabbar fixed inset-x-0 z-30 border-t border-elfia-line bg-white px-4 py-2.5 sm:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-12 shrink-0 items-center rounded-full border border-elfia-line">
              <button type="button" aria-label="Decrease quantity" className="h-12 w-10 text-lg text-elfia-body" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums">{qty}</span>
              <button type="button" aria-label="Increase quantity" className="h-12 w-10 text-lg text-elfia-body" onClick={() => setQty((q) => Math.min(maxQty(p), q + 1))}>+</button>
            </div>
            <button type="button" onClick={() => { addToCart(p.id, qty); setAdded(true); }}
              aria-label={`Add ${shade} to cart`}
              className="h-12 flex-1 rounded-full bg-elfia-deep text-sm font-semibold text-white active:bg-elfia-deeper">
              Add · {fmtRM(p.price_cents * qty)}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

export default function ProductPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-elfia-muted">Loading…</main>}>
      <ProductInner />
    </Suspense>
  );
}
