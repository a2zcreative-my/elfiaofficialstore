/**
 * HER catalog PDF, with the prices swapped for live ones (v1.19.0).
 *
 * v1.18.0 answered "I want my PDF with live prices" by DRAWING new pages in
 * her style. She corrected it within the hour: "I want to use this Catalog
 * without create any new. I want to make the price live fetch instead of
 * static! do implementation as require without introduce any new!"
 *
 * So nothing is drawn any more. This loads the designer's own file —
 * public/lookbook/elfia-catalog.pdf, byte for byte the PDF she supplied —
 * and PATCHES it: at each place her designer printed a price, the printed
 * number is covered with a swatch of the surrounding colour and the live
 * price is set in the same spot. Every other ink on every page is hers,
 * untouched. Her photos, her layout, her typography, her cover.
 *
 * HOW THE PATCH SITES ARE KNOWN
 * Her PDF's text is real text (WinAnsi-encoded subsets — pdffonts), so every
 * price has exact coordinates. PRICE_SITES below was extracted from her file
 * with `pdftotext -bbox`, and the cover colours were sampled from a 144dpi
 * render of the same file: cream rgb(251,246,240) on the grid pages, the
 * dusty-rose pill rgb(201,170,185)/(208,178,190) on the two Product Detail
 * pages. The patch is invisible because the colours are hers, measured, not
 * chosen.
 *
 * If she ships a NEW catalog file, PRICE_SITES must be re-extracted — the
 * recipe is in scratch/catalog-pdf-check.mjs. A guard there fails if the
 * stored PDF's text no longer matches this map, so a swapped file cannot
 * silently put prices in the wrong places.
 *
 * HOW A PRICE FINDS ITS PRODUCT
 * By the label her designer printed next to it ("Bawal lumi Aurora", "Shawl
 * Chiffon Dark Brown"), matched against live product names: a product whose
 * distinctive words all appear in the label takes the site. Ambiguity or no
 * match = the printed price stands — a wrong price in her catalog is worse
 * than an old one, so the matcher never guesses.
 *
 * KNOWN LIMIT, stated rather than hidden: covering ink does not delete the
 * text object underneath, so select-all-and-copy in a PDF viewer can still
 * surface the printed number. What every reader SEES is the live price; the
 * date stamp on each patched page says when it was true.
 */
import { PDFDocument, PDFFont, StandardFonts, rgb } from "pdf-lib";

export interface CatalogProduct {
  id: number;
  name: string;
  price_cents: number;
  compare_price_cents?: number | null;
  sku?: string | null;
}

/* ---- where her designer printed each price ----
   Coordinates are pdftotext's: origin top-left, units = PDF points, page
   size 595.276 x 841.890 (A4). `page` is zero-based. `style` decides the
   cover colour and ink: grid = dark maroon on cream, pill = white on rose. */
interface PriceSite {
  page: number;
  label: string;
  x0: number; y0: number; x1: number; y1: number;
  style: "grid" | "pill";
}

