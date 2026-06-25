"use client";

import { invoke } from "@tauri-apps/api/core";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RippleButton } from "@/components/ui/ripple";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

interface AppSettings {
  set_as_default_browser: boolean;
  theme: string;
  custom_theme?: Record<string, string>;
  api_enabled: boolean;
  api_port: number;
  api_token?: string;
  disable_auto_updates?: boolean;
  keep_decrypted_profiles_in_ram?: boolean;
}

interface AdvancedSettingsProps {
  isLinux: boolean;
  settings: AppSettings;
  updateSetting: (key: keyof AppSettings, value: boolean) => void;
  isClearingCache: boolean;
  handleClearCache: () => Promise<void>;
}

export function AdvancedSettings({
  isLinux,
  settings,
  updateSetting,
  isClearingCache,
  handleClearCache,
}: AdvancedSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.advanced.title")}
      </Label>

      {!isLinux && (
        <div className="flex items-start gap-x-3 rounded-lg border p-3">
          <Checkbox
            id="disable-auto-updates"
            checked={settings.disable_auto_updates ?? false}
            onCheckedChange={(checked) => {
              updateSetting("disable_auto_updates", checked as boolean);
            }}
          />
          <div className="space-y-1">
            <Label
              htmlFor="disable-auto-updates"
              className="text-sm font-medium"
            >
              {t("settings.disableAutoUpdates")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.disableAutoUpdatesDescription")}
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-x-3 rounded-lg border p-3">
        <Checkbox
          id="keep-decrypted-profiles-in-ram"
          checked={settings.keep_decrypted_profiles_in_ram ?? false}
          onCheckedChange={(checked) => {
            updateSetting("keep_decrypted_profiles_in_ram", checked as boolean);
          }}
        />
        <div className="space-y-1">
          <Label
            htmlFor="keep-decrypted-profiles-in-ram"
            className="text-sm font-medium"
          >
            {t("settings.keepDecryptedProfilesInRam")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("settings.keepDecryptedProfilesInRamDescription")}
          </p>
        </div>
      </div>

      <LoadingButton
        isLoading={isClearingCache}
        onClick={() => {
          handleClearCache().catch((err: unknown) => {
            console.error(err);
          });
        }}
        variant="outline"
        className="w-full"
      >
        {t("settings.advanced.clearCache")}
      </LoadingButton>

      <p className="text-xs text-muted-foreground">
        {t("settings.advanced.clearCacheDescription")}
      </p>

      <div className="grid grid-cols-2 gap-2 pt-2">
        <RippleButton
          variant="outline"
          className="text-xs"
          onClick={async () => {
            try {
              const content = await invoke<string>("read_log_files");
              await writeClipboardText(content);
              showSuccessToast(t("settings.advanced.copyLogsSuccess"));
            } catch (err) {
              showErrorToast(String(err));
            }
          }}
        >
          {t("settings.advanced.copyLogs")}
        </RippleButton>
        <RippleButton
          variant="outline"
          className="text-xs"
          onClick={async () => {
            try {
              await invoke("open_log_directory");
            } catch (err) {
              showErrorToast(String(err));
            }
          }}
        >
          {t("settings.advanced.openLogDir")}
        </RippleButton>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("settings.advanced.copyLogsDescription")}
      </p>
    </div>
  );
}
