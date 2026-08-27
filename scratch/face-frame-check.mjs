/**
 * Do all the faces land in the same place? (v1.36.0)
 *
 * The CEO, 27-08-2026: "for the face position I want to be at the same
 * circular focus. Which is aligned center nicely."
 *
 * "The same" is a measurable claim, so this measures it — on REAL cut-outs,
 * not drawings. scratch/cutouts/*.png are the shop's own fixture photos put
 * through the same U²-Net matting the portal runs in the CEO's browser, so
 * the alpha read here is the alpha the shop will read. One of them
 * (shawl-beige) is framed quite differently from the other five, which is
 * the whole point: an answer that only works on photos shot the same way has
 * not solved anything.
 *
 * The strongest check is the second one. It does not re-run the recipe and
 * compare it with itself — it DRAWS each photo into a tile using the frame
 * that was returned, then finds the head again in tile coordinates. An
 * arithmetic mistake shared with the code under test cannot survive that.
 *
 * Also checked: what must NOT be framed (an ordinary photo, an empty file,
 * matting noise), and the property he actually asked for — the same person
 * shot at a different distance, standing somewhere else in the frame, comes
 * out identical.
 *
 * Run: node --experimental-strip-types scratch/face-frame-check.mjs
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";

import { frameFromAlphaGrid, CIRCLE_TARGETS, GRID_W } from "../lib/face-frame.ts";

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);

/** Enough PNG to read the alpha channel back out of a cut-out. */
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let pos = 8, width = 0, height = 0, depth = 0, colour = 0, interlace = 0;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      depth = data[8]; colour = data[9]; interlace = data[12];
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (depth !== 8 || colour !== 6 || interlace !== 0) {
    throw new Error(`need 8-bit RGBA (got depth ${depth}, colour ${colour})`);
  }
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = 4, stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      cur[x] = v & 0xff;
    }
  }
  return { width, height, data: out };
}

/** The browser downscales with drawImage; this box-filters, which is the
    same answer to within a pixel on a silhouette. */
function alphaGrid(png, gw = GRID_W) {
  const gh = Math.max(8, Math.round((png.height * gw) / png.width));
  const grid = new Uint8Array(gw * gh);
  const sx = png.width / gw, sy = png.height / gh;
  for (let y = 0; y < gh; y++) {
    const y0 = Math.floor(y * sy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < gw; x++) {
      const x0 = Math.floor(x * sx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let sum = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) { sum += png.data[(yy * png.width + xx) * 4 + 3]; n++; }
      }
      grid[y * gw + x] = Math.round(sum / Math.max(1, n));
    }
  }
  return { grid, gw, gh };
}

/** Put a framed photo on a TILE-sized square and read the head back off it,
    in tile percentages. Nothing here shares a line with the code under
    test — that is the point. */
function landedHead(grid, gw, gh, frame, TILE = 300) {
  const tile = new Uint8Array(TILE * TILE);
  const rw = (frame.width / 100) * TILE, rh = (frame.height / 100) * TILE;
  const ox = (frame.left / 100) * TILE, oy = (frame.top / 100) * TILE;
  for (let y = 0; y < TILE; y++) {
    const sy = ((y - oy) / rh) * gh;
    if (sy < 0 || sy >= gh) continue;
    for (let x = 0; x < TILE; x++) {
      const sx = ((x - ox) / rw) * gw;
      if (sx < 0 || sx >= gw) continue;
      tile[y * TILE + x] = grid[Math.floor(sy) * gw + Math.floor(sx)];
    }
  }
  const span = (y) => {
    let l = -1, r = -1;
    for (let x = 0; x < TILE; x++) if (tile[y * TILE + x] >= 128) { if (l < 0) l = x; r = x; }
    return l < 0 ? null : [l, r];
  };
  let crown = -1;
  for (let y = 0; y + 2 < TILE && crown < 0; y++) {
    const s = span(y);
    if (s && s[1] - s[0] + 1 >= TILE * 0.02) crown = y;
  }
  if (crown < 0) return null;
  /* the widest row of the head's own band — its middle is the head's middle */
  let best = -1, cx = TILE / 2;
  for (let y = crown; y < Math.min(TILE, crown + TILE * 0.22); y++) {
    const s = span(y);
    if (s && s[1] - s[0] > best) { best = s[1] - s[0]; cx = (s[0] + s[1]) / 2; }
  }
  return { crown: (crown / TILE) * 100, cx: (cx / TILE) * 100, headW: (best / TILE) * 100 };
}

