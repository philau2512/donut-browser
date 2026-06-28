"use client";

import { openPath } from "@tauri-apps/plugin-opener";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuLock, LuLockOpen } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { LogLine, ProfileRunState } from "@/types/automation-types";

interface AutomationLogPanelProps {
  logs: LogLine[];
  profileStates: Record<string, ProfileRunState>;
  activeRunId: string | null;
  onClear: () => void;
  getLogPath: (runId: string, profileId: string) => Promise<string | null>;
}

const LEVEL_STYLES: Record<string, string> = {
  error: "text-destructive",
  warn: "text-amber-500",
  debug: "text-muted-foreground",
  info: "text-foreground",
};

export function AutomationLogPanel({
  logs,
  profileStates,
  activeRunId,
  onClear,
  getLogPath,
}: AutomationLogPanelProps) {
  const { t } = useTranslation();
  const [filterProfile, setFilterProfile] = useState<string>("__all__");
  const [scrollLocked, setScrollLocked] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const profileOptions = useMemo(
    () => Object.values(profileStates),
    [profileStates],
  );

  const filtered = useMemo(() => {
    if (filterProfile === "__all__") return logs;
    return logs.filter((l) => l.profileId === filterProfile);
  }, [logs, filterProfile]);

  // Auto-scroll to the newest line while scroll-lock is on.
  useEffect(() => {
    if (!scrollLocked) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [scrollLocked]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: re-pin on every new line
  useEffect(() => {
    if (!scrollLocked) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [filtered.length, scrollLocked]);

  const openLogFile = async () => {
    if (!activeRunId || filterProfile === "__all__") return;
    const path = await getLogPath(activeRunId, filterProfile);
    if (path) {
      try {
        await openPath(path);
      } catch (err) {
        console.error("Failed to open log file:", err);
      }
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-border bg-card">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          {t("automation.log.title")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Select value={filterProfile} onValueChange={setFilterProfile}>
            <SelectTrigger size="sm" className="h-7 w-40 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">
                {t("automation.log.allProfiles")}
              </SelectItem>
              {profileOptions.map((p) => (
                <SelectItem key={p.profile_id} value={p.profile_id}>
                  {p.profile_name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            aria-label={
              scrollLocked
                ? t("automation.log.scrollUnlock")
                : t("automation.log.scrollLock")
            }
            onClick={() => setScrollLocked((v) => !v)}
          >
            {scrollLocked ? (
              <LuLock className="size-3.5" />
            ) : (
              <LuLockOpen className="size-3.5" />
            )}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="size-7"
            disabled={filterProfile === "__all__" || !activeRunId}
            aria-label={t("automation.log.openFile")}
            onClick={() => void openLogFile()}
          >
            <LuExternalLink className="size-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={onClear}
          >
            {t("common.buttons.clear")}
          </Button>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            {t("automation.log.empty")}
          </div>
        ) : (
          filtered.map((line, idx) => {
            const msg = line.msg ?? "";
            let colorClass = LEVEL_STYLES[line.level ?? "info"];
            if (line.level === "error" || msg.startsWith("✗")) {
              colorClass = "text-destructive font-semibold";
            } else if (msg.startsWith("▶")) {
              colorClass = "text-muted-foreground/60";
            } else if (msg.startsWith("✓")) {
              colorClass = "text-foreground";
            }

            return (
              <div
                key={`${line.ts ?? 0}-${idx}`}
                className={cn("whitespace-pre-wrap break-words", colorClass)}
                style={line.color ? { color: line.color } : undefined}
              >
                <span className="text-muted-foreground/60">
                  {formatTs(line.ts)}{" "}
                </span>
                {line.profileId && filterProfile === "__all__" && (
                  <span className="text-muted-foreground/80">
                    [
                    {profileStates[line.profileId]?.profile_name ??
                      line.profileId}
                    ]{" "}
                  </span>
                )}
                {line.msg ?? ""}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function formatTs(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return "";
  }
}
