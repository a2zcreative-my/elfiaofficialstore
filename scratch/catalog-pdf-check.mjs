/**
 * HER catalog, patched with live prices — proven (v1.19.0).
 *
 * The CEO: "I want to use this Catalog without create any new. I want to
 * make the price live fetch instead of static!"
 *
 * /api/v1/catalog.pdf now loads the designer's own file and covers each
 * printed price with the live one, in place. Four claims, checked
 * separately because they fail separately:
 *
 *   HERS      — the output is her document: her five pages, her cover, her
 *               labels, nothing added and nothing drawn.
 *   LIVE      — a price changed in the portal is in the NEXT download, and
 *               a discount prints as a sale — driven through the real
 *               portal -> bridge -> store chain, no back doors.
 *   HONEST    — a label with no matching live product keeps its printed
 *               price and is NAMED in a response header; ambiguity refuses
 *               rather than guesses.
 *   MAP GUARD — the stored PDF still matches the coordinate map extracted
 *               from it. If she ships a new catalog file without the map
 *               being re-extracted (pdftotext -bbox), this fails loudly
 *               instead of the shop printing prices in the wrong places.
 *
 * The embed itself (the <object> on /catalog, the CSP allowing it, phones
 * getting tiles instead of a blank frame) is catalog-live-check.mjs's job.
 *
 * Setup (same rigs as store-sync-test.mjs):
 *   node scratch/fake-portal.mjs
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   node scratch/serve-local.mjs
 *   node scratch/catalog-pdf-check.mjs
 */
