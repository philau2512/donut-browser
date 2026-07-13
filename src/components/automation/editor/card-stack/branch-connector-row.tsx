"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

interface BranchConnectorRowProps {
  nodeId: string;
  handles: string[];
  labels: Array<{ id: string; name: string }>;
  disabled?: boolean;
  onMoveToLabel: (
    sourceNodeId: string,
    labelId: string,
    sourceHandle: string,
  ) => void;
}

export function BranchConnectorRow({
  nodeId,
  handles,
  labels,
  disabled = false,
  onMoveToLabel,
}: BranchConnectorRowProps) {
  if (handles.length <= 1 || labels.length === 0) return null;

  return (
    <div className="mt-3 grid gap-2 border-t border-border/70 pt-3">
      {handles.map((handle) => (
        <div
          key={handle}
          className="grid grid-cols-[70px_1fr] items-center gap-2"
        >
          <span
            className={cn(
              "rounded-full px-2 py-1 text-center text-[10px] font-bold uppercase tracking-wide",
              handle === "fail" || handle === "false"
                ? "bg-destructive/10 text-destructive"
                : "bg-emerald-500/10 text-emerald-500",
            )}
          >
            {handle}
          </span>
          <Select
            disabled={disabled}
            onValueChange={(labelId) => onMoveToLabel(nodeId, labelId, handle)}
          >
            <SelectTrigger className="h-7 text-xs">
              <SelectValue placeholder="move to label..." />
            </SelectTrigger>
            <SelectContent>
              {labels.map((label) => (
                <SelectItem key={label.id} value={label.id}>
                  {label.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ))}
    </div>
  );
}
