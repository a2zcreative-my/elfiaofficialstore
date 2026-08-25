"use client";

/** Checkout — collects delivery details, sends product IDs + quantities
    ONLY. The Worker prices everything, reserves stock and mints the order;
    on success the cart clears and the customer lands on their order page.

    v1.0.0 — the CEO watched someone refresh mid-checkout and lose the lot.
    Now every keystroke is kept on the device (never sent anywhere until they
    press the button), a signed-in customer's saved details fill it in, and
    the finished order is remembered locally so it can be reopened from
    /track without hunting for the link.

    v1.4.0 — blush layout, a two-step indicator, and the order summary in
    view while the form is filled, so nobody presses Place order without
    seeing what they are about to owe. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import Link from "next/link";

import {
  btnClass, clearDraft, fmtRM, imageUrl, inputClass, labelClass, readCart, readDraft, rememberOrder,
  splitName, writeCart, writeDraft, type Account, type CartLine, type Product, type StoreConfig,
} from "@/lib/config";

import { Icon } from "./../ui";

export default function Checkout() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", address: "", email: "", notes: "", website: "" });
  /* v1.3.0 — PDPA marketing consent. Default OFF, never pre-ticked, not kept
     in the draft: consent is a decision made on this order, not a leftover. */
  const [marketing, setMarketing] = useState(false);
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);
  const [me, setMe] = useState<Account | null>(null);

  /* The summary. Prices come from the server here too — this panel must never
     disagree with what the Worker charges. */
  const [lines, setLines] = useState<CartLine[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [config, setConfig] = useState<StoreConfig | null>(null);

  useEffect(() => {
    const cart = readCart();
    if (cart.length === 0) { setEmpty(true); return; }
    setLines(cart);
    void fetch("/api/v1/products").then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products)).catch(() => null);
    void fetch("/api/v1/store-config").then((r) => r.json())
      .then((j: StoreConfig) => setConfig(j)).catch(() => null);

    // Whatever they had typed before the refresh.
    const draft = readDraft();
    if (Object.keys(draft).length) setForm((f) => ({ ...f, ...draft }));
    // …and, if they are signed in, their saved details fill any gaps.
    void fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { customer: Account } | null) => {
        if (!j?.customer) return;
        setMe(j.customer);
        setForm((f) => ({
          ...f,
          name: f.name || j.customer.name,
          phone: f.phone || (j.customer.phone ?? ""),
          address: f.address || (j.customer.address ?? ""),
          email: f.email || j.customer.email,
        }));
      })
      .catch(() => null);
  }, []);

  const rows = lines
    .map((l) => ({ line: l, product: products.find((p) => p.id === l.id) }))
    .filter((r): r is { line: CartLine; product: Product } => Boolean(r.product));
  const subtotal = rows.reduce((n, r) => n + r.product.price_cents * r.line.qty, 0);
  const shipping = config ? (subtotal >= config.free_above_cents ? 0 : config.shipping_cents) : null;

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => {
      const next = { ...f, [k]: e.target.value };
      // Kept on this device only. The honeypot is never saved.
      const { website: _drop, ...keep } = next;
      writeDraft(keep);
      return next;
    });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) return;
    setState("sending"); setError("");
    try {
      const r = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: { ...form, marketing }, items: readCart() }),
      });
      const j = (await r.json()) as { token?: string; order_number?: string; error?: { message?: string } };
      if (!r.ok || !j.token) {
        setError(j.error?.message ?? "Could not place the order — please try again.");
        setState("idle");
        return;
      }
      writeCart([]);   // the order now owns these items
      clearDraft();    // and the draft has served its purpose
      if (j.order_number) rememberOrder(j.order_number, j.token);
      router.push(`/order?t=${j.token}`);
    } catch {
      setError("Network problem — please try again.");
      setState("idle");
    }
  };

  if (empty) {
    return (
      <main className="px-6 py-16 text-center">
        <p className="text-sm text-elfia-muted">Your cart is empty.</p>
        <Link href="/shop" className={`${btnClass} mt-4`}>Browse the shop</Link>
      </main>
    );
  }

  return (
    <main className="px-4 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-4xl">
        {/* step indicator */}
        <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide uppercase">
          <span className="flex items-center gap-1.5 text-elfia-deep">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-elfia-deep text-[10px] text-white">1</span>
            Details
          </span>
          <span className="h-px w-6 bg-elfia-line" />
          <span className="flex items-center gap-1.5 text-elfia-muted">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-elfia-blush text-[10px] text-elfia-muted">2</span>
            Payment
          </span>
        </div>

        <h1 className="mt-3 text-2xl font-bold text-elfia-ink">Delivery details</h1>
        <p className="mt-1 text-sm text-elfia-muted">
          Place the order first — payment comes on the next page, by FPX or bank transfer.
        </p>
        {me ? (
          <p className="mt-2 text-xs text-elfia-muted">
            Ordering as <span className="font-semibold text-elfia-body">{me.email}</span> — it will appear in your account.
          </p>
        ) : (
          <p className="mt-2 text-xs text-elfia-muted">
            Ordering as a guest, which is fine.{" "}
            <Link href="/account" className="underline hover:text-elfia-deep">Sign in</Link> if you would rather keep it in an account.
          </p>
        )}

        <div className="mt-6 grid gap-6 sm:grid-cols-[1fr_20rem] sm:items-start">
          <form onSubmit={submit} className="space-y-4 rounded-2xl border border-elfia-line bg-white p-5">
            <input type="text" value={form.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            <label className="block">
              <span className={labelClass}>Full name *</span>
              <input className={inputClass} value={form.name} onChange={set("name")} required maxLength={120} autoComplete="name" />
            </label>
            <label className="block">
              <span className={labelClass}>Phone / WhatsApp * (we confirm your order here)</span>
              <input className={inputClass} value={form.phone} onChange={set("phone")} required maxLength={40} inputMode="tel" autoComplete="tel" />
            </label>
            <label className="block">
              <span className={labelClass}>Delivery address *</span>
              <textarea className={`${inputClass} h-24 py-2.5`} value={form.address} onChange={set("address")} required maxLength={500} autoComplete="street-address" />
            </label>
            <label className="block">
              <span className={labelClass}>Email (optional)</span>
              <input className={inputClass} value={form.email} onChange={set("email")} type="email" maxLength={200} autoComplete="email" />
            </label>
            <label className="block">
              <span className={labelClass}>Order notes (optional)</span>
              <input className={inputClass} value={form.notes} onChange={set("notes")} maxLength={300} />
            </label>
            <label className="flex items-start gap-2.5 rounded-xl bg-elfia-cream px-3 py-2.5">
              <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-elfia-line accent-[#7a2648]" />
              <span className="text-xs leading-relaxed text-elfia-body">
                I agree to receive news and promotions from ELFIA by WhatsApp or email.
                Optional — you can withdraw anytime. <span className="text-elfia-muted">/ Saya bersetuju menerima berita dan promosi daripada ELFIA. Pilihan — boleh ditarik balik bila-bila masa.</span>
              </span>
            </label>
            <button type="submit" className={`${btnClass} w-full`} disabled={state === "sending"}>
              {state === "sending" ? "Placing order…" : "Place order"}
            </button>
            {error && <p className="text-sm font-medium text-red-700">{error}</p>}
            <p className="text-center text-[11px] text-elfia-muted">
              Your details are used to deliver this order — see our{" "}
              <Link href="/policies" className="underline hover:text-elfia-deep">privacy notice</Link>.
            </p>
          </form>

          {/* order summary */}
          <aside className="rounded-2xl border border-elfia-line bg-white p-5 sm:sticky sm:top-24">
            <p className="text-sm font-semibold text-elfia-ink">Order summary</p>
            <div className="mt-3 space-y-2.5">
              {rows.map(({ line, product }) => (
                <div key={line.id} className="flex items-center gap-2.5">
                  <span className="h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-elfia-veil">
                    {product.image_key && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(product.image_key)} alt="" className="h-full w-full object-cover object-top" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-medium text-elfia-ink">{splitName(product.name).shade}</span>
                    <span className="block text-[11px] text-elfia-muted">Qty {line.qty}</span>
                  </span>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{fmtRM(product.price_cents * line.qty)}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-elfia-line pt-3 text-sm">
              <div className="flex justify-between"><span className="text-elfia-body">Subtotal</span><span className="font-semibold tabular-nums">{fmtRM(subtotal)}</span></div>
              <div className="mt-1.5 flex justify-between">
                <span className="text-elfia-body">Delivery</span>
                <span className="font-semibold tabular-nums">{shipping === null ? "…" : shipping === 0 ? <span className="text-emerald-700">FREE</span> : fmtRM(shipping)}</span>
              </div>
              <div className="mt-3 flex justify-between border-t border-elfia-line pt-3 text-base font-bold">
                <span>Total</span><span className="tabular-nums text-elfia-deep">{fmtRM(subtotal + (shipping ?? 0))}</span>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-elfia-muted">
              <Icon name="shield" size={14} className="mt-px shrink-0 text-elfia-rose" />
              Every price is confirmed by our server when the order is placed — this panel can never charge you something different.
            </p>
          </aside>
        </div>
      </div>
    </main>
  );
}
