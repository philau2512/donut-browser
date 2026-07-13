"use client";

import { useReactFlow } from "@xyflow/react";
import { useTranslation } from "react-i18next";
import {
  LuLock,
  LuLockOpen,
  LuMaximize,
  LuMinus,
  LuPlus,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface FlowControlsOverlayProps {
  isLocked: boolean;
  onToggleLock: () => void;
  className?: string;
}

export function FlowControlsOverlay({
  isLocked,
  onToggleLock,
  className,
}: FlowControlsOverlayProps) {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "absolute left-4 bottom-4 z-50 flex flex-col rounded-md border border-border bg-card shadow-md overflow-hidden",
        className,
      )}
    >
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 rounded-none border-b border-border hover:bg-accent hover:text-accent-foreground"
        onClick={() => void zoomIn()}
        title={t("automation.editor.controls.zoomIn")}
      >
        <LuPlus className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 rounded-none border-b border-border hover:bg-accent hover:text-accent-foreground"
        onClick={() => void zoomOut()}
        title={t("automation.editor.controls.zoomOut")}
      >
        <LuMinus className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="size-8 rounded-none border-b border-border hover:bg-accent hover:text-accent-foreground"
        onClick={() => void fitView({ duration: 300 })}
        title={t("automation.editor.controls.fitView")}
      >
        <LuMaximize className="size-4" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className={cn(
          "size-8 rounded-none hover:bg-accent hover:text-accent-foreground",
          isLocked && "text-amber-500 hover:text-amber-600 bg-amber-500/10",
        )}
        onClick={onToggleLock}
        title={
          isLocked
            ? t("automation.editor.controls.unlock")
            : t("automation.editor.controls.lock")
        }
      >
        {isLocked ? (
          <LuLock className="size-4" />
        ) : (
          <LuLockOpen className="size-4" />
        )}
      </Button>
    </div>
  );
}
