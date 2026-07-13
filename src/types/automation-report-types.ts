/**
 * Automation report types — Phase 4 (resource allocation plan).
 *
 * These are view-model types consumed by ScriptReportDialog and
 * ResourceReportDialog. All data originates from runtime events emitted by
 * the engine and bridged through the "automation-log" Tauri event channel.
 */

// ─── Script Report ────────────────────────────────────────────────────────────

export type ScriptRunStatus = "running" | "success" | "failed" | "cancelled";

export interface ProfileSummaryMessage {
  profileId: string;
  status: "success" | "failed";
  message: string;
  reasonCode?: string;
  /** "explicit_fail_node" | "runtime_error" */
  failSource?: string;
}

export interface ScriptReport {
  scriptRunId: string;
  status: ScriptRunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs: number;
  profileStats: {
    total: number;
    running: number;
    success: number;
    failed: number;
    cancelled: number;
  };
  nodeStats: {
    total: number;
    success: number;
    failed: number;
    skipped: number;
  };
  messages: ProfileSummaryMessage[];
}

// ─── Resource Report ──────────────────────────────────────────────────────────

export interface ActiveLeaseEntry {
  itemId: string;
  profileId: string;
  runId: string;
  leasedAt: string;
}

export interface ResourceWriteStats {
  total: number;
  success: number;
  failed: number;
  lastWriteAt?: string;
  lastError?: string;
}

export interface ResourceReportEntry {
  resourceId: string;
  name: string;
  type: string;
  totalItems: number;
  availableItems: number;
  leasedItems: number;
  cooldownItems: number;
  exhaustedItems: number;
  disabledItems: number;
  successUsage: number;
  failUsage: number;
  activeLeases: ActiveLeaseEntry[];
  writes: ResourceWriteStats;
}

export interface ResourceReport {
  scriptRunId?: string;
  resources: ResourceReportEntry[];
}

// ─── Log entry ────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AutomationLogEntry {
  id: string;
  ts: string;
  level: LogLevel;
  profileId?: string;
  runId?: string;
  nodeId?: string;
  /** Resource event type if the line is a resource event. */
  resourceEventType?: string;
  message: string;
  /** Original parsed JSON payload (for detail view). */
  raw?: unknown;
}

// ─── Report State (reducer shape) ────────────────────────────────────────────

export interface AutomationReportState {
  scriptReport: ScriptReport | null;
  resourceReport: ResourceReport;
  /** Capped log buffer. */
  logEntries: AutomationLogEntry[];
}

export const EMPTY_REPORT_STATE: AutomationReportState = {
  scriptReport: null,
  resourceReport: { resources: [] },
  logEntries: [],
};
