import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export interface StorageValidationResult {
  is_valid: boolean;
  error: string | null;
  warnings: string[];
  absolute_path: string | null;
}

export interface StorageInfo {
  is_custom: boolean;
  current_path: string;
  default_path: string;
  custom_path: string | null;
}

interface UseStorageSettingsReturn {
  currentPath: string | null;
  defaultPath: string | null;
  customPath: string | null;
  isCustomActive: boolean;
  validationResult: StorageValidationResult | null;
  isValidating: boolean;
  needsRestart: boolean;
  validatePath: (path: string) => Promise<StorageValidationResult>;
  setCustomPath: (path: string) => Promise<void>;
  resetPath: () => Promise<void>;
  refreshSettings: () => Promise<void>;
}

export function useStorageSettings(): UseStorageSettingsReturn {
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [validationResult, setValidationResult] =
    useState<StorageValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [needsRestart, setNeedsRestart] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      const info = await invoke<StorageInfo>("get_storage_info");
      setStorageInfo(info);
    } catch (error) {
      console.error("Failed to load storage settings:", error);
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
  }, [refreshSettings]);

  const validatePath = useCallback(async (path: string) => {
    setIsValidating(true);
    try {
      const result = await invoke<StorageValidationResult>(
        "validate_custom_storage_path",
        { path },
      );
      setValidationResult(result);
      return result;
    } catch (error) {
      const errorResult: StorageValidationResult = {
        is_valid: false,
        error: error instanceof Error ? error.message : String(error),
        warnings: [],
        absolute_path: null,
      };
      setValidationResult(errorResult);
      return errorResult;
    } finally {
      setIsValidating(false);
    }
  }, []);

  const setCustomPath = useCallback(
    async (path: string) => {
      try {
        const result = await invoke<StorageValidationResult>(
          "set_custom_storage_path",
          { path },
        );

        if (result.is_valid) {
          setNeedsRestart(true);
          await refreshSettings();
        } else {
          setValidationResult(result);
          throw new Error(result.error || "Validation failed");
        }
      } catch (error) {
        console.error("Failed to set custom storage path:", error);
        throw error;
      }
    },
    [refreshSettings],
  );

  const resetPath = useCallback(async () => {
    try {
      await invoke("clear_custom_storage_path");
      setNeedsRestart(true);
      setValidationResult(null);
      await refreshSettings();
    } catch (error) {
      console.error("Failed to reset storage path:", error);
      throw error;
    }
  }, [refreshSettings]);

  return {
    currentPath: storageInfo?.current_path || null,
    defaultPath: storageInfo?.default_path || null,
    customPath: storageInfo?.custom_path || null,
    isCustomActive: storageInfo?.is_custom || false,
    validationResult,
    isValidating,
    needsRestart,
    validatePath,
    setCustomPath,
    resetPath,
    refreshSettings,
  };
}
