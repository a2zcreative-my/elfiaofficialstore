"use client";

/**
 * Store admin — passcode-gated (X-Admin-Key = the ADMIN_KEY secret,
 * held in sessionStorage only). Three tabs:
 *   Orders   — confirm payments (view the uploaded receipt), ship with a
 *              tracking number, cancel unpaid orders (restocks itself).
 *   Products — add/edit, price, stock, photo, show/hide, sync stock.
 *   Waitlist — who asked to be told when a sold-out shade returns (v0.6.0).
 * The Worker enforces every rule (forward-only statuses, restock on unpaid
 * cancel); this page is just hands.
 */
import { useCallback, useEffect, useState } from "react";

import { btnClass, btnGhost, fmtRM, imageUrl, inputClass, labelClass, type Product } from "@/lib/config";

interface AdminOrder {
  id: number; order_number: string; customer_name: string; phone: string; address: string;
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

  const [products, setProducts] = useState<Product[]>([]);
  const [waitlist, setWaitlist] = useState<NotifyRow[]>([]);
  const [editing, setEditing] = useState<number | null>(null);
  const [pform, setPform] = useState({ name: "", description: "", price: "", stock: "", sku: "", category: "bawal", featured: false });

  const hdr = useCallback((k: string) => ({ "X-Admin-Key": k, "Content-Type": "application/json" }), []);

  const load = useCallback(async (k: string) => {
    const r = await fetch(`/api/v1/admin/orders${filter === "all" ? "" : `?status=${filter}`}`, { headers: { "X-Admin-Key": k } });
    if (!r.ok) { setError(r.status === 401 ? "Wrong passcode" : `Error ${r.status}`); return false; }
    setOrders(((await r.json()) as { orders: AdminOrder[] }).orders);
    const rp = await fetch("/api/v1/admin/products", { headers: { "X-Admin-Key": k } });
    if (rp.ok) setProducts(((await rp.json()) as { products: Product[] }).products);
    /* Tolerated failure: a worker deployed ahead of migration 0006 has no
       restock_requests table yet. The other two tabs must still work. */
    const rn = await fetch("/api/v1/admin/notify", { headers: { "X-Admin-Key": k } }).catch(() => null);
    if (rn?.ok) setWaitlist(((await rn.json()) as { requests: NotifyRow[] }).requests);
    setError(""); return true;
  }, [filter]);

