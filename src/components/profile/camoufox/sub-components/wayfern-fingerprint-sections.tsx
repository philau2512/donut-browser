"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { WayfernConfig, WayfernFingerprintConfig } from "@/types";

interface WayfernFingerprintFieldsProps {
  config: WayfernConfig;
  onConfigChange: (key: keyof WayfernConfig, value: unknown) => void;
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  readOnly: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function WayfernFingerprintFields({
  config,
  onConfigChange,
  fingerprintConfig,
  updateFingerprintConfig,
  readOnly,
  t,
}: WayfernFingerprintFieldsProps) {
  const handleWebrtcModeChange = (val: string) => {
    onConfigChange("webrtc_mode", val);
    onConfigChange("block_webrtc", val === "disable");
  };

  return (
    <>
      {/* WebRTC Configuration */}
      <div className="space-y-3">
        <Label>{t("fingerprint.webrtcMode")}</Label>
        <div className="max-w-xs space-y-2">
          <Select
            value={
              config.webrtc_mode ??
              (config.block_webrtc ? "disable" : "forward")
            }
            onValueChange={handleWebrtcModeChange}
            disabled={readOnly}
          >
            <SelectTrigger id="webrtc-mode">
              <SelectValue placeholder={t("fingerprint.webrtcMode")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="forward">
                {t("fingerprint.webrtcModes.forward")}
              </SelectItem>
              <SelectItem value="forward_google">
                {t("fingerprint.webrtcModes.forwardGoogle")}
              </SelectItem>
              <SelectItem value="alter">
                {t("fingerprint.webrtcModes.alter")}
              </SelectItem>
              <SelectItem value="real">
                {t("fingerprint.webrtcModes.real")}
              </SelectItem>
              <SelectItem value="disable">
                {t("fingerprint.webrtcModes.disable")}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* User Agent and Platform */}
      <div className="space-y-3">
        <Label>{t("fingerprint.userAgentAndPlatform")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
          <div className="col-span-full space-y-2">
            <Label htmlFor="user-agent">{t("fingerprint.userAgent")}</Label>
            <Input
              id="user-agent"
              value={fingerprintConfig.userAgent ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "userAgent",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "Mozilla/5.0...",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform">{t("fingerprint.platform")}</Label>
            <Input
              id="platform"
              value={fingerprintConfig.platform ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "platform",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("config.wayfern.fingerprint.platformPlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="platform-version">
              {t("fingerprint.platformVersion")}
            </Label>
            <Input
              id="platform-version"
              value={fingerprintConfig.platformVersion ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "platformVersion",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "10.0.0",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand">{t("fingerprint.brand")}</Label>
            <Input
              id="brand"
              value={fingerprintConfig.brand ?? ""}
              onChange={(e) => {
                updateFingerprintConfig("brand", e.target.value || undefined);
              }}
              placeholder={t("common.placeholders.example", {
                value: "Google Chrome",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="brand-version">
              {t("fingerprint.brandVersion")}
            </Label>
            <Input
              id="brand-version"
              value={fingerprintConfig.brandVersion ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "brandVersion",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "143",
              })}
            />
          </div>
        </div>
      </div>

      {/* Hardware Properties */}
      <div className="space-y-3">
        <Label>{t("fingerprint.hardwareProperties")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="hardware-concurrency">
              {t("fingerprint.hardwareConcurrency")}
            </Label>
            <Input
              id="hardware-concurrency"
              type="number"
              value={fingerprintConfig.hardwareConcurrency ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "hardwareConcurrency",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "8" })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="max-touch-points">
              {t("fingerprint.maxTouchPoints")}
            </Label>
            <Input
              id="max-touch-points"
              type="number"
              value={fingerprintConfig.maxTouchPoints ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "maxTouchPoints",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "0" })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-memory">
              {t("fingerprint.deviceMemory")}
            </Label>
            <Input
              id="device-memory"
              type="number"
              value={fingerprintConfig.deviceMemory ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "deviceMemory",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "8" })}
            />
          </div>
        </div>
      </div>

      {/* Screen Properties */}
      <div className="space-y-3">
        <Label>{t("fingerprint.screenProperties")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="screen-width">{t("fingerprint.screenWidth")}</Label>
            <Input
              id="screen-width"
              type="number"
              value={fingerprintConfig.screenWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1920",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-height">
              {t("fingerprint.screenHeight")}
            </Label>
            <Input
              id="screen-height"
              type="number"
              value={fingerprintConfig.screenHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1080",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="device-pixel-ratio">
              {t("fingerprint.devicePixelRatio")}
            </Label>
            <Input
              id="device-pixel-ratio"
              type="number"
              step="0.1"
              value={fingerprintConfig.devicePixelRatio ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "devicePixelRatio",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1.0",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-avail-width">
              {t("fingerprint.availableWidth")}
            </Label>
            <Input
              id="screen-avail-width"
              type="number"
              value={fingerprintConfig.screenAvailWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenAvailWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1920",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-avail-height">
              {t("fingerprint.availableHeight")}
            </Label>
            <Input
              id="screen-avail-width-height"
              type="number"
              value={fingerprintConfig.screenAvailHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenAvailHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1040",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-color-depth">
              {t("fingerprint.colorDepth")}
            </Label>
            <Input
              id="screen-color-depth"
              type="number"
              value={fingerprintConfig.screenColorDepth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenColorDepth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "24",
              })}
            />
          </div>
        </div>
      </div>

      {/* Window Properties */}
      <div className="space-y-3">
        <Label>{t("fingerprint.windowProperties")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="window-outer-width">
              {t("fingerprint.outerWidth")}
            </Label>
            <Input
              id="window-outer-width"
              type="number"
              value={fingerprintConfig.windowOuterWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "windowOuterWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1920",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="window-outer-height">
              {t("fingerprint.outerHeight")}
            </Label>
            <Input
              id="window-outer-height"
              type="number"
              value={fingerprintConfig.windowOuterHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "windowOuterHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1040",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="window-inner-width">
              {t("fingerprint.innerWidth")}
            </Label>
            <Input
              id="window-inner-width"
              type="number"
              value={fingerprintConfig.windowInnerWidth ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "windowInnerWidth",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "1920",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="window-inner-height">
              {t("fingerprint.innerHeight")}
            </Label>
            <Input
              id="window-inner-height"
              type="number"
              value={fingerprintConfig.windowInnerHeight ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "windowInnerHeight",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "940",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-x">{t("fingerprint.screenX")}</Label>
            <Input
              id="screen-x"
              type="number"
              value={fingerprintConfig.screenX ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenX",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "0" })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="screen-y">{t("fingerprint.screenY")}</Label>
            <Input
              id="screen-y"
              type="number"
              value={fingerprintConfig.screenY ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "screenY",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "0" })}
            />
          </div>
        </div>
      </div>

      {/* Language & Locale */}
      <div className="space-y-3">
        <Label>{t("fingerprint.languageAndLocale")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="language">{t("fingerprint.primaryLanguage")}</Label>
            <Input
              id="language"
              value={fingerprintConfig.language ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "language",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "en-US",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="languages">{t("fingerprint.languages")}</Label>
            <Input
              id="languages"
              value={
                Array.isArray(fingerprintConfig.languages)
                  ? JSON.stringify(fingerprintConfig.languages)
                  : ""
              }
              onChange={(e) => {
                if (!e.target.value) {
                  updateFingerprintConfig("languages", undefined);
                  return;
                }
                try {
                  const parsed = JSON.parse(e.target.value);
                  if (Array.isArray(parsed)) {
                    updateFingerprintConfig("languages", parsed);
                  }
                } catch {
                  // Invalid JSON, keep current value
                }
              }}
              placeholder='["en-US", "en"]'
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="do-not-track">{t("fingerprint.doNotTrack")}</Label>
            <Select
              value={fingerprintConfig.doNotTrack ?? ""}
              onValueChange={(value) => {
                updateFingerprintConfig("doNotTrack", value || undefined);
              }}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("fingerprint.selectDntPlaceholder")}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="0">{t("fingerprint.dntAllowed")}</SelectItem>
                <SelectItem value="1">
                  {t("fingerprint.dntNotAllowed")}
                </SelectItem>
                <SelectItem value="unspecified">
                  {t("fingerprint.dntUnspecified")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Timezone and Geolocation */}
      <div className="space-y-3">
        <Label>{t("fingerprint.timezoneAndGeolocation")}</Label>
        <p className="text-sm text-muted-foreground">
          {t("fingerprint.timezoneGeolocationDescription")}
        </p>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="timezone">{t("fingerprint.timezoneIana")}</Label>
            <Input
              id="timezone"
              value={fingerprintConfig.timezone ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "timezone",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "America/New_York",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="timezone-offset">
              {t("fingerprint.timezoneOffset")}
            </Label>
            <Input
              id="timezone-offset"
              type="number"
              value={fingerprintConfig.timezoneOffset ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "timezoneOffset",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t(
                "config.wayfern.fingerprint.timezoneOffsetPlaceholder",
              )}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="latitude">{t("fingerprint.latitude")}</Label>
            <Input
              id="latitude"
              type="number"
              step="any"
              value={fingerprintConfig.latitude ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "latitude",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "40.7128",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="longitude">{t("fingerprint.longitude")}</Label>
            <Input
              id="longitude"
              type="number"
              step="any"
              value={fingerprintConfig.longitude ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "longitude",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "-74.0060",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="accuracy">{t("fingerprint.accuracy")}</Label>
            <Input
              id="accuracy"
              type="number"
              value={fingerprintConfig.accuracy ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "accuracy",
                  e.target.value ? parseFloat(e.target.value) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "100",
              })}
            />
          </div>
        </div>
      </div>

      {/* WebGL Properties */}
      <div className="space-y-3">
        <Label>{t("fingerprint.webglProperties")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="webgl-vendor">{t("fingerprint.webglVendor")}</Label>
            <Input
              id="webgl-vendor"
              value={fingerprintConfig.webglVendor ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "webglVendor",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "Intel",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webgl-renderer">
              {t("fingerprint.webglRenderer")}
            </Label>
            <Input
              id="webgl-renderer"
              value={fingerprintConfig.webglRenderer ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "webglRenderer",
                  e.target.value || undefined,
                );
              }}
              placeholder={t(
                "config.wayfern.fingerprint.webglRendererPlaceholder",
              )}
            />
          </div>
        </div>
      </div>

      {/* WebGL Parameters (JSON) */}
      <div className="space-y-3">
        <Label>{t("fingerprint.webglParametersJson")}</Label>
        <Textarea
          value={fingerprintConfig.webglParameters ?? ""}
          onChange={(e) => {
            updateFingerprintConfig(
              "webglParameters",
              e.target.value || undefined,
            );
          }}
          placeholder='{"7936": "Intel", "7937": "Intel(R) HD Graphics"}'
          className="font-mono text-sm"
          rows={4}
        />
      </div>

      {/* Canvas Noise Seed */}
      <div className="space-y-3">
        <Label>{t("fingerprint.canvasFingerprint")}</Label>
        <div className="space-y-2">
          <Label htmlFor="canvas-noise-seed">
            {t("fingerprint.canvasNoiseSeed")}
          </Label>
          <Input
            id="canvas-noise-seed"
            value={fingerprintConfig.canvasNoiseSeed ?? ""}
            onChange={(e) => {
              updateFingerprintConfig(
                "canvasNoiseSeed",
                e.target.value || undefined,
              );
            }}
            placeholder={t("fingerprint.canvasNoiseSeedPlaceholder")}
          />
          <p className="text-sm text-muted-foreground">
            {t("fingerprint.canvasNoiseSeedDescription")}
          </p>
        </div>
      </div>

      {/* Fonts (JSON) */}
      <div className="space-y-3">
        <Label>{t("fingerprint.fontsJson")}</Label>
        <Textarea
          value={fingerprintConfig.fonts ?? ""}
          onChange={(e) => {
            updateFingerprintConfig("fonts", e.target.value || undefined);
          }}
          placeholder='["Arial", "Verdana", "Times New Roman"]'
          className="font-mono text-sm"
          rows={3}
        />
      </div>

      {/* Audio */}
      <div className="space-y-3">
        <Label>{t("fingerprint.audioProperties")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="audio-sample-rate">
              {t("fingerprint.sampleRate")}
            </Label>
            <Input
              id="audio-sample-rate"
              type="number"
              value={fingerprintConfig.audioSampleRate ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "audioSampleRate",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "48000",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="audio-max-channel-count">
              {t("fingerprint.maxChannelCount")}
            </Label>
            <Input
              id="audio-max-channel-count"
              type="number"
              value={fingerprintConfig.audioMaxChannelCount ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "audioMaxChannelCount",
                  e.target.value ? parseInt(e.target.value, 10) : undefined,
                );
              }}
              placeholder={t("common.placeholders.example", { value: "2" })}
            />
          </div>
        </div>
      </div>

      {/* Battery */}
      <div className="space-y-3">
        <Label>{t("fingerprint.battery")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <div className="flex items-center gap-x-2 mt-2">
              <Checkbox
                id="battery-charging"
                checked={fingerprintConfig.batteryCharging ?? false}
                onCheckedChange={(checked) => {
                  updateFingerprintConfig(
                    "batteryCharging",
                    checked || undefined,
                  );
                }}
              />
              <Label htmlFor="battery-charging">
                {t("fingerprint.charging")}
              </Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="battery-level">
              {t("fingerprint.batteryLevel")}
            </Label>
            <Input
              id="battery-level"
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
              placeholder={t("common.placeholders.example", {
                value: "0.85",
              })}
            />
          </div>
        </div>
      </div>

      {/* Vendor Info */}
      <div className="space-y-3">
        <Label>{t("fingerprint.vendorInfo")}</Label>
        <div className="grid grid-cols-1 gap-4 @md:grid-cols-2 @2xl:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="vendor">{t("fingerprint.vendor")}</Label>
            <Input
              id="vendor"
              value={fingerprintConfig.vendor ?? ""}
              onChange={(e) => {
                updateFingerprintConfig("vendor", e.target.value || undefined);
              }}
              placeholder={t("common.placeholders.example", {
                value: "Google Inc.",
              })}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="vendor-sub">{t("fingerprint.vendorSub")}</Label>
            <Input
              id="vendor-sub"
              value={fingerprintConfig.vendorSub ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "vendorSub",
                  e.target.value || undefined,
                );
              }}
              placeholder=""
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-sub">{t("fingerprint.productSub")}</Label>
            <Input
              id="product-sub"
              value={fingerprintConfig.productSub ?? ""}
              onChange={(e) => {
                updateFingerprintConfig(
                  "productSub",
                  e.target.value || undefined,
                );
              }}
              placeholder={t("common.placeholders.example", {
                value: "20030107",
              })}
            />
          </div>
        </div>
      </div>
    </>
  );
}
