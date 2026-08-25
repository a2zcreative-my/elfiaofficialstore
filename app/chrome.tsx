"use client";

/**
 * Site chrome — v1.4.0.
 *
 * The CEO showed an app layout and asked for the store to look like it on a
 * phone while staying a proper web shop on a desktop. So the chrome now has
 * two faces of ONE storefront:
 *
 *   phone   — a compact app bar (wordmark, search, cart) and a fixed bottom
 *             tab bar: Home · Shop · Collections · Wishlist · Profile.
 *   desktop — the familiar web header: wordmark left, links centre, search +
 *             wishlist + cart right. No tab bar, and the footer comes back.
 *
 * Both are the same routes and the same data. Nothing here is a second app.
 *
 * CLIENT component: the badges read localStorage and the WhatsApp number comes
 * from GET /api/v1/store-config (the Worker owns every money/contact fact —
 * see lib/config.ts). The layout stays a server component.
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CART_EVENT, NAV_LINKS, STORE, TABS, cartCount, fmtRM, waLink, type StoreConfig } from "@/lib/config";

import { Icon, useWishlist, type IconName } from "./ui";

/** One fetch of the store config, shared by the header and the bubble. */
function useStoreConfig(): StoreConfig | null {
  const [config, setConfig] = useState<StoreConfig | null>(null);
  useEffect(() => {
    void fetch("/api/v1/store-config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: StoreConfig | null) => setConfig(j))
      .catch(() => null);
  }, []);
  return config;
}

/** The cart count, live in this tab and in others. */
function useCartCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const sync = () => setCount(cartCount());
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CART_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  return count;
}

function Badge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="absolute -top-1 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-elfia-deep px-1 text-[10px] font-bold text-white">
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** The search box. Submitting lands on /shop?q=…, which is where searching
    actually happens — the header never filters a page it is not on. */
function SearchBox({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); router.push(q.trim() ? `/shop?q=${encodeURIComponent(q.trim())}` : "/shop"); }}
      className={`flex items-center gap-2 rounded-full bg-elfia-veil px-3.5 ${compact ? "h-10 flex-1" : "h-10 w-56"}`}>
      <Icon name="search" size={16} className="shrink-0 text-elfia-muted" />
      <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the shop"
        placeholder="Search tudung bawal…"
        className="min-w-0 flex-1 bg-transparent text-sm text-elfia-ink outline-none placeholder:text-elfia-muted/80" />
    </form>
  );
}

export function SiteHeader() {
  const count = useCartCount();
  const wishes = useWishlist();
  const path = usePathname();
  const config = useStoreConfig();

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40">
      {/* Announcement bar — the free-delivery threshold is the Worker's fact,
          so the bar only claims a number once the config has arrived. */}
      <div className="bg-elfia-deep px-4 py-1.5 text-center text-[11px] font-medium tracking-wide text-white/90">
        {config && config.free_above_cents > 0
          ? <>Free delivery above {fmtRM(config.free_above_cents)} · Ships across Malaysia</>
          : <>Order direct from ELFIA · Ships across Malaysia</>}
      </div>

      <div className="border-b border-elfia-line bg-elfia-cream/95 backdrop-blur">
        {/* ---- phone: wordmark · search · cart ---- */}
        <div className="flex h-14 items-center gap-2.5 px-4 sm:hidden">
          <Link href="/" aria-label="ELFIA home" className="shrink-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="h-5 w-auto" />
          </Link>
          <SearchBox compact />
          <Link href="/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
            className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-elfia-ink">
            <Icon name="cart" size={21} />
            <Badge n={count} />
          </Link>
        </div>

        {/* ---- desktop: the web shop ---- */}
        <div className="mx-auto hidden h-16 w-full max-w-6xl items-center gap-8 px-6 sm:flex">
          <Link href="/" className="flex shrink-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="h-7 w-auto" />
            <span className="mt-0.5 hidden text-[9px] font-semibold tracking-[0.3em] text-elfia-muted uppercase lg:block">
              Official Store
            </span>
          </Link>

          <nav className="flex items-center gap-7 text-sm whitespace-nowrap">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href}
                className={`transition-colors ${active(l.href) ? "font-semibold text-elfia-deep" : "text-elfia-body hover:text-elfia-deep"}`}>
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <SearchBox />
            <Link href="/wishlist" aria-label={`Wishlist, ${wishes.length} saved`}
              className="relative flex h-10 w-10 items-center justify-center rounded-full text-elfia-ink hover:bg-elfia-veil">
              <Icon name="heart" size={20} />
              <Badge n={wishes.length} />
            </Link>
            <Link href="/account" aria-label="Your account"
              className="flex h-10 w-10 items-center justify-center rounded-full text-elfia-ink hover:bg-elfia-veil">
              <Icon name="user" size={20} />
            </Link>
            <Link href="/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
              className="relative inline-flex h-10 items-center gap-2 rounded-full bg-elfia-deep pr-5 pl-4 text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper">
              <Icon name="cart" size={18} />
              Cart{count > 0 && <span className="tabular-nums">({count})</span>}
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}

