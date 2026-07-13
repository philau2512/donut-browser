"use client";

import { AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

interface RestartBannerProps {
  show: boolean;
  onDismiss?: () => void;
}

export function RestartBanner({ show, onDismiss }: RestartBannerProps) {
  const { t } = useTranslation();

  if (!show) return null;

  const handleRestart = () => {
    // Show instruction to restart manually since we don't have process plugin
    if (
      confirm(
        t(
          "settings.storage.restart_confirm",
          "Please close and restart the application to apply storage location changes. Close now?",
        ),
      )
    ) {
      // Try to close the window
      window.close();
    }
  };

  return (
    <Alert className="mb-4 border-orange-500/50 bg-orange-500/10">
      <AlertCircle className="h-4 w-4 text-orange-500" />
      <AlertTitle className="text-orange-500">
        {t("settings.storage.restart_required", "Restart Required")}
      </AlertTitle>
      <AlertDescription className="mt-2 flex items-center justify-between">
        <span className="text-sm">
          {t(
            "settings.storage.restart_message",
            "Storage location change will take effect after restarting the application.",
          )}
        </span>
        <div className="ml-4 flex gap-2">
          {onDismiss && (
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              {t("common.later", "Later")}
            </Button>
          )}
          <Button variant="default" size="sm" onClick={handleRestart}>
            {t("settings.storage.restart_now", "Restart Now")}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
