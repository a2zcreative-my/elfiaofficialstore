import type { Metadata, Viewport } from "next";

import { STORE } from "@/lib/config";

import { BottomTabBar, ScrollTopButton, SiteFooter, SiteHeader, WhatsAppButton } from "./chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "ELFIA OFFICIAL STORE — premium bawal, direct from ELFIA",
  description: "First Sight, Forever Yours — shop the ELFIA bawal collection directly, delivered across Malaysia.",
  metadataBase: new URL(STORE.url),
  /* v1.4.0 — on a phone the store is meant to be kept on the home screen, so
     it declares itself app-capable. This is a bookmark that opens without the
     browser bar, not an app-store app. */
  appleWebApp: { capable: true, title: "ELFIA", statusBarStyle: "default" },
  openGraph: {
    title: "ELFIA OFFICIAL STORE",
    description: "First Sight, Forever Yours — the ELFIA bawal collection, delivered across Malaysia.",
    url: STORE.url,
    siteName: STORE.name,
    images: ["/collection/campaign-studio.jpg"],
    locale: "en_MY",
    type: "website",
  },
};

/* The tab bar sits on the phone's bottom edge, so the page must own the whole
   viewport width and never zoom on an input focus. */
export const viewport: Viewport = {
  themeColor: "#7a2648",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-elfia-cream text-elfia-ink antialiased">
        <SiteHeader />
        {/* Every screen ends above the phone tab bar; on desktop there is no
            tab bar and the padding collapses.

            v1.13.0 — the footer moved INSIDE this wrapper. It used to sit
            after it, which was harmless while the footer was desktop-only
            (no tab bar there to clear). The CEO asked for a footer on the
            phone too, and outside the wrapper its last line would have been
            drawn underneath the tab bar — the exact fault v1.4.1 fixed for
            page content. */}
        <div className="pb-tabbar lg:pb-0">
          {children}
          <SiteFooter />
        </div>
        <WhatsAppButton />
        <ScrollTopButton />
        <BottomTabBar />
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
      </body>
    </html>
  );
}
