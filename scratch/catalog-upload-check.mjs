/**
 * A catalog the CEO uploads prices itself (v1.21.0).
 *
 * The CEO: "the portal can upload the PDF for this catalog without the
 * prices tag and it will automatically live price embedded to the PDF
 * uploaded."
 *
 * This walks the store's half of that promise against the real worker and
 * the stand-in portal: a brand-new PDF that has NEVER been seen before —
 * built by this rig with pdf-lib, carrying product labels and NO prices —
 * is uploaded to the portal with its label map, travels the bridge on the
 * next sync, and from then on /api/v1/catalog.pdf serves HER new file with
 * live prices set under each label, tap links included. Removing it returns
 * the shop to the shipped catalog.
 *
 * The map here is exact because the rig placed the labels itself. In
 * production the portal's browser extracts it from the designer's file at
 * upload time; that extraction has its own rig in the portal repo.
 *
 * Setup (same rigs as store-sync-test.mjs):
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/catalog-upload-check.mjs
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { createRequire } from "node:module";
/* The CJS build resolves cleanly under node; the ES build's extensionless
   imports do not. */
const { PDFDocument, StandardFonts, rgb } = createRequire(import.meta.url)("../worker/node_modules/pdf-lib");

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL ?? "http://127.0.0.1:8200";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";
const BRIDGE = process.env.BRIDGE_KEY ?? "shared-bridge-secret";
const SKU = "LUMIUPL7"; // this rig's own product, never another rig's

