"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuArrowLeft, LuCircleStop, LuPlay, LuRefreshCw } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAutomationRun } from "@/hooks/use-automation-run";
import { cn } from "@/lib/utils";
import type { BrowserProfile } from "@/types";
import {
  DEFAULT_RUN_SETTINGS,
  isTerminalStatus,
  type RunSettings,
} from "@/types/automation-types";
import { AutomationLogPanel } from "./automation-log-panel";
import { AutomationRunSettings } from "./automation-run-settings";
import { AutomationRunnerGrid } from "./automation-runner-grid";
import { FlowReviewDialog } from "./editor/flow-review-dialog";

interface AutomationPageProps {
  profiles: BrowserProfile[];
  /** When set, preselect this flow on mount (the run panel was opened from a
   * script card). Undefined keeps the legacy "pick a flow" entry point. */
  initialFlowPath?: string;
  /** When set, render a Back control that returns to the script list. */
  onBack?: () => void;
}

/** Strip the directory + extension from a flow path for display. */
function flowLabel(path: string): string {
  const base = path.split(/[/\\]/).pop() ?? path;
  return base.replace(/\.donutflow$/i, "");
}

export function AutomationPage({
  profiles,
  initialFlowPath,
  onBack,
}: AutomationPageProps) {
  const { t } = useTranslation();
  const {
    flows,
    activeRunId,
    runs,
    profileStates,
    logs,
    pendingReview,
    isStarting,
    loadFlows,
    start,
    confirmPendingReview,
    cancelPendingReview,
    stop,
    clearLogs,
    getLogPath,
  } = useAutomationRun();

  const [selectedFlow, setSelectedFlow] = useState<string>("");
  const [selectedProfileIds, setSelectedProfileIds] = useState<Set<string>>(
    new Set(),
  );
  const [settings, setSettings] = useState<RunSettings>(DEFAULT_RUN_SETTINGS);

  // Preselect the flow the run panel was opened with (from a script card),
  // once it appears in the loaded list. Only seeds an empty selection so it
  // never fights a manual change.
  useEffect(() => {
    if (!initialFlowPath) return;
    if (!flows.includes(initialFlowPath)) return;
    setSelectedFlow((prev) => (prev === "" ? initialFlowPath : prev));
  }, [initialFlowPath, flows]);

  // The active run is "live" while any of its profiles is still non-terminal.
  const activeRun = activeRunId ? runs[activeRunId] : undefined;
  const isRunLive = useMemo(() => {
    const states = Object.values(profileStates);
    if (states.length === 0) return false;
    return states.some((s) => !isTerminalStatus(s.status));
  }, [profileStates]);

  const toggleProfile = (id: string) => {
    setSelectedProfileIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedProfileIds((prev) =>
      prev.size === profiles.length
        ? new Set()
        : new Set(profiles.map((p) => p.id)),
    );
  };

  const handleRun = async () => {
    if (!selectedFlow || selectedProfileIds.size === 0) return;
    const selected = profiles.filter((p) => selectedProfileIds.has(p.id));
    await start(selectedFlow, selected, settings);
  };

  const handleStopRun = async () => {
    if (activeRunId) await stop(activeRunId);
  };

  // Keep selection valid as the profile list changes (deletions).
  useEffect(() => {
    setSelectedProfileIds((prev) => {
      const valid = new Set(profiles.map((p) => p.id));
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (valid.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [profiles]);

  const canRun =
    !!selectedFlow && selectedProfileIds.size > 0 && !isStarting && !isRunLive;

  return (
    <div className="flex min-h-0 flex-1 gap-3 p-3">
      {/* Left column: configuration */}
      <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-card p-4">
        {onBack && (
          <button
            type="button"
            className="-mb-1 flex items-center gap-1.5 self-start text-xs text-muted-foreground hover:text-foreground"
            onClick={onBack}
          >
            <LuArrowLeft className="size-3.5" />
            {t("common.buttons.back")}
          </button>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("automation.flow.label")}
            </span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-6"
              aria-label={t("automation.flow.refresh")}
              onClick={() => void loadFlows()}
            >
              <LuRefreshCw className="size-3.5" />
            </Button>
          </div>
          <Select value={selectedFlow} onValueChange={setSelectedFlow}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={t("automation.flow.placeholder")} />
            </SelectTrigger>
            <SelectContent>
              {flows.map((f) => (
                <SelectItem key={f} value={f}>
                  {flowLabel(f)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {flows.length === 0 && (
            <p className="text-[11px] text-muted-foreground">
              {t("automation.flow.empty")}
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-col space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("automation.profiles.label", {
                count: selectedProfileIds.size,
              })}
            </span>
            <button
              type="button"
              className="text-[11px] text-primary hover:underline"
              onClick={toggleAll}
            >
              {selectedProfileIds.size === profiles.length
                ? t("automation.profiles.deselectAll")
                : t("automation.profiles.selectAll")}
            </button>
          </div>
          <div className="max-h-64 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
            {profiles.length === 0 ? (
              <p className="p-2 text-[11px] text-muted-foreground">
                {t("automation.profiles.empty")}
              </p>
            ) : (
              profiles.map((p) => (
                <label
                  key={p.id}
                  htmlFor={`automation-profile-${p.id}`}
                  className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-accent/40"
                >
                  <Checkbox
                    id={`automation-profile-${p.id}`}
                    checked={selectedProfileIds.has(p.id)}
                    onCheckedChange={() => toggleProfile(p.id)}
                  />
                  <span className="truncate">{p.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t("automation.settings.title")}
          </span>
          <AutomationRunSettings
            settings={settings}
            onChange={setSettings}
            disabled={isRunLive}
          />
        </div>

        <div className="mt-auto flex gap-2 pt-2">
          {isRunLive ? (
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              onClick={() => void handleStopRun()}
            >
              <LuCircleStop className="mr-2 size-4" />
              {t("automation.actions.stopAll")}
            </Button>
          ) : (
            <Button
              type="button"
              className="flex-1"
              disabled={!canRun}
              onClick={() => void handleRun()}
            >
              <LuPlay className="mr-2 size-4" />
              {isStarting
                ? t("automation.actions.starting")
                : t("automation.actions.run")}
            </Button>
          )}
        </div>
      </div>

      {/* Right column: grid + log */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div
          className={cn(
            "shrink-0 overflow-y-auto rounded-lg border border-border bg-background p-3",
            "max-h-[45%]",
          )}
        >
          <AutomationRunnerGrid
            profileStates={profileStates}
            canStop={isRunLive}
            onStopProfile={() => void handleStopRun()}
          />
        </div>
        <div className="min-h-0 flex-1">
          <AutomationLogPanel
            logs={logs}
            profileStates={profileStates}
            activeRunId={activeRunId}
            onClear={clearLogs}
            getLogPath={getLogPath}
          />
        </div>
        {activeRun && (
          <p className="shrink-0 text-[11px] text-muted-foreground">
            {t("automation.runInfo", { name: activeRun.flow_name })}
          </p>
        )}
      </div>

      <FlowReviewDialog
        open={pendingReview !== null}
        flowName={pendingReview?.flowName ?? ""}
        items={pendingReview?.items ?? []}
        onCancel={cancelPendingReview}
        onConfirm={() => void confirmPendingReview()}
      />
    </div>
  );
}
