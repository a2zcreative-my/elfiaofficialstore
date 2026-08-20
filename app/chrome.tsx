"use client";

/**
 * Site chrome — the header, mobile menu and floating WhatsApp button.
 *
 * v0.6.0. The old header put the wordmark, both links and the Cart button on
 * a single row, which fought itself to pieces at phone width (CEO, from her
 * phone: "the navbar there seem like doesnt same like A2Z"). Now:
 *   phone   — hamburger, centred wordmark, cart icon with a live count badge,
 *             and a slide-down menu.
 *   desktop — wordmark left, links centre, cart button right.
 *
 * This is a CLIENT component because the badge reads localStorage and the
 * WhatsApp number comes from GET /api/v1/store-config (the Worker owns every
 * money/contact fact — see lib/config.ts). The layout stays a server
 * component and just renders <SiteHeader /> and <WhatsAppButton />.
 */
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { CART_EVENT, NAV_LINKS, cartCount, fmtRM, waLink, type StoreConfig } from "@/lib/config";

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

function CartIcon({ count }: { count: number }) {
  return (
    <span className="relative inline-flex">
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18" />
        <path d="M16 10a4 4 0 0 1-8 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#7a2648] px-1 text-[10px] font-bold text-white">
          {count > 99 ? "99+" : count}
        </span>
      )}
    </span>
  );
}

export function SiteHeader() {
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const path = usePathname();
  const config = useStoreConfig();

  /* The badge tracks the cart in this tab (CART_EVENT) and in others
     (storage), so it never shows a stale number. */
  useEffect(() => {
    const sync = () => setCount(cartCount());
    sync();
    window.addEventListener(CART_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { window.removeEventListener(CART_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  useEffect(() => { setOpen(false); }, [path]); // a tapped link closes the menu

  const active = (href: string) => (href === "/" ? path === "/" : path.startsWith(href));

  return (
    <header className="sticky top-0 z-40">
      {/* Announcement bar — the free-delivery threshold is the Worker's fact,
          so the bar only claims a number once the config has arrived. */}
      <div className="bg-[#7a2648] px-4 py-1.5 text-center text-[11px] font-medium tracking-wide text-white/90">
        {config && config.free_above_cents > 0
          ? <>Free delivery on orders above {fmtRM(config.free_above_cents)} · Ships across Malaysia</>
          : <>Order direct from ELFIA · Ships across Malaysia</>}
      </div>

      <div className="border-b border-stone-200/80 bg-white/90 backdrop-blur">
        <div className="relative mx-auto flex h-16 w-full max-w-5xl items-center px-4 sm:px-6">
          {/* phone: menu button */}
          <button type="button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open}
            className="-ml-2 flex h-10 w-10 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 sm:hidden"
            onClick={() => setOpen((o) => !o)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              {open ? <><path d="M5 5l14 14" /><path d="M19 5 5 19" /></> : <><path d="M3 6h18" /><path d="M3 12h18" /><path d="M3 18h18" /></>}
            </svg>
          </button>

          {/* wordmark — centred on phones, left on desktop */}
          <Link href="/" className="absolute left-1/2 -translate-x-1/2 sm:static sm:translate-x-0 sm:mr-8 flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="h-6 w-auto sm:h-7" />
            <span className="mt-0.5 hidden text-[9px] font-semibold tracking-[0.3em] text-stone-400 uppercase lg:block">Official Store</span>
          </Link>

          <nav className="ml-auto hidden items-center gap-7 text-sm sm:flex">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href}
                className={`transition-colors ${active(l.href) ? "font-semibold text-[#7a2648]" : "text-stone-600 hover:text-[#7a2648]"}`}>
                {l.label}
              </Link>
            ))}
            <Link href="/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
              className="inline-flex h-10 items-center gap-2.5 rounded-full bg-[#7a2648] pl-4 pr-5 text-sm font-semibold text-white transition-colors hover:bg-[#8f2e55]">
              <CartIcon count={0} />
              Cart{count > 0 && <span className="tabular-nums">({count})</span>}
            </Link>
          </nav>

          {/* phone: cart icon */}
          <Link href="/cart" aria-label={`Cart, ${count} item${count === 1 ? "" : "s"}`}
            className="-mr-2 ml-auto flex h-10 w-10 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 sm:hidden">
            <CartIcon count={count} />
          </Link>
        </div>

        {/* phone: the menu itself */}
        {open && (
          <nav className="border-t border-stone-200 bg-white px-4 py-2 sm:hidden">
            {NAV_LINKS.map((l) => (
              <Link key={l.href} href={l.href}
                className={`block rounded-xl px-3 py-3 text-[15px] ${active(l.href) ? "bg-[#7a2648]/5 font-semibold text-[#7a2648]" : "text-stone-700"}`}>
                {l.label}
              </Link>
            ))}
            <Link href="/cart" className="block rounded-xl px-3 py-3 text-[15px] text-stone-700">
              Cart{count > 0 && <span className="ml-1 font-semibold text-[#7a2648]">({count})</span>}
            </Link>
          </nav>
        )}
      </div>
    </header>
  );
}

/**
 * Back-to-top button (v0.7.0, CEO: "I want to have a scroll up button same as
 * A2Z"). Appears after a screen and a half of scrolling and sits above the
 * WhatsApp bubble so the two never overlap.
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
      className={`fixed right-4 bottom-22 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-stone-200 bg-white text-[#7a2648] shadow-lg shadow-black/10 transition-all duration-200 hover:bg-stone-50 sm:right-6 sm:bottom-24 ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"}`}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
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
      className="fixed right-4 bottom-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg shadow-black/20 transition-transform hover:scale-105 sm:right-6 sm:bottom-6">
      <svg width="26" height="26" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">
        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.46 1.32 4.96L2 22l5.25-1.38a9.9 9.9 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15h-.01a8.23 8.23 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.19 8.19 0 0 1-1.26-4.38c0-4.54 3.7-8.23 8.25-8.23a8.2 8.2 0 0 1 8.24 8.24c0 4.54-3.7 8.23-8.24 8.23Zm4.52-6.16c-.25-.12-1.47-.72-1.69-.81-.23-.08-.39-.12-.56.13-.16.24-.64.8-.79.97-.14.16-.29.18-.54.06-.25-.13-1.05-.39-1.99-1.23-.74-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.5.11-.11.25-.29.37-.43.13-.15.17-.25.25-.41.08-.17.04-.31-.02-.43-.06-.12-.56-1.34-.76-1.84-.2-.48-.4-.42-.56-.43h-.47c-.17 0-.43.06-.66.31-.22.25-.87.85-.87 2.07s.89 2.4 1.02 2.56c.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.59.19 1.13.16 1.56.1.47-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.11-.22-.17-.47-.29Z" />
      </svg>
    </a>
  );
}
