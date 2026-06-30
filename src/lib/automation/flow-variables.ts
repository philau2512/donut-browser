/** Flow run + openProfile variables available for {{KEY}} interpolation in the sidecar engine. */
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

const VAR_REF = /\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g;

/** Extract variable names referenced in a string (without braces). */
export function extractVariableRefsFromText(text: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(VAR_REF.source, "g");
  while ((m = re.exec(text)) !== null) {
    found.add(m[1].toUpperCase());
  }
  return [...found];
}

/** Collect all {{VAR}} references from nested params (editor validation). */
export function extractVariableRefsFromParams(params: unknown): string[] {
  const found = new Set<string>();
  const walk = (obj: unknown) => {
    if (typeof obj === "string") {
      for (const name of extractVariableRefsFromText(obj)) {
        found.add(name);
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(params);
  return [...found];
}
