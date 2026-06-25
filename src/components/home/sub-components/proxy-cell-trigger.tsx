"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface ProxyCellTriggerProps {
  displayName: string;
  hasAssignment: boolean;
  vpnBadge: string | null;
  isDisabled: boolean;
}

export const ProxyCellTrigger = React.memo<ProxyCellTriggerProps>(
  ({ displayName, hasAssignment, vpnBadge, isDisabled }) => {
    const textRef = React.useRef<HTMLSpanElement | null>(null);
    const [isOverflowing, setIsOverflowing] = React.useState(false);

    return (
      <Tooltip
        onOpenChange={(open) => {
          if (!open) return;
          const el = textRef.current;
          if (el) setIsOverflowing(el.scrollWidth > el.clientWidth);
        }}
      >
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <span
              className={cn(
                "flex max-w-full min-w-0 items-center gap-2 rounded px-2 py-1",
                isDisabled
                  ? "pointer-events-none cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-accent/50",
              )}
            >
              {vpnBadge && (
                <Badge
                  variant="outline"
                  className="shrink-0 px-1 py-0 text-[10px] leading-tight"
                >
                  {vpnBadge}
                </Badge>
              )}
              <span
                ref={textRef}
                className={cn(
                  "min-w-0 truncate text-sm",
                  !hasAssignment && "text-muted-foreground",
                )}
              >
                {displayName}
              </span>
            </span>
          </PopoverTrigger>
        </TooltipTrigger>
        {hasAssignment && isOverflowing && (
          <TooltipContent>{displayName}</TooltipContent>
        )}
      </Tooltip>
    );
  },
);

ProxyCellTrigger.displayName = "ProxyCellTrigger";
