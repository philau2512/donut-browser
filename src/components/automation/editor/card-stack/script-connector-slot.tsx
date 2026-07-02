"use client";

import { type DragEvent, useState } from "react";
import { LuArrowRight } from "react-icons/lu";
import {
  type AutomationNodeType,
  isAutomationNodeType,
} from "@/lib/automation/node-catalog";
import { cn } from "@/lib/utils";
import type { CardStackSlot } from "./flow-card-stack-adapter";

interface ScriptConnectorSlotProps {
  slot: CardStackSlot;
  draggedNodeType: string | null;
  disabled?: boolean;
  isActive?: boolean;
  onInsertNode: (type: AutomationNodeType, slot: CardStackSlot) => void;
  onCreateLabel: (slot: CardStackSlot) => void;
  onSelectSlot?: (slot: CardStackSlot) => void;
}

export function ScriptConnectorSlot({
  slot,
  draggedNodeType,
  disabled = false,
  isActive = false,
  onInsertNode,
  onCreateLabel,
  onSelectSlot,
}: ScriptConnectorSlotProps) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  const resolveDraggedType = (event: DragEvent) => {
    const rawType =
      event.dataTransfer.getData("application/donut-node-type") ||
      event.dataTransfer.getData("text/plain");
    if (isAutomationNodeType(rawType)) return rawType;
    if (isAutomationNodeType(draggedNodeType)) return draggedNodeType;
    return null;
  };

  return (
    <div className="group/slot relative flex w-52 max-w-full flex-col items-center py-0.5">
      {/* Horizontal line & Arrow button container */}
      <div className="flex w-full items-center pl-[26px] pr-8 h-3">
        {/* Horizontal Line Dropzone */}
        <div
          className={cn(
            "h-1 flex-1 rounded bg-border/40 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/20",
            isDraggingOver && "bg-primary",
            isActive && "bg-primary ring-2 ring-primary/20",
            "group-hover/slot:bg-primary/60",
          )}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          aria-label="Connector drop zone"
          onClick={() => {
            if (!disabled && onSelectSlot) {
              onSelectSlot(slot);
            }
          }}
          onKeyDown={(event) => {
            if (disabled) return;
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onSelectSlot?.(slot);
            }
          }}
          onDragOver={(event) => {
            if (disabled) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setIsDraggingOver(false);
            if (disabled) return;
            const type = resolveDraggedType(event);
            if (type) onInsertNode(type, slot);
          }}
        />
      </div>

      {/* Arrow Button to Create Label */}
      <button
        type="button"
        onClick={() => {
          if (!disabled) onCreateLabel(slot);
        }}
        disabled={disabled}
        className={cn(
          "absolute right-2 top-1/2 -translate-y-1/2 flex size-5 shrink-0 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition hover:bg-accent hover:text-foreground",
          "opacity-0 group-hover/slot:opacity-100 focus:opacity-100",
        )}
        title="Create label here"
      >
        <LuArrowRight className="size-3" />
      </button>
    </div>
  );
}
