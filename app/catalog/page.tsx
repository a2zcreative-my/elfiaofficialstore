"use client";

/**
 * /catalog — her PDF, embedded, priced LIVE (v1.18.0).
 *
 * The CEO asked for a catalog slug (v1.15.0) and I built it out of the PDF's
 * page images. That was wrong in a way she caught immediately:
 *
 *   "I need the catalog fetch the prices from it actual price in web/mobile.
 *    this is to make everything automatically without me need to regenerate
 *    the pdf which is difficult for me"
 *
 * She is right. A price printed into a JPEG can never update — so the moment
 * she ran a promotion, the catalog would be quoting last month's numbers at
 * customers, and the only fix would be re-exporting a PDF and re-cutting five
 * images. That is not automation, it is homework.
 *
 * So the catalog is no longer a picture of a document. It is the SAME DATA
 * every other page uses — `/api/v1/products` — laid out to look like the
 * printed lookbook: the cream ground, the circular photo tiles, the shade
 * name, the price. Every price here is the price the customer will be
 * charged, including a sale struck through, and it refreshes on the same
 * signal as the rest of the shop (useDataRefresh, v1.16.0).
 *
 * What this buys beyond correct prices: a new shade published in the portal
 * APPEARS IN THE CATALOG BY ITSELF. There is no step where anyone remembers
 * to update it, which is the only kind of "automatically" that survives a
 * busy week.
 *
 * v1.18.0 — and then she said, plainly: "I want my own PDF without create
 * any new catalog, I want PDF to be embedded with this website! I also want
 * to make sure this PDF able to fetch the actual prices of my Product!!!"
 *
 * Those three cannot all be true of a FILE, so the file is now BUILT ON
 * DEMAND: GET /api/v1/catalog.pdf draws a real PDF from the live database
 * every time anyone asks (worker/src/catalog-pdf.ts), using her cover
 * artwork for page one. It is embedded below.
 *
 * The embed is not the whole story, and pretending otherwise would ship a
 * blank rectangle to most of her customers: iOS Safari and Android Chrome do
 * not render a PDF inside a frame. So the frame is shown where the browser
 * can actually draw one, and the tiles below — the same products, the same
 * live prices — are what a phone gets, with the PDF one tap away. Nobody is
 * ever left looking at an empty box.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  STORE, collectionsOf, comparePrice, fmtRM, imageUrl, isSoldOut, splitName,
  type Product,
} from "@/lib/config";

import { Icon, useDataRefresh } from "../ui";

/** The cover of the printed catalog. It carries no prices, so it cannot go
    stale — the only page image this file still uses. */
const COVER = "/lookbook/page-1.jpg";
/** Built fresh on every request from the live prices — never a stored file. */
const PDF = "/api/v1/catalog.pdf";

/** One shade, drawn the way the printed lookbook draws it: a photo in a
    circle, the name, the price. The price is the live one. */
function Tile({ p }: { p: Product }) {
  const { shade } = splitName(p.name);
  const was = comparePrice(p);
  const sold = isSoldOut(p);
  return (
    <Link href={`/p?id=${p.id}`} className="group flex flex-col items-center text-center">
      <span className="relative block aspect-square w-full overflow-hidden rounded-full bg-elfia-blush ring-1 ring-elfia-line">
        {p.image_key ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl(p.image_key)} alt={shade}
            className="h-full w-full object-cover object-top transition-transform duration-300 group-hover:scale-105"
            loading="lazy" decoding="async" />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-[11px] text-elfia-muted">
            Photo coming
          </span>
        )}
        {sold && (
          <span className="absolute inset-x-0 bottom-0 bg-[#40292f]/75 py-1 text-[10px] font-semibold tracking-wider text-white uppercase">
            Sold out
          </span>
        )}
      </span>

      <span className="mt-2.5 block text-[13px] leading-snug font-semibold text-elfia-deep sm:text-sm">
        {shade}
      </span>
      {/* THE LIVE PRICE. This is the whole reason the page was rebuilt. */}
      <span className="mt-0.5 block text-xs text-elfia-body sm:text-[13px]">
        <span className={was ? "font-semibold text-elfia-deep" : ""}>{fmtRM(p.price_cents)}</span>
        {was && <s className="ml-1.5 text-elfia-muted">{fmtRM(was)}</s>}
      </span>
      {p.sku && (
        <span className="mt-0.5 block font-mono text-[10px] tracking-wider text-elfia-muted">{p.sku}</span>
      )}
    </Link>
  );
}

