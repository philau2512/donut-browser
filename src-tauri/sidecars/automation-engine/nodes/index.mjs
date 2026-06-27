// Node handler registry: type → handler(node, page, ctx).
// This is the single source of truth for the supported node-type allowlist.
// validate.mjs imports NODE_TYPES from here and asserts (at module load) that
// its per-type param schema covers exactly these types, so the dispatcher and
// validator can never drift (#7b closed schema). Param-key specs live in
// validate.mjs; this file owns only the handler wiring + the type list.

import { openUrl, scroll, wait } from "./navigation.mjs";
import { click, type } from "./interaction.mjs";
import { screenshot, log, delay } from "./util.mjs";

export const handlers = {
  openUrl,
  click,
  type,
  wait,
  scroll,
  screenshot,
  log,
  delay,
};

/** Allowlisted node types (the 8 MVP nodes). */
export const NODE_TYPES = Object.keys(handlers);

export function getHandler(nodeType) {
  return Object.prototype.hasOwnProperty.call(handlers, nodeType)
    ? handlers[nodeType]
    : null;
}
