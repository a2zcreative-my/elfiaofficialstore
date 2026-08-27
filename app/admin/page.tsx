"use client";

/**
 * Store admin — passcode-gated. v1.4.0 (security audit ST3): the passcode is
 * exchanged ONCE at POST /admin/session for an HttpOnly cookie the browser
 * cannot read, and is never stored on the device; a refresh stays signed in
 * because of that cookie, and "Sign out" ends it. Three tabs:
 *   Orders   — confirm payments (view the uploaded receipt), ship with a
 *              tracking number, cancel unpaid orders (restocks itself).
 *   Products — add/edit, price, stock, photo, show/hide, sync stock.
 *   Waitlist — who asked to be told when a sold-out shade returns (v0.6.0).
 * The Worker enforces every rule (forward-only statuses, restock on unpaid
 * cancel); this page is just hands.
 */
import { useCallback, useEffect, useState } from "react";

import { btnClass, btnGhost, fmtRM, fmtWhen, imageUrl, inputClass, labelClass, type Product } from "@/lib/config";

interface AdminOrder {
  id: number; order_number: string; token: string; customer_name: string; phone: string; address: string;
  tracking_courier?: string | null;
  items: string; subtotal_cents: number; shipping_cents: number; total_cents: number;
  status: string; receipt_key: string | null; payment_method: string | null;
  tracking_no: string | null; admin_notes: string | null; created_at: string;
}

const STATUS_STYLE: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900",
  payment_review: "bg-orange-100 text-orange-900",
  paid: "bg-green-100 text-green-900",
  shipped: "bg-blue-100 text-blue-900",
  completed: "bg-stone-200 text-stone-600",
  cancelled: "bg-red-100 text-red-800",
};
const FILTERS = ["all", "payment_review", "pending_payment", "paid", "shipped", "completed", "cancelled"] as const;

/** Couriers the Worker knows how to build a tracking link for (v0.9.0).
    Keys must match COURIERS in worker/src/index.ts. */
const COURIERS = [
  { key: "", label: "Courier (optional)" },
  { key: "jnt", label: "J&T Express" },
  { key: "ninjavan", label: "Ninja Van" },
  { key: "poslaju", label: "Pos Laju" },
  { key: "flash", label: "Flash Express" },
  { key: "citylink", label: "City-Link" },
  { key: "dhl", label: "DHL" },
] as const;

/**
 * v0.9.0 — the message you send the customer when an order moves. Written
 * out for you; you tap send. It always carries the link to their own order
 * page, which is the thing that stops "where is my parcel?" messages.
 */
function waUpdate(o: AdminOrder, origin: string): { label: string; text: string } {
  const link = `${origin}/order?t=${o.token}`;
  const hi = `Hi ${o.customer_name}! ELFIA here about order ${o.order_number}.`;
  switch (o.status) {
    case "pending_payment":
      return { label: "Send payment reminder", text: `${hi} We have your order and are holding it for you — once you have transferred, upload the receipt here and we will confirm: ${link}` };
    case "payment_review":
      return { label: "Send \"checking receipt\"", text: `${hi} We have received your receipt and are checking it now. You can follow your order here: ${link}` };
    case "paid":
      return { label: "Tell them it's confirmed", text: `${hi} Your payment is confirmed — thank you! We are packing your order now and will send the tracking number once it ships. Follow it here: ${link}` };
    case "shipped":
      return { label: "Send tracking", text: `${hi} Your order has shipped${o.tracking_no ? ` — tracking number ${o.tracking_no}` : ""}. Follow it here: ${link}` };
    case "completed":
      return { label: "Say thank you", text: `${hi} Your order has been delivered. We hope you love it — and thank you for shopping with ELFIA. ${link}` };
    case "cancelled":
      return { label: "Explain the cancellation", text: `${hi} Your order has been cancelled and nothing was charged. If that is unexpected, just reply here and we will sort it out.` };
    default:
      return { label: "WhatsApp", text: `${hi} ` };
  }
}

/** v0.8.0 — health of the two-way inventory sync with the agency portal. */
interface SyncStatus {
  pull_configured: boolean; push_configured: boolean;
  pending: number; stuck: number; oldest_unsent: string | null;
  last_pull_at: string | null; last_pull_result: string | null;
  last_push_at: string | null; last_push_error: string | null;
  /* v1.5.0 — photo trouble on its own line: a clean count sync must not make
     a failed photo look like success. */
  last_photo_error?: string | null;
}

