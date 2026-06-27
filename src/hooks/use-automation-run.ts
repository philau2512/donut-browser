import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DonutFlowV1 } from "@/components/automation/editor/serialize";
import i18n from "@/i18n";
import {
  extractFlowReviewItems,
  type FlowReviewItem,
  isFlowReviewed,
  markFlowReviewed,
} from "@/lib/automation/flow-review";
import { showErrorToast } from "@/lib/toast-utils";
import type { BrowserProfile } from "@/types";
import type {
  LogLine,
  ProfileRunState,
  RunSettings,
  RunState,
} from "@/types/automation-types";

/** Max log lines kept in memory per run. Older lines are dropped from the live
 * buffer (the full history is still on disk when writeLogs is on). Mirrors the
 * "cap buffer" mitigation in the plan's risk assessment. */
const MAX_LOG_LINES = 2000;

export interface PendingFlowReview {
  flowPath: string;
  flowName: string;
  flowJson: string;
  items: FlowReviewItem[];
  profiles: BrowserProfile[];
  settings: RunSettings;
}

export interface UseAutomationRunReturn {
  /** Available `.donutflow` file paths from the flows dir. */
  flows: string[];
  /** The most recent run started/observed from this hook, if any. */
  activeRunId: string | null;
  /** All known runs (latest backend snapshot), keyed by run_id. */
  runs: Record<string, RunState>;
  /** Live per-profile status for the active run (merged from events). */
  profileStates: Record<string, ProfileRunState>;
  /** Live log buffer for the active run (capped). */
  logs: LogLine[];
  pendingReview: PendingFlowReview | null;
  isStarting: boolean;
  loadFlows: () => Promise<void>;
  readFlow: (path: string) => Promise<string | null>;
  start: (
    flowPath: string,
    profiles: BrowserProfile[],
    settings: RunSettings,
  ) => Promise<string | null>;
  confirmPendingReview: () => Promise<string | null>;
  cancelPendingReview: () => void;
  stop: (runId: string) => Promise<void>;
  clearLogs: () => void;
  getLogPath: (runId: string, profileId: string) => Promise<string | null>;
}

