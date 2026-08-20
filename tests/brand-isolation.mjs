/* Brand isolation — this is ELFIA's system and ONLY ELFIA's.
   ELFIA is an independent client brand: the store must not carry the
   agency's or the consultancy's identity anywhere — no names, no SSM
   numbers, no bank accounts, no domains. Fails the build on any leak.
   Run: node tests/brand-isolation.mjs */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", ".next", "out", ".git", ".wrangler", "tests"]);
const EXT = /\.(ts|tsx|js|mjs|css|sql|toml|json|md|bat|html)$/;
const FORBIDDEN = [
  [/A2Z\s*CREATIVE/i, "agency identity"],
  [/AZ\s?ONE\s+OFFICIAL/i, "consultancy identity"],
  [/202603003468|CA0414729/i, "agency registration"],
  [/202603168673|JM1046169/i, "consultancy registration"],
  [/5511\s?0086\s?5300/, "agency bank account"],
  [/5516\s?2328\s?7032/, "consultancy bank account"],
  [/a2zcreative\.my|azoneofficial\.com/i, "other company's domain"],
];

const hits = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!EXT.test(f)) continue;
    const src = readFileSync(p, "utf8");
    for (const [re, what] of FORBIDDEN) {
      if (re.test(src)) hits.push(`${p}: contains ${what}`);
    }
  }
};
walk(".");

if (hits.length) { console.log("FAIL\n - " + hits.join("\n - ")); process.exit(1); }
console.log("PASS — the ELFIA store carries no other company's identity");