export default function Catalog() {
  const [products, setProducts] = useState<Product[] | null>(null);
  /* Same refresh signal as every other page: come back to the tab and the
     catalog is priced correctly, without a reload. */
  const refresh = useDataRefresh();

  useEffect(() => {
    void fetch("/api/v1/products")
      .then((r) => r.json())
      .then((j: { products: Product[] }) => setProducts(j.products))
      .catch(() => setProducts([]));
  }, [refresh]);

  const all = products ?? [];
  /* Grouped exactly the way the shop groups: the portal names the
     collections, so a collection she invents appears here on its own. */
  const groups = collectionsOf(all)
    .map((g) => ({ g, items: all.filter(g.match) }))
    .filter((x) => x.items.length > 0);

  return (
    <main className="bg-elfia-cream px-4 pt-6 pb-12 sm:px-6">
      <div className="mx-auto w-full max-w-4xl">
        {/* ---- cover ---- */}
        {/* Capped on a phone. The cover is a portrait page: at full height it
            is a whole screen of scrolling before a customer reaches a single
            shade, which is the opposite of what a catalog is for. The
            wordmark sits in the middle of the artwork, so cropping from the
            centre keeps it. */}
        <div className="overflow-hidden rounded-2xl ring-1 ring-elfia-line">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={COVER} alt="ELFIA Catalog"
            className="h-[42vh] w-full object-cover object-center sm:h-auto sm:max-h-[60vh]"
            loading="eager" />
        </div>

        <div className="mt-6 text-center">
          <p className="text-[11px] font-semibold tracking-[0.28em] text-elfia-rose uppercase">The lookbook</p>
          <h1 className="mt-2 text-3xl font-bold text-elfia-ink sm:text-4xl">ELFIA Catalog</h1>
          <p className="mt-1.5 text-sm font-medium tracking-wide text-elfia-deep italic">{STORE.tagline}</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-elfia-muted">
            Every shade we make, with today&apos;s prices — this page is priced
            from the shop itself, so what you see here is what you pay.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link href="/shop"
            className="inline-flex h-11 items-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper">
            Shop the collection
          </Link>
          <a href={PDF} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-elfia-line bg-white px-5 text-sm font-semibold text-elfia-deep transition-colors hover:border-elfia-rose">
            <Icon name="download" size={16} />
            Open the PDF
          </a>
        </div>
        <p className="mt-2.5 text-center text-[11px] text-elfia-muted">
          The PDF is built fresh each time you open it, so its prices are always today&apos;s.
        </p>

        {/* ---- the PDF itself ----
            Only where a browser will actually draw one. `lg:` rather than a
            user-agent sniff: the sizes that render PDFs inline are the sizes
            with a desktop browser behind them, and a media query cannot be
            wrong about what a browser IS the way a sniff can. A phone gets
            the tiles below instead — same products, same live prices — and
            the button above. */}
        <div className="mt-8 hidden lg:block">
          <object data={PDF} type="application/pdf"
            className="h-[80vh] w-full rounded-2xl ring-1 ring-elfia-line"
            aria-label="ELFIA Catalog">
            {/* Drawn only if the browser refuses the object — never instead
                of it, so this is not a second copy competing with the real
                one. */}
            <div className="flex h-full flex-col items-center justify-center gap-3 rounded-2xl bg-white p-6 text-center">
              <p className="text-sm text-elfia-body">
                Your browser will not show a PDF inside a page.
              </p>
              <a href={PDF} target="_blank" rel="noopener noreferrer"
                className="inline-flex h-11 items-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white">
                Open it in a new tab
              </a>
            </div>
          </object>
        </div>

        {/* ---- the shades, by collection ---- */}
        {products === null && (
          <p className="mt-12 text-center text-sm text-elfia-muted">Loading the collection…</p>
        )}

        {products !== null && groups.length === 0 && (
          <p className="mt-12 text-center text-sm text-elfia-muted">
            Nothing in the shop just now — check back after the next live.
          </p>
        )}

        {groups.map(({ g, items }) => (
          <section key={g.key} className="mt-12">
            {/* The printed catalog's section rule: wordmark, then a dashed
                line running to the edge. */}
            <div className="flex items-center gap-3">
              <h2 className="shrink-0 text-xl font-bold tracking-[0.12em] text-elfia-ink sm:text-2xl">
                {g.label}
              </h2>
              <span className="h-px flex-1 border-t border-dashed border-elfia-rose/60" />
              <span className="shrink-0 text-[11px] text-elfia-muted">
                {items.length} shade{items.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">
              {items.map((p) => <Tile key={p.id} p={p} />)}
            </div>

            <div className="mt-6 text-center">
              <Link href={`/shop?c=${g.key}`}
                className="text-xs font-semibold text-elfia-deep underline underline-offset-4">
                Shop all {g.label}
              </Link>
            </div>
          </section>
        ))}

        <div className="mt-14 rounded-2xl border border-elfia-line bg-white p-5 text-center">
          <p className="text-sm font-semibold text-elfia-ink">Seen something you like?</p>
          <p className="mt-1 text-xs leading-relaxed text-elfia-muted">
            Sizes, materials and what is in stock right now are on each
            product&apos;s own page. Delivery across Malaysia.
          </p>
          <Link href="/shop"
            className="mt-4 inline-flex h-11 items-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper">
            Go to the shop
          </Link>
        </div>
      </div>
    </main>
  );
}