/** A hijab portrait's silhouette, shaped like the real ones this was
    calibrated on: a crown that rises fast, a plateau of head + hijab, then
    the shoulders flaring out. `dx` moves her sideways in frame, `scale`
    stands her further from the camera. */
function silhouette(gw, gh, dx = 0, scale = 1) {
  const g = new Uint8Array(gw * gh);
  const crown = 9;
  for (let y = 0; y < gh; y++) {
    const t = (y - crown) / scale;
    let hw = 0;
    if (t < 0) hw = 0;
    else if (t < 22) hw = 30 * Math.pow(t / 22, 0.55);
    else if (t < 76) hw = 30 + 2 * Math.sin(t / 12);
    else hw = 30 + (t - 76) * 0.55;
    /* Further away is smaller in BOTH directions — scaling only the height
       would be a person stretched, not a person standing further back, and
       the code would be right to refuse to match it. */
    hw *= scale;
    if (hw <= 0) continue;
    const c = gw / 2 + dx;
    for (let x = Math.max(0, Math.round(c - hw)); x < Math.min(gw, Math.round(c + hw)); x++) {
      g[y * gw + x] = 255;
    }
  }
  return g;
}

/* ---------------------------------------------------------------------- */

step("the real cut-outs are all framed");
const dir = new URL("./cutouts/", import.meta.url).pathname;
if (!existsSync(dir)) {
  console.log(`  !! ${dir} is missing — see CHANGELOG v1.36.0 for the matting step`);
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".png")).sort();
ok(`${files.length} cut-outs to measure`, files.length >= 4, files.join(", "));

const measured = [];
for (const f of files) {
  const png = decodePng(readFileSync(dir + f));
  const { grid, gw, gh } = alphaGrid(png);
  const frame = frameFromAlphaGrid(grid, gw, gh);
  ok(`${f.padEnd(24)} is framed`, frame !== null);
  if (frame) measured.push({ f, frame, grid, gw, gh });
}

step("and they are NOT all framed the same way — each photo gets its own");
{
  const heights = measured.map((m) => m.frame.height);
  const spread = Math.max(...heights) - Math.min(...heights);
  console.log("     " + measured.map((m) => `${m.f.slice(0, 12)} ${m.frame.height.toFixed(0)}%`).join("  "));
  ok("a photo shot further away is zoomed in to match the rest", spread > 5,
     `spread ${spread.toFixed(1)}%`);
}

step("the faces land on the same spot — re-measured off the finished tile");
{
  const spots = measured.map((m) => ({ f: m.f, ...landedHead(m.grid, m.gw, m.gh, m.frame) }));
  for (const s of spots) {
    console.log(`     ${s.f.padEnd(24)} crown ${s.crown.toFixed(1)}%  centre ${s.cx.toFixed(1)}%  head ${s.headW.toFixed(1)}%`);
  }
  const span = (k) => Math.max(...spots.map((s) => s[k])) - Math.min(...spots.map((s) => s[k]));
  /* 3% of a tile is about 5px on the phone this was reported from, against
     the ~15% spread in the CEO's own screenshot. The residual is the shawl
     photo: a shawl is a different garment shape from a bawal, so its
     silhouette genuinely differs, and squeezing the last 2% out would mean
     over-fitting the measurement to one fixture. The numbers print above,
     so drift shows up as a number rather than as a surprise. */
  ok("every crown lands at the same height (±3%)", span("crown") <= 3, `${span("crown").toFixed(2)}%`);
  ok("every head is centred on the same line (±3%)", span("cx") <= 3, `${span("cx").toFixed(2)}%`);
  ok("every head comes out the same size (±3%)", span("headW") <= 3, `${span("headW").toFixed(2)}%`);
  ok("and they really are near the middle", spots.every((s) => Math.abs(s.cx - 50) < 5),
     spots.map((s) => s.cx.toFixed(1)).join(", "));
  ok("with the face where the targets say it should be",
     spots.every((s) => Math.abs(s.crown - (CIRCLE_TARGETS.y - CIRCLE_TARGETS.zone * 0.42) * 100) < 3),
     spots.map((s) => s.crown.toFixed(1)).join(", "));
}

