"use client";

/**
 * /catalog — the ELFIA lookbook (v1.15.0).
 *
 * The CEO, 26-08-2026: "Use this catalog and place it inside ELFIA which is a
 * new slug for Catalog so that customer has option to view the catalog."
 *
 * WHY PAGE IMAGES AND NOT THE PDF ITSELF: nearly every customer here is on a
 * phone, and iOS Safari does not render a PDF inside an `iframe` or `object`
 * — it shows a blank box, or offers a download and leaves the shop. Chrome on
 * Android is no better on a 5MB file over mobile data. So the pages are laid
 * out as ordinary images, which every browser draws, which lazy-load one at a
 * time instead of all five megabytes at once, and which can be tapped to
 * enlarge. The PDF is still there for anyone who actually wants the file —
 * that is a link, not the reading experience.
 *
 * The pages are built from the PDF the CEO supplied
 * (public/lookbook/elfia-catalog.pdf) and live beside it as page-1..5.jpg.
 * REGENERATING THEM after a new catalog:
 *   pdftoppm -jpeg -r 110 -jpegopt quality=82 public/lookbook/elfia-catalog.pdf /tmp/cat
 *   for i in 1 2 3 4 5; do convert /tmp/cat-$i.jpg -resize 1100x -quality 80 -strip public/lookbook/page-$i.jpg; done
 * then update PAGES below to match the new count.
 *
 * NOTHING on this page invents a price. The catalog is a picture of what the
 * studio printed; the shop's own pages carry the live price and stock, and
 * the buttons here send people there rather than restating a number that
 * could be a month old.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { STORE } from "@/lib/config";

import { Icon } from "../ui";

/* The assets live under /lookbook, NOT /catalog, deliberately: this page IS
   /catalog, and a static export that has both a `catalog.html` and a
   `catalog/` directory asks the host to guess which one `/catalog` means.
   The local rig guessed the directory and served a 404 for a page that was
   built perfectly. Different names, no guessing, on any host. */
/** How many page images sit in public/lookbook. Keep in step with the files. */
const PAGES = 5;
const PDF = "/lookbook/elfia-catalog.pdf";

export default function Catalog() {
  /* Tap a page to see it full-screen. Kept in this component rather than a
     library: it is one image and an overlay. */
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    window.addEventListener("keydown", onKey);
    /* The page behind must not scroll while the overlay is up — on a phone
       that reads as the overlay being broken. */
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <main className="px-4 pt-6 pb-12 sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <div className="text-center">
          <p className="text-[11px] font-semibold tracking-[0.28em] text-elfia-rose uppercase">The lookbook</p>
          <h1 className="mt-2 text-3xl font-bold text-elfia-ink sm:text-4xl">ELFIA Catalog</h1>
          <p className="mt-1.5 text-sm font-medium tracking-wide text-elfia-deep italic">{STORE.tagline}</p>
          <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-elfia-muted">
            Every shade, photographed. Sizes and materials are on the product
            pages — prices there are always the current ones.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap justify-center gap-2.5">
          <Link href="/shop"
            className="inline-flex h-11 items-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper">
            Shop the collection
          </Link>
          {/* An ordinary link, not a scripted download: it opens in the
              browser's own PDF viewer on a desktop and hands the file to the
              phone's, which is what someone asking for "the PDF" wants. */}
          <a href={PDF} target="_blank" rel="noopener noreferrer"
            className="inline-flex h-11 items-center gap-2 rounded-full border border-elfia-line bg-white px-5 text-sm font-semibold text-elfia-deep transition-colors hover:border-elfia-rose">
            <Icon name="download" size={16} />
            Download the PDF
          </a>
        </div>

        <div className="mt-8 space-y-4">
          {Array.from({ length: PAGES }, (_, i) => i + 1).map((n) => (
            <button key={n} type="button" onClick={() => setOpen(n)}
              aria-label={`Catalog page ${n} of ${PAGES} — tap to enlarge`}
              className="block w-full overflow-hidden rounded-2xl bg-elfia-blush ring-1 ring-elfia-line transition-shadow hover:shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={`/lookbook/page-${n}.jpg`} alt={`ELFIA catalog, page ${n}`}
                width={1100} height={1556}
                className="h-auto w-full"
                /* The first page is what someone sees on arrival; the rest
                   load as they scroll, so a phone on mobile data fetches one
                   page rather than the whole catalog. */
                loading={n === 1 ? "eager" : "lazy"}
                decoding="async" />
            </button>
          ))}
        </div>

        <div className="mt-10 rounded-2xl border border-elfia-line bg-white p-5 text-center">
          <p className="text-sm font-semibold text-elfia-ink">Seen something you like?</p>
          <p className="mt-1 text-xs leading-relaxed text-elfia-muted">
            The shop has live prices, what is in stock right now, and delivery
            across Malaysia.
          </p>
          <Link href="/shop"
            className="mt-4 inline-flex h-11 items-center rounded-full bg-elfia-deep px-6 text-sm font-semibold text-white transition-colors hover:bg-elfia-deeper">
            Go to the shop
          </Link>
        </div>
      </div>

      {/* ---- full-screen page ---- */}
      {open !== null && (
        <div role="dialog" aria-modal="true" aria-label={`Catalog page ${open}`}
          className="fixed inset-0 z-50 flex flex-col bg-[#40292f]/95 p-3 backdrop-blur-sm"
          onClick={() => setOpen(null)}>
          <div className="flex items-center justify-between px-1 pb-2 text-white">
            <span className="text-xs font-medium">Page {open} of {PAGES}</span>
            <button type="button" aria-label="Close" onClick={() => setOpen(null)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-white">
              <Icon name="close" size={18} />
            </button>
          </div>
          {/* The image scrolls inside the overlay rather than being squashed
              to fit: a catalog page is portrait and full of small type. */}
          <div className="min-h-0 flex-1 overflow-auto rounded-xl" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/lookbook/page-${open}.jpg`} alt={`ELFIA catalog, page ${open}`}
              className="mx-auto h-auto w-full max-w-2xl rounded-xl" />
          </div>
          <div className="flex items-center justify-center gap-2 pt-2.5">
            <button type="button" disabled={open <= 1}
              onClick={(e) => { e.stopPropagation(); setOpen((n) => (n && n > 1 ? n - 1 : n)); }}
              className="inline-flex h-10 items-center rounded-full bg-white/15 px-5 text-xs font-semibold text-white disabled:opacity-35">
              Previous
            </button>
            <button type="button" disabled={open >= PAGES}
              onClick={(e) => { e.stopPropagation(); setOpen((n) => (n && n < PAGES ? n + 1 : n)); }}
              className="inline-flex h-10 items-center rounded-full bg-white/15 px-5 text-xs font-semibold text-white disabled:opacity-35">
              Next
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
