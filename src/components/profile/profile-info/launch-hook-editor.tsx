"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LuLink } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile } from "@/types";

interface LaunchHookEditorProps {
  profile: BrowserProfile;
  t: (key: string, options?: Record<string, unknown>) => string;
}

function isValidHttpUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  try {
    const u = new URL(trimmed);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

export function LaunchHookEditor({ profile, t }: LaunchHookEditorProps) {
  const { t: tFn } = useTranslation();
  const [value, setValue] = React.useState(profile.launch_hook ?? "");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const initial = profile.launch_hook ?? "";
  const dirty = value !== initial;
  const trimmed = value.trim();
  const showInvalidHint = trimmed.length > 0 && !isValidHttpUrl(trimmed);

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    try {
      await invoke("update_profile_launch_hook", {
        profileId: profile.id,
        launchHook: trimmed ? trimmed : null,
      });
    } catch (e) {
      setError(translateBackendError(tFn, e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuLink className="size-4" />
        {t("profileInfo.sections.launchHook")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.launchHook")}
      </p>
      <Input
        type="url"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
        }}
        placeholder={t("profiles.launchHook.placeholder")}
        className="font-mono text-xs"
      />
      {showInvalidHint && (
        <p className="text-xs text-warning">
          {t("profileInfo.launchHook.invalidUrlHint")}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!dirty || isSaving || showInvalidHint}
          onClick={() => {
            void onSave();
          }}
        >
          {isSaving ? t("common.buttons.saving") : t("common.buttons.save")}
        </Button>
        {dirty && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs"
            onClick={() => {
              setValue(initial);
              setError(null);
            }}
          >
            {t("common.buttons.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
