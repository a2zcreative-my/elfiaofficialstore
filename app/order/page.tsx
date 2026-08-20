"use client";

/** Order page — /order?t=<token>. The token is the customer's key: shown
    once after checkout, safe to bookmark, and findable again at /track.
    Bank details + WhatsApp + receipt upload while unpaid; a progress
    timeline all the way.

    v0.9.0 — the timeline used to show WHICH step the order was on. It now
    shows WHEN each step happened, from the order's own history
    (`order_events`), plus a courier tracking link once it ships. A step with
    no recorded time is drawn as still to come, never given a made-up one. */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import Link from "next/link";

import { btnClass, fmtRM, fmtWhen, type OrderEvent, type OrderView } from "@/lib/config";

const STEPS = ["pending_payment", "payment_review", "paid", "shipped", "completed"] as const;
const STEP_LABEL: Record<string, string> = {
  pending_payment: "Order placed",
  payment_review: "Receipt received — checking",
  paid: "Payment confirmed",
  shipped: "Shipped",
  completed: "Delivered",
  cancelled: "Cancelled",
};
/** What the customer should expect next, per step. */
const STEP_HINT: Record<string, string> = {
  pending_payment: "Pay and upload your receipt below.",
  payment_review: "We check receipts by hand, usually within a few hours.",
  paid: "We are packing your order.",
  shipped: "On its way to you.",
  completed: "We hope you love it.",
};

/** The progress display. Steps the order has actually reached carry the time
    they happened; the rest are drawn grey and empty. */