export const PRICE_SITES: PriceSite[] = [
  /* page 2 — Product Detail: Bawal lumi Mahogany, the rose pill */
  { page: 1, label: "Bawal lumi Mahogany", x0: 29.5, y0: 621.4, x1: 130.8, y1: 652.5, style: "pill" },
  /* page 3 — the bawal grid */
  { page: 2, label: "Bawal lumi Mahogany", x0: 286.9, y0: 238.4, x1: 323.2, y1: 246.5, style: "grid" },
  { page: 2, label: "Bawal lumi Sky", x0: 94.0, y0: 430.2, x1: 130.3, y1: 438.3, style: "grid" },
  { page: 2, label: "Bawal lumi Lilac", x0: 284.1, y0: 430.4, x1: 320.4, y1: 438.4, style: "grid" },
  { page: 2, label: "Bawal lumi Celando", x0: 483.8, y0: 430.5, x1: 520.1, y1: 438.6, style: "grid" },
  { page: 2, label: "Bawal lumi Blush", x0: 89.1, y0: 624.1, x1: 125.4, y1: 632.2, style: "grid" },
  { page: 2, label: "Bawal lumi Dusty Olive", x0: 287.6, y0: 624.2, x1: 323.9, y1: 632.3, style: "grid" },
  { page: 2, label: "Bawal lumi Champainge Sand", x0: 484.2, y0: 624.1, x1: 520.5, y1: 632.2, style: "grid" },
  { page: 2, label: "Bawal lumi Luxe", x0: 87.6, y0: 824.5, x1: 123.9, y1: 832.6, style: "grid" },
  { page: 2, label: "Bawal lumi Aurora", x0: 288.0, y0: 824.6, x1: 324.3, y1: 832.7, style: "grid" },
  { page: 2, label: "Bawal lumi Midnight", x0: 485.7, y0: 824.5, x1: 522.0, y1: 832.6, style: "grid" },
  /* page 4 — Product Detail: Shawl Chiffon Soft Pink, the rose pill */
  { page: 3, label: "Shawl Chiffon Soft Pink", x0: 41.0, y0: 628.7, x1: 142.2, y1: 659.8, style: "pill" },
  /* page 5 — the shawl grid */
  { page: 4, label: "Shawl Chiffon Soft Pink", x0: 83.1, y0: 242.1, x1: 118.3, y1: 250.2, style: "grid" },
  { page: 4, label: "Shawl Chiffon Emerald Green", x0: 291.6, y0: 242.1, x1: 326.8, y1: 250.2, style: "grid" },
  { page: 4, label: "Shawl Chiffon Dark Brown", x0: 483.4, y0: 242.1, x1: 518.6, y1: 250.2, style: "grid" },
  { page: 4, label: "Shawl Chiffon Maroon", x0: 85.7, y0: 432.3, x1: 120.9, y1: 440.4, style: "grid" },
  { page: 4, label: "Shawl Chiffon Khaki", x0: 286.6, y0: 432.3, x1: 321.8, y1: 440.4, style: "grid" },
  { page: 4, label: "Shawl Chiffon Ash Blue", x0: 488.0, y0: 432.4, x1: 523.2, y1: 440.5, style: "grid" },
  { page: 4, label: "Shawl Chiffon Lime Solero", x0: 86.1, y0: 626.2, x1: 121.3, y1: 634.3, style: "grid" },
  { page: 4, label: "Shawl Chiffon Silver", x0: 295.6, y0: 626.3, x1: 330.8, y1: 634.4, style: "grid" },
  { page: 4, label: "Shawl Chiffon Mocha", x0: 483.6, y0: 626.2, x1: 518.8, y1: 634.3, style: "grid" },
  { page: 4, label: "Shawl Chiffon Champange", x0: 85.8, y0: 823.4, x1: 121.0, y1: 831.5, style: "grid" },
  { page: 4, label: "Shawl Chiffon Black", x0: 297.6, y0: 823.5, x1: 332.8, y1: 831.6, style: "grid" },
  { page: 4, label: "Shawl Chiffon Dark Purple", x0: 484.0, y0: 823.6, x1: 519.2, y1: 831.7, style: "grid" },
];

/* ---- her colours, sampled from her file ---- */
const CREAM = rgb(251 / 255, 246 / 255, 240 / 255);
const PILL_P2 = rgb(201 / 255, 170 / 255, 185 / 255);
const PILL_P4 = rgb(208 / 255, 178 / 255, 190 / 255);
const GRID_INK = rgb(78 / 255, 30 / 255, 43 / 255);
const WHITE = rgb(1, 1, 1);
const MUTED = rgb(150 / 255, 128 / 255, 134 / 255);

const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;

/* ---- matching a printed label to a live product ----
   Words that appear in nearly every label or product name carry no signal;
   what identifies a product is its shade. A product matches a label when
   every one of its distinctive words appears in the label. */
const GENERIC = new Set(["bawal", "shawl", "chiffon", "lumi", "premium", "by", "elfia"]);
const tokens = (s: string): string[] =>
  s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);

export function matchProduct(label: string, products: CatalogProduct[]): CatalogProduct | null {
  const labelSet = new Set(tokens(label));
  let best: CatalogProduct | null = null;
  let bestScore = 0;
  let tied = false;
  for (const p of products) {
    const distinctive = tokens(p.name).filter((t) => !GENERIC.has(t));
    if (distinctive.length === 0) continue;
    if (!distinctive.every((t) => labelSet.has(t))) continue;
    if (distinctive.length > bestScore) { best = p; bestScore = distinctive.length; tied = false; }
    else if (distinctive.length === bestScore) tied = best !== null && best.id !== p.id;
  }
  /* Two different products both claiming the site = nobody gets it. A wrong
     price in her catalog is worse than an old one. */
  return tied ? null : best;
}

export interface PatchOptions {
  /** Where the website lives — her PDF is fetched from /lookbook there. */
  origin: string;
  generatedAt?: Date;
}

export interface PatchResult {
  bytes: Uint8Array;
  patched: string[];
  /** Labels left at their printed price, with why — surfaced, never silent. */
  unmatched: { label: string; why: string }[];
}