let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ok  ${label}`); }
  else { fail++; console.log(`  XX  ${label}${extra ? ` -- ${extra}` : ""}`); }
};
const step = (t) => console.log(`\n${t}`);
const admin = (p, init = {}) => fetch(`${API}${p}`, {
  ...init, headers: { "X-Admin-Key": KEY, "Content-Type": "application/json", ...(init.headers ?? {}) },
});
const portalPost = (path, body) => fetch(`${PORTAL}${path}`, { method: "POST", body: JSON.stringify(body) });
const syncNow = () => admin("/admin/sync-stock", { method: "POST" }).then((r) => r.json());
const rm = (c) => `RM ${(c / 100).toFixed(2)}`;
const grab = async (tag) => {
  const r = await fetch(`${API}/catalog.pdf?t=${tag}`, { headers: { "Cache-Control": "no-cache" } });
  return {
    source: r.headers.get("x-catalog-source"),
    unmatched: r.headers.get("x-catalog-unmatched") ?? "",
    bytes: Buffer.from(await r.arrayBuffer()),
  };
};
const textOf = (buf) => {
  const f = `/tmp/catup-${Date.now()}.pdf`;
  writeFileSync(f, buf);
  try { return execFileSync("pdftotext", ["-raw", f, "-"], { encoding: "utf8", maxBuffer: 20e6 }); }
  finally { try { unlinkSync(f); } catch { /* gone */ } }
};
const urisOf = (buf) => {
  const f = `/tmp/catupl-${Date.now()}.pdf`;
  writeFileSync(f, buf);
  try {
    execFileSync("qpdf", ["--qdf", "--object-streams=disable", f, `${f}.q`], { stdio: "pipe" });
    const q = readFileSync(`${f}.q`, "latin1");
    return [...q.matchAll(/\/URI \(([^)]*)\)/g)].map((m) => m[1]);
  } finally { try { unlinkSync(f); unlinkSync(`${f}.q`); } catch { /* gone */ } }
};

/* ---- a catalog nobody has ever seen: two pages, labels, NO prices ---- */
async function buildNewCatalog() {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRomanBold);
  const cover = doc.addPage([595.28, 841.89]);
  cover.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.98, 0.96, 0.94) });
  cover.drawText("ELFIA — Raya Edition", { x: 150, y: 420, size: 28, font: serif, color: rgb(0.3, 0.12, 0.17) });

  const page = doc.addPage([595.28, 841.89]);
  page.drawRectangle({ x: 0, y: 0, width: 595.28, height: 841.89, color: rgb(0.98, 0.96, 0.94) });
  const sites = [];
  const put = (label, cx, yTop) => {
    const size = 12;
    const w = serif.widthOfTextAtSize(label, size);
    page.drawText(label, { x: cx - w / 2, y: 841.89 - yTop - size, size, font: serif, color: rgb(0.3, 0.12, 0.17) });
    sites.push({ page: 1, label, x0: cx - w / 2, y0: yTop, x1: cx + w / 2, y1: yTop + size });
  };
  put("Bawal lumi Uplan", 150, 300);   // will match this rig's product
  put("Bawal lumi Nobody", 440, 300);  // will match nothing, on purpose
  const bytes = await doc.save();
  return { bytes: Buffer.from(bytes), map: { version: 1, pages: [{ w: 595.28, h: 841.89 }, { w: 595.28, h: 841.89 }], sites } };
}

try {
  step("before anything: the shipped catalog is serving");
  {
    await fetch(`${API}/bridge/catalog`, { method: "DELETE", headers: { "X-Bridge-Key": BRIDGE } });
    const { source } = await grab("pre");
    ok("source is the shipped file", source === "shipped", String(source));
  }

  step("her new file travels the bridge and takes over");
  {
    await portalPost("/_add", { sku: SKU, stock: 5, price_cents: 6150, name: "LUMI UPLAN", category: "bawal" });
    const built = await buildNewCatalog();
    await portalPost("/_catalog", {
      pdf_b64: built.bytes.toString("base64"),
      map: built.map,
      cover_b64: Buffer.from("ffd8ffe000104a46494600", "hex").toString("base64"), // a JPEG magic stub
      updated_at: `up-${Date.now()}`,
    });
    const r = await syncNow();
    ok("the pull reports the catalog updated", JSON.stringify(r).includes("catalog"), JSON.stringify(r.pull?.error ?? ""));

    const { source, bytes, unmatched } = await grab("took");
    ok("the served catalog is now HERS", source === "portal", String(source));
    const t = textOf(bytes);
    ok("it is the new document, not the shipped one", t.includes("Raya Edition") && !t.includes("Tahap Kejarangan"),
       t.slice(0, 80));
    ok("the live price appears under her label", t.includes(rm(6150)), `expected ${rm(6150)}`);
    ok("the label with no product gets NO invented price", unmatched.includes("Bawal lumi Nobody"), unmatched);
    ok("and the page says when its prices were true",
       t.includes(`Prices as at ${new Date().toISOString().slice(0, 10)}`));

    const skuId = (await (await fetch(`${API}/products`)).json()).products
      .find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU)?.id;
    const uris = urisOf(bytes);
    ok("her matched label taps through to its product",
       uris.includes(`https://elfiaofficialstore.my/p?id=${skuId}`),
       uris.filter((u) => u.includes("/p?id=")).join(", ") || "(none)");
    ok("the unmatched label taps through to its shelf",
       uris.includes("https://elfiaofficialstore.my/shop?c=bawal"));
    ok("the cover page is wholly tappable to home",
       uris.filter((u) => /elfiaofficialstore\.my\/?$/.test(u)).length >= 2);
  }

  step("a price change reaches HER catalog too");
  {
    await portalPost("/_price", { sku: SKU, price_cents: 6950 });
    await syncNow();
    ok("the next download carries the new price", textOf((await grab("re")).bytes).includes(rm(6950)),
       `expected ${rm(6950)}`);
  }

  step("the cover route serves her uploaded cover");
  {
    const r = await fetch(`${API}/catalog-cover`);
    const head = Buffer.from(await r.arrayBuffer());
    ok("it answers image/jpeg", (r.headers.get("content-type") ?? "").includes("image/jpeg"));
    ok("with HER bytes (the JPEG magic stub)", head[0] === 0xff && head[1] === 0xd8 && head.length < 100,
       `${head.length} bytes`);
  }

  step("an absent feed key keeps her catalog — the oldest rule");
  {
    await portalPost("/_catalog", { clear: true });
    await syncNow();
    ok("the store keeps serving her upload", (await grab("keep")).source === "portal");
  }

  step("removing it returns the shop to the shipped file");
  {
    const del = await fetch(`${API}/bridge/catalog`, { method: "DELETE", headers: { "X-Bridge-Key": BRIDGE } });
    ok("the reset answers", del.ok, String(del.status));
    const { source, bytes } = await grab("back");
    ok("source is the shipped file again", source === "shipped", String(source));
    ok("with her designer's pages", textOf(bytes).includes("Tahap Kejarangan"));
    ok("and no key, no reset",
       (await fetch(`${API}/bridge/catalog`, { method: "DELETE" })).status === 401);
  }
} finally {
  await portalPost("/_catalog", { clear: true }).catch(() => null);
  await fetch(`${API}/bridge/catalog`, { method: "DELETE", headers: { "X-Bridge-Key": BRIDGE } }).catch(() => null);
  await portalPost("/_remove", { sku: SKU }).catch(() => null);
  const products = (await (await fetch(`${API}/products`)).json()).products;
  const mine = products.find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU);
  if (mine) await admin(`/admin/products/${mine.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
  await syncNow().catch(() => null);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: a catalog she uploads prices itself, and can be taken back off.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
