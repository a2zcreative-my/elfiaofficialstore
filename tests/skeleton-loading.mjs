/**
 * Skeleton-loading guard (store) — v1.44.0.
 *
 * CEO, 31-08-2026: *"I want no loading without skeleton loading react …
 * audit all the files to ensure that no loading leak without skeleton
 * loading react either in web or mobile view apps for both my web."*
 *
 * The audit of this shop found three things.
 *
 *   1. TEN PLACES SAID "Loading…" IN WORDS — the account page while it
 *      checked who you were, the order and product pages while they fetched,
 *      the three Suspense fallbacks, the count lines on the cart, shop and
 *      wishlist, and the catalog's "Loading the collection…".
 *
 *   2. ONE SPINNER, on the order page while a payment was being confirmed.
 *
 *   3. NINE OF THE TWELVE PAGES THAT FETCH ON MOUNT DREW NOTHING — or an
 *      empty state — until the data arrived. The account page said "No
 *      orders on this account yet" while the orders were still on their
 *      way; checkout's summary read RM 0.00 for a full cart; the admin
 *      showed the passcode form to someone whose cookie was about to sign
 *      them in. Three pages (home, shop, wishlist) had CardSkeleton.
 *
 * RULES, each mechanical:
 *
 *   R1  No loading state is described in words. No "Loading…", no
 *       "Memuatkan…". (A button relabelled "Paying…" or "Saving…" during
 *       its own action is feedback on an action, not a loading state, and
 *       stays. `loading="lazy"` on an image is not a loading state. The
 *       state-string literal "loading" is a value, not a sentence.)
 *   R2  No spinner. `animate-spin` does not appear anywhere in app/.
 *   R4  Every component that fetches when it mounts renders a skeleton
 *       until the data lands. Detected, not declared: a function component
 *       whose body has a useEffect and a fetch must reference a Skel
 *       primitive or a *Skeleton component. No opt-out comment, because
 *       opt-outs get copied.
 *   R5  Nothing returns `null` on a loading flag. `if (!loaded) return null`
 *       is a blank screen with a name.
 *
 *   (There is no R3: the portal's R3 checks its AppShell geometry, and this
 *   shop has no AppShell — each page's skeleton is written in that page's
 *   own layout and checked by eye against it.)
 *
 *   node tests/skeleton-loading.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url).pathname;
const read = (p) => readFileSync(path.join(root, p), "utf8");

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => {
  if (cond) pass++;
  else fails.push(`${label}${extra ? ` — ${extra}` : ""}`);
};

const files = [];
const walk = (dir) => {
  for (const e of readdirSync(path.join(root, dir))) {
    if (e === "node_modules" || e === ".next") continue;
    const rel = `${dir}/${e}`;
    if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
    else if (/\.tsx$/.test(e)) files.push(rel);
  }
};
walk("app");
ok("there are client files to check", files.length > 12, `found ${files.length}`);

/* Strip comments so prose about loading is not read as a loading state. */
const codeOnly = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/^(\s*)\/\/.*$/gm, "$1");

