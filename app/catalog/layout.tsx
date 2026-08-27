import type { Metadata } from "next";

import { STORE } from "@/lib/config";

/**
 * Share preview for /catalog (v1.20.0).
 *
 * The CEO: "thumbnail must correctly fetch the page cover photo of the PDF."
 * When someone shares elfiaofficialstore.my/catalog on WhatsApp or social,
 * the card must show the catalog's own cover — not the generic campaign
 * photo the rest of the site previews with.
 *
 * A LAYOUT, not the page, carries this: the page is a client component (it
 * fetches live prices), and Next only reads `metadata` from server files.
 * The static export bakes these tags into catalog.html, which is what
 * WhatsApp's crawler reads — it runs no JavaScript.
 *
 * The image URL is the stable cover route rather than the file, so when the
 * portal gains catalog upload (v1.21.0) a new cover changes the preview with
 * no rebuild of this site.
 */
export const metadata: Metadata = {
  title: "ELFIA Catalog — every shade, with today's prices",
  description:
    "The ELFIA lookbook, priced live from the shop. First Sight, Forever Yours — delivered across Malaysia.",
  openGraph: {
    title: "ELFIA Catalog",
    description: "Every shade we make, with today's prices. First Sight, Forever Yours.",
    url: `${STORE.url}/catalog`,
    siteName: STORE.name,
    images: [{ url: `${STORE.url}/api/v1/catalog-cover`, width: 1100, height: 1556 }],
    locale: "en_MY",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ELFIA Catalog",
    description: "Every shade we make, with today's prices.",
    images: [`${STORE.url}/api/v1/catalog-cover`],
  },
};

export default function CatalogLayout({ children }: { children: React.ReactNode }) {
  return children;
}
