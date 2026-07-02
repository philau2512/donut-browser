"use client";

// useAutomationReport — Phase 4 (resource allocation plan).
//
// Subscribes to the "automation-log" Tauri event channel and accumulates
// structured report state without reaching into engine internals.
//
// Design:
//   - Pure reducer: each log line is parsed and dispatched as an action.
//   - Log buffer is capped at MAX_LOG_ENTRIES to prevent UI lag.
//   - Resource event lines (prefixed with [resource-event]) are parsed into
//     ResourceReportEntry updates.
//   - profile-success / profile-fail events update ScriptReport.
//   - reset() clears all state for a new run.

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useReducer, useRef } from "react";
import type {
  AutomationLogEntry,
  AutomationReportState,
  ProfileSummaryMessage,
  ResourceReportEntry,
} from "@/types/automation-report-types";
import { EMPTY_REPORT_STATE } from "@/types/automation-report-types";

const MAX_LOG_ENTRIES = 2000;
let _logIdCounter = 0;
function nextLogId() {
  return `log-${++_logIdCounter}`;
}

// ─── Reducer ──────────────────────────────────────────────────────────────────

type Action =
  | {
      type: "LOG_LINE";
      entry: AutomationLogEntry;
      resourceUpdate?: Partial<ResourceReportEntry>;
    }
  | {
      type: "PROFILE_SUCCESS";
      profileId: string;
      runId: string;
      message: string;
      resourceStats?: ResourceReportEntry[];
    }
  | {
      type: "PROFILE_FAIL";
      profileId: string;
      runId: string;
      message: string;
      reasonCode?: string;
      failSource?: string;
      resourceStats?: ResourceReportEntry[];
    }
  | { type: "RUN_START"; runId: string }
  | { type: "RUN_END" }
  | { type: "RESET" };

function reducer(
  state: AutomationReportState,
  action: Action,
): AutomationReportState {
  switch (action.type) {
    case "RESET":
      return {
        ...EMPTY_REPORT_STATE,
        resourceReport: { resources: [] },
        logEntries: [],
      };

    case "RUN_START": {
      return {
        ...state,
        scriptReport: {
          scriptRunId: action.runId,
          status: "running",
          startedAt: new Date().toISOString(),
          durationMs: 0,
          profileStats: {
            total: 0,
            running: 0,
            success: 0,
            failed: 0,
            cancelled: 0,
          },
          nodeStats: { total: 0, success: 0, failed: 0, skipped: 0 },
          messages: [],
        },
      };
    }

    case "RUN_END": {
      if (!state.scriptReport) return state;
      const now = new Date().toISOString();
      const start = new Date(state.scriptReport.startedAt).getTime();
      const status =
        state.scriptReport.profileStats.failed > 0 ? "failed" : "success";
      return {
        ...state,
        scriptReport: {
          ...state.scriptReport,
          status,
          finishedAt: now,
          durationMs: Date.now() - start,
        },
      };
    }

    case "PROFILE_SUCCESS": {
      const report = state.scriptReport;
      if (!report) return state;
      const msg: ProfileSummaryMessage = {
        profileId: action.profileId,
        status: "success",
        message: action.message,
      };
      // Update resource report if stats provided.
      const resourceReport = action.resourceStats
        ? mergeResourceStats(state.resourceReport, action.resourceStats)
        : state.resourceReport;
      return {
        ...state,
        resourceReport,
        scriptReport: {
          ...report,
          profileStats: {
            ...report.profileStats,
            success: report.profileStats.success + 1,
            running: Math.max(0, report.profileStats.running - 1),
          },
          messages: [...report.messages, msg],
        },
      };
    }

    case "PROFILE_FAIL": {
      const report = state.scriptReport;
      if (!report) return state;
      const msg: ProfileSummaryMessage = {
        profileId: action.profileId,
        status: "failed",
        message: action.message,
        reasonCode: action.reasonCode,
        failSource: action.failSource,
      };
      const resourceReport = action.resourceStats
        ? mergeResourceStats(state.resourceReport, action.resourceStats)
        : state.resourceReport;
      return {
        ...state,
        resourceReport,
        scriptReport: {
          ...report,
          profileStats: {
            ...report.profileStats,
            failed: report.profileStats.failed + 1,
            running: Math.max(0, report.profileStats.running - 1),
          },
          messages: [...report.messages, msg],
        },
      };
    }

    case "LOG_LINE": {
      // Update resource report entry if included.
      const resourceReport = action.resourceUpdate
        ? mergeResourceUpdate(state.resourceReport, action.resourceUpdate)
        : state.resourceReport;

      // Cap log buffer.
      const entries =
        state.logEntries.length >= MAX_LOG_ENTRIES
          ? [...state.logEntries.slice(1), action.entry]
          : [...state.logEntries, action.entry];

      return { ...state, resourceReport, logEntries: entries };
    }

    default:
      return state;
  }
}

// ─── Payload parsers ──────────────────────────────────────────────────────────

