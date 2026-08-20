/**
 * A stand-in for the A2Z portal's bridge, implementing PORTAL-BRIDGE-SPEC.md
 * exactly — including the idempotency rule. Used by scratch/store-sync-test.mjs
 * to prove the two-way inventory sync without touching the real portal.
 *
 *   node scratch/fake-portal.mjs            (listens on :8200)
 *
 * Endpoints (per the spec):
 *   GET  /bridge/elfia-inventory   -> { items: [{ sku, name, stock }] }
 *   POST /bridge/elfia-movements   -> { applied, ignored, unknown_sku }
 * Test controls (NOT part of the spec):
 *   GET  /_state                   -> counts + the event ids it has applied
 *   POST /_set   { sku, stock }    -> force a count
 *   POST /_down  { down: true }    -> pretend the portal is unreachable
 */
import http from "node:http";

const KEY = process.env.BRIDGE_KEY ?? "shared-bridge-secret";
const stock = new Map([
  ["LUMI001", 24], ["LUMI002", 12], ["LUMI003", 8], ["LUMI004", 30], ["LUMI005", 15],
  ["LUMI006", 6], ["LUMI007", 9], ["LUMI008", 11], ["LUMI009", 4], ["LUMI010", 7],
]);
const applied = new Set();   // event ids already counted — the dedupe store
let down = false;

const body = async (req) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString() || "{}"); } catch { return {}; }
};
const send = (res, status, obj) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname === "/_state") {
    return send(res, 200, { stock: Object.fromEntries(stock), applied: [...applied], down });
  }
  if (url.pathname === "/_set") {
    const b = await body(req); stock.set(String(b.sku).toUpperCase(), Number(b.stock));
    return send(res, 200, { ok: true });
  }
  if (url.pathname === "/_down") {
    const b = await body(req); down = Boolean(b.down);
    return send(res, 200, { down });
  }

  if (down) { res.writeHead(503); return res.end("portal down"); }
  if (req.headers["x-bridge-key"] !== KEY) return send(res, 401, { error: "bad key" });

  if (url.pathname === "/bridge/elfia-inventory" && req.method === "GET") {
    return send(res, 200, { items: [...stock].map(([sku, s]) => ({ sku, name: `Portal ${sku}`, stock: s })) });
  }

  if (url.pathname === "/bridge/elfia-movements" && req.method === "POST") {
    const b = await body(req);
    const out = { applied: [], ignored: [], unknown_sku: [] };
    for (const m of b.movements ?? []) {
      const sku = String(m.sku ?? "").toUpperCase();
      if (applied.has(m.event_id)) { out.ignored.push(m.event_id); continue; }  // THE RULE
      if (!stock.has(sku)) { out.unknown_sku.push(m.event_id); continue; }
      stock.set(sku, Math.max(0, stock.get(sku) + Number(m.delta)));
      applied.add(m.event_id);
      out.applied.push(m.event_id);
    }
    return send(res, 200, out);
  }

  res.writeHead(404); res.end("not found");
}).listen(8200, () => console.log("fake portal on :8200"));