/* ---- R1 / R2 ---- */
{
  const words = [];
  const spinners = [];
  for (const rel of files) {
    const lines = codeOnly(read(rel)).split(/\r?\n/);
    lines.forEach((l, i) => {
      /* A loading state in words: "Loading…", "Loading the collection…",
         "Memuatkan…". Not the state-machine literal "loading", not
         loading="lazy", not a button saying "Uploading…". */
      const display = l.replace(/loading=["']lazy["']/g, "").replace(/["']loading["']/g, "");
      if (/(^|[^A-Za-z])Loading(…|\.\.\.|\s+(the|your|a)\b|<|["'`])/.test(display) ||
          /Memuatkan/.test(display)) {
        words.push(`${rel}:${i + 1}`);
      }
      if (/animate-spin/.test(l)) spinners.push(`${rel}:${i + 1}`);
    });
  }
  ok("no loading state is described in words", words.length === 0,
     `${words.join(", ")} — a skeleton in the shape of what is coming, not a sentence about waiting`);
  ok("no spinner anywhere in the shop", spinners.length === 0, spinners.join(", "));
}

/* ---- the primitives exist, in the house style ---- */
{
  const ui = read("app/ui.tsx");
  for (const name of ["Skel", "SkelText", "SkelRows", "PageSkeleton", "CardSkeleton"]) {
    ok(`app/ui.tsx exports ${name}`, new RegExp(`export function ${name}\\(`).test(ui),
       "every page's skeleton is built from these, so the pulse and the colour are the same everywhere");
  }
  ok("the skeleton primitives pulse in the house colour",
     /animate-pulse rounded bg-elfia-blush\/70/.test(ui),
     "Skel must carry animate-pulse + bg-elfia-blush/70 — the style CardSkeleton set");
  ok("the Skel block is hidden from screen readers", /export function Skel\([\s\S]*?aria-hidden/.test(ui));
}

/* ---- R4 / R5: every component that fetches on mount shows a skeleton ---- */
{
  const missing = [];
  const nullOnLoading = [];
  let fetching = 0;
  const seen = [];
  for (const rel of files) {
    const src = read(rel);
    if (!/\bapi[<(]|\bfetch\(/.test(src)) continue;
    const code = codeOnly(src);
    const comps = [...code.matchAll(/^(?:export )?(?:default )?function ([A-Z]\w*)\(/gm)]
      .map((m) => ({ name: m[1], at: m.index }));
    for (let i = 0; i < comps.length; i++) {
      const body = code.slice(comps[i].at, comps[i + 1]?.at ?? code.length);
      /* Fetches on mount: an effect AND a call. A component that only calls
         the API when a button is pressed (NotifyMe, the track form) has
         nothing to skeleton. */
      if (!/useEffect\(/.test(body) || !/\bapi[<(]|\bfetch\(/.test(body)) continue;
      fetching++;
      seen.push(`${rel} :: ${comps[i].name}`);
      if (!/<Skel|Skeleton\b/.test(body)) missing.push(`${rel} :: ${comps[i].name}`);
      const m = body.match(/if \(!?\(?[^)]*\b(loaded|loading|checked|ready|probed|priced)\b[^)]*\)?\) return null;/);
      if (m) nullOnLoading.push(`${rel} :: ${comps[i].name} — ${m[0]}`);
    }
  }
  ok("components that fetch on mount were found", fetching >= 12,
     `${fetching} — a low count means the detector went blind, not that the shop got simpler`);
  ok("every component that fetches on mount shows a skeleton until the data lands", missing.length === 0,
     `\n      ${missing.join("\n      ")}\n      — ${missing.length} of ${fetching}; each draws nothing, or an empty state, while loading`);
  ok("nothing returns null on a loading flag", nullOnLoading.length === 0,
     `\n      ${nullOnLoading.join("\n      ")}\n      — a blank screen with a name`);
  if (process.env.VERBOSE) console.log(`  (${fetching} fetch on mount:\n     ${seen.join("\n     ")})`);
}

/* ---- the three Suspense boundaries fall back to a skeleton, not a sentence ---- */
{
  const bad = [];
  let boundaries = 0;
  for (const rel of files) {
    const code = codeOnly(read(rel));
    for (const m of code.matchAll(/<Suspense fallback=\{([^}]*)\}/g)) {
      boundaries++;
      if (!/Skel/.test(m[1])) bad.push(`${rel} — fallback={${m[1].trim()}}`);
    }
  }
  ok("Suspense boundaries were found", boundaries >= 3, `${boundaries}`);
  ok("every Suspense fallback is a skeleton", bad.length === 0,
     `\n      ${bad.join("\n      ")}\n      — the fallback is the FIRST thing a customer sees on /p, /order and /shop`);
}

/* ---- DEPLOY.bat runs this ---- */
{
  const bat = read("DEPLOY.bat");
  ok("DEPLOY.bat runs this guard", /call node tests\\skeleton-loading\.mjs/.test(bat),
     "a guard that is not in the deploy script is a guard nobody runs");
}

console.log(
  fails.length === 0
    ? `PASS — nothing loads without a skeleton in its own shape (${pass} checks, ${files.length} files)`
    : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`,
);
process.exit(fails.length === 0 ? 0 : 1);
