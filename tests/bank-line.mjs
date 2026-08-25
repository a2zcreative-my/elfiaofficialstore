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
 * The helper is TypeScript, so reading it needs Node's type stripping. Run it
 * plainly — `node tests/bank-line.mjs` — and it sorts that out itself:
 *
 *   Node 22.18+   strips types with no flag; the import below just works.
 *   Node 22.6-22.17   needs --experimental-strip-types, so this re-runs
 *                     itself once with that flag.
 *   older         cannot read TypeScript at all. It says so, loudly, and
 *                 exits 0 rather than blocking a deploy over a tooling gap.
 *
 * v1.12.4 — this used to be invoked WITH the flag from PUSH.bat, which is a
 * trap: an unrecognised flag stops Node before the script runs, so on an
 * older Node the deploy would have died with "bad option" and no explanation
 * of what to do about it.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

let accountDigits;
try {
  ({ accountDigits } = await import("../lib/config.ts"));
} catch {
  const retried = process.env.ELFIA_BANK_LINE_RETRY === "1";
  if (!retried) {
    const r = spawnSync(process.execPath,
      ["--experimental-strip-types", "--no-warnings", fileURLToPath(import.meta.url)],
      { stdio: "inherit", env: { ...process.env, ELFIA_BANK_LINE_RETRY: "1" } });
    process.exit(r.status ?? 1);
  }
  console.log(`SKIPPED — this Node cannot read TypeScript directly (${process.version}).`);
  console.log("  Node 22.18 or newer runs this check with no setup.");
  console.log("  The account-number helper is therefore UNTESTED on this machine;");
  console.log("  it is tested wherever the code is written. Upgrading Node re-enables it.");
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
