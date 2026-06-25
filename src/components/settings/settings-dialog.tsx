"use client";

import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/components/app-shell";
import { LoadingButton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DnsBlocklistDialog } from "@/components/vpn";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useCommercialTrial } from "@/hooks/use-commercial-trial";
import { useLanguage } from "@/hooks/use-language";
import type { PermissionType } from "@/hooks/use-permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { getThemeByColors, getThemeById, THEME_VARIABLES } from "@/lib/themes";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import { RippleButton } from "../ui/ripple";
import { AdvancedSettings } from "./sub-components/advanced-settings";
import { EncryptionSettings } from "./sub-components/encryption-settings";
import { PermissionSettings } from "./sub-components/permission-settings";
// Import sub-components
import { ThemeSettings } from "./sub-components/theme-settings";

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

interface CustomThemeState {
  selectedThemeId: string | null;
  colors: Record<string, string>;
}

interface PermissionInfo {
  permission_type: PermissionType;
  isGranted: boolean;
  description: string;
}

interface SettingsDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onIntegrationsOpen?: () => void;
  subPage?: boolean;
}

export function SettingsDialog({
  isOpen,
  onClose,
  onIntegrationsOpen,
  subPage,
}: SettingsDialogProps) {
  const [settings, setSettings] = useState<AppSettings>({
    set_as_default_browser: false,
    theme: "system",
    custom_theme: undefined,
    api_enabled: false,
    api_port: 10108,
    api_token: undefined,
  });
  const [originalSettings, setOriginalSettings] = useState<AppSettings>({
    set_as_default_browser: false,
    theme: "system",
    custom_theme: undefined,
    api_enabled: false,
    api_port: 10108,
    api_token: undefined,
  });
  const [customThemeState, setCustomThemeState] = useState<CustomThemeState>({
    selectedThemeId: null,
    colors: {},
  });
  const [isDefaultBrowser, setIsDefaultBrowser] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSettingDefault, setIsSettingDefault] = useState(false);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [permissions, setPermissions] = useState<PermissionInfo[]>([]);
  const [isLoadingPermissions, setIsLoadingPermissions] = useState(false);
  const [requestingPermission, setRequestingPermission] =
    useState<PermissionType | null>(null);
  const [isMacOS, setIsMacOS] = useState(false);
  const [dnsBlocklistDialogOpen, setDnsBlocklistDialogOpen] = useState(false);
  const [isLinux, setIsLinux] = useState(false);
  const [hasE2ePassword, setHasE2ePassword] = useState(false);
  const [e2ePassword, setE2ePassword] = useState("");
  const [e2ePasswordConfirm, setE2ePasswordConfirm] = useState("");
  const [e2eError, setE2eError] = useState("");
  const [isSavingE2e, setIsSavingE2e] = useState(false);
  const [isRemovingE2e, setIsRemovingE2e] = useState(false);
  const [isVerifyE2eOpen, setIsVerifyE2eOpen] = useState(false);
  const [verifyE2ePassword, setVerifyE2ePassword] = useState("");
  const [isVerifyingE2e, setIsVerifyingE2e] = useState(false);
  const [systemInfo, setSystemInfo] = useState<{
    app_version: string;
    os: string;
    arch: string;
    portable: boolean;
  } | null>(null);

  const { t } = useTranslation();
  const { setTheme } = useTheme();
  const {
    requestPermission,
    isMicrophoneAccessGranted,
    isCameraAccessGranted,
  } = usePermissions();
  const { trialStatus } = useCommercialTrial();
  const { user: cloudUser } = useCloudAuth();

  const canUseEncryption =
    cloudUser == null ||
    cloudUser.plan !== "team" ||
    cloudUser.teamRole === "owner";

  const {
    currentLanguage,
    changeLanguage,
    supportedLanguages,
    isLoading: isLanguageLoading,
  } = useLanguage();
  const [selectedLanguage, setSelectedLanguage] = useState<string | null>(null);
  const [originalLanguage, setOriginalLanguage] = useState<string | null>(null);

  const getPermissionDescription = useCallback(
    (type: PermissionType) => {
      switch (type) {
        case "microphone":
          return t("settings.permissions.microphoneDescription");
        case "camera":
          return t("settings.permissions.cameraDescription");
      }
    },
    [t],
  );

  const loadSettings = useCallback(async () => {
    setIsLoading(true);
    try {
      const appSettings = await invoke<AppSettings>("get_app_settings");
      const tokyoNightTheme = getThemeById("tokyo-night");
      if (!tokyoNightTheme) {
        throw new Error("Tokyo Night theme not found");
      }
      const merged: AppSettings = {
        ...appSettings,
        custom_theme:
          appSettings.custom_theme &&
          Object.keys(appSettings.custom_theme).length > 0
            ? appSettings.custom_theme
            : tokyoNightTheme.colors,
      };
      setSettings(merged);
      setOriginalSettings(merged);

      if (merged.theme === "custom" && merged.custom_theme) {
        const matchingTheme = getThemeByColors(merged.custom_theme);
        setCustomThemeState({
          selectedThemeId: matchingTheme?.id ?? null,
          colors: merged.custom_theme,
        });
      } else if (merged.theme === "custom") {
        setCustomThemeState({
          selectedThemeId: "tokyo-night",
          colors: tokyoNightTheme.colors,
        });
      }
      try {
        const hasPassword = await invoke<boolean>("check_has_e2e_password");
        setHasE2ePassword(hasPassword);
      } catch {
        setHasE2ePassword(false);
      }
      try {
        const info = await invoke<{
          app_version: string;
          os: string;
          arch: string;
          portable: boolean;
        }>("get_system_info");
        setSystemInfo(info);
      } catch {
        setSystemInfo(null);
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const applyCustomTheme = useCallback((vars: Record<string, string>) => {
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      root.style.setProperty(k, v, "important");
    });
  }, []);

  const clearCustomTheme = useCallback(() => {
    const root = document.documentElement;
    THEME_VARIABLES.forEach(({ key }) => {
      root.style.removeProperty(key as string);
    });
  }, []);

  const loadPermissions = useCallback(() => {
    setIsLoadingPermissions(true);
    try {
      if (!isMacOS) {
        setPermissions([]);
        return;
      }

      const permissionList: PermissionInfo[] = [
        {
          permission_type: "microphone",
          isGranted: isMicrophoneAccessGranted,
          description: getPermissionDescription("microphone"),
        },
        {
          permission_type: "camera",
          isGranted: isCameraAccessGranted,
          description: getPermissionDescription("camera"),
        },
      ];

      setPermissions(permissionList);
    } catch (error) {
      console.error("Failed to load permissions:", error);
    } finally {
      setIsLoadingPermissions(false);
    }
  }, [
    getPermissionDescription,
    isCameraAccessGranted,
    isMacOS,
    isMicrophoneAccessGranted,
  ]);

  const checkDefaultBrowserStatus = useCallback(async () => {
    try {
      const isDefault = await invoke<boolean>("is_default_browser");
      setIsDefaultBrowser(isDefault);
    } catch (error) {
      console.error("Failed to check default browser status:", error);
    }
  }, []);

  const handleSetDefaultBrowser = useCallback(async () => {
    setIsSettingDefault(true);
    try {
      await invoke("set_as_default_browser");
      await checkDefaultBrowserStatus();
    } catch (error) {
      console.error("Failed to set as default browser:", error);
    } finally {
      setIsSettingDefault(false);
    }
  }, [checkDefaultBrowserStatus]);

  const handleClearCache = useCallback(async () => {
    setIsClearingCache(true);
    try {
      await invoke("clear_all_version_cache_and_refetch");
      await invoke("clear_all_traffic_stats");
    } catch (error) {
      console.error("Failed to clear cache:", error);
      showErrorToast(t("settings.advanced.clearCacheFailed"), {
        description:
          error instanceof Error ? error.message : t("common.errors.unknown"),
        duration: 4000,
      });
    } finally {
      setIsClearingCache(false);
    }
  }, [t]);

  const handleRequestPermission = useCallback(
    async (permissionType: PermissionType) => {
      setRequestingPermission(permissionType);
      try {
        const granted = await requestPermission(permissionType);
        if (granted) {
          showSuccessToast(
            permissionType === "microphone"
              ? t("permissionDialog.grantedToastMicrophone")
              : t("permissionDialog.grantedToastCamera"),
          );
          return;
        }

        await openUrl(
          `x-apple.systempreferences:com.apple.preference.security?${
            permissionType === "microphone"
              ? "Privacy_Microphone"
              : "Privacy_Camera"
          }`,
        );
        showErrorToast(
          permissionType === "microphone"
            ? t("permissionDialog.stillNotGrantedMicrophone")
            : t("permissionDialog.stillNotGrantedCamera"),
        );
      } catch (error) {
        console.error("Failed to request permission:", error);
        showErrorToast(t("permissionDialog.requestFailed"));
      } finally {
        setRequestingPermission(null);
      }
    },
    [requestPermission, t],
  );

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    try {
      let settingsToSave: AppSettings = {
        ...settings,
        custom_theme:
          settings.theme === "custom"
            ? customThemeState.colors
            : settings.custom_theme,
      };

      const savedSettings = await invoke<AppSettings>("save_app_settings", {
        settings: settingsToSave,
      });

      setSettings(savedSettings);
      settingsToSave = savedSettings;
      setTheme(settings.theme);

      if (settings.theme === "custom") {
        if (Object.keys(customThemeState.colors).length > 0) {
          try {
            const root = document.documentElement;
            THEME_VARIABLES.forEach(({ key }) => {
              root.style.removeProperty(key as string);
            });
            Object.entries(customThemeState.colors).forEach(([k, v]) => {
              root.style.setProperty(k, v, "important");
            });
          } catch {
            /* empty */
          }
        }
      } else {
        try {
          const root = document.documentElement;
          THEME_VARIABLES.forEach(({ key }) => {
            root.style.removeProperty(key as string);
          });
        } catch {
          /* empty */
        }
      }

      if (selectedLanguage !== originalLanguage) {
        await changeLanguage(
          selectedLanguage === "system"
            ? null
            : (selectedLanguage as
                | "en"
                | "es"
                | "pt"
                | "fr"
                | "zh"
                | "ja"
                | "ko"
                | "ru"
                | "vi"),
        );
        setOriginalLanguage(selectedLanguage);
      }

      setOriginalSettings(settingsToSave);
      onClose();
    } catch (error) {
      console.error("Failed to save settings:", error);
    } finally {
      setIsSaving(false);
    }
  }, [
    onClose,
    setTheme,
    settings,
    customThemeState,
    selectedLanguage,
    originalLanguage,
    changeLanguage,
  ]);

  const updateSetting = useCallback(
    (
      key: keyof AppSettings,
      value: boolean | string | Record<string, string> | undefined,
    ) => {
      setSettings((prev) => ({ ...prev, [key]: value as unknown as never }));
    },
    [],
  );

  const handleClose = useCallback(() => {
    if (originalSettings.theme === "custom" && originalSettings.custom_theme) {
      applyCustomTheme(originalSettings.custom_theme);
    } else {
      clearCustomTheme();
    }

    if (originalSettings.theme === "custom" && originalSettings.custom_theme) {
      const matchingTheme = getThemeByColors(originalSettings.custom_theme);
      setCustomThemeState({
        selectedThemeId: matchingTheme?.id ?? null,
        colors: originalSettings.custom_theme,
      });
    }

    onClose();
  }, [
    originalSettings.theme,
    originalSettings.custom_theme,
    applyCustomTheme,
    clearCustomTheme,
    onClose,
  ]);

  useEffect(() => {
    if (settings.theme !== "custom") {
      clearCustomTheme();
    }
  }, [settings.theme, clearCustomTheme]);

  useEffect(() => {
    if (isOpen) {
      loadSettings().catch((err: unknown) => {
        console.error(err);
      });
      checkDefaultBrowserStatus().catch((err: unknown) => {
        console.error(err);
      });

      const userAgent = navigator.userAgent;
      const isMac = userAgent.includes("Mac");
      setIsMacOS(isMac);
      const isLin = !userAgent.includes("Mac") && !userAgent.includes("Win");
      setIsLinux(isLin);

      if (isMac) {
        loadPermissions();
      }

      const intervalId = setInterval(() => {
        checkDefaultBrowserStatus().catch((err: unknown) => {
          console.error(err);
        });
      }, 2000);

      return () => {
        clearInterval(intervalId);
      };
    }
  }, [isOpen, loadPermissions, checkDefaultBrowserStatus, loadSettings]);

  useEffect(() => {
    if (isOpen && !isLanguageLoading) {
      setSelectedLanguage(currentLanguage);
      setOriginalLanguage(currentLanguage);
    }
  }, [isOpen, currentLanguage, isLanguageLoading]);

  useEffect(() => {
    if (isMacOS) {
      const permissionList: PermissionInfo[] = [
        {
          permission_type: "microphone",
          isGranted: isMicrophoneAccessGranted,
          description: getPermissionDescription("microphone"),
        },
        {
          permission_type: "camera",
          isGranted: isCameraAccessGranted,
          description: getPermissionDescription("camera"),
        },
      ];
      setPermissions(permissionList);
    } else {
      setPermissions([]);
    }
  }, [
    isMacOS,
    isMicrophoneAccessGranted,
    isCameraAccessGranted,
    getPermissionDescription,
  ]);

  const hasChanges =
    settings.theme !== originalSettings.theme ||
    settings.api_enabled !== originalSettings.api_enabled ||
    selectedLanguage !== originalLanguage ||
    (settings.theme === "custom" &&
      JSON.stringify(customThemeState.colors) !==
        JSON.stringify(originalSettings.custom_theme ?? {})) ||
    (settings.theme !== "custom" &&
      JSON.stringify(settings.custom_theme ?? {}) !==
        JSON.stringify(originalSettings.custom_theme ?? {})) ||
    settings.disable_auto_updates !== originalSettings.disable_auto_updates;

  return (
    <>
      <Dialog open={isOpen} onOpenChange={handleClose} subPage={subPage}>
        <DialogContent className="flex max-h-[calc(100vh-5rem)] max-w-md flex-col">
          {!subPage && (
            <DialogHeader className="shrink-0">
              <DialogTitle>{t("settings.title")}</DialogTitle>
            </DialogHeader>
          )}

          <div
            className={cn(
              "grid min-h-0 flex-1 gap-6 overflow-y-auto",
              subPage ? "mx-auto w-full max-w-2xl py-2" : "py-4",
            )}
          >
            {/* Appearance Section */}
            <ThemeSettings
              theme={settings.theme}
              onThemeChange={(val) => updateSetting("theme", val)}
              customThemeState={customThemeState}
              setCustomThemeState={setCustomThemeState}
            />

            {/* Language Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("settings.language.title")}
              </Label>

              <div className="grid gap-2">
                <Label htmlFor="language-select" className="text-sm">
                  {t("settings.language.interface")}
                </Label>
                <Select
                  value={selectedLanguage ?? "system"}
                  onValueChange={(value) => {
                    setSelectedLanguage(value);
                  }}
                  disabled={isLanguageLoading}
                >
                  <SelectTrigger id="language-select">
                    <SelectValue
                      placeholder={t("settings.language.selectLanguage")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="system">
                      {t("settings.language.systemDefault")}
                    </SelectItem>
                    {supportedLanguages.map((lang) => (
                      <SelectItem key={lang.code} value={lang.code}>
                        {lang.nativeName} ({lang.name})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <p className="text-xs text-muted-foreground">
                {t("settings.language.description")}
              </p>
            </div>

            {/* Default Browser Section - hidden in portable mode */}
            {!systemInfo?.portable && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label className="text-base font-medium">
                    {t("settings.defaultBrowser.title")}
                  </Label>
                  <Badge variant={isDefaultBrowser ? "default" : "secondary"}>
                    {isDefaultBrowser
                      ? t("common.status.active")
                      : t("common.status.inactive")}
                  </Badge>
                </div>

                <LoadingButton
                  isLoading={isSettingDefault}
                  onClick={() => {
                    handleSetDefaultBrowser().catch((err: unknown) => {
                      console.error(err);
                    });
                  }}
                  disabled={isDefaultBrowser}
                  variant={isDefaultBrowser ? "outline" : "default"}
                  className="w-full"
                >
                  {isDefaultBrowser
                    ? t("settings.defaultBrowser.alreadyDefault")
                    : t("settings.defaultBrowser.setAsDefault")}
                </LoadingButton>

                <p className="text-xs text-muted-foreground">
                  {t("settings.defaultBrowser.description")}
                </p>
              </div>
            )}

            {/* Permissions Section - Only show on macOS */}
            {isMacOS && (
              <PermissionSettings
                permissions={permissions}
                isLoadingPermissions={isLoadingPermissions}
                requestingPermission={requestingPermission}
                handleRequestPermission={handleRequestPermission}
              />
            )}

            {/* Integrations Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("settings.integrations.title")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.integrations.description")}
              </p>
              <RippleButton
                variant="outline"
                className="w-full"
                onClick={onIntegrationsOpen}
              >
                {t("integrations.openSettings")}
              </RippleButton>
            </div>

            {/* DNS Blocklist Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("dnsBlocklist.title")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("dnsBlocklist.settingsDescription")}
              </p>
              <RippleButton
                variant="outline"
                className="w-full"
                onClick={() => setDnsBlocklistDialogOpen(true)}
              >
                {t("dnsBlocklist.manageLists")}
              </RippleButton>
            </div>

            {/* Sync Encryption Section */}
            <EncryptionSettings
              canUseEncryption={canUseEncryption}
              hasE2ePassword={hasE2ePassword}
              setHasE2ePassword={setHasE2ePassword}
              isRemovingE2e={isRemovingE2e}
              setIsRemovingE2e={setIsRemovingE2e}
              e2ePassword={e2ePassword}
              setE2ePassword={setE2ePassword}
              e2ePasswordConfirm={e2ePasswordConfirm}
              setE2ePasswordConfirm={setE2ePasswordConfirm}
              e2eError={e2eError}
              setE2eError={setE2eError}
              isSavingE2e={isSavingE2e}
              setIsSavingE2e={setIsSavingE2e}
              isVerifyE2eOpen={isVerifyE2eOpen}
              setIsVerifyE2eOpen={setIsVerifyE2eOpen}
              verifyE2ePassword={verifyE2ePassword}
              setVerifyE2ePassword={setVerifyE2ePassword}
              isVerifyingE2e={isVerifyingE2e}
              setIsVerifyingE2e={setIsVerifyingE2e}
            />

            {/* Commercial License Section */}
            <div className="space-y-4">
              <Label className="text-base font-medium">
                {t("settings.commercial.title")}
              </Label>

              <div className="flex items-center justify-between rounded-md border bg-muted/40 p-3">
                {cloudUser != null && cloudUser.plan !== "free" ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-success">
                      {t("settings.commercial.subscriptionActive", {
                        plan: cloudUser.plan,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.commercial.subscriptionActiveDescription")}
                    </p>
                  </div>
                ) : trialStatus?.type === "Active" ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      {t("settings.commercial.trialActive", {
                        days: trialStatus.days_remaining,
                        hours: trialStatus.hours_remaining,
                      })}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.commercial.trialActiveDescription")}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-warning">
                      {t("settings.commercial.trialExpired")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t("settings.commercial.trialExpiredDescription")}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Advanced Section */}
            <AdvancedSettings
              isLinux={isLinux}
              settings={settings}
              updateSetting={(k, v) => updateSetting(k, v)}
              isClearingCache={isClearingCache}
              handleClearCache={handleClearCache}
            />

            {/* System Info */}
            {systemInfo && (
              <div className="border-t pt-2">
                <p className="font-mono text-xs whitespace-pre-line text-muted-foreground select-all">
                  {`Donut Browser ${systemInfo.app_version}\n${systemInfo.os} ${systemInfo.arch}${systemInfo.portable ? " (portable)" : ""}`}
                </p>
              </div>
            )}
          </div>

          {subPage ? (
            <div className="mx-auto flex w-full max-w-2xl shrink-0 items-center justify-end gap-2 border-t border-border pt-2">
              <LoadingButton
                size="sm"
                isLoading={isSaving}
                onClick={() => {
                  handleSave().catch((err: unknown) => {
                    console.error(err);
                  });
                }}
                disabled={isLoading || !hasChanges}
              >
                {t("common.buttons.saveSettings")}
              </LoadingButton>
            </div>
          ) : (
            <DialogFooter className="shrink-0">
              <RippleButton variant="outline" onClick={handleClose}>
                {t("common.buttons.cancel")}
              </RippleButton>
              <LoadingButton
                isLoading={isSaving}
                onClick={() => {
                  handleSave().catch((err: unknown) => {
                    console.error(err);
                  });
                }}
                disabled={isLoading || !hasChanges}
              >
                {t("common.buttons.saveSettings")}
              </LoadingButton>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>
      <DnsBlocklistDialog
        isOpen={dnsBlocklistDialogOpen}
        onClose={() => setDnsBlocklistDialogOpen(false)}
      />
    </>
  );
}
