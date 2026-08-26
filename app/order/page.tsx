"use client";

/** Order page — /order?t=<token>. The token is the customer's key: shown
    once after checkout, safe to bookmark, and findable again at /track.

    v0.9.0 — the timeline shows WHEN each step happened, from the order's own
    history (`order_events`), plus a courier tracking link once it ships. A
    step with no recorded time is drawn as still to come, never given a
    made-up one.

    v1.4.0 — the CEO's payment screen: an order summary, then the payment
    methods as a chosen list rather than a wall of instructions. The list only
    ever offers what the shop can actually take:
      · FPX online banking — appears when the Worker reports gateway:true,
        i.e. the Billplz secrets are set. One tap creates the bill.
      · Bank transfer + receipt — always.
    Nothing else is drawn. An e-wallet logo on a page that cannot take an
    e-wallet is a promise the shop would have to break. */
import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import Link from "next/link";

import { accountDigits, btnClass, fmtRM, fmtWhen, rememberOrder, type OrderEvent, type OrderView } from "@/lib/config";

import { Icon, StatusPill } from "./../ui";

/** "3 hours 12 minutes" / "18 minutes" / "" once it has passed. */
function timeLeft(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`) - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h === 0) return `${m} minute${m === 1 ? "" : "s"}`;
  return `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} minute${m === 1 ? "" : "s"}` : ""}`;
}

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
  pending_payment: "Pay below and we start packing.",
  payment_review: "We check receipts by hand, usually within a few hours.",
  paid: "We are packing your order.",
  shipped: "On its way to you.",
  completed: "We hope you love it.",
};

