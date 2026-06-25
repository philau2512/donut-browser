"use client";

import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { WayfernConfig, WayfernOS } from "@/types";

interface WayfernAutomaticTabProps {
  config: WayfernConfig;
  onConfigChange: (key: keyof WayfernConfig, value: unknown) => void;
  selectedOS: WayfernOS;
  currentOS: WayfernOS;
  crossOsUnlocked: boolean;
  osLabels: Record<WayfernOS, string>;
  isAutoLocationEnabled: boolean;
  handleAutoLocationToggle: (checked: boolean) => void;
  isEditingDisabled: boolean;
  limitedMode: boolean;
  readOnly: boolean;
}

export function WayfernAutomaticTab({
  config,
  onConfigChange,
  selectedOS,
  currentOS,
  crossOsUnlocked,
  osLabels,
  isAutoLocationEnabled,
  handleAutoLocationToggle,
  isEditingDisabled,
  limitedMode,
  readOnly,
}: WayfernAutomaticTabProps) {
  const { t } = useTranslation();

  return (
    <>
      {/* Operating System Selection */}
      <div className="mt-4 space-y-3">
        <Label>{t("fingerprint.osLabel")}</Label>
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
              {t("fingerprint.crossOsLimitations")}
            </AlertDescription>
          </Alert>
        )}
      </div>

      {/* Randomize Fingerprint Option */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="randomize-fingerprint-auto"
            checked={config.randomize_fingerprint_on_launch ?? false}
            onCheckedChange={(checked) => {
              onConfigChange("randomize_fingerprint_on_launch", checked);
            }}
            disabled={readOnly}
          />
          <Label htmlFor="randomize-fingerprint-auto" className="font-medium">
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
            id="auto-location"
            checked={isAutoLocationEnabled}
            onCheckedChange={handleAutoLocationToggle}
            disabled={isEditingDisabled}
          />
          <Label htmlFor="auto-location">
            {t("fingerprint.autoLocationDescription")}
          </Label>
        </div>
      </div>

      {/* Screen Resolution */}
      <div
        className={
          limitedMode ? "relative overflow-hidden rounded-lg" : undefined
        }
      >
        <fieldset
          disabled={isEditingDisabled || limitedMode}
          className="space-y-3"
        >
          <Label>{t("fingerprint.screenResolution")}</Label>
          <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="screen-max-width">
                {t("fingerprint.maxWidth")}
              </Label>
              <Input
                id="screen-max-width"
                type="number"
                value={config.screen_max_width ?? ""}
                onChange={(e) => {
                  onConfigChange(
                    "screen_max_width",
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  );
                }}
                placeholder={t("common.placeholders.example", {
                  value: "1920",
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="screen-max-height">
                {t("fingerprint.maxHeight")}
              </Label>
              <Input
                id="screen-max-height"
                type="number"
                value={config.screen_max_height ?? ""}
                onChange={(e) => {
                  onConfigChange(
                    "screen_max_height",
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  );
                }}
                placeholder={t("common.placeholders.example", {
                  value: "1080",
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="screen-min-width">
                {t("fingerprint.minWidth")}
              </Label>
              <Input
                id="screen-min-width"
                type="number"
                value={config.screen_min_width ?? ""}
                onChange={(e) => {
                  onConfigChange(
                    "screen_min_width",
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  );
                }}
                placeholder={t("common.placeholders.example", {
                  value: "800",
                })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="screen-min-height">
                {t("fingerprint.minHeight")}
              </Label>
              <Input
                id="screen-min-height"
                type="number"
                value={config.screen_min_height ?? ""}
                onChange={(e) => {
                  onConfigChange(
                    "screen_min_height",
                    e.target.value ? parseInt(e.target.value, 10) : undefined,
                  );
                }}
                placeholder={t("common.placeholders.example", {
                  value: "600",
                })}
              />
            </div>
          </div>
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
    </>
  );
}
