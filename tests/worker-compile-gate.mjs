/* Compile gate — the Worker must typecheck before anything deploys.
   Run: node tests/worker-compile-gate.mjs (from the project root). */
import { execSync } from "node:child_process";

try {
  execSync("npx tsc --noEmit", { cwd: "worker", stdio: "pipe" });
  console.log("PASS — worker typechecks clean");
} catch (e) {
  console.log("FAIL — worker does not compile:\n" + String(e.stdout ?? e));
  process.exit(1);
}
