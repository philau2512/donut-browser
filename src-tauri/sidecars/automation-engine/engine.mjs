// Automation engine entry point — Phase 2.
//
// Invoked per-profile by the Rust orchestrator (Phase 3) as a single-executable
// sidecar. Connects to an already-running Wayfern over CDP, walks the flow
// graph, executes each node with Playwright, and streams JSON-line logs to
// stdout. It NEVER spawns or closes the browser — the orchestrator owns that.
//
// CLI contract (stable across .mjs dev runs and the compiled binary):
//   automation-engine --flow <file> --cdp-port <n> --vars <json>
//     --run-id <id> --profile-id <id> --artifacts-dir <dir>
//     [--continue-default <bool>] [--allowed-schemes http:,https:]
//
// Exit codes:
//   0 = every node ok, OR a node failed but was skipped (continueOnError)
//   1 = a node failed with continueOnError=false → flow stopped
//   2 = setup failure (bad args, flow invalid, CDP connect failed)

import { readFile } from "node:fs/promises";
import { chromium } from "playwright-core";

import { validateFlow } from "./lib/validate.mjs";
import { interpolateParams } from "./lib/interpolate.mjs";
import { Logger, createRedactor } from "./lib/logger.mjs";
import { getHandler } from "./nodes/index.mjs";

const EXIT_OK = 0;
const EXIT_NODE_FAILED = 1;
const EXIT_SETUP = 2;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

/** Order nodes by following edges from a root (Phase 2: linear chain). */
export function topoOrder(flow) {
  const incoming = new Map(flow.nodes.map((n) => [n.id, 0]));
  for (const e of flow.edges) incoming.set(e.to, (incoming.get(e.to) ?? 0) + 1);

  // Root = node with no incoming edge (first one in declaration order wins ties).
  const root = flow.nodes.find((n) => (incoming.get(n.id) ?? 0) === 0) ?? flow.nodes[0];

  const byId = new Map(flow.nodes.map((n) => [n.id, n]));
  const nextOf = new Map();
  for (const e of flow.edges) {
    if (!nextOf.has(e.from)) nextOf.set(e.from, []);
    nextOf.get(e.from).push(e.to);
  }

  const order = [];
  const seen = new Set();
  let cur = root;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    order.push(cur);
    const nexts = nextOf.get(cur.id) ?? [];
    cur = nexts.length > 0 ? byId.get(nexts[0]) : null;
  }
  // Append any unreachable nodes so a malformed-but-acyclic flow still runs all.
  for (const n of flow.nodes) {
    if (!seen.has(n.id)) order.push(n);
  }
  return order;
}

async function resolvePage(browser, logger) {
  // #7 fingerprint leak: do NOT create a new page by default. Wayfern only
  // spoofs targets that exist at launch time; a CDP-created page may expose the
  // REAL fingerprint. Reuse the launch-time page. If none exists, fail loudly —
  // the orchestrator should always launch with an initial page/tab.
  const contexts = browser.contexts();
  if (contexts.length === 0) {
    throw new Error(
      "connectOverCDP returned no browser context — cannot reuse launch page (refusing to newPage(): would risk real-fingerprint leak, red-team #7)",
    );
  }
  const context = contexts[0];
  const pages = context.pages();
  if (pages.length === 0) {
    throw new Error(
      "Browser context has no open page — orchestrator must launch with an initial tab (refusing newPage() for fingerprint safety, red-team #7)",
    );
  }
  logger.debug(null, `reusing launch page (contexts=${contexts.length}, pages=${pages.length})`);
  return pages[0];
}

export async function runFlow({ flow, page, vars, artifactsDir, allowedSchemes, continueDefault, logger }) {
  const order = topoOrder(flow);
  const ctx = { logger, vars, artifactsDir, allowedSchemes };
  let failed = false;

  for (const node of order) {
    const interpolated = { ...node, params: interpolateParams(node.params ?? {}, vars) };
    const handler = getHandler(node.type);
    if (!handler) {
      // Validation should have caught this; defense in depth.
      logger.error(node.id, `no handler for node type: ${node.type}`);
      if (!(node.continueOnError ?? continueDefault)) {
        failed = true;
        break;
      }
      continue;
    }

    logger.info(node.id, `▶ ${node.type}`);
    try {
      await handler(interpolated, page, ctx);
      logger.info(node.id, `✓ ${node.type}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(node.id, `✗ ${node.type}: ${msg}`);
      const cont = node.continueOnError ?? continueDefault;
      if (cont) {
        logger.warn(node.id, `continueOnError → skipping failed node, proceeding`);
      } else {
        failed = true;
        break;
      }
    }
  }
  return failed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Bare logger for setup-phase errors (no redaction needed pre-vars).
  const bootLog = new Logger({ runId: args["run-id"] ?? "?", profileId: args["profile-id"] ?? "?" });

  const required = ["flow", "cdp-port", "run-id", "profile-id", "artifacts-dir"];
  for (const k of required) {
    if (!args[k]) {
      bootLog.error(null, `missing required arg: --${k}`);
      return EXIT_SETUP;
    }
  }

  let vars = {};
  if (args.vars) {
    try {
      vars = JSON.parse(args.vars);
    } catch (e) {
      bootLog.error(null, `--vars is not valid JSON: ${e.message}`);
      return EXIT_SETUP;
    }
  }

  const allowedSchemes = args["allowed-schemes"]
    ? String(args["allowed-schemes"]).split(",").map((s) => s.trim()).filter(Boolean)
    : undefined;
  const continueDefault = args["continue-default"] === "true" || args["continue-default"] === true;

  let flow;
  try {
    const raw = await readFile(args.flow, "utf-8");
    flow = validateFlow(JSON.parse(raw));
  } catch (e) {
    bootLog.error(null, `flow load/validate failed: ${e.message}`);
    return EXIT_SETUP;
  }

  const redact = createRedactor(vars);
  const logger = new Logger({ runId: args["run-id"], profileId: args["profile-id"], redact });

  const cdpUrl = `http://127.0.0.1:${args["cdp-port"]}`;
  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
  } catch (e) {
    logger.error(null, `connectOverCDP(${cdpUrl}) failed: ${e.message}`);
    return EXIT_SETUP;
  }

  try {
    const page = await resolvePage(browser, logger);
    logger.info(null, `flow "${flow.name}" started (${flow.nodes.length} nodes)`);
    const failed = await runFlow({
      flow,
      page,
      vars,
      artifactsDir: args["artifacts-dir"],
      allowedSchemes,
      continueDefault,
      logger,
    });
    logger.info(null, failed ? `flow stopped on error` : `flow completed`);
    return failed ? EXIT_NODE_FAILED : EXIT_OK;
  } catch (e) {
    logger.error(null, `fatal: ${e.message}`);
    return EXIT_SETUP;
  } finally {
    // Disconnect WITHOUT closing the browser — orchestrator owns lifecycle.
    try {
      await browser.close();
    } catch {
      // close() on a CDP connection detaches the client; it does not kill the
      // remote browser. Ignore disconnect errors.
    }
  }
}

// Only run main when executed directly (not when imported by tests).
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`;
if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      process.stderr.write(`unhandled: ${e?.stack ?? e}\n`);
      process.exit(EXIT_SETUP);
    });
}

export { EXIT_OK, EXIT_NODE_FAILED, EXIT_SETUP, parseArgs };
