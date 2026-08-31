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
  WISH_EVENT, comparePrice, flashCountdown, flashLeftMs, fmtRM, imageUrl, isSoldOut, lowStock,
  readWishlist, splitName, toggleWish,
  type Product,
} from "@/lib/config";

/* ---------- icons ----------
   One 24px stroke set, so nothing on the storefront looks borrowed. */

export type IconName =
  | "home" | "bag" | "grid" | "heart" | "user" | "cart" | "search" | "chevron"
  | "back" | "filter" | "sort" | "bell" | "truck" | "box" | "receipt" | "ticket"
  | "gift" | "pin" | "clock" | "check" | "spark" | "shield" | "clock-history"
  /* v1.15.0 — the catalog page: a link to the PDF, and a way out of the
     full-screen page view. */
  | "download" | "close";

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
  download: <><path d="M12 3.5v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M4.5 19.5h15" /></>,
  close: <><path d="m6 6 12 12" /><path d="m18 6-12 12" /></>,
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

/* ---------- keeping prices honest on a page already open ---------- */

/**
 * v1.16.0 — a counter that ticks whenever the shop should re-read its prices.
 *
 * The CEO: "How to make all the pages automatically update the prices and
 * promotion/discount?"
 *
 * Almost all of it already worked. Every page fetches /api/v1/products when
 * it mounts, the Worker sends `Cache-Control: no-store` so nothing caches a
 * price, and the portal's changes reach the store within a minute. What was
 * missing is the case nobody notices: a page ALREADY OPEN.
 *
 * Someone opens the shop, is distracted, comes back an hour later — and is
 * reading last hour's prices, because the fetch only ever ran on mount. A
 * discount started in the meantime is invisible to exactly the customer who
 * is still browsing. (Nobody could ever PAY a stale price: checkout re-prices
 * every line from the database. But being shown one number and charged
 * another is its own kind of wrong.)
 *
 * So the shop re-reads when the tab becomes visible again, when the window
 * regains focus, and on a slow timer while the tab is actually being looked
 * at. The timer deliberately does NOT run in a hidden tab: a shop left open
 * in a background tab overnight should not poll a worker 480 times.
 *
 * Pages use it by putting the value in their fetch effect's dependencies —
 * one line each, and the fetch they already had does the rest.
 */
const REFRESH_MS = 90_000;

/* ONE signal for the whole app, not one per component. Two reasons:
   the header and the page beneath it must re-read at the SAME moment (a
   banner promising free delivery over RM 45 while the page below prices it
   at RM 50 is worse than either number being briefly old), and a single
   interval is a single interval however many components are listening. */
let tickValue = 0;
const listeners = new Set<() => void>();
let wired = false;

function bump() {
  tickValue += 1;
  for (const f of listeners) f();
}

function wire() {
  if (wired || typeof window === "undefined") return;
  wired = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") bump();
  });
  window.addEventListener("focus", bump);
  /* Ninety seconds is longer than the portal's own one-minute sync, so a
     change made in the portal has always reached the store before the shop
     asks for it again. It does NOT run in a hidden tab: a shop left open in
     a background tab overnight should not poll a worker 480 times. */
  window.setInterval(() => {
    if (document.visibilityState === "visible") bump();
  }, REFRESH_MS);
}

