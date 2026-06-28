// @ts-nocheck
/**
 * P0 spike runner: launch Wayfern like Donut, apply fingerprint + watcher, run Gate #7.
 * Throwaway — mirrors wayfern_launch_args + fingerprint watcher without full GUI.
 *
 *   node spike-launch-gate7.mjs [--profile-id <uuid>]
 */

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";
import net from "node:net";

const WAYFERN_DISABLE_FEATURES =
  "DialMediaRouteProvider,DnsOverHttps,AsyncDns,Prefetch,PrefetchProxy,SpeculationRulesPrefetchFuture,NoStatePrefetch";

const LOCALAPPDATA = process.env.LOCALAPPDATA;
const DONUT_DEV = join(LOCALAPPDATA, "DonutBrowserDev");
/** In-process probes — unique markers so /json targets stay distinguishable. */
const LAUNCH_PROBE = "data:text/html,<html><body>fp-probe-launch</body></html>";
const NEW_PROBE = "data:text/html,<html><body>fp-probe-new</body></html>";

function log(step, msg) {
  console.log(`[spike-launch] ${step.padEnd(22)} ${msg}`);
}

function parseArgs(argv) {
  let profileId = "c82d4758-4009-4204-8dc8-ea4de5afb3e1";
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--profile-id") profileId = argv[++i];
  }
  return { profileId };
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function windowSizeFromFingerprint(fp) {
  const read = (key) => {
    const v = fp[key];
    if (v == null) return null;
    const n = typeof v === "string" ? parseInt(v, 10) : v;
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const pair = (w, h) => {
    const ww = read(w);
    const hh = read(h);
    return ww && hh ? [ww, hh] : null;
  };
  return (
    pair("windowOuterWidth", "windowOuterHeight") ||
    pair("screenAvailWidth", "screenAvailHeight") ||
    pair("screenWidth", "screenHeight")
  );
}

function buildLaunchArgs({ profilePath, port, fingerprint }) {
  const args = [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profilePath}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-mode",
    "--disable-component-update",
    "--disable-background-timer-throttling",
    "--crash-server-url=",
    "--disable-updater",
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-infobars",
    `--disable-features=${WAYFERN_DISABLE_FEATURES}`,
    "--use-mock-keychain",
    "--password-store=basic",
    "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
  ];
  const size = windowSizeFromFingerprint(fingerprint);
  if (size) {
    args.push(`--window-size=${size[0]},${size[1]}`);
    args.push("--window-position=0,0");
  }
  return args;
}

async function waitForCdp(port, attempts = 120) {
  const url = `http://127.0.0.1:${port}/json/version`;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`CDP not ready on port ${port}`);
}

async function getPageTargets(port) {
  const res = await fetch(`http://127.0.0.1:${port}/json`);
  if (!res.ok) throw new Error(`GET /json → ${res.status}`);
  const targets = await res.json();
  return targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
}

async function sendCdp(wsUrl, method, params) {
  const WebSocket = (await import("ws")).default;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const cmd = JSON.stringify({ id: 1, method, params });
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`CDP timeout: ${method}`));
    }, 15000);

    ws.on("open", () => ws.send(cmd));
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === 1) {
        clearTimeout(timer);
        ws.close();
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result ?? {});
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

function prepareFingerprintParams(fingerprintJson) {
  let fp = JSON.parse(fingerprintJson);
  if (fp.fingerprint) fp = fp.fingerprint;
  if (typeof fp.languages === "string") {
    fp.languages = fp.languages.split(",").map((s) => s.trim());
  }
  return fp;
}

async function applyFingerprintToTargets(port, params, knownUrls, filterUrl) {
  const targets = await getPageTargets(port);
  let applied = 0;
  for (const t of targets) {
    if (filterUrl && !(t.url ?? "").includes(filterUrl)) continue;
    if (knownUrls.has(t.webSocketDebuggerUrl)) continue;
    await sendCdp(t.webSocketDebuggerUrl, "Wayfern.setFingerprint", params);
    knownUrls.add(t.webSocketDebuggerUrl);
    applied++;
    log("setFingerprint", `OK on ${t.url ?? t.id ?? "page"}`);
  }
  return applied;
}

async function applyFingerprintToUrl(port, params, knownUrls, urlNeedle) {
  for (let attempt = 0; attempt < 10; attempt++) {
    const n = await applyFingerprintToTargets(port, params, knownUrls, urlNeedle);
    if (n > 0) return n;
    await new Promise((r) => setTimeout(r, 400));
  }
  return 0;
}

function mapFingerprintProbe(fp) {
  return {
    timezone: fp.timezone ?? null,
    platform: fp.platform ?? null,
    userAgent: fp.userAgent ?? null,
    hardwareConcurrency: fp.hardwareConcurrency ?? null,
    webglRenderer: fp.webglRenderer ?? fp.webglUnmaskedRenderer ?? null,
  };
}

