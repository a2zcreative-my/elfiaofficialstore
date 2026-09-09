/**
 * In-app browser guard (store) — the Maybank "Access denied" of 29-08-2026.
 *
 * Malaysian bank logins refuse to run inside an app's embedded browser. Most
 * of this shop's customers arrive by tapping a TikTok link, so most of them
 * meet that refusal. The order page warns them before they type their bank
 * credentials into a page that was always going to say no.
 *
 * The warning is only as good as the detection, and the detection is user
 * agent guesswork — so these are real strings, and the two that matter most
 * are the ones that LOOK like Safari and Chrome until you read further.
 *
 *   node tests/in-app-browser.mjs
 */
import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

/* v1.48.3 - THIS GUARD HAD NEVER RUN ON WINDOWS. PUSH.bat only began running
   the store's guards on 09-09 (v1.48.0); before that, this file had only ever
   run in a Linux build container, where the three shortcuts below happen to
   work. On the CEO's PC every one of them broke, in the same ways the portal's
   guards broke in v1.139.1-v1.139.3:

     1. `new URL("..", import.meta.url).pathname` is "/C:/Users/..." - a URL
        path with a leading slash, not a file path - so path.join produced
        "\C:\Users\..." and esbuild could not resolve it. fileURLToPath.
     2. `--outfile=/tmp/iab.mjs` names a POSIX temp dir. os.tmpdir().
     3. `await import("/tmp/iab.mjs")` hands Node a bare path where it needs a
        file:// URL on Windows (ERR_UNSUPPORTED_ESM_URL_SCHEME). pathToFileURL.

   Paths given to esbuild on a shell command line are written with forward
   slashes and quoted, so a folder with a space in its name cannot split the
   argument. The bundle is per-process and removed afterwards, so two runs
   cannot tread on each other's output. */
const root = fileURLToPath(new URL("..", import.meta.url));
const forShell = (p) => `"${p.replace(/\\/g, "/")}"`;
const bundle = path.join(tmpdir(), `elfia-iab-${process.pid}.mjs`);
execSync(`npx esbuild ${forShell(path.join(root, "lib/in-app-browser.ts"))} --format=esm --outfile=${forShell(bundle)}`, { stdio: "pipe" });
const { detectInAppBrowser, escapeHatch } = await import(pathToFileURL(bundle).href);
try { rmSync(bundle); } catch { /* a leftover temp file is not a failed guard */ }

let pass = 0;
const fails = [];
const ok = (label, cond, extra = "") => { if (cond) pass++; else fails.push(`${label}${extra ? ` — ${extra}` : ""}`); };

/* Real user agents. The TikTok and Instagram ones both contain "Safari" and
   "Chrome"; a naive check calls them ordinary browsers and the customer gets
   no warning at all. */
const IN_APP = [
  ["TikTok iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_34.5.0 JsSdk/2.0 NetType/WIFI", "TikTok", "ios"],
  ["TikTok Android", "Mozilla/5.0 (Linux; Android 13; SM-A536E Build/TP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6", "TikTok", "android"],
  ["Instagram iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 322.0.0.0 (iPhone14,3; iOS 17_4)", "Instagram", "ios"],
  ["Facebook Android", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/452.0.0.34.109;]", "Facebook", "android"],
  ["Generic Android webview", "Mozilla/5.0 (Linux; Android 12; Redmi Note 10 Build/SKQ1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.0.0 Mobile Safari/537.36", "an app", "android"],
];
for (const [label, ua, app, platform] of IN_APP) {
  const b = detectInAppBrowser(ua);
  ok(`${label} is detected`, b.inApp, "the customer gets no warning and meets the bank's refusal blind");
  ok(`${label} is named "${app}"`, b.app === app, `got "${b.app}"`);
  ok(`${label} platform is ${platform}`, b.platform === platform, `got "${b.platform}"`);
  ok(`${label} gets a platform-correct instruction`,
     platform === "ios" ? /Safari/.test(escapeHatch(b)) : /browser/.test(escapeHatch(b)),
     "a wrong instruction is worse than none");
}

/* Real browsers must NOT be warned. A false positive on every visitor turns
   the warning into wallpaper, and then nobody reads it when it is true. */
const REAL = [
  ["Chrome Android", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.6367.82 Mobile Safari/537.36"],
  ["Safari iOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"],
  ["Chrome desktop", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"],
  ["Samsung Internet", "Mozilla/5.0 (Linux; Android 13; SAMSUNG SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36"],
];
for (const [label, ua] of REAL) {
  const b = detectInAppBrowser(ua);
  ok(`${label} is NOT warned`, !b.inApp, `falsely called "${b.app}" — a warning everyone sees is a warning nobody reads`);
}

ok("an empty user agent is not warned", !detectInAppBrowser("").inApp);
ok("a non-in-app browser gets no instruction", escapeHatch(detectInAppBrowser("Mozilla/5.0")) === "");

/* The warning must never become a gate. */
const page = readFileSync(path.join(root, "app/order/page.tsx"), "utf8");
ok("the pay button is not disabled by the detection",
   !/disabled=\{[^}]*browser\.inApp/.test(page),
   "detection is guesswork and some webviews do pay — warn, never block");
ok("bank transfer is still offered in the warning", /bank transfer below/i.test(page));

console.log(fails.length === 0
  ? `PASS — in-app browsers are caught, real browsers are left alone (${pass} checks)`
  : `\n${fails.map((f) => `  ✗ ${f}`).join("\n")}\n\n${fails.length} check(s) failed.`);
/* exitCode, not process.exit(): this guard `await import()`s a bundle, and a
   forced exit while the loader is still tearing down aborts Node on Windows
   (the portal's v1.148.1). Let Node drain and exit with the same status. */
process.exitCode = fails.length === 0 ? 0 : 1;
