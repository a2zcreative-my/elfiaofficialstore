/**
 * The ELFIA catalog, generated as a real PDF with LIVE prices (v1.18.0).
 *
 * The CEO: "I want my own PDF without create any new catalog, I want PDF to
 * be embedded with this website! I also want to make sure this PDF able to
 * fetch the actual prices of my Product!!!"
 *
 * Those three things cannot all be true of a FILE. A PDF sitting in a folder
 * is a photograph of a moment: it cannot fetch anything, ever. What can be
 * true is a PDF that is BUILT AT THE MOMENT SOMEBODY ASKS FOR IT — so every
 * copy anyone downloads or views was made from the prices in the database a
 * second earlier.
 *
 * That is this file. GET /api/v1/catalog.pdf runs it, and what comes back is
 * a genuine PDF — printable, downloadable, embeddable, shareable on WhatsApp
 * — that nobody ever has to regenerate by hand.
 *
 * WHAT IS HERS AND WHAT IS DRAWN
 *   page 1      her cover artwork, unchanged, exactly as her designer made
 *               it. It carries no prices, so it never goes out of date.
 *   pages 2..n  drawn here in the same style as her printed lookbook — the
 *               cream ground, the grey circles, the shade name, the price —
 *               because these are the pages with prices on them, and prices
 *               are the whole point.
 *
 * The colours and the page size are HER catalog's, sampled from the PDF she
 * supplied rather than guessed:
 *   ground      rgb(251, 246, 240)
 *   circles     rgb(112, 112, 110)
 *   A4 portrait (her cover is 1100x1556, which is A4 to within a pixel)
 *
 * A new shade published in the portal appears in the next PDF anyone opens.
 * Nobody re-exports anything.
 */
import {
  PDFDocument, PDFFont, PDFImage, PDFPage, StandardFonts,
  appendBezierCurve, clip, closePath, endPath, moveTo,
  popGraphicsState, pushGraphicsState, rgb,
} from "pdf-lib";

export interface CatalogProduct {
  id: number;
  name: string;
  price_cents: number;
  compare_price_cents?: number | null;
  image_key: string | null;
  sku?: string | null;
  category?: string;
  stock: number;
  track_stock?: number;
}

/* ---- her catalog's own measurements ---- */
const A4 = { w: 595.28, h: 841.89 };
const GROUND = rgb(251 / 255, 246 / 255, 240 / 255);
const CIRCLE = rgb(112 / 255, 112 / 255, 110 / 255);
const DEEP = rgb(0x7a / 255, 0x26 / 255, 0x48 / 255); // the shop's deep rose
const INK = rgb(0x40 / 255, 0x29 / 255, 0x2f / 255);
const MUTED = rgb(0x9b / 255, 0x85 / 255, 0x8a / 255);

const MARGIN = 42;
const COLS = 3;
const ROWS = 4;
const PER_PAGE = COLS * ROWS;

const rm = (cents: number) => `RM ${(cents / 100).toFixed(2)}`;

/** Letter-spaced, the way the wordmark is set in her artwork. */
function drawTracked(
  page: PDFPage, text: string, x: number, y: number,
  { font, size, color, tracking }: { font: PDFFont; size: number; color: ReturnType<typeof rgb>; tracking: number },
): number {
  let cx = x;
  for (const ch of text) {
    page.drawText(ch, { x: cx, y, size, font, color });
    cx += font.widthOfTextAtSize(ch, size) + tracking;
  }
  return cx - x - tracking;
}

const trackedWidth = (text: string, font: PDFFont, size: number, tracking: number) =>
  [...text].reduce((w, ch) => w + font.widthOfTextAtSize(ch, size) + tracking, 0) - tracking;

/** Centre a plain string on `cx`, truncating with an ellipsis if it will not
    fit the cell. A name running into its neighbour looks like a bug. */
function drawCentred(
  page: PDFPage, text: string, cx: number, y: number,
  font: PDFFont, size: number, color: ReturnType<typeof rgb>, maxW: number,
): void {
  let t = text;
  while (t.length > 1 && font.widthOfTextAtSize(t, size) > maxW) t = t.slice(0, -1);
  if (t !== text) t = `${t.slice(0, -1)}…`;
  page.drawText(t, { x: cx - font.widthOfTextAtSize(t, size) / 2, y, size, font, color });
}

/** A circular window, since PDF has no "border-radius": four beziers, then
    clip. Everything drawn until popGraphicsState is confined to the circle. */
