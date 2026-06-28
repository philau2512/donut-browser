// Closed-schema validator for .donutflow v1 — Phase 2 (red-team #7b).
//
// A flow is UNTRUSTED input (may be imported from another user — see Phase 5
// #14). The validator is the first gate: it rejects unknown node types and
// unknown params (closed schema) so a crafted flow cannot smuggle data through
// to a handler's param switch. It does NOT execute anything.
//
// Schema v1 (mirrors docs/automation-flow-schema.md):
//   { version: 1, name, variables?: {}, nodes: [...], edges: [...] }
// Each node: { id, type, params?: {}, continueOnError?: bool }
// Each edge: { from, to }

import { isAllowedUrlScheme } from "./url-guard.mjs";

export const SCHEMA_VERSION = 1;

// Per-node-type param spec. `required` must be present; `optional` may be
// present; anything else => reject (closed schema). Param NAMES must match the
// handler destructuring in nodes/*.mjs exactly — a cross-check below asserts the
// set of node types here equals the registry, so the two cannot silently drift.
export const NODE_SCHEMAS = {
  // Navigator
  openUrl: {
    required: { url: "string" },
    optional: { timeout: "number", waitUntil: "string" },
  },
  newTab: {
    required: {},
    optional: { url: "string", timeout: "number" },
  },
  switchTab: {
    required: {},
    optional: {
      index: "number",
      urlPattern: "string",
      tabIndex: "number",
      urlFilter: "string",
      urlMode: "string",
      titleFilter: "string",
      titleMode: "string",
    },
  },
  closeTab: {
    required: {},
    optional: {},
  },
  reloadPage: {
    required: {},
    optional: {},
  },
  goBack: {
    required: {},
    optional: {},
  },
  goForward: {
    required: {},
    optional: {},
  },
  switchFrame: {
    required: {},
    optional: { mode: "string", selector: "string", timeout: "number" },
  },
  wait: {
    required: {},
    optional: { selector: "string", timeout: "number", state: "string" },
  },
  scroll: {
    required: {},
    optional: { selector: "string", x: "number", y: "number" },
  },

  // Interaction
  click: {
    required: { selector: "string" },
    optional: { timeout: "number", button: "string", clickCount: "number" },
  },
  hover: {
    required: { selector: "string" },
    optional: { timeout: "number" },
  },
  dragAndDrop: {
    required: { sourceSelector: "string", targetSelector: "string" },
    optional: { timeout: "number" },
  },
  clickDown: {
    required: { selector: "string" },
    optional: { button: "string", timeout: "number" },
  },
  clickUp: {
    required: { selector: "string" },
    optional: { button: "string", timeout: "number" },
  },
  type: {
    required: { selector: "string", text: "string" },
    optional: { timeout: "number", delay: "number" },
  },

  // Keyboard
  typeText: {
    required: { text: "string" },
    optional: { delay: "number", intervalMs: "number" },
  },
  sendTextToSelector: {
    required: { selector: "string", text: "string" },
    optional: { timeout: "number", delay: "number" },
  },
  pressKey: {
    required: { key: "string" },
    optional: { selector: "string" },
  },
  clearInput: {
    required: { selector: "string" },
    optional: { timeout: "number" },
  },

  // Cookie
  getCookies: {
    required: { saveToVar: "string" },
    optional: { domain: "string" },
  },
  setCookies: {
    required: { cookieJson: "string" },
    optional: {},
  },
  clearCookies: {
    required: {},
    optional: {},
  },

  // Logic
  ifCondition: {
    required: { leftValue: "string", operator: "string", rightValue: "string" },
    optional: {},
  },
  loopFor: {
    required: { times: "number" },
    optional: { indexVar: "string" },
  },
  loopElements: {
    required: { selector: "string", elementVar: "string" },
    optional: {},
  },
  evalJs: {
    required: { code: "string" },
    optional: { saveToVar: "string" },
  },

  // Data & Utilities
  setVariable: {
    required: { name: "string", value: "string" },
    optional: {},
  },
  readCsv: {
    required: { path: "string", saveToVar: "string" },
    optional: {},
  },
  writeCsv: {
    required: { path: "string", data: "string" },
    optional: {},
  },
  downloadFile: {
    required: { url: "string", savePath: "string" },
    optional: { timeout: "number" },
  },
  screenshot: {
    required: {},
    optional: { path: "string", fullPage: "boolean" },
  },
  log: {
    required: { message: "string" },
    optional: { level: "string", color: "string" },
  },
  delay: {
    required: { ms: "number" },
    optional: {},
  },

  // Phase 5: Data Extraction & DOM Inspection
  getText: {
    required: { selector: "string", saveToVar: "string" },
    optional: { timeout: "number" },
  },
  getAttributeValue: {
    required: { selector: "string", attribute: "string", saveToVar: "string" },
    optional: { timeout: "number" },
  },
  getValue: {
    required: { selector: "string", saveToVar: "string" },
    optional: { timeout: "number" },
  },
  elementExists: {
    required: { selector: "string" },
    optional: { timeout: "number", visibility: "string" },
  },
  extractionInText: {
    required: { text: "string", regex: "string", saveToVar: "string" },
    optional: { flags: "string" },
  },
  random: {
    required: { type: "string", saveToVar: "string" },
    optional: { domain: "string", quantity: "number", length: "number", min: "number", max: "number" },
  },

  // Phase 6: Network & Advanced
  http: {
    required: { url: "string" },
    optional: { method: "string", headers: "string", body: "string", saveToVar: "string", timeout: "number" },
  },
  setUserAgent: {
    required: { userAgent: "string" },
    optional: {},
  },
  getUrl: {
    required: { saveToVar: "string" },
    optional: {},
  },
  convertingJson: {
    required: { input: "string", operation: "string", saveToVar: "string" },
    optional: {},
  },
  imageSearch: {
    required: { imagePath: "string", saveToVar: "string" },
    optional: { threshold: "number" },
  },

  // Phase 7: Logic & Flow Control
  while: {
    required: { leftValue: "string", operator: "string", rightValue: "string" },
    optional: {},
  },
  stopLoop: {
    required: {},
    optional: {},
  },
  runOtherScript: {
    required: { scriptName: "string" },
    optional: { vars: "string" },
  },
  addLog: {
    required: { message: "string" },
    optional: { level: "string" },
  },
  addComment: {
    required: {},
    optional: { comment: "string" },
  },

  // Extension popup (spike)
  switchExtensionPopup: {
    required: {},
    optional: { mode: "string", selector: "string", timeout: "number" },
  },
};

