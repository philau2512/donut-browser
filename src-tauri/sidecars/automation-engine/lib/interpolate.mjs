// {{VAR}} substitution for node params — Phase 2.
//
// Flow params may contain placeholders like "{{PROFILE_ID}}" or
// "https://app.example.com/u/{{PROFILE_NAME}}". At runtime the orchestrator
// passes a `vars` object (PROFILE_ID, PROFILE_NAME, plus any custom vars from
// the flow's `variables` block). We substitute every {{KEY}} with its value.
//
// Security note: interpolated values are user/profile-controlled free text.
// Downstream consumers MUST treat the result as untrusted — url-guard validates
// scheme, safe-path sanitizes filenames. Interpolation itself does no escaping;
// it is a pure string replace.

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g;

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
export function interpolateString(str, vars, opts = {}) {
  if (typeof str !== "string") return str;
  return str.replace(PLACEHOLDER_RE, (match, key) => {
    if (Object.prototype.hasOwnProperty.call(vars ?? {}, key)) {
      return String(vars[key] ?? "");
    }
    if (opts.strict) {
      throw new Error(`Unknown variable in template: ${key}`);
    }
    return match;
  });
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

export { PLACEHOLDER_RE };
