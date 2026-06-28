"use client";

import { useTranslation } from "react-i18next";
import {
  FaApple,
  FaChrome,
  FaFirefox,
  FaLinux,
  FaWindows,
} from "react-icons/fa";
import { FaAndroid } from "react-icons/fa6";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProBadge } from "@/components/ui/pro-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type {
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";

interface BaseInfoTabProps {
  profileName: string;
  setProfileName: (name: string) => void;
  groupId: string | undefined;
  setGroupId: (id: string | undefined) => void;
  groups: any[];
  browserType: "camoufox" | "wayfern";
  setBrowserType: (type: "camoufox" | "wayfern") => void;
  wayfernConfig: WayfernConfig;
  updateWayfernConfig: (key: keyof WayfernConfig, value: unknown) => void;
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  isLoadingReleaseTypes: boolean;
  getCreatableVersion: (
    browser: string,
  ) => { version: string; releaseType: "stable" | "nightly" } | null;
  crossOsUnlocked: boolean;
  currentOS: WayfernOS;
  osLabels: Record<WayfernOS, string>;
  isCreateDisabled: boolean;
  isCreating: boolean;
  handleCreate: () => Promise<void>;
}

export function BaseInfoTab({
  profileName,
  setProfileName,
  groupId,
  setGroupId,
  groups,
  browserType,
  setBrowserType,
  wayfernConfig,
  updateWayfernConfig,
  fingerprintConfig,
  updateFingerprintConfig,
  isLoadingReleaseTypes,
  getCreatableVersion,
  crossOsUnlocked,
  currentOS,
  osLabels,
  isCreateDisabled,
  isCreating,
  handleCreate,
}: BaseInfoTabProps) {
  const { t } = useTranslation();

  const selectedOS = wayfernConfig.os || currentOS;

  const osOptions = [
    { value: "windows" as WayfernOS, label: "Windows", icon: FaWindows },
    { value: "macos" as WayfernOS, label: "macOS", icon: FaApple },
    { value: "linux" as WayfernOS, label: "Linux", icon: FaLinux },
    { value: "android" as WayfernOS, label: "Android", icon: FaAndroid },
    { value: "ios" as WayfernOS, label: "iOS", icon: FaApple }, // Dùng FaApple đại diện cho iOS
  ];

  const browserOptions = [
    { value: "camoufox", label: "Camoufox", icon: FaFirefox, active: true },
    { value: "wayfern", label: "Wayfern", icon: FaChrome, active: true },
  ];

  return (
    <div className="space-y-6">
      {/* Name, Folder, Status */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label htmlFor="profile-name-base">
            {t("createProfile.profileName")}
          </Label>
          <Input
            id="profile-name-base"
            value={profileName}
            onChange={(e) => setProfileName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !isCreateDisabled && !isCreating) {
                void handleCreate();
              }
            }}
            placeholder={t("createProfile.profileNamePlaceholder")}
            className="h-9"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-folder">
            {t("common.labels.folder") || "Folder"}
          </Label>
          <Select
            value={groupId ?? "none"}
            onValueChange={(val) =>
              setGroupId(val === "none" ? undefined : val)
            }
          >
            <SelectTrigger id="profile-folder" className="h-9">
              <SelectValue placeholder={t("common.labels.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("common.labels.none")}</SelectItem>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-status">{t("common.labels.status")}</Label>
          <Select defaultValue="no-status">
            <SelectTrigger id="profile-status" className="h-9">
              <SelectValue placeholder="No status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="no-status">No status</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="inactive">Inactive</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Platform OS Card Buttons */}
      <div className="space-y-3">
        <Label>{t("fingerprint.osLabel")}</Label>
        <div className="grid grid-cols-5 gap-3">
          {osOptions.map((opt) => {
            const isDisabled = opt.value !== currentOS && !crossOsUnlocked;
            const Icon = opt.icon;
            const isActive = selectedOS === opt.value;

            const activeStyles: Record<WayfernOS, string> = {
              windows:
                "border-primary bg-primary/10 text-primary ring-2 ring-primary/20 font-semibold scale-105",
              macos:
                "border-primary bg-primary/10 text-primary ring-2 ring-primary/20 font-semibold scale-105",
              linux:
                "border-warning bg-warning/10 text-warning ring-2 ring-warning/20 font-semibold scale-105",
              android:
                "border-success bg-success/10 text-success ring-2 ring-success/20 font-semibold scale-105",
              ios: "border-accent bg-accent/10 text-accent ring-2 ring-accent/20 font-semibold scale-105",
            };

            return (
              <button
                key={opt.value}
                type="button"
                disabled={isDisabled}
                onClick={() => updateWayfernConfig("os", opt.value)}
                className={cn(
                  "flex flex-col items-center justify-center p-3 rounded-lg border bg-card text-card-foreground transition-all hover:bg-accent/30 hover:scale-102",
                  isActive ? activeStyles[opt.value] : "border-muted",
                  isDisabled &&
                    "opacity-40 cursor-not-allowed hover:scale-100 hover:bg-card",
                )}
              >
                <Icon className="size-6 mb-1.5" />
                <span className="text-xs font-medium flex items-center gap-1">
                  {osLabels[opt.value] || opt.label}
                  {isDisabled && <ProBadge />}
                </span>
              </button>
            );
          })}
        </div>
        {selectedOS !== currentOS && crossOsUnlocked && (
          <Alert className="mt-2">
            <AlertDescription>
              {t("fingerprint.crossOsLimitations")}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Platform Version Selection */}
      <div className="space-y-2">
        <Label htmlFor="platform-version-select">
          {t("fingerprint.platformVersion")}
        </Label>
        <Select
          value={fingerprintConfig.platformVersion || "default"}
          onValueChange={(val) =>
            updateFingerprintConfig(
              "platformVersion",
              val === "default" ? undefined : val,
            )
          }
        >
          <SelectTrigger id="platform-version-select" className="h-9 max-w-xs">
            <SelectValue placeholder="Default" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="default">Default</SelectItem>
            {selectedOS === "windows" && (
              <>
                <SelectItem value="10.0">Windows 10</SelectItem>
                <SelectItem value="11.0">Windows 11</SelectItem>
              </>
            )}
            {selectedOS === "macos" && (
              <>
                <SelectItem value="10.15">macOS Catalina</SelectItem>
                <SelectItem value="11.0">macOS Big Sur</SelectItem>
                <SelectItem value="12.0">macOS Monterey</SelectItem>
                <SelectItem value="13.0">macOS Ventura</SelectItem>
              </>
            )}
          </SelectContent>
        </Select>
      </div>

      {/* Browser Selection mock-up list */}
      <div className="space-y-3">
        <Label>Browser Engine</Label>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {browserOptions.map((opt) => {
            const Icon = opt.icon;
            const isSelected = browserType === opt.value;

            return (
              <button
                key={opt.value}
                type="button"
                onClick={() =>
                  setBrowserType(opt.value as "camoufox" | "wayfern")
                }
                disabled={!opt.active}
                className={cn(
                  "relative flex flex-col items-center justify-center p-2.5 rounded-lg border bg-card text-card-foreground text-center transition-all",
                  opt.active
                    ? isSelected
                      ? "border-primary bg-primary/10 text-primary font-bold shadow-md shadow-primary/10 scale-105 ring-2 ring-primary/20"
                      : "border-muted hover:border-primary/50 hover:bg-primary/5 cursor-pointer"
                    : "opacity-35 select-none cursor-not-allowed bg-muted/5 border-muted",
                )}
              >
                {opt.active && isSelected && (
                  <span className="absolute -top-1 -right-1 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-success opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-success"></span>
                  </span>
                )}
                <Icon className="size-5 mb-1" />
                <span className="text-[10px] font-medium">{opt.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Core version & Browser version */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Core version</Label>
          <Select defaultValue="142">
            <SelectTrigger className="h-9">
              <SelectValue placeholder="142" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="142">142</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Browser Version</Label>
          {isLoadingReleaseTypes ? (
            <div className="h-9 rounded-md border border-input bg-background px-3 py-2 text-xs flex items-center text-muted-foreground">
              {t("createProfile.version.fetching")}
            </div>
          ) : (
            <Select
              value={getCreatableVersion("wayfern")?.version || "none"}
              disabled
            >
              <SelectTrigger className="h-9">
                <SelectValue
                  placeholder={
                    getCreatableVersion("wayfern")?.version || "No version"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value={getCreatableVersion("wayfern")?.version || "none"}
                >
                  {getCreatableVersion("wayfern")?.version || "No version"}
                </SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </div>
  );
}
