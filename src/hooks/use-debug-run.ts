import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BrowserProfile } from "@/types";
import type {
  LogLine,
  ProfileRunState,
  RunSettings,
} from "@/types/automation-types";

const MAX_LOG_LINES = 2000;

const DEBUG_SETTINGS: RunSettings = {
  concurrency: 1,
  delayOpenSecs: 0,
  headless: false,
  closeOnComplete: false, // Keep browser open for inspection after completion
  writeLogs: true,
  noOverlapping: true,
};

export interface UseDebugRunReturn {
  isRunning: boolean;
  runId: string | null;
  profileState: ProfileRunState | null;
  logs: LogLine[];
  startDebugRun: (
    flowJson: string,
    profile: BrowserProfile,
  ) => Promise<string | null>;
  stopDebugRun: () => Promise<void>;
  clearLogs: () => void;
}

export function useDebugRun(): UseDebugRunReturn {
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [profileState, setProfileState] = useState<ProfileRunState | null>(
    null,
  );
  const [logs, setLogs] = useState<LogLine[]>([]);

  const runIdRef = useRef<string | null>(null);
  useEffect(() => {
    runIdRef.current = runId;
  }, [runId]);

  const startDebugRun = useCallback(
    async (
      flowJson: string,
      profile: BrowserProfile,
    ): Promise<string | null> => {
      setIsRunning(true);
      setProfileState({
        profile_id: profile.id,
        profile_name: profile.name,
        status: "idle",
      });
      setLogs([]);

      try {
        const id = await invoke<string>("start_automation_run", {
          flowJson,
          profiles: [profile],
          settings: DEBUG_SETTINGS,
        });
        setRunId(id);
        return id;
      } catch (err) {
        console.error("Failed to start debug run:", err);
        setIsRunning(false);
        setProfileState(null);
        throw err;
      }
    },
    [],
  );

  const stopDebugRun = useCallback(async () => {
    const currentRunId = runIdRef.current;
    if (!currentRunId) return;
    try {
      await invoke("stop_automation_run", { runId: currentRunId });
    } catch (err) {
      console.error("Failed to stop debug run:", err);
    }
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  // Realtime events subscription
  useEffect(() => {
    let statusUnlisten: UnlistenFn | undefined;
    let logUnlisten: UnlistenFn | undefined;
    let active = true;

    const setup = async () => {
      const unlistenStatus = await listen<ProfileRunState>(
        "automation-status",
        (event) => {
          if (!active) return;
          const state = event.payload;
          // Verify if this is the active debug profile
          const _currentRunId = runIdRef.current;
          if (profileState && state.profile_id !== profileState.profile_id)
            return;
          setProfileState(state);

          // If the profile transitioned to terminal, we stop running
          const isTerminal = [
            "done",
            "done-with-errors",
            "error",
            "skipped",
            "stopped",
          ].includes(state.status);
          if (isTerminal) {
            setIsRunning(false);
          }
        },
      );
      if (!active) {
        unlistenStatus();
        return;
      }
      statusUnlisten = unlistenStatus;

      const unlistenLog = await listen<LogLine>("automation-log", (event) => {
        if (!active) return;
        const line = event.payload;
        const currentRunId = runIdRef.current;
        if (currentRunId && line.runId && line.runId !== currentRunId) return;

        setLogs((prev) => {
          const next =
            prev.length >= MAX_LOG_LINES ? prev.slice(1) : prev.slice();
          next.push(line);
          return next;
        });
      });
      if (!active) {
        unlistenLog();
        return;
      }
      logUnlisten = unlistenLog;
    };

    void setup();

    return () => {
      active = false;
      if (statusUnlisten) statusUnlisten();
      if (logUnlisten) logUnlisten();
    };
  }, [profileState]);

  return {
    isRunning,
    runId,
    profileState,
    logs,
    startDebugRun,
    stopDebugRun,
    clearLogs,
  };
}
