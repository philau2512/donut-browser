"use client";

import { open } from "@tauri-apps/plugin-dialog";
import { AlertCircle, CheckCircle2, FolderOpen, HardDrive } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useStorageSettings } from "@/hooks/use-storage-settings";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { RestartBanner } from "../restart-banner";

export function StorageSettings() {
  const { t } = useTranslation();
  const {
    currentPath,
    defaultPath,
    isCustomActive,
    validationResult,
    isValidating,
    needsRestart,
    validatePath,
    setCustomPath,
    resetPath,
  } = useStorageSettings();

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [showRestartBanner, setShowRestartBanner] = useState(false);

  const handleChooseDirectory = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        defaultPath: currentPath || undefined,
      });

      if (selected && typeof selected === "string") {
        setSelectedPath(selected);
        await validatePath(selected);
      }
    } catch (error) {
      console.error("Failed to open directory picker:", error);
      showErrorToast(
        t("settings.storage.picker_error", "Failed to open directory picker"),
      );
    }
  };

  const handleApply = async () => {
    if (!selectedPath || !validationResult?.is_valid) {
      return;
    }

    try {
      await setCustomPath(selectedPath);
      setShowRestartBanner(true);
      showSuccessToast(
        t(
          "settings.storage.apply_success",
          "Storage location updated. Please restart to apply changes.",
        ),
      );
    } catch (error) {
      showErrorToast(
        t(
          "settings.storage.apply_error",
          error instanceof Error
            ? error.message
            : "Failed to apply storage path",
        ),
      );
    }
  };

  const handleReset = async () => {
    try {
      await resetPath();
      setSelectedPath(null);
      setShowRestartBanner(true);
      showSuccessToast(
        t(
          "settings.storage.reset_success",
          "Storage location reset to default. Please restart to apply changes.",
        ),
      );
    } catch (_error) {
      showErrorToast(
        t("settings.storage.reset_error", "Failed to reset storage path"),
      );
    }
  };

  return (
    <div className="space-y-4">
      <RestartBanner
        show={showRestartBanner || needsRestart}
        onDismiss={() => setShowRestartBanner(false)}
      />

      <div className="flex items-center gap-2">
        <HardDrive className="h-5 w-5" />
        <Label className="text-base font-medium">
          {t("settings.storage.title", "Storage Location")}
        </Label>
      </div>

      <p className="text-sm text-muted-foreground">
        {t(
          "settings.storage.description",
          "Choose where browser profiles are stored. Existing profiles will remain in their current location.",
        )}
      </p>

      <div className="space-y-3">
        <div className="grid gap-2">
          <Label className="text-sm">
            {t("settings.storage.current_path", "Current Storage Location")}
          </Label>
          <div className="rounded-md bg-muted p-3 font-mono text-xs break-all">
            {currentPath || t("settings.storage.loading", "Loading...")}
          </div>
        </div>

        {defaultPath && isCustomActive && (
          <div className="grid gap-2">
            <Label className="text-sm text-muted-foreground">
              {t("settings.storage.default_path", "Default Location")}
            </Label>
            <div className="rounded-md bg-muted/50 p-3 font-mono text-xs break-all text-muted-foreground">
              {defaultPath}
            </div>
          </div>
        )}

        {selectedPath && (
          <div className="grid gap-2">
            <Label className="text-sm">
              {t("settings.storage.selected_path", "Selected Path")}
            </Label>
            <div className="rounded-md border p-3 font-mono text-xs break-all">
              {selectedPath}
            </div>
          </div>
        )}

        {validationResult && selectedPath && (
          <div className="space-y-2">
            {validationResult.error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  {validationResult.error}
                </AlertDescription>
              </Alert>
            )}

            {validationResult.is_valid && (
              <Alert className="border-green-500/50 bg-green-500/10">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <AlertDescription className="text-sm text-green-700 dark:text-green-400">
                  {t(
                    "settings.storage.validation_success",
                    "Path is valid and ready to use",
                  )}
                </AlertDescription>
              </Alert>
            )}

            {validationResult.warnings.length > 0 && (
              <Alert className="border-yellow-500/50 bg-yellow-500/10">
                <AlertCircle className="h-4 w-4 text-yellow-500" />
                <AlertDescription className="space-y-1">
                  {validationResult.warnings.map((warning, idx) => (
                    <div
                      key={idx}
                      className="text-sm text-yellow-700 dark:text-yellow-400"
                    >
                      {warning}
                    </div>
                  ))}
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleChooseDirectory}
            disabled={isValidating}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("settings.storage.choose_directory", "Choose Directory")}
          </Button>

          {selectedPath && validationResult?.is_valid && (
            <Button onClick={handleApply} disabled={isValidating}>
              {t("settings.storage.apply", "Apply Changes")}
            </Button>
          )}

          {isCustomActive && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isValidating}
            >
              {t("settings.storage.reset", "Reset to Default")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
