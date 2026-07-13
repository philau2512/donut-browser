// Profile result node handlers — resource allocation plan.
//
// profileSuccess — marks a profile run as succeeded:
//   1. Resolves message using variable/resource-aware interpolation.
//   2. Calls resourceManager.reportSuccess(profileId, runId) to update
//      successUsage for all active leases and apply quota/cooldown transitions.
//   3. Emits a profile-success summary event for the report layer.
//   4. Optionally stops the flow (stopFlow = true).
//
// profileFail — marks a profile run as failed:
//   1. Same as above but calls reportFail and emits profile-fail event.
//   2. Distinguishes "explicit_fail_node" from a runtime_error.
//
// These are TERMINAL (or semi-terminal) nodes. When stopFlow=true the handler
// returns the "done" outcome so engine.mjs terminates the node walk.

import { interpolateString } from "../lib/interpolate.mjs";

/**
 * @param {object} node
 * @param {import("playwright-core").Page} _page
 * @param {object} ctx
 */
export async function profileSuccess(node, _page, ctx) {
  const {
    message = "",
    includeResourceStats = false,
    stopFlow = true,
  } = node.params ?? {};

  const { logger, vars, resourceManager } = ctx;
  const profileId = vars?.PROFILE_ID ?? vars?.profile_id ?? "unknown";
  const runId = vars?.RUN_ID ?? vars?.run_id ?? "unknown";

  // Resolve message template with current vars.
  const resolvedMessage = message ? interpolateString(String(message), vars) : "";

  // Report success to ResourceManager — updates successUsage for all active leases.
  if (resourceManager) {
    resourceManager.reportSuccess(profileId, runId);
    // Persist immediately so quota survives a subsequent crash.
    await resourceManager.flush().catch(() => {});
  }

  // Collect optional resource stats snapshot for the report event.
  const resourceStats = includeResourceStats && resourceManager
    ? resourceManager.getReport()
    : undefined;

  // Emit structured profile-success event (Phase 4 report bridge picks this up).
  logger.info(null, JSON.stringify({
    __eventType: "profile-success",
    profileId,
    runId,
    message: resolvedMessage,
    ...(resourceStats ? { resourceStats } : {}),
  }));

  return stopFlow ? "done" : "success";
}

/**
 * @param {object} node
 * @param {import("playwright-core").Page} _page
 * @param {object} ctx
 */
export async function profileFail(node, _page, ctx) {
  const {
    message = "",
    reasonCode = "",
    includeLastError = true,
    includeResourceStats = false,
    stopFlow = true,
  } = node.params ?? {};

  const { logger, vars, resourceManager } = ctx;
  const profileId = vars?.PROFILE_ID ?? vars?.profile_id ?? "unknown";
  const runId = vars?.RUN_ID ?? vars?.run_id ?? "unknown";

  // Resolve message template.
  const resolvedMessage = message ? interpolateString(String(message), vars) : "";
  const resolvedReasonCode = reasonCode
    ? interpolateString(String(reasonCode), vars)
    : "";

  // Capture last error from context if available and requested.
  const lastError = includeLastError
    ? (ctx.__lastError ?? null)
    : null;

  // Report fail to ResourceManager — updates failUsage for all active leases.
  if (resourceManager) {
    resourceManager.reportFail(profileId, runId);
    await resourceManager.flush().catch(() => {});
  }

  const resourceStats = includeResourceStats && resourceManager
    ? resourceManager.getReport()
    : undefined;

  // "explicit_fail_node" distinguishes this from an unhandled runtime_error.
  logger.info(null, JSON.stringify({
    __eventType: "profile-fail",
    failSource: "explicit_fail_node",
    profileId,
    runId,
    message: resolvedMessage,
    reasonCode: resolvedReasonCode || undefined,
    lastError: lastError || undefined,
    ...(resourceStats ? { resourceStats } : {}),
  }));

  return stopFlow ? "done" : "fail";
}