/**
 * The phone tab bar. Five destinations, always in the same order, the active
 * one in deep rose — this is what makes the site read as an app rather than a
 * web page on a small screen. Hidden from tablets up, where the header nav
 * already does this job.
 */
export function BottomTabBar() {
  const path = usePathname();
  const wishes = useWishlist();
  const ICONS: Record<string, IconName> = {
    home: "home", shop: "bag", categories: "grid", wishlist: "heart", account: "user",
  };
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 border-t border-elfia-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden">
      <div className="flex">
        {TABS.map((t) => {
          const on = isActive(t.href);
          return (
            <Link key={t.key} href={t.href} aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 ${on ? "text-elfia-deep" : "text-elfia-muted"}`}>
              <span className="relative">
                <Icon name={ICONS[t.key] ?? "home"} size={21} strokeWidth={on ? 2 : 1.6} />
                {t.key === "wishlist" && <Badge n={wishes.length} />}
              </span>
              <span className={`text-[10px] ${on ? "font-semibold" : ""}`}>{t.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

/**
 * Back-to-top (v0.7.0, asked for by the CEO after seeing the live site).
 * Sits above the WhatsApp bubble, and above the tab bar on a phone.
 */
export function ScrollTopButton() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return (
    <button type="button" aria-label="Back to top" aria-hidden={!show} tabIndex={show ? 0 : -1}
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      className={`bottom-tabbar fixed right-4 z-30 flex h-11 w-11 items-center justify-center rounded-full border border-elfia-line bg-white text-elfia-deep shadow-lg shadow-elfia-deep/10 transition-all duration-200 hover:bg-elfia-veil sm:right-6 sm:bottom-24 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 19V5" /><path d="m5 12 7-7 7 7" />
      </svg>
    </button>
  );
}

/** The floating WhatsApp bubble. Hidden until a real number is configured —
    a bubble that opens a chat with 60000000000 is worse than no bubble. */
export function WhatsAppButton() {
  const config = useStoreConfig();
  const digits = config?.whatsapp_digits ?? "";
  if (!digits || digits === "60000000000" || digits.replace(/\D/g, "").length < 9) return null;
  return (
    <a href={waLink(digits, "Hi ELFIA! I have a question about an order.")}
      target="_blank" rel="noopener noreferrer" aria-label="Chat with ELFIA on WhatsApp"
      className="bottom-tabbar fixed right-4 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg shadow-black/20 transition-transform hover:scale-105 sm:right-6 sm:bottom-6">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07s.89 2.4 1.02 2.56c.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
    </a>
  );
}

/** The footer belongs to the web view. On a phone the tab bar is the
    navigation and a long link list at the bottom is just noise, so it only
    appears from `sm` up. */
export function SiteFooter() {
  return (
    <footer className="mt-20 hidden border-t border-elfia-line bg-white px-6 py-12 sm:block">
      <div className="mx-auto w-full max-w-6xl">
        <div className="grid gap-8 sm:grid-cols-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="h-6 w-auto" />
            <p className="mt-3 max-w-xs text-xs leading-relaxed text-elfia-muted">
              {STORE.tagline} Premium bawal, ordered direct and delivered across Malaysia.
            </p>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-elfia-ink uppercase">Shop</p>
            <div className="mt-3 flex flex-col gap-2 text-sm text-elfia-body">
              <Link href="/shop" className="hover:text-elfia-deep">All products</Link>
              <Link href="/categories" className="hover:text-elfia-deep">Collections</Link>
              <Link href="/wishlist" className="hover:text-elfia-deep">Wishlist</Link>
              <Link href="/cart" className="hover:text-elfia-deep">Cart</Link>
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold tracking-[0.18em] text-elfia-ink uppercase">Help</p>
            <div className="mt-3 flex flex-col gap-2 text-sm text-elfia-body">
              <Link href="/track" className="hover:text-elfia-deep">Track my order</Link>
              <Link href="/account" className="hover:text-elfia-deep">My account</Link>
              <Link href="/policies" className="hover:text-elfia-deep">Delivery &amp; returns</Link>
              <Link href="/policies#privacy" className="hover:text-elfia-deep">Privacy</Link>
            </div>
          </div>
        </div>
        <p className="mt-10 border-t border-elfia-line pt-6 text-center text-[11px] text-elfia-muted">
          © {new Date().getFullYear()} {STORE.name}
        </p>
      </div>
    </footer>
  );
}
