"use client";

/**
 * Account — /account (v1.0.0).
 *
 * Signed out: sign in, or create an account. Signed in: saved details (which
 * prefill checkout) and every order the account owns, on any device.
 *
 * An account is never required to buy. The CEO's problem was a customer
 * losing a half-finished order on refresh; this fixes it across devices,
 * while lib/config.ts fixes it on this one for people who never sign up.
 *
 * The session lives in an HttpOnly cookie the Worker sets, so no token is
 * readable by scripts on this page — there is nothing here for an XSS to
 * steal.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  btnClass, btnGhost, fmtRM, fmtWhen, inputClass, labelClass,
  type Account, type AccountOrder,
} from "@/lib/config";

const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  payment_review: "Checking receipt",
  paid: "Paid — packing",
  shipped: "Shipped",
  completed: "Delivered",
  cancelled: "Cancelled",
};
const STATUS_STYLE: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900",
  payment_review: "bg-orange-100 text-orange-900",
  paid: "bg-green-100 text-green-900",
  shipped: "bg-blue-100 text-blue-900",
  completed: "bg-stone-200 text-stone-600",
  cancelled: "bg-red-100 text-red-800",
};

export default function AccountPage() {
  const [me, setMe] = useState<Account | null | "loading">("loading");
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [form, setForm] = useState({ name: "", email: "", password: "", phone: "", address: "", website: "" });
  /* v1.3.0 — PDPA marketing consent at sign-up. Default OFF, never pre-ticked. */
  const [marketing, setMarketing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [claim, setClaim] = useState({ order_number: "", phone: "" });
  const [claimMsg, setClaimMsg] = useState("");

  const loadOrders = useCallback(async () => {
    const r = await fetch("/api/v1/auth/orders");
    if (r.ok) setOrders(((await r.json()) as { orders: AccountOrder[] }).orders);
  }, []);

  useEffect(() => {
    void fetch("/api/v1/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { customer: Account } | null) => {
        setMe(j?.customer ?? null);
        if (j?.customer) void loadOrders();
      })
      .catch(() => setMe(null));
  }, [loadOrders]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/v1/auth/${mode === "signup" ? "signup" : "login"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mode === "signup" ? { ...form, marketing } : { email: form.email, password: form.password }),
      });
      const j = (await r.json()) as { customer?: Account; error?: { message?: string } };
      if (!r.ok || !j.customer) { setError(j.error?.message ?? "Something went wrong."); setBusy(false); return; }
      setMe(j.customer);
      setForm({ name: "", email: "", password: "", phone: "", address: "", website: "" });
      void loadOrders();
    } catch { setError("Network problem — please try again."); }
    setBusy(false);
  };

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (me === null || me === "loading") return;
    setBusy(true); setSaved("");
    const r = await fetch("/api/v1/auth/me", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: me.name, phone: me.phone, address: me.address }),
    });
    if (r.ok) { setMe(((await r.json()) as { customer: Account }).customer); setSaved("Saved."); }
    setBusy(false);
  };

  /* v1.3.0 — PDPA: consent is given and withdrawn in the same place, one
     tap, effective immediately. */
  const toggleMarketing = async (next: boolean) => {
    if (me === null || me === "loading") return;
    setMe({ ...me, marketing: next }); // optimistic — the toggle must feel instant
    const r = await fetch("/api/v1/auth/me", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ marketing: next }),
    }).catch(() => null);
    if (!r?.ok) setMe((cur) => (cur && cur !== "loading" ? { ...cur, marketing: !next } : cur));
  };

  const claimOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setClaimMsg("");
    const r = await fetch("/api/v1/auth/claim", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(claim),
    });
    const j = (await r.json()) as { ok?: boolean; order_number?: string; error?: { message?: string } };
    if (r.ok && j.ok) { setClaimMsg(`${j.order_number} added to your account.`); setClaim({ order_number: "", phone: "" }); void loadOrders(); }
    else setClaimMsg(j.error?.message ?? "Could not add that order.");
  };

  const signOut = async () => {
    await fetch("/api/v1/auth/logout", { method: "POST" });
    setMe(null); setOrders([]);
  };

  if (me === "loading") {
    return <main className="px-6 py-20 text-center text-sm text-stone-400">Loading…</main>;
  }

  /* ---------------------------------------------------------- signed out */
  if (me === null) {
    return (
      <main className="px-4 py-10 sm:px-6 sm:py-14">
        <div className="mx-auto w-full max-w-md">
          <p className="text-center text-[11px] font-semibold tracking-[0.28em] text-[#7a2648]/70 uppercase">ELFIA</p>
          <h1 className="mt-2 text-center text-3xl font-bold text-stone-900">
            {mode === "signin" ? "Sign in" : "Create an account"}
          </h1>
          <p className="mx-auto mt-2 text-center text-sm text-stone-500">
            Keeps your address and every order in one place. You can always{" "}
            <Link href="/" className="underline hover:text-[#7a2648]">shop without one</Link>.
          </p>

          <div className="mt-6 flex justify-center gap-2">
            {(["signin", "signup"] as const).map((m) => (
              <button key={m} type="button"
                className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                  mode === m ? "bg-[#7a2648] text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"}`}
                onClick={() => { setMode(m); setError(""); }}>
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
            <input type="text" value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
              className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" />
            {mode === "signup" && (
              <label className="mb-4 block">
                <span className={labelClass}>Your name</span>
                <input className={inputClass} value={form.name} required maxLength={120} autoComplete="name"
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
              </label>
            )}
            <label className="block">
              <span className={labelClass}>Email</span>
              <input type="email" className={inputClass} value={form.email} required maxLength={200} autoComplete="email"
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </label>
            <label className="mt-4 block">
              <span className={labelClass}>Password{mode === "signup" ? " (at least 8 characters)" : ""}</span>
              <input type="password" className={inputClass} value={form.password} required minLength={mode === "signup" ? 8 : 1}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
            </label>
            {mode === "signup" && (
              <>
                <label className="mt-4 block">
                  <span className={labelClass}>Phone / WhatsApp (optional)</span>
                  <input className={inputClass} value={form.phone} maxLength={40} inputMode="tel" autoComplete="tel"
                    onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
                </label>
                <label className="mt-4 block">
                  <span className={labelClass}>Delivery address (optional)</span>
                  <textarea className={`${inputClass} h-20 py-2`} value={form.address} maxLength={500}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
                </label>
                <label className="mt-4 flex items-start gap-2.5 rounded-xl bg-stone-50 px-3 py-2.5">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[#7a2648]" />
                  <span className="text-xs leading-relaxed text-stone-600">
                    I agree to receive news and promotions from ELFIA by WhatsApp or email.
                    Optional — withdraw anytime in your account. <span className="text-stone-400">/ Saya bersetuju menerima berita dan promosi daripada ELFIA. Pilihan — boleh ditarik balik bila-bila masa.</span>
                  </span>
                </label>
              </>
            )}
            <button type="submit" className={`${btnClass} mt-5 w-full`} disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
            {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
          </form>

          <p className="mt-5 text-center text-xs text-stone-500">
            Lost an order and no account?{" "}
            <Link href="/track" className="font-semibold text-[#7a2648] underline">Track it with your phone number</Link>.
          </p>
        </div>
      </main>
    );
  }

  /* ----------------------------------------------------------- signed in */
  return (
    <main className="px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.28em] text-[#7a2648]/70 uppercase">Your account</p>
            <h1 className="mt-1.5 text-2xl font-bold text-stone-900">Hi {me.name.split(" ")[0]}</h1>
            <p className="text-sm text-stone-500">{me.email}</p>
          </div>
          <button type="button" className="text-sm text-stone-500 underline hover:text-[#7a2648]" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>

        <h2 className="mt-9 text-sm font-semibold text-stone-800">Your orders</h2>
        {orders.length === 0 ? (
          <div className="mt-3 rounded-2xl border border-stone-200 bg-white px-5 py-8 text-center">
            <p className="text-sm text-stone-500">No orders on this account yet.</p>
            <Link href="/" className={`${btnClass} mt-4`}>Browse the shop</Link>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            {orders.map((o) => (
              <Link key={o.token} href={`/order?t=${o.token}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-stone-200 bg-white p-4 hover:border-stone-300">
                <span className="font-semibold text-[#7a2648]">{o.order_number}</span>
                <span className="text-sm font-bold tabular-nums">{fmtRM(o.total_cents)}</span>
                <span className={`ml-auto rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status] ?? "bg-stone-100"}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
                <span className="w-full text-xs text-stone-500">{fmtWhen(o.created_at)}</span>
              </Link>
            ))}
          </div>
        )}

        {/* An order placed as a guest is added here the same way /track proves
            it: order number plus the phone that placed it. Never claimed
            automatically — that would hand one customer another's history. */}
        <form onSubmit={claimOrder} className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
          <p className="text-sm font-semibold text-stone-800">Add an earlier order</p>
          <p className="mt-0.5 text-xs text-stone-500">Ordered before you signed up? Add it with its order number and the phone you used.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className={`${inputClass} font-mono uppercase`} placeholder="ELF-200826-6" maxLength={40} required
              value={claim.order_number} onChange={(e) => setClaim((c) => ({ ...c, order_number: e.target.value }))} />
            <input className={inputClass} placeholder="012 345 6789" maxLength={40} inputMode="tel" required
              value={claim.phone} onChange={(e) => setClaim((c) => ({ ...c, phone: e.target.value }))} />
          </div>
          <button type="submit" className={`${btnGhost} mt-3`}>Add order</button>
          {claimMsg && <p className="mt-2 text-xs font-medium text-stone-700">{claimMsg}</p>}
        </form>

        <h2 className="mt-10 text-sm font-semibold text-stone-800">Your details</h2>
        <p className="mt-0.5 text-xs text-stone-500">These fill in your next checkout automatically.</p>
        <form onSubmit={saveProfile} className="mt-3 rounded-2xl border border-stone-200 bg-white p-5">
          <label className="block">
            <span className={labelClass}>Name</span>
            <input className={inputClass} value={me.name} maxLength={120}
              onChange={(e) => setMe({ ...me, name: e.target.value })} />
          </label>
          <label className="mt-4 block">
            <span className={labelClass}>Phone / WhatsApp</span>
            <input className={inputClass} value={me.phone ?? ""} maxLength={40} inputMode="tel"
              onChange={(e) => setMe({ ...me, phone: e.target.value })} />
          </label>
          <label className="mt-4 block">
            <span className={labelClass}>Delivery address</span>
            <textarea className={`${inputClass} h-24 py-2.5`} value={me.address ?? ""} maxLength={500}
              onChange={(e) => setMe({ ...me, address: e.target.value })} />
          </label>
          <div className="mt-4 flex items-center gap-3">
            <button type="submit" className={btnClass} disabled={busy}>{busy ? "Saving…" : "Save details"}</button>
            {saved && <span className="text-xs font-medium text-green-700">{saved}</span>}
          </div>
        </form>

        {/* v1.3.0 — PDPA marketing consent, owned by the customer. */}
        <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={Boolean(me.marketing)} onChange={(e) => void toggleMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-stone-300 accent-[#7a2648]" />
            <span className="text-xs leading-relaxed text-stone-600">
              <span className="block text-sm font-semibold text-stone-800">News &amp; promotions</span>
              Receive ELFIA news and offers by WhatsApp or email. Untick to stop —
              it takes effect immediately. <span className="text-stone-400">/ Terima berita dan tawaran ELFIA. Nyahtanda untuk berhenti — berkuat kuasa serta-merta.</span>
            </span>
          </label>
        </div>
      </div>
    </main>
  );
}
