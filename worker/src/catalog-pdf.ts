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
import { PDFArray, PDFDocument, PDFFont, PDFName, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";

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
  /* v1.27.0 — the designer's display faces sometimes kern words together so
     tightly that extraction reads "Bawal lumiMahogany" as one word, and the
     token test misses a product plainly printed on the page (the CEO's
     missing Mahogany price, diagnosed from his own file). So each token may
     also match INSIDE the label with its spaces removed — 3+ characters
     only, so a short token cannot fish a match out of an unrelated word.
     The ambiguity rule below still referees: two products claiming one
     label means nobody gets it. */
  const squashed = label.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]/g, "");
  const hasToken = (t: string) => labelSet.has(t) || (t.length >= 3 && squashed.includes(t));
  let best: CatalogProduct | null = null;
  let bestScore = 0;
  let tied = false;
  for (const p of products) {
    const distinctive = tokens(p.name).filter((t) => !GENERIC.has(t));
    if (distinctive.length === 0) continue;
    if (!distinctive.every(hasToken)) continue;
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
  /** Where LINKS point. Separate from `origin` on purpose: the local rig
      fetches assets from a test address, but a PDF saved to a phone travels
      — its links must carry the real shop, wherever the copy ends up. */
  linkBase: string;
  generatedAt?: Date;
}

export interface PatchResult {
  bytes: Uint8Array;
  patched: string[];
  /** Labels left at their printed price, with why — surfaced, never silent. */
  unmatched: { label: string; why: string }[];
  /** Link annotations written, for the header and the rig. */
  links: number;
}

/* ---- making her pages tappable (v1.20.0) ----
   A PDF link is an annotation: a rectangle on the page plus a URI action,
   layered OVER the content — her artwork is not touched. Rect coordinates
   are PDF-native (origin bottom-left). Existing annotations are preserved,
   though her file ships with none. */
function addLink(doc: PDFDocument, page: PDFPage, x: number, y: number, w: number, h: number, url: string): void {
  const annot = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [x, y, x + w, y + h],
    Border: [0, 0, 0], // no visible border — the tile itself is the affordance
    /* PDFString, NOT context.obj(url): pdf-lib turns a bare JS string into
       a PDF Name (/https:#2f#2f…), which no viewer follows. Caught by
       reading the annotations back out of the first generated file. */
    A: { Type: "Action", S: "URI", URI: PDFString.of(url) },
  });
  const ref = doc.context.register(annot);
  const existing = page.node.lookup(PDFName.of("Annots"));
  if (existing instanceof PDFArray) existing.push(ref);
  else page.node.set(PDFName.of("Annots"), doc.context.obj([ref]));
}

/** Which shop shelf a printed label belongs to, for tiles whose product
    could not be matched — a shelf is always a safe landing. */
export const collectionOfLabel = (label: string): string =>
  /^\s*shawl/i.test(label) ? "shawl" : "bawal";

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
  let links = 0;

  for (const site of PRICE_SITES) {
    const page = pages[site.page];
    if (!page) { unmatched.push({ label: site.label, why: "page missing" }); continue; }
    const product = matchProduct(site.label, products);
    const H = page.getHeight();

    /* ---- the tap area, matched or not (v1.20.0) ----
       The whole TILE is tappable — photo circle, name, price — because that
       is what a thumb aims at. A matched tile opens its product page, built
       from the id the patcher holds RIGHT NOW (safe only because this PDF
       is rebuilt per request). An unmatched tile lands on its shelf — never
       a dead link, never a guessed product.

       Grid geometry, from the same extraction as the price boxes: columns
       ~200pt apart (tap width ±86 cannot cross into a neighbour), the photo
       circle ~150pt tall above the label (tap top = price top - 128). The
       two Product Detail pages ARE one product each, so everything under
       the header band is the tap area. */
    const cxTap = (site.x0 + site.x1) / 2;
    const href = product
      ? `${opts.linkBase}/p?id=${product.id}`
      : `${opts.linkBase}/shop?c=${collectionOfLabel(site.label)}`;
    if (site.style === "grid") {
      const topY = site.y0 - 128;
      addLink(doc, page, cxTap - 86, H - (site.y1 + 4), 172, (site.y1 + 4) - topY, href);
    } else {
      addLink(doc, page, 20, 20, page.getWidth() - 40, H - 100, href);
    }
    links += 1;

    if (!product) { unmatched.push({ label: site.label, why: "no live product matches" }); continue; }
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

  /* The wordmark on every content page goes home; the whole cover goes
     home. The wordmark is outlined art (no text object to measure), so its
     rect is the top-left band it visibly occupies — generous, and clear of
     the first row of tiles by over 100pt. */
  for (const [idx, page] of pages.entries()) {
    if (idx === 0) {
      addLink(doc, page, 0, 0, page.getWidth(), page.getHeight(), opts.linkBase);
    } else {
      addLink(doc, page, 25, page.getHeight() - 60, 200, 50, opts.linkBase);
    }
    links += 1;
  }

  doc.setTitle("ELFIA Catalog");
  doc.setAuthor("ELFIA OFFICIAL STORE");
  doc.setSubject("First Sight, Forever Yours");
  doc.setProducer("elfiaofficialstore.my");

  return { bytes: await doc.save(), patched, unmatched, links };
}

