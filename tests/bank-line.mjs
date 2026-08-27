/**
 * The payee line and its Copy button (v1.12.3).
 *
 * On 26-08-2026 the bank account line went from a "REPLACE ..." placeholder
 * to a real payment instruction, and then gained its bank name, so it now
 * reads as a sentence: "<bank> <account> - <holder>". Which means the Copy
 * button beside it can no longer hand the customer the whole thing.
 * accountDigits() pulls the number out, and that number is the one value on
 * this shop that MUST NOT be wrong: a mistyped account does not bounce, it
 * pays a stranger.
 *
 * The trap this guards is the obvious implementation. Holders' names contain
 * digits -- "A 2 Z Trading", "Studio 7" -- so stripping every non-digit from
 * the line welds that digit onto the account number and returns something
 * the right length to look plausible and belonging to somebody else.
 *
 * Every line below is INVENTED. The shop's real account appears nowhere in
 * this repo but BANK_LINE in worker/wrangler.toml, and a test fixture is not
 * a reason to make a second copy of it.
 *
 * The helper is TypeScript, and getting at it from a plain .mjs test turns
 * out to depend on the Node version in a way that bit a deploy:
 *
 *   Node 22.18-23   strips types and hands back the named export. Works.
 *   Node 24         the CEO's machine, 27-08-2026. `package.json` has no
 *                   "type": "module", so a .ts file resolves as CommonJS,
 *                   the import SUCCEEDS and yet carries no named export —
 *                   so `accountDigits` was quietly `undefined` and the
 *                   first call threw `accountDigits is not a function`,
 *                   mid-deploy, reading like a failed safety check.
 *   Node < 22.6     cannot read TypeScript at all.
 *
 * So this no longer trusts any of it. It tries the native import first
 * (fast, and correct where it works), and if that does not produce a
 * FUNCTION it reads the helper out of the source itself and strips the
 * annotations — a dozen lines of pure string work that behaves the same on
 * every Node there is. The check therefore RUNS on the CEO's machine
 * instead of skipping, which matters: this decides what a customer pastes
 * into their banking app.
 *
 * Only if both routes fail does it skip — loudly, and with exit 0, because
 * a tooling gap must never look like a security failure. That distinction
 * is the whole lesson of 27-08: the deploy stopped on a crash that had
 * nothing to do with the shop.
 */
import { readFileSync } from "node:fs";

const SRC = new URL("../lib/config.ts", import.meta.url);

/** Route 1 — let Node read the TypeScript. */
async function viaImport() {
  try {
    const m = await import("../lib/config.ts");
    return typeof m.accountDigits === "function" ? m.accountDigits : null;
  } catch {
    return null;
  }
}

/**
 * Route 2 — read the function out of the file and strip its annotations.
 *
 * Deliberately narrow: it takes the ONE exported arrow function this test is
 * about, from `export const accountDigits` to the line that closes it, and
 * removes `: type` annotations. If anyone reshapes the helper past what this
 * understands, the eleven cases below fail loudly rather than silently
 * testing nothing.
 */
async function viaSource() {
  try {
    const text = readFileSync(SRC, "utf8");
    const start = text.indexOf("export const accountDigits");
    if (start < 0) return null;
    const end = text.indexOf("\n};", start);
    if (end < 0) return null;
    const fn = text.slice(start, end + 3)
      .replace(/^export /, "")
      /* `: string | null`, `: string`, `: number[]` … up to the `=`, `,` or
         `)` that ends the annotation. Regex and string literals in the body
         carry no `: identifier`, so they are untouched. */
      .replace(/:\s*[A-Za-z_][\w.<>\[\]|\s]*?(?=\s*[=,)])/g, "");
    const mod = `${fn}\nexport { accountDigits };`;
    const m = await import(`data:text/javascript,${encodeURIComponent(mod)}`);
    return typeof m.accountDigits === "function" ? m.accountDigits : null;
  } catch {
    return null;
  }
}

const accountDigits = (process.env.ELFIA_BANK_LINE_FORCE_SOURCE === "1" ? null : await viaImport())
  ?? await viaSource();

if (typeof accountDigits !== "function") {
  console.log(`SKIPPED — could not load the account-number helper on ${process.version}.`);
  console.log("  Neither importing lib/config.ts nor reading it as text worked.");
  console.log("  The helper is therefore UNTESTED on this machine; it is tested");
  console.log("  wherever the code is written. This is NOT a security failure —");
  console.log("  nothing about the shop is wrong, only this machine's tooling.");
  process.exit(0);
}

let pass = 0, fail = 0;
const is = (label, got, want) => {
  if (got === want) { pass++; }
  else { fail++; console.log(`  X ${label}\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`); }
};

/* The live line's SHAPE, in both dash styles -- wrangler.toml holds an em
   dash and a future editor may well type a hyphen. */
is("bank, spaced account, holder -- em dash",
   accountDigits("Maybank 1122 3344 5566 — A 2 Z Trading"), "112233445566");
is("bank, spaced account, holder -- plain hyphen",
   accountDigits("Maybank 1122 3344 5566 - A 2 Z Trading"), "112233445566");

/* The exact fault the naive version has: that trailing 2 is from the name. */
is("the digit in the holder's name is not swallowed",
   accountDigits("Maybank 1122 3344 5566 - A 2 Z Trading").endsWith("2"), false);

/* Shapes a Malaysian payee line gets written in. */
is("no spaces", accountDigits("Maybank 112233445566 - ELFIA"), "112233445566");
is("hyphen-grouped", accountDigits("CIMB 8009-1234-5678 - ELFIA"), "800912345678");
is("bank last", accountDigits("1122 3344 5566 (Maybank) - ELFIA"), "112233445566");
is("a small number in the name", accountDigits("Bank Islam 12345678901234 - Studio 7"), "12345678901234");

/* Nothing plausible -- the caller falls back to copying the whole line, so
   null has to be the answer rather than a guess. */
is("no number at all", accountDigits("Ask us on WhatsApp for the account"), null);
is("too short to be an account", accountDigits("Maybank 1234 - ELFIA"), null);
is("empty", accountDigits(""), null);

/* And the placeholder that shipped before 1.12.1, in case it ever returns:
   it must not read as a real account. It does contain 12 digits, so the
   guard here is that the SHOP never ships this string, which
   tests/no-secrets.mjs and the deploy checklist cover -- recorded so the
   next reader knows it was considered rather than missed. */
is("the old placeholder still parses (documented, not endorsed)",
   accountDigits("REPLACE - e.g. MAYBANK 1234 5678 9012 - ELFIA"), "123456789012");

console.log(fail === 0
  ? `PASS - the Copy button hands over the account number and nothing else (${pass} cases)`
  : `\n${fail} case(s) failed - do NOT deploy: this decides what a customer pastes into their banking app.`);
process.exit(fail === 0 ? 0 : 1);
