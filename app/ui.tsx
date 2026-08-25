"use client";

/**
 * Shared storefront pieces — v1.4.0.
 *
 * The CEO's layout repeats the same four things on every screen: a rounded
 * white panel, a product tile with a heart on the photo, a section header with
 * a "View all" on the right, and a row of soft-pink icon pads. They live here
 * once so the phone app and the desktop shop can never drift apart, and so a
 * change to the card shape happens in ONE file.
 *
 * Everything in here is client-side: the heart reads localStorage.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  WISH_EVENT, comparePrice, fmtRM, imageUrl, isSoldOut, lowStock, readWishlist, splitName, toggleWish,
  type Product,
} from "@/lib/config";

/* ---------- icons ----------
   One 24px stroke set, so nothing on the storefront looks borrowed. */

export type IconName =
  | "home" | "bag" | "grid" | "heart" | "user" | "cart" | "search" | "chevron"
  | "back" | "filter" | "sort" | "bell" | "truck" | "box" | "receipt" | "ticket"
  | "gift" | "pin" | "clock" | "check" | "spark" | "shield" | "clock-history";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5.5 9.5V20a1 1 0 0 0 1 1H10v-5.5h4V21h3.5a1 1 0 0 0 1-1V9.5" /></>,
  bag: <><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" /><path d="M3 6h18" /><path d="M16 10a4 4 0 0 1-8 0" /></>,
  grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="2" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="2" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2" /></>,
  heart: <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13Z" />,
  user: <><circle cx="12" cy="8" r="3.6" /><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" /></>,
  cart: <><circle cx="9.5" cy="20" r="1.3" /><circle cx="18" cy="20" r="1.3" /><path d="M2.5 3h2.2l2.4 11.4a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 2-1.55L21 8H6" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-3.6-3.6" /></>,
  chevron: <path d="m9 5 7 7-7 7" />,
  back: <><path d="M20 12H4" /><path d="m10 6-6 6 6 6" /></>,
  filter: <><path d="M4 6h16" /><path d="M7 12h10" /><path d="M10 18h4" /></>,
  sort: <><path d="M7 4v16" /><path d="m3.5 16.5 3.5 3.5 3.5-3.5" /><path d="M17 20V4" /><path d="m13.5 7.5 3.5-3.5 3.5 3.5" /></>,
  bell: <><path d="M18 9a6 6 0 1 0-12 0c0 5-2 6.5-2 6.5h16S18 14 18 9" /><path d="M13.7 19.5a2 2 0 0 1-3.4 0" /></>,
  truck: <><path d="M2.5 6.5h11v10h-11z" /><path d="M13.5 10h4l3 3v3.5h-7z" /><circle cx="7" cy="18" r="1.8" /><circle cx="17.5" cy="18" r="1.8" /></>,
  box: <><path d="m3.5 7.5 8.5-4.5 8.5 4.5v9L12 21l-8.5-4.5Z" /><path d="m3.5 7.5 8.5 4.5 8.5-4.5" /><path d="M12 12v9" /></>,
  receipt: <><path d="M5 3h14v18l-2.3-1.6-2.4 1.6L12 19.4 9.7 21l-2.4-1.6L5 21Z" /><path d="M9 8h6" /><path d="M9 12h6" /></>,
  ticket: <><path d="M3 8.5A2.5 2.5 0 0 0 5.5 6h13A2.5 2.5 0 0 0 21 8.5v1a2.5 2.5 0 0 0 0 5v1a2.5 2.5 0 0 0-2.5 2.5h-13A2.5 2.5 0 0 0 3 15.5v-1a2.5 2.5 0 0 0 0-5Z" /><path d="M12 7v2" /><path d="M12 15v2" /></>,
  gift: <><path d="M3.5 11h17v9.5h-17z" /><path d="M2.5 7h19v4h-19z" /><path d="M12 7v13.5" /><path d="M12 7S10.5 3 8.2 3a2.2 2.2 0 0 0 0 4Z" /><path d="M12 7s1.5-4 3.8-4a2.2 2.2 0 0 1 0 4Z" /></>,
  pin: <><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z" /><circle cx="12" cy="10" r="2.6" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  "clock-history": <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" /><path d="M3 4v4.5h4.5" /><path d="M12 8v4.2l2.8 1.8" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  spark: <><path d="M12 3.5 13.9 9l5.6 2-5.6 2-1.9 5.5L10.1 13 4.5 11l5.6-2Z" /><path d="M18.5 4v3" /><path d="M20 5.5h-3" /></>,
  shield: <><path d="M12 3 5 6v6c0 4.2 3 7.5 7 9 4-1.5 7-4.8 7-9V6Z" /><path d="m9 12 2 2 4-4" /></>,
};

