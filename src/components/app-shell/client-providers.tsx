"use client";

import { useEffect } from "react";
import { OnboardingProvider } from "@/components/onboarding";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setupLogging } from "@/lib/logger";
import { I18nProvider } from "./i18n-provider";
import { CustomThemeProvider } from "./theme-provider";
import { WindowDragArea } from "./window-drag-area";

export function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    void setupLogging();
  }, []);

  return (
    <I18nProvider>
      <CustomThemeProvider>
        <WindowDragArea />
        <TooltipProvider>
          <OnboardingProvider>{children}</OnboardingProvider>
        </TooltipProvider>
        <Toaster />
      </CustomThemeProvider>
    </I18nProvider>
  );
}
