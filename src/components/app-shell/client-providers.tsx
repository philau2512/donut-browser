"use client";

import { MotionConfig } from "motion/react";
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
        {/* reducedMotion="user" makes every motion/react animation honor the
            OS prefers-reduced-motion setting: transforms are skipped, opacity
            cross-fades are kept. The CSS-side media query in globals.css only
            covers CSS transitions — this covers the JS-driven ones. */}
        <MotionConfig reducedMotion="user">
          <WindowDragArea />
          <TooltipProvider>
            <OnboardingProvider>{children}</OnboardingProvider>
          </TooltipProvider>
          <Toaster />
        </MotionConfig>
      </CustomThemeProvider>
    </I18nProvider>
  );
}