export function Icon({ name, size = 22, className = "", strokeWidth = 1.6 }: {
  name: IconName; size?: number; className?: string; strokeWidth?: number;
}) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}

/* ---------- wishlist heart ---------- */

/** The whole wishlist, live. Any component using it re-renders on a toggle,
    in this tab (WISH_EVENT) and in others (storage). */
export function useWishlist(): number[] {
  const [ids, setIds] = useState<number[]>([]);
  useEffect(() => {
    const sync = () => setIds(readWishlist());
    sync();
    window.addEventListener(WISH_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(WISH_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return ids;
}

export function WishHeart({ id, className = "" }: { id: number; className?: string }) {
  const ids = useWishlist();
  const on = ids.includes(id);
  const [bump, setBump] = useState(false);
  return (
    <button type="button" aria-pressed={on} aria-label={on ? "Remove from wishlist" : "Save to wishlist"}
      onClick={(e) => {
        e.preventDefault(); e.stopPropagation();   // the card is a link
        const now = toggleWish(id);
        if (now) { setBump(true); setTimeout(() => setBump(false), 300); }
      }}
      className={`flex h-9 w-9 items-center justify-center rounded-full bg-white/90 backdrop-blur transition-colors hover:bg-white ${
        on ? "text-elfia-deep" : "text-elfia-muted"} ${className}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
        fill={on ? "currentColor" : "none"} stroke="currentColor" className={bump ? "animate-pop" : ""} aria-hidden="true">
        <path d="M12 20.5 4.2 13a4.8 4.8 0 0 1 6.8-6.8l1 1 1-1A4.8 4.8 0 0 1 19.8 13Z" />
      </svg>
    </button>
  );
}

/* ---------- product tile ----------
   4:5 lookbook frame, shade name large, SKU small, price in deep rose — the
   shape v0.6.0 settled on, now with the heart and a softer card. */

export function ProductCard({ p, compact = false }: { p: Product; compact?: boolean }) {
  const { series, shade } = splitName(p.name);
  const out = isSoldOut(p);
  const low = lowStock(p);
  /* v1.7.0 — the portal's discount, drawn as a struck price + SALE badge. */
  const was = comparePrice(p);
  return (
    <Link href={`/p?id=${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-elfia-veil ring-1 ring-elfia-line">
        {p.image_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(p.image_key)} alt={p.name} loading="lazy"
            className={`h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04] ${out ? "opacity-70" : ""}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl font-bold tracking-widest text-elfia-rose/40">ELFIA</div>
        )}
        <div className="absolute top-2.5 right-2.5"><WishHeart id={p.id} /></div>
        {out ? (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold tracking-wider text-elfia-body uppercase">
            Sold out
          </span>
        ) : low ? (
          <span className="absolute top-3 left-3 rounded-full bg-elfia-deep px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase">
            {low} left
          </span>
        ) : was ? (
          <span className="absolute top-3 left-3 rounded-full bg-elfia-gold px-2.5 py-1 text-[10px] font-bold tracking-wider text-white uppercase">
            Sale
          </span>
        ) : null}
      </div>
      <div className="mt-2.5">
        {(p.sku ?? series) && (
          <p className="text-[10px] font-medium tracking-[0.18em] text-elfia-muted uppercase">{p.sku ?? series}</p>
        )}
        <p className={`mt-1 line-clamp-2 leading-snug font-medium text-elfia-ink group-hover:text-elfia-deep ${compact ? "text-[13.5px]" : "text-[15px]"}`}>
          {shade}
        </p>
        <p className="mt-1 text-sm font-bold text-elfia-deep">
          {fmtRM(p.price_cents)}
          {was && <s className="ml-1.5 text-xs font-normal text-elfia-muted">{fmtRM(was)}</s>}
        </p>
      </div>
    </Link>
  );
}

/* ---------- layout furniture ---------- */

export function SectionHeader({ title, href, hint }: { title: string; href?: string; hint?: string }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[17px] font-bold text-elfia-ink sm:text-xl">{title}</h2>
        {hint && <p className="mt-0.5 text-xs text-elfia-muted">{hint}</p>}
      </div>
      {href && (
        <Link href={href} className="flex shrink-0 items-center gap-0.5 text-xs font-semibold text-elfia-deep hover:text-elfia-deeper">
          View all <Icon name="chevron" size={14} strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}

/** A soft pink pad with an icon — the Quick Access / Member Benefits row. */
export function IconTile({ icon, label, note, href, badge }: {
  icon: IconName; label: string; note?: string; href: string; badge?: number;
}) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1.5 rounded-2xl bg-white px-2 py-3.5 text-center ring-1 ring-elfia-line transition-colors hover:ring-elfia-rose">
      <span className="relative flex h-10 w-10 items-center justify-center rounded-full bg-elfia-veil text-elfia-deep">
        <Icon name={icon} size={19} />
        {badge !== undefined && badge > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-elfia-deep px-1 text-[10px] font-bold text-white">
            {badge > 9 ? "9+" : badge}
          </span>
        )}
      </span>
      <span className="text-[11px] leading-tight font-medium text-elfia-ink">{label}</span>
      {note && <span className="text-[10px] leading-tight text-elfia-muted">{note}</span>}
    </Link>
  );
}

export function EmptyState({ icon, title, note, cta }: {
  icon: IconName; title: string; note: string; cta?: { href: string; label: string };
}) {
  return (
    <div className="rounded-2xl border border-elfia-line bg-white px-6 py-12 text-center">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-elfia-veil text-elfia-rose">
        <Icon name={icon} size={26} />
      </span>
      <p className="mt-4 font-semibold text-elfia-ink">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-elfia-muted">{note}</p>
      {cta && (
        <Link href={cta.href} className="mt-5 inline-flex h-11 items-center justify-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white hover:bg-elfia-deeper">
          {cta.label}
        </Link>
      )}
    </div>
  );
}

/** The grey blocks shown while /api/v1/products is in flight. */
export function CardSkeleton({ n = 4 }: { n?: number }) {
  return (
    <>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="animate-pulse">
          <div className="aspect-[4/5] rounded-2xl bg-elfia-blush/70" />
          <div className="mt-3 h-3 w-1/3 rounded bg-elfia-blush/70" />
          <div className="mt-2 h-3.5 w-2/3 rounded bg-elfia-blush/70" />
        </div>
      ))}
    </>
  );
}

/* ---------- order status ----------
   One vocabulary for the badge on the dashboard, the tabs, and the order
   page, so a customer never sees an order called two different things. */

export const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Awaiting payment",
  payment_review: "Checking receipt",
  paid: "Paid — packing",
  shipped: "Shipped",
  completed: "Delivered",
  cancelled: "Cancelled",
};

export const STATUS_STYLE: Record<string, string> = {
  pending_payment: "bg-amber-100 text-amber-900",
  payment_review: "bg-orange-100 text-orange-900",
  paid: "bg-emerald-100 text-emerald-900",
  shipped: "bg-sky-100 text-sky-900",
  completed: "bg-elfia-blush text-elfia-deep",
  cancelled: "bg-rose-100 text-rose-800",
};

export function StatusPill({ status }: { status: string }) {
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-semibold ${STATUS_STYLE[status] ?? "bg-elfia-blush text-elfia-body"}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}