import { execFileSync, execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";

const API = process.env.ELFIA_API ?? "http://127.0.0.1:8787/api/v1";
const PORTAL = process.env.PORTAL ?? "http://127.0.0.1:8200";
const KEY = process.env.ELFIA_ADMIN_KEY ?? "test-passcode-123";
/* This rig's own SKU — the sync suite's fixtures are LUMI001-010, and a rig
   that borrows another rig's fixtures inherits that rig's state. */
const SKU = "LUMISKY9";

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

/* The PDF is cached for a minute; asking about a change needs a fresh one. */
const grab = async (tag) => {
  const r = await fetch(`${API}/catalog.pdf?t=${tag}`, { headers: { "Cache-Control": "no-cache" } });
  return {
    status: r.status,
    patched: r.headers.get("x-catalog-patched"),
    unmatched: r.headers.get("x-catalog-unmatched") ?? "",
    bytes: Buffer.from(await r.arrayBuffer()),
  };
};
/* Words read back OUT of the PDF — "the price is in the document" is the
   only claim that matters to somebody holding the document.

   `-raw` is load-bearing: the live price is drawn OVER the covered printed
   one at the same coordinates, and poppler's default layout mode discards
   overlapping text as shadow duplicates — the patch rendered perfectly
   while plain pdftotext swore it was not there. Raw mode reads the content
   streams in order and keeps both. */
const textOf = (buf) => {
  const f = `/tmp/catcheck-${Date.now()}.pdf`;
  writeFileSync(f, buf);
  try { return execFileSync("pdftotext", ["-raw", f, "-"], { encoding: "utf8", maxBuffer: 20e6 }); }
  finally { try { unlinkSync(f); } catch { /* gone */ } }
};

/* The map and the matcher from the SHIPPED code, bundled on the fly, so this
   rig can never drift from what the worker actually runs. */
execSync("npx esbuild worker/src/catalog-pdf.ts --bundle --format=esm --platform=node --outfile=/tmp/catpatch-rig.mjs",
  { cwd: new URL("..", import.meta.url).pathname, stdio: "pipe" });
const { PRICE_SITES, matchProduct } = await import("/tmp/catpatch-rig.mjs");

step("MAP GUARD — the stored file still matches the extracted map");
{
  const srcText = execFileSync("pdftotext",
    [new URL("../public/lookbook/elfia-catalog.pdf", import.meta.url).pathname, "-"],
    { encoding: "utf8", maxBuffer: 20e6 }).replace(/\s+/g, " ");
  const missing = [...new Set(PRICE_SITES.map((s) => s.label))].filter((l) => !srcText.includes(l));
  ok(`every mapped label is in the stored PDF (${PRICE_SITES.length} sites)`, missing.length === 0,
     `missing: ${missing.join(", ")} — the catalog file changed; re-extract PRICE_SITES with pdftotext -bbox`);
  ok("the map covers both grids and both detail pills",
     new Set(PRICE_SITES.map((s) => s.page)).size === 4,
     `pages: ${[...new Set(PRICE_SITES.map((s) => s.page))].join(",")}`);
}

step("the matcher never guesses");
{
  const P = (id, name) => ({ id, name, price_cents: 1000 });
  ok("a shade matches its label",
     matchProduct("Bawal lumi Aurora", [P(1, "LUMI AURORA"), P(2, "DARK BROWN")])?.id === 1);
  ok("every distinctive word must appear",
     matchProduct("Shawl Chiffon Dark Purple", [P(1, "DARK BROWN")]) === null);
  ok("two products claiming one site = nobody gets it",
     matchProduct("Bawal lumi Sky", [P(1, "LUMI SKY"), P(2, "SKY")]) === null);
  ok("a name made only of generic words never matches",
     matchProduct("Bawal lumi Sky", [P(1, "Bawal Premium")]) === null);
  ok("the more specific product wins",
     matchProduct("Bawal lumi Dusty Olive", [P(1, "OLIVE"), P(2, "DUSTY OLIVE")])?.id === 2);
}

step("HERS — the output is her document");
let first;
{
  first = await grab("a");
  ok("the route answers a real PDF",
     first.status === 200 && first.bytes.subarray(0, 5).toString() === "%PDF-",
     `${first.status} ${first.bytes.subarray(0, 8)}`);
  const info = execFileSync("pdfinfo", ["-"], { input: first.bytes, encoding: "utf8" });
  ok("exactly her five pages — nothing added, nothing dropped", /Pages:\s+5\b/.test(info),
     info.match(/Pages:.*/)?.[0] ?? "");
  ok("her page size", /\(A4\)/.test(info), info.match(/Page size:.*/)?.[0] ?? "");
  const t = textOf(first.bytes).replace(/\s+/g, " ");
  ok("her cover line survives", /F I RST SI GHT|FIRST SIGHT/i.test(t));
  ok("her labels survive", t.includes("Bawal lumi Aurora") && t.includes("Shawl Chiffon Mocha"));
  ok("her Malay product details survive", t.includes("Tahap Kejarangan"));
}

step("HONEST — unmatched labels keep the printed price, and are named");
{
  /* The sync fixtures ("Portal LUMI 001"…) match no catalog label, so most
     sites stay at the printed price. That must be reported, not silent. */
  ok("the response header names what was left printed",
     first.unmatched.includes("Bawal lumi Lilac"), first.unmatched.slice(0, 140));
  ok("and the printed price still stands for them", textOf(first.bytes).includes("RM 36.00"));
}

step("LIVE — the whole chain, portal to PDF");
{
  /* This rig's product enters through the PORTAL, the same door as her real
     catalogue — the pull creates it live on the shop with this name. */
  await portalPost("/_add", { sku: SKU, stock: 9, price_cents: 4777, name: "LUMI SKY", category: "bawal" });
  await syncNow();

  const one = await grab("b");
  ok("its site is patched with the live price", textOf(one.bytes).includes(rm(4777)), `expected ${rm(4777)}`);
  ok("the patch is counted in the header", Number(one.patched) >= 1, String(one.patched));
  ok("and its label is no longer reported unmatched",
     !one.unmatched.includes("Bawal lumi Sky"), one.unmatched.slice(0, 140));

  await portalPost("/_price", { sku: SKU, price_cents: 5150 });
  await syncNow();
  ok("a price change is in the NEXT download", textOf((await grab("c")).bytes).includes(rm(5150)),
     `expected ${rm(5150)}`);

  await portalPost("/_discount", { sku: SKU, discount_cents: 650 });
  await syncNow();
  const sale = textOf((await grab("d")).bytes);
  ok("a discount prints as the price paid", sale.includes(rm(4500)), `expected ${rm(4500)}`);
  ok("with the old price struck beside it", sale.includes(rm(5150)), `expected ${rm(5150)}`);

  const today = new Date().toISOString().slice(0, 10);
  ok("each patched page says when its prices were true", sale.includes(`Prices as at ${today}`));
}

step("tidy up — this rig leaves nothing behind");
{
  await portalPost("/_discount", { sku: SKU, discount_cents: null });
  await portalPost("/_remove", { sku: SKU });
  const products = (await (await fetch(`${API}/products`)).json()).products;
  const mine = products.find((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU);
  if (mine) await admin(`/admin/products/${mine.id}`, { method: "PUT", body: JSON.stringify({ active: false }) });
  await syncNow();
  const gone = (await (await fetch(`${API}/products`)).json()).products
    .some((p) => (p.sku ?? "").replace(/\s+/g, "").toUpperCase() === SKU);
  ok("its product is retired from the shop", !gone);
}

console.log(fail === 0
  ? `\nPASS - ${pass} checks: her catalog, her pages, live prices.`
  : `\n${fail} of ${pass + fail} checks failed.`);
process.exit(fail === 0 ? 0 : 1);