export const ALLOWED_NODE_TYPES = Object.freeze(Object.keys(NODE_SCHEMAS));

// Anti-drift (#7b): enforced in __tests__/contracts/registry-drift.test.mjs
// (cannot run at validate.mjs load — circular import with nodes/index.mjs).

export class FlowValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "FlowValidationError";
  }
}

function checkType(value, expected) {
  if (expected === "number") return typeof value === "number" && Number.isFinite(value);
  if (expected === "string") return typeof value === "string";
  if (expected === "boolean") return typeof value === "boolean";
  return false;
}

/**
 * Validate a parsed flow object. Throws FlowValidationError on any violation.
 * Returns the flow (unchanged) on success for chaining.
 *
 * @param {unknown} flow
 * @returns {object}
 */
export function validateFlow(flow) {
  if (!flow || typeof flow !== "object" || Array.isArray(flow)) {
    throw new FlowValidationError("Flow must be a JSON object");
  }
  if (flow.version !== SCHEMA_VERSION) {
    throw new FlowValidationError(
      `Unsupported flow version: ${JSON.stringify(flow.version)} (expected ${SCHEMA_VERSION})`,
    );
  }
  if (typeof flow.name !== "string" || flow.name.length === 0) {
    throw new FlowValidationError("Flow.name must be a non-empty string");
  }
  if (flow.variables != null && (typeof flow.variables !== "object" || Array.isArray(flow.variables))) {
    throw new FlowValidationError("Flow.variables must be an object when present");
  }
  if (!Array.isArray(flow.nodes) || flow.nodes.length === 0) {
    throw new FlowValidationError("Flow.nodes must be a non-empty array");
  }
  if (!Array.isArray(flow.edges)) {
    throw new FlowValidationError("Flow.edges must be an array");
  }

  const ids = new Set();
  for (const node of flow.nodes) {
    validateNode(node, ids);
  }

  for (const edge of flow.edges) {
    if (!edge || typeof edge !== "object") {
      throw new FlowValidationError("Each edge must be an object");
    }
    const extra = Object.keys(edge).filter((k) => k !== "from" && k !== "to" && k !== "sourceHandle");
    if (extra.length > 0) {
      throw new FlowValidationError(`Edge has unknown keys: ${extra.join(", ")}`);
    }
    const allowedHandles = ["success", "fail", "true", "false", "loop", "done"];
    if (edge.sourceHandle != null && typeof edge.sourceHandle !== "string") {
      throw new FlowValidationError(`Edge.sourceHandle must be a string: ${JSON.stringify(edge.sourceHandle)}`);
    }
    if (edge.sourceHandle != null && !allowedHandles.includes(edge.sourceHandle)) {
      throw new FlowValidationError(`Edge.sourceHandle must be one of [${allowedHandles.join(", ")}]: ${JSON.stringify(edge.sourceHandle)}`);
    }
    if (!ids.has(edge.from)) {
      throw new FlowValidationError(`Edge.from references unknown node: ${JSON.stringify(edge.from)}`);
    }
    if (!ids.has(edge.to)) {
      throw new FlowValidationError(`Edge.to references unknown node: ${JSON.stringify(edge.to)}`);
    }
  }

  detectCycle(flow.nodes, flow.edges);
  return flow;
}

