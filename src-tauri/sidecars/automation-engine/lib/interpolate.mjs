// Variable interpolation for node params — Phase 2 + resource-allocation plan.
//
// Supports two syntaxes:
//   [[KEY]] / [[scope.KEY]]  — canonical variable token (schema v2)
//   {{KEY}}                  — legacy variable token (schema v1 compat, no warning here)
//
// {{resource:name}} tokens are intentionally NOT resolved here — they are
// handled by ResourceManager before node execution. If a resource token reaches
// this layer it means ResourceManager has not resolved it yet; it is left as-is.
//
// Security note: interpolated values are user/profile-controlled free text.
// Downstream consumers MUST treat the result as untrusted.

/** Legacy placeholder: {{KEY}} — kept for v1 flow compat. */
const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

/** Canonical variable placeholder: [[KEY]] or [[scope.KEY]] */
const VAR_TOKEN_RE = /\[\[([A-Za-z_][A-Za-z0-9_.]*)\]\]/g;

/**
 * Replace {{KEY}} occurrences in a single string using vars.
 * Unknown keys are left as-is (so a missing var is visible, not silently empty)
 * unless `strict` is set, in which case it throws.
 *
 * @param {string} str
 * @param {Record<string, unknown>} vars
 * @param {{ strict?: boolean }} [opts]
 * @returns {string}
 */
function lookupVar(vars, key) {
  if (!vars || typeof vars !== "object") return undefined;
  if (Object.prototype.hasOwnProperty.call(vars, key)) {
    return vars[key];
  }
  const upper = key.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(vars, upper)) {
    return vars[upper];
  }
  const lower = key.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(vars, lower)) {
    return vars[lower];
  }
  return undefined;
}

export function interpolateString(str, vars, opts = {}) {
  if (typeof str !== "string") return str;

  // Pass 1: resolve canonical [[KEY]] / [[scope.KEY]] tokens.
  // For scoped tokens the lookup uses only the leaf name (after last dot).
  let result = str.replace(
    new RegExp(VAR_TOKEN_RE.source, "g"),
    (match, full) => {
      const name = full.includes(".")
        ? full.slice(full.lastIndexOf(".") + 1)
        : full;
      const value = lookupVar(vars, name);
      if (value !== undefined) return String(value ?? "");
      if (opts.strict) throw new Error(`Unknown variable in template: ${full}`);
      return match;
    },
  );

  // Pass 2: resolve legacy {{KEY}} tokens — skip {{resource:...}} tokens.
  result = result.replace(PLACEHOLDER_RE, (match, key) => {
    // Guard: do not resolve resource references that slipped through.
    if (key.startsWith("resource:") || key.startsWith("resource "))
      return match;
    const value = lookupVar(vars, key);
    if (value !== undefined) return String(value ?? "");
    if (opts.strict) throw new Error(`Unknown variable in template: ${key}`);
    return match;
  });

  return result;
}

/**
 * Deep-interpolate every string value in a params object (one level of nesting
 * plus arrays is enough for the 8 MVP nodes; recurses for safety).
 *
 * @param {unknown} params
 * @param {Record<string, unknown>} vars
 * @param {{ strict?: boolean }} [opts]
 * @returns {unknown}
 */
export function interpolateParams(params, vars, opts = {}) {
  if (typeof params === "string") {
    return interpolateString(params, vars, opts);
  }
  if (Array.isArray(params)) {
    return params.map((v) => interpolateParams(v, vars, opts));
  }
  if (params && typeof params === "object") {
    const out = {};
    for (const [k, v] of Object.entries(params)) {
      out[k] = interpolateParams(v, vars, opts);
    }
    return out;
  }
  return params;
}

export { PLACEHOLDER_RE, VAR_TOKEN_RE };