export function useAutomationRun(): UseAutomationRunReturn {
  const [flows, setFlows] = useState<string[]>([]);
  const [runs, setRuns] = useState<Record<string, RunState>>({});
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [profileStates, setProfileStates] = useState<
    Record<string, ProfileRunState>
  >({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [pendingReview, setPendingReview] = useState<PendingFlowReview | null>(
    null,
  );
  const [isStarting, setIsStarting] = useState(false);

  // The active run id is read inside event handlers; keep a ref so the
  // long-lived listeners always see the latest value without re-subscribing.
  const activeRunIdRef = useRef<string | null>(null);
  useEffect(() => {
    activeRunIdRef.current = activeRunId;
  }, [activeRunId]);

  const loadFlows = useCallback(async () => {
    try {
      const list = await invoke<string[]>("list_automation_flows");
      setFlows(list);
    } catch (err) {
      console.error("Failed to list automation flows:", err);
      setFlows([]);
    }
  }, []);

  const readFlow = useCallback(async (path: string): Promise<string | null> => {
    try {
      return await invoke<string>("read_automation_flow", { path });
    } catch (err) {
      console.error("Failed to read flow:", err);
      showErrorToast(
        i18n.t("automation.errors.readFlowFailed", {
          error: JSON.stringify(err),
        }),
      );
      return null;
    }
  }, []);

  const runFlowJson = useCallback(
    async (
      flowJson: string,
      profiles: BrowserProfile[],
      settings: RunSettings,
    ): Promise<string | null> => {
      const runId = await invoke<string>("start_automation_run", {
        flowJson,
        profiles,
        settings,
      });
      // Seed the live state from the run snapshot so the grid shows every
      // selected profile immediately (idle) before the first status event.
      const seeded: Record<string, ProfileRunState> = {};
      for (const p of profiles) {
        seeded[p.id] = {
          profile_id: p.id,
          profile_name: p.name,
          status: "idle",
        };
      }
      setProfileStates(seeded);
      setLogs([]);
      setActiveRunId(runId);
      return runId;
    },
    [],
  );

  const start = useCallback(
    async (
      flowPath: string,
      profiles: BrowserProfile[],
      settings: RunSettings,
    ): Promise<string | null> => {
      if (profiles.length === 0) return null;
      setIsStarting(true);
      try {
        const flowJson = await invoke<string>("read_automation_flow", {
          path: flowPath,
        });
        if (!(await isFlowReviewed(flowPath, flowJson))) {
          const flow = JSON.parse(flowJson) as DonutFlowV1;
          setPendingReview({
            flowPath,
            flowName: flow.name,
            flowJson,
            items: extractFlowReviewItems(flow),
            profiles,
            settings,
          });
          return null;
        }
        return await runFlowJson(flowJson, profiles, settings);
      } catch (err) {
        console.error("Failed to start automation run:", err);
        showErrorToast(
          i18n.t("automation.errors.startFailed", {
            error: JSON.stringify(err),
          }),
        );
        return null;
      } finally {
        setIsStarting(false);
      }
    },
    [runFlowJson],
  );

  const confirmPendingReview = useCallback(async (): Promise<string | null> => {
    if (!pendingReview) return null;
    setIsStarting(true);
    try {
      await markFlowReviewed(pendingReview.flowPath, pendingReview.flowJson);
      const runId = await runFlowJson(
        pendingReview.flowJson,
        pendingReview.profiles,
        pendingReview.settings,
      );
      setPendingReview(null);
      return runId;
    } catch (err) {
      console.error("Failed to start reviewed automation run:", err);
      showErrorToast(
        i18n.t("automation.errors.startFailed", {
          error: JSON.stringify(err),
        }),
      );
      return null;
    } finally {
      setIsStarting(false);
    }
  }, [pendingReview, runFlowJson]);

  const cancelPendingReview = useCallback(() => setPendingReview(null), []);

  const stop = useCallback(async (runId: string) => {
    try {
      await invoke("stop_automation_run", { runId });
    } catch (err) {
      console.error("Failed to stop automation run:", err);
      showErrorToast(
        i18n.t("automation.errors.stopFailed", {
          error: JSON.stringify(err),
        }),
      );
    }
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  const getLogPath = useCallback(
    async (runId: string, profileId: string): Promise<string | null> => {
      try {
        return await invoke<string>("get_run_log_path", {
          runId,
          profileId,
        });
      } catch (err) {
        console.error("Failed to resolve log path:", err);
        return null;
      }
    },
    [],
  );

  // Subscribe to realtime status + log events for the lifetime of the hook.
  useEffect(() => {
    let statusUnlisten: UnlistenFn | undefined;
    let logUnlisten: UnlistenFn | undefined;

    const setup = async () => {
      statusUnlisten = await listen<ProfileRunState>(
        "automation-status",
        (event) => {
          const state = event.payload;
          setProfileStates((prev) => ({ ...prev, [state.profile_id]: state }));
        },
      );

      logUnlisten = await listen<LogLine>("automation-log", (event) => {
        const line = event.payload;
        // Only buffer logs for the run currently shown in the panel.
        const current = activeRunIdRef.current;
        if (current && line.runId && line.runId !== current) return;
        setLogs((prev) => {
          const next =
            prev.length >= MAX_LOG_LINES ? prev.slice(1) : prev.slice();
          next.push(line);
          return next;
        });
      });
    };

    void setup();

    return () => {
      if (statusUnlisten) statusUnlisten();
      if (logUnlisten) logUnlisten();
    };
  }, []);

  // Initial flow list.
  useEffect(() => {
    void loadFlows();
  }, [loadFlows]);

  // Poll the backend run snapshot periodically so the grid reconciles with
  // authoritative state (covers any missed event + terminal eviction).
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const list = await invoke<RunState[]>("list_automation_runs");
        if (cancelled) return;
        const map: Record<string, RunState> = {};
        for (const r of list) map[r.run_id] = r;
        setRuns(map);
        const current = activeRunIdRef.current;
        if (current && map[current]) {
          setProfileStates((prev) => {
            const merged = { ...prev };
            for (const [pid, st] of Object.entries(map[current].profiles)) {
              // Backend snapshot wins for terminal states; live events win
              // otherwise (they arrive faster than the poll).
              const existing = merged[pid];
              if (!existing || st.finished_at_ms != null) merged[pid] = st;
            }
            return merged;
          });
        }
      } catch {
        // ignore transient poll failures
      }
    };
    const id = window.setInterval(tick, 2000);
    void tick();
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  return {
    flows,
    activeRunId,
    runs,
    profileStates,
    logs,
    pendingReview,
    isStarting,
    loadFlows,
    readFlow,
    start,
    confirmPendingReview,
    cancelPendingReview,
    stop,
    clearLogs,
    getLogPath,
  };
}