function validateNode(node, ids) {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    throw new FlowValidationError("Each node must be an object");
  }
  if (typeof node.id !== "string" || node.id.length === 0) {
    throw new FlowValidationError("Node.id must be a non-empty string");
  }
  if (ids.has(node.id)) {
    throw new FlowValidationError(`Duplicate node id: ${node.id}`);
  }
  ids.add(node.id);

  if (typeof node.type !== "string" || !ALLOWED_NODE_TYPES.includes(node.type)) {
    throw new FlowValidationError(
      `Node ${node.id}: unknown type ${JSON.stringify(node.type)} (allowed: ${ALLOWED_NODE_TYPES.join(", ")})`,
    );
  }

  // closed-schema key check: only id/type/params/continueOnError/comment allowed
  const allowedNodeKeys = ["id", "type", "params", "continueOnError", "comment"];
  const extraNodeKeys = Object.keys(node).filter((k) => !allowedNodeKeys.includes(k));
  if (extraNodeKeys.length > 0) {
    throw new FlowValidationError(`Node ${node.id}: unknown keys ${extraNodeKeys.join(", ")}`);
  }

  if (node.continueOnError != null && typeof node.continueOnError !== "boolean") {
    throw new FlowValidationError(`Node ${node.id}: continueOnError must be a boolean`);
  }

  if (node.comment != null && typeof node.comment !== "string") {
    throw new FlowValidationError(`Node ${node.id}: comment must be a string`);
  }

  const params = node.params ?? {};
  if (typeof params !== "object" || Array.isArray(params)) {
    throw new FlowValidationError(`Node ${node.id}: params must be an object`);
  }

  const spec = NODE_SCHEMAS[node.type];
  // required present + correct type
  for (const [key, expected] of Object.entries(spec.required)) {
    if (!(key in params)) {
      throw new FlowValidationError(`Node ${node.id} (${node.type}): missing required param '${key}'`);
    }
    if (!checkType(params[key], expected)) {
      throw new FlowValidationError(`Node ${node.id} (${node.type}): param '${key}' must be ${expected}`);
    }
  }
  // no unknown params (closed schema)
  const known = new Set([...Object.keys(spec.required), ...Object.keys(spec.optional)]);
  for (const key of Object.keys(params)) {
    if (!known.has(key)) {
      throw new FlowValidationError(`Node ${node.id} (${node.type}): unknown param '${key}'`);
    }
    const expected = spec.required[key] ?? spec.optional[key];
    if (!checkType(params[key], expected)) {
      throw new FlowValidationError(`Node ${node.id} (${node.type}): param '${key}' must be ${expected}`);
    }
  }

  // Static scheme check for openUrl literals (templated urls re-checked at runtime
  // by url-guard after interpolation — this catches obvious hostile literals early).
  if (node.type === "openUrl" && typeof params.url === "string" && !params.url.includes("{{")) {
    if (!isAllowedUrlScheme(params.url)) {
      throw new FlowValidationError(
        `Node ${node.id} (openUrl): url scheme not allowed: ${JSON.stringify(params.url)}`,
      );
    }
  }
}

// Phase 2 is linear chains but we still reject cycles so the walk terminates.
// Phase 3: allow intentional cycles via "loop" edges for loopFor/loopElements.
function detectCycle(nodes, edges) {
  const adj = new Map(nodes.map((n) => [n.id, []]));

  // Only include non-loop edges in cycle detection. "loop" edges are intentional
  // backward jumps that create cycles by design. MAX_STEPS in engine.mjs prevents
  // infinite loops.
  for (const e of edges) {
    if ((e.sourceHandle ?? "success") !== "loop") {
      adj.get(e.from).push(e.to);
    }
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map(nodes.map((n) => [n.id, WHITE]));

  const visit = (id) => {
    color.set(id, GRAY);
    for (const next of adj.get(id)) {
      const c = color.get(next);
      if (c === GRAY) throw new FlowValidationError(`Flow contains a cycle at node: ${next}`);
      if (c === WHITE) visit(next);
    }
    color.set(id, BLACK);
  };

  for (const n of nodes) {
    if (color.get(n.id) === WHITE) visit(n.id);
  }
}
