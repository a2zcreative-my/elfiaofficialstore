/**
 * No hardcoded secrets — a build gate (CEO, 20-08-2026: "make sure no
 * hardcoded API since I need to make my system secure from attacking").
 *
 * Every real credential in this system lives in a Wrangler secret, set from
 * the CEO's own machine and never written down here:
 *   ADMIN_KEY  BRIDGE_KEY  BILLPLZ_SECRET  BILLPLZ_COLLECTION  BILLPLZ_XSIGN
 *
 * This file makes that a rule the build enforces rather than a habit someone
 * has to remember. It fails on:
 *   1. a secret-looking NAME assigned a literal value in any tracked file;
 *   2. the SHAPES the real keys take — a Billplz API/collection key is a
 *      UUID, an X-Signature key is 128 hex characters;
 *   3. a [vars] entry in wrangler.toml whose name ends in _KEY or _SECRET,
 *      because [vars] is committed and readable by anyone with the repo.
 *
 * Run: node tests/no-secrets.mjs   (DEPLOY.bat runs it before every deploy)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP_DIRS = new Set(["node_modules", ".next", "out", ".git", ".wrangler", "public"]);
const TEXT = /\.(ts|tsx|js|mjs|cjs|css|sql|toml|json|md|bat|html|txt|yml|yaml)$/;

/**
 * Values that are allowed to look secret because they are not: local test
 * fixtures, and documentation examples. Each one must be obviously fake and
 * used only where a real deployment never reads it.
 */
const ALLOWED = new Set([
  "test-passcode-123",           // scratch/ harnesses, local wrangler dev only
  "shared-bridge-secret",        // scratch/fake-portal.mjs — the stand-in portal
  "elfia-local-test-password",   // scratch/store-e2e-live.mjs — account tests
  "elfia-local-wrong-password",  // ditto, the deliberately wrong one
  "REPLACE_WITH_D1_DATABASE_ID",
  "local-e2e-test",
  /* v1.2.0 — the real D1 database_id in worker/wrangler.toml. It is shaped
     like a UUID, which rule 4 exists to catch, but it is an IDENTIFIER, not
     a credential: it names the database and is useless without Cloudflare
     account auth (wrangler login). Without this line, the moment the CEO
     pasted the real id (per the ONE-TIME SETUP comment) every later deploy
     was blocked by this very gate. */
  "d1e1bb9f-1360-417e-8932-0c9009f5115c",
]);
/** Files whose sample UUIDs are documentation, not credentials. */
const ALLOWED_FILES = new Set(["PORTAL-BRIDGE-SPEC.md", "tests/no-secrets.mjs"]);

const RULES = [
  {
    name: "a secret assigned a literal value",
    // KEY = "..." / secret: '...' / token=`...`
    re: /\b([A-Za-z_]*(?:SECRET|PASSWORD|PASSCODE|APIKEY|API_KEY|PRIVATE_KEY|XSIGN|SIGNATURE_KEY|ACCESS_TOKEN|AUTH_TOKEN)[A-Za-z_]*)\s*[:=]\s*["'`]([^"'`\n]{8,})["'`]/gi,
    value: (m) => m[2],
  },
  {
    name: "an admin/bridge/billplz key assigned a literal value",
    re: /\b(ADMIN_KEY|BRIDGE_KEY|BILLPLZ_SECRET|BILLPLZ_COLLECTION|BILLPLZ_XSIGN)\s*[:=]\s*["'`]([^"'`\n]{4,})["'`]/g,
    value: (m) => m[2],
  },
  {
    name: "a 64+ character hex string (an X-Signature key looks like this)",
    re: /\b[a-f0-9]{64,}\b/gi,
    value: (m) => m[0],
  },
  {
    name: "a UUID (a Billplz API key and Collection ID look like this)",
    re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    value: (m) => m[0],
  },
];

/** A value that is plainly a NAME, not a credential: SCREAMING_CASE with no
    lowercase and no punctuation. Prose like "a Wrangler secret: `ADMIN_KEY`"
    must not fail the build — but `BILLPLZ_SECRET = "1abd033b-..."` still does,
    because that value is not a bare identifier. */
const isIdentifier = (v) => /^[A-Z][A-Z0-9_]*$/.test(v);

const hits = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!TEXT.test(entry)) continue;
    const rel = p.replace(/^\.\//, "");
    if (ALLOWED_FILES.has(rel)) continue;
    const src = readFileSync(p, "utf8");
    for (const rule of RULES) {
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(src)) !== null) {
        const value = rule.value(m);
        if (ALLOWED.has(value) || isIdentifier(value)) continue;
        const line = src.slice(0, m.index).split("\n").length;
        hits.push(`${rel}:${line} — ${rule.name}: ${value.slice(0, 12)}…`);
      }
    }
  }
};
walk(".");

/* wrangler.toml [vars] is committed. A secret must never live there. */
try {
  const toml = readFileSync("worker/wrangler.toml", "utf8");
  const vars = toml.slice(toml.indexOf("[vars]"));
  const end = vars.indexOf("\n[", 1);
  for (const line of (end > 0 ? vars.slice(0, end) : vars).split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && /_(KEY|SECRET|TOKEN|PASSWORD)$/.test(m[1])) {
      hits.push(`worker/wrangler.toml — ${m[1]} is under [vars], which is committed. Use \`wrangler secret put ${m[1]}\` instead.`);
    }
  }
} catch { /* no worker config in this checkout */ }

if (hits.length) {
  console.log("FAIL — something that looks like a credential is committed:\n - " + hits.join("\n - "));
  console.log("\nSecrets belong in Wrangler:  cd worker && npx wrangler secret put <NAME>");
  process.exit(1);
}
console.log("PASS — no hardcoded credentials; every key is a Wrangler secret");
