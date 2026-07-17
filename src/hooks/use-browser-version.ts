"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import { useBrowserDownload } from "@/hooks/use-browser-download";

/**
 * Custom hook for browser version fetching, download tracking, and creatable version resolution.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 */
export function useBrowserVersion() {
  const [releaseTypesMap, setReleaseTypesMap] = useState<Record<string, any>>(
    {},
  );
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
        if (rawReleaseTypes.nightly) filtered.nightly = rawReleaseTypes.nightly;
        setReleaseTypesMap((prev) => ({ ...prev, [browser]: filtered }));
      } catch (error) {
        console.error(`Failed to load release types for ${browser}:`, error);
        try {
          const downloaded = await loadDownloadedVersions(browser);
          if (downloaded.length > 0) {
            const fallback: any = {};
            fallback.stable = downloaded[0];
            setReleaseTypesMap((prev) => ({ ...prev, [browser]: fallback }));
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
    (browserStr?: string) => {
      const key = browserStr || "wayfern";
      const releaseTypes = releaseTypesMap[key];
      if (!releaseTypes) return null;
      if (releaseTypes.stable) {
        return { version: releaseTypes.stable, releaseType: "stable" as const };
      }
      if (releaseTypes.nightly) {
        return {
          version: releaseTypes.nightly,
          releaseType: "nightly" as const,
        };
      }
      return null;
    },
    [releaseTypesMap],
  );

  /** All downloaded versions for a browser (newest-first when possible). */
  const getDownloadedVersions = useCallback(
    (browserType?: string): string[] => {
      const key = browserType ?? "wayfern";
      return downloadedVersionsMap[key] ?? [];
    },
    [downloadedVersionsMap],
  );

  /**
   * Resolve which version can be used to create a profile.
   * Prefer explicit selection if provided and downloaded; else latest downloaded / best available.
   */
  const getCreatableVersion = useCallback(
    (browserType?: string, preferredVersion?: string | null) => {
      const key = browserType ?? "wayfern";
      const browserDownloaded = downloadedVersionsMap[key] ?? [];

      if (preferredVersion && browserDownloaded.includes(preferredVersion)) {
        return {
          version: preferredVersion,
          releaseType: "stable" as const,
        };
      }

      const bestVersion = getBestAvailableVersion(browserType);
      if (bestVersion && isVersionDownloaded(bestVersion.version)) {
        return bestVersion;
      }
      if (browserDownloaded.length > 0) {
        return {
          version: browserDownloaded[0],
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
    getDownloadedVersions,
    isBrowserCurrentlyDownloading,
    loadReleaseTypes,
    downloadBrowser,
    getBestAvailableVersion,
    downloadedVersionsMap,
  };
}