step("the same person, moved and resized, comes out identical");
{
  const gw = 120, gh = 161;
  const a = frameFromAlphaGrid(silhouette(gw, gh), gw, gh);
  const b = frameFromAlphaGrid(silhouette(gw, gh, 18), gw, gh);
  const c = frameFromAlphaGrid(silhouette(gw, gh, -10, 0.8), gw, gh);
  ok("all three are framed", Boolean(a && b && c));
  if (a && b && c) {
    const land = (f, dx, scale) => landedHead(silhouette(gw, gh, dx, scale), gw, gh, f);
    const la = land(a, 0, 1), lb = land(b, 18, 1), lc = land(c, -10, 0.8);
    console.log(`     centred ${la.cx.toFixed(1)}%   shifted ${lb.cx.toFixed(1)}%   distant ${lc.cx.toFixed(1)}%`);
    ok("standing 18% to the right does not move her face",
       Math.abs(la.cx - lb.cx) < 1.5, `${la.cx.toFixed(1)} vs ${lb.cx.toFixed(1)}`);
    ok("nor does it move her crown", Math.abs(la.crown - lb.crown) < 1.5);
    ok("a smaller subject is zoomed in", c.height > a.height * 1.15,
       `${a.height.toFixed(0)}% vs ${c.height.toFixed(0)}%`);
    ok("and lands at the same height and size as the others",
       Math.abs(la.crown - lc.crown) < 2 && Math.abs(la.headW - lc.headW) < 2,
       `crown ${la.crown.toFixed(1)}/${lc.crown.toFixed(1)} head ${la.headW.toFixed(1)}/${lc.headW.toFixed(1)}`);
  }
}

step("what must NOT be framed");
{
  const gw = 120, gh = 160;
  ok("an ordinary photo (nothing transparent) is left alone",
     frameFromAlphaGrid(new Uint8Array(gw * gh).fill(255), gw, gh) === null);
  ok("a fully transparent file is refused", frameFromAlphaGrid(new Uint8Array(gw * gh), gw, gh) === null);
  ok("a grid too small to mean anything is refused", frameFromAlphaGrid(new Uint8Array(16), 4, 4) === null);

  const clean = frameFromAlphaGrid(silhouette(gw, gh), gw, gh);
  const specked = silhouette(gw, gh);
  for (let y = 3; y < 5; y++) for (let x = 10; x < 13; x++) specked[y * gw + x] = 255;
  const after = frameFromAlphaGrid(specked, gw, gh);
  ok("one speck of matting noise does not become the top of her head",
     Boolean(clean && after) && Math.abs(after.top - clean.top) < 1.5,
     `${clean?.top.toFixed(1)} vs ${after?.top.toFixed(1)}`);

  /* Half a subject — a bad matte that kept only a sliver. */
  const sliver = new Uint8Array(gw * gh);
  for (let y = 40; y < 60; y++) for (let x = 58; x < 62; x++) sliver[y * gw + x] = 255;
  ok("a sliver of a subject is refused rather than blown up",
     frameFromAlphaGrid(sliver, gw, gh) === null);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: every face lands on the same circular focus.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