/* ===========================================================================
   v1.21.0 — a catalog the CEO uploaded herself, priced on the way out.

   The CEO: "the portal can upload the PDF for this catalog without the
   prices tag and it will automatically live price embedded to the PDF
   uploaded."

   The portal's ELFIA tab extracts, IN HER BROWSER at upload time, where
   every product label sits in the new file (page sizes, label rects — the
   browser has a full PDF engine, this worker does not). That map and the
   file travel the bridge like photos do, marker-gated, and land in this
   store's R2. This function then does at request time exactly what
   patchCatalogPdf does for the shipped file — except there is nothing to
   cover: her new catalogs carry NO printed prices, so the live price is
   simply set beneath each label. Nothing is hidden, so no colour sampling
   is needed; the price is set in the shop's deep rose, which is ELFIA's ink
   everywhere else.

   Map coordinates are top-left-origin points, the same convention as
   PRICE_SITES, converted once here.
   =========================================================================== */

export interface UploadedSite {
  page: number; // zero-based
  label: string;
  x0: number; y0: number; x1: number; y1: number; // the label's own rect
}

/** v1.27.0 — a PRINTED price in the uploaded file. The CEO's designer
    ships catalogs WITH prices now ("the price from system automatically
    override the price in PDF which is we done it before"): each one is
    covered in its own background colour — sampled by the portal's browser
    at upload, since this worker has no canvas — and the live price is
    written in the same spot, the v1.19 treatment driven by the map. */
export interface UploadedPriceSite {
  page: number;
  x0: number; y0: number; x1: number; y1: number;
  bg?: [number, number, number];  // 0-255; absent → house cream
  /** The PRINTED price's own ink, sampled from its glyphs — the live price
      is written in the same colour, so white stays white on his pill. */
  ink?: [number, number, number];
}

export interface UploadedMap {
  version: number;
  pages: { w: number; h: number }[];
  sites: UploadedSite[];
  /** Absent = a price-less catalog: insert mode alone. */
  price_sites?: UploadedPriceSite[];
}

/** Shape-check a map that travelled the bridge. A malformed map must fall
    back to the shipped catalog, never crash the route. */
export function parseUploadedMap(raw: string): UploadedMap | null {
  try {
    const m = JSON.parse(raw) as UploadedMap;
    if (m.version !== 1 || !Array.isArray(m.pages) || !Array.isArray(m.sites)) return null;
    if (m.sites.length === 0 || m.sites.length > 300) return null;
    const okRect = (s: { page: number; x0: number; y0: number; x1: number; y1: number }) =>
      Number.isInteger(s.page) && s.page >= 0 && s.page < m.pages.length &&
      [s.x0, s.y0, s.x1, s.y1].every(Number.isFinite) && s.x1 > s.x0 && s.y1 > s.y0;
    const okSite = (s: UploadedSite) =>
      okRect(s) && typeof s.label === "string" && s.label.length > 0 && s.label.length <= 120;
    if (!m.sites.every(okSite)) return null;
    if (m.price_sites !== undefined) {
      if (!Array.isArray(m.price_sites) || m.price_sites.length > 300) return null;
      const okRGB = (c: unknown) => c === undefined ||
        (Array.isArray(c) && c.length === 3 &&
         (c as unknown[]).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 255));
      const okPrice = (s: UploadedPriceSite) => okRect(s) && okRGB(s.bg) && okRGB(s.ink);
      if (!m.price_sites.every(okPrice)) return null;
    }
    return m;
  } catch {
    return null;
  }
}

