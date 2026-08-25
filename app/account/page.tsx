"use client";

/**
 * Account / Dashboard — /account.
 *
 * v1.0.0 — signed out: sign in or create an account. Signed in: saved details
 * (which prefill checkout) and every order the account owns, on any device.
 * An account is never required to buy.
 *
 * v1.4.0 — this is now the app's Profile tab, in the shape the CEO showed:
 * a greeting card, the four order states as tappable tiles with live counts,
 * quick access, and the member benefits. The benefits listed are the ones the
 * shop ACTUALLY gives (the Worker's free-delivery threshold, the restock
 * waitlist, order history) — there is no points balance or wallet here,
 * because ELFIA does not keep either and a number that means nothing is worse
 * than no number.
 *
 * The session lives in an HttpOnly cookie the Worker sets, so no token is
 * readable by scripts on this page — there is nothing here for an XSS to
 * steal.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import {
  btnClass, btnGhost, fmtRM, fmtWhen, inputClass, labelClass, waLink,
  type Account, type AccountOrder, type StoreConfig,
} from "@/lib/config";

import { Icon, IconTile, StatusPill, useWishlist, type IconName } from "./../ui";

/** The four states the CEO's layout puts on the dashboard, mapped onto the
    order statuses this shop really has. Everything else (cancelled) lives
    under All, never hidden. */
