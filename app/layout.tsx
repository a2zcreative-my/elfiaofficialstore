import type { Metadata } from "next";
import Link from "next/link";

import { STORE } from "@/lib/config";

import { ScrollTopButton, SiteHeader, WhatsAppButton } from "./chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELFIA OFFICIAL STORE — premium bawal, direct from ELFIA",
  description: "Shop the ELFIA bawal collection directly. Lightweight, opaque, made to last — delivered across Malaysia.",
  metadataBase: new URL(STORE.url),
  openGraph: {
    title: "ELFIA OFFICIAL STORE",
    description: "The ELFIA bawal collection — delivered across Malaysia.",
    url: STORE.url,
    siteName: STORE.name,
    images: ["/collection/campaign-studio.jpg"],
    locale: "en_MY",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#faf7f5] text-stone-900 antialiased">
        <SiteHeader />
        {children}
        <WhatsAppButton />
        <ScrollTopButton />
        {/* v1.2.0 — anonymous visit beacon for the ELFIA Traffic map.
            Sends ONLY the page path and the referrer; location is derived
            server-side from the network, and no cookie or ID is ever placed
            in the browser. text/plain keeps sendBeacon preflight-free, and a
            failed beacon fails silently — the shop never waits on it. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              `(function(){var t=0;var s=function(){var p=location.pathname+location.search;if(p===t)return;t=p;try{navigator.sendBeacon&&navigator.sendBeacon("/api/v1/t",new Blob([JSON.stringify({p:p,r:document.referrer||""})],{type:"text/plain"}))}catch(e){}};s();var w=history.pushState;history.pushState=function(){w.apply(this,arguments);setTimeout(s,0)};window.addEventListener("popstate",function(){setTimeout(s,0)})})();`,
          }}
        />
        <footer className="mt-24 border-t border-stone-200 bg-white px-6 py-12">
          <div className="mx-auto w-full max-w-5xl text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="ELFIA" className="mx-auto h-6 w-auto" />
            <p className="mt-3 text-xs tracking-wide text-stone-500">
              {STORE.tagline} · Ships across Malaysia
            </p>
            <div className="mt-5 flex items-center justify-center gap-5 text-xs text-stone-500">
              <Link href="/" className="hover:text-[#7a2648]">Shop</Link>
              <span className="text-stone-300">·</span>
              <Link href="/track" className="hover:text-[#7a2648]">Track order</Link>
              <span className="text-stone-300">·</span>
              <Link href="/policies" className="hover:text-[#7a2648]">Delivery &amp; returns</Link>
              <span className="text-stone-300">·</span>
              <Link href="/policies#privacy" className="hover:text-[#7a2648]">Privacy</Link>
              <span className="text-stone-300">·</span>
              <Link href="/cart" className="hover:text-[#7a2648]">Cart</Link>
            </div>
            <p className="mt-6 text-[11px] text-stone-400">
              © {new Date().getFullYear()} ELFIA OFFICIAL STORE
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
