/**
 * Shared type definitions for automation flow schema v2.
 *
 * Schema v1: { version: 1, variables: Record<string,string>, ... }
 * Schema v2: { schemaVersion: 2, variables: VariableDefinition[], resources: ResourceDefinition[], ... }
 *
 * v1 flows remain valid and are handled by the legacy compatibility path.
 */

// ─── Variable ────────────────────────────────────────────────────────────────

export type VariableScope = "flow" | "run" | "node";
export type VariableValueType = "string" | "number" | "boolean" | "json";

export interface VariableDefinition {
  id: string;
  name: string;
  /** Lifetime scope of the variable. "flow" persists for all runs of this flow. */
  scope: VariableScope;
  valueType: VariableValueType;
  defaultValue?: string;
  description?: string;
}

// ─── Resource ─────────────────────────────────────────────────────────────────

export type ResourceType = "line-pool" | "proxy-pool" | "file" | "custom";

/**
 * input   — items are allocated/leased to profiles (read pool).
 * output  — data sink; writes go through ResourceManager (no lease).
 * read-write — allocated as input AND used as write target.
 */
export type ResourceDirection = "input" | "output" | "read-write";

export type SelectionStrategy = "sequential" | "random" | "rotate" | "mix";

export type ItemIdentityStrategy = "line-hash" | "line-value" | "stable-id";

export type PersistenceScope = "run" | "flow" | "resource";

export interface ResourceDefinition {
  id: string;
  name: string;
  type: ResourceType;
  direction: ResourceDirection;
  tabName?: string;
  descriptionEn?: string;
  descriptionRu?: string;
  enableHint?: boolean;
  wizardType?: string;
  defaultValue?: string;
  notEmpty?: boolean;
  multiline?: boolean;
  minInteger?: number;
  maxInteger?: number;
  selectType?: string;
  selectDefaultValue?: string;
  enabledToUser?: boolean;
  visibleToUser?: boolean;
  isAdvanced?: boolean;
  visibleIfVariable?: string;
  visibleIfContains?: string;
  choosableTypes?: string[];

  source: {
    kind: "static" | "file";
    /** Absolute or flow-relative path when kind = "file". */
    path?: string;
    /** Inline items when kind = "static". */
    inlineItems?: string[];
  };

  mode: {
    selection: SelectionStrategy;
    /** Greedy = take first usable item without randomisation. */
    greedy: boolean;
  };

  limits: {
    /** Global success quota per item. 0 = unlimited. */
    maxSuccessUsage: number;
    /** Global fail quota per item before it is disabled. 0 = unlimited. */
    maxFailUsage: number;
    /** How many concurrent active leases one item may hold. Default 1. */
    maxSimultaneousUse: number;
    /** Cooldown after release/success/fail, in milliseconds. */
    intervalBetweenUsageMs: number;
  };

  fileBehavior: {
    readFile: boolean;
    writeFile: boolean;
    reloadPeriodically: boolean;
    renewPeriodically: boolean;
  };

  persistence: {
    /**
     * "resource" = usage quota persists across app restarts (recommended default).
     * "flow"     = resets when resource source changes.
     * "run"      = in-memory only, resets each script run.
     */
    scope: PersistenceScope;
    /**
     * How to fingerprint an item so quota survives file reload / restart.
     * "line-hash" hashes the raw line value — avoids storing sensitive data as key.
     */
    itemIdentity: ItemIdentityStrategy;
    preserveUsageAcrossRestart: boolean;
  };
}

// ─── Resource Item Runtime State ─────────────────────────────────────────────

export type ResourceItemStatus =
  | "available"
  | "leased"
  | "cooldown"
  | "exhausted"
  | "disabled";

export interface ResourceItemLease {
  profileId: string;
  runId: string;
  leasedAt: string; // ISO 8601
}

/**
 * Per-item runtime state managed by ResourceManager (Phase 2).
 * Persisted fields: successUsage, failUsage, status (exhausted/disabled), lastUsedAt.
 * Non-persisted: active leases (cleared on restart).
 */
export interface ResourceItemState {
  /** Derived from resourceId + source fingerprint + item identity hash. */
  id: string;
  resourceId: string;
  /** Raw item value (proxy line, email, etc.) — never stored in persisted state key. */
  line: string;
  status: ResourceItemStatus;
  leases: ResourceItemLease[];
  successUsage: number;
  failUsage: number;
  lastUsedAt?: string; // ISO 8601
  /** Set when status = "cooldown". Epoch ms string. */
  lockUntil?: string;
}

// ─── Flow Schema V2 ───────────────────────────────────────────────────────────

/**
 * Schema v2 flow definition.
 * `variables` is now a typed array instead of a flat key-value object.
 * `resources` is a new top-level array.
 */
export interface AutomationFlowV2 {
  schemaVersion: 2;
  version: 1; // keep for engine backward-compat during transition
  name: string;
  variables: VariableDefinition[];
  resources: ResourceDefinition[];
  nodes: unknown[]; // typed further in serialize.ts
  edges: unknown[];
}

// ─── Default factory helpers ──────────────────────────────────────────────────

export function makeDefaultResourceDefinition(
  overrides: Partial<ResourceDefinition> & { id: string; name: string },
): ResourceDefinition {
  return {
    type: "line-pool",
    direction: "input",
    source: { kind: "static", inlineItems: [] },
    mode: { selection: "sequential", greedy: false },
    limits: {
      maxSuccessUsage: 0,
      maxFailUsage: 0,
      maxSimultaneousUse: 1,
      intervalBetweenUsageMs: 0,
    },
    fileBehavior: {
      readFile: false,
      writeFile: false,
      reloadPeriodically: false,
      renewPeriodically: false,
    },
    persistence: {
      scope: "resource",
      itemIdentity: "line-hash",
      preserveUsageAcrossRestart: true,
    },
    enabledToUser: true,
    visibleToUser: true,
    isAdvanced: false,
    visibleIfVariable: "",
    visibleIfContains: "",
    choosableTypes: [
      "FixedString",
      "FixedInteger",
      "RandomString",
      "RandomInteger",
      "Select",
      "Checkbox",
      "LinesFromFile",
      "FilesFromDirectory",
      "LinesFromUrl",
      "Database",
      "Information",
    ],
    ...overrides,
  };
}

export function makeDefaultVariableDefinition(
  overrides: Partial<VariableDefinition> & { id: string; name: string },
): VariableDefinition {
  return {
    scope: "flow",
    valueType: "string",
    ...overrides,
  };
}