const BUCKETS: { key: string; label: string; icon: IconName; match: (s: string) => boolean }[] = [
  { key: "to_pay", label: "To Pay", icon: "receipt", match: (s) => s === "pending_payment" || s === "payment_review" },
  { key: "to_ship", label: "To Ship", icon: "box", match: (s) => s === "paid" },
  { key: "to_receive", label: "To Receive", icon: "truck", match: (s) => s === "shipped" },
  { key: "completed", label: "Completed", icon: "check", match: (s) => s === "completed" },
];

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
  const [bucket, setBucket] = useState<string | null>(null);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const wishes = useWishlist();

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
    void fetch("/api/v1/store-config").then((r) => (r.ok ? r.json() : null))
      .then((j: StoreConfig | null) => setConfig(j)).catch(() => null);
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
    return <main className="px-6 py-20 text-center text-sm text-elfia-muted">Loading…</main>;
  }

  const freeAbove = config && config.free_above_cents > 0 ? fmtRM(config.free_above_cents) : null;

  /* ---------------------------------------------------------- signed out */
  if (me === null) {
    return (
      <main className="px-4 py-6 sm:px-6 sm:py-12">
        <div className="mx-auto w-full max-w-md">
          {/* Even signed out, the Profile tab is a place — not a wall. */}
          <div className="rounded-3xl bg-elfia-blush p-5 ring-1 ring-elfia-line">
            <p className="text-[11px] font-semibold tracking-[0.28em] text-elfia-deep/70 uppercase">ELFIA</p>
            <h1 className="mt-1.5 text-2xl font-bold text-elfia-ink">
              {mode === "signin" ? "Welcome back" : "Create an account"}
            </h1>
            <p className="mt-1.5 text-sm text-elfia-body">
              Keeps your address and every order in one place. You can always{" "}
              <Link href="/shop" className="underline hover:text-elfia-deep">shop without one</Link>.
            </p>
          </div>

          <div className="mt-4 grid grid-cols-3 gap-2.5">
            <IconTile icon="heart" label="Wishlist" href="/wishlist" badge={wishes.length} />
            <IconTile icon="clock-history" label="Track order" href="/track" />
            <IconTile icon="bag" label="Shop" href="/shop" />
          </div>

          <div className="mt-5 flex justify-center gap-2">
            {(["signin", "signup"] as const).map((m) => (
              <button key={m} type="button"
                className={`rounded-full px-5 py-2 text-sm font-medium transition-colors ${
                  mode === m ? "bg-elfia-deep text-white" : "bg-white text-elfia-body ring-1 ring-elfia-line hover:ring-elfia-rose"}`}
                onClick={() => { setMode(m); setError(""); }}>
                {m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-4 rounded-2xl border border-elfia-line bg-white p-5">
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
                <label className="mt-4 flex items-start gap-2.5 rounded-xl bg-elfia-cream px-3 py-2.5">
                  <input type="checkbox" checked={marketing} onChange={(e) => setMarketing(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-elfia-line accent-[#7a2648]" />
                  <span className="text-xs leading-relaxed text-elfia-body">
                    I agree to receive news and promotions from ELFIA by WhatsApp or email.
                    Optional — withdraw anytime in your account. <span className="text-elfia-muted">/ Saya bersetuju menerima berita dan promosi daripada ELFIA. Pilihan — boleh ditarik balik bila-bila masa.</span>
                  </span>
                </label>
              </>
            )}
            <button type="submit" className={`${btnClass} mt-5 w-full`} disabled={busy}>
              {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
            </button>
            {error && <p className="mt-3 text-sm font-medium text-red-700">{error}</p>}
          </form>

          <p className="mt-5 text-center text-xs text-elfia-muted">
            Lost an order and no account?{" "}
            <Link href="/track" className="font-semibold text-elfia-deep underline">Track it with your phone number</Link>.
          </p>
        </div>
      </main>
    );
  }

  /* ----------------------------------------------------------- signed in */
  const countOf = (key: string) => orders.filter((o) => BUCKETS.find((b) => b.key === key)?.match(o.status)).length;
  const shownOrders = bucket ? orders.filter((o) => BUCKETS.find((b) => b.key === bucket)?.match(o.status)) : orders;
  const bucketLabel = BUCKETS.find((b) => b.key === bucket)?.label;
  const initial = (me.name.trim()[0] ?? "E").toUpperCase();
  const digits = config?.whatsapp_digits ?? "";
  const showWa = Boolean(digits) && digits !== "60000000000" && digits.replace(/\D/g, "").length >= 9;

  return (
    <main className="px-4 py-4 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-3xl">
        {/* greeting */}
        <div className="flex items-center gap-3.5 rounded-3xl bg-elfia-blush p-4 ring-1 ring-elfia-line sm:p-5">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white text-lg font-bold text-elfia-deep">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-base font-bold text-elfia-ink">Salam, {me.name.split(" ")[0]}</p>
            <p className="truncate text-xs text-elfia-body">{me.email}</p>
          </div>
          <button type="button" onClick={() => void signOut()}
            className="shrink-0 rounded-full bg-white px-3.5 py-2 text-xs font-semibold text-elfia-deep ring-1 ring-elfia-line">
            Sign out
          </button>
        </div>

        {/* my orders */}
        <section className="mt-5">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[15px] font-bold text-elfia-ink">My orders</h2>
            {bucket && (
              <button type="button" onClick={() => setBucket(null)} className="text-xs font-semibold text-elfia-deep">
                Show all ({orders.length})
              </button>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            {BUCKETS.map((b) => {
              const n = countOf(b.key);
              const on = bucket === b.key;
              return (
                <button key={b.key} type="button" onClick={() => setBucket(on ? null : b.key)}
                  className={`flex flex-col items-center gap-1.5 rounded-2xl px-1 py-3.5 ring-1 transition-colors ${
                    on ? "bg-elfia-veil ring-elfia-rose" : "bg-white ring-elfia-line hover:ring-elfia-rose"}`}>
                  <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                    <Icon name={b.icon} size={18} />
                    {n > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-elfia-deep px-1 text-[10px] font-bold text-white">
                        {n > 9 ? "9+" : n}
                      </span>
                    )}
                  </span>
                  <span className="text-[10.5px] leading-tight font-medium text-elfia-ink">{b.label}</span>
                </button>
              );
            })}
          </div>

          {orders.length === 0 ? (
            <div className="mt-3 rounded-2xl border border-elfia-line bg-white px-5 py-8 text-center">
              <p className="text-sm text-elfia-muted">No orders on this account yet.</p>
              <Link href="/shop" className={`${btnClass} mt-4`}>Browse the shop</Link>
            </div>
          ) : shownOrders.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-elfia-line bg-white px-5 py-6 text-center text-sm text-elfia-muted">
              Nothing in {bucketLabel}.
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {shownOrders.map((o) => (
                <Link key={o.token} href={`/order?t=${o.token}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-elfia-line bg-white p-4 transition-colors hover:border-elfia-rose">
                  <span className="font-semibold text-elfia-deep">{o.order_number}</span>
                  <span className="text-sm font-bold tabular-nums">{fmtRM(o.total_cents)}</span>
                  <span className="ml-auto"><StatusPill status={o.status} /></span>
                  <span className="w-full text-xs text-elfia-muted">
                    {fmtWhen(o.created_at)}
                    {o.tracking_no && <> · tracking <span className="font-mono">{o.tracking_no}</span></>}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* promo — links to what the studio actually featured */}
        <Link href="/shop?c=featured"
          className="mt-5 flex items-center gap-4 overflow-hidden rounded-3xl bg-elfia-veil ring-1 ring-elfia-line">
          <span className="min-w-0 flex-1 p-5">
            <span className="block text-[11px] font-semibold tracking-[0.2em] text-elfia-deep/70 uppercase">New collection</span>
            <span className="mt-1 block text-lg font-bold text-elfia-ink">ELFIA Exclusive</span>
            <span className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-elfia-deep">
              Shop now <Icon name="chevron" size={13} strokeWidth={2.2} />
            </span>
          </span>
          <span className="h-28 w-24 shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/collection/campaign-salon.jpg" alt="" className="h-full w-full object-cover" style={{ objectPosition: "50% 25%" }} />
          </span>
        </Link>

        {/* quick access */}
        <section className="mt-6">
          <h2 className="mb-3 text-[15px] font-bold text-elfia-ink">Quick access</h2>
          <div className="grid grid-cols-4 gap-2 sm:gap-3">
            <IconTile icon="heart" label="Wishlist" href="/wishlist" badge={wishes.length} />
            <IconTile icon="clock-history" label="Track order" href="/track" />
            <IconTile icon="pin" label="Address" href="#details" />
            <IconTile icon="receipt" label="Policies" href="/policies" />
          </div>
        </section>

        {/* member benefits — every line here is a thing the shop really does */}
        <section className="mt-6">
          <h2 className="mb-3 text-[15px] font-bold text-elfia-ink">Member benefits</h2>
          <div className="space-y-2.5">
            {freeAbove && (
              <div className="flex items-start gap-3 rounded-2xl border border-elfia-line bg-white p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                  <Icon name="ticket" size={18} />
                </span>
                <div>
                  <p className="text-sm font-semibold text-elfia-ink">Free delivery above {freeAbove}</p>
                  <p className="mt-0.5 text-xs text-elfia-muted">Applied automatically at checkout — no code to remember.</p>
                </div>
              </div>
            )}
            <div className="flex items-start gap-3 rounded-2xl border border-elfia-line bg-white p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                <Icon name="bell" size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-elfia-ink">Restock alerts</p>
                <p className="mt-0.5 text-xs text-elfia-muted">
                  Sold out shade? Join its list on the product page and we WhatsApp you first when it returns.
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-2xl border border-elfia-line bg-white p-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                <Icon name="gift" size={18} />
              </span>
              <div>
                <p className="text-sm font-semibold text-elfia-ink">Everything in one place</p>
                <p className="mt-0.5 text-xs text-elfia-muted">
                  Your address fills in your next checkout, and every order stays here on any device.
                </p>
              </div>
            </div>
            {showWa && (
              <a href={waLink(digits, "Hi ELFIA! I have a question — ")} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-between gap-3 rounded-2xl border border-elfia-line bg-white p-4">
                <span className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
                    <Icon name="spark" size={18} />
                  </span>
                  <span className="text-sm font-semibold text-elfia-ink">Talk to us on WhatsApp</span>
                </span>
                <Icon name="chevron" size={16} className="text-elfia-muted" />
              </a>
            )}
          </div>
        </section>

        {/* An order placed as a guest is added here the same way /track proves
            it: order number plus the phone that placed it. Never claimed
            automatically — that would hand one customer another's history. */}
        <form onSubmit={claimOrder} className="mt-6 rounded-2xl border border-elfia-line bg-white p-5">
          <p className="text-sm font-semibold text-elfia-ink">Add an earlier order</p>
          <p className="mt-0.5 text-xs text-elfia-muted">Ordered before you signed up? Add it with its order number and the phone you used.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <input className={`${inputClass} font-mono uppercase`} placeholder="ELF-200826-6" maxLength={40} required
              value={claim.order_number} onChange={(e) => setClaim((c) => ({ ...c, order_number: e.target.value }))} />
            <input className={inputClass} placeholder="012 345 6789" maxLength={40} inputMode="tel" required
              value={claim.phone} onChange={(e) => setClaim((c) => ({ ...c, phone: e.target.value }))} />
          </div>
          <button type="submit" className={`${btnGhost} mt-3`}>Add order</button>
          {claimMsg && <p className="mt-2 text-xs font-medium text-elfia-body">{claimMsg}</p>}
        </form>

        {/* details */}
        <section id="details" className="mt-8 scroll-mt-24">
          <h2 className="text-[15px] font-bold text-elfia-ink">Your details</h2>
          <p className="mt-0.5 text-xs text-elfia-muted">These fill in your next checkout automatically.</p>
          <form onSubmit={saveProfile} className="mt-3 rounded-2xl border border-elfia-line bg-white p-5">
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
              {saved && <span className="text-xs font-medium text-emerald-700">{saved}</span>}
            </div>
          </form>
        </section>

        {/* v1.3.0 — PDPA marketing consent, owned by the customer. */}
        <div className="mt-4 rounded-2xl border border-elfia-line bg-white p-5">
          <label className="flex items-start gap-2.5">
            <input type="checkbox" checked={Boolean(me.marketing)} onChange={(e) => void toggleMarketing(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-elfia-line accent-[#7a2648]" />
            <span className="text-xs leading-relaxed text-elfia-body">
              <span className="block text-sm font-semibold text-elfia-ink">News &amp; promotions</span>
              Receive ELFIA news and offers by WhatsApp or email. Untick to stop —
              it takes effect immediately. <span className="text-elfia-muted">/ Terima berita dan tawaran ELFIA. Nyahtanda untuk berhenti — berkuat kuasa serta-merta.</span>
            </span>
          </label>
        </div>
      </div>
    </main>
  );
}
