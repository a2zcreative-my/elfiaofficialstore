/**
 * Where the model's face is, and how to put it in the same place every time.
 *
 * The CEO, 27-08-2026, looking at /catalog on his phone: "for the face
 * position I want to be at the same circular focus. Which is aligned center
 * nicely."
 *
 * The circles are all the same; the PHOTOS are not. Each shade is shot at a
 * slightly different distance and the model does not stand in the same place
 * in every frame, so `object-cover` — which can only ever crop the same way
 * for every photo — puts one face high and left, the next low and right, and
 * a zoomed-out shot's face smaller than its neighbour's. No amount of CSS
 * fixes that, because CSS cannot know where the face is.
 *
 * The cut-outs can. A cut-out photo carries its subject in its ALPHA: the
 * transparent background makes the silhouette exactly measurable, for free,
 * with no face-detection model and nothing to download. So this reads the
 * silhouette and returns the box the photo should be drawn in, as percentages
 * of the tile, so that every face lands on the same spot at the same size.
 *
 * The silhouette of a hijab portrait has a shape the measurement leans on:
 *
 *      ___          crown        — the topmost opaque row
 *     /   \
 *    |     |        the rise     — width grows fast, then plateaus: the head
 *    |     |
 *    \_____/        the plateau  — head + hijab, roughly constant width
 *   /       \       the flare    — shoulders push the width out again
 *  /         \
 *
 * Crown to flare is the HEAD ZONE. Calibrated against six real cut-outs
 * (scratch/face-frame-check.mjs keeps them honest), the eyes sit at 0.42 of
 * that zone — that number was read off a photo with the candidate lines
 * drawn on it, not guessed.
 *
 * NOTHING here is face recognition: no identity, no biometric template, no
 * network call. It is the width of a silhouette per row, and it never leaves
 * the browser.
 *
 * A photo that is not a cut-out (nothing transparent) returns null, and the
 * caller keeps its ordinary crop — the shop must look unchanged until the
 * cut-outs are actually run.
 */

/** The box to draw the photo in, as percentages of the tile's own box. */
export interface FaceFrame {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a face should end up, as fractions of the tile. */
export interface FaceTargets {
  /** the face's centre, across */
  x: number;
  /** the face's centre, down */
  y: number;
  /** how tall crown-to-shoulders should be */
  zone: number;
}

/* The /catalog circles. The face sits a little above the middle, which is
   where a portrait wants to be in a round frame, and the head zone fills
   just over half the height — close to what the shop already showed for a
   typical photo, so nothing jumps when this starts working. */
export const CIRCLE_TARGETS: FaceTargets = { x: 0.5, y: 0.42, zone: 0.58 };

/** Opaque from this value up. Matting leaves soft edges; half is the edge. */
const ALPHA_ON = 128;
/** A row this thin is matting noise, not a person. */
const MIN_ROW = 0.02;
/** The head is found once the width stops growing this fast per step. */
const RISE_MIN = 0.012;
/** The shoulders are where the plateau is exceeded by this much. */
const FLARE = 1.15;
/** Where the eyes sit inside the head zone (measured, see the header). */
const FACE_IN_ZONE = 0.42;
/** A photo with nothing transparent is not a cut-out. */
const OPAQUE_LIMIT = 0.97;

/**
 * `alpha` is a small alpha-only grid (w × h, row-major) — a downscaled copy
 * of the photo's alpha channel. 120 wide is plenty: this measures a
 * silhouette, not a face, and a small grid keeps it to a fraction of a
 * millisecond per photo.
 */
export function frameFromAlphaGrid(
  alpha: Uint8Array | Uint8ClampedArray,
  w: number,
  h: number,
  targets: FaceTargets = CIRCLE_TARGETS,
): FaceFrame | null {
  if (w < 8 || h < 8 || alpha.length < w * h) return null;

  /* Row spans, and how much of the photo is opaque at all. */
  const left = new Int32Array(h).fill(-1);
  const right = new Int32Array(h).fill(-1);
  let opaque = 0;
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1, n = 0;
    const row = y * w;
    for (let x = 0; x < w; x++) {
      if (alpha[row + x]! >= ALPHA_ON) { if (l < 0) l = x; r = x; n++; }
    }
    opaque += n;
    if (n >= 2 && r - l + 1 >= w * MIN_ROW) { left[y] = l; right[y] = r; }
  }
  /* An ordinary photo is opaque corner to corner: leave it alone. */
  if (opaque / (w * h) > OPAQUE_LIMIT) return null;

