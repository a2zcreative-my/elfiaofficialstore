"use client";

/** Checkout — collects delivery details, sends product IDs + quantities
    ONLY. The Worker prices everything, reserves stock and mints the order;
    on success the cart clears and the customer lands on their order page. */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { btnClass, inputClass, labelClass, readCart, writeCart } from "@/lib/config";

export default function Checkout() {
  const router = useRouter();
  const [form, setForm] = useState({ name: "", phone: "", address: "", email: "", notes: "", website: "" });
  const [state, setState] = useState<"idle" | "sending">("idle");
  const [error, setError] = useState("");
  const [empty, setEmpty] = useState(false);

  useEffect(() => { if (readCart().length === 0) setEmpty(true); }, []);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.phone.trim() || !form.address.trim()) return;
    setState("sending"); setError("");
    try {
      const r = await fetch("/api/v1/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer: form, items: readCart() }),
      });
      const j = (await r.json()) as { token?: string; error?: { message?: string } };
      if (!r.ok || !j.token) {
        setError(j.error?.message ?? "Could not place the order — please try again.");
        setState("idle");
        return;
      }
      writeCart([]); // the order now owns these items
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
    <main className="px-6 py-10">
      <div className="mx-auto w-full max-w-xl">
        <h1 className="text-2xl font-bold text-[#7a2648]">Delivery details</h1>
        <p className="mt-1 text-sm text-stone-500">
          Place the order first — payment instructions come on the next page.
        </p>
        <form onSubmit={submit} className="mt-6 space-y-4">
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
          <button type="submit" className={`${btnClass} w-full`} disabled={state === "sending"}>
            {state === "sending" ? "Placing order…" : "Place order"}
          </button>
          {error && <p className="text-sm font-medium text-red-700">{error}</p>}
        </form>
      </div>
    </main>
  );
}
