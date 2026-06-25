"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { LuFingerprint, LuLock } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile, CamoufoxConfig, WayfernConfig } from "@/types";
import { SharedCamoufoxConfigForm } from "../camoufox/shared-camoufox-config-form";
import { WayfernConfigForm } from "../camoufox/wayfern-config-form";

interface FingerprintSectionInlineProps {
  profile: BrowserProfile;
  isDisabled: boolean;
  crossOsUnlocked: boolean;
  onSaved: () => void;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function FingerprintSectionInline({
  profile,
  isDisabled,
  crossOsUnlocked,
  onSaved,
  t,
}: FingerprintSectionInlineProps) {
  const [camoufoxConfig, setCamoufoxConfig] = React.useState<CamoufoxConfig>(
    () => profile.camoufox_config ?? {},
  );
  const [wayfernConfig, setWayfernConfig] = React.useState<WayfernConfig>(
    () => profile.wayfern_config ?? {},
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);

  React.useEffect(() => {
    setCamoufoxConfig(profile.camoufox_config ?? {});
    setWayfernConfig(profile.wayfern_config ?? {});
    setError(null);
    setSuccess(null);
  }, [profile.camoufox_config, profile.wayfern_config]);

  const isCamoufox = profile.browser === "camoufox";
  const isWayfern = profile.browser === "wayfern";

  if (!isCamoufox && !isWayfern) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <LuFingerprint className="size-4" />
          {t("profileInfo.sections.fingerprint")}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("profileInfo.fingerprint.notSupported")}
        </p>
      </div>
    );
  }

  if (!crossOsUnlocked) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border p-6 text-center">
        <LuLock className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-sm font-medium text-foreground">
          {t("profileInfo.fingerprint.lockedTitle")}
        </h3>
        <p className="max-w-[48ch] text-sm text-pretty text-muted-foreground">
          {t("profileInfo.fingerprint.lockedDescription")}
        </p>
      </div>
    );
  }

  const onCamoufoxChange = (key: keyof CamoufoxConfig, value: unknown) => {
    setCamoufoxConfig((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  };
  const onWayfernChange = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => ({ ...prev, [key]: value }));
    setSuccess(null);
  };

  const onSave = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (isCamoufox) {
        await invoke("update_camoufox_config", {
          profileId: profile.id,
          config: camoufoxConfig,
        });
      } else {
        await invoke("update_wayfern_config", {
          profileId: profile.id,
          config: wayfernConfig,
        });
      }
      setSuccess(t("common.buttons.saved"));
      onSaved();
    } catch (e) {
      setError(translateBackendError(t as never, e));
    } finally {
      setIsSaving(false);
    }
  };

  const initial = isCamoufox
    ? JSON.stringify(profile.camoufox_config ?? {})
    : JSON.stringify(profile.wayfern_config ?? {});
  const current = isCamoufox
    ? JSON.stringify(camoufoxConfig)
    : JSON.stringify(wayfernConfig);
  const dirty = current !== initial;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuFingerprint className="size-4" />
        {t("profileInfo.sections.fingerprint")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.fingerprint")}
      </p>

      {isCamoufox && (
        <SharedCamoufoxConfigForm
          config={camoufoxConfig}
          onConfigChange={onCamoufoxChange}
          forceAdvanced={true}
          readOnly={isDisabled}
          browserType="camoufox"
          crossOsUnlocked={crossOsUnlocked}
          limitedMode={false}
          profileVersion={profile.version}
          profileBrowser={profile.browser}
        />
      )}
      {isWayfern && (
        <WayfernConfigForm
          config={wayfernConfig}
          onConfigChange={onWayfernChange}
          forceAdvanced={true}
          readOnly={isDisabled}
          crossOsUnlocked={crossOsUnlocked}
          profileVersion={profile.version}
          profileBrowser={profile.browser}
        />
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && !error && <p className="text-xs text-success">{success}</p>}

      <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!dirty || isSaving || isDisabled}
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
              setCamoufoxConfig(profile.camoufox_config ?? {});
              setWayfernConfig(profile.wayfern_config ?? {});
              setError(null);
              setSuccess(null);
            }}
          >
            {t("common.buttons.cancel")}
          </Button>
        )}
      </div>
    </div>
  );
}