  /* The crown — the first row of three in a row, so one stray speck of
     matting noise above her head cannot become the top of her head. */
  let crown = -1;
  for (let y = 0; y + 2 < h; y++) {
    if (left[y]! >= 0 && left[y + 1]! >= 0 && left[y + 2]! >= 0) { crown = y; break; }
  }
  if (crown < 0) return null;
  let foot = -1;
  for (let y = h - 1; y > crown; y--) if (left[y]! >= 0) { foot = y; break; }
  if (foot < 0 || foot - crown < h * 0.15) return null;

  const width = (y: number) => (left[y]! < 0 ? 0 : right[y]! - left[y]! + 1);

  /* THE RISE: walk down from the crown until the silhouette stops widening
     quickly. That is the top of the head's own plateau. */
  const step = Math.max(2, Math.round(h * 0.02));
  const rideEnd = Math.min(h, crown + Math.round((foot - crown) * 0.45));
  let plateau = -1;
  for (let y = crown + step; y < rideEnd; y++) {
    if (width(y) - width(y - step) < w * RISE_MIN) { plateau = y; break; }
  }
  if (plateau < 0) return null;

  /* The head's width, as the median across the plateau — one odd row (an
     earring, a fold of the shawl) must not set the scale for the tile. */
  const around: number[] = [];
  for (let y = Math.max(crown, plateau - step); y <= Math.min(foot, plateau + step); y++) {
    const ww = width(y);
    if (ww > 0) around.push(ww);
  }
  if (around.length === 0) return null;
  around.sort((a, b) => a - b);
  const headW = around[Math.floor(around.length / 2)]!;
  if (headW < w * 0.08 || headW > w * 0.9) return null;

  /* THE FLARE: the shoulders, where the plateau is left behind. If the
     drape never flares (a shawl worn over both shoulders can hide it), the
     head zone is capped at a head-and-a-half — an honest guess, bounded. */
  let flare = -1;
  for (let y = plateau; y <= foot; y++) {
    if (width(y) > headW * FLARE) { flare = y; break; }
  }
  if (flare < 0 || flare - crown > headW * 2.2) flare = Math.round(crown + headW * 1.45);
  const zone = flare - crown;
  if (zone < h * 0.05) return null;

  /* Across: the middle of the HEAD, by median — the models turn their heads,
     and centring the silhouette is what reads as centred.
     Only the upper 60% of the zone counts. Lower down it is drape, and a
     shawl thrown over one shoulder drags the midpoint sideways with it —
     which is exactly how one tile ends up sitting off-centre from its
     neighbour, the fault this whole file exists to end. */
  const centres: number[] = [];
  const centreEnd = crown + Math.max(2, Math.round(zone * 0.6));
  for (let y = crown; y < Math.min(flare, centreEnd); y++) {
    if (left[y]! >= 0) centres.push((left[y]! + right[y]!) / 2);
  }
  if (centres.length === 0) return null;
  centres.sort((a, b) => a - b);
  const cx = centres[Math.floor(centres.length / 2)]!;

  const faceY = crown + zone * FACE_IN_ZONE;

  /* Scale so the head zone is the target height, then place the face. All
     of it in percentages of the tile, so it holds at any tile size and
     needs no resize listener. */
  const heightPct = (100 * targets.zone * h) / zone;
  if (!Number.isFinite(heightPct) || heightPct < 80 || heightPct > 420) return null;
  const widthPct = (heightPct * w) / h;

  return {
    left: targets.x * 100 - (cx / w) * widthPct,
    top: targets.y * 100 - (faceY / h) * heightPct,
    width: widthPct,
    height: heightPct,
  };
}

/** How wide the alpha grid is measured at. Small on purpose — see above. */
export const GRID_W = 120;

/**
 * The browser half: a loaded image → its frame, or null.
 *
 * Same-origin only (the shop serves its own photos), so the canvas is never
 * tainted; if it ever were, getImageData throws and this returns null, which
 * the caller reads as "frame it the old way".
 */
export function measureFaceFrame(
  img: HTMLImageElement,
  targets: FaceTargets = CIRCLE_TARGETS,
): FaceFrame | null {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  const gw = GRID_W, gh = Math.max(8, Math.round((h * gw) / w));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = gw; canvas.height = gh;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, gw, gh);
    const { data } = ctx.getImageData(0, 0, gw, gh);
    const alpha = new Uint8Array(gw * gh);
    for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]!;
    return frameFromAlphaGrid(alpha, gw, gh, targets);
  } catch {
    return null;
  }
}
