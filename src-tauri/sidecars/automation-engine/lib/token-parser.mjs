// Token parser for automation flow syntax — Phase 1 (resource allocation plan).
//
// Three token classes are recognised:
//
//   [[name]]            → canonical variable reference (schema v2)
//   [[scope.name]]      → scoped variable reference
//   {{resource:name}}   → resource allocation/read reference
//   {{name}}            → legacy variable reference (schema v1 compat, emits warning)
//
// This module is PARSE-ONLY. It classifies tokens found in a string; it does
// not resolve values. Resolution happens in interpolate.mjs (variables) and
// ResourceManager (resources).

/** Canonical variable token: [[name]] or [[scope.name]] */
export const VAR_TOKEN_RE = /\[\[([A-Za-z_][A-Za-z0-9_.]*)\]\]/g;

/** Resource reference token: {{resource:name}} */
export const RESOURCE_TOKEN_RE =
  /\{\{\s*resource\s*:\s*([A-Za-z0-9_-]+)\s*\}\}/g;

/**
 * Legacy variable token: {{name}} — anything that is NOT {{resource:...}}.
 * Used only in compatibility mode for schema v1 flows.
 */
export const LEGACY_VAR_TOKEN_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/**
 * @typedef {"variable" | "resource" | "legacy-variable"} TokenKind
 *
 * @typedef {{
 *   kind: TokenKind,
 *   name: string,
 *   scope?: string,
 *   raw: string,
 *   start: number,
 *   end: number
 * }} ParsedToken
 */

/**
 * Parse all tokens in a string and return them in source order.
 *
 * @param {string} str
 * @param {{ allowLegacy?: boolean }} [opts]
 *   allowLegacy — include legacy {{name}} tokens (default true for compat)
 * @returns {ParsedToken[]}
 */
export function parseTokens(str, opts = {}) {
  if (typeof str !== "string") return [];
  const { allowLegacy = true } = opts;

  const tokens = [];

  // Collect resource tokens first so legacy regex does not re-match them.
  const resourceRe = new RegExp(RESOURCE_TOKEN_RE.source, "g");
  let m;
  while ((m = resourceRe.exec(str)) !== null) {
    tokens.push({
      kind: "resource",
      name: m[1].trim(),
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Collect canonical variable tokens [[name]] / [[scope.name]].
  const varRe = new RegExp(VAR_TOKEN_RE.source, "g");
  while ((m = varRe.exec(str)) !== null) {
    const full = m[1];
    const dotIdx = full.indexOf(".");
    const scope = dotIdx >= 0 ? full.slice(0, dotIdx) : undefined;
    const name = dotIdx >= 0 ? full.slice(dotIdx + 1) : full;
    tokens.push({
      kind: "variable",
      name,
      scope,
      raw: m[0],
      start: m.index,
      end: m.index + m[0].length,
    });
  }

  // Collect legacy {{name}} tokens, skip positions already claimed by resource.
  if (allowLegacy) {
    const resourcePositions = new Set(
      tokens
        .filter((t) => t.kind === "resource")
        .flatMap((t) => {
          const positions = [];
          for (let i = t.start; i < t.end; i++) positions.push(i);
          return positions;
        }),
    );
    const legacyRe = new RegExp(LEGACY_VAR_TOKEN_RE.source, "g");
    while ((m = legacyRe.exec(str)) !== null) {
      if (!resourcePositions.has(m.index)) {
        tokens.push({
          kind: "legacy-variable",
          name: m[1],
          raw: m[0],
          start: m.index,
          end: m.index + m[0].length,
        });
      }
    }
  }

  // Return in source order.
  return tokens.sort((a, b) => a.start - b.start);
}

/**
 * Extract all variable names referenced by [[...]] tokens.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function extractVariableTokens(str) {
  return parseTokens(str, { allowLegacy: false })
    .filter((t) => t.kind === "variable")
    .map((t) => t.name);
}

/**
 * Extract all resource names referenced by {{resource:name}} tokens.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function extractResourceTokens(str) {
  return parseTokens(str, { allowLegacy: false })
    .filter((t) => t.kind === "resource")
    .map((t) => t.name);
}

/**
 * Extract all legacy {{name}} variable references.
 * Used by the migration preview logic to enumerate candidates for conversion.
 *
 * @param {string} str
 * @returns {string[]}
 */
export function extractLegacyVariableTokens(str) {
  return parseTokens(str, { allowLegacy: true })
    .filter((t) => t.kind === "legacy-variable")
    .map((t) => t.name);
}

/**
 * Validate token usage in a string against a known set of variable names and
 * resource names. Returns an array of violation objects.
 *
 * @param {string} str
 * @param {{ variables: Set<string>, resources: Set<string> }} known
 * @returns {Array<{ kind: string, name: string, raw: string, reason: string }>}
 */
export function validateTokens(
  str,
  { variables = new Set(), resources = new Set() } = {},
) {
  const violations = [];
  for (const token of parseTokens(str)) {
    if (token.kind === "variable" && !variables.has(token.name)) {
      violations.push({
        ...token,
        reason: `Variable '${token.name}' is not defined in this flow`,
      });
    }
    if (token.kind === "resource" && !resources.has(token.name)) {
      violations.push({
        ...token,
        reason: `Resource '${token.name}' is not defined in this flow`,
      });
    }
    // Legacy tokens are always warned regardless of whether they resolve.
    if (token.kind === "legacy-variable") {
      violations.push({
        ...token,
        reason: `Legacy syntax {{${token.name}}} — migrate to [[${token.name}]] (variable) or {{resource:${token.name}}} (resource)`,
      });
    }
  }
  return violations;
}
