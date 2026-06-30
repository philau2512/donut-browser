"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { LuMessageSquare, LuPencil, LuPlay, LuTrash2 } from "react-icons/lu";
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

  // Make all action nodes blue, matching the Houston theme primary blue or standard primary
  const groupBg = "bg-primary text-primary-foreground border-primary/20";
  const badgeBg = "bg-primary-foreground/15";

  return (
    <div className="relative">
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
