"use client";

/**
 * Track my order — /track (v0.9.0).
 *
 * The order page is reached by a private token link shown once at checkout,
 * which customers lose. This finds it again from the two things they always
 * remember: the order number on their receipt and the phone number they gave.
 *
 * The Worker does the matching and the rate limiting; this page deliberately
 * shows the SAME message whether the order number was wrong or the phone was,
 * so it can never be used to learn which order numbers exist.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { btnClass, inputClass, labelClass, waLink, type StoreConfig } from "@/lib/config";

export default function Track() {
  const router = useRouter();
  const [form, setForm] = useState({ order_number: "", phone: "" });
  const [state, setState] = useState<"idle" | "searching">("idle");
  const [error, setError] = useState("");
  const [config, setConfig] = useState<StoreConfig | null>(null);

  useEffect(() => {
    void fetch("/api/v1/store-config").then((r) => (r.ok ? r.json() : null))
      .then((j: StoreConfig | null) => setConfig(j)).catch(() => null);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.order_number.trim() || !form.phone.trim()) return;
    setState("searching"); setError("");
    try {
      const r = await fetch("/api/v1/orders/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = (await r.json()) as { token?: string; error?: { message?: string } };
      if (r.ok && j.token) { router.push(`/order?t=${j.token}`); return; }
      setError(j.error?.message ?? "We could not find that order.");
    } catch {
      setError("Network problem — please try again.");
    }
    setState("idle");
  };

  const digits = config?.whatsapp_digits ?? "";
  const showWa = digits && digits !== "60000000000" && digits.replace(/\D/g, "").length >= 9;

  return (
    <main className="px-4 py-10 sm:px-6 sm:py-14">
      <div className="mx-auto w-full max-w-md">
        <p className="text-center text-[11px] font-semibold tracking-[0.28em] text-[#7a2648]/70 uppercase">Your order</p>
        <h1 className="mt-2 text-center text-3xl font-bold text-stone-900">Track my order</h1>
        <p className="mx-auto mt-2 text-center text-sm text-stone-500">
          Enter the order number from your receipt and the phone number you used at checkout.
        </p>

        <form onSubmit={submit} className="mt-7 rounded-2xl border border-stone-200 bg-white p-5">
          <label className="block">
            <span className={labelClass}>Order number</span>
            <input className={`${inputClass} font-mono tracking-wide uppercase`} value={form.order_number}
              placeholder="ELF-200826-6" maxLength={40} required autoFocus
              onChange={(e) => setForm((f) => ({ ...f, order_number: e.target.value }))} />
          </label>
          <label className="mt-4 block">
            <span className={labelClass}>Phone / WhatsApp number</span>
            <input className={inputClass} value={form.phone} placeholder="012 345 6789"
              maxLength={40} required inputMode="tel"
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </label>
          <button type="submit" className={`${btnClass} mt-5 w-full`} disabled={state === "searching"}>
            {state === "searching" ? "Looking…" : "Find my order"}
          </button>
          {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
        </form>

        <p className="mt-5 text-center text-xs text-stone-500">
          Still stuck?{" "}
          {showWa ? (
            <a className="font-semibold text-[#7a2648] underline" rel="noopener noreferrer" target="_blank"
              href={waLink(digits, "Hi ELFIA! I cannot find my order — ")}>
              WhatsApp us
            </a>
          ) : (
            <>Message us and we will find it for you.</>
          )}{" "}
          or <Link href="/" className="underline hover:text-[#7a2648]">keep shopping</Link>.
        </p>
      </div>
    </main>
  );
}
