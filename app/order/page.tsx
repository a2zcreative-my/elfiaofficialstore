"use client";

/** Order page — /order?t=<token>. The token is the customer's key: shown
    once after checkout and safe to bookmark. Bank details + WhatsApp +
    receipt upload while unpaid; a live status timeline all the way. */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import { btnClass, fmtRM, type OrderView } from "@/lib/config";

const STEPS = ["pending_payment", "payment_review", "paid", "shipped", "completed"] as const;
const STEP_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  payment_review: "Receipt received — checking",
  paid: "Payment confirmed",
  shipped: "Shipped",
  completed: "Delivered",
  cancelled: "Cancelled",
};

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

  const stepIndex = STEPS.indexOf(order.status as (typeof STEPS)[number]);
  const cancelled = order.status === "cancelled";
  const awaitingPayment = order.status === "pending_payment" || order.status === "payment_review";
  const waText = encodeURIComponent(`Hi ELFIA! My order ${order.order_number} — `);

  return (
    <main className="px-6 py-10">
      <div className="mx-auto w-full max-w-xl">
        <p className="text-xs font-semibold tracking-widest text-stone-400 uppercase">Order</p>
        <h1 className="text-2xl font-bold text-[#7a2648]">{order.order_number}</h1>

        {/* status timeline */}
        <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
          {cancelled ? (
            <p className="text-sm font-semibold text-red-700">This order was cancelled. WhatsApp us if that is unexpected.</p>
          ) : (
            <ol className="space-y-2">
              {STEPS.map((s, i) => (
                <li key={s} className="flex items-center gap-2.5 text-sm">
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i <= stepIndex ? "bg-[#7a2648] text-white" : "bg-stone-200 text-stone-400"}`}>
                    {i < stepIndex ? "✓" : i + 1}
                  </span>
                  <span className={i <= stepIndex ? "font-semibold" : "text-stone-400"}>{STEP_LABEL[s]}</span>
                  {s === "shipped" && order.tracking_no && i <= stepIndex && (
                    <span className="text-xs text-stone-500">· tracking {order.tracking_no}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* payment instructions */}
        {awaitingPayment && !cancelled && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
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