export async function patchUploadedCatalog(
  source: ArrayBuffer, map: UploadedMap, products: CatalogProduct[],
  opts: { linkBase: string; generatedAt?: Date },
): Promise<PatchResult> {
  const doc = await PDFDocument.load(source);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  /* The override text is SANS — the CEO: "Price should the font like
     Saiz". His designer sets pill values in a clean sans face; a serif
     number in that pill read as someone else's handwriting. */
  const sansUp = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();

  const patched: string[] = [];
  const unmatched: { label: string; why: string }[] = [];
  const sitePages = new Set(map.sites.map((s) => s.page));
  let links = 0;

  /* v1.25.0 — PAGE FURNITURE. A designer's page carries headings that are
     not products: "Saiz", "Details", "Material", "Product Detail", and the
     empty "Price" pill the CEO flagged. They used to get shelf links and a
     place in the unmatched list — noise on both counts. They are recognised
     by their whole (normalised) text, never by substring, so a product that
     legitimately contains one of these words is untouched. */
  const normal = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");
  const FURNITURE = new Set([
    "price", "harga", "saiz", "size", "sizes", "details", "detail",
    "material", "materials", "productdetail", "byelfia", "elfia",
  ]);
  const isPriceHeading = (s: string) => ["price", "harga"].includes(normal(s));

  /* The CEO's detail pages say "Price" with an empty pill the designer left
     blank on purpose — the number is OURS to write. A bare "Price" heading
     names no product, so it takes the page's price only when the page has
     exactly ONE matched product; two products on a page and the heading
     stays empty rather than guessing. Matched first, drawn second, because
     this rule needs the whole page read before anything is written. */
  type Placed = { site: UploadedSite; product: CatalogProduct | null; heading: boolean };
  const placed: Placed[] = [];
  const productsOfPage = new Map<number, Set<CatalogProduct>>();
  for (const site of map.sites) {
    if (!pages[site.page]) { unmatched.push({ label: site.label, why: "page missing" }); continue; }
    const heading = isPriceHeading(site.label);
    if (!heading && FURNITURE.has(normal(site.label))) continue; // silent: not a product, not a failure
    const product = heading ? null : matchProduct(site.label, products);
    if (product) {
      if (!productsOfPage.has(site.page)) productsOfPage.set(site.page, new Set());
      productsOfPage.get(site.page)!.add(product);
    }
    placed.push({ site, product, heading });
  }

  /* v1.27.0 — printed prices in the file. The CEO: "the price from system
     automatically override the price in PDF which is we done it before."
     Each printed price is paired with the label directly above it (same
     column, a designer's caption-then-price stack); the pairing decides
     WHOSE live price replaces it. A printed price whose label matches no
     live product is left exactly as printed — same honesty rule as the
     shipped catalog since v1.19. */
  const pricePaired = new Map<UploadedSite, UploadedPriceSite>();
  for (const ps of map.price_sites ?? []) {
    if (!pages[ps.page]) continue;
    const pcx = (ps.x0 + ps.x1) / 2;
    let best: { pl: Placed; gap: number } | null = null;
    for (const pl of placed) {
      if (pl.site.page !== ps.page || pricePaired.has(pl.site)) continue;
      const lcx = (pl.site.x0 + pl.site.x1) / 2;
      if (Math.abs(lcx - pcx) > 100) continue;         // a different column
      const gap = ps.y0 - pl.site.y1;                  // label sits above its price
      if (gap < -6 || gap > 60) continue;
      if (!best || gap < best.gap) best = { pl, gap };
    }
    if (best) pricePaired.set(best.pl.site, ps);
  }
  /* A page that CARRIES printed prices was priced by the designer: every
     price on it lives where she printed one. Inserting extra chips there
     put a price on top of her "By Elfia" line. So on those pages, a label
     with no printed price under it gets its tap link and nothing else. */
  const pagesWithPrinted = new Set((map.price_sites ?? []).map((p) => p.page));

  /* v1.29.0 — ONE price per product per page in insert mode. On a
     price-less detail page both the name pill AND the Price heading resolve
     to the same product, and both drew — "the price become duplicated!"
     (the CEO, with the screenshot). The Price heading is the designer's
     chosen spot, so it wins; without one, the top-most label of the product
     draws and the rest keep only their tap links. */
  const insertWinner = new Map<string, UploadedSite>(); // `${page}:${productId}` -> site
  for (const pl of placed) {
    const pageSet0 = productsOfPage.get(pl.site.page);
    const prod = pl.heading
      ? (pageSet0 && pageSet0.size === 1 ? [...pageSet0][0]! : null)
      : pl.product;
    if (!prod) continue;
    const key = `${pl.site.page}:${prod.id}`;
    const held = insertWinner.get(key);
    const heldIsHeading = held ? isPriceHeading(held.label) : false;
    if (!held || (pl.heading && !heldIsHeading)) insertWinner.set(key, pl.site);
  }

  for (const { site, product: matched, heading } of placed) {
    const page = pages[site.page]!;
    const H = page.getHeight();
    const cx = (site.x0 + site.x1) / 2;
    const labelH = site.y1 - site.y0;
    /* The price sits just under the label, sized to read as the label's
       companion. Clamped: a display-sized heading must not produce a
       display-sized price. */
    const size = Math.min(14, Math.max(7.5, labelH * 0.85));

    const pageSet = productsOfPage.get(site.page);
    const product = heading
      ? (pageSet && pageSet.size === 1 ? [...pageSet][0]! : null)
      : matched;

    if (heading && !product) continue; // a Price heading on a page it cannot read — leave the pill as the designer left it

    /* Tap area, matched or not: the label block plus the price chip below.
       Modest on purpose — in a layout this worker has never seen, a
       generous rectangle could claim a neighbouring product. */
    const tapTop = site.y0 - 6;
    const tapBottom = site.y1 + size * 2.5;
    const href = product
      ? `${opts.linkBase}/p?id=${product.id}`
      : `${opts.linkBase}/shop?c=${collectionOfLabel(site.label)}`;
    addLink(doc, page, site.x0 - 25, H - tapBottom, (site.x1 - site.x0) + 50, tapBottom - tapTop, href);
    links += 1;

    if (!product) { unmatched.push({ label: site.label, why: "no live product matches" }); continue; }

    const price = rm(product.price_cents);
    const was = typeof product.compare_price_cents === "number"
      && product.compare_price_cents > product.price_cents
      ? rm(product.compare_price_cents) : null;

    const printed = pricePaired.get(site);
    if (printed) {
      /* ---- OVERRIDE (v1.27.0): the file has a printed price here ----
         Cover it in its own background colour (sampled by the portal at
         upload; house cream when no sample travelled) and write the live
         price in the same spot, sized like the designer's own number. Ink
         flips to white on a dark ground — his detail pages print prices in
         white on a rose pill. */
      const w = printed.x1 - printed.x0;
      const h = printed.y1 - printed.y0;
      /* The patch hugs the printed glyphs — the CEO: "the box should not
         height like this to cover the static price there". A tall flat
         patch showed as a box over his pill's gradient; the slimmest cover
         that hides the old number is invisible. */
      const padX = Math.max(1.5, h * 0.18);
      const padY = Math.max(1, h * 0.1);
      const bg = printed.bg
        ? rgb(printed.bg[0] / 255, printed.bg[1] / 255, printed.bg[2] / 255) : CREAM;
      page.drawRectangle({
        x: printed.x0 - padX, y: H - printed.y1 - padY,
        width: w + padX * 2, height: h + padY * 2, color: bg,
      });
      /* Ink: the printed number's own colour (sampled from its glyphs at
         upload) — white stays white on his pill, dark stays dark on cream.
         Fallback: contrast against the sampled ground. */
      const lum = printed.bg
        ? (0.2126 * printed.bg[0] + 0.7152 * printed.bg[1] + 0.0722 * printed.bg[2]) / 255 : 1;
      const ink = printed.ink
        ? rgb(printed.ink[0] / 255, printed.ink[1] / 255, printed.ink[2] / 255)
        : (lum > 0.55 ? GRID_INK : rgb(1, 1, 1));
      const softInk = !printed.ink && lum > 0.55 ? MUTED : ink;
      const softOpacity = printed.ink ? 0.75 : 1;

      let pSize = Math.max(7, h * 0.8);
      let wasOn = was;
      const widthAt = (sz: number) =>
        sansUp.widthOfTextAtSize(price, sz)
        + (wasOn ? sz * 0.45 + sansUp.widthOfTextAtSize(wasOn, sz * 0.82) : 0);
      const maxW = w + padX * 1.6;
      if (widthAt(pSize) > maxW) pSize = Math.max(h * 0.5, pSize * (maxW / widthAt(pSize)));
      if (widthAt(pSize) > maxW) wasOn = null; // the sale pair will not fit — the live price alone, legibly
      const total = widthAt(pSize);
      const pcx = (printed.x0 + printed.x1) / 2;
      const startPX = pcx - total / 2;
      const pBase = H - printed.y1 + h / 2 - pSize * 0.36;
      page.drawText(price, { x: startPX, y: pBase, size: pSize, font: sansUp, color: ink });
      if (wasOn) {
        const wasSz = pSize * 0.82;
        const wasX = startPX + sansUp.widthOfTextAtSize(price, pSize) + pSize * 0.45;
        const wasW = sansUp.widthOfTextAtSize(wasOn, wasSz);
        page.drawText(wasOn, { x: wasX, y: pBase, size: wasSz, font: sansUp, color: softInk, opacity: softOpacity });
        page.drawLine({
          start: { x: wasX - 0.5, y: pBase + wasSz * 0.28 },
          end: { x: wasX + wasW + 0.5, y: pBase + wasSz * 0.28 },
          thickness: Math.max(0.5, wasSz * 0.06), color: softInk, opacity: softOpacity,
        });
      }
      patched.push(site.label);
      continue;
    }

    /* ---- INSERT (v1.21, plain since v1.30): no printed price here ---- */
    if (pagesWithPrinted.has(site.page)) continue; // her page, her price spots
    if (insertWinner.get(`${site.page}:${product.id}`) !== site) continue; // one price per product per page

    /* PLAIN TEXT, nothing else. The CEO: "just a text is enough! this will
       cause an overlapped on the background" — the cream chip of v1.25 read
       as a pasted box on his fabric backgrounds. And ONE size across the
       whole catalog ("should be same size as the Bawal lumi Mahogany price
       size"): the price never inherits a display heading's scale, so the
       text under a 22pt "Price" matches the text under an 11pt grid
       caption. Sans, like his designer's own price lines ("font of SAIZ"). */
    const tSize = Math.min(10, Math.max(7.5, labelH * 0.85));
    const wasSize = tSize * 0.82;
    const gap = tSize * 0.45;
    const priceW = sansUp.widthOfTextAtSize(price, tSize);
    const totalW = priceW + (was ? gap + sansUp.widthOfTextAtSize(was, wasSize) : 0);
    const baseline = H - site.y1 - tSize * 0.45;
    const startX = cx - totalW / 2;
    page.drawText(price, { x: startX, y: baseline, size: tSize, font: sansUp, color: GRID_INK });
    if (was) {
      const wasX = startX + priceW + gap;
      const wasW = sansUp.widthOfTextAtSize(was, wasSize);
      page.drawText(was, { x: wasX, y: baseline, size: wasSize, font: sansUp, color: MUTED });
      page.drawLine({
        start: { x: wasX - 0.5, y: baseline + wasSize * 0.28 },
        end: { x: wasX + wasW + 0.5, y: baseline + wasSize * 0.28 },
        thickness: Math.max(0.5, wasSize * 0.06), color: MUTED,
      });
    }
    patched.push(site.label);
  }

  /* Home links: a page with no product sites (the cover, a mood page) is
     wholly tappable; a page with sites keeps a top band, clear of content
     this worker has never measured. */
  const stamp = `Prices as at ${(opts.generatedAt ?? new Date()).toISOString().slice(0, 10)} · elfiaofficialstore.my`;
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  for (const [idx, page] of pages.entries()) {
    if (sitePages.has(idx)) {
      addLink(doc, page, 25, page.getHeight() - 55, 200, 45, opts.linkBase);
      const w = sans.widthOfTextAtSize(stamp, 5.5);
      page.drawText(stamp, {
        x: page.getWidth() / 2 - w / 2, y: 3.5, size: 5.5, font: sans, color: MUTED, opacity: 0.8,
      });
    } else {
      addLink(doc, page, 0, 0, page.getWidth(), page.getHeight(), opts.linkBase);
    }
    links += 1;
  }

  doc.setTitle("ELFIA Catalog");
  doc.setAuthor("ELFIA OFFICIAL STORE");
  doc.setSubject("First Sight, Forever Yours");
  doc.setProducer("elfiaofficialstore.my");

  return { bytes: await doc.save(), patched, unmatched, links };
}
