"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  CamoufoxConfig,
  CamoufoxFingerprintConfig,
  CamoufoxOS,
} from "@/types";
import { AutomaticFingerprintTab } from "./sub-components/automatic-fingerprint-tab";
import { ManualFingerprintTab } from "./sub-components/manual-fingerprint-tab";

interface SharedCamoufoxConfigFormProps {
  config: CamoufoxConfig;
  onConfigChange: (key: keyof CamoufoxConfig, value: unknown) => void;
  className?: string;
  isCreating?: boolean; // Flag to indicate if this is for creating a new profile
  forceAdvanced?: boolean; // Force advanced mode (for editing)
  readOnly?: boolean; // Flag to indicate if the form should be read-only
  browserType?: "camoufox" | "wayfern"; // Browser type to customize form options
  crossOsUnlocked?: boolean; // Allow selecting non-current OS (paid feature)
  limitedMode?: boolean; // Blur and disable advanced fields while keeping basic options accessible
  profileVersion?: string;
  profileBrowser?: string;
}

// Determine if fingerprint editing should be disabled
const isFingerprintEditingDisabled = (config: CamoufoxConfig): boolean => {
  return config.randomize_fingerprint_on_launch === true;
};

// Detect the current operating system
const getCurrentOS = (): CamoufoxOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

// OS display labels
const osLabels: Record<CamoufoxOS, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
};

// ObjectEditor component moved to sub-components/object-editor.tsx

export function SharedCamoufoxConfigForm({
  config,
  onConfigChange,
  className = "",
  isCreating = false,
  forceAdvanced = false,
  readOnly = false,
  browserType = "camoufox",
  crossOsUnlocked = false,
  limitedMode = false,
  profileVersion,
  profileBrowser,
}: SharedCamoufoxConfigFormProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(
    forceAdvanced ? "manual" : "automatic",
  );
  const [fingerprintConfig, setFingerprintConfig] =
    useState<CamoufoxFingerprintConfig>({});
  const [currentOS] = useState<CamoufoxOS>(getCurrentOS);
  const [isGeneratingFingerprint, setIsGeneratingFingerprint] = useState(false);

  const handleGenerateFingerprint = async () => {
    if (!profileVersion) return;
    const browser = profileBrowser ?? browserType ?? "camoufox";
    setIsGeneratingFingerprint(true);
    try {
      const configJson = JSON.stringify(config);
      const result = await invoke<string>("generate_sample_fingerprint", {
        browser,
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

  // Get selected OS (defaults to current OS)
  const selectedOS = config.os || currentOS;

  // Set screen resolution to user's screen size when creating a new profile
  useEffect(() => {
    if (isCreating && typeof window !== "undefined") {
      const screenWidth = window.screen.width;
      const screenHeight = window.screen.height;

      // Only set if not already configured
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

  // Parse fingerprint config when component mounts or config changes
  useEffect(() => {
    if (config.fingerprint) {
      try {
        const parsed = JSON.parse(
          config.fingerprint,
        ) as CamoufoxFingerprintConfig;
        setFingerprintConfig(parsed);
      } catch (error) {
        console.error("Failed to parse fingerprint config:", error);
        setFingerprintConfig({});
      }
    } else {
      // Initialize with empty config if no fingerprint is set
      setFingerprintConfig({});
    }
  }, [config.fingerprint]);

  // Update fingerprint config and serialize it
  const updateFingerprintConfig = (
    key: keyof CamoufoxFingerprintConfig,
    value: unknown,
  ) => {
    const newConfig = { ...fingerprintConfig };

    // Remove undefined values to keep the config clean
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

    // Validate that the config can be serialized to JSON
    try {
      const jsonString = JSON.stringify(newConfig);
      onConfigChange("fingerprint", jsonString);
    } catch (error) {
      console.error("Failed to serialize fingerprint config:", error);
      // Don't update if serialization fails
    }
  };

  // Determine if automatic location configuration is enabled
  const isAutoLocationEnabled = config.geoip !== false;

  // Handle automatic location configuration toggle
  const handleAutoLocationToggle = (enabled: boolean) => {
    if (enabled) {
      onConfigChange("geoip", true);
    } else {
      onConfigChange("geoip", false);
    }
  };

  const isEditingDisabled = isFingerprintEditingDisabled(config) || readOnly;

  // renderAdvancedForm has been moved to sub-components/manual-fingerprint-tab.tsx

  return (
    <div className={`@container space-y-6 ${className}`}>
      {forceAdvanced ? (
        <ManualFingerprintTab
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
          browserType={browserType}
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
            <AutomaticFingerprintTab
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
            <ManualFingerprintTab
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
              browserType={browserType}
            />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
