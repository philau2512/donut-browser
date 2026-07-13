"use client";

import { useTranslation } from "react-i18next";
import { LuX } from "react-icons/lu";
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
  style?: React.CSSProperties;
}

export function FlowLogPanel({
  logs,
  steps: _steps,
  variables: _variables,
  onClose,
  onSelectNode,
  selectedNodeId,
  className,
  style,
}: FlowLogPanelProps) {
  const { t } = useTranslation();

  return (
    <div
      style={style}
      className={cn(
        "flex shrink-0 flex-col border-t border-border bg-card shadow-lg",
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
      <div className="flex flex-1 min-h-0">
        {/* Log Console Output */}
        <div className="flex flex-1 flex-col bg-background/30 p-3 font-mono text-[11px] leading-relaxed">
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
                  "flex items-center flex-nowrap gap-1.5 cursor-pointer py-0.5 px-1 rounded transition-colors hover:bg-zinc-800/40 w-full min-w-0",
                  log.type === "success" && "text-emerald-400",
                  log.type === "info" && "text-blue-400",
                  log.type === "warn" && "text-amber-500",
                  log.type === "error" && "text-destructive font-semibold",
                  log.nodeId &&
                    selectedNodeId === log.nodeId &&
                    "bg-amber-500/10 border-l-2 border-amber-500 pl-1",
                )}
              >
                <span className="shrink-0 opacity-70 whitespace-nowrap">
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
                      "font-mono text-[9px] px-1 py-0.5 rounded border leading-none hover:bg-white/10 hover:text-white transition shrink-0 cursor-pointer whitespace-nowrap",
                      selectedNodeId === log.nodeId
                        ? "border-amber-500 bg-amber-500/20 text-amber-300 font-semibold"
                        : "border-zinc-700 bg-zinc-800 text-zinc-400",
                    )}
                  >
                    {log.nodeId}
                  </button>
                )}
                <span className="min-w-0 truncate whitespace-nowrap select-text">
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
