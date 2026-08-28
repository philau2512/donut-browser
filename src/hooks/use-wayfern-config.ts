"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
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

const FALLBACK_SCREEN_OVERRIDES: Partial<WayfernFingerprintConfig> = {
  screenWidth: 1920,
  screenHeight: 1080,
  screenAvailWidth: 1920,
  screenAvailHeight: 1040,
  windowOuterWidth: 1920,
  windowOuterHeight: 1080,
  windowInnerWidth: 1920,
  windowInnerHeight: 1040,
  devicePixelRatio: 1,
};

/** Prefer host screen metrics so 2K/4K laptops don't default to a tiny 1080p window. */
const getHostScreenOverrides = (): Partial<WayfernFingerprintConfig> => {
  if (typeof window === "undefined" || !window.screen) {
    return { ...FALLBACK_SCREEN_OVERRIDES };
  }

  const width = window.screen.width || 1920;
  const height = window.screen.height || 1080;
  const availW = window.screen.availWidth || width;
  const availH = window.screen.availHeight || height;
  const dpr =
    typeof window.devicePixelRatio === "number" && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1;

  return {
    screenWidth: width,
    screenHeight: height,
    screenAvailWidth: availW,
    screenAvailHeight: availH,
    // Outer slightly under full screen so chrome/taskbar fit when not maximized
    windowOuterWidth: Math.min(width, availW),
    windowOuterHeight: Math.min(height, availH),
    windowInnerWidth: Math.min(width, availW),
    windowInnerHeight: Math.max(600, Math.min(height, availH) - 80),
    devicePixelRatio: dpr,
  };
};

/** Screen + window fields that must stay consistent when user locks resolution. */
const applyScreenOverride = (
  config: WayfernFingerprintConfig,
  width: number,
  height: number,
): WayfernFingerprintConfig => ({
  ...config,
  screenWidth: width,
  screenHeight: height,
  screenAvailWidth: width,
  screenAvailHeight: height - 40,
  windowOuterWidth: width,
  windowOuterHeight: height,
  windowInnerWidth: width,
  windowInnerHeight: height - 40,
});

const applyLanguageOverride = (
  config: WayfernFingerprintConfig,
  language: string,
  languages?: string[],
): WayfernFingerprintConfig => {
  const primary = language.trim();
  if (!primary) return config;
  const base = primary.split("-")[0] || primary;
  return {
    ...config,
    language: primary,
    languages: languages?.length ? languages : [primary, base],
  };
};

/**
 * Merge user overrides onto a full generated fingerprint.
 * Screen/language locks always win over regenerated values.
 */
export const mergeFingerprintOverrides = (
  base: WayfernFingerprintConfig,
  overrides: Partial<WayfernFingerprintConfig>,
): WayfernFingerprintConfig => {
  let merged: WayfernFingerprintConfig = { ...base, ...overrides };

  if (
    typeof overrides.screenWidth === "number" &&
    typeof overrides.screenHeight === "number"
  ) {
    merged = applyScreenOverride(
      merged,
      overrides.screenWidth,
      overrides.screenHeight,
    );
  }

  if (typeof overrides.language === "string" && overrides.language) {
    merged = applyLanguageOverride(
      merged,
      overrides.language,
      overrides.languages,
    );
  }

  return merged;
};

/**
 * Custom hook for Wayfern fingerprint configuration state and update handlers.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 *
 * User-edited fields are tracked as `fingerprintOverrides` so they survive
 * "Get new fingerprint" / OS changes and are applied onto the full generated sample.
 */
