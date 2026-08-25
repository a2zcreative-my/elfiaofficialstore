"use client";

/** Checkout — collects delivery details, sends product IDs + quantities
    ONLY. The Worker prices everything, reserves stock and mints the order;
    on success the cart clears and the customer lands on their order page.

    v1.0.0 — the CEO watched someone refresh mid-checkout and lose the lot.
    Now every keystroke is kept on the device (never sent anywhere until they
    press the button), a signed-in customer's saved details fill it in, and
    the finished order is remembered locally so it can be reopened from
    /track without hunting for the link. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import Link from "next/link";

import {
  btnClass, clearDraft, inputClass, labelClass, readCart, readDraft, rememberOrder,
  writeCart, writeDraft, type Account,
} from "@/lib/config";

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

  useEffect(() => {
    if (readCart().length === 0) { setEmpty(true); return; }
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
        <p className="text-sm text-stone-500">Your cart is empty.</p>
      </main>
    );
  }

  return (
    <main className="px-4 py-8 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-[11px] font-semibold tracking-[0.2em] text-stone-400 uppercase">Step 1 of 2</p>
        <h1 className="mt-1.5 text-2xl font-bold text-stone-900">Delivery details</h1>
        <p className="mt-1 text-sm text-stone-500">
          Place the order first — payment instructions come on the next page.
        </p>
        {me ? (
          <p className="mt-2 text-xs text-stone-500">
            Ordering as <span className="font-semibold text-stone-700">{me.email}</span> — it will appear in your account.
          </p>
        ) : (
          <p className="mt-2 text-xs text-stone-500">
            Ordering as a guest, which is fine.{" "}
            <Link href="/account" className="underline hover:text-[#7a2648]">Sign in</Link> if you would rather keep it in an account.
          </p>
        )}
        <form onSubmit={submit} className="mt-6 space-y-4 rounded-2xl border border-stone-200 bg-white p-5">
          <input type="text" value={form.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <label className="block">
            <span className={labelClass}>Full name *</span>
            <input className={inputClass} value={form.name} onChange={set("name")} required maxLength={120} />
          </label>
          <label className="block">
            <span className={labelClass}>Phone / WhatsApp * (we confirm your order here)</span>
            <input className={inputClass} value={form.phone} onChange={set("phone")} required maxLength={40} inputMode="tel" />
          </label>
          <label className="block">
            <span className={labelClass}>Delivery address *</span>
            <textarea className={`${inputClass} h-24 py-2.5`} value={form.address} onChange={set("address")} required maxLength={500} />
          </label>
          <label className="block">
            <span className={labelClass}>Email (optional)</span>
            <input className={inputClass} value={form.email} onChange={set("email")} type="email" maxLength={200} />
          </label>
          <label className="block">
            <span className={labelClass}>Order notes (optional)</span>
            <input className={inputClass} value={form.notes} onChange={set("notes")} maxLength={300} />
          </label>
          <label className="flex items-start gap-2.5 rounded-xl bg-stone-50 px-3 py-2.5">
            <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[#7a2648]" />
            <span className="text-xs leading-relaxed text-stone-600">
              I agree to receive news and promotions from ELFIA by WhatsApp or email.
              Optional — you can withdraw anytime. <span className="text-stone-400">/ Saya bersetuju menerima berita dan promosi daripada ELFIA. Pilihan — boleh ditarik balik bila-bila masa.</span>
            </span>
          </label>
          <button type="submit" className={`${btnClass} w-full`} disabled={state === "sending"}>
            {state === "sending" ? "Placing order…" : "Place order"}
          </button>
          {error && <p className="text-sm font-medium text-red-700">{error}</p>}
          <p className="text-center text-[11px] text-stone-400">
            Your details are used to deliver this order — see our{" "}
            <Link href="/policies" className="underline hover:text-[#7a2648]">privacy notice</Link>.
          </p>
        </form>
      </div>
    </main>
  );
}
