import type { Metadata } from "next";
import Link from "next/link";

import { STORE } from "@/lib/config";

import "./globals.css";

export const metadata: Metadata = {
  title: "ELFIA OFFICIAL STORE",
  description: "Shop ELFIA directly — modest wear, delivered across Malaysia.",
  metadataBase: new URL(STORE.url),
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#faf7f5] text-stone-900 antialiased">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-6">
            <Link href="/" className="flex items-center gap-2.5">
              {/* the CEO's ELFIA wordmark (v0.4.0) — served from /public, no
                  network dependency. eslint-disable: static export has no
                  next/image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo.png" alt="ELFIA" className="h-7 w-auto" />
              <span className="mt-0.5 hidden text-[9px] font-semibold tracking-[0.3em] text-stone-400 uppercase sm:block">Official Store</span>
            </Link>
            <nav className="flex items-center gap-5 text-sm">
              <Link href="/" className="text-stone-600 hover:text-[#7a2648]">Shop</Link>
              <Link href="/policies" className="text-stone-600 hover:text-[#7a2648]">Delivery &amp; returns</Link>
              <Link href="/cart" className="rounded-lg bg-[#7a2648] px-4 py-2 font-semibold text-white hover:bg-[#8f2e55]">
                Cart
              </Link>
            </nav>
          </div>
        </header>
        {children}
        <footer className="mt-20 border-t border-stone-200 bg-white px-6 py-10">
          <div className="mx-auto w-full max-w-5xl text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="mx-auto h-6 w-auto" />
            <p className="mt-2 text-xs text-stone-500">
              {STORE.tagline} · Ships across Malaysia
            </p>
            <p className="mt-4 text-[11px] text-stone-400">
              © {new Date().getFullYear()} ELFIA OFFICIAL STORE ·{" "}
              <Link href="/policies" className="underline">Refund &amp; delivery policy</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
