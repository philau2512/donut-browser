"use client";

import React from "react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

interface NonHoverableTooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  sideOffset?: number;
  alignOffset?: number;
  horizontalOffset?: number;
}

export const NonHoverableTooltip = React.memo<NonHoverableTooltipProps>(
  ({
    children,
    content,
    sideOffset = 4,
    alignOffset = 0,
    horizontalOffset = 0,
  }) => {
    const [isOpen, setIsOpen] = React.useState(false);

    return (
      <Tooltip open={isOpen} onOpenChange={setIsOpen}>
        <TooltipTrigger
          asChild
          onMouseEnter={() => {
            setIsOpen(true);
          }}
          onMouseLeave={() => {
            setIsOpen(false);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent
          sideOffset={sideOffset}
          alignOffset={alignOffset}
          arrowOffset={horizontalOffset}
          onPointerEnter={(e) => {
            e.preventDefault();
          }}
          onPointerLeave={() => {
            setIsOpen(false);
          }}
          className="pointer-events-none"
          style={
            horizontalOffset !== 0
              ? { transform: `translateX(${horizontalOffset}px)` }
              : undefined
          }
        >
          {content}
        </TooltipContent>
      </Tooltip>
    );
  },
);

NonHoverableTooltip.displayName = "NonHoverableTooltip";

interface OverflowTooltipTextProps {
  text: string;
  className?: string;
}

// CSS-truncated text whose tooltip only appears when the text actually
// overflows its column (measured on hover, so it tracks live resizes).
export const OverflowTooltipText = React.memo<OverflowTooltipTextProps>(
  ({ text, className }) => {
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
          <span
            ref={textRef}
            className={cn("block max-w-full min-w-0 truncate", className)}
          >
            {text}
          </span>
        </TooltipTrigger>
        {isOverflowing && <TooltipContent>{text}</TooltipContent>}
      </Tooltip>
    );
  },
);

OverflowTooltipText.displayName = "OverflowTooltipText";
