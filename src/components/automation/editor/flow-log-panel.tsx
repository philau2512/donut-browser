"use client";

import { useTranslation } from "react-i18next";
import { LuCheckCheck, LuInfo, LuX } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface FlowLogLine {
  id: string;
  type: "success" | "info" | "warn" | "error";
  message: string;
  duration?: number;
  nodeId?: string;
}

export interface FlowExecutionStep {
  id: string;
  label: string;
  status: "success" | "running" | "idle" | "error";
  iconName?: string;
}

interface FlowLogPanelProps {
  logs: FlowLogLine[];
  steps: FlowExecutionStep[];
  variables: Record<string, string>;
  onClose: () => void;
  onSelectNode?: (nodeId: string | null) => void;
  selectedNodeId?: string | null;
  className?: string;
}

export function FlowLogPanel({
  logs,
  steps,
  variables,
  onClose,
  onSelectNode,
  selectedNodeId,
  className,
}: FlowLogPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "flex h-64 shrink-0 flex-col border-t border-border bg-card shadow-lg transition-all duration-300 ease-in-out",
        className,
      )}
    >
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-foreground tracking-wide uppercase">
            {t("automation.editor.logs.title") || "Log"}
          </span>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-6 text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          <LuX className="size-4" />
        </Button>
      </div>

      {/* Panel Content */}
      <div className="flex flex-1 min-h-0 divide-x divide-border">
        {/* Left Side: Timeline and Variable State */}
        <div className="flex flex-1 flex-col p-4 overflow-y-auto space-y-4 min-w-0">
          {/* Visual Timeline */}
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("automation.editor.logs.timeline") || "Execution Timeline"}
            </h4>
            <div className="flex items-center gap-2 overflow-x-auto py-2">
              {steps.map((step, idx) => (
                <div key={step.id} className="flex items-center">
                  <button
                    type="button"
                    onClick={() => onSelectNode?.(step.id)}
                    className={cn(
                      "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition shadow-sm hover:opacity-90 active:scale-95 cursor-pointer",
                      step.status === "success" &&
                        "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
                      step.status === "running" &&
                        "border-blue-500/30 bg-blue-500/10 text-blue-400 animate-pulse",
                      step.status === "error" &&
                        "border-destructive/30 bg-destructive/10 text-destructive",
                      step.status === "idle" &&
                        "border-border bg-muted/30 text-muted-foreground",
                      selectedNodeId === step.id &&
                        "ring-2 ring-amber-500 border-amber-500",
                    )}
                  >
                    {step.status === "success" && (
                      <LuCheckCheck className="size-3.5 shrink-0" />
                    )}
                    {step.status === "running" && (
                      <LuInfo className="size-3.5 shrink-0 animate-spin" />
                    )}
                    <span className="truncate max-w-[100px]">{step.label}</span>
                  </button>
                  {idx < steps.length - 1 && (
                    <div className="mx-2 h-[2px] w-8 bg-border" />
                  )}
                </div>
              ))}
              {steps.length === 0 && (
                <p className="text-xs text-muted-foreground italic">
                  {t("automation.editor.logs.noSteps") ||
                    "No steps executed yet."}
                </p>
              )}
            </div>
          </div>

          {/* Variables State */}
          <div className="flex-1 flex flex-col min-h-0 space-y-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("automation.editor.logs.variablesState") || "Variables State"}
            </h4>
            <div className="flex-1 overflow-y-auto rounded-md border border-border bg-background/50 p-3 font-mono text-[11px]">
              {Object.keys(variables).length > 0 ? (
                <div className="grid grid-cols-[120px_1fr] gap-x-4 gap-y-1 text-muted-foreground">
                  {Object.entries(variables).map(([key, val]) => (
                    <div key={key} className="contents hover:text-foreground">
                      <span className="text-amber-500/90 truncate font-semibold">
                        {key}
                      </span>
                      <span className="truncate border-l border-border pl-3">
                        {val || "undefined"}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  {t("automation.editor.logs.noVariables") ||
                    "No local variables defined."}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right Side: Log Console Output */}
        <div className="flex w-[45%] shrink-0 flex-col bg-background/30 p-4 font-mono text-[11px] leading-relaxed">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground font-sans">
              {t("automation.editor.logs.console") || "Logs Output"}
            </h4>
          </div>
          <div className="flex-1 overflow-y-auto rounded-md border border-border bg-zinc-950/90 p-3 space-y-1 scrollbar-thin">
            {logs.map((log) => (
              // biome-ignore lint/a11y/useKeyWithClickEvents: Click handler on log line is a helper shortcut
              // biome-ignore lint/a11y/noStaticElementInteractions: Log container selection is a mouse click helper
              <div
                key={log.id}
                onClick={() => {
                  if (log.nodeId) {
                    onSelectNode?.(log.nodeId);
                  }
                }}
                className={cn(
                  "flex items-center gap-1.5 cursor-pointer py-0.5 px-1 rounded transition-colors hover:bg-zinc-800/40 select-none",
                  log.type === "success" && "text-emerald-400",
                  log.type === "info" && "text-blue-400",
                  log.type === "warn" && "text-amber-500",
                  log.type === "error" && "text-destructive font-semibold",
                  log.nodeId &&
                    selectedNodeId === log.nodeId &&
                    "bg-amber-500/10 border-l-2 border-amber-500 pl-1",
                )}
              >
                <span className="shrink-0 opacity-70">
                  {log.type === "success" && "[Success]"}
                  {log.type === "info" && "[Info]"}
                  {log.type === "warn" && "[Warning]"}
                  {log.type === "error" && "[Error]"}
                </span>
                {log.nodeId && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectNode?.(log.nodeId ?? null);
                    }}
                    className={cn(
                      "font-mono text-[9px] px-1 py-0.5 rounded border leading-none hover:bg-white/10 hover:text-white transition shrink-0 cursor-pointer",
                      selectedNodeId === log.nodeId
                        ? "border-amber-500 bg-amber-500/20 text-amber-300 font-semibold"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400",
                    )}
                  >
                    {log.nodeId}
                  </button>
                )}
                <span>
                  {log.message}
                  {log.duration !== undefined && ` | ${log.duration}ms`}
                </span>
              </div>
            ))}
            {logs.length === 0 && (
              <div className="flex h-full items-center justify-center text-muted-foreground font-sans italic text-xs">
                {t("automation.editor.logs.consoleEmpty") ||
                  "Waiting for flow execution..."}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
