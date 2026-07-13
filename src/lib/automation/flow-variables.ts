/** Flow run + openProfile variables available for {{KEY}} / [[KEY]] interpolation in the sidecar engine. */
export const RESERVED_FLOW_VARIABLES = [
  "PROFILE_ID",
  "PROFILE_NAME",
  "CDP_PORT",
  "PROXY_IP",
  "IP_COUNTRY",
  "BROWSER_PID",
] as const;

export type ReservedFlowVariable = (typeof RESERVED_FLOW_VARIABLES)[number];

const RESERVED_SET = new Set<string>(RESERVED_FLOW_VARIABLES);

export function isReservedFlowVariable(key: string): boolean {
  return RESERVED_SET.has(key.trim().toUpperCase());
}

// ─── Token regex (mirrors token-parser.mjs) ───────────────────────────────────

/** Legacy: {{KEY}} — schema v1 compat. Does NOT match {{resource:...}}. */
const LEGACY_VAR_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

/** Canonical variable: [[KEY]] or [[scope.KEY]] */
const VAR_TOKEN_RE = /\[\[([A-Za-z_][A-Za-z0-9_.]*)\]\]/g;

/** Resource reference: {{resource:name}} — extracted separately, not as a variable. */
const RESOURCE_TOKEN_RE = /\{\{\s*resource\s*:\s*([A-Za-z0-9_-]+)\s*\}\}/g;

// ─── Extract helpers ──────────────────────────────────────────────────────────

/**
 * Extract variable names from a string.
 * Recognises both [[KEY]] (canonical) and {{KEY}} (legacy).
 * {{resource:name}} tokens are excluded from the result.
 */
export function extractVariableRefsFromText(text: string): string[] {
  const found = new Set<string>();

  // Collect resource token positions to skip them in legacy pass.
  const resourcePositions = new Set<number>();
  let m: RegExpExecArray | null;
  const resRe = new RegExp(RESOURCE_TOKEN_RE.source, "g");
  while ((m = resRe.exec(text)) !== null) {
    for (let i = m.index; i < m.index + m[0].length; i++)
      resourcePositions.add(i);
  }

  // Canonical [[KEY]] / [[scope.KEY]] — use leaf name after last dot.
  const varRe = new RegExp(VAR_TOKEN_RE.source, "g");
  while ((m = varRe.exec(text)) !== null) {
    const full = m[1];
    const name = full.includes(".")
      ? full.slice(full.lastIndexOf(".") + 1)
      : full;
    found.add(name.toUpperCase());
  }

  // Legacy {{KEY}} — skip resource token positions.
  const legacyRe = new RegExp(LEGACY_VAR_RE.source, "g");
  while ((m = legacyRe.exec(text)) !== null) {
    if (!resourcePositions.has(m.index)) {
      found.add(m[1].toUpperCase());
    }
  }

  return [...found];
}

/**
 * Extract resource names referenced via {{resource:name}} in a string.
 */
export function extractResourceRefsFromText(text: string): string[] {
  const found = new Set<string>();
  const re = new RegExp(RESOURCE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].trim());
  }
  return [...found];
}

/** Collect all variable references from nested params (editor validation). */
export function extractVariableRefsFromParams(params: unknown): string[] {
  const found = new Set<string>();
  const walk = (obj: unknown) => {
    if (typeof obj === "string") {
      for (const name of extractVariableRefsFromText(obj)) found.add(name);
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(params);
  return [...found];
}

/** Collect all resource references from nested params (editor validation). */
export function extractResourceRefsFromParams(params: unknown): string[] {
  const found = new Set<string>();
  const walk = (obj: unknown) => {
    if (typeof obj === "string") {
      for (const name of extractResourceRefsFromText(obj)) found.add(name);
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(params);
  return [...found];
}