async function readFingerprintCdp(port, urlNeedle) {
  for (let attempt = 0; attempt < 12; attempt++) {
    const targets = await getPageTargets(port);
    const target = targets.find((t) => (t.url ?? "").includes(urlNeedle));
    if (!target?.webSocketDebuggerUrl) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    try {
      const result = await sendCdp(target.webSocketDebuggerUrl, "Wayfern.getFingerprint", {});
      const fp = result.fingerprint ?? result;
      return mapFingerprintProbe(fp);
    } catch (e) {
      if (attempt === 11) throw e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw new Error(`No CDP target matching ${urlNeedle}`);
}

async function waitAfterSetFingerprint(page, ms = 2000) {
  await page.waitForLoadState("load", { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, ms));
}

/** Runtime navigator probe — only safe on tabs that did not just receive setFingerprint. */
async function readFingerprintRuntime(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
  return page.evaluate(() => ({
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
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

async function runGate7(port, fingerprintParams, knownUrls) {
  const base = `http://127.0.0.1:${port}`;

  log("Gate #6", `connectOverCDP ${base}`);
  const browser = await chromium.connectOverCDP(base);
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    await browser.close();
    throw new Error("FAIL #6 — no contexts");
  }
  const ctx = contexts[0];

  const launchPages = ctx.pages();
  log("pages()", `${launchPages.length} page(s) in launch context`);
  const launchPage = launchPages[0] ?? (await ctx.newPage());
  log("launch page url", launchPage.url());
  log("launch page", `goto probe (data URL)`);
  await launchPage.goto(LAUNCH_PROBE, { waitUntil: "commit", timeout: 30000 });

  log("launch page", "apply setFingerprint on stable data: target");
  const appliedLaunch = await applyFingerprintToUrl(port, fingerprintParams, knownUrls, "fp-probe-launch");
  if (appliedLaunch === 0) {
    await browser.close();
    throw new Error("FAIL — setFingerprint on launch probe page");
  }
  await waitAfterSetFingerprint(launchPage);
  log("launch page", "reading fingerprint via Wayfern.getFingerprint");
  const launchFp = await readFingerprintCdp(port, "fp-probe-launch");
  log("launch fingerprint", JSON.stringify(launchFp));

  log("Gate #7", "opening second new page (no manual re-apply) ...");
  const newPage = await ctx.newPage();
  await newPage.goto(NEW_PROBE, { waitUntil: "commit", timeout: 30000 });
  await waitAfterSetFingerprint(newPage, 800);
  log("new page", "reading fingerprint via Wayfern.getFingerprint (no re-apply)");
  const newFp = await readFingerprintCdp(port, "fp-probe-new");
  log("new-page fingerprint", JSON.stringify(newFp));

  try {
    const newRuntime = await readFingerprintRuntime(newPage);
    log("new-page runtime", JSON.stringify(newRuntime));
    const runtimeLeaked = [];
    for (const key of ["timezone", "platform", "userAgent", "hardwareConcurrency", "webglRenderer"]) {
      if (JSON.stringify(launchFp[key]) !== JSON.stringify(newRuntime[key])) {
        runtimeLeaked.push(`${key}: cdp=${JSON.stringify(launchFp[key])} runtime=${JSON.stringify(newRuntime[key])}`);
      }
    }
    if (runtimeLeaked.length > 0) {
      log("#7 RUNTIME", "MISMATCH — new tab navigator differs from launch CDP fingerprint:");
      for (const l of runtimeLeaked) log("  diff", l);
    } else {
      log("#7 RUNTIME", "OK — new tab navigator matches launch fingerprint");
    }
  } catch (e) {
    log("#7 RUNTIME", `SKIP — page.evaluate failed: ${e.message}`);
  }

  const leaked = [];
  for (const key of ["timezone", "platform", "userAgent", "hardwareConcurrency", "webglRenderer"]) {
    if (JSON.stringify(launchFp[key]) !== JSON.stringify(newFp[key])) {
      leaked.push(`${key}: launch=${JSON.stringify(launchFp[key])} new=${JSON.stringify(newFp[key])}`);
    }
  }

  await browser.close();

  if (leaked.length > 0) {
    log("#7 VERDICT", "MISMATCH — new page differs from launch page:");
    for (const l of leaked) log("  diff", l);
    return { ok: false, leaked };
  }
  log("#7 VERDICT", "OK — new page fingerprint matches launch page");
  return { ok: true, leaked: [] };
}

async function main() {
  const { profileId } = parseArgs(process.argv);
  const metaPath = join(DONUT_DEV, "profiles", profileId, "metadata.json");
  if (!existsSync(metaPath)) {
    console.error(`Profile metadata not found: ${metaPath}`);
    process.exit(2);
  }

  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  if (meta.browser !== "wayfern" || !meta.wayfern_config?.fingerprint) {
    console.error("Profile must be wayfern with a stored fingerprint");
    process.exit(2);
  }

  const version = meta.version;
  const chromeExe = join(DONUT_DEV, "binaries", "wayfern", version, "chrome.exe");
  if (!existsSync(chromeExe)) {
    console.error(`Wayfern binary missing: ${chromeExe}`);
    process.exit(2);
  }

  const profilePath = join(DONUT_DEV, "profiles", profileId, "profile");
  const port = await findFreePort();
  const fingerprintParams = prepareFingerprintParams(meta.wayfern_config.fingerprint);
  const args = buildLaunchArgs({ profilePath, port, fingerprint: fingerprintParams });

  log("launch", `${chromeExe} (port ${port}, profile ${meta.name})`);
  const child = spawn(chromeExe, args, {
    stdio: "ignore",
    detached: false,
  });

  const cleanup = () => {
    try {
      child.kill();
    } catch {
      /* gone */
    }
  };
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });

  child.on("exit", (code) => {
    log("browser exit", String(code));
  });

  await waitForCdp(port);
  log("CDP ready", `port ${port}`);

  const knownUrls = new Set();

  // Gate #7 applies fingerprint only on the launch probe tab inside runGate7.
  // Skipping pre-apply on chrome://newtab avoids reload races with Playwright.
  let gateResult;
  try {
    gateResult = await runGate7(port, fingerprintParams, knownUrls);
  } catch (e) {
    log("Gate #7 error", e.message);
    gateResult = { ok: false, leaked: [e.message] };
  }

  log("SUMMARY", JSON.stringify({ port, profileId, profileName: meta.name, gate7: gateResult.ok }));
  cleanup();
  process.exit(gateResult.ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[spike-launch] ERROR:", err);
  process.exit(1);
});