export function useDataRefresh(): number {
  const [t, setT] = useState(tickValue);
  useEffect(() => {
    wire();
    const f = () => setT(tickValue);
    listeners.add(f);
    /* A component mounting after a tick has already happened must not sit on
       the stale number it initialised with. */
    setT(tickValue);
    return () => { listeners.delete(f); };
  }, []);
  return t;
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

/* ---------- v1.41.0: the flash-sale pill ----------
   The CEO, 28-08-2026: "ELFIA should have a pill of Flash Sales to make the
   customer attracted."

   Red, because that is the one colour this shop does not otherwise use — the
   ordinary sale badge is gold, and a flash sale has to read as different at
   a glance or it is just another badge.

   The countdown is what makes it work, and it is honest: it ticks off the
   deadline the portal set, and when the clock runs out the pill removes
   ITSELF rather than waiting for the next five-minute sync. A customer who
   watches "2m 04s" reach zero and still sees a sale badge has been told a
   small lie, and it is exactly the kind people notice.

   `compact` is the corner-of-a-card version; the full one sits on the
   product page where there is room for the word "ends".

   Ticks every second only while a sale is actually running: no sale, no
   timer, so a shop with nothing on offer does no work at all. */
export function FlashPill({ p, compact = false }: { p: Product; compact?: boolean }) {
  const [left, setLeft] = useState<number | null>(() => flashLeftMs(p));
  useEffect(() => {
    /* Re-read from the product on every tick rather than counting down a
       local number: a sync that changes or ends the sale mid-view is picked
       up, and the tab returning from sleep shows the truth, not a stale
       countdown that kept running in a frozen timer. */
    const tick = () => setLeft(flashLeftMs(p));
    tick();
    if (flashLeftMs(p) === null) return;
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [p]);
  if (left === null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full bg-red-600 font-bold tracking-wider text-white uppercase ${
        compact ? "px-2.5 py-1 text-[10px]" : "px-3 py-1.5 text-xs"}`}
      /* The countdown changes every second; without this a screen reader
         would announce it endlessly. The label carries the meaning once. */
      aria-label={`Flash sale, ends in ${flashCountdown(left)}`}
    >
      <span aria-hidden>⚡</span>
      <span aria-hidden>{compact ? "Flash" : "Flash sale"}</span>
      <span aria-hidden className="font-mono tabular-nums opacity-90">
        {compact ? flashCountdown(left) : `ends in ${flashCountdown(left)}`}
      </span>
    </span>
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
  /* v1.41.0 — is a flash sale running on this card right now? Read once for
     the badge choice; FlashPill keeps its own second-by-second clock. */
  const flash = flashLeftMs(p) !== null;
  return (
    <Link href={`/p?id=${p.id}`} className="group block">
      <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-elfia-veil ring-1 ring-elfia-line">
        {/* v1.33.0 (CEO: "for this area also need to have the hover!") — the
            same ELFIA backdrop the /catalog tiles use, on every product card
            in the shop: home rails, the grid, collections, the wishlist.
            One stable worker URL, so the picture is whatever the portal
            uploaded (or the shipped one when nothing is). It is only ever
            SEEN through a cut-out photo; an opaque photo covers it whole,
            which is why it costs nothing to have here. Drawn only when
            there is a photo — the "ELFIA" placeholder keeps its plain pad.
            v1.35.0 — a WEB-VIEW effect only, by the CEO's call. v1.34 made
            it always-on where no cursor exists (a phone cannot hover); he
            looked at it and asked for the app view left plain. So there is
            no `touch:` rule here on purpose: no cursor, no backdrop. */}
        {p.image_key && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/v1/tile-backdrop" alt="" aria-hidden loading="lazy" decoding="async"
            className="absolute inset-0 h-full w-full object-cover object-top opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        )}
        {p.image_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          /* `relative` is load-bearing: the backdrop above is positioned, and
             a positioned box paints over a static one whatever the source
             order — without it the photo would sit UNDER its own backdrop. */
          <img src={imageUrl(p.image_key)} alt={p.name} loading="lazy"
            className={`relative h-full w-full object-cover object-top transition-transform duration-500 group-hover:scale-[1.04] ${out ? "opacity-70" : ""}`} />
        ) : (
          <div className="flex h-full items-center justify-center text-2xl font-bold tracking-widest text-elfia-rose/40">ELFIA</div>
        )}
        <div className="absolute top-2.5 right-2.5"><WishHeart id={p.id} /></div>
        {/* v1.41.0 — the flash pill outranks the plain Sale badge (it IS a
            sale, said louder and with a clock), but NOT "Sold out": nothing
            is more useful to a customer than knowing they cannot buy it, and
            two badges in one corner is how a card stops being readable.
            When the countdown reaches zero FlashPill renders nothing, and
            this falls back to the gold Sale badge on its own. */}
        {out ? (
          <span className="absolute top-3 left-3 rounded-full bg-white/95 px-2.5 py-1 text-[10px] font-bold tracking-wider text-elfia-body uppercase">
            Sold out
          </span>
        ) : flash ? (
          <span className="absolute top-3 left-3"><FlashPill p={p} compact /></span>
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

/* ---------- v1.44.0: skeleton primitives ----------
   The CEO, 31-08-2026: "I want no loading without skeleton loading react …
   audit all the files to ensure that no loading leak without skeleton
   loading react either in web or mobile view apps."

   The audit found the word "Loading…" in ten places, one spinner, and nine
   of the twelve pages that fetch on mount drawing nothing — or an empty
   state — until the data arrived. CardSkeleton above was the one house
   skeleton; these are the rest of the set, in the same style (animate-pulse,
   bg-elfia-blush/70), so every page can draw the SHAPE of what is coming
   rather than a sentence about waiting. tests/skeleton-loading.mjs keeps it
   that way. */

/** A caller's `rounded-xl` or `space-y-3` REPLACES the default rather than
    fighting it: Tailwind resolves two radius classes by stylesheet order, not
    by which one was written last. */
function withDefaults(defaults: string, className: string): string {
  const own = className.split(/\s+/).filter(Boolean);
  const keep = defaults.split(/\s+/).filter((d) => {
    const stem = d.replace(/-.*$/, "");
    return !own.some((c) => c === stem || c.startsWith(`${stem}-`));
  });
  return [...keep, ...own].join(" ");
}

/** One pulsing block. Size and shape come from the caller. */
export function Skel({ className = "" }: { className?: string }) {
  return <div className={withDefaults("animate-pulse rounded bg-elfia-blush/70", className)} aria-hidden />;
}

/** A paragraph's worth of lines, the last one shorter, the way text ends. */
export function SkelText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={withDefaults("space-y-2", className)} aria-hidden>
      {Array.from({ length: lines }).map((_, i) => (
        <Skel key={i} className={`h-3 ${i === lines - 1 && lines > 1 ? "w-2/3" : "w-full"}`} />
      ))}
    </div>
  );
}

/** List rows in the shape the order and account lists use: a thumbnail on
    the left, two lines of text, a status chip on the right. */
export function SkelRows({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <div className={withDefaults("space-y-2", className)} aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-2xl border border-elfia-line bg-white p-3">
          <Skel className="h-12 w-12 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <Skel className="h-3.5 w-2/5" />
            <Skel className="mt-2 h-3 w-1/4" />
          </div>
          <Skel className="h-6 w-16 shrink-0 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** A whole page, for Suspense fallbacks and auth checks. The outer <main>
    carries the padding every content page uses (cart, shop, product,
    wishlist, collections), so the real page lands on the same edges. */
export function PageSkeleton({ title = true, width = "max-w-5xl" }: { title?: boolean; width?: string }) {
  return (
    <main className="px-4 py-4 sm:px-6 sm:py-8" aria-busy="true">
      <div className={`mx-auto w-full ${width}`}>
        {title && (
          <>
            <Skel className="h-7 w-48 sm:h-8" />
            <Skel className="mt-2 h-3 w-24" />
          </>
        )}
        <SkelText lines={2} className="mt-6 max-w-md" />
        <SkelRows rows={3} className="mt-6" />
      </div>
    </main>
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
