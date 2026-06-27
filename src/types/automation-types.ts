// Frontend mirror of the Rust automation types (Phase 3 backend).
//
// Field-name casing intentionally matches what each Tauri surface emits:
//   - RunState / ProfileRunState come from serde with DEFAULT casing → snake_case.
//   - RunStatus serializes kebab-case (serde rename_all = "kebab-case").
//   - RunSettings serializes camelCase (serde rename_all = "camelCase").
//   - automation-log lines come from the Node engine already as camelCase.

/** Lifecycle status of a single profile within a run (kebab-case from serde). */
export type RunStatus =
  | "idle"
  | "launching"
  | "running"
  | "done"
  | "done-with-errors"
  | "error"
  | "skipped"
  | "stopped";

/** Terminal states no longer change without a new run. Mirrors RunStatus::is_terminal. */
export const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  "done",
  "done-with-errors",
  "error",
  "skipped",
  "stopped",
]);

export function isTerminalStatus(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

/** Per-profile run state — payload of the `automation-status` event and an
 * entry in RunState.profiles. snake_case to match serde default casing. */
export interface ProfileRunState {
  profile_id: string;
  profile_name: string;
  status: RunStatus;
  browser_pid?: number | null;
  sidecar_pid?: number | null;
  cdp_port?: number | null;
  finished_at_ms?: number | null;
  error?: string | null;
}

/** Run-level settings — mirror Hidemium Campaign Settings (MVP subset).
 * camelCase to match serde rename_all = "camelCase". */
export interface RunSettings {
  concurrency: number;
  delayOpenSecs: number;
  headless: boolean;
  closeOnComplete: boolean;
  writeLogs: boolean;
  noOverlapping: boolean;
}

/** Default settings — mirror RunSettings::default() in run_state.rs. */
export const DEFAULT_RUN_SETTINGS: RunSettings = {
  concurrency: 5,
  delayOpenSecs: 0,
  headless: false,
  closeOnComplete: true,
  writeLogs: true,
  noOverlapping: true,
};

/** State for one run (one flow across N profiles). snake_case (serde default). */
export interface RunState {
  run_id: string;
  flow_name: string;
  settings: RunSettings;
  profiles: Record<string, ProfileRunState>;
  finished_at_ms?: number | null;
}

/** One realtime log line emitted on the `automation-log` event. Produced by the
 * Node engine (camelCase) and forwarded verbatim by the Rust log sink, which
 * also redacts secrets before this line is ever created. */
export interface LogLine {
  ts?: number;
  runId?: string;
  profileId?: string;
  nodeId?: string;
  level?: "info" | "warn" | "error" | "debug";
  msg?: string;
}