/** v0.6.0 — a "tell me when it's back" request from a sold-out product page. */
interface NotifyRow {
  id: number; product_id: number; name: string; phone: string;
  created_at: string; notified_at: string | null;
  product_name: string | null; sku: string | null; stock: number | null;
}

export default function Admin() {
  const [key, setKey] = useState("");
  const [authed, setAuthed] = useState(false);
  const [tab, setTab] = useState<"orders" | "products" | "waitlist">("orders");
  const [error, setError] = useState("");

  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [openOrder, setOpenOrder] = useState<number | null>(null);
  const [tracking, setTracking] = useState("");
  const [courier, setCourier] = useState("");
  /* Read once on the client — the WhatsApp message carries an absolute link
     to the customer's order page, and this page is served from that origin. */
  const [origin, setOrigin] = useState("");
  useEffect(() => { setOrigin(window.location.origin); }, []);

  const [products, setProducts] = useState<Product[]>([]);
  const [waitlist, setWaitlist] = useState<NotifyRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const BLANK_PRODUCT = { name: "", description: "", price: "", stock: "", sku: "", category: "bawal", featured: false, trackStock: false };
  const [pform, setPform] = useState(BLANK_PRODUCT);
  const [sync, setSync] = useState<SyncStatus | null>(null);

  const hdr = useCallback((k: string) => ({ "X-Admin-Key": k, "Content-Type": "application/json" }), []);

  /* `quiet` is used by the on-load cookie probe: "not signed in yet" is the
     normal first visit, not an error worth showing anyone. */
  const load = useCallback(async (k: string, quiet = false) => {
    const r = await fetch(`/api/v1/admin/orders${filter === "all" ? "" : `?status=${filter}`}`, { headers: { "X-Admin-Key": k } });
    if (!r.ok) { if (!quiet) setError(r.status === 401 ? "Wrong passcode" : `Error ${r.status}`); return false; }
    setOrders(((await r.json()) as { orders: AdminOrder[] }).orders);
    const rp = await fetch("/api/v1/admin/products", { headers: { "X-Admin-Key": k } });
    if (rp.ok) setProducts(((await rp.json()) as { products: Product[] }).products);
    /* Tolerated failure: a worker deployed ahead of migration 0006 has no
       restock_requests table yet. The other two tabs must still work. */
    const rn = await fetch("/api/v1/admin/notify", { headers: { "X-Admin-Key": k } }).catch(() => null);
    if (rn?.ok) setWaitlist(((await rn.json()) as { requests: NotifyRow[] }).requests);
    const rs = await fetch("/api/v1/admin/sync-status", { headers: { "X-Admin-Key": k } }).catch(() => null);
    if (rs?.ok) setSync((await rs.json()) as SyncStatus);
    setError(""); return true;
  }, [filter]);

  /* v1.4.0 (security audit ST3) — the passcode is no longer kept in the
     browser at all. It is exchanged once for an HttpOnly cookie the page
     cannot read, so an injected script has nothing to steal, and a refresh
     stays signed in because the cookie (not sessionStorage) carries the
     session. On load we simply try: if the cookie is still good the data
     arrives, otherwise the passcode screen shows. */
  useEffect(() => {
    void load("", true).then((ok) => { if (ok) setAuthed(true); });
  }, [load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await fetch("/api/v1/admin/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key }),
    }).catch(() => null);
    if (!r?.ok) {
      const j = (await r?.json().catch(() => null)) as { error?: { message?: string } } | null;
      setError(j?.error?.message ?? (r ? `Error ${r.status}` : "Network problem — please try again."));
      return;
    }
    setKey("");                       // the cookie is the credential now
    if (await load("")) setAuthed(true);
  };

  const logout = async () => {
    await fetch("/api/v1/admin/logout", { method: "POST" }).catch(() => null);
    setAuthed(false); setOrders([]); setProducts([]); setWaitlist([]); setSync(null);
  };

  const act = async (id: number, action: string, extra: Record<string, unknown> = {}) => {
    const r = await fetch(`/api/v1/admin/orders/${id}`, { method: "PUT", headers: hdr(key), body: JSON.stringify({ action, ...extra }) });
    if (!r.ok) {
      const j = (await r.json().catch(() => null)) as { error?: { message?: string } } | null;
      alert(j?.error?.message ?? "Action refused");
    }
    void load(key);
  };

  const viewReceipt = async (id: number) => {
    const r = await fetch(`/api/v1/admin/orders/${id}/receipt`, { headers: { "X-Admin-Key": key } });
    if (!r.ok) { alert("No receipt uploaded yet"); return; }
    window.open(URL.createObjectURL(await r.blob()), "_blank");
  };

  const saveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = {
      name: pform.name, description: pform.description,
      price_cents: Math.round(Number(pform.price) * 100),
      stock: Math.round(Number(pform.stock) || 0),
      sku: pform.sku, category: pform.category, featured: pform.featured,
      track_stock: pform.trackStock,
    };
    if (!body.name.trim() || !(body.price_cents > 0)) return;
    const r = editing
      ? await fetch(`/api/v1/admin/products/${editing}`, { method: "PUT", headers: hdr(key), body: JSON.stringify(body) })
      : await fetch("/api/v1/admin/products", { method: "POST", headers: hdr(key), body: JSON.stringify(body) });
    if (r.ok) { setPform(BLANK_PRODUCT); setEditing(null); void load(key); }
  };

  /* v0.8.0 — two-way inventory sync. The cron does this by itself every five
     minutes; this button is for when you want it NOW (after a stocktake). */
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");

  const syncStock = async (retry = false) => {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await fetch(retry ? "/api/v1/admin/sync-retry" : "/api/v1/admin/sync-stock", { method: "POST", headers: hdr(key) });
      const j = (await r.json()) as {
        push?: { configured: boolean; sent: number; pending: number; stuck: number; error?: string };
        pull?: {
          configured: boolean; updated: { sku: string; from: number; to: number }[];
          price_updated?: { sku: string; from: number; to: number }[]; unchanged: number;
          unmatched_portal: string[]; unmatched_store: string[]; deferred: string[]; error?: string;
        };
        sent?: number; error?: { message?: string };
      };
      const lines: string[] = [];
      if (j.push) {
        if (!j.push.configured) lines.push("↑ Sales are NOT being sent to the portal — BRIDGE_PUSH_URL / BRIDGE_KEY are not set.");
        else if (j.push.error) lines.push(`↑ Could not deliver sales: ${j.push.error}`);
        else lines.push(`↑ Sent ${j.push.sent} movement${j.push.sent === 1 ? "" : "s"} to the portal.`);
        if (j.push.pending) lines.push(`↑ ${j.push.pending} still waiting to be delivered.`);
        if (j.push.stuck) lines.push(`↑ ${j.push.stuck} stuck — fix the SKU on one side, then press Retry.`);
      }
      if (j.pull) {
        if (!j.pull.configured) lines.push(`↓ ${j.pull.error ?? "Pull not configured"}`);
        else if (j.pull.error) lines.push(`↓ Could not read the portal: ${j.pull.error}`);
        else {
          lines.push(j.pull.updated.length === 0
            ? `↓ Counts already match (${j.pull.unchanged} checked).`
            : `↓ Updated ${j.pull.updated.length}: ${j.pull.updated.map((u) => `${u.sku} ${u.from}→${u.to}`).join(", ")}`);
          if (j.pull.price_updated?.length) {
            lines.push(`↓ Prices from the portal: ${j.pull.price_updated.map((u) => `${u.sku} ${fmtRM(u.from)}→${fmtRM(u.to)}`).join(", ")}`);
          }
          if (j.pull.deferred.length) lines.push(`↓ Left alone until the portal has our sales: ${j.pull.deferred.join(", ")}`);
          if (j.pull.unmatched_portal.length) lines.push(`In the portal but NOT here (add them with this SKU): ${j.pull.unmatched_portal.join(", ")}`);
          if (j.pull.unmatched_store.length) lines.push(`Here but NOT in the portal (add the SKU there): ${j.pull.unmatched_store.join(", ")}`);
        }
      }
      if (typeof j.sent === "number" && !j.push) lines.push(`Retried — ${j.sent} delivered.`);
      if (j.error?.message) lines.push(j.error.message);
      setSyncMsg(lines.join("\n"));
    } catch { setSyncMsg("Network problem — try again"); }
    setSyncing(false);
    void load(key);
  };

  /* v0.7.0 — prove the Billplz credentials before a customer meets them.
     Read-only on Billplz's side: it reads the collection, never creates a
     bill, never moves money. */
  const [gwTesting, setGwTesting] = useState(false);
  const [gwMsg, setGwMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const testGateway = async () => {
    setGwTesting(true); setGwMsg(null);
    try {
      const r = await fetch("/api/v1/admin/billplz-test", { method: "POST", headers: hdr(key) });
      const j = (await r.json()) as { ok?: boolean; message?: string; error?: { message?: string } };
      setGwMsg({ ok: Boolean(j.ok), text: j.message ?? j.error?.message ?? `Error ${r.status}` });
    } catch { setGwMsg({ ok: false, text: "Network problem — try again" }); }
    setGwTesting(false);
  };

  const waitlistAct = async (id: number, done: boolean) => {
    await fetch(`/api/v1/admin/notify/${id}`, { method: done ? "PUT" : "DELETE", headers: hdr(key) });
    void load(key);
  };

  const uploadPhoto = async (id: number, file: File) => {
    await fetch(`/api/v1/admin/products/${id}/photo`, {
      method: "POST", headers: { "X-Admin-Key": key, "Content-Type": file.type }, body: file,
    });
    void load(key);
  };


  if (!authed) {
    return (
      <main className="px-6 py-24">
        <form onSubmit={login} className="mx-auto max-w-xs">
          <h1 className="text-xl font-bold text-[#7a2648]">Store admin</h1>
          <label className="mt-4 block">
            <span className={labelClass}>Passcode</span>
            <input type="password" className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} autoFocus />
          </label>
          <button type="submit" className={`${btnClass} mt-3 w-full`}>Enter</button>
          {error && <p className="mt-2 text-sm font-medium text-red-700">{error}</p>}
        </form>
      </main>
    );
  }

  return (
    <main className="px-6 py-10">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex items-center gap-3">
          {/* v1.8.1 — the Products tab used to carry a review count for
              products the portal had "proposed". There is no proposing any
              more: the portal's Publish tick puts a product in the shop, and
              this screen has no say in it. Only the waitlist still counts. */}
          {(["orders", "products", "waitlist"] as const).map((t) => {
            const open = t === "waitlist" ? waitlist.filter((w) => !w.notified_at).length : 0;
            return (
              <button key={t} type="button"
                className={`rounded-lg px-4 py-2 text-sm font-semibold capitalize ${tab === t ? "bg-[#7a2648] text-white" : "bg-white text-stone-600 hover:bg-stone-100"}`}
                onClick={() => setTab(t)}>
                {t}
                {open > 0 && (
                  <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] ${tab === t ? "bg-white/25" : "bg-[#7a2648] text-white"}`}>{open}</span>
                )}
              </button>
            );
          })}
          <button type="button" className="ml-auto text-xs text-stone-500 underline" onClick={() => void load(key)}>Refresh</button>
          {/* v1.4.0 — ends the admin cookie on this device. Worth having on a
              shared or shop-counter machine: closing the tab is no longer the
              only way out. */}
          <button type="button" className="text-xs text-stone-500 underline" onClick={() => void logout()}>Sign out</button>
        </div>

        {tab === "orders" && (
          <>
            <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnGhost} disabled={gwTesting} onClick={() => void testGateway()}>
                  {gwTesting ? "Checking…" : "Test online payment (Billplz)"}
                </button>
                <p className="text-xs text-stone-500">
                  Checks the API Secret Key and Collection ID against Billplz. Reads only — no bill is created and no money moves.
                </p>
              </div>
              {gwMsg && (
                <p className={`mt-2 text-xs font-medium ${gwMsg.ok ? "text-green-700" : "text-red-700"}`}>
                  {gwMsg.ok ? "✓ " : "✕ "}{gwMsg.text}
                </p>
              )}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {FILTERS.map((f) => (
                <button key={f} type="button"
                  className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? "bg-[#7a2648] text-white" : "bg-white hover:bg-stone-100"}`}
                  onClick={() => setFilter(f)}>
                  {f.replace("_", " ")}
                </button>
              ))}
            </div>
            <div className="mt-4 space-y-3">
              {orders.length === 0 && <p className="text-sm text-stone-500">No orders here.</p>}
              {orders.map((o) => {
                const items = JSON.parse(o.items) as { name: string; qty: number; price_cents: number }[];
                return (
                  <div key={o.id} className="rounded-xl border border-stone-200 bg-white p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="font-semibold text-[#7a2648] underline-offset-2 hover:underline"
                        onClick={() => { setOpenOrder(openOrder === o.id ? null : o.id); setTracking(o.tracking_no ?? ""); setCourier(o.tracking_courier ?? ""); }}>
                        {o.order_number}
                      </button>
                      <span className="text-sm text-stone-500">· {o.customer_name}</span>
                      <span className="text-sm font-bold tabular-nums">{fmtRM(o.total_cents)}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status] ?? "bg-stone-100"}`}>
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                    {/* Malaysian time — the Worker stores UTC, and an eight-hour lie about
                        when an order arrived is worth avoiding. */}
                    <p className="mt-1 text-xs text-stone-500">{fmtWhen(o.created_at)} · {o.phone}</p>
                    {openOrder === o.id && (
                      <div className="mt-3 border-t border-stone-100 pt-3 text-sm">
                        {items.map((it, i) => (
                          <p key={i} className="text-stone-700">{it.name} × {it.qty} — {fmtRM(it.price_cents * it.qty)}</p>
                        ))}
                        <p className="mt-1 text-xs text-stone-500">Ship to: {o.address}</p>
                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          {o.receipt_key && (
                            <button type="button" className={btnGhost} onClick={() => void viewReceipt(o.id)}>View receipt</button>
                          )}
                          {(o.status === "pending_payment" || o.status === "payment_review") && (
                            <>
                              <button type="button" className={btnClass} onClick={() => void act(o.id, "confirm_paid")}>Confirm payment</button>
                              <button type="button" className="text-xs text-red-700 underline" onClick={() => void act(o.id, "cancel")}>
                                Cancel (restocks)
                              </button>
                            </>
                          )}
                          {o.status === "paid" && (
                            <>
                              <input className={`${inputClass} max-w-40`} placeholder="Tracking no." value={tracking} onChange={(e) => setTracking(e.target.value)} />
                              <select className={`${inputClass} max-w-40`} value={courier} onChange={(e) => setCourier(e.target.value)}>
                                {COURIERS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                              </select>
                              <button type="button" className={btnClass}
                                onClick={() => void act(o.id, "ship", { tracking_no: tracking, tracking_courier: courier })}>
                                Mark shipped
                              </button>
                            </>
                          )}
                          {o.status === "shipped" && (
                            <button type="button" className={btnClass} onClick={() => void act(o.id, "complete")}>Mark delivered</button>
                          )}
                          {/* One tap, message already written, order link included. */}
                          <a className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-green-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-green-700"
                            rel="noopener noreferrer" target="_blank"
                            href={`https://wa.me/${o.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(waUpdate(o, origin).text)}`}>
                            {waUpdate(o, origin).label}
                          </a>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "products" && (
          <>
            {/* v0.8.0 — two-way sync with the agency portal. Stock ONLY:
                prices, photos and descriptions stay this store's own. The
                numbers below are the ones that tell you the two systems still
                agree; unmatched SKUs are listed, never guessed. */}
            <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnGhost} disabled={syncing} onClick={() => void syncStock()}>
                  {syncing ? "Syncing…" : "Sync with portal now"}
                </button>
                <p className="text-xs text-stone-500">
                  Runs by itself every 5 minutes. Sales are sent the moment an order is placed; this is for
                  when you want it immediately (after a stocktake).
                </p>
              </div>

              {sync && (
                <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3 text-xs sm:grid-cols-2">
                  <div>
                    <p className="font-semibold text-stone-700">↑ Sales → portal</p>
                    {!sync.push_configured ? (
                      <p className="text-red-700">
                        Not configured — sales are being recorded but the portal never hears about them.
                        Set BRIDGE_PUSH_URL and the BRIDGE_KEY secret.
                      </p>
                    ) : (
                      <>
                        <p className={sync.pending > 0 ? "text-amber-700" : "text-green-700"}>
                          {sync.pending === 0 ? "All sales delivered" : `${sync.pending} waiting to be delivered`}
                          {sync.stuck > 0 && <span className="text-red-700"> · {sync.stuck} stuck</span>}
                        </p>
                        {sync.last_push_at && <p className="text-stone-500">last sent {sync.last_push_at.slice(0, 16).replace("T", " ")}</p>}
                        {sync.last_push_error && <p className="text-red-700">{sync.last_push_error}</p>}
                        {sync.oldest_unsent && sync.pending > 0 && (
                          <p className="text-stone-500">oldest waiting since {sync.oldest_unsent.slice(0, 16)}</p>
                        )}
                        {sync.stuck > 0 && (
                          <button type="button" className="mt-1 text-xs underline" disabled={syncing} onClick={() => void syncStock(true)}>
                            retry stuck movements
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  <div>
                    <p className="font-semibold text-stone-700">↓ Counts &amp; prices ← portal</p>
                    {!sync.pull_configured ? (
                      <p className="text-red-700">Not configured — set BRIDGE_URL and the BRIDGE_KEY secret.</p>
                    ) : (
                      <>
                        <p className="text-stone-600">{sync.last_pull_result ?? "not run yet"}</p>
                        {sync.last_pull_at && <p className="text-stone-500">last read {sync.last_pull_at.slice(0, 16).replace("T", " ")}</p>}
                        {sync.last_photo_error && <p className="text-red-700">Photo: {sync.last_photo_error}</p>}
                      </>
                    )}
                  </div>
                </div>
              )}

              {syncMsg && <p className="mt-3 border-t border-stone-100 pt-3 text-xs font-medium whitespace-pre-wrap text-stone-700">{syncMsg}</p>}
            </div>
            <form onSubmit={saveProduct} className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-sm font-semibold text-[#7a2648]">
                {editing ? `Editing #${editing}` : "Add product"}
                {editing && <button type="button" className="ml-2 text-xs font-normal underline" onClick={() => { setEditing(null); setPform(BLANK_PRODUCT); }}>cancel</button>}
              </p>
              {/* v1.8.1 — say it plainly rather than letting someone type into
                  a field the next sync will overwrite. A SKU is what the
                  bridge matches on, so a SKU'd product belongs to the portal:
                  name, collection, description, photo, price and stock are
                  re-applied from there every five minutes. That is the CEO's
                  rule ("all inside the portal"), and hiding it on this screen
                  is exactly how the two systems drift apart. */}
              {editing && pform.sku.trim() !== "" && (
                <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800">
                  <strong>{pform.sku.trim().toUpperCase()} is run from the portal.</strong> Its name,
                  collection, description, photo, price and stock come from the portal&apos;s
                  ELFIA Store tab on every sync, so a change made here is replaced within
                  about five minutes. Edit it there instead.
                </p>
              )}
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="block sm:col-span-2">
                  <span className={labelClass}>Name *</span>
                  <input className={inputClass} value={pform.name} onChange={(e) => setPform((f) => ({ ...f, name: e.target.value }))} maxLength={200} />
                </label>
                <label className="block sm:col-span-2">
                  <span className={labelClass}>Description</span>
                  <textarea className={`${inputClass} h-20 py-2`} value={pform.description} onChange={(e) => setPform((f) => ({ ...f, description: e.target.value }))} maxLength={2000} />
                </label>
                <label className="block">
                  <span className={labelClass}>Price (RM) *</span>
                  <input type="number" min={0.01} step="0.01" className={inputClass} value={pform.price} onChange={(e) => setPform((f) => ({ ...f, price: e.target.value }))} />
                </label>
                <label className="block">
                  <span className={labelClass}>Stock</span>
                  <input type="number" min={0} className={inputClass} value={pform.stock} onChange={(e) => setPform((f) => ({ ...f, stock: e.target.value }))} />
                </label>
                <label className="block">
                  <span className={labelClass}>SKU / code (Bawal uses LUMI001, LUMI002, …)</span>
                  <input className={inputClass} value={pform.sku} onChange={(e) => setPform((f) => ({ ...f, sku: e.target.value }))} maxLength={40} placeholder="LUMI004" />
                </label>
                <label className="block">
                  <span className={labelClass}>Collection</span>
                  <select className={inputClass} value={pform.category} onChange={(e) => setPform((f) => ({ ...f, category: e.target.value }))}>
                    <option value="bawal">Bawal</option>
                    <option value="shawl">Shawl</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 pt-1 text-sm sm:col-span-2">
                  <input type="checkbox" className="h-4 w-4 accent-[#7a2648]" checked={pform.featured} onChange={(e) => setPform((f) => ({ ...f, featured: e.target.checked }))} />
                  Feature in the home-page carousel
                </label>
                {/* v0.7.0 — availability. Unticked (the default for the ten
                    designs) means the Stock number above is ignored entirely
                    and the product can always be ordered. */}
                <label className="flex items-start gap-2 text-sm sm:col-span-2">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[#7a2648]" checked={pform.trackStock} onChange={(e) => setPform((f) => ({ ...f, trackStock: e.target.checked }))} />
                  <span>
                    Count stock for this product
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {pform.trackStock
                        ? "Every order reduces the count above, and the shop shows Sold out at zero."
                        : "Always available — the stock number is ignored and customers can always order."}
                    </span>
                  </span>
                </label>
              </div>
              <button type="submit" className={`${btnClass} mt-3`}>{editing ? "Save changes" : "Add product"}</button>
            </form>
            <div className="mt-4 space-y-2">
              {products.map((p) => (
                <div key={p.id} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white p-3">
                  <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-stone-100">
                    {p.image_key && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={imageUrl(p.image_key)} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {p.featured === 1 && <span title="In the home carousel">★ </span>}
                      {p.name} {p.active ? "" : <span className="text-xs text-stone-400">(hidden)</span>}
                    </p>
                    <p className="text-xs text-stone-500">
                      {p.sku ? `${p.sku} · ` : ""}{(p.category ?? "bawal") === "shawl" ? "Shawl" : "Bawal"} · {fmtRM(p.price_cents)} ·{" "}
                      {(p.track_stock ?? 1) === 1
                        ? <span className={p.stock <= 0 ? "font-semibold text-red-600" : ""}>stock {p.stock}</span>
                        : <span className="font-medium text-green-700">always available</span>}
                    </p>
                  </div>
                  <label className="cursor-pointer text-xs text-stone-500 underline">
                    photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(p.id, f); }} />
                  </label>
                  <button type="button" className="text-xs underline"
                    onClick={() => { setEditing(p.id); setPform({ name: p.name, description: p.description ?? "", price: String(p.price_cents / 100), stock: String(p.stock), sku: p.sku ?? "", category: p.category ?? "bawal", featured: p.featured === 1, trackStock: (p.track_stock ?? 1) === 1 }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
                    edit
                  </button>
                  <button type="button" className="text-xs text-stone-500 underline"
                    onClick={() => void fetch(`/api/v1/admin/products/${p.id}`, { method: "PUT", headers: hdr(key), body: JSON.stringify({ active: !p.active }) }).then(() => load(key))}>
                    {p.active ? "hide" : "show"}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* v0.6.0 — who is waiting for a sold-out shade. Nothing is sent
            automatically: you press WhatsApp, say hello in your own words,
            then mark them told. Open requests sort first, oldest at the top. */}
        {tab === "waitlist" && (
          <>
            <p className="mt-5 text-xs text-stone-500">
              Customers who asked to be told when a sold-out design returns. Restock it in Products first,
              then message them — the WhatsApp button opens a chat with the shade already in the message.
            </p>
            <div className="mt-4 space-y-2">
              {waitlist.length === 0 && <p className="text-sm text-stone-500">Nobody waiting right now.</p>}
              {waitlist.map((w) => {
                const back = (w.stock ?? 0) > 0;
                return (
                  <div key={w.id} className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 ${w.notified_at ? "border-stone-200 bg-stone-50" : "border-stone-200 bg-white"}`}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {w.name} <span className="font-normal text-stone-500">wants</span> {w.product_name ?? `#${w.product_id}`}
                      </p>
                      <p className="text-xs text-stone-500">
                        {w.sku ? `${w.sku} · ` : ""}{w.phone} · asked {fmtWhen(w.created_at)}
                        {w.notified_at && <span className="ml-1 text-green-700">· told {fmtWhen(w.notified_at)}</span>}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${back ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`}>
                      {back ? `back in stock (${w.stock})` : "still sold out"}
                    </span>
                    <a className="rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-900" rel="noopener"
                      href={`https://wa.me/${w.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hi ${w.name}! ELFIA here — ${w.product_name ?? "the shade you wanted"} is back in stock. `)}`}>
                      WhatsApp
                    </a>
                    {!w.notified_at && (
                      <button type="button" className="text-xs underline" onClick={() => void waitlistAct(w.id, true)}>mark told</button>
                    )}
                    <button type="button" className="text-xs text-stone-500 underline" onClick={() => void waitlistAct(w.id, false)}>remove</button>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </main>
  );
}
