"use client";

/** Product detail — /p?id=N (query param keeps the site fully static).
    v0.6.0: sold out is no longer a dead end — it collects a name and a
    WhatsApp number so the shop can message the customer on restock. */
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import {
  addToCart, btnClass, btnGhost, fmtRM, imageUrl, inputClass, isSoldOut, labelClass, lowStock,
  maxQty, splitName, type Product,
} from "@/lib/config";

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
      <div className="mt-6 rounded-2xl border border-[#7a2648]/20 bg-[#7a2648]/5 p-4">
        <p className="text-sm font-semibold text-[#7a2648]">You&apos;re on the list.</p>
        <p className="mt-1 text-sm text-stone-600">
          We&apos;ll WhatsApp you the moment {splitName(product.name).shade} is back in stock.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
      <p className="text-sm font-semibold text-stone-800">Tell me when it&apos;s back</p>
      <p className="mt-0.5 text-xs text-stone-500">
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

  const out = isSoldOut(p);
  const low = lowStock(p);
  const { series, shade } = splitName(p.name);
  const collection = (p.category ?? "bawal") === "shawl" ? "Shawl" : "Bawal";

  return (
    <main className="px-4 py-6 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        <nav className="mb-4 text-xs text-stone-500">
          <Link href="/" className="hover:text-[#7a2648]">Shop</Link>
          <span className="mx-1.5 text-stone-300">/</span>
          <span className="text-stone-700">{shade}</span>
        </nav>

        <div className="grid gap-8 sm:grid-cols-2">
          {/* 3:4 — the shape of the product photography, so the whole shot
              shows here even though the catalogue grid frames it 4:5. */}
          <div className="relative aspect-[3/4] overflow-hidden rounded-3xl bg-stone-100 ring-1 ring-stone-200/70">
            {p.image_key ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl(p.image_key)} alt={p.name} className="h-full w-full object-cover object-top" />
            ) : (
              <div className="flex h-full items-center justify-center text-3xl font-bold tracking-widest text-stone-300">ELFIA</div>
            )}
            {out && (
              <span className="absolute top-4 left-4 rounded-full bg-white/95 px-3 py-1.5 text-[11px] font-bold tracking-wider text-stone-700 uppercase">
                Sold out
              </span>
            )}
          </div>

          <div className="sm:pt-2">
            <p className="text-[11px] font-semibold tracking-[0.2em] text-stone-400 uppercase">
              {[p.sku, `${collection} collection`].filter(Boolean).join(" · ")}
            </p>
            <h1 className="mt-2 text-3xl leading-tight font-bold text-stone-900">{shade}</h1>
            {series && <p className="mt-1 text-sm text-stone-500">{series}</p>}
            <p className="mt-4 text-2xl font-bold text-[#7a2648]">{fmtRM(p.price_cents)}</p>

            {p.description && (
              <p className="mt-5 text-sm leading-relaxed whitespace-pre-wrap text-stone-600">{p.description}</p>
            )}

            <p className={`mt-4 text-xs font-medium ${out ? "text-stone-500" : low ? "text-amber-700" : "text-green-700"}`}>
              {out ? "Sold out — join the list below and we'll tell you first."
                : low ? `Only ${low} left` : "In stock — ready to ship"}
            </p>

            {!out && (
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <div className="flex items-center rounded-full border border-stone-300 bg-white">
                  <button type="button" aria-label="Decrease quantity" className="h-11 w-11 text-lg" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
                  <span className="w-8 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <button type="button" aria-label="Increase quantity" className="h-11 w-11 text-lg" onClick={() => setQty((q) => Math.min(maxQty(p), q + 1))}>+</button>
                </div>
                <button type="button" className={`${btnClass} flex-1 sm:flex-none`} onClick={() => { addToCart(p.id, qty); setAdded(true); }}>
                  Add to cart
                </button>
              </div>
            )}

            {added && (
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/cart" className={btnClass}>Go to cart</Link>
                <Link href="/" className={btnGhost}>Keep shopping</Link>
              </div>
            )}

            {out && <NotifyMe product={p} />}

            <ul className="mt-8 space-y-1.5 border-t border-stone-200 pt-5 text-xs text-stone-500">
              <li>Delivered across Malaysia with tracking.</li>
              <li>Pay by bank transfer or online banking — confirmed on WhatsApp.</li>
              <li>
                See the <Link href="/policies" className="underline hover:text-[#7a2648]">delivery &amp; returns policy</Link>.
              </li>
            </ul>
          </div>
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
