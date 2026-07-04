"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  LuCheck,
  LuMessageSquare,
  LuPencil,
  LuPlay,
  LuTrash2,
  LuX,
} from "react-icons/lu";
import { AUTOMATION_NODE_BY_TYPE } from "@/lib/automation/node-catalog";
import { cn } from "@/lib/utils";
import type { AutomationCanvasNode } from "../serialize";

export function AutomationNode({
  id,
  data,
  selected,
}: NodeProps<AutomationCanvasNode>) {
  const { t } = useTranslation();
  if (data.nodeType === "start") {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center rounded-full border text-center shadow-md",
          "w-20 h-20 bg-success text-success-foreground border-success-foreground/20",
          selected && "ring-4 ring-success/35",
        )}
      >
        <svg
          className="size-5 fill-current"
          viewBox="0 0 24 24"
          role="img"
          aria-label="Start"
        >
          <title>Start</title>
          <path d="M8 5v14l11-7z" />
        </svg>
        <span className="text-[10px] font-bold leading-none mt-1">
          {t("automation.editor.start")}
        </span>
        <Handle
          type="source"
          position={Position.Right}
          id="success"
          className="!bg-background !w-3 !h-3 !border !border-success hover:scale-125 transition-transform"
        />
      </div>
    );
  }

  const nodeType = data.nodeType;
  const catalog = AUTOMATION_NODE_BY_TYPE[nodeType];
  const Icon = catalog.icon;
  const group = catalog.group || "other";

  // Dynamic group colors matching the BAS style palette
  const GROUP_COLORS: Record<
    string,
    { card: string; badge: string; handle: string }
  > = {
    navigator: {
      card: "bg-sky-50/95 dark:bg-sky-950/40 text-sky-950 dark:text-sky-100 border-sky-300 dark:border-sky-800",
      badge: "bg-sky-100 dark:bg-sky-900/50 text-sky-600 dark:text-sky-300",
      handle: "!border-sky-400",
    },
    mouse: {
      card: "bg-rose-50/95 dark:bg-rose-950/40 text-rose-950 dark:text-rose-100 border-rose-300 dark:border-rose-800",
      badge: "bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300",
      handle: "!border-rose-400",
    },
    keyboard: {
      card: "bg-amber-50/95 dark:bg-amber-950/40 text-amber-950 dark:text-amber-100 border-amber-300 dark:border-amber-800",
      badge:
        "bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300",
      handle: "!border-amber-400",
    },
    data: {
      card: "bg-emerald-50/95 dark:bg-emerald-950/40 text-emerald-950 dark:text-emerald-100 border-emerald-300 dark:border-emerald-800",
      badge:
        "bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-300",
      handle: "!border-emerald-400",
    },
    network: {
      card: "bg-indigo-50/95 dark:bg-indigo-950/40 text-indigo-950 dark:text-indigo-100 border-indigo-300 dark:border-indigo-800",
      badge:
        "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300",
      handle: "!border-indigo-400",
    },
    control: {
      card: "bg-pink-50/95 dark:bg-pink-950/40 text-pink-950 dark:text-pink-100 border-pink-300 dark:border-pink-800",
      badge: "bg-pink-100 dark:bg-pink-900/50 text-pink-600 dark:text-pink-300",
      handle: "!border-pink-400",
    },
    utility: {
      card: "bg-teal-50/95 dark:bg-teal-950/40 text-teal-950 dark:text-teal-100 border-teal-300 dark:border-teal-800",
      badge: "bg-teal-100 dark:bg-teal-900/50 text-teal-600 dark:text-teal-300",
      handle: "!border-teal-400",
    },
    other: {
      card: "bg-slate-50/95 dark:bg-slate-900/40 text-slate-950 dark:text-slate-100 border-slate-300 dark:border-slate-700",
      badge:
        "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300",
      handle: "!border-slate-400",
    },
  };

  const colorConfig = GROUP_COLORS[group] || GROUP_COLORS.other;
  const groupBg = colorConfig.card;
  const badgeBg = colorConfig.badge;
  const _handleBorder = colorConfig.handle;

  const debugStatus = (data as any).debugStatus;

  return (
    <div className="relative">
      {/* Debug Status Indicator */}
      {debugStatus === "running" && (
        <div className="absolute -right-1 -top-1 z-50">
          <span className="relative flex size-4">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75" />
            <span className="relative inline-flex rounded-full size-4 bg-blue-500 border-2 border-background" />
          </span>
        </div>
      )}
      {debugStatus === "success" && (
        <div className="absolute -right-1 -top-1 z-50 flex size-4 items-center justify-center rounded-full bg-success border-2 border-background">
          <LuCheck className="size-2.5 text-success-foreground" />
        </div>
      )}
      {debugStatus === "error" && (
        <div className="absolute -right-1 -top-1 z-50 flex size-4 items-center justify-center rounded-full bg-destructive border-2 border-background">
          <LuX className="size-2.5 text-destructive-foreground" />
        </div>
      )}

      {/* Selected Action Toolbar */}
      {selected && (
        // biome-ignore lint/a11y/noStaticElementInteractions: stops propagation to canvas
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute -top-9 left-2 flex items-center gap-3.5 rounded-md border border-border bg-popover px-2.5 py-1.5 shadow-md pointer-events-auto z-50"
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              // Trigger comment modal
              (data as any).onComment?.(id);
            }}
            className="text-muted-foreground hover:text-primary transition"
            title={t("automation.editor.comment.title")}
          >
            <LuMessageSquare className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (data as any).onStartFromHere?.(id);
            }}
            className="text-success hover:scale-110 transition"
            title={t("automation.editor.toolbar.startFromHere")}
          >
            <LuPlay className="size-3.5 fill-success" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (data as any).onEdit?.(id);
            }}
            className="text-primary hover:scale-110 transition"
            title={t("automation.editor.toolbar.edit")}
          >
            <LuPencil className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              (data as any).onDelete?.(id);
            }}
            className="text-destructive hover:scale-110 transition"
            title={t("automation.editor.toolbar.delete")}
          >
            <LuTrash2 className="size-3.5" />
          </button>
        </div>
      )}

      <div
        className={cn(
          "w-[138px] rounded-xl border p-2 shadow-md transition-all",
          groupBg,
          selected && "brightness-[0.70] ring-2 ring-primary/35",
        )}
      >
        <Handle
          type="target"
          position={Position.Left}
          id="input"
          className="!bg-background !w-3 !h-3 !border !border-primary hover:scale-125 transition-transform"
        />
        <div className="flex items-center gap-2">
          <div
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-lg",
              badgeBg,
            )}
          >
            <Icon className="size-3.5" />
          </div>
          <div className="flex flex-col min-w-0 flex-1 justify-center">
            <span className="truncate text-xs font-bold leading-none">
              {t(catalog.labelKey)}
            </span>
          </div>
        </div>
        {nodeType === "ifCondition" ? (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="true"
              style={{ top: "35%" }}
              className="!bg-success !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
            <Handle
              type="source"
              position={Position.Right}
              id="false"
              style={{ top: "65%" }}
              className="!bg-destructive !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
          </>
        ) : nodeType === "loopFor" || nodeType === "loopElements" ? (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="loop"
              style={{ top: "35%" }}
              className="!bg-primary !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
            <Handle
              type="source"
              position={Position.Right}
              id="done"
              style={{ top: "65%" }}
              className="!bg-muted-foreground !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
          </>
        ) : (
          <>
            <Handle
              type="source"
              position={Position.Right}
              id="success"
              style={{ top: "35%" }}
              className="!bg-success !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              style={{ top: "65%" }}
              className="!bg-destructive !w-3 !h-3 !border !border-background hover:scale-125 transition-transform"
            />
          </>
        )}
      </div>

      {data.comment && (
        <div className="absolute top-[calc(100%+6px)] left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground/90 font-medium whitespace-nowrap text-center pointer-events-none select-none">
          {data.comment}
        </div>
      )}
    </div>
  );
}
