/**
 * Local test harness — serves the exported static site on :8100 and forwards
 * /api/* to the worker on :8787, so a browser sees the same single origin the
 * live site does. Used by scratch/store-journey.mjs. Never deployed.
 *
 *   cd worker && npx wrangler dev --local --config wrangler.e2e.toml --port 8787
 *   npx next build            (project root — writes out/)
 *   node scratch/serve-local.mjs
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('../out', import.meta.url).pathname;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain', '.woff2': 'font/woff2' };

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  /* v1.22.0 — production hands ONE extra exact path to the worker (the
     wrangler route for the catalog's public address); this harness mirrors
     that routing so the rigs exercise what customers get. */
  if (u.pathname.startsWith('/api/') || u.pathname === '/catalog.pdf') {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host; delete headers['content-length']; delete headers.connection;
    const r = await fetch(`http://127.0.0.1:8787${req.url}`, {
      method: req.method,
      headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    // Forward Set-Cookie too — the session cookie lives there, and dropping
    // it made the local rig look like a broken sign-in when the product was
    // fine. getSetCookie() keeps multiple cookies separate.
    const out = { 'content-type': r.headers.get('content-type') ?? 'application/json' };
    const cookies = typeof r.headers.getSetCookie === 'function'
      ? r.headers.getSetCookie()
      : (r.headers.get('set-cookie') ? [r.headers.get('set-cookie')] : []);
    if (cookies.length) out['set-cookie'] = cookies;
    res.writeHead(r.status, out);
    res.end(Buffer.from(await r.arrayBuffer()));
    return;
  }
  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  let file = path.join(ROOT, p);
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const idx = path.join(file, 'index.html');
    if (fs.existsSync(idx)) file = idx;
    else { res.writeHead(404); res.end('not found'); return; }
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
  res.end(fs.readFileSync(file));
}).listen(8100, () => console.log('proxy on 8100'));
