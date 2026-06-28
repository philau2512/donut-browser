"use client";

import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { WayfernFingerprintConfig } from "@/types";

interface HardwareTabProps {
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  isEditingDisabled: boolean;
}

export function HardwareTab({
  fingerprintConfig,
  updateFingerprintConfig,
  isEditingDisabled,
}: HardwareTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* CPU & RAM */}
      <div className="space-y-4">
        <Label className="text-sm font-bold block border-b pb-2">
          CPU & Memory
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="grid grid-cols-1 gap-4 md:grid-cols-3 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="cpu-cores">
              {t("fingerprint.hardwareConcurrency")}
            </Label>
            <Input
              id="cpu-cores"
              type="number"
              value={fingerprintConfig.hardwareConcurrency ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "hardwareConcurrency",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="e.g. 8"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="ram-mem">{t("fingerprint.deviceMemory")}</Label>
            <Input
              id="ram-mem"
              type="number"
              value={fingerprintConfig.deviceMemory ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "deviceMemory",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="e.g. 8"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-touch">{t("fingerprint.maxTouchPoints")}</Label>
            <Input
              id="max-touch"
              type="number"
              value={fingerprintConfig.maxTouchPoints ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "maxTouchPoints",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="e.g. 0"
              className="h-9"
            />
          </div>
        </fieldset>
      </div>

      {/* Screen Properties */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          {t("fingerprint.screenProperties")}
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="grid grid-cols-1 gap-4 md:grid-cols-3 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="scr-w">{t("fingerprint.screenWidth")}</Label>
            <Input
              id="scr-w"
              type="number"
              value={fingerprintConfig.screenWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="1920"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scr-h">{t("fingerprint.screenHeight")}</Label>
            <Input
              id="scr-h"
              type="number"
              value={fingerprintConfig.screenHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="1080"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scr-ratio">
              {t("fingerprint.devicePixelRatio")}
            </Label>
            <Input
              id="scr-ratio"
              type="number"
              step="0.1"
              value={fingerprintConfig.devicePixelRatio ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "devicePixelRatio",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder="1.0"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scr-avail-w">
              {t("fingerprint.availableWidth")}
            </Label>
            <Input
              id="scr-avail-w"
              type="number"
              value={fingerprintConfig.screenAvailWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenAvailWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="1920"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scr-avail-h">
              {t("fingerprint.availableHeight")}
            </Label>
            <Input
              id="scr-avail-h"
              type="number"
              value={fingerprintConfig.screenAvailHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenAvailHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="1040"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="scr-depth">{t("fingerprint.colorDepth")}</Label>
            <Input
              id="scr-depth"
              type="number"
              value={fingerprintConfig.screenColorDepth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenColorDepth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="24"
              className="h-9"
            />
          </div>
        </fieldset>
      </div>

      {/* WebGL */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          {t("fingerprint.webglProperties")}
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="space-y-4 disabled:opacity-60"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="webgl-vend">{t("fingerprint.webglVendor")}</Label>
              <Input
                id="webgl-vend"
                value={fingerprintConfig.webglVendor ?? ""}
                onChange={(e) =>
                  updateFingerprintConfig(
                    "webglVendor",
                    e.target.value || undefined,
                  )
                }
                placeholder="Intel"
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="webgl-rend">
                {t("fingerprint.webglRenderer")}
              </Label>
              <Input
                id="webgl-rend"
                value={fingerprintConfig.webglRenderer ?? ""}
                onChange={(e) =>
                  updateFingerprintConfig(
                    "webglRenderer",
                    e.target.value || undefined,
                  )
                }
                placeholder="Intel(R) HD Graphics"
                className="h-9"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="webgl-params">
              {t("fingerprint.webglParametersJson")}
            </Label>
            <Textarea
              id="webgl-params"
              value={fingerprintConfig.webglParameters ?? ""}
              onChange={(e) =>
                updateFingerprintConfig(
                  "webglParameters",
                  e.target.value || undefined,
                )
              }
              placeholder='{"7936": "Intel", "7937": "Intel(R) HD Graphics"}'
              className="font-mono text-xs min-h-[100px]"
            />
          </div>
        </fieldset>
      </div>

      {/* Canvas & Audio */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          Canvas & Audio
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="grid grid-cols-1 gap-4 md:grid-cols-3 disabled:opacity-60"
        >
          <div className="space-y-2">
            <Label htmlFor="canvas-seed">
              {t("fingerprint.canvasNoiseSeed")}
            </Label>
            <Input
              id="canvas-seed"
              value={fingerprintConfig.canvasNoiseSeed ?? ""}
              onChange={(e) =>
                updateFingerprintConfig(
                  "canvasNoiseSeed",
                  e.target.value || undefined,
                )
              }
              placeholder="e.g. 12345"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-rate">{t("fingerprint.sampleRate")}</Label>
            <Input
              id="audio-rate"
              type="number"
              value={fingerprintConfig.audioSampleRate ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "audioSampleRate",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="48000"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-channels">
              {t("fingerprint.maxChannelCount")}
            </Label>
            <Input
              id="audio-channels"
              type="number"
              value={fingerprintConfig.audioMaxChannelCount ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "audioMaxChannelCount",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder="2"
              className="h-9"
            />
          </div>
        </fieldset>
      </div>

      {/* Fonts */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          {t("fingerprint.fontsJson")}
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="space-y-2 disabled:opacity-60"
        >
          <Textarea
            id="fonts-json"
            value={fingerprintConfig.fonts ?? ""}
            onChange={(e) =>
              updateFingerprintConfig("fonts", e.target.value || undefined)
            }
            placeholder='["Arial", "Verdana", "Times New Roman"]'
            className="font-mono text-xs min-h-[80px]"
          />
        </fieldset>
      </div>

      {/* Battery & Vendor Info */}
      <div className="space-y-4 pt-2">
        <Label className="text-sm font-bold block border-b pb-2">
          Battery & Vendor Info
        </Label>
        <fieldset
          disabled={isEditingDisabled}
          className="space-y-4 disabled:opacity-60"
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="flex items-center justify-between rounded-lg border bg-muted/10 p-3 h-9 mt-7">
              <Label htmlFor="bat-charging" className="text-xs">
                {t("fingerprint.charging")}
              </Label>
              <AnimatedSwitch
                id="bat-charging"
                checked={fingerprintConfig.batteryCharging ?? false}
                onCheckedChange={(checked) =>
                  updateFingerprintConfig(
                    "batteryCharging",
                    checked || undefined,
                  )
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bat-level">{t("fingerprint.batteryLevel")}</Label>
              <Input
                id="bat-level"
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={fingerprintConfig.batteryLevel ?? ""}
                onChange={(e) => {
                  updateFingerprintConfig(
                    "batteryLevel",
                    e.target.value ? parseFloat(e.target.value) : undefined,
                  );
                }}
                placeholder="0.85"
                className="h-9"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="vend-brand">{t("fingerprint.vendor")}</Label>
              <Input
                id="vend-brand"
                value={fingerprintConfig.vendor ?? ""}
                onChange={(e) =>
                  updateFingerprintConfig("vendor", e.target.value || undefined)
                }
                placeholder="Google Inc."
                className="h-9"
              />
            </div>
          </div>
        </fieldset>
      </div>
    </div>
  );
}