/** The progress display. Steps the order has actually reached carry the time
    they happened; the rest are drawn soft and empty. */
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
    <div className="rounded-2xl border border-elfia-line bg-white p-5">
      <div className="mb-5 h-1.5 w-full overflow-hidden rounded-full bg-elfia-blush">
        <div className="h-full rounded-full bg-elfia-deep transition-all duration-700"
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
                reached ? "bg-elfia-deep text-white" : "bg-elfia-blush text-elfia-muted"}`}>
                {idx < stepIndex ? <Icon name="check" size={12} strokeWidth={3} /> : n + 1}
              </span>
              <div className="min-w-0">
                <p className={`text-sm ${current ? "font-bold text-elfia-deep" : reached ? "font-semibold text-elfia-ink" : "text-elfia-muted"}`}>
                  {STEP_LABEL[s]}
                </p>
                {ev && (
                  <p className="text-xs text-elfia-muted">
                    {fmtWhen(ev.created_at)}
                    {/* the note only earns its place when it says something the
                        label does not */}
                    {ev.note && ev.note !== STEP_LABEL[s] ? ` · ${ev.note}` : ""}
                  </p>
                )}
                {current && <p className="mt-0.5 text-xs text-elfia-muted">{STEP_HINT[s]}</p>}
                {s === "shipped" && reached && order.tracking_no && (
                  <p className="mt-1 text-xs">
                    <span className="font-mono font-semibold text-elfia-body">{order.tracking_no}</span>
                    {order.tracking_courier && <span className="text-elfia-muted"> · {order.tracking_courier}</span>}
                    {order.tracking_url && (
                      <>
                        {" "}
                        <a href={order.tracking_url} target="_blank" rel="noopener noreferrer"
                          className="font-semibold text-elfia-deep underline">track parcel</a>
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

/** One row in the payment-method list. */
function MethodRow({ id, checked, onSelect, title, note, badge, children }: {
  id: string; checked: boolean; onSelect: () => void; title: string; note: string;
  badge?: string; children?: React.ReactNode;
}) {
  return (
    <div className={`rounded-2xl border transition-colors ${checked ? "border-elfia-rose bg-elfia-veil/50" : "border-elfia-line bg-white"}`}>
      <label className="flex cursor-pointer items-start gap-3 p-4">
        <input type="radio" name="pay-method" value={id} checked={checked} onChange={onSelect}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[#7a2648]" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-elfia-ink">{title}</span>
            {badge && (
              <span className="rounded-full bg-elfia-deep/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-elfia-deep uppercase">
                {badge}
              </span>
            )}
          </span>
          <span className="mt-0.5 block text-xs leading-relaxed text-elfia-muted">{note}</span>
        </span>
      </label>
      {checked && children && <div className="border-t border-elfia-line/70 p-4 pt-3.5">{children}</div>}
    </div>
  );
}

function OrderInner() {
  const params = useSearchParams();
  const token = params.get("t") ?? "";
  const [order, setOrder] = useState<OrderView | null | "missing">(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState("");
  /* Kept apart from uploadMsg on purpose — see payOnline below. */
  const [payMsg, setPayMsg] = useState("");
  const [method, setMethod] = useState<"fpx" | "transfer" | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!token) { setOrder("missing"); return; }
    const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}`);
    if (!r.ok) { setOrder("missing"); return; }
    setOrder((await r.json()) as OrderView);
  }, [token]);

  useEffect(() => { void load(); }, [load]);

  /* This device now knows about the order, so /track can offer it even if the
     link is lost. Only the token — no personal data leaves the page. */
  useEffect(() => {
    if (order && order !== "missing") rememberOrder(order.order_number, token);
  }, [order, token]);

  /* Pre-select the method the shop would rather have: FPX confirms itself in
     seconds, a transfer needs a human to read a receipt. */
  useEffect(() => {
    if (order && order !== "missing" && method === null) {
      setMethod(order.config.gateway ? "fpx" : "transfer");
    }
  }, [order, method]);

  /* Re-render once a minute so the payment countdown stays honest. */
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  /* v0.7.0 — close the gap after an FPX payment. Billplz sends the payer
     straight back here while its server-to-server callback is still in
     flight (and that callback can be lost entirely). So we ask OUR worker to
     re-check with Billplz: the answer comes from an authenticated read of the
     bill, never from these URL parameters, which anyone could forge.
     Returning from a payment (billplz[id] in the URL) polls for ~15s;
     otherwise a single check on load is enough. */
  /* v1.14.0 — the RETURN JOURNEY.
   *
   * Everything up to Billplz worked; coming back did not. A customer who
   * cancelled at their bank, or whose payment failed, landed on a page that
   * looked exactly as it had before they left: same Pay button, no
   * acknowledgement, no explanation. The old code polled for eighteen
   * seconds and then went quiet whatever the answer, so "it worked",
   * "it failed" and "the bank is slow" were all rendered as silence.
   *
   * These three are now separate outcomes with separate screens, because
   * they need different things from the customer:
   *   checking  — the poll is running.
   *   slow      — the bank said paid, our authenticated re-query has not
   *               confirmed it yet. Do NOT ask them to pay again.
   *   declined  — no payment. Say so, say they were not charged, offer
   *               both ways forward.
   * Captured ONCE on first render: the parameters are then stripped from
   * the URL, so a refresh an hour later does not replay a stale outcome. */
  const [gwReturn] = useState(() => ({
    returned: params.has("billplz[id]") || params.has("billplz[paid]"),
    /* Billplz's own claim. It is not proof — only the worker's authenticated
       re-query decides whether money moved — but it is the difference
       between "we are still confirming" and "that did not go through". */
    claimsPaid: params.get("billplz[paid]") === "true",
  }));
  const returnedFromGateway = gwReturn.returned;
  const [outcome, setOutcome] = useState<"none" | "checking" | "slow" | "declined">("none");
  const [recheck, setRecheck] = useState(0);
  const [checking, setChecking] = useState(false);

  /* Strip billplz[...] from the address bar once it has been read. The
     customer's order link stays shareable and a reload starts clean. */
  useEffect(() => {
    if (!gwReturn.returned || typeof window === "undefined") return;
    const u = new URL(window.location.href);
    let touched = false;
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("billplz[")) { u.searchParams.delete(k); touched = true; }
    }
    if (touched) window.history.replaceState(null, "", u.toString());
  }, [gwReturn.returned]);
  useEffect(() => {
    if (!token || order === null || order === "missing") return;
    if (order.status !== "pending_payment" && order.status !== "payment_review") return;
    if (!order.config.gateway) return;
    let cancelled = false;
    let attempts = 0;
    /* Ten tries at 3s is thirty seconds. FPX usually answers in a few, but a
       slow bank on a busy evening takes longer than the eighteen seconds
       this used to allow — and giving up early is what made a successful
       payment look like a failed one. */
    const polling = returnedFromGateway || recheck > 0;
    const max = polling ? 10 : 1;
    setChecking(polling);
    if (polling) setOutcome("checking");
    const tick = async () => {
      if (cancelled) return;
      attempts += 1;
      try {
        const r = await fetch(`/api/v1/orders/${encodeURIComponent(token)}/verify-payment`, { method: "POST" });
        const j = (await r.json()) as { paid?: boolean; bill?: boolean };
        if (j.paid) { setChecking(false); setOutcome("none"); void load(); return; }
        /* v1.14.0 — no bill was ever created, so nothing is in flight and
           there is nothing to wait for. Waiting half a minute to say so
           just delays the truth. (An older worker omits `bill` entirely,
           and then the full poll runs as before.) */
        if (j.bill === false && polling) {
          setChecking(false);
          setOutcome(gwReturn.claimsPaid ? "slow" : "declined");
          return;
        }
      } catch { /* offline — try again, or settle below */ }
      if (attempts >= max) {
        setChecking(false);
        /* The two silences, separated. Billplz saying paid while our own
           authenticated read does not yet agree is a SLOW confirmation, not
           a failure — telling that customer to pay again risks charging
           them twice. */
        if (polling) setOutcome(gwReturn.claimsPaid ? "slow" : "declined");
        return;
      }
      setTimeout(() => void tick(), 3000);
    };
    void tick();
    return () => { cancelled = true; };
    // Runs once per status change, and again when the customer asks.
    // `load` is stable via useCallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, recheck, order === null || order === "missing" ? order : order.status]);

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
      /* v1.14.0 — its own message, shown inside the FPX row. This used to
         write into setUploadMsg, which renders at the BOTTOM of the bank
         transfer section: a customer who tapped Pay and got a gateway error
         saw nothing where they were looking, and an unexplained line under
         a different payment method further down the page. */
      setPayMsg(j.error?.message ?? "Online payment isn't available right now — please use bank transfer below.");
    } catch {
      setPayMsg("We couldn't reach the payment page. Check your connection and try again, or use bank transfer below.");
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

  if (order === null) return <main className="px-6 py-16 text-center text-sm text-elfia-muted">Loading…</main>;
  if (order === "missing") {
    return (
      <main className="px-6 py-16 text-center">
        <p className="text-sm text-elfia-muted">Order not found — check the link from your checkout, or find it again on the track page.</p>
        <Link href="/track" className={`${btnClass} mt-4`}>Find my order</Link>
      </main>
    );
  }

  const cancelled = order.status === "cancelled";
  const awaitingPayment = order.status === "pending_payment" || order.status === "payment_review";
  const waText = encodeURIComponent(`Hi ELFIA! My order ${order.order_number} — `);
  const subtotal = order.subtotal_cents;

  return (
    <main className="px-4 py-5 sm:px-6 sm:py-10">
      <div className="mx-auto w-full max-w-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold tracking-widest text-elfia-muted uppercase">Order</p>
            <h1 className="text-2xl font-bold text-elfia-deep">{order.order_number}</h1>
            <p className="mt-0.5 text-xs text-elfia-muted">Placed {fmtWhen(order.created_at)}</p>
          </div>
          <div className="pt-6"><StatusPill status={order.status} /></div>
        </div>

        {(order.status === "paid" || order.status === "shipped" || order.status === "completed") && (
          <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
            <Icon name="check" size={18} className="mt-0.5 shrink-0 text-emerald-700" strokeWidth={2.4} />
            <div>
              <p className="text-sm font-semibold text-emerald-900">Payment confirmed — thank you!</p>
              <p className="mt-1 text-xs text-emerald-800">
                {order.status === "completed" ? "Delivered. We hope you love it."
                  : order.status === "shipped" ? `On its way${order.tracking_no ? ` — tracking ${order.tracking_no}` : ""}.`
                  : "We're packing your order now. You'll get a tracking number on WhatsApp."}
              </p>
            </div>
          </div>
        )}

        {/* ---- payment ---- */}
        {awaitingPayment && !cancelled && (
          <section className="mt-5">
            {/* ---- coming back from the bank (v1.14.0) ----
                One of three, never nothing. The old build showed a thin grey
                line while polling and then said nothing at all, so a failed
                payment and a successful one looked identical. */}

            {outcome === "checking" && (
              <div className="mb-4 flex items-start gap-3 rounded-2xl border border-elfia-line bg-white p-4">
                <span aria-hidden
                  className="mt-0.5 h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-elfia-line border-t-elfia-deep" />
                <div>
                  <p className="text-sm font-semibold text-elfia-ink">Confirming your payment with the bank…</p>
                  <p className="mt-1 text-xs leading-relaxed text-elfia-body">
                    This usually takes a few seconds. Keep this page open — it updates by itself.
                    Please don&apos;t pay again while this is running.
                  </p>
                </div>
              </div>
            )}

            {/* The bank says paid; our own check has not caught up. The one
                thing this screen must NOT do is offer to take the money
                again. */}
            {outcome === "slow" && (
              <div className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                  <Icon name="clock" size={16} className="shrink-0" />
                  Your bank confirmed the payment — we&apos;re still verifying it
                </p>
                <p className="mt-1.5 text-xs leading-relaxed text-amber-900/90">
                  Payments occasionally take a few minutes to reach us. <span className="font-semibold">Do not pay
                  again</span> — you would be charged twice. We check with the bank ourselves, and this page updates
                  the moment it clears. Your order is held in the meantime.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => setRecheck((n) => n + 1)} disabled={checking}
                    className="inline-flex h-10 items-center rounded-full bg-white px-4 text-xs font-semibold text-elfia-deep ring-1 ring-amber-300 disabled:opacity-50">
                    {checking ? "Checking…" : "Check again"}
                  </button>
                  <a className="inline-flex h-10 items-center rounded-full bg-[#25D366] px-4 text-xs font-semibold text-white" rel="noopener"
                    href={`https://wa.me/${order.config.whatsapp_digits}?text=${waText}`}>
                    Send us the receipt
                  </a>
                </div>
              </div>
            )}

            {/* No payment happened. Cancelling at the bank is ordinary, so
                this is not styled as an error — but it must be UNAMBIGUOUS,
                and it must say the words "you have not been charged". */}
            {outcome === "declined" && (
              <div className="mb-4 rounded-2xl border border-elfia-line bg-white p-4">
                <p className="text-sm font-semibold text-elfia-ink">That payment didn&apos;t go through</p>
                <p className="mt-1.5 text-xs leading-relaxed text-elfia-body">
                  <span className="font-semibold text-elfia-ink">You have not been charged.</span> The payment was
                  cancelled or your bank turned it down — it happens, and nothing is wrong with your order.
                  {order.expires_at && timeLeft(order.expires_at)
                    ? <> Your pieces are still held for <span className="font-semibold">{timeLeft(order.expires_at)}</span>.</>
                    : null}
                </p>
                <p className="mt-2.5 text-xs font-medium text-elfia-body">Try again below, or pay by bank transfer instead — both work.</p>
                <button type="button" onClick={() => setRecheck((n) => n + 1)} disabled={checking}
                  className="mt-3 text-xs font-semibold text-elfia-deep underline underline-offset-2 disabled:opacity-50">
                  {checking ? "Checking…" : "I did pay — check again"}
                </button>
              </div>
            )}

            {/* order summary — the CEO's payment screen leads with the money */}
            <div className="rounded-2xl border border-elfia-line bg-white p-5">
              <p className="text-sm font-semibold text-elfia-ink">Order summary</p>
              <div className="mt-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-elfia-body">Subtotal ({order.items.reduce((n, i) => n + i.qty, 0)} items)</span>
                  <span className="font-medium tabular-nums">{fmtRM(subtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-elfia-body">Shipping fee</span>
                  <span className="font-medium tabular-nums">
                    {order.shipping_cents === 0 ? <span className="text-emerald-700">FREE</span> : fmtRM(order.shipping_cents)}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between border-t border-elfia-line pt-3">
                <span className="text-sm font-bold text-elfia-ink">Total amount</span>
                <span className="text-xl font-bold text-elfia-deep tabular-nums">{fmtRM(order.total_cents)}</span>
              </div>

              {/* The hold is real: the cron cancels the order and puts the
                  stock back. Saying so plainly is fairer than a silent
                  cancellation, and it is what stops an order sitting unpaid
                  for a week. */}
              {order.expires_at && (
                <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-relaxed font-medium text-amber-900">
                  <Icon name="clock" size={14} className="mt-px shrink-0" />
                  {/* One span, not loose text: bare text nodes inside a flex
                      container each become their own flex item and stack into
                      columns. */}
                  <span>
                    {timeLeft(order.expires_at)
                      ? <>Please pay within <span className="font-bold">{timeLeft(order.expires_at)}</span> (by {fmtWhen(order.expires_at)}). After that we release these pieces for someone else — you can always order again.</>
                      : <>This order is past its payment window and may be released at any moment. Pay now, or WhatsApp us and we will hold it.</>}
                  </span>
                </p>
              )}
            </div>

            <p className="mt-5 mb-2.5 text-sm font-semibold text-elfia-ink">Payment method</p>
            <div className="space-y-2.5">
              {order.config.gateway && (
                <MethodRow id="fpx" checked={method === "fpx"} onSelect={() => setMethod("fpx")}
                  title="Online banking (FPX)" badge="Instant"
                  note="Maybank2u, CIMB Clicks, Bank Islam, RHB and the rest — secured by Billplz. Your order confirms itself the moment the bank replies.">
                  {/* v1.14.0 — Pay is UNAVAILABLE while a payment might
                      already have been made. Two cases:
                        checking — the poll is still running, and a tap here
                                   creates a second bill for an order that
                                   may be about to confirm.
                        slow     — the bank has said paid. The panel above
                                   tells this customer not to pay again;
                                   leaving a live Pay button under that
                                   sentence is an invitation to be charged
                                   twice, and the sentence is only worth as
                                   much as the button agrees with it.
                      Bank transfer stays available in both cases, which is
                      the escape hatch if something really has gone wrong. */}
                  <button type="button" onClick={() => void payOnline()}
                    disabled={paying || checking || outcome === "slow"}
                    className="inline-flex h-12 w-full items-center justify-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white hover:bg-elfia-deeper disabled:opacity-50">
                    {checking ? "Confirming your last payment…"
                      : outcome === "slow" ? "Payment already received — confirming"
                      : paying ? "Opening secure payment…"
                      : outcome === "declined" ? `Try again — pay ${fmtRM(order.total_cents)}`
                      : `Pay ${fmtRM(order.total_cents)} now`}
                  </button>
                  {payMsg && (
                    <p className="mt-2.5 rounded-xl bg-elfia-veil px-3 py-2 text-xs leading-relaxed font-medium text-elfia-deep">
                      {payMsg}
                    </p>
                  )}
                  <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-[11px] text-elfia-muted">
                    <Icon name="shield" size={13} className="text-elfia-rose" />
                    You leave for Billplz&apos;s secure page and come straight back here.
                  </p>
                </MethodRow>
              )}

              <MethodRow id="transfer" checked={method === "transfer"} onSelect={() => setMethod("transfer")}
                title="Bank transfer" note="Transfer manually, then upload the receipt. We confirm by hand — usually within a few hours.">
                <p className="text-xs text-elfia-body">
                  Transfer <span className="font-bold text-elfia-deep">{fmtRM(order.total_cents)}</span> to:
                </p>
                {/* v1.12.3 — the line is read in full, but Copy hands over
                    the ACCOUNT NUMBER alone. Since the bank name was added
                    the line is a sentence, and a sentence pasted into a
                    banking app's account field is refused. accountDigits()
                    falls back to null on a line with no plausible number,
                    and then Copy behaves as it always did. */}
                <div className="mt-1.5 flex items-center gap-2 rounded-xl bg-elfia-cream px-3 py-2.5">
                  <span className="min-w-0 flex-1 font-mono text-sm font-semibold break-words text-elfia-ink">{order.config.bank_line}</span>
                  <button type="button"
                    onClick={() => {
                      const toCopy = accountDigits(order.config.bank_line) ?? order.config.bank_line;
                      void navigator.clipboard?.writeText(toCopy).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
                    }}
                    className="shrink-0 rounded-full bg-white px-3 py-1.5 text-[11px] font-semibold text-elfia-deep ring-1 ring-elfia-line">
                    {copied ? "Copied" : accountDigits(order.config.bank_line) ? "Copy number" : "Copy"}
                  </button>
                </div>
                <p className="mt-2 text-xs text-elfia-muted">
                  Use <span className="font-semibold text-elfia-body">{order.order_number}</span> as the payment reference, then upload your receipt.
                </p>
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <label className={`${btnClass} cursor-pointer`}>
                    {uploading ? "Uploading…" : order.receipt_uploaded ? "Replace receipt" : "Upload receipt"}
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
                  </label>
                  <a className="inline-flex h-12 items-center rounded-full bg-[#25D366] px-5 text-sm font-semibold text-white hover:brightness-95" rel="noopener"
                    href={`https://wa.me/${order.config.whatsapp_digits}?text=${waText}`}>
                    Send on WhatsApp
                  </a>
                </div>
              </MethodRow>
            </div>
            {uploadMsg && <p className="mt-2.5 text-xs font-medium text-elfia-deep">{uploadMsg}</p>}
          </section>
        )}

        {/* ---- progress ---- */}
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

        {/* ---- items ---- */}
        <div className="mt-4 rounded-2xl border border-elfia-line bg-white p-5">
          <p className="mb-2.5 text-sm font-semibold text-elfia-ink">Items</p>
          {order.items.map((it, i) => (
            <div key={i} className="flex justify-between gap-3 py-1 text-sm">
              <span className="min-w-0 text-elfia-body">{it.name} × {it.qty}</span>
              <span className="shrink-0 tabular-nums">{fmtRM(it.price_cents * it.qty)}</span>
            </div>
          ))}
          <div className="mt-2 flex justify-between border-t border-elfia-line pt-2 text-sm">
            <span className="text-elfia-body">Delivery</span>
            <span className="tabular-nums">{order.shipping_cents === 0 ? "FREE" : fmtRM(order.shipping_cents)}</span>
          </div>
          <div className="mt-1 flex justify-between text-base font-bold">
            <span>Total</span><span className="tabular-nums text-elfia-deep">{fmtRM(order.total_cents)}</span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-elfia-line bg-white p-5">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-elfia-ink">
            <Icon name="pin" size={15} className="text-elfia-rose" /> Delivering to
          </p>
          <p className="mt-1.5 text-xs leading-relaxed text-elfia-muted">
            {order.customer_name} · {order.phone}<br />{order.address}
          </p>
        </div>

        <p className="mt-4 text-center text-[11px] text-elfia-muted">
          Bookmark this page — it always shows your latest order status.
        </p>
      </div>
    </main>
  );
}

export default function OrderPage() {
  return (
    <Suspense fallback={<main className="px-6 py-16 text-center text-sm text-elfia-muted">Loading…</main>}>
      <OrderInner />
    </Suspense>
  );
}