function Progress({ order }: { order: OrderView }) {
  const events: OrderEvent[] = order.events ?? [];
  const firstAt = (status: string): OrderEvent | undefined => events.find((e) => e.status === status);
  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  /* payment_review is skipped entirely when someone pays online, so a paid
     order should not show it half-lit as though something is outstanding. */
  const shown = STEPS.filter((s) => s !== "payment_review" || firstAt(s) || order.status === "payment_review");
  const doneCount = shown.filter((s) => STEPS.indexOf(s) <= stepIndex).length;
  const pct = shown.length > 1 ? ((doneCount - 1) / (shown.length - 1)) * 100 : 0;

  return (
    <div className="rounded-2xl border border-stone-200 bg-white p-5">
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
        <div className="h-full rounded-full bg-[#7a2648] transition-all duration-700"
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <ol className="space-y-4">
        {shown.map((s, n) => {
          const idx = STEPS.indexOf(s);
          const reached = idx <= stepIndex;
          const current = idx === stepIndex;
          const ev = firstAt(s);
          return (
            <li key={s} className="flex gap-3">
              {/* Numbered by position in what is SHOWN, not by index in the
                  full list — a paid order that skipped "receipt received"
                  must not count 1, 2, 4. */}
              <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                reached ? "bg-[#7a2648] text-white" : "bg-stone-100 text-stone-400"}`}>
                {idx < stepIndex ? "✓" : n + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm ${current ? "font-bold text-[#7a2648]" : reached ? "font-semibold text-stone-800" : "text-stone-400"}`}>
                  {STEP_LABEL[s]}
                </p>
                {ev && (
                  <p className="text-xs text-stone-500">
                    {fmtWhen(ev.created_at)}
                    {/* the note only earns its place when it says something the
                        label does not */}
                    {ev.note && ev.note !== STEP_LABEL[s] ? ` · ${ev.note}` : ""}
                  </p>
                )}
                {current && <p className="mt-0.5 text-xs text-stone-500">{STEP_HINT[s]}</p>}
                {s === "shipped" && reached && order.tracking_no && (
                  <p className="mt-1 text-xs">
                    <span className="font-mono font-semibold text-stone-700">{order.tracking_no}</span>
                    {order.tracking_courier && <span className="text-stone-500"> · {order.tracking_courier}</span>}
                    {order.tracking_url && (
                      <>
                        {" "}
                        <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                          className="font-semibold text-[#7a2648] underline">track parcel</a>
                      </>
                    )}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function OrderInner() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const [order, setOrder] = useState<OrderView | null | "missing">(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");

  const load = useCallback(async () => {
    if (!token) { setOrder("missing"); return; }
    const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}`);
    if (!r.ok) { setOrder("missing"); return; }
    setOrder((await r.json()) as OrderView);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  /* v0.7.0 — close the gap after an FPX payment. Billplz sends the payer
     straight back here while its server-to-server callback is still in
     flight (and that callback can be lost entirely). So we ask OUR worker to
     re-check with Billplz: the answer comes from an authenticated read of the
     bill, never from these URL parameters, which anyone could forge.
     Returning from a payment (billplz[id] in the URL) polls for ~15s;
     otherwise a single check on load is enough. */
  const returnedFromGateway = params.has("billplz[id]") || params.has("billplz[paid]");
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (!token || order === null || order === "missing") return;
    if (order.status !== "pending_payment" && order.status !== "payment_review") return;
    if (!order.config.gateway) return;
    let cancelled = false;
    let attempts = 0;
    const max = returnedFromGateway ? 6 : 1;
    setChecking(returnedFromGateway);
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}/verify-payment`, { method: "POST" });
        const j = (await r.json()) as { paid?: boolean };
        if (j.paid) { setChecking(false); void load(); return; }
      } catch { /* offline — try again or give up quietly */ }
      if (attempts >= max) { setChecking(false); return; }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => { cancelled = true; };
    // Runs once per status change; `load` is stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, order === null || order === "missing" ? order : order.status]);

  /* Stage B (Billplz): visible only when the worker reports gateway:true.
     One tap -> the worker creates the bill -> the customer lands on
     Billplz's FPX page -> Billplz redirects back here and the verified
     callback flips the status to paid. */
  const [paying, setPaying] = useState(false);
  const payOnline = async () => {
    setPaying(true);
    try {
      const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}/pay`, { method: "POST" });
      const j = (await r.json()) as { url?: string; error?: { message?: string } };
      if (r.ok && j.url) { window.location.href = j.url; return; }
      setUploadMsg(j.error?.message ?? "Online payment unavailable — please use bank transfer.");
    } catch {
      setUploadMsg("Online payment unavailable — please use bank transfer.");
    }
    setPaying(false);
  };

  const upload = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) { setUploadMsg("File too large — maximum 5 MB."); return; }
    setUploading(true); setUploadMsg("");
    const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}/receipt`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    setUploading(false);
    if (r.ok) { setUploadMsg("Receipt received — we will confirm shortly."); void load(); }
    else setUploadMsg("Upload failed — please try again or WhatsApp us the receipt.");
  };

  if (order === null) return <main className="px-6 py-16 text-center text-sm text-stone-400">Loading…</main>;
  if (order === "missing") {
    return <main className="px-6 py-16 text-center text-sm text-stone-500">Order not found — check the link from your checkout or WhatsApp us.</main>;
  }

  const cancelled = order.status === "cancelled";
  const awaitingPayment = order.status === "pending_payment" || order.status === "payment_review";
  const waText = encodeURIComponent(`Hi ELFIA! My order ${order.order_number} — `);

  return (
    <main className="px-6 py-10">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">Order</p>
        <h1 className="text-2xl font-bold text-[#7a2648]">{order.order_number}</h1>

        {(order.status === "paid" || order.status === "shipped" || order.status === "completed") && (
          <div className="mt-4 rounded-xl border border-green-200 bg-green-50 p-4">
            <p className="text-sm font-semibold text-green-900">Payment confirmed — thank you!</p>
            <p className="mt-1 text-xs text-green-800">
              {order.status === "completed" ? "Delivered. We hope you love it."
                : order.status === "shipped" ? `On its way${order.tracking_no ? ` — tracking ${order.tracking_no}` : ""}.`
                : "We're packing your order now. You'll get a tracking number on WhatsApp."}
            </p>
          </div>
        )}

        {/* progress */}
        <div className="mt-5">
          {cancelled ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-5">
              <p className="text-sm font-semibold text-red-800">This order was cancelled.</p>
              <p className="mt-1 text-xs text-red-700">WhatsApp us if that is unexpected — we can place it again.</p>
            </div>
          ) : (
            <Progress order={order} />
          )}
        </div>

        {/* payment instructions */}
        {awaitingPayment && !cancelled && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
            {checking && (
              <p className="mb-3 rounded-lg bg-white px-3 py-2 text-xs font-medium text-stone-600">
                Checking your payment with the bank… this page updates by itself.
              </p>
            )}
            <p className="text-sm font-semibold text-amber-900">How to pay</p>
            {order.config.gateway && (
              <div className="mt-3">
                <button type="button" onClick={() => void payOnline()} disabled={paying}
                  className="inline-flex h-12 w-full items-center justify-center rounded-lg bg-[#7a2648] px-6 text-sm font-semibold text-white hover:bg-[#8f2e55] disabled:opacity-50">
                  {paying ? "Opening secure payment…" : `Pay online now — ${fmtRM(order.total_cents)} (FPX / online banking)`}
                </button>
                <p className="mt-2 text-center text-[11px] text-amber-800">Secure payment by Billplz · or transfer manually below</p>
              </div>
            )}
            <p className="mt-2 text-sm text-amber-900">
              Transfer <span className="font-bold">{fmtRM(order.total_cents)}</span> to:
            </p>
            <p className="mt-1 rounded-lg bg-white px-3 py-2 font-mono text-sm font-semibold">{order.config.bank_line}</p>
            <p className="mt-2 text-xs text-amber-800">
              Use <span className="font-semibold">{order.order_number}</span> as the payment reference, then upload your receipt below — or send it on WhatsApp.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <label className={`${btnClass} cursor-pointer`}>
                {uploading ? "Uploading…" : order.receipt_uploaded ? "Replace receipt" : "Upload receipt"}
                <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
              </label>
              <a className="inline-flex h-11 items-center rounded-lg bg-green-600 px-5 text-sm font-semibold text-white hover:bg-green-700" rel="noopener"
                href={`https://wa.me/${order.config.whatsapp_digits}?text=${waText}`}>
                WhatsApp us
              </a>
            </div>
            {uploadMsg && <p className="mt-2 text-xs font-medium text-amber-900">{uploadMsg}</p>}
          </div>
        )}

        {/* items */}
        <div className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
          {order.items.map((it, i) => (
            <div key={i} className="flex justify-between py-1 text-sm">
              <span>{it.name} × {it.qty}</span>
              <span className="tabular-nums">{fmtRM(it.price_cents * it.qty)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-stone-100 pt-2 text-sm">
            <span>Delivery</span><span className="tabular-nums">{order.shipping_cents === 0 ? "FREE" : fmtRM(order.shipping_cents)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-bold">
            <span>Total</span><span className="text-[#7a2648] tabular-nums">{fmtRM(order.total_cents)}</span>
          </div>
        </div>

        <p className="mt-4 text-xs text-stone-400">
          Deliver to: {order.customer_name} · {order.phone} · {order.address}
        </p>
        <p className="mt-2 text-xs text-stone-400">
          Bookmark this page — it always shows your latest order status.
        </p>
      </div>
    </main>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-stone-400">Loading…</main>}>
      <OrderInner />
    </Suspense>
  );
}