export function useWayfernConfig(
  getCreatableVersion: (
    browserType?: string,
  ) => { version: string; releaseType: "stable" | "nightly" } | null,
) {
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>({});
  const [fingerprintConfig, setFingerprintConfig] =
    useState<WayfernFingerprintConfig>({});
  // Start with 1080p fallback (SSR-safe); hydrate to host 2K/4K metrics on client.
  const [fingerprintOverrides, setFingerprintOverrides] = useState<
    Partial<WayfernFingerprintConfig>
  >(() => ({ ...FALLBACK_SCREEN_OVERRIDES }));
  const [isGeneratingFingerprint, setIsGeneratingFingerprint] = useState(false);
  const [fixedLanguageEnabled, setFixedLanguageEnabled] = useState(false);
  const [fixedLanguage, setFixedLanguage] = useState("en-US");

  // Keep latest overrides/config for async generate without stale closures
  const overridesRef = useRef(fingerprintOverrides);
  const wayfernConfigRef = useRef(wayfernConfig);
  useEffect(() => {
    overridesRef.current = fingerprintOverrides;
  }, [fingerprintOverrides]);
  useEffect(() => {
    wayfernConfigRef.current = wayfernConfig;
  }, [wayfernConfig]);

  // On client mount, upgrade default screen lock to the real host display (2K/4K etc.)
  useEffect(() => {
    const host = getHostScreenOverrides();
    setFingerprintOverrides((prev) => {
      const stillFallback =
        prev.screenWidth === FALLBACK_SCREEN_OVERRIDES.screenWidth &&
        prev.screenHeight === FALLBACK_SCREEN_OVERRIDES.screenHeight;
      return stillFallback ? host : prev;
    });
  }, []);

  // Reflect screen (and other) overrides in the form even before a full fingerprint exists
  useEffect(() => {
    setFingerprintConfig((prev) => {
      if (prev.userAgent) return prev; // full sample already drives UI
      return mergeFingerprintOverrides(prev, fingerprintOverrides);
    });
  }, [fingerprintOverrides]);

  // Set the correct client-side detected host OS on mount to prevent SSR hydration fallback to linux
  useEffect(() => {
    setWayfernConfig((prev) => ({
      ...prev,
      os: prev.os || getCurrentOS(),
    }));
  }, []);

  const writeFingerprint = useCallback((config: WayfernFingerprintConfig) => {
    setFingerprintConfig(config);
    try {
      const jsonString = JSON.stringify(config);
      setWayfernConfig((prev) => ({ ...prev, fingerprint: jsonString }));
    } catch (error) {
      console.error("Failed to serialize fingerprint config:", error);
    }
  }, []);

  // Generate a random sample fingerprint inside the UI.
  // Returns the final JSON string (with overrides applied) so callers can use it without waiting for React state.
  const handleGenerateFingerprint = useCallback(
    async (
      currentConfig?: WayfernConfig,
      versionOverride?: string,
    ): Promise<string | null> => {
      const bestVersion = versionOverride
        ? { version: versionOverride, releaseType: "stable" as const }
        : getCreatableVersion("wayfern");
      if (!bestVersion) return null;
      setIsGeneratingFingerprint(true);
      try {
        const configToUse = currentConfig || wayfernConfigRef.current;
        // Do not send partial user fingerprint into generator — always sample fresh, then merge overrides
        const configForGenerate: WayfernConfig = {
          ...configToUse,
          fingerprint: undefined,
        };
        const configJson = JSON.stringify(configForGenerate);
        const result = await invoke<string>("generate_sample_fingerprint", {
          browser: "wayfern",
          version: bestVersion.version,
          configJson,
        });

        let parsed: WayfernFingerprintConfig = {};
        try {
          parsed = JSON.parse(result) as WayfernFingerprintConfig;
        } catch {
          parsed = {};
        }

        const merged = mergeFingerprintOverrides(parsed, overridesRef.current);
        const mergedJson = JSON.stringify(merged);
        setFingerprintConfig(merged);
        setWayfernConfig((prev) => ({
          ...prev,
          ...configToUse,
          fingerprint: mergedJson,
        }));
        toast.success("New sample fingerprint generated successfully");
        return mergedJson;
      } catch (error) {
        console.error("Failed to generate fingerprint:", error);
        toast.error("Failed to generate sample fingerprint");
        return null;
      } finally {
        setIsGeneratingFingerprint(false);
      }
    },
    [getCreatableVersion],
  );

  // Sync fingerprintConfig state with wayfernConfig.fingerprint JSON string
  useEffect(() => {
    if (wayfernConfig.fingerprint) {
      try {
        const parsed = JSON.parse(
          wayfernConfig.fingerprint,
        ) as WayfernFingerprintConfig;
        setFingerprintConfig(
          mergeFingerprintOverrides(parsed, overridesRef.current),
        );
      } catch (error) {
        console.error("Failed to parse fingerprint config:", error);
        setFingerprintConfig(
          mergeFingerprintOverrides({}, overridesRef.current),
        );
      }
    } else {
      setFingerprintConfig(mergeFingerprintOverrides({}, overridesRef.current));
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

  const trackOverrides = (updates: Partial<WayfernFingerprintConfig>) => {
    setFingerprintOverrides((prev) => {
      const next = { ...prev };
      for (const [key, value] of Object.entries(updates)) {
        if (
          value === undefined ||
          value === "" ||
          (Array.isArray(value) && value.length === 0)
        ) {
          delete (next as Record<string, unknown>)[key];
        } else {
          (next as Record<string, unknown>)[key] = value;
        }
      }
      return next;
    });
  };

  const updateFingerprintConfig = (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => {
    const patch = { [key]: value } as Partial<WayfernFingerprintConfig>;
    trackOverrides(patch);

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

    // Keep related screen fields consistent when width/height change alone
    if (
      (key === "screenWidth" || key === "screenHeight") &&
      typeof newConfig.screenWidth === "number" &&
      typeof newConfig.screenHeight === "number"
    ) {
      const locked = applyScreenOverride(
        newConfig,
        newConfig.screenWidth,
        newConfig.screenHeight,
      );
      trackOverrides({
        screenWidth: locked.screenWidth,
        screenHeight: locked.screenHeight,
        screenAvailWidth: locked.screenAvailWidth,
        screenAvailHeight: locked.screenAvailHeight,
        windowOuterWidth: locked.windowOuterWidth,
        windowOuterHeight: locked.windowOuterHeight,
        windowInnerWidth: locked.windowInnerWidth,
        windowInnerHeight: locked.windowInnerHeight,
      });
      writeFingerprint(locked);
      return;
    }

    writeFingerprint(newConfig);
  };

  const updateFingerprintConfigs = (
    updates: Partial<WayfernFingerprintConfig>,
  ) => {
    trackOverrides(updates);

    let newConfig = { ...fingerprintConfig, ...updates };
    for (const [key, value] of Object.entries(updates)) {
      if (
        value === undefined ||
        value === "" ||
        (Array.isArray(value) && value.length === 0)
      ) {
        delete (newConfig as Record<string, unknown>)[key];
      }
    }

    if (
      typeof updates.screenWidth === "number" &&
      typeof updates.screenHeight === "number"
    ) {
      newConfig = applyScreenOverride(
        newConfig,
        updates.screenWidth,
        updates.screenHeight,
      );
      trackOverrides({
        screenWidth: newConfig.screenWidth,
        screenHeight: newConfig.screenHeight,
        screenAvailWidth: newConfig.screenAvailWidth,
        screenAvailHeight: newConfig.screenAvailHeight,
        windowOuterWidth: newConfig.windowOuterWidth,
        windowOuterHeight: newConfig.windowOuterHeight,
        windowInnerWidth: newConfig.windowInnerWidth,
        windowInnerHeight: newConfig.windowInnerHeight,
      });
    }

    if (typeof updates.language === "string" && updates.language) {
      newConfig = applyLanguageOverride(
        newConfig,
        updates.language,
        updates.languages,
      );
    }

    writeFingerprint(newConfig);
  };

  const handleAutoLocationToggle = (enabled: boolean) => {
    updateWayfernConfig("geoip", enabled);
  };

  /** Fixed browser language — independent of geoip location language. */
  const handleFixedLanguageToggle = (enabled: boolean) => {
    setFixedLanguageEnabled(enabled);
    if (enabled) {
      const lang = fixedLanguage || "en-US";
      const base = lang.split("-")[0] || lang;
      const languages = [lang, base];
      setFixedLanguage(lang);
      updateFingerprintConfigs({ language: lang, languages });
    } else {
      // Unlock: stop forcing language on regenerate; keep current values until next generate
      setFingerprintOverrides((prev) => {
        const next = { ...prev };
        delete next.language;
        delete next.languages;
        return next;
      });
    }
  };

  const handleFixedLanguageChange = (language: string) => {
    setFixedLanguage(language);
    if (!fixedLanguageEnabled) return;
    const base = language.split("-")[0] || language;
    updateFingerprintConfigs({
      language,
      languages: [language, base],
    });
  };

  const isAutoLocationEnabled = wayfernConfig.geoip !== false;

  const isFingerprintEditingDisabled =
    wayfernConfig.randomize_fingerprint_on_launch === true;

  const resetWayfernState = useCallback((os?: WayfernOS) => {
    setWayfernConfig({ os: os || getCurrentOS() });
    setFingerprintConfig({});
    // Re-read host screen on reset (user may have moved to another monitor)
    setFingerprintOverrides(getHostScreenOverrides());
    setFixedLanguageEnabled(false);
    setFixedLanguage("en-US");
  }, []);

  /**
   * Build the final WayfernConfig for profile creation.
   * Ensures a full fingerprint exists (generates if needed) and applies user overrides.
   */
  const buildFinalWayfernConfig = useCallback(
    async (version?: string): Promise<WayfernConfig | null> => {
      const current = wayfernConfigRef.current;
      let fingerprintJson = current.fingerprint;

      const hasUserAgent =
        fingerprintJson &&
        (() => {
          try {
            const parsed = JSON.parse(
              fingerprintJson,
            ) as WayfernFingerprintConfig;
            return Boolean(parsed.userAgent);
          } catch {
            return false;
          }
        })();

      // Incomplete/partial fingerprint (e.g. only screen fields) must be regenerated
      if (!hasUserAgent) {
        fingerprintJson =
          (await handleGenerateFingerprint(current, version)) ?? undefined;
      } else if (Object.keys(overridesRef.current).length > 0) {
        try {
          const parsed = JSON.parse(
            fingerprintJson as string,
          ) as WayfernFingerprintConfig;
          const merged = mergeFingerprintOverrides(
            parsed,
            overridesRef.current,
          );
          fingerprintJson = JSON.stringify(merged);
          writeFingerprint(merged);
        } catch {
          fingerprintJson =
            (await handleGenerateFingerprint(current, version)) ?? undefined;
        }
      }

      if (!fingerprintJson) return null;

      return {
        ...current,
        fingerprint: fingerprintJson,
      };
    },
    [handleGenerateFingerprint, writeFingerprint],
  );

  return {
    wayfernConfig,
    fingerprintConfig,
    fingerprintOverrides,
    isGeneratingFingerprint,
    fixedLanguageEnabled,
    fixedLanguage,
    updateWayfernConfig,
    updateFingerprintConfig,
    updateFingerprintConfigs,
    handleGenerateFingerprint,
    handleAutoLocationToggle,
    handleFixedLanguageToggle,
    handleFixedLanguageChange,
    isAutoLocationEnabled,
    isFingerprintEditingDisabled,
    setWayfernConfig,
    resetWayfernState,
    buildFinalWayfernConfig,
  };
}
