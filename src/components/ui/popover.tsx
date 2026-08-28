"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as React from "react";

import { cn } from "@/lib/utils";

function Popover({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

function PopoverTrigger({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Trigger>) {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

function PopoverContent({
  className,
  align = "center",
  sideOffset = 4,
  collisionPadding = 8,
  container,
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Content> & {
  container?: HTMLElement | null;
}) {
  const [localContainer, setLocalContainer] =
    React.useState<HTMLElement | null>(null);

  React.useEffect(() => {
    if (typeof window !== "undefined" && container === undefined) {
      const dialog = document.querySelector('[role="dialog"]');
      if (dialog) {
        setLocalContainer(dialog as HTMLElement);
      }
    }
  }, [container]);

  const resolvedContainer =
    container !== undefined ? container : localContainer;

  return (
    <PopoverPrimitive.Portal container={resolvedContainer}>
      <PopoverPrimitive.Content
        data-slot="popover-content"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        className={cn(
          "z-50000 max-h-(--radix-popover-content-available-height) origin-(--radix-popover-content-transform-origin) overflow-y-auto rounded-md surface-material-popover border p-4 text-popover-foreground shadow-md outline-hidden data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-[state=closed]:pointer-events-none data-[state=closed]:animate-none data-[state=closed]:opacity-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}

function PopoverAnchor({
  ...props
}: React.ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />;
}

export { Popover, PopoverAnchor, PopoverContent, PopoverTrigger };
