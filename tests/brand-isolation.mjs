/* Brand isolation — this is ELFIA's system and ONLY ELFIA's.
   ELFIA is an independent client brand: the store must not carry the
   agency's or the consultancy's identity anywhere — no names, no SSM
   numbers, no bank accounts, no domains. Fails the build on any leak.

   ONE exception, added 26-08-2026 and deliberately narrow: the PAYEE line.
   The CEO banks this shop's takings into the operating company's account,
   so BANK_LINE in worker/wrangler.toml carries that account number and the
   holder's legal name. That is a payment instruction, not branding — a
   customer whose banking app shows a payee they were not told to expect
   abandons the transfer, and a name mismatch is how a transfer bounces.
   The exemption is one setting in one file: the same number anywhere else,
   and every other identity, still fails.
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

/* v1.46.3 - THE ONE LINE THAT HAS TO NAME THE AGENCY.
 *
 * Malaysian consumer law requires a shop to say who operates it, so the
 * footer carries "ELFIA is a brand operated by A2Z CREATIVE MARKETING - SSM
 * ...". That is the exact opposite of the leak this guard exists to catch:
 * it is a disclosure the CEO wrote, in one named constant, and the v1.44.1
 * changelog says this exemption was added - it never was, so the store's own
 * DEPLOY.bat has been unable to get past step 6 ever since.
 *
 * The exemption is as narrow as the rule: the OPERATOR_LINE constant in
 * app/chrome.tsx, and the changelog paragraphs that quote it. Anywhere else,
 * in any other form, is still a failure. */
const isOperatorDisclosure = (file, line) => {
  if (file.endsWith("app/chrome.tsx")) return /^\s*const OPERATOR_LINE\s*=/.test(line);
  if (file.endsWith("CHANGELOG.md")) return /brand operated by/i.test(line);
  return false;
};

const hits = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    if (SKIP.has(f)) continue;
    const p = join(dir, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!EXT.test(f)) continue;
    const src = readFileSync(p, "utf8");
    /* Line by line, so the payee exemption can be pinned to one setting in
       one file rather than waved at a whole document — and so a failure
       names the line to fix. */
    src.split("\n").forEach((line, i) => {
      const norm = p.replace(/\\/g, "/");
      const isPayeeLine = norm.endsWith("worker/wrangler.toml")
        && /^\s*BANK_LINE\s*=/.test(line);
      const isOperator = isOperatorDisclosure(norm, line);
      for (const [re, what] of FORBIDDEN) {
        if (!re.test(line)) continue;
        if (isPayeeLine && what === "agency bank account") continue;  // the payee
        /* The law says the shop must name its operator; the identity and the
           registration number in THAT line are the disclosure, not a leak. */
        if (isOperator && (what === "agency identity" || what === "agency registration")) continue;
        hits.push(`${p}:${i + 1}: contains ${what}`);
      }
    });
  }
};
walk(".");

if (hits.length) { console.log("FAIL\n - " + hits.join("\n - ")); process.exit(1); }
console.log("PASS — the ELFIA store carries no other company's identity");