function clipCircle(page: PDFPage, cx: number, cy: number, r: number): void {
  const k = r * 0.5523; // the usual circle-from-beziers constant
  page.pushOperators(
    pushGraphicsState(),
    moveTo(cx, cy + r),
    appendBezierCurve(cx + k, cy + r, cx + r, cy + k, cx + r, cy),
    appendBezierCurve(cx + r, cy - k, cx + k, cy - r, cx, cy - r),
    appendBezierCurve(cx - k, cy - r, cx - r, cy - k, cx - r, cy),
    appendBezierCurve(cx - r, cy + k, cx - k, cy + r, cx, cy + r),
    closePath(), clip(), endPath(),
  );
}

/** The shade, without the series prefix — "Bawal Premium — Dusty Rose" is
    "Dusty Rose" under a photo that is obviously a bawal. */
const shadeOf = (name: string) => {
  const i = name.indexOf(" — ");
  return i > 0 ? name.slice(i + 3) : name;
};

const soldOut = (p: CatalogProduct) => (p.track_stock ?? 1) === 1 && p.stock <= 0;

/** Portal spelling, tidied — mirrors collectionsOf() on the storefront so the
    PDF groups exactly the way the shop does. */
const collectionOf = (p: CatalogProduct) => ((p.category ?? "").trim() || "Bawal");
const pretty = (raw: string) => (raw === raw.toLowerCase()
  ? raw.replace(/\b[a-z]/g, (c) => c.toUpperCase()) : raw);

async function loadImage(
  doc: PDFDocument, key: string, origin: string, media: R2Bucket | undefined,
): Promise<PDFImage | null> {
  try {
    let bytes: ArrayBuffer | null = null;
    if (key.startsWith("/")) {
      /* Shipped with the website (the /collection photos). */
      const r = await fetch(`${origin}${key}`);
      if (r.ok) bytes = await r.arrayBuffer();
    } else if (media) {
      const obj = await media.get(key);
      if (obj) bytes = await obj.arrayBuffer();
    }
    if (!bytes || bytes.byteLength === 0) return null;
    const head = new Uint8Array(bytes.slice(0, 4));
    /* PNG magic 89 50 4E 47, else assume JPEG — those are the only two the
       upload routes accept, and embedding the wrong one throws. */
    return head[0] === 0x89 && head[1] === 0x50
      ? await doc.embedPng(bytes)
      : await doc.embedJpg(bytes);
  } catch {
    return null; // one unreadable photo must not lose the whole catalog
  }
}

export interface CatalogOptions {
  /** Where the website lives, for the cover and any shipped photos. */
  origin: string;
  media?: R2Bucket;
  /** Shown in the footer so nobody mistakes an old download for today. */
  generatedAt?: Date;
  /** Bounded so one request cannot try to embed a thousand photographs. */
  max?: number;
}