export async function patchCatalogPdf(
  products: CatalogProduct[], opts: PatchOptions,
): Promise<PatchResult> {
  const src = await fetch(`${opts.origin}/lookbook/elfia-catalog.pdf`);
  if (!src.ok) throw new Error(`her catalog file answered ${src.status}`);
  const doc = await PDFDocument.load(await src.arrayBuffer());
  /* Two faces, because her designer used two: the grid prices are a serif
     (they sit under serif names), the pill prices a clean sans. Times and
     Helvetica are the closest standard faces — the cover hides her ink, so
     what is judged is proportion, and these were checked against a render
     of her own page side by side. */
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const pages = doc.getPages();

  const patched: string[] = [];
  const unmatched: { label: string; why: string }[] = [];
  const touchedPages = new Set<number>();

  for (const site of PRICE_SITES) {
    const page = pages[site.page];
    if (!page) { unmatched.push({ label: site.label, why: "page missing" }); continue; }
    const product = matchProduct(site.label, products);
    if (!product) { unmatched.push({ label: site.label, why: "no live product matches" }); continue; }

    const H = page.getHeight();
    const origW = site.x1 - site.x0;
    const cx = (site.x0 + site.x1) / 2;
    const face = site.style === "grid" ? serif : sans;

    /* Size from the printed price's own width — the strongest visual anchor,
       since the cover swatch hides the old ink entirely and only the new
       text's proportions are judged against the rest of her page. */
    let size = (origW / face.widthOfTextAtSize("RM 36.00", 1)) * 1.06;

    const price = rm(product.price_cents);
    const was = typeof product.compare_price_cents === "number"
      && product.compare_price_cents > product.price_cents
      ? rm(product.compare_price_cents) : null;

    /* A sale shows both numbers on the grid; the pill has room for one. */
    const showWas = was !== null && site.style === "grid";
    const wasSize = size * 0.82;
    const gap = size * 0.45;
    let totalW = face.widthOfTextAtSize(price, size)
      + (showWas ? gap + face.widthOfTextAtSize(was!, wasSize) : 0);
    /* Longer live text shrinks to stay inside the tile it was printed in. */
    const maxW = origW * (site.style === "pill" ? 1.28 : 1.9);
    if (totalW > maxW) {
      const f = maxW / totalW;
      size *= f;
      totalW = maxW;
    }

    /* Cover the printed price with the surrounding colour, padded past the
       ink and wide enough for the new text. */
    const coverW = Math.max(origW, totalW) + 8;
    const coverH = (site.y1 - site.y0) + 6;
    page.drawRectangle({
      x: cx - coverW / 2,
      y: H - site.y1 - 3,
      width: coverW,
      height: coverH,
      color: site.style === "grid" ? CREAM : site.page === 1 ? PILL_P2 : PILL_P4,
    });

    /* pdftotext's line box bottom sits a whisker under the baseline; the
       offset was tuned against a render of her own page until the new
       digits sat on her baseline. */
    const baseline = H - site.y1 + size * 0.16;
    const startX = cx - totalW / 2;
    page.drawText(price, {
      x: startX, y: baseline, size, font: face,
      color: site.style === "grid" ? GRID_INK : WHITE,
    });
    if (showWas) {
      const wasX = startX + face.widthOfTextAtSize(price, size) + gap;
      const wasW = face.widthOfTextAtSize(was!, wasSize);
      page.drawText(was!, { x: wasX, y: baseline, size: wasSize, font: face, color: MUTED });
      page.drawLine({
        start: { x: wasX - 0.5, y: baseline + wasSize * 0.28 },
        end: { x: wasX + wasW + 0.5, y: baseline + wasSize * 0.28 },
        thickness: Math.max(0.5, wasSize * 0.06), color: MUTED,
      });
    }

    patched.push(site.label);
    touchedPages.add(site.page);
  }

  /* The date these prices were true, on every page that was patched — a PDF
     outlives the tab it came from, and somebody will still be holding this
     file next month. Tiny, muted, in the margin below her artwork. */
  const stamp = `Prices as at ${(opts.generatedAt ?? new Date()).toISOString().slice(0, 10)} · elfiaofficialstore.my`;
  for (const idx of touchedPages) {
    const page = pages[idx];
    if (!page) continue;
    const w = sans.widthOfTextAtSize(stamp, 5.5);
    page.drawText(stamp, {
      x: page.getWidth() / 2 - w / 2, y: 3.5, size: 5.5, font: sans, color: MUTED, opacity: 0.8,
    });
  }

  doc.setTitle("ELFIA Catalog");
  doc.setAuthor("ELFIA OFFICIAL STORE");
  doc.setSubject("First Sight, Forever Yours");
  doc.setProducer("elfiaofficialstore.my");

  return { bytes: await doc.save(), patched, unmatched };
}
