"use client";

import { Shuffle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { WayfernFingerprintConfig } from "@/types";

interface HardwareTabProps {
  fingerprintConfig: WayfernFingerprintConfig;
  updateFingerprintConfig: (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => void;
  updateFingerprintConfigs: (
    updates: Partial<WayfernFingerprintConfig>,
  ) => void;
  isEditingDisabled: boolean;
}

const SCREEN_RESOLUTIONS = [
  { label: "1920 x 1080 (1080p)", width: 1920, height: 1080 },
  { label: "1366 x 768", width: 1366, height: 768 },
  { label: "1440 x 900", width: 1440, height: 900 },
  { label: "1536 x 864", width: 1536, height: 864 },
  { label: "2560 x 1440 (2K)", width: 2560, height: 1440 },
  { label: "3840 x 2160 (4K)", width: 3840, height: 2160 },
  { label: "1280 x 720 (720p)", width: 1280, height: 720 },
  { label: "1280 x 800", width: 1280, height: 800 },
  { label: "1600 x 900", width: 1600, height: 900 },
  { label: "1024 x 768", width: 1024, height: 768 },
];

const GPU_PRESETS: Record<
  string,
  Array<{ vendor: string; renderer: string }>
> = {
  windows: [
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (NVIDIA)",
      renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (Intel)",
      renderer: "ANGLE (Intel, Intel(R) UHD Graphics 770/PCIe/SSE2)",
    },
    {
      vendor: "Google Inc. (AMD)",
      renderer: "ANGLE (AMD, AMD Radeon(TM) Graphics/PCIe/SSE2)",
    },
  ],
  macos: [
    { vendor: "Apple Inc.", renderer: "Apple M1" },
    { vendor: "Apple Inc.", renderer: "Apple M2" },
    { vendor: "Apple Inc.", renderer: "Apple M3" },
    { vendor: "Apple Inc.", renderer: "Apple M1 Pro" },
    { vendor: "Apple Inc.", renderer: "Apple M2 Max" },
    { vendor: "Apple", renderer: "Apple Software Renderer" },
  ],
  linux: [
    { vendor: "Mesa", renderer: "Mesa Intel(R) UHD Graphics 620 (KBL GT2)" },
    { vendor: "Mesa", renderer: "Mesa AMD Radeon(TM) Graphics" },
    { vendor: "Mesa/X.org", renderer: "llvmpipe (LLVM 12.0.0, 256 bits)" },
  ],
  ios: [{ vendor: "Apple Inc.", renderer: "Apple GPU" }],
  android: [
    { vendor: "ARM", renderer: "Mali-G78" },
    { vendor: "Qualcomm", renderer: "Adreno (TM) 730" },
    { vendor: "Qualcomm", renderer: "Adreno (TM) 642L" },
  ],
};

const getFingerprintOS = (config: WayfernFingerprintConfig): string => {
  const platform = (config.platform || "").toLowerCase();
  const ua = (config.userAgent || "").toLowerCase();
  if (platform.includes("win") || ua.includes("win")) return "windows";
  if (
    platform.includes("mac") ||
    platform.includes("iphone") ||
    platform.includes("ipad") ||
    ua.includes("mac") ||
    ua.includes("iphone")
  ) {
    if (ua.includes("iphone") || ua.includes("ipad")) return "ios";
    return "macos";
  }
  if (platform.includes("linux") || ua.includes("linux")) {
    if (ua.includes("android")) return "android";
    return "linux";
  }
  return "windows";
};

export function HardwareTab({
  fingerprintConfig,
  updateFingerprintConfig,
  updateFingerprintConfigs,
  isEditingDisabled,
}: HardwareTabProps) {
  const { t } = useTranslation();
  const [expandedSections, setExpandedSections] = useState<
    Record<string, boolean>
  >({});

  const matchedPreset = SCREEN_RESOLUTIONS.find(
    (r) =>
      r.width === fingerprintConfig.screenWidth &&
      r.height === fingerprintConfig.screenHeight,
  );
  const selectedPresetVal = matchedPreset
    ? `${matchedPreset.width}x${matchedPreset.height}`
    : fingerprintConfig.screenWidth
      ? "custom"
      : "1920x1080";

  const handlePresetChange = (val: string) => {
    if (val === "custom") return;
    const [wStr, hStr] = val.split("x");
    const w = parseInt(wStr, 10);
    const h = parseInt(hStr, 10);

    updateFingerprintConfigs({
      screenWidth: w,
      screenHeight: h,
      screenAvailWidth: w,
      screenAvailHeight: h - 40,
      windowOuterWidth: w,
      windowOuterHeight: h,
      windowInnerWidth: w,
      windowInnerHeight: h - 40,
    });
  };

  const handleGPUShuffle = () => {
    const targetedOS = getFingerprintOS(fingerprintConfig);
    const presets = GPU_PRESETS[targetedOS] || GPU_PRESETS.windows;
    const randomPreset = presets[Math.floor(Math.random() * presets.length)];

    updateFingerprintConfigs({
      webglVendor: randomPreset.vendor,
      webglRenderer: randomPreset.renderer,
      webglParameters: undefined,
      webgl2Parameters: undefined,
    });
  };

  // ========================================
  // TDD Step 0: Test Case Definitions
  // ========================================
  // TC-01: Basic Randomization Flow
  //   Given: User on Hardware tab with default config
  //   When: Click Randomize All
  //   Then: All 18 fields populated with valid values from predefined ranges
  //
  // TC-02: Screen dimensions from SCREEN_RESOLUTIONS
  //   Expected: screenWidth ∈ [1920,1366,1440,1536,2560,3840,1280,1600,1024]
  //
  // TC-03: Canvas seed is 6-digit string
  //   Expected: canvasNoiseSeed.length === 6 && /^\d{6}$/.test(seed)
  //
  // TC-04: Audio always 48kHz stereo
  //   Expected: audioSampleRate=48000, audioMaxChannelCount=2
  //
  // TC-05: Windows GPU presets
  //   Given: userAgent contains "Win" or platform contains "win"
  //   Expected: webglVendor/renderer from GPU_PRESETS.windows
  //
  // TC-06: macOS GPU presets
  //   Given: userAgent contains "Mac"
  //   Expected: Apple GPU presets from GPU_PRESETS.macos
  //
  // TC-07: Linux GPU presets
  //   Given: userAgent contains "Linux"
  //   Expected: Mesa/llvmpipe presets from GPU_PRESETS.linux
  //
  // TC-08: Empty userAgent fallback
  //   Given: platform="" && userAgent=""
  //   Expected: Falls back to GPU_PRESETS.windows (no crash)
  //
  // TC-09: Multiple clicks produce variety
  //   Expected: 5 consecutive clicks yield ≥3 different screenWidth values
  //
  // TC-10: DPR independent of screen size
  //   Expected: devicePixelRatio ∈ [1,1.25,1.5,2] regardless of screen preset
  //
  // TC-11: Existing Noise/Off dropdowns unaffected
  //   Expected: After randomization, WebGL/Canvas/Audio dropdowns still show "Noise"
  //
  // TC-12: Shuffle GPU + Advanced toggle still work
  //   Expected: Individual GPU shuffle buttons and Advanced toggle functional post-randomization
  // ========================================

  const handleRandomizeAll = () => {
    const os = getFingerprintOS(fingerprintConfig);
    const gpuPresets = GPU_PRESETS[os] || GPU_PRESETS.windows;
    const randomGPU = gpuPresets[Math.floor(Math.random() * gpuPresets.length)];

    const randomScreen =
      SCREEN_RESOLUTIONS[Math.floor(Math.random() * SCREEN_RESOLUTIONS.length)];
    const dprOptions = [1, 1.25, 1.5, 2];
    const randomDPR = dprOptions[Math.floor(Math.random() * dprOptions.length)];

    const cpuOptions = [2, 4, 6, 8, 12, 16];
    const ramOptions = [4, 8, 16, 32];
    const touchOptions = [0, 5, 10];

    const randomCanvasSeed = (
      100000 + Math.floor(Math.random() * 900000)
    ).toString();

    updateFingerprintConfigs({
      // Screen (8 fields)
      screenWidth: randomScreen.width,
      screenHeight: randomScreen.height,
      screenAvailWidth: randomScreen.width,
      screenAvailHeight: randomScreen.height - 40,
      windowOuterWidth: randomScreen.width,
      windowOuterHeight: randomScreen.height,
      windowInnerWidth: randomScreen.width,
      windowInnerHeight: randomScreen.height - 40,
      devicePixelRatio: randomDPR,

      // System (3 fields)
      hardwareConcurrency:
        cpuOptions[Math.floor(Math.random() * cpuOptions.length)],
      deviceMemory: ramOptions[Math.floor(Math.random() * ramOptions.length)],
      maxTouchPoints:
        touchOptions[Math.floor(Math.random() * touchOptions.length)],

      // Graphics (7 fields)
      webglVendor: randomGPU.vendor,
      webglRenderer: randomGPU.renderer,
      webglParameters: undefined,
      webgl2Parameters: undefined,
      canvasNoiseSeed: randomCanvasSeed,
      audioSampleRate: 48000,
      audioMaxChannelCount: 2,
    });
  };

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Randomize All Header */}
      <div className="flex items-center justify-between mb-2">
        <div>
          <Label className="text-sm font-semibold">Hardware Fingerprint</Label>
          <p className="text-xs text-muted-foreground">
            Configure browser anti-detect hardware parameters
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={isEditingDisabled}
          onClick={handleRandomizeAll}
          className="gap-2"
          title={t("fingerprint.randomizeAllTooltip")}
        >
          <Shuffle className="h-4 w-4" />
          {t("fingerprint.randomizeAll")}
        </Button>
      </div>

      <Tabs defaultValue="screen" className="w-full">
        <TabsList className="grid w-full grid-cols-3 bg-muted/20 h-10 p-1 mb-6 rounded-lg">
          <TabsTrigger
            value="screen"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md text-xs font-semibold py-1.5 transition-all"
          >
            {t("fingerprint.subTabs.screen") || "Screen"}
          </TabsTrigger>
          <TabsTrigger
            value="system"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md text-xs font-semibold py-1.5 transition-all"
          >
            {t("fingerprint.subTabs.system") || "System (CPU & RAM)"}
          </TabsTrigger>
          <TabsTrigger
            value="graphics"
            className="data-[state=active]:bg-background data-[state=active]:text-foreground rounded-md text-xs font-semibold py-1.5 transition-all"
          >
            {t("fingerprint.subTabs.graphics") || "Graphics & Audio"}
          </TabsTrigger>
        </TabsList>

        {/* 1. SCREEN TAB */}
        <TabsContent value="screen" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="screen-preset">Screen Size Preset</Label>
              <Select
                disabled={isEditingDisabled}
                value={selectedPresetVal}
                onValueChange={handlePresetChange}
              >
                <SelectTrigger id="screen-preset" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCREEN_RESOLUTIONS.map((r) => (
                    <SelectItem key={r.label} value={`${r.width}x${r.height}`}>
                      {r.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="custom">Custom...</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="dpr">Device Pixel Ratio (DPR)</Label>
              <Select
                disabled={isEditingDisabled}
                value={fingerprintConfig.devicePixelRatio?.toString() || "1"}
                onValueChange={(val) => {
                  updateFingerprintConfig("devicePixelRatio", parseFloat(val));
                }}
              >
                <SelectTrigger id="dpr" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">1.0</SelectItem>
                  <SelectItem value="1.25">1.25</SelectItem>
                  <SelectItem value="1.5">1.5</SelectItem>
                  <SelectItem value="2">2.0 (Retina/High-DPI)</SelectItem>
                  <SelectItem value="3">3.0</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Screen Advanced Accordion */}
          <div className="rounded-lg border bg-muted/10 p-3.5">
            <button
              type="button"
              onClick={() => toggleSection("screen")}
              className="flex w-full items-center justify-between text-left"
            >
              <div className="space-y-0.5">
                <Label className="text-xs font-semibold cursor-pointer">
                  {t("fingerprint.customizeDetails") ||
                    "Customize detailed hardware parameters"}
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  {t("fingerprint.customizeDetailsDesc") ||
                    "Manually adjust seeds, renderers, and JSON parameters"}
                </p>
              </div>
              <span className="text-xs text-muted-foreground">
                {expandedSections.screen ? "−" : "+"}
              </span>
            </button>
            {expandedSections.screen && (
              <fieldset
                disabled={isEditingDisabled}
                className="grid grid-cols-1 gap-4 md:grid-cols-3 disabled:opacity-60 pt-4 mt-4 border-t"
              >
                <div className="space-y-2">
                  <Label htmlFor="screen-w">
                    {t("fingerprint.screenWidth")}
                  </Label>
                  <Input
                    id="screen-w"
                    type="number"
                    value={fingerprintConfig.screenWidth ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "screenWidth",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="1920"
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="screen-h">
                    {t("fingerprint.screenHeight")}
                  </Label>
                  <Input
                    id="screen-h"
                    type="number"
                    value={fingerprintConfig.screenHeight ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "screenHeight",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="1080"
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="screen-avail-w">
                    {t("fingerprint.screenAvailWidth")}
                  </Label>
                  <Input
                    id="screen-avail-w"
                    type="number"
                    value={fingerprintConfig.screenAvailWidth ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "screenAvailWidth",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="1920"
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="screen-avail-h">
                    {t("fingerprint.screenAvailHeight")}
                  </Label>
                  <Input
                    id="screen-avail-h"
                    type="number"
                    value={fingerprintConfig.screenAvailHeight ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "screenAvailHeight",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="1040"
                    className="h-9"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="screen-color">
                    {t("fingerprint.screenColorDepth")}
                  </Label>
                  <Input
                    id="screen-color"
                    type="number"
                    value={fingerprintConfig.screenColorDepth ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "screenColorDepth",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="24"
                    className="h-9"
                  />
                </div>
              </fieldset>
            )}
          </div>
        </TabsContent>

        {/* 2. SYSTEM TAB */}
        <TabsContent value="system" className="space-y-6 outline-none">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="cpu-cores">
                {t("fingerprint.hardwareConcurrency") || "CPU Cores"}
              </Label>
              <Select
                disabled={isEditingDisabled}
                value={fingerprintConfig.hardwareConcurrency?.toString() || "4"}
                onValueChange={(val) => {
                  updateFingerprintConfig(
                    "hardwareConcurrency",
                    parseInt(val, 10),
                  );
                }}
              >
                <SelectTrigger id="cpu-cores" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 Cores</SelectItem>
                  <SelectItem value="4">4 Cores</SelectItem>
                  <SelectItem value="6">6 Cores</SelectItem>
                  <SelectItem value="8">8 Cores</SelectItem>
                  <SelectItem value="12">12 Cores</SelectItem>
                  <SelectItem value="16">16 Cores</SelectItem>
                  <SelectItem value="24">24 Cores</SelectItem>
                  <SelectItem value="32">32 Cores</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="device-memory">
                {t("fingerprint.deviceMemory") || "Device Memory (RAM)"}
              </Label>
              <Select
                disabled={isEditingDisabled}
                value={fingerprintConfig.deviceMemory?.toString() || "8"}
                onValueChange={(val) => {
                  updateFingerprintConfig("deviceMemory", parseInt(val, 10));
                }}
              >
                <SelectTrigger id="device-memory" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="2">2 GB</SelectItem>
                  <SelectItem value="4">4 GB</SelectItem>
                  <SelectItem value="8">8 GB</SelectItem>
                  <SelectItem value="16">16 GB</SelectItem>
                  <SelectItem value="32">32 GB</SelectItem>
                  <SelectItem value="64">64 GB</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-touch-points">
                {t("fingerprint.maxTouchPoints") || "Touch Points"}
              </Label>
              <Select
                disabled={isEditingDisabled}
                value={fingerprintConfig.maxTouchPoints?.toString() || "0"}
                onValueChange={(val) => {
                  updateFingerprintConfig("maxTouchPoints", parseInt(val, 10));
                }}
              >
                <SelectTrigger id="max-touch-points" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 (Desktop)</SelectItem>
                  <SelectItem value="5">5 (Mobile/Tablet)</SelectItem>
                  <SelectItem value="10">10 (Mobile/Tablet)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* System Advanced Switch */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/10 p-3.5">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold">
                {t("fingerprint.customizeDetails") ||
                  "Customize detailed hardware parameters"}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {t("fingerprint.customizeDetailsDesc") ||
                  "Manually adjust seeds, renderers, and JSON parameters"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleSection("graphics")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {expandedSections.graphics ? "−" : "+"}
            </button>
          </div>
        </TabsContent>

        {/* 3. GRAPHICS TAB */}
        <TabsContent value="graphics" className="space-y-6 outline-none">
          {/* WebGL */}
          <div className="space-y-4 pt-2">
            <div className="flex items-center justify-between border-b pb-2">
              <Label className="text-sm font-bold">
                {t("fingerprint.webglProperties")}
              </Label>
              <Select
                disabled={isEditingDisabled}
                value={
                  fingerprintConfig.webglVendor ||
                  fingerprintConfig.webglRenderer
                    ? "noise"
                    : "off"
                }
                onValueChange={(val) => {
                  if (val === "off") {
                    updateFingerprintConfigs({
                      webglVendor: undefined,
                      webglRenderer: undefined,
                      webglParameters: undefined,
                    });
                  } else {
                    const targetedOS = getFingerprintOS(fingerprintConfig);
                    const presets =
                      GPU_PRESETS[targetedOS] || GPU_PRESETS.windows;
                    const randomPreset = presets[0];
                    updateFingerprintConfigs({
                      webglVendor: randomPreset.vendor,
                      webglRenderer: randomPreset.renderer,
                    });
                  }
                }}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="noise">Noise</SelectItem>
                  <SelectItem value="off">Off (Real)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {expandedSections.graphics && (
              <fieldset
                disabled={
                  isEditingDisabled ||
                  !(
                    fingerprintConfig.webglVendor ||
                    fingerprintConfig.webglRenderer
                  )
                }
                className="space-y-4 disabled:opacity-50"
              >
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="webgl-vend">
                      {t("fingerprint.webglVendor")}
                    </Label>
                    <div className="flex gap-2">
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
                        className="h-9 flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 shrink-0 border-orange-500/20 text-orange-500 hover:bg-orange-500/10 hover:text-orange-600 transition-colors"
                        onClick={handleGPUShuffle}
                        title={t("fingerprint.shuffleGPUTooltip")}
                      >
                        <Shuffle className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="webgl-rend">
                      {t("fingerprint.webglRenderer")}
                    </Label>
                    <div className="flex gap-2">
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
                        className="h-9 flex-1"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        className="h-9 w-9 shrink-0 border-orange-500/20 text-orange-500 hover:bg-orange-500/10 hover:text-orange-600 transition-colors"
                        onClick={handleGPUShuffle}
                        title={t("fingerprint.shuffleGPUTooltip")}
                      >
                        <Shuffle className="h-4 w-4" />
                      </Button>
                    </div>
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
            )}
          </div>

          {/* Canvas */}
          <div className="space-y-4 pt-2 border-t">
            <div className="flex items-center justify-between border-b pb-2">
              <Label className="text-sm font-bold">Canvas</Label>
              <Select
                disabled={isEditingDisabled}
                value={fingerprintConfig.canvasNoiseSeed ? "noise" : "off"}
                onValueChange={(val) => {
                  if (val === "off") {
                    updateFingerprintConfig("canvasNoiseSeed", undefined);
                  } else {
                    const randomSeed = Math.floor(
                      100000 + Math.random() * 900000,
                    ).toString();
                    updateFingerprintConfig("canvasNoiseSeed", randomSeed);
                  }
                }}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="noise">Noise</SelectItem>
                  <SelectItem value="off">Off (Real)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {expandedSections.graphics && (
              <fieldset
                disabled={
                  isEditingDisabled || !fingerprintConfig.canvasNoiseSeed
                }
                className="disabled:opacity-50"
              >
                <div className="space-y-2 max-w-xs">
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
              </fieldset>
            )}
          </div>

          {/* Audio */}
          <div className="space-y-4 pt-2 border-t">
            <div className="flex items-center justify-between border-b pb-2">
              <Label className="text-sm font-bold">Audio</Label>
              <Select
                disabled={isEditingDisabled}
                value={
                  fingerprintConfig.audioSampleRate ||
                  fingerprintConfig.audioMaxChannelCount
                    ? "noise"
                    : "off"
                }
                onValueChange={(val) => {
                  if (val === "off") {
                    updateFingerprintConfigs({
                      audioSampleRate: undefined,
                      audioMaxChannelCount: undefined,
                    });
                  } else {
                    updateFingerprintConfigs({
                      audioSampleRate: 48000,
                      audioMaxChannelCount: 2,
                    });
                  }
                }}
              >
                <SelectTrigger className="w-[120px] h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="noise">Noise</SelectItem>
                  <SelectItem value="off">Off (Real)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {expandedSections.graphics && (
              <fieldset
                disabled={
                  isEditingDisabled ||
                  !(
                    fingerprintConfig.audioSampleRate ||
                    fingerprintConfig.audioMaxChannelCount
                  )
                }
                className="grid grid-cols-1 gap-4 md:grid-cols-2 disabled:opacity-50"
              >
                <div className="space-y-2">
                  <Label htmlFor="audio-rate">
                    {t("fingerprint.sampleRate")}
                  </Label>
                  <Input
                    id="audio-rate"
                    type="number"
                    value={fingerprintConfig.audioSampleRate ?? ""}
                    onChange={(e) => {
                      updateFingerprintConfig(
                        "audioSampleRate",
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
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
                        e.target.value
                          ? parseInt(e.target.value, 10)
                          : undefined,
                      );
                    }}
                    placeholder="2"
                    className="h-9"
                  />
                </div>
              </fieldset>
            )}
          </div>

          {/* Fonts & Battery (Advanced sections) */}
          {expandedSections.graphics && (
            <>
              {/* Fonts */}
              <div className="space-y-4 pt-2 border-t">
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
                      updateFingerprintConfig(
                        "fonts",
                        e.target.value || undefined,
                      )
                    }
                    placeholder='["Arial", "Verdana", "Times New Roman"]'
                    className="font-mono text-xs min-h-[80px]"
                  />
                </fieldset>
              </div>

              {/* Battery & Vendor Info */}
              <div className="space-y-4 pt-2 border-t">
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
                      <Label htmlFor="bat-level">
                        {t("fingerprint.batteryLevel")}
                      </Label>
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
                            e.target.value
                              ? parseFloat(e.target.value)
                              : undefined,
                          );
                        }}
                        placeholder="0.85"
                        className="h-9"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="vend-brand">
                        {t("fingerprint.vendor")}
                      </Label>
                      <Input
                        id="vend-brand"
                        value={fingerprintConfig.vendor ?? ""}
                        onChange={(e) =>
                          updateFingerprintConfig(
                            "vendor",
                            e.target.value || undefined,
                          )
                        }
                        placeholder="Google Inc."
                        className="h-9"
                      />
                    </div>
                  </div>
                </fieldset>
              </div>
            </>
          )}

          {/* Graphics Advanced Switch */}
          <div className="flex items-center justify-between rounded-lg border bg-muted/10 p-3.5 mt-6">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold">
                {t("fingerprint.customizeDetails") ||
                  "Customize detailed hardware parameters"}
              </Label>
              <p className="text-[11px] text-muted-foreground">
                {t("fingerprint.customizeDetailsDesc") ||
                  "Manually adjust seeds, renderers, and JSON parameters"}
              </p>
            </div>
            <button
              type="button"
              onClick={() => toggleSection("graphics")}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              {expandedSections.graphics ? "−" : "+"}
            </button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
