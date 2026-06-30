"use client";

import { useTranslation } from "react-i18next";
import { LuCircleStop } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProfileRunState, RunStatus } from "@/types/automation-types";
import { isTerminalStatus } from "@/types/automation-types";

interface AutomationRunnerGridProps {
  profileStates: Record<string, ProfileRunState>;
  onStopProfile?: (profileId: string) => void;
  canStop?: boolean;
}

/** Per-status visual treatment for the state badge. Reuses theme tokens so it
 * follows light/dark. done-with-errors=amber, skipped=muted (per plan). */
const STATUS_STYLES: Record<RunStatus, string> = {
  idle: "bg-muted text-muted-foreground border-transparent",
  launching: "bg-blue-500/15 text-blue-500 border-transparent",
  running: "bg-blue-500/15 text-blue-500 border-transparent",
  done: "bg-success/15 text-success border-transparent",
  "done-with-errors": "bg-amber-500/15 text-amber-500 border-transparent",
  error: "bg-destructive/15 text-destructive border-transparent",
  skipped: "bg-muted text-muted-foreground border-transparent",
  stopped: "bg-muted text-muted-foreground border-transparent",
};

export function AutomationRunnerGrid({
  profileStates,
  onStopProfile,
  canStop = false,
}: AutomationRunnerGridProps) {
  const { t } = useTranslation();
  const entries = Object.values(profileStates);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {t("automation.grid.empty")}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {entries.map((state) => {
        const running = !isTerminalStatus(state.status);
        return (
          <div
            key={state.profile_id}
            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="min-w-0 space-y-1">
              <div className="truncate text-sm font-medium text-foreground">
                {state.profile_name}
              </div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="outline"
                  className={cn("text-[11px]", STATUS_STYLES[state.status])}
                >
                  {t(`automation.status.${camelStatus(state.status)}`)}
                </Badge>
                {state.error && (
                  <span
                    className="truncate text-[11px] text-destructive"
                    title={state.error}
                  >
                    {state.error}
                  </span>
                )}
              </div>
            </div>
            {canStop && running && onStopProfile && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={t("automation.grid.stopProfile", {
                  name: state.profile_name,
                })}
                onClick={() => onStopProfile(state.profile_id)}
              >
                <LuCircleStop className="size-4" />
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Map a kebab-case RunStatus to the camelCase i18n key segment. */
function camelStatus(status: RunStatus): string {
  return status === "done-with-errors" ? "doneWithErrors" : status;
}
