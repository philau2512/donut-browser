"use client";

import { AlertTriangle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface ValidationWarning {
  type: "error" | "warning" | "info";
  message: string;
}

interface ValidationBadgeProps {
  warnings: ValidationWarning[];
}

export function ValidationBadge({ warnings }: ValidationBadgeProps) {
  if (warnings.length === 0) return null;

  const hasError = warnings.some((w) => w.type === "error");

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant={hasError ? "destructive" : "secondary"}
            className="gap-1 cursor-help"
          >
            {hasError ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Info className="h-3 w-3" />
            )}
            {warnings.length} issue{warnings.length > 1 ? "s" : ""}
          </Badge>
        </TooltipTrigger>
        <TooltipContent side="bottom" align="start" className="max-w-sm">
          <ul className="list-disc list-inside space-y-1 text-sm">
            {warnings.map((warning, i) => (
              <li
                key={i}
                className={warning.type === "error" ? "text-destructive" : ""}
              >
                {warning.message}
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
