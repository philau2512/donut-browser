// @ts-nocheck
/**
 * Throwaway spike — Phase 1 gate for visual-node-automation.
 *
 * GOAL: prove `playwright-core` `connectOverCDP` works against a *running*
 * Wayfern (Chromium fork) profile, WITHOUT downloading a Chromium binary.
 * This is the PASS/FAIL gate for Phases 2-5. Delete after the verdict is
 * recorded in docs/automation-flow-schema.md.
 *
 * This script CANNOT run headless/unattended in CI — it needs a Wayfern
 * profile already launched with a known --remote-debugging-port. Launch a
 * profile via the Donut GUI (or `launch_browser_profile_impl`), find its CDP
 * port (WayfernManager::get_cdp_port, or `netstat`/the /json/version probe
 * below), then:
 *
 *   cd src-tauri/scripts/automation-spike
 *   npm install            # installs ONLY playwright-core — verify size after
 *   node spike.mjs --cdp-port <PORT>
 *
 * Red-team gates this script checks (see phase-01 success criteria):
 *   #6  connectOverCDP goes deep: contexts() non-empty, pages reachable,
 *       Target lifecycle works (not just "socket connected").
 *   #7  fingerprint does NOT leak on a NEW page: open context.newPage(),
 *       probe timezone/screen/GPU, compare against the launch page.
 *   #8  uses the CDP port from a non-gated launch path (GUI / impl), never
 *       the REST /run endpoint (402 for non-paid dev).
 *   #15 prints RSS hints so you can size concurrency for an 8 GB box.
 */

import { chromium } from "playwright-core";

function parseArgs(argv) {
  const args = { cdpPort: null, host: "127.0.0.1", probeUrl: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--cdp-port") args.cdpPort = Number(argv[++i]);
    else if (a === "--host") args.host = argv[++i];
    else if (a === "--probe-url") args.probeUrl = argv[++i];
  }
  return args;
}

function log(step, msg) {
  console.log(`[spike] ${step.padEnd(22)} ${msg}`);
}

async function httpJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

/** Read fingerprint-relevant signals from a page in-process (no external probe site needed). */
async function readFingerprint(page) {
  return page.evaluate(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    screen: { width: screen.width, height: screen.height, depth: screen.colorDepth },
    webglVendor: (() => {
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) : null;
      } catch {
        return null;
      }
    })(),
    webglRenderer: (() => {
      try {
        const gl = document.createElement("canvas").getContext("webgl");
        const ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
        return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null;
      } catch {
        return null;
      }
    })(),
  }));
}

async function main() {
  const { cdpPort, host, probeUrl } = parseArgs(process.argv);
  if (!cdpPort) {
    console.error(
      "Missing --cdp-port. Launch a Wayfern profile first, then pass its remote-debugging-port.\n" +
        "  node spike.mjs --cdp-port 9222 [--probe-url https://abrahamjuliot.github.io/creepjs/]"
    );
    process.exit(2);
  }

  const base = `http://${host}:${cdpPort}`;

  // --- Gate: CDP endpoint shape (Wayfern may diverge from upstream) ---
  log("probe /json/version", `GET ${base}/json/version`);
  const version = await httpJson(`${base}/json/version`);
  log("browser", version.Browser ?? "(unknown)");
  log("webSocketDebuggerUrl", version.webSocketDebuggerUrl ?? "(missing!)");

  // --- Gate #6: connectOverCDP goes deep ---
  log("connectOverCDP", `connecting to ${base} ...`);
  const browser = await chromium.connectOverCDP(base);

  const contexts = browser.contexts();
  log("contexts()", `${contexts.length} context(s) — expect >= 1, NOT empty`);
  if (contexts.length === 0) {
    log("VERDICT", "FAIL #6 — no contexts; connectOverCDP did not attach to launch context");
    await browser.close();
    process.exit(1);
  }

  const ctx = contexts[0];
  const launchPages = ctx.pages();
  log("pages()", `${launchPages.length} page(s) in launch context`);

  // Reuse an existing page if present (engine does the same — never blind newPage).
  const launchPage = launchPages[0] ?? (await ctx.newPage());
  await launchPage.goto("https://example.com", { waitUntil: "load", timeout: 30000 });
  const title = await launchPage.title();
  log("launch page title", JSON.stringify(title));
  const launchFp = await readFingerprint(launchPage);
  log("launch fingerprint", JSON.stringify(launchFp));

  // --- Gate #7: fingerprint must NOT leak on a NEW page ---
  log("#7 new-page check", "opening context.newPage() to test fingerprint spoofing ...");
  const newPage = await ctx.newPage();
  await newPage.goto("https://example.com", { waitUntil: "load", timeout: 30000 });
  const newFp = await readFingerprint(newPage);
  log("new-page fingerprint", JSON.stringify(newFp));

  const leaked = [];
  for (const key of ["timezone", "platform", "userAgent", "hardwareConcurrency", "webglRenderer"]) {
    if (JSON.stringify(launchFp[key]) !== JSON.stringify(newFp[key])) {
      leaked.push(`${key}: launch=${JSON.stringify(launchFp[key])} new=${JSON.stringify(newFp[key])}`);
    }
  }
  if (leaked.length > 0) {
    log("#7 VERDICT", "MISMATCH — new page differs from launch page. Wayfern may NOT spoof new targets:");
    for (const l of leaked) log("  diff", l);
    log("#7 ACTION", "Engine Phase 2 must reuse launch page OR re-trigger setFingerprint per new page.");
  } else {
    log("#7 VERDICT", "OK — new page fingerprint matches launch page (spoof applies to new targets).");
  }

  // Optional: external probe site for a human eyeball check.
  if (probeUrl) {
    await newPage.goto(probeUrl, { waitUntil: "load", timeout: 60000 });
    log("#7 probe", `opened ${probeUrl} — inspect manually that values match the PROFILE, not the host`);
  }

  // --- Gate #15: RAM hint ---
  const rss = process.memoryUsage().rss;
  log("#15 spike RSS", `${(rss / 1024 / 1024).toFixed(1)} MB (Node+playwright-core driver only)`);
  log("#15 note", "Add Chromium + local proxy RSS (Task Manager) per profile; size concurrency for 8GB.");

  // Disconnect — do NOT close the browser (orchestrator owns lifecycle).
  await browser.close(); // close() here only severs the CDP connection; the Wayfern process keeps running.
  log("disconnect", "CDP connection closed; Wayfern process should still be alive.");

  console.log("\n[spike] Record in docs/automation-flow-schema.md:");
  console.log("  - connectOverCDP PASS/FAIL (contexts non-empty, pages reachable)");
  console.log("  - #7 fingerprint verdict (OK / engine must reuse-or-respoof)");
  console.log("  - node_modules size (du -sh node_modules) — confirm NO chromium-* binary");
  console.log("  - per-profile RSS → safe concurrency default for 8GB");
}

main().catch((err) => {
  console.error("[spike] ERROR:", err);
  process.exit(1);
});
