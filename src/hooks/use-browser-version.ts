"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { useBrowserDownload } from "@/hooks/use-browser-download";

/**
 * Custom hook for browser version fetching, download tracking, and creatable version resolution.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 */
export function useBrowserVersion() {
  const [releaseTypes, setReleaseTypes] = useState<any>({});
  const [isLoadingReleaseTypes, setIsLoadingReleaseTypes] = useState(false);
  const [_releaseTypesError, setReleaseTypesError] = useState<string | null>(
    null,
  );

  const {
    isBrowserDownloading,
    downloadBrowser,
    loadDownloadedVersions,
    isVersionDownloaded,
    downloadedVersionsMap,
  } = useBrowserDownload();

  const loadReleaseTypes = useCallback(
    async (browser: string) => {
      setIsLoadingReleaseTypes(true);
      setReleaseTypesError(null);

      try {
        const rawReleaseTypes = await invoke<any>("get_browser_release_types", {
          browserStr: browser,
        });

        await loadDownloadedVersions(browser);

        const filtered: any = {};
        if (rawReleaseTypes.stable) filtered.stable = rawReleaseTypes.stable;
        setReleaseTypes(filtered);
      } catch (error) {
        console.error(`Failed to load release types for ${browser}:`, error);
        try {
          const downloaded = await loadDownloadedVersions(browser);
          if (downloaded.length > 0) {
            const fallback: any = {};
            fallback.stable = downloaded[0];
            setReleaseTypes(fallback);
          } else {
            setReleaseTypesError(
              "Failed to fetch browser versions. Please check your internet connection.",
            );
          }
        } catch (_e) {
          setReleaseTypesError(
            "Failed to fetch browser versions. Please check your internet connection.",
          );
        }
      } finally {
        setIsLoadingReleaseTypes(false);
      }
    },
    [loadDownloadedVersions],
  );

  const getBestAvailableVersion = useCallback(
    (_browserStr?: string) => {
      if (!releaseTypes) return null;
      if (releaseTypes.stable) {
        return { version: releaseTypes.stable, releaseType: "stable" as const };
      }
      return null;
    },
    [releaseTypes],
  );

  const getCreatableVersion = useCallback(
    (browserType?: string) => {
      const bestVersion = getBestAvailableVersion(browserType);
      if (bestVersion && isVersionDownloaded(bestVersion.version)) {
        return bestVersion;
      }
      const browserDownloaded = downloadedVersionsMap[browserType ?? ""] ?? [];
      if (browserDownloaded.length > 0) {
        const fallbackVersion = browserDownloaded[0];
        return {
          version: fallbackVersion,
          releaseType: "stable" as const,
        };
      }
      return null;
    },
    [getBestAvailableVersion, isVersionDownloaded, downloadedVersionsMap],
  );

  const isBrowserCurrentlyDownloading = useCallback(
    (browserStr: string) => {
      return isBrowserDownloading(browserStr);
    },
    [isBrowserDownloading],
  );

  return {
    isLoadingReleaseTypes,
    getCreatableVersion,
    isBrowserCurrentlyDownloading,
    loadReleaseTypes,
    downloadBrowser,
    getBestAvailableVersion,
  };
}
