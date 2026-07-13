/**
 * Migration preview logic for automation flow schema v1 → v2.
 *
 * Policy (from plan):
 * - NEVER auto-save on open.
 * - NEVER silent rewrite.
 * - Preview-first: classify every {{token}} before user confirms.
 * - Ambiguous token (same name in both variables and resources) → keep + warn.
 * - Rollback: caller retains original flow source until user confirms save.
 */

import type { DonutFlowV1 } from "@/components/automation/editor/serialize";
import type { ResourceDefinition, VariableDefinition } from "./resource-schema";

// ─── Types ────────────────────────────────────────────────────────────────────

export type MigrationTokenStatus =
  | "converted-variable" // {{name}} → [[name]]
  | "converted-resource" // {{name}} → {{resource:name}}
  | "skipped-ambiguous" // same name exists in both variable list and resource list
  | "skipped-unknown"; // not in either list; left unchanged

export interface MigrationTokenResult {
  /** Original token as found in the flow string (e.g. "{{EMAIL}}"). */
  raw: string;
  /** Extracted name (e.g. "EMAIL"). */
  name: string;
  status: MigrationTokenStatus;
  /** Proposed replacement string, or the original raw value when skipped. */
  proposed: string;
  /** Human-readable reason for the status. */
  reason: string;
}

export interface MigrationPreviewResult {
  /** true when there are tokens to convert (at least one converted-variable or converted-resource). */
  hasMigratableTokens: boolean;
  converted: MigrationTokenResult[];
  skipped: MigrationTokenResult[];
  ambiguous: MigrationTokenResult[];
  /** Summary counts for UI display. */
  summary: {
    totalTokens: number;
    convertedVariables: number;
    convertedResources: number;
    skippedAmbiguous: number;
    skippedUnknown: number;
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Legacy {{name}} — does NOT match {{resource:...}}. */
const LEGACY_TOKEN_RE = /\{\{([A-Za-z0-9_]+)\}\}/g;

function extractLegacyTokenNames(flow: DonutFlowV1): Set<string> {
  const found = new Set<string>();
  const walk = (obj: unknown): void => {
    if (typeof obj === "string") {
      let m: RegExpExecArray | null;
      const re = new RegExp(LEGACY_TOKEN_RE.source, "g");
      while ((m = re.exec(obj)) !== null) {
        found.add(m[1].toUpperCase());
      }
    } else if (Array.isArray(obj)) {
      for (const item of obj) walk(item);
    } else if (obj && typeof obj === "object") {
      for (const value of Object.values(obj)) walk(value);
    }
  };
  walk(flow);
  return found;
}

// ─── Preview ──────────────────────────────────────────────────────────────────

/**
 * Analyse a v1 flow and produce a migration preview report.
 *
 * @param flow       - The parsed v1 flow object.
 * @param knownVars  - Variable names available in the new schema (uppercase).
 * @param knownResources - Resource names available in the new schema (original case).
 */
export function previewMigration(
  flow: DonutFlowV1,
  knownVars: ReadonlyArray<VariableDefinition | string>,
  knownResources: ReadonlyArray<ResourceDefinition | string>,
): MigrationPreviewResult {
  // Normalise lookup sets.
  const varNames = new Set(
    knownVars.map((v) => (typeof v === "string" ? v : v.name).toUpperCase()),
  );
  const resourceNames = new Set(
    knownResources.map((r) =>
      (typeof r === "string" ? r : r.name).toLowerCase(),
    ),
  );

  // Also consider keys from the legacy variables dict as known variables.
  if (
    flow.variables &&
    typeof flow.variables === "object" &&
    !Array.isArray(flow.variables)
  ) {
    for (const key of Object.keys(flow.variables)) {
      varNames.add(key.toUpperCase());
    }
  }

  const legacyNames = extractLegacyTokenNames(flow);

  const results: MigrationTokenResult[] = [];

  for (const rawName of legacyNames) {
    const nameUpper = rawName.toUpperCase();
    const nameLower = rawName.toLowerCase();
    const raw = `{{${rawName}}}`;

    const isVar = varNames.has(nameUpper);
    const isRes = resourceNames.has(nameLower);

    if (isVar && isRes) {
      // Ambiguous — cannot auto-decide.
      results.push({
        raw,
        name: rawName,
        status: "skipped-ambiguous",
        proposed: raw,
        reason: `Name '${rawName}' exists in both variable list and resource list. Resolve the collision manually before migrating.`,
      });
    } else if (isRes) {
      results.push({
        raw,
        name: rawName,
        status: "converted-resource",
        proposed: `{{resource:${rawName}}}`,
        reason: `Matches resource '${rawName}' — converting to {{resource:${rawName}}}.`,
      });
    } else if (isVar) {
      results.push({
        raw,
        name: rawName,
        status: "converted-variable",
        proposed: `[[${rawName}]]`,
        reason: `Matches variable '${rawName}' — converting to [[${rawName}]].`,
      });
    } else {
      // Unknown — likely a reserved runtime variable (PROFILE_ID etc.) or a
      // custom var not yet added to the v2 definition list.
      results.push({
        raw,
        name: rawName,
        status: "skipped-unknown",
        proposed: raw,
        reason: `Name '${rawName}' is not in the variable or resource list. Add it to the definitions first.`,
      });
    }
  }

  const converted = results.filter(
    (r) =>
      r.status === "converted-variable" || r.status === "converted-resource",
  );
  const skipped = results.filter((r) => r.status === "skipped-unknown");
  const ambiguous = results.filter((r) => r.status === "skipped-ambiguous");

  return {
    hasMigratableTokens: converted.length > 0,
    converted,
    skipped,
    ambiguous,
    summary: {
      totalTokens: results.length,
      convertedVariables: results.filter(
        (r) => r.status === "converted-variable",
      ).length,
      convertedResources: results.filter(
        (r) => r.status === "converted-resource",
      ).length,
      skippedAmbiguous: ambiguous.length,
      skippedUnknown: skipped.length,
    },
  };
}

// ─── Apply migration ──────────────────────────────────────────────────────────

/**
 * Apply a confirmed migration plan to a raw flow JSON string.
 *
 * Only call this AFTER the user has reviewed and confirmed the preview.
 * Returns the rewritten JSON string (caller is responsible for saving).
 *
 * @param flowJson   - Original flow JSON string.
 * @param plan       - Preview result from previewMigration().
 * @returns          - Rewritten JSON string with tokens replaced.
 */
export function applyMigration(
  flowJson: string,
  plan: MigrationPreviewResult,
): string {
  let result = flowJson;
  // Apply converted tokens — replace all occurrences of the raw token.
  for (const item of plan.converted) {
    // Escape regex special chars in the raw token for safe global replace.
    const escaped = item.raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), item.proposed);
  }
  return result;
}
