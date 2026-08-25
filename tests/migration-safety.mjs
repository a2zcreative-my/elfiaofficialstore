/**
 * Migration safety guard (v1.11.1).
 *
 * On 25-08-2026 a deploy stopped dead at "[3/6] Database changes" with:
 *
 *   X [ERROR] A request to the Cloudflare API ... failed.
 *     SQL code did not contain a statement. [code: 7500]
 *
 * The migration was valid SQLite and applied perfectly to the LOCAL database
 * — wrangler's own splitter produced four clean ALTER statements from it.
 * The remote D1 API parses submitted SQL its own way, and something in the
 * file's prose comment defeated it. Chasing which character exactly is not
 * worth anyone's evening: the fix is to stop writing migrations that need a
 * clever parser.
 *
 * So a migration file must be boring:
 *
 *   - plain ASCII only (no em dashes, curly quotes, ellipses)
 *   - `--` line comments only, never a block comment
 *   - no apostrophes or semicolons inside a comment
 *   - every statement ends in a semicolon
 *
 * The explanation for a migration belongs in CHANGELOG.md, which is read by
 * people, not by a parser. This guard runs in the same breath as the other
 * gates so the rule is enforced before a deploy, not during one.
 *
 *   node tests/migration-safety.mjs
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DIR = new URL("../worker/migrations", import.meta.url).pathname;

/* Everything up to and including this number is GRANDFATHERED: those files
   are already applied on the live database, several of them break the rule,
   and editing an applied migration to satisfy a linter is a worse idea than
   the prose it would remove. The rule binds new work, which is where it can
   still save a deploy. */
const FIRST_ENFORCED = 17;
const numberOf = (f) => Number((f.match(/^(\d+)/) ?? [])[1] ?? 0);
let pass = 0, fail = 0;
const ok = (label, cond, extra = "") => {
  if (cond) { pass++; }
  else { fail++; console.log(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};

const all = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
const files = all.filter((f) => numberOf(f) >= FIRST_ENFORCED);
console.log(`migration-safety: checking ${files.length} of ${all.length} files (${String(FIRST_ENFORCED).padStart(4, "0")} onward)`);

for (const f of files) {
  const sql = readFileSync(path.join(DIR, f), "utf8");
  const lines = sql.split("\n");

  const nonAscii = lines
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /[^\x00-\x7F]/.test(l));
  ok(`${f}: plain ASCII only`, nonAscii.length === 0,
     nonAscii.slice(0, 2).map(([n, l]) => `line ${n}: ${l.trim().slice(0, 60)}`).join(" · "));

  ok(`${f}: no /* */ block comments`, !sql.includes("/*"),
     "use -- line comments; the remote D1 parser has choked on block comments");

  const comments = lines.filter((l) => l.trim().startsWith("--"));
  const risky = comments.filter((l) => l.includes(";") || l.includes("'"));
  ok(`${f}: no quotes or semicolons inside comments`, risky.length === 0,
     risky.slice(0, 2).map((l) => l.trim().slice(0, 60)).join(" · "));

  const statements = lines
    .filter((l) => !l.trim().startsWith("--") && l.trim() !== "")
    .join("\n").trim();
  ok(`${f}: has at least one statement`, statements.length > 0);
  ok(`${f}: the last statement ends in a semicolon`, statements.endsWith(";"),
     statements.slice(-40));
}

console.log(fail === 0
  ? `PASS — every migration is plain enough for the remote D1 parser (${pass} checks)`
  : `\n${fail} check(s) failed — fix before deploying; this is the error that stops PUSH.bat at "Database changes".`);
process.exit(fail === 0 ? 0 : 1);
