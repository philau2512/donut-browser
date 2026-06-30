// Control-flow handlers — Phase 7
// while, stopLoop, runOtherScript, addLog, addComment

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { validateFlow } from "../lib/validate.mjs";

// Per-while-loop iteration cap (independent of engine MAX_STEPS=1000 total).
// Stored in ctx.vars under __while_state_<nodeId>.
const MAX_WHILE_ITERATIONS = 500;

// Re-export condition evaluation (mirrors ifCondition in logic.mjs)
function evaluateCondition(left, operator, right) {
  const leftStr = String(left ?? "");
  const rightStr = String(right ?? "");
  const leftNum = parseFloat(leftStr);
  const rightNum = parseFloat(rightStr);

  switch (operator) {
    case "===":
    case "==":
      return leftStr === rightStr;
    case "!==":
    case "!=":
      return leftStr !== rightStr;
    case "contains":
      return leftStr.includes(rightStr);
    case "not_contains":
      return !leftStr.includes(rightStr);
    case "starts_with":
      return leftStr.startsWith(rightStr);
    case "ends_with":
      return leftStr.endsWith(rightStr);
    case ">":
      return !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum > rightNum;
    case ">=":
      return !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum >= rightNum;
    case "<":
      return !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum < rightNum;
    case "<=":
      return !Number.isNaN(leftNum) && !Number.isNaN(rightNum) && leftNum <= rightNum;
    default:
      throw new Error(`while: unknown operator "${operator}"`);
  }
}

/** while: evaluate a condition each iteration; return "loop" to continue, "done" to exit.
 *
 * Flow wiring:
 *   - while.loop → first node in loop body
 *   - last body node.loop → while  (back-edge; excluded from cycle detection)
 *   - while.done → first node after the loop
 *
 * Iteration state is stored in ctx.vars under __while_state_<nodeId> so the
 * per-loop cap (MAX_WHILE_ITERATIONS) is independent of the global MAX_STEPS.
 * State is deleted when the loop exits normally or on error.
 */
export async function whileLoop(node, page, ctx) {
  const { leftValue, operator, rightValue } = node.params ?? {};
  if (typeof operator !== "string" || operator.trim() === "") {
    throw new Error("while: operator is required");
  }

  const stateKey = `__while_state_${node.id}`;
  const count = Number(ctx.vars[stateKey] ?? 0) + 1;

  // Per-loop iteration guard (MAX_WHILE_ITERATIONS, not global MAX_STEPS)
  if (count > MAX_WHILE_ITERATIONS) {
    delete ctx.vars[stateKey];
    throw new Error(
      `while: maximum iterations (${MAX_WHILE_ITERATIONS}) reached — infinite loop protection`,
    );
  }

  let result;
  try {
    result = evaluateCondition(leftValue ?? "", operator, rightValue ?? "");
  } catch (err) {
    delete ctx.vars[stateKey];
    throw err;
  }

  ctx.logger.info(
    node.id,
    `while[${count}] → ${JSON.stringify(leftValue)} ${operator} ${JSON.stringify(rightValue)} = ${result}`,
  );

  if (!result) {
    // Condition false — loop exits; clean up counter
    delete ctx.vars[stateKey];
    return "done";
  }

  ctx.vars[stateKey] = count;
  return "loop";
}

/** stopLoop: break out of the enclosing loop by returning "done".
 *
 * Wire stopLoop.done to the same destination as while.done (the post-loop node).
 * The engine follows the "done" edge as normal — no special engine changes needed.
 */
export async function stopLoop(node, page, ctx) {
  ctx.logger.info(node.id, "stopLoop → breaking loop");
  return "done";
}

// Maximum recursion depth for runOtherScript to prevent stack overflow.
const MAX_SCRIPT_DEPTH = 5;

/** runOtherScript: load and run another .donutflow from the same flows directory.
 *
 * The sub-script shares the current ctx.vars scope so variables set in the
 * sub-script are visible in the parent after it returns.
 *
 * Uses ctx.runSubFlow (injected by engine.mjs) instead of a dynamic import
 * back into engine.mjs to avoid circular-import overhead at module load time.
 */
export async function runOtherScript(node, page, ctx) {
  const { scriptName, vars: extraVarsJson } = node.params ?? {};
  if (typeof scriptName !== "string" || scriptName.trim() === "") {
    throw new Error("runOtherScript: scriptName is required");
  }

  // Guard: ctx.runSubFlow must be injected by engine (avoids circular import)
  if (typeof ctx.runSubFlow !== "function") {
    throw new Error("runOtherScript: ctx.runSubFlow not available — engine did not inject it");
  }

  // Depth guard — prevent infinite mutual recursion
  const depth = Number(ctx.vars.__script_depth ?? 0);
  if (depth >= MAX_SCRIPT_DEPTH) {
    throw new Error(`runOtherScript: maximum script recursion depth (${MAX_SCRIPT_DEPTH}) reached`);
  }

  if (!ctx.flowDir) {
    throw new Error("runOtherScript: ctx.flowDir not set — engine must pass flowDir via context");
  }

  // Resolve target script path (no path traversal: strip all separators)
  const safeName = scriptName.replace(/[/\\]/g, "");
  const targetPath = resolve(join(ctx.flowDir, `${safeName}.donutflow`));
  const expectedDir = resolve(ctx.flowDir);
  if (!targetPath.startsWith(expectedDir)) {
    throw new Error(`runOtherScript: path traversal rejected for scriptName "${scriptName}"`);
  }

  ctx.logger.info(node.id, `runOtherScript → loading ${targetPath}`);

  let subFlow;
  try {
    const raw = await readFile(targetPath, "utf-8");
    subFlow = validateFlow(JSON.parse(raw));
  } catch (e) {
    throw new Error(`runOtherScript: failed to load "${scriptName}" — ${e.message}`);
  }

  // Merge extra vars if provided
  if (typeof extraVarsJson === "string" && extraVarsJson.trim() !== "") {
    let extra;
    try {
      extra = JSON.parse(extraVarsJson);
    } catch (e) {
      throw new Error(`runOtherScript: vars is not valid JSON — ${e.message}`);
    }
    Object.assign(ctx.vars, extra);
  }

  // Run via injected runSubFlow — shares vars (mutations visible in parent)
  ctx.vars.__script_depth = depth + 1;
  try {
    const failed = await ctx.runSubFlow({
      flow: subFlow,
      page,
      vars: ctx.vars,
      artifactsDir: ctx.artifactsDir,
      allowedSchemes: ctx.allowedSchemes,
    });
    if (failed) {
      throw new Error(`runOtherScript: sub-script "${scriptName}" failed`);
    }
  } finally {
    ctx.vars.__script_depth = depth;
  }

  ctx.logger.info(node.id, `runOtherScript → "${scriptName}" completed`);
}

/** addLog: write a message to the run log (alias of the existing log node).
 *
 * Separate from the legacy log node so flows can use either name.
 */
export async function addLog(node, page, ctx) {
  const { message, level } = node.params ?? {};
  const msg = typeof message === "string" ? message : "";
  const lvl = typeof level === "string" ? level : "info";

  if (lvl === "error") ctx.logger.error(node.id, msg);
  else if (lvl === "warn") ctx.logger.warn(node.id, msg);
  else if (lvl === "debug") ctx.logger.debug(node.id, msg);
  else ctx.logger.info(node.id, msg);
}

/** addComment: no-op annotation node — adds a visual comment to the canvas. */
export async function addComment(node, page, ctx) {
  // Intentionally no-op — purely visual in the flow editor.
  ctx.logger.debug(node.id, `comment: ${node.params?.comment ?? "(empty)"}`);
}
