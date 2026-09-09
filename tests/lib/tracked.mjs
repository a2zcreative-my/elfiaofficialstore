/**
 * WHAT GIT WOULD ACTUALLY PUBLISH — shared by the guards that walk the tree.
 *
 * v1.48.0, after the 09-09 deploy stopped here:
 *
 *     FAIL - something that looks like a credential is committed:
 *      - worker/src/index-2.ts:162 - a secret assigned a literal value: pbkdf2$...
 *
 * Two things were wrong with that, and neither was the code it named.
 *
 * 1. index-2.ts IS NOT COMMITTED AND CANNOT BE. It is a Windows copy
 *    collision - a 274 KB copy of the PORTAL's worker that landed in this
 *    folder, importing ./staff and ./watchers, which do not exist here. The
 *    .gitignore has banned `*-2.ts` since v1.46.3 and worker/tsconfig.json
 *    has excluded it from the compile gate since v1.46.2. Only the guards
 *    never got the same lesson: they walked the filesystem while their own
 *    header said "in any TRACKED file". A file git ignores can never reach
 *    GitHub, which is the entire thing these guards protect.
 *
 * 2. THE VALUE IT FOUND WAS ALL ZEROES:
 *
 *       const DUMMY_PASSWORD_HASH =
 *         `pbkdf2$${PBKDF2_ITERATIONS}$${"0".repeat(32)}$${"0".repeat(64)}`;
 *
 *    a deliberately fake hash, so that signing in as an account that does
 *    not exist burns the same CPU time as a real one and cannot be told
 *    apart by a stopwatch. The opposite of a secret.
 *
 * A guard that goes red on a file that cannot ship is not being careful, it
 * is being ignored - and the next red one, the real one, gets waved through
 * with it. So ignored files are SKIPPED and NAMED, never silently dropped:
 * the deploy is not blocked by them, and nobody gets to be surprised by a
 * 274 KB stray sitting in src/ either.
 *
 * FAIL-SAFE. If git is missing, or this is not a repository, or the command
 * errors for any reason, NOTHING is treated as ignored and every file is
 * scanned - exactly the old behaviour. The only way this helper reduces what
 * is checked is by positive proof from git itself.
 */
import { spawnSync } from "node:child_process";

/** Always forward slashes, no leading "./" - the spelling git speaks. */
export const norm = (p) => p.replace(/\\/g, "/").replace(/^\.\//, "");

/**
 * Split candidate paths into the ones git would publish and the ones it
 * ignores.
 *
 * @param {string[]} paths  repo-relative paths, any slash style
 * @returns {{ scan: string[], ignored: string[], gitAvailable: boolean }}
 */
export function splitIgnored(paths) {
  const all = paths.map(norm);
  if (all.length === 0) return { scan: [], ignored: [], gitAvailable: true };

  /* One batch call. `git check-ignore --stdin` prints the paths it ignores
     and exits 1 when there are none - which is a normal answer, not an
     error, so exit codes are not used to decide anything here. */
  const res = spawnSync("git", ["check-ignore", "--stdin"], {
    input: all.join("\n"),
    encoding: "utf8",
    shell: false,
  });

  /* status 128 = not a repo / git broken. null status = git not found or it
     was killed. Either way: prove nothing, skip nothing. */
  if (res.error || res.status === null || res.status === 128) {
    return { scan: all, ignored: [], gitAvailable: false };
  }

  const ignored = new Set(
    (res.stdout ?? "").split("\n").map((l) => norm(l.trim())).filter(Boolean),
  );
  return {
    scan: all.filter((p) => !ignored.has(p)),
    ignored: all.filter((p) => ignored.has(p)),
    gitAvailable: true,
  };
}

/**
 * Files git TRACKS even though .gitignore says it should not.
 *
 * This is the pathology behind the whole 09-09 episode. Every stray was
 * already named in .gitignore - `*-1.md`, `*-2.ts`, `out/`, the logs - and
 * every one of them was tracked anyway, because they were committed BEFORE
 * those rules were written and a .gitignore rule has no effect on a file git
 * already tracks. Nothing ever said so. `git check-ignore` reported them as
 * NOT ignored (which is correct, and reads as a clean bill of health), the
 * ignore file looked comprehensive, and 895 KB of the A2Z portal's changelog
 * - agency identity, registration number, bank account - sat committed in
 * the shop's repository for four days.
 *
 * One command names that class exactly. It is reported as a warning rather
 * than a failure: whether a tracked file should be removed is a decision
 * with history attached, not something a build gate should force at 2am.
 */
export function warnTrackedButIgnored() {
  const res = spawnSync("git", ["ls-files", "--cached", "--ignored", "--exclude-standard"], {
    encoding: "utf8", shell: false,
  });
  if (res.error || res.status !== 0) return [];
  const rows = (res.stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  if (rows.length === 0) return [];
  console.log(`warn   ${rows.length} file(s) are TRACKED by git even though .gitignore names them.`);
  console.log("       A .gitignore rule does nothing to a file that was already committed.");
  for (const p of rows.slice(0, 12)) console.log(`         ${p}`);
  if (rows.length > 12) console.log(`         ...and ${rows.length - 12} more`);
  console.log("       PUSH.bat untracks these itself (step 1b) - if you are seeing this, the untrack step did not run or git refused it. CLEAN-STRAYS.bat does the same by hand.");
  return rows;
}

/** Print the skipped files so a stray is visible without being fatal. */
export function reportIgnored(ignored, gitAvailable) {
  if (!gitAvailable) {
    console.log("note   git could not be consulted - every file was scanned, including any duplicates");
    return;
  }
  if (ignored.length === 0) return;
  console.log(`note   ${ignored.length} file(s) skipped because git ignores them - they cannot reach GitHub:`);
  for (const p of ignored.slice(0, 10)) console.log(`         ${p}`);
  if (ignored.length > 10) console.log(`         ...and ${ignored.length - 10} more`);
  console.log("       A -1/-2/-3 name is a Windows copy collision. Delete it - it is always a copy of something that lives elsewhere.");
}
