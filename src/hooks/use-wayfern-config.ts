"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type {
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";

const getCurrentOS = (): WayfernOS => {
  if (typeof navigator === "undefined") return "windows";
  const platform = navigator.platform?.toLowerCase() || "";
  const userAgent = navigator.userAgent?.toLowerCase() || "";
  if (platform.includes("win") || userAgent.includes("win")) return "windows";
  if (platform.includes("mac") || userAgent.includes("mac")) return "macos";
  return "linux";
};

/**
 * Custom hook for Wayfern fingerprint configuration state and update handlers.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 */
export function useWayfernConfig(
  getCreatableVersion: (
    browserType?: string,
  ) => { version: string; releaseType: "stable" | "nightly" } | null,
) {
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>({});
  const [fingerprintConfig, setFingerprintConfig] =
    useState<WayfernFingerprintConfig>({});
  const [isGeneratingFingerprint, setIsGeneratingFingerprint] = useState(false);

  // Set the correct client-side detected host OS on mount to prevent SSR hydration fallback to linux
  useEffect(() => {
    setWayfernConfig((prev) => ({
      ...prev,
      os: prev.os || getCurrentOS(),
    }));
  }, []);

  // Generate a random sample fingerprint inside the UI
  const handleGenerateFingerprint = useCallback(
    async (currentConfig?: WayfernConfig) => {
      const bestVersion = getCreatableVersion("wayfern");
      if (!bestVersion) return;
      setIsGeneratingFingerprint(true);
      try {
        const configToUse = currentConfig || wayfernConfig;
        const configJson = JSON.stringify(configToUse);
        const result = await invoke<string>("generate_sample_fingerprint", {
          browser: "wayfern",
          version: bestVersion.version,
          configJson,
        });
        setWayfernConfig((prev) => ({ ...prev, fingerprint: result }));
        toast.success("New sample fingerprint generated successfully");
      } catch (error) {
        console.error("Failed to generate fingerprint:", error);
        toast.error("Failed to generate sample fingerprint");
      } finally {
        setIsGeneratingFingerprint(false);
      }
    },
    [getCreatableVersion, wayfernConfig],
  );

  // Sync fingerprintConfig state with wayfernConfig.fingerprint JSON string
  useEffect(() => {
    if (wayfernConfig.fingerprint) {
      try {
        const parsed = JSON.parse(
          wayfernConfig.fingerprint,
        ) as WayfernFingerprintConfig;
        setFingerprintConfig(parsed);
      } catch (error) {
        console.error("Failed to parse fingerprint config:", error);
        setFingerprintConfig({});
      }
    } else {
      setFingerprintConfig({});
    }
  }, [wayfernConfig.fingerprint]);

  const updateWayfernConfig = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === "os") {
        void handleGenerateFingerprint(updated);
      }
      return updated;
    });
  };

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
      updateWayfernConfig("fingerprint", jsonString);
    } catch (error) {
      console.error("Failed to serialize fingerprint config:", error);
    }
  };

  const handleAutoLocationToggle = (enabled: boolean) => {
    updateWayfernConfig("geoip", enabled);
  };

  const isAutoLocationEnabled = wayfernConfig.geoip !== false;

  const isFingerprintEditingDisabled =
    wayfernConfig.randomize_fingerprint_on_launch === true;

  return {
    wayfernConfig,
    fingerprintConfig,
    isGeneratingFingerprint,
    updateWayfernConfig,
    updateFingerprintConfig,
    handleGenerateFingerprint,
    handleAutoLocationToggle,
    isAutoLocationEnabled,
    isFingerprintEditingDisabled,
    setWayfernConfig,
  };
}
