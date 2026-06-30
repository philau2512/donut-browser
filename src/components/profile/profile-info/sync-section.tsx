"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { LuRefreshCw } from "react-icons/lu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile } from "@/types";

interface SyncSectionInlineProps {
  profile: BrowserProfile;
  syncMode: string;
  syncStatus: { status: string; error?: string } | undefined;
  isDisabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function SyncSectionInline({
  profile,
  syncMode,
  syncStatus,
  isDisabled,
  t,
}: SyncSectionInlineProps) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onChangeMode = async (mode: string) => {
    setIsSaving(true);
    setError(null);
    try {
      await invoke("set_profile_sync_mode", {
        profileId: profile.id,
        syncMode: mode,
      });
    } catch (e) {
      setError(translateBackendError(t as never, e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuRefreshCw className="size-4" />
        {t("profileInfo.sections.sync")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.sync")}
      </p>
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("profileInfo.fields.syncMode")}
        </span>
        <Select
          value={syncMode}
          disabled={isDisabled || isSaving}
          onValueChange={(v) => {
            void onChangeMode(v);
          }}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="Disabled">{t("sync.mode.disabled")}</SelectItem>
            <SelectItem value="Regular">{t("sync.mode.regular")}</SelectItem>
            <SelectItem value="Encrypted">
              {t("sync.mode.encrypted")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      {syncStatus && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
          <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
            {t("profileInfo.fields.syncStatus")}
          </p>
          <p className="mt-0.5 text-sm">
            {t(`profileInfo.syncStatusValue.${syncStatus.status}`)}
          </p>
          {syncStatus.error && (
            <p className="mt-1 text-xs text-destructive">{syncStatus.error}</p>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
