"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";
import { WayfernAutomaticTab } from "./sub-components/wayfern-automatic-tab";
import { WayfernManualTab } from "./sub-components/wayfern-manual-tab";

interface WayfernConfigFormProps {
  config: WayfernConfig;
  onConfigChange: (key: keyof WayfernConfig, value: unknown) => void;
  className?: string;
  isCreating?: boolean;
  forceAdvanced?: boolean;
  readOnly?: boolean;
  crossOsUnlocked?: boolean;
  limitedMode?: boolean;
  profileVersion?: string;
  profileBrowser?: string;
}

const isFingerprintEditingDisabled = (config: WayfernConfig): boolean => {
  return config.randomize_fingerprint_on_launch === true;
};

const getCurrentOS = (): WayfernOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

const osLabels: Record<WayfernOS, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

export function WayfernConfigForm({
  config,
  onConfigChange,
  className = "",
  isCreating = false,
  forceAdvanced = false,
  readOnly = false,
  crossOsUnlocked = false,
  limitedMode = false,
  profileVersion,
  profileBrowser,
}: WayfernConfigFormProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(
    forceAdvanced ? "manual" : "automatic",
  );
  const [fingerprintConfig, setFingerprintConfig] =
    useState<WayfernFingerprintConfig>({});
  const [currentOS] = useState<WayfernOS>(getCurrentOS);
  const [isGeneratingFingerprint, setIsGeneratingFingerprint] = useState(false);

  const handleGenerateFingerprint = async () => {
    if (!profileVersion) return;
    setIsGeneratingFingerprint(true);
    try {
      const configJson = JSON.stringify(config);
      const result = await invoke<string>("generate_sample_fingerprint", {
        browser: profileBrowser ?? "wayfern",
        version: profileVersion,
        configJson,
      });
      onConfigChange("fingerprint", result);
    } catch (error) {
      console.error("Failed to generate fingerprint:", error);
    } finally {
      setIsGeneratingFingerprint(false);
    }
  };

  const selectedOS = config.os || currentOS;

  useEffect(() => {
    if (isCreating && typeof window !== "undefined") {
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;

      if (!config.screen_max_width) {
        onConfigChange("screen_max_width", screenWidth);
      }
      if (!config.screen_max_height) {
        onConfigChange("screen_max_height", screenHeight);
      }
    }
  }, [
    isCreating,
    config.screen_max_width,
    config.screen_max_height,
    onConfigChange,
  ]);

  useEffect(() => {
    if (config.fingerprint) {
      try {
        const parsed = JSON.parse(
          config.fingerprint,
        ) as WayfernFingerprintConfig;
        setFingerprintConfig(parsed);
      } catch (error) {
        console.error("Failed to parse fingerprint config:", error);
        setFingerprintConfig({});
      }
    } else {
      setFingerprintConfig({});
    }
  }, [config.fingerprint]);

  const updateFingerprintConfig = (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => {
    const newConfig = { ...fingerprintConfig };

    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete newConfig[key];
    } else {
      (newConfig as Record<string, unknown>)[key] = value;
    }

    setFingerprintConfig(newConfig);

    try {
      const jsonString = JSON.stringify(newConfig);
      onConfigChange("fingerprint", jsonString);
    } catch (error) {
      console.error("Failed to serialize fingerprint config:", error);
    }
  };

  const isAutoLocationEnabled = config.geoip !== false;

  const handleAutoLocationToggle = (enabled: boolean) => {
    if (enabled) {
      onConfigChange("geoip", true);
    } else {
      onConfigChange("geoip", false);
    }
  };

  const isEditingDisabled = isFingerprintEditingDisabled(config) || readOnly;

  return (
    <div className={`@container space-y-6 ${className}`}>
      {forceAdvanced ? (
        <WayfernManualTab
          config={config}
          onConfigChange={onConfigChange}
          fingerprintConfig={fingerprintConfig}
          updateFingerprintConfig={updateFingerprintConfig}
          isEditingDisabled={isEditingDisabled}
          limitedMode={limitedMode}
          readOnly={readOnly}
          profileVersion={profileVersion}
          isCreating={isCreating}
          crossOsUnlocked={crossOsUnlocked}
          isGeneratingFingerprint={isGeneratingFingerprint}
          handleGenerateFingerprint={handleGenerateFingerprint}
          selectedOS={selectedOS}
          currentOS={currentOS}
          osLabels={osLabels}
          isAutoLocationEnabled={isAutoLocationEnabled}
          handleAutoLocationToggle={handleAutoLocationToggle}
        />
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={readOnly ? undefined : setActiveTab}
          className="w-full"
        >
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="automatic" disabled={readOnly}>
              {t("fingerprint.automatic")}
            </TabsTrigger>
            <TabsTrigger value="manual" disabled={readOnly}>
              {t("fingerprint.manual")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="automatic" className="space-y-6">
            <WayfernAutomaticTab
              config={config}
              onConfigChange={onConfigChange}
              selectedOS={selectedOS}
              currentOS={currentOS}
              crossOsUnlocked={crossOsUnlocked}
              osLabels={osLabels}
              isAutoLocationEnabled={isAutoLocationEnabled}
              handleAutoLocationToggle={handleAutoLocationToggle}
              isEditingDisabled={isEditingDisabled}
              limitedMode={limitedMode}
              readOnly={readOnly}
            />
          </TabsContent>

          <TabsContent value="manual" className="space-y-6">
            <WayfernManualTab
              config={config}
              onConfigChange={onConfigChange}
              fingerprintConfig={fingerprintConfig}
              updateFingerprintConfig={updateFingerprintConfig}
              isEditingDisabled={isEditingDisabled}
              limitedMode={limitedMode}
              readOnly={readOnly}
              profileVersion={profileVersion}
              isCreating={isCreating}
              crossOsUnlocked={crossOsUnlocked}
              isGeneratingFingerprint={isGeneratingFingerprint}
              handleGenerateFingerprint={handleGenerateFingerprint}
              selectedOS={selectedOS}
              currentOS={currentOS}
              osLabels={osLabels}
              isAutoLocationEnabled={isAutoLocationEnabled}
              handleAutoLocationToggle={handleAutoLocationToggle}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
