"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { useCallback, useEffect, useState } from "react";
import { showErrorToast } from "@/lib/toast-utils";

interface PendingUrl {
  id: string;
  url: string;
}

interface UsePageStartupProps {
  setPendingUrls: React.Dispatch<React.SetStateAction<PendingUrl[]>>;
  setCreateProfileDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentPage: string;
  isInitialized: boolean;
  firstRunOnboarding: boolean | null;
  t: (key: string) => string;
}

export function usePageStartup({
  setPendingUrls,
  setCreateProfileDialogOpen,
  currentPage,
  isInitialized,
  firstRunOnboarding,
  t,
}: UsePageStartupProps) {
  const checkMissingBinaries = useCallback(async () => {
    try {
      const missingBinaries = await invoke<[string, string, string][]>(
        "check_missing_binaries",
      );
      const missingGeoIP = await invoke<boolean>(
        "check_missing_geoip_database",
      );

      if (missingBinaries.length > 0 || missingGeoIP) {
        const browserMap = new Map<string, string[]>();
        for (const [profileName, browser, version] of missingBinaries) {
          if (!browserMap.has(browser)) {
            browserMap.set(browser, []);
          }
          const versions = browserMap.get(browser);
          if (versions) {
            versions.push(`${version} (for ${profileName})`);
          }
        }

        try {
          await invoke("ensure_all_binaries_exist");
        } catch (downloadError) {
          console.error(
            "Failed to download missing components:",
            downloadError,
          );
        }
      }
    } catch (err: unknown) {
      console.error("Failed to check missing components:", err);
    }
  }, []);

  const [processingUrls, setProcessingUrls] = useState<Set<string>>(new Set());

  const handleUrlOpen = useCallback(
    (url: string) => {
      if (processingUrls.has(url)) return;
      setProcessingUrls((prev) => new Set(prev).add(url));
      try {
        setPendingUrls([{ id: Date.now().toString(), url }]);
      } finally {
        setTimeout(() => {
          setProcessingUrls((prev) => {
            const next = new Set(prev);
            next.delete(url);
            return next;
          });
        }, 1000);
      }
    },
    [processingUrls, setPendingUrls],
  );

  const [hasCheckedStartupUrl, setHasCheckedStartupUrl] = useState(false);
  const checkCurrentUrl = useCallback(async () => {
    if (hasCheckedStartupUrl) return;
    try {
      const currentUrl = await getCurrent();
      if (currentUrl && currentUrl.length > 0) {
        handleUrlOpen(currentUrl[0]);
      }
    } catch (error) {
      console.error("Failed to check current URL:", error);
    } finally {
      setHasCheckedStartupUrl(true);
    }
  }, [handleUrlOpen, hasCheckedStartupUrl]);

  const listenForUrlEvents = useCallback(async () => {
    const unlisteners: Array<() => void> = [];
    let handleLogoUrlEvent: ((event: CustomEvent) => void) | undefined;
    const teardown = () => {
      for (const unlisten of unlisteners) unlisten();
      if (handleLogoUrlEvent) {
        window.removeEventListener(
          "url-open-request",
          handleLogoUrlEvent as EventListener,
        );
      }
    };

    try {
      unlisteners.push(
        await listen<string>("url-open-request", (event) => {
          handleUrlOpen(event.payload);
        }),
      );
      unlisteners.push(
        await listen<string>("show-profile-selector", (event) => {
          handleUrlOpen(event.payload);
        }),
      );
      unlisteners.push(
        await listen<string>("show-create-profile-dialog", (_event) => {
          showErrorToast(t("errors.noProfilesForUrl"));
          setCreateProfileDialogOpen(true);
        }),
      );

      handleLogoUrlEvent = (event: CustomEvent) => {
        handleUrlOpen(event.detail);
      };
      window.addEventListener(
        "url-open-request",
        handleLogoUrlEvent as EventListener,
      );

      return teardown;
    } catch (error) {
      console.error("Failed to setup URL listener:", error);
      teardown();
    }
  }, [handleUrlOpen, setCreateProfileDialogOpen, t]);

  useEffect(() => {
    let teardown: (() => void) | undefined;
    void listenForUrlEvents().then((t) => {
      teardown = t;
    });
    return () => {
      teardown?.();
    };
  }, [listenForUrlEvents]);

  useEffect(() => {
    if (
      currentPage === "profiles" &&
      isInitialized &&
      firstRunOnboarding === false
    ) {
      void checkCurrentUrl();
      void checkMissingBinaries();
    }
  }, [
    currentPage,
    isInitialized,
    firstRunOnboarding,
    checkCurrentUrl,
    checkMissingBinaries,
  ]);
}
