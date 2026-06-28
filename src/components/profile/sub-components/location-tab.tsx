"use client";

import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WayfernFingerprintConfig } from "@/types";

interface LocationTabProps {
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  isEditingDisabled: boolean;
  isAutoLocationEnabled: boolean;
  handleAutoLocationToggle: (checked: boolean) => void;
}

export function LocationTab({
  fingerprintConfig,
  updateFingerprintConfig,
  isEditingDisabled,
  isAutoLocationEnabled,
  handleAutoLocationToggle,
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
            Automatically fetch location coordinates and timezone based on IP
            address
          </p>
        </div>
        <AnimatedSwitch
          id="auto-location-switch"
          checked={isAutoLocationEnabled}
          onCheckedChange={handleAutoLocationToggle}
          disabled={isEditingDisabled}
        />
      </div>

      {/* Manual Geolocation Controls */}
      <div className="space-y-4">
        <Label className="text-sm font-bold block border-b pb-2">
          Geolocation Coordinates
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
          Timezone Settings
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
