import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import i18n from "@/i18n";
import { showErrorToast } from "@/lib/toast-utils";

/** One flow's display metadata for the script-management grid (mirrors the
 * Rust `FlowMeta` struct returned by `list_automation_flow_meta`). */
export interface FlowMeta {
  /** Absolute path — the stable id passed back to run/edit/delete. */
  path: string;
  /** File stem without the `.donutflow` extension (display name). */
  name: string;
  /** Last-modified time in epoch milliseconds, or null if unavailable. */
  modified_ms: number | null;
}

export interface UseScriptManagementReturn {
  flows: FlowMeta[];
  isLoading: boolean;
  reload: () => Promise<void>;
  /** Read a flow's raw JSON (for duplicate/export). Returns null on failure. */
  readFlow: (path: string) => Promise<string | null>;
  /** Write a flow; throws on failure so callers can branch on "exists". */
  writeFlow: (
    name: string,
    json: string,
    overwrite: boolean,
  ) => Promise<string>;
  /** Delete a flow + its UI sidecars. Returns true on success. */
  deleteFlow: (path: string) => Promise<boolean>;
}

/** Hook for the script-management grid: lists `.donutflow` files with metadata
 * and exposes read/write/delete. Kept separate from `useAutomationRun` so the
 * run panel and the management grid don't pay for each other's state. */
export function useScriptManagement(): UseScriptManagementReturn {
  const [flows, setFlows] = useState<FlowMeta[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const list = await invoke<FlowMeta[]>("list_automation_flow_meta");
      setFlows(list);
    } catch (err) {
      console.error("Failed to list automation flows:", err);
      setFlows([]);
    } finally {
      setIsLoading(false);
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

  const writeFlow = useCallback(
    async (name: string, json: string, overwrite: boolean): Promise<string> => {
      // Let the caller handle errors (notably "exists" for the overwrite
      // confirm flow); don't swallow them here.
      return await invoke<string>("write_automation_flow", {
        name,
        json,
        overwrite,
      });
    },
    [],
  );

  const deleteFlow = useCallback(async (path: string): Promise<boolean> => {
    try {
      await invoke("delete_automation_flow", { path });
      return true;
    } catch (err) {
      console.error("Failed to delete flow:", err);
      showErrorToast(
        i18n.t("automation.script.errors.deleteFailed", {
          error: JSON.stringify(err),
        }),
      );
      return false;
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { flows, isLoading, reload, readFlow, writeFlow, deleteFlow };
}