  useEffect(() => {
    const saved = sessionStorage.getItem("elfia-admin-key");
    if (saved) { setKey(saved); void load(saved).then((ok) => setAuthed(ok)); }
  }, [load]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await load(key)) { sessionStorage.setItem("elfia-admin-key", key); setAuthed(true); }
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
    };
    if (!body.name.trim() || !(body.price_cents > 0)) return;
    const r = editing
      ? await fetch(`/api/v1/admin/products/${editing}`, { method: "PUT", headers: hdr(key), body: JSON.stringify(body) })
      : await fetch("/api/v1/admin/products", { method: "POST", headers: hdr(key), body: JSON.stringify(body) });
    if (r.ok) { setPform({ name: "", description: "", price: "", stock: "", sku: "", category: "bawal", featured: false }); setEditing(null); void load(key); }
  };

  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState("");
  const syncStock = async () => {
    setSyncing(true); setSyncMsg("");
    try {
      const r = await fetch("/api/v1/admin/sync-stock", { method: "POST", headers: hdr(key) });
      const j = (await r.json()) as {
        updated?: { sku: string; from: number; to: number }[];
        unchanged?: number; unmatched_portal?: string[]; unmatched_store?: string[];
        error?: { message?: string };
      };
      if (!r.ok) { setSyncMsg(j.error?.message ?? "Sync failed"); }
      else {
        const lines = [
          j.updated!.length === 0 ? "Already in sync — no stock changed."
            : `Updated ${j.updated!.length}: ${j.updated!.map((u) => `${u.sku} ${u.from}→${u.to}`).join(", ")}`,
        ];
        if (j.unmatched_portal!.length) lines.push(`In portal but NOT in store (add them here with this SKU to sync): ${j.unmatched_portal!.join(", ")}`);
        if (j.unmatched_store!.length) lines.push(`In store but NOT in portal (add the SKU there to sync): ${j.unmatched_store!.join(", ")}`);
        setSyncMsg(lines.join("\n"));
      }
    } catch { setSyncMsg("Network problem — try again"); }
    setSyncing(false);
    void load(key);
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
        </div>

        {tab === "orders" && (
          <>
            <div className="mt-5 flex flex-wrap gap-1.5">
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
                        onClick={() => { setOpenOrder(openOrder === o.id ? null : o.id); setTracking(o.tracking_no ?? ""); }}>
                        {o.order_number}
                      </button>
                      <span className="text-sm text-stone-500">· {o.customer_name}</span>
                      <span className="text-sm font-bold tabular-nums">{fmtRM(o.total_cents)}</span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[o.status] ?? "bg-stone-100"}`}>
                        {o.status.replace("_", " ")}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-stone-500">{o.created_at.slice(0, 16)} · {o.phone}</p>
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
                              <input className={`${inputClass} max-w-44`} placeholder="Tracking no." value={tracking} onChange={(e) => setTracking(e.target.value)} />
                              <button type="button" className={btnClass} onClick={() => void act(o.id, "ship", { tracking_no: tracking })}>Mark shipped</button>
                            </>
                          )}
                          {o.status === "shipped" && (
                            <button type="button" className={btnClass} onClick={() => void act(o.id, "complete")}>Mark delivered</button>
                          )}
                          <a className="ml-auto rounded-full bg-green-100 px-3 py-1.5 text-xs font-semibold text-green-900" rel="noopener"
                            href={`https://wa.me/${o.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(`Hi ${o.customer_name}! ELFIA here about your order ${o.order_number} — `)}`}>
                            WhatsApp
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
            {/* v0.4.0 — pull stock counts from the agency portal (matched by
                SKU). Stock ONLY: prices, photos and descriptions stay this
                store's own. Unmatched SKUs are listed, never guessed. */}
            <div className="mt-5 rounded-xl border border-stone-200 bg-white p-4">
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={btnGhost} disabled={syncing} onClick={() => void syncStock()}>
                  {syncing ? "Syncing…" : "Sync stock from portal"}
                </button>
                <p className="text-xs text-stone-500">Updates stock by SKU (LUMI…/ELFIA…) from the live-session inventory. Prices and photos are never touched.</p>
              </div>
              {syncMsg && <p className="mt-2 text-xs font-medium whitespace-pre-wrap text-stone-700">{syncMsg}</p>}
            </div>
            <form onSubmit={saveProduct} className="mt-4 rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-sm font-semibold text-[#7a2648]">
                {editing ? `Editing #${editing}` : "Add product"}
                {editing && <button type="button" className="ml-2 text-xs font-normal underline" onClick={() => { setEditing(null); setPform({ name: "", description: "", price: "", stock: "", sku: "", category: "bawal", featured: false }); }}>cancel</button>}
              </p>
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
                      {p.sku ? `${p.sku} · ` : ""}{(p.category ?? "bawal") === "shawl" ? "Shawl" : "Bawal"} · {fmtRM(p.price_cents)} · stock {p.stock}
                    </p>
                  </div>
                  <label className="cursor-pointer text-xs text-stone-500 underline">
                    photo
                    <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden"
                      onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadPhoto(p.id, f); }} />
                  </label>
                  <button type="button" className="text-xs underline"
                    onClick={() => { setEditing(p.id); setPform({ name: p.name, description: p.description ?? "", price: String(p.price_cents / 100), stock: String(p.stock), sku: p.sku ?? "", category: p.category ?? "bawal", featured: p.featured === 1 }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
                        {w.sku ? `${w.sku} · ` : ""}{w.phone} · asked {w.created_at.slice(0, 16)}
                        {w.notified_at && <span className="ml-1 text-green-700">· told {w.notified_at.slice(0, 16)}</span>}
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