function parseLogLine(
  raw: unknown,
  runId?: string,
  profileId?: string,
): Action {
  const obj =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  const ts = typeof obj.ts === "string" ? obj.ts : new Date().toISOString();
  const level = (
    ["debug", "info", "warn", "error"].includes(String(obj.level))
      ? String(obj.level)
      : "info"
  ) as AutomationLogEntry["level"];
  const msg = String(obj.msg ?? obj.message ?? "");
  const nodeId = typeof obj.nodeId === "string" ? obj.nodeId : undefined;
  const pId = typeof obj.profileId === "string" ? obj.profileId : profileId;
  const rId = typeof obj.runId === "string" ? obj.runId : runId;

  // Detect resource-event lines: { __eventType: string, ... }
  const eventType =
    typeof obj.__eventType === "string" ? obj.__eventType : undefined;

  // Detect [resource-event] prefix in message (engine bridge format).
  let resourceEventType: string | undefined;
  let resourceUpdate: Partial<ResourceReportEntry> | undefined;

  if (eventType === "profile-success") {
    return {
      type: "PROFILE_SUCCESS",
      profileId: pId ?? "unknown",
      runId: rId ?? "unknown",
      message: String(obj.message ?? ""),
      resourceStats: Array.isArray(obj.resourceStats)
        ? (obj.resourceStats as ResourceReportEntry[])
        : undefined,
    };
  }

  if (eventType === "profile-fail") {
    return {
      type: "PROFILE_FAIL",
      profileId: pId ?? "unknown",
      runId: rId ?? "unknown",
      message: String(obj.message ?? ""),
      reasonCode:
        typeof obj.reasonCode === "string" ? obj.reasonCode : undefined,
      failSource:
        typeof obj.failSource === "string" ? obj.failSource : undefined,
      resourceStats: Array.isArray(obj.resourceStats)
        ? (obj.resourceStats as ResourceReportEntry[])
        : undefined,
    };
  }

  // Parse resource events from [resource-event] log lines.
  if (typeof msg === "string" && msg.startsWith("[resource-event]")) {
    try {
      const jsonStr = msg.slice("[resource-event]".length).trim();
      const evt = JSON.parse(jsonStr) as Record<string, unknown>;
      resourceEventType = typeof evt.type === "string" ? evt.type : undefined;
      if (evt.resourceId) {
        resourceUpdate = {
          resourceId: String(evt.resourceId),
          name:
            typeof evt.resourceName === "string" ? evt.resourceName : undefined,
        };
      }
    } catch {
      /* malformed — treat as plain log */
    }
  }

  const entry: AutomationLogEntry = {
    id: nextLogId(),
    ts,
    level,
    profileId: pId,
    runId: rId,
    nodeId,
    resourceEventType,
    message: msg || JSON.stringify(raw),
    raw,
  };

  return { type: "LOG_LINE", entry, resourceUpdate };
}

// ─── Resource report merge helpers ───────────────────────────────────────────

function mergeResourceStats(
  current: AutomationReportState["resourceReport"],
  stats: ResourceReportEntry[],
): AutomationReportState["resourceReport"] {
  const map = new Map(current.resources.map((r) => [r.resourceId, r]));
  for (const entry of stats) map.set(entry.resourceId, entry);
  return { ...current, resources: [...map.values()] };
}

function mergeResourceUpdate(
  current: AutomationReportState["resourceReport"],
  update: Partial<ResourceReportEntry>,
): AutomationReportState["resourceReport"] {
  if (!update.resourceId) return current;
  const existing = current.resources.find(
    (r) => r.resourceId === update.resourceId,
  );
  if (!existing) return current;
  const updated = { ...existing, ...update };
  return {
    ...current,
    resources: current.resources.map((r) =>
      r.resourceId === update.resourceId ? updated : r,
    ),
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseAutomationReportReturn {
  state: AutomationReportState;
  reset: () => void;
  notifyRunStart: (runId: string) => void;
  notifyRunEnd: () => void;
}

/**
 * Consume "automation-log" Tauri events and aggregate into a report state.
 *
 * @param activeRunId - The run currently being observed; used to filter events.
 */
export function useAutomationReport(
  activeRunId: string | null,
): UseAutomationReportReturn {
  const [state, dispatch] = useReducer(reducer, {
    ...EMPTY_REPORT_STATE,
    resourceReport: { resources: [] },
  });

  const runIdRef = useRef(activeRunId);
  useEffect(() => {
    runIdRef.current = activeRunId;
  }, [activeRunId]);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    (async () => {
      unlisten = await listen<Record<string, unknown>>(
        "automation-log",
        (event) => {
          const payload = event.payload as Record<string, unknown>;
          const payloadRunId =
            typeof payload.runId === "string" ? payload.runId : undefined;
          const payloadProfileId =
            typeof payload.profileId === "string"
              ? payload.profileId
              : undefined;

          const action = parseLogLine(payload, payloadRunId, payloadProfileId);
          dispatch(action);
        },
      );
    })();
    return () => {
      unlisten?.();
    };
  }, []);

  const reset = useCallback(() => dispatch({ type: "RESET" }), []);
  const notifyRunStart = useCallback(
    (runId: string) => dispatch({ type: "RUN_START", runId }),
    [],
  );
  const notifyRunEnd = useCallback(() => dispatch({ type: "RUN_END" }), []);

  return { state, reset, notifyRunStart, notifyRunEnd };
}