export async function buildCatalogPdf(
  products: CatalogProduct[], opts: CatalogOptions,
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("ELFIA Catalog");
  doc.setAuthor("ELFIA OFFICIAL STORE");
  doc.setSubject("First Sight, Forever Yours");
  doc.setProducer("elfiaofficialstore.my");

  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const serifBold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const sans = await doc.embedFont(StandardFonts.Helvetica);

  const when = opts.generatedAt ?? new Date();
  const stamp = when.toISOString().slice(0, 10);

  /* ---- page 1: her cover, untouched ---- */
  const cover = await loadImage(doc, "/lookbook/page-1.jpg", opts.origin, undefined);
  if (cover) {
    const page = doc.addPage([A4.w, A4.h]);
    /* Cover the page completely, cropping the overflow rather than letting
       her artwork letterbox against a white band. */
    const scale = Math.max(A4.w / cover.width, A4.h / cover.height);
    const w = cover.width * scale, h = cover.height * scale;
    page.drawImage(cover, { x: (A4.w - w) / 2, y: (A4.h - h) / 2, width: w, height: h });
  }

  /* ---- the shades, grouped the way the portal names them ---- */
  const live = products
    .filter((p) => p.price_cents > 0)
    .slice(0, opts.max ?? 120);

  const groups = new Map<string, { label: string; items: CatalogProduct[] }>();
  for (const p of live) {
    const raw = collectionOf(p);
    const key = raw.toLowerCase().replace(/\s+/g, "-");
    if (!groups.has(key)) groups.set(key, { label: pretty(raw), items: [] });
    groups.get(key)!.items.push(p);
  }

  const cellW = (A4.w - MARGIN * 2) / COLS;
  const cellH = 172;
  const radius = 55;

  let pageNo = 1;
  for (const { label, items } of groups.values()) {
    for (let start = 0; start < items.length; start += PER_PAGE) {
      const slice = items.slice(start, start + PER_PAGE);
      const page = doc.addPage([A4.w, A4.h]);
      pageNo += 1;
      page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: GROUND });

      /* header: the wordmark, a dashed rule, and the collection */
      const wordW = drawTracked(page, "ELFIA", MARGIN, A4.h - 62,
        { font: serif, size: 22, color: INK, tracking: 5 });
      const partLabel = start === 0 ? label : `${label} (cont.)`;
      const labelW = trackedWidth(partLabel, serifBold, 12, 1.6);
      const ruleFrom = MARGIN + wordW + 14;
      const ruleTo = A4.w - MARGIN - labelW - 14;
      for (let x = ruleFrom; x < ruleTo; x += 9) {
        page.drawLine({
          start: { x, y: A4.h - 55 }, end: { x: Math.min(x + 5, ruleTo), y: A4.h - 55 },
          thickness: 0.9, color: DEEP, opacity: 0.55,
        });
      }
      drawTracked(page, partLabel, A4.w - MARGIN - labelW, A4.h - 60,
        { font: serifBold, size: 12, color: DEEP, tracking: 1.6 });

      /* the tiles */
      for (const [i, p] of slice.entries()) {
        const col = i % COLS, row = Math.floor(i / COLS);
        const cx = MARGIN + cellW * col + cellW / 2;
        const top = A4.h - 100 - row * cellH;
        const cy = top - radius;

        page.drawCircle({ x: cx, y: cy, size: radius, color: CIRCLE });

        const img = p.image_key ? await loadImage(doc, p.image_key, opts.origin, opts.media) : null;
        if (img) {
          clipCircle(page, cx, cy, radius);
          /* Cover the circle, anchored to the TOP of the photograph: these
             are portraits, and centring them crops the face. */
          const s = Math.max((radius * 2) / img.width, (radius * 2) / img.height);
          const w = img.width * s, h = img.height * s;
          page.drawImage(img, { x: cx - w / 2, y: cy + radius - h, width: w, height: h });
          page.pushOperators(popGraphicsState());
        }

        const nameY = cy - radius - 16;
        drawCentred(page, shadeOf(p.name), cx, nameY, serifBold, 9.5, DEEP, cellW - 12);

        /* THE PRICE — the reason this file exists. */
        const was = typeof p.compare_price_cents === "number" && p.compare_price_cents > p.price_cents
          ? p.compare_price_cents : null;
        const priceText = rm(p.price_cents);
        if (was) {
          const wasText = rm(was);
          const pw = sans.widthOfTextAtSize(priceText, 8.5);
          const ww = sans.widthOfTextAtSize(wasText, 7.5);
          const total = pw + 5 + ww;
          const x0 = cx - total / 2;
          page.drawText(priceText, { x: x0, y: nameY - 12, size: 8.5, font: sans, color: DEEP });
          page.drawText(wasText, { x: x0 + pw + 5, y: nameY - 12, size: 7.5, font: sans, color: MUTED });
          page.drawLine({
            start: { x: x0 + pw + 5, y: nameY - 12 + 2.6 },
            end: { x: x0 + pw + 5 + ww, y: nameY - 12 + 2.6 },
            thickness: 0.6, color: MUTED,
          });
        } else {
          drawCentred(page, priceText, cx, nameY - 12, sans, 8.5, INK, cellW - 12);
        }

        if (soldOut(p)) {
          drawCentred(page, "SOLD OUT", cx, nameY - 23, sans, 6.5, MUTED, cellW - 12);
        } else if (p.sku) {
          drawCentred(page, p.sku, cx, nameY - 23, sans, 6.5, MUTED, cellW - 12);
        }
      }

      /* footer: the promise, and the date these prices were true */
      page.drawText("First Sight, Forever Yours", {
        x: MARGIN, y: 34, size: 8, font: serif, color: DEEP,
      });
      const foot = `Prices as at ${stamp} · elfiaofficialstore.my`;
      page.drawText(foot, {
        x: A4.w - MARGIN - sans.widthOfTextAtSize(foot, 7), y: 34, size: 7, font: sans, color: MUTED,
      });
      page.drawText(String(pageNo), {
        x: A4.w / 2 - sans.widthOfTextAtSize(String(pageNo), 7) / 2, y: 20, size: 7, font: sans, color: MUTED,
      });
    }
  }

  /* A catalog with no products still has to be a valid PDF. */
  if (doc.getPageCount() === 0) {
    const page = doc.addPage([A4.w, A4.h]);
    page.drawRectangle({ x: 0, y: 0, width: A4.w, height: A4.h, color: GROUND });
    drawCentred(page, "ELFIA", A4.w / 2, A4.h / 2, serifBold, 24, INK, A4.w);
    drawCentred(page, "The collection is being updated.", A4.w / 2, A4.h / 2 - 26, sans, 10, MUTED, A4.w);
  }

  return doc.save();
}
