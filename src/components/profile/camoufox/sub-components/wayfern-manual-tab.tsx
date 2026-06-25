"use client";

import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/shared";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ProBadge } from "@/components/ui/pro-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";
import { WayfernFingerprintFields } from "./wayfern-fingerprint-sections";

interface WayfernManualTabProps {
  config: WayfernConfig;
  onConfigChange: (key: keyof WayfernConfig, value: unknown) => void;
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  isEditingDisabled: boolean;
  limitedMode: boolean;
  readOnly: boolean;
  profileVersion?: string;
  isCreating?: boolean;
  crossOsUnlocked: boolean;
  isGeneratingFingerprint: boolean;
  handleGenerateFingerprint: () => Promise<void>;
  selectedOS: WayfernOS;
  currentOS: WayfernOS;
  osLabels: Record<WayfernOS, string>;
  isAutoLocationEnabled: boolean;
  handleAutoLocationToggle: (checked: boolean) => void;
}

export function WayfernManualTab({
  config,
  onConfigChange,
  fingerprintConfig,
  updateFingerprintConfig,
  isEditingDisabled,
  limitedMode,
  readOnly,
  profileVersion,
  isCreating = false,
  crossOsUnlocked,
  isGeneratingFingerprint,
  handleGenerateFingerprint,
  selectedOS,
  currentOS,
  osLabels,
  isAutoLocationEnabled,
  handleAutoLocationToggle,
}: WayfernManualTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Operating System Selection */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>{t("fingerprint.osLabel")}</Label>
          {profileVersion && (!isCreating || crossOsUnlocked) && (
            <LoadingButton
              isLoading={isGeneratingFingerprint}
              onClick={handleGenerateFingerprint}
              disabled={readOnly}
              variant="outline"
              size="sm"
            >
              {isCreating
                ? t("fingerprint.generateFingerprint")
                : t("fingerprint.refreshFingerprint")}
            </LoadingButton>
          )}
        </div>
        <Select
          value={selectedOS}
          onValueChange={(value: WayfernOS) => {
            onConfigChange("os", value);
          }}
          disabled={readOnly}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("fingerprint.selectOSPlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {(
              ["windows", "macos", "linux", "android", "ios"] as WayfernOS[]
            ).map((os) => {
              const isDisabled = os !== currentOS && !crossOsUnlocked;
              return (
                <SelectItem key={os} value={os} disabled={isDisabled}>
                  <span className="flex items-center gap-2">
                    {osLabels[os]}
                    {isDisabled && <ProBadge />}
                  </span>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {selectedOS !== currentOS && crossOsUnlocked && (
          <Alert className="mt-2">
            <AlertDescription>
              {t("fingerprint.crossOsWarning")}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Randomize Fingerprint Option */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="randomize-fingerprint"
            checked={config.randomize_fingerprint_on_launch ?? false}
            onCheckedChange={(checked) => {
              onConfigChange("randomize_fingerprint_on_launch", checked);
            }}
            disabled={readOnly}
          />
          <Label htmlFor="randomize-fingerprint" className="font-medium">
            {t("fingerprint.generateRandomOnLaunch")}
          </Label>
        </div>
        <p className="ml-6 text-sm text-muted-foreground">
          {t("fingerprint.generateRandomDescription")}
        </p>
      </div>

      {/* Automatic Location Configuration */}
      <div className="space-y-3">
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="auto-location-advanced"
            checked={isAutoLocationEnabled}
            onCheckedChange={handleAutoLocationToggle}
            disabled={readOnly}
          />
          <Label htmlFor="auto-location-advanced">
            {t("fingerprint.autoLocationDescription")}
          </Label>
        </div>
      </div>

      <div
        className={
          limitedMode ? "relative overflow-hidden rounded-lg" : undefined
        }
      >
        {!limitedMode &&
          (isEditingDisabled ? (
            <Alert>
              <AlertDescription>
                {readOnly
                  ? t("fingerprint.editingDisabledRunning")
                  : t("fingerprint.editingDisabledRandomized")}
              </AlertDescription>
            </Alert>
          ) : (
            <Alert>
              <AlertDescription>
                {t("fingerprint.basicWarning")}
              </AlertDescription>
            </Alert>
          ))}

        <fieldset
          disabled={isEditingDisabled || limitedMode}
          className="space-y-6"
        >
          <WayfernFingerprintFields
            fingerprintConfig={fingerprintConfig}
            updateFingerprintConfig={updateFingerprintConfig}
            t={t}
          />
        </fieldset>
        {limitedMode && (
          <>
            <div className="absolute inset-0 z-1 bg-background/30 backdrop-blur-[6px]" />
            <div className="absolute inset-y-0 left-0 z-2 w-6 bg-linear-to-r from-background to-transparent" />
            <div className="absolute inset-y-0 right-0 z-2 w-6 bg-linear-to-l from-background to-transparent" />
            <div className="absolute inset-x-0 top-0 z-2 h-6 bg-linear-to-b from-background to-transparent" />
            <div className="absolute inset-x-0 bottom-0 z-2 h-6 bg-linear-to-t from-background to-transparent" />
            <div className="absolute inset-0 z-3 flex items-center justify-center">
              <div className="flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5">
                <ProBadge />
                <span className="text-sm font-medium text-muted-foreground">
                  {t("fingerprint.proFeature")}
                </span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
