// Build the automation engine into a single executable sidecar — Phase 2 step 9
// (packaging gate, red-team #9). Output naming mirrors copy-proxy-binary.mjs so
// Tauri `externalBin` can resolve `automation-engine-<target-triple>[.exe]`.
//
// Packaging reality (red-team #9): the donut-proxy precedent is a Rust cargo
// binary and does NOT transfer to a Node program. Node SEA cannot cross-compile
// and playwright-core resolves its driver via require.resolve/__dirname, which
// frequently breaks inside SEA's virtual FS. `bun build --compile` bundles ESM
// + node_modules far more reliably and can target other platforms, so we prefer
// it when available and fall back to documenting the SEA path.
//
// IMPORTANT: producing the binary here does NOT prove it works. Phase 1 success
// criterion requires running connectOverCDP FROM the compiled binary against a
// live Wayfern on each target OS. This script only builds; it prints the
// verification command to run manually.

import { execSync, execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ENGINE_DIR = dirname(fileURLToPath(import.meta.url));
// Place output where Tauri externalBin expects it (same dir as donut-proxy).
const DEST_DIR = join(ENGINE_DIR, "..", "..", "binaries");
const BASE_NAME = "automation-engine";

function rustHostTarget() {
  try {
    const out = execSync("rustc -vV", { encoding: "utf-8" });
    const m = out.match(/host:\s*(.+)/);
    if (m) return m[1].trim();
  } catch {}
  return "unknown";
}

const TARGET = process.env.TARGET || rustHostTarget();
const isWindows = TARGET.includes("windows");
const outName = isWindows ? `${BASE_NAME}-${TARGET}.exe` : `${BASE_NAME}-${TARGET}`;
const outPath = join(DEST_DIR, outName);

function hasBun() {
  try {
    execSync("bun --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function buildWithBun() {
  mkdirSync(DEST_DIR, { recursive: true });
  // bun bundles engine.mjs + playwright-core into a standalone executable.
  const args = ["build", join(ENGINE_DIR, "engine.mjs"), "--compile", "--outfile", outPath];
  console.log(`[automation-engine] bun ${args.join(" ")}`);
  execFileSync("bun", args, { cwd: ENGINE_DIR, stdio: "inherit" });
}

function printSeaFallback() {
  console.log(
    [
      "",
      "[automation-engine] bun not found — single-executable build skipped.",
      "Packaging is gated by the Phase 1 spike (red-team #9). Options to evaluate:",
      "  1. bun build --compile  (recommended; install bun, then re-run this script)",
      "  2. @yao-pkg/pkg         (maintained pkg fork with Node 24 targets)",
      "  3. Node SEA             (no cross-compile; playwright-core driver resolve",
      "                           often breaks in the SEA virtual FS — verify hard)",
      "",
      "Whichever tool is chosen, the Phase 1 gate REQUIRES running:",
      `  ${outName} --flow <f> --cdp-port <p> --run-id t --profile-id t --artifacts-dir <d>`,
      "against a live Wayfern and confirming connectOverCDP works from the binary",
      "on EACH target OS before wiring sidecar.rs to spawn it.",
      "",
    ].join("\n"),
  );
}

function main() {
  if (TARGET === "unknown") {
    console.warn("[automation-engine] could not determine target triple (rustc missing).");
  }
  if (hasBun()) {
    buildWithBun();
    if (existsSync(outPath)) {
      console.log(`[automation-engine] built: ${outPath}`);
      console.log(
        "[automation-engine] NEXT (manual gate): run the binary against a live " +
          "Wayfern and confirm connectOverCDP + fingerprint safety before trusting it.",
      );
    } else {
      console.error("[automation-engine] bun build reported success but output missing.");
      process.exit(1);
    }
  } else {
    printSeaFallback();
    // Not a hard failure: in dev, Phase 3 can spawn `node engine.mjs` directly.
    // The compiled binary is only required for distribution.
  }
}

main();
