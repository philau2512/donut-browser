"use client";

import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WayfernFingerprintConfig } from "@/types";

const LANGUAGE_PRESETS = [
  { value: "en-US", label: "English (US)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "vi-VN", label: "Tiếng Việt" },
  { value: "zh-CN", label: "中文 (简体)" },
  { value: "zh-TW", label: "中文 (繁體)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
  { value: "es-ES", label: "Español" },
  { value: "fr-FR", label: "Français" },
  { value: "de-DE", label: "Deutsch" },
  { value: "pt-BR", label: "Português (BR)" },
  { value: "ru-RU", label: "Русский" },
  { value: "tr-TR", label: "Türkçe" },
];

interface LocationTabProps {
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  isEditingDisabled: boolean;
  isAutoLocationEnabled: boolean;
  handleAutoLocationToggle: (checked: boolean) => void;
  fixedLanguageEnabled: boolean;
  fixedLanguage: string;
  handleFixedLanguageToggle: (checked: boolean) => void;
  handleFixedLanguageChange: (language: string) => void;
}

export function LocationTab({
  fingerprintConfig,
  updateFingerprintConfig,
  isEditingDisabled,
  isAutoLocationEnabled,
  handleAutoLocationToggle,
  fixedLanguageEnabled,
  fixedLanguage,
  handleFixedLanguageToggle,
  handleFixedLanguageChange,
}: LocationTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Auto Location Switch */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">
            {t("fingerprint.autoLocationDescription")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("createProfile.location.autoLocationHint")}
          </p>
        </div>
        <AnimatedSwitch
          id="auto-location-switch"
          checked={isAutoLocationEnabled}
          onCheckedChange={handleAutoLocationToggle}
          disabled={isEditingDisabled}
        />
      </div>

      {/* Browser language */}
      <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">
              {t("createProfile.language.fixedLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("createProfile.language.fixedHint")}
            </p>
          </div>
          <AnimatedSwitch
            id="fixed-language-switch"
            checked={fixedLanguageEnabled}
            onCheckedChange={handleFixedLanguageToggle}
            disabled={isEditingDisabled}
          />
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="browser-language-select">
              {t("createProfile.language.selectLabel")}
            </Label>
            <Select
              value={
                fixedLanguageEnabled
                  ? fixedLanguage
                  : fingerprintConfig.language || "auto"
              }
              onValueChange={(val) => {
                if (val === "auto") return;
                if (!fixedLanguageEnabled) {
                  handleFixedLanguageToggle(true);
                }
                handleFixedLanguageChange(val);
              }}
              disabled={isEditingDisabled || !fixedLanguageEnabled}
            >
              <SelectTrigger id="browser-language-select" className="h-9">
                <SelectValue
                  placeholder={t("createProfile.language.autoPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                {!fixedLanguageEnabled && (
                  <SelectItem value="auto">
                    {t("createProfile.language.autoFromLocation")}
                  </SelectItem>
                )}
                {LANGUAGE_PRESETS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label} ({opt.value})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fixedLanguageEnabled && (
            <div className="space-y-2">
              <Label htmlFor="browser-language-custom">
                {t("createProfile.language.customLabel")}
              </Label>
              <Input
                id="browser-language-custom"
                value={fixedLanguage}
                onChange={(e) => handleFixedLanguageChange(e.target.value)}
                placeholder="en-US"
                className="h-9"
                disabled={isEditingDisabled}
              />
            </div>
          )}
        </div>
      </div>

      {/* Manual Geolocation Controls */}
      <div className="space-y-4">
        <Label className="text-sm font-bold block border-b pb-2">
          {t("createProfile.location.coordinatesTitle")}
        </Label>
        <fieldset
          disabled={isAutoLocationEnabled || isEditingDisabled}
          className="grid grid-cols-1 gap-4 md:grid-cols-3 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="lat-input">{t("fingerprint.latitude")}</Label>
            <Input
              id="lat-input"
              type="number"
              step="any"
              value={fingerprintConfig.latitude ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "latitude",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder="e.g. 40.7128"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lon-input">{t("fingerprint.longitude")}</Label>
            <Input
              id="lon-input"
              type="number"
              step="any"
              value={fingerprintConfig.longitude ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "longitude",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder="e.g. -74.0060"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accuracy-input">{t("fingerprint.accuracy")}</Label>
            <Input
              id="accuracy-input"
              type="number"
              value={fingerprintConfig.accuracy ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "accuracy",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder="e.g. 100"
              className="h-9"
            />
          </div>
        </fieldset>
      </div>

      {/* Manual Timezone Controls */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          {t("createProfile.location.timezoneTitle")}
        </Label>
        <p className="text-xs text-muted-foreground">
          {t("fingerprint.timezoneGeolocationDescription")}
        </p>
        <fieldset
          disabled={isAutoLocationEnabled || isEditingDisabled}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="timezone-input">
              {t("fingerprint.timezoneIana")}
            </Label>
            <Input
              id="timezone-input"
              value={fingerprintConfig.timezone ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "timezone",
                  e.target.value || undefined,
                );
              }}
              placeholder="e.g. America/New_York"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone-offset-input">
              {t("fingerprint.timezoneOffset")}
            </Label>
            <Input
              id="timezone-offset-input"
              type="number"
              value={fingerprintConfig.timezoneOffset ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "timezoneOffset",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="e.g. -240"
              className="h-9"
            />
          </div>
        </fieldset>
      </div>
    </div>
  );
}
