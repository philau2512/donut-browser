"use client";

import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import { AUTOMATION_NODE_BY_TYPE } from "@/lib/automation/node-catalog";
import { cn } from "@/lib/utils";
import type { AutomationCanvasNode } from "../serialize";

export function AutomationNode({
  data,
  selected,
}: NodeProps<AutomationCanvasNode>) {
  const { t } = useTranslation();
  if (data.nodeType === "start") {
    return (
      <div
        className={cn(
          "min-w-44 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm",
          selected && "border-primary ring-2 ring-primary/25",
          "border-emerald-500/60 bg-emerald-500/10",
        )}
      >
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">
            {t("automation.editor.start")}
          </span>
        </div>
        <Handle type="source" position={Position.Bottom} />
      </div>
    );
  }

  const catalog = AUTOMATION_NODE_BY_TYPE[data.nodeType];
  const Icon = catalog.icon;

  return (
    <div
      className={cn(
        "min-w-44 rounded-lg border bg-card px-3 py-2 text-card-foreground shadow-sm",
        selected && "border-primary ring-2 ring-primary/25",
      )}
    >
      <Handle type="target" position={Position.Top} />
      <div className="flex items-center gap-2">
        <Icon className="size-4 text-primary" />
        <span className="truncate text-sm font-medium">
          {t(catalog.labelKey)}
        </span>
      </div>
      <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
        {t(catalog.descriptionKey)}
      </p>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
