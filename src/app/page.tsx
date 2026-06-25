"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrent } from "@tauri-apps/plugin-deep-link";
import { useOnborda } from "onborda";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Settings
import { ExtensionManagementDialog } from "@/components/extension";
import { GroupManagementDialog } from "@/components/group";
// Home
import { HomeHeader, ProfilesDataTable } from "@/components/home";
import type { AppPage } from "@/components/navigation";
// Navigation
import { RailNav } from "@/components/navigation";
// Onboarding
import { ONBOARDING_TOUR } from "@/components/onboarding";
import type { PasswordDialogMode } from "@/components/profile";
// Profile
import { ImportProfileDialog } from "@/components/profile";
import { CamoufoxDeprecationDialog } from "@/components/profile/camoufox";
// Proxy
import { ProxyManagementDialog } from "@/components/proxy";
import {
  IntegrationsDialog,
  SettingsDialog,
  ShortcutsPage,
} from "@/components/settings";
// Shared
import { CloseConfirmDialog } from "@/components/shared";
// Sync
import { AccountPage } from "@/components/sync";
import { useAppUpdateNotifications } from "@/hooks/use-app-update-notifications";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useCommercialTrial } from "@/hooks/use-commercial-trial";
import { useGroupEvents } from "@/hooks/use-group-events";
import type { PermissionType } from "@/hooks/use-permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { useProfileEvents } from "@/hooks/use-profile-events";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useSyncSessions } from "@/hooks/use-sync-session";
import { useUpdateNotifications } from "@/hooks/use-update-notifications";
import { useVersionUpdater } from "@/hooks/use-version-updater";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { useWayfernTerms } from "@/hooks/use-wayfern-terms";
import { translateBackendError } from "@/lib/backend-errors";
import { getEntitlements } from "@/lib/entitlements";
import {
  ONBOARDING_TOUR_FINISHED_EVENT,
  setOnboardingActive,
} from "@/lib/onboarding-signal";
import {
  matchesGroupDigit,
  matchesShortcut,
  SHORTCUTS,
  type ShortcutId,
} from "@/lib/shortcuts";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type {
  BrowserProfile,
  CamoufoxConfig,
  SyncSettings,
  WayfernConfig,
} from "@/types";

// Import HomeDialogs
import { HomeDialogs } from "./home-dialogs";

type BrowserTypeString = "camoufox" | "wayfern";

interface PendingUrl {
  id: string;
  url: string;
}

interface PendingBulkAction {
  action: "run" | "stop";
  profiles: BrowserProfile[];
}

export default function Home() {
  const { t } = useTranslation();
  useVersionUpdater();

  const {
    profiles,
    runningProfiles,
    isLoading: profilesLoading,
    error: profilesError,
  } = useProfileEvents();

  const { startOnborda, setCurrentStep, isOnbordaVisible, currentStep } =
    useOnborda();
  const onboardingHandledRef = useRef(false);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const [thankYouOpen, setThankYouOpen] = useState(false);
  const [firstRunOnboarding, setFirstRunOnboarding] = useState<boolean | null>(
    null,
  );

  const handleWelcomeComplete = useCallback(() => {
    setWelcomeOpen(false);
    setFirstRunOnboarding(false);
    if (profiles.length === 0) {
      startOnborda(ONBOARDING_TOUR);
    }
  }, [startOnborda, profiles.length]);

  useEffect(() => {
    const handler = () => setThankYouOpen(true);
    window.addEventListener(ONBOARDING_TOUR_FINISHED_EVENT, handler);
    return () =>
      window.removeEventListener(ONBOARDING_TOUR_FINISHED_EVENT, handler);
  }, []);

  useEffect(() => {
    setOnboardingActive(welcomeOpen || isOnbordaVisible);
  }, [welcomeOpen, isOnbordaVisible]);

  useEffect(() => {
    if (!isOnbordaVisible) return;
    const pin = () => {
      if (document.body.scrollLeft !== 0) document.body.scrollLeft = 0;
      if (document.documentElement.scrollLeft !== 0)
        document.documentElement.scrollLeft = 0;
    };
    pin();
    window.addEventListener("scroll", pin, true);
    return () => window.removeEventListener("scroll", pin, true);
  }, [isOnbordaVisible]);

  useEffect(() => {
    if (profilesLoading || onboardingHandledRef.current) return;
    onboardingHandledRef.current = true;
    void (async () => {
      try {
        const completed = await invoke<boolean>("get_onboarding_completed");
        if (completed) {
          setFirstRunOnboarding(false);
          return;
        }
        await invoke("complete_onboarding");
        setFirstRunOnboarding(true);
        setWelcomeOpen(true);
      } catch (err) {
        console.error("Onboarding init failed:", err);
        setFirstRunOnboarding(false);
      }
    })();
  }, [profilesLoading]);

  useEffect(() => {
    if (isOnbordaVisible && currentStep === 0 && profiles.length > 0) {
      setCurrentStep(1, 300);
    }
  }, [isOnbordaVisible, currentStep, profiles.length, setCurrentStep]);

  const {
    groups: groupsData,
    isLoading: groupsLoading,
    error: groupsError,
  } = useGroupEvents();

  const {
    storedProxies,
    isLoading: proxiesLoading,
    error: proxiesError,
  } = useProxyEvents();

  const { vpnConfigs } = useVpnEvents();

  const { getProfileSyncInfo } = useSyncSessions();
  const [syncLeaderProfile, setSyncLeaderProfile] =
    useState<BrowserProfile | null>(null);

  const {
    termsAccepted,
    isLoading: termsLoading,
    checkTerms,
  } = useWayfernTerms();
  const {
    trialStatus,
    hasAcknowledged: trialAcknowledged,
    checkTrialStatus,
  } = useCommercialTrial();

  const { user: cloudUser } = useCloudAuth();
  const crossOsUnlocked = getEntitlements(cloudUser).crossOsFingerprints;
  const automationUnlocked = getEntitlements(cloudUser).browserAutomation;

  const [selfHostedSyncConfigured, setSelfHostedSyncConfigured] =
    useState(false);

  const checkSelfHostedSync = useCallback(async () => {
    try {
      const settings = await invoke<SyncSettings>("get_sync_settings");
      const hasConfig = Boolean(
        settings.sync_server_url && settings.sync_token,
      );
      setSelfHostedSyncConfigured(hasConfig && !cloudUser);
    } catch {
      setSelfHostedSyncConfigured(false);
    }
  }, [cloudUser]);

  const syncUnlocked = crossOsUnlocked || selfHostedSyncConfigured;

  const [currentPage, setCurrentPage] = useState<AppPage>("profiles");
  const [accountDialogOpen, setAccountDialogOpen] = useState(false);
  const [proxyManagementInitialTab, setProxyManagementInitialTab] = useState<
    "proxies" | "vpns"
  >("proxies");
  const [extensionManagementInitialTab, setExtensionManagementInitialTab] =
    useState<"extensions" | "groups">("extensions");
  const [integrationsInitialTab, setIntegrationsInitialTab] = useState<
    "api" | "mcp"
  >("api");
  const [createProfileDialogOpen, setCreateProfileDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [integrationsDialogOpen, setIntegrationsDialogOpen] = useState(false);
  const [importProfileDialogOpen, setImportProfileDialogOpen] = useState(false);
  const [proxyManagementDialogOpen, setProxyManagementDialogOpen] =
    useState(false);
  const [camoufoxConfigDialogOpen, setCamoufoxConfigDialogOpen] =
    useState(false);
  const [groupManagementDialogOpen, setGroupManagementDialogOpen] =
    useState(false);
  const [extensionManagementDialogOpen, setExtensionManagementDialogOpen] =
    useState(false);
  const [groupAssignmentDialogOpen, setGroupAssignmentDialogOpen] =
    useState(false);
  const [
    extensionGroupAssignmentDialogOpen,
    setExtensionGroupAssignmentDialogOpen,
  ] = useState(false);
  const [
    selectedProfilesForExtensionGroup,
    setSelectedProfilesForExtensionGroup,
  ] = useState<string[]>([]);
  const [proxyAssignmentDialogOpen, setProxyAssignmentDialogOpen] =
    useState(false);
  const [cookieCopyDialogOpen, setCookieCopyDialogOpen] = useState(false);
  const [cookieManagementDialogOpen, setCookieManagementDialogOpen] =
    useState(false);
  const [
    currentProfileForCookieManagement,
    setCurrentProfileForCookieManagement,
  ] = useState<BrowserProfile | null>(null);
  const [selectedProfilesForCookies, setSelectedProfilesForCookies] = useState<
    string[]
  >([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("__all__");
  const [selectedProfilesForGroup, setSelectedProfilesForGroup] = useState<
    string[]
  >([]);
  const [selectedProfilesForProxy, setSelectedProfilesForProxy] = useState<
    string[]
  >([]);
  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [pendingUrls, setPendingUrls] = useState<PendingUrl[]>([]);
  const [currentProfileForCamoufoxConfig, setCurrentProfileForCamoufoxConfig] =
    useState<BrowserProfile | null>(null);
  const [cloneProfile, setCloneProfile] = useState<BrowserProfile | null>(null);
  const [passwordDialogProfile, setPasswordDialogProfile] =
    useState<BrowserProfile | null>(null);
  const [passwordDialogMode, setPasswordDialogMode] =
    useState<PasswordDialogMode>("set");
  const pendingLaunchAfterUnlockRef = useRef<BrowserProfile | null>(null);
  const [windowResizeWarningOpen, setWindowResizeWarningOpen] = useState(false);
  const [windowResizeWarningBrowserType, setWindowResizeWarningBrowserType] =
    useState<string | undefined>(undefined);
  const windowResizeWarningResolver = useRef<
    ((proceed: boolean) => void) | null
  >(null);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [currentPermissionType, setCurrentPermissionType] =
    useState<PermissionType>("microphone");
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] =
    useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [syncConfigDialogOpen, setSyncConfigDialogOpen] = useState(false);
  const [deviceCodeDialogOpen, setDeviceCodeDialogOpen] = useState(false);
  const [syncAllDialogOpen, setSyncAllDialogOpen] = useState(false);
  const [profileSyncDialogOpen, setProfileSyncDialogOpen] = useState(false);
  const [currentProfileForSync, setCurrentProfileForSync] =
    useState<BrowserProfile | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [profileInfoDialog, setProfileInfoDialog] =
    useState<BrowserProfile | null>(null);
  const { isMicrophoneAccessGranted, isCameraAccessGranted, isInitialized } =
    usePermissions();

  // Bulk action state
  const [pendingBulkAction, setPendingBulkAction] =
    useState<PendingBulkAction | null>(null);
  const [isBulkActing, setIsBulkActing] = useState(false);

  const handleSelectGroup = useCallback((groupId: string) => {
    setSelectedGroupId(groupId);
    setSelectedProfiles([]);
  }, []);

  const handleRailNavigate = useCallback((page: AppPage) => {
    setSettingsDialogOpen(false);
    setProxyManagementDialogOpen(false);
    setExtensionManagementDialogOpen(false);
    setGroupManagementDialogOpen(false);
    setIntegrationsDialogOpen(false);
    setImportProfileDialogOpen(false);
    setAccountDialogOpen(false);

    setCurrentPage(page);
    switch (page) {
      case "profiles":
        break;
      case "settings":
        setSettingsDialogOpen(true);
        break;
      case "proxies":
        setProxyManagementInitialTab("proxies");
        setProxyManagementDialogOpen(true);
        break;
      case "extensions":
        setExtensionManagementDialogOpen(true);
        break;
      case "groups":
        setGroupManagementDialogOpen(true);
        break;
      case "integrations":
        setIntegrationsDialogOpen(true);
        break;
      case "import":
        setImportProfileDialogOpen(true);
        break;
      case "vpns":
        setProxyManagementInitialTab("vpns");
        setProxyManagementDialogOpen(true);
        break;
      case "account":
        setAccountDialogOpen(true);
        break;
      case "shortcuts":
        break;
    }
  }, []);

  const runShortcut = useCallback(
    (id: ShortcutId) => {
      switch (id) {
        case "openPalette":
          setCommandPaletteOpen(true);
          break;
        case "openShortcuts":
          handleRailNavigate("shortcuts");
          break;
        case "importProfile":
          handleRailNavigate("import");
          break;
        case "goProfiles":
          handleRailNavigate("profiles");
          break;
        case "goProxies": {
          if (currentPage === "proxies") {
            handleRailNavigate("vpns");
          } else if (currentPage === "vpns") {
            handleRailNavigate("proxies");
          } else {
            handleRailNavigate(
              proxyManagementInitialTab === "vpns" ? "vpns" : "proxies",
            );
          }
          break;
        }
        case "goExtensions": {
          if (currentPage === "extensions") {
            setExtensionManagementInitialTab((cur) =>
              cur === "extensions" ? "groups" : "extensions",
            );
          } else {
            handleRailNavigate("extensions");
          }
          break;
        }
        case "goGroups":
          handleRailNavigate("groups");
          break;
        case "goIntegrations": {
          if (currentPage === "integrations") {
            setIntegrationsInitialTab((cur) => (cur === "api" ? "mcp" : "api"));
          } else {
            handleRailNavigate("integrations");
          }
          break;
        }
        case "goAccount":
          handleRailNavigate("account");
          break;
        case "goSettings":
          handleRailNavigate("settings");
          break;
      }
    },
    [handleRailNavigate, currentPage, proxyManagementInitialTab],
  );

  const orderedGroupTargets = useMemo(
    () => [
      { id: "__all__", name: t("rail.profiles") },
      ...groupsData.map((g) => ({ id: g.id, name: g.name })),
    ],
    [groupsData, t],
  );

  const selectGroupByDigit = useCallback(
    (digit: number) => {
      const target = orderedGroupTargets[digit - 1];
      if (!target) return;
      handleRailNavigate("profiles");
      handleSelectGroup(target.id);
    },
    [orderedGroupTargets, handleRailNavigate, handleSelectGroup],
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const targetElement = e.target as HTMLElement | null;
      const tag = targetElement?.tagName;
      const isTyping =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        targetElement?.isContentEditable === true;

      const digit = matchesGroupDigit(e);
      if (digit !== null) {
        if (isTyping) return;
        if (digit - 1 >= orderedGroupTargets.length) return;
        e.preventDefault();
        selectGroupByDigit(digit);
        return;
      }

      for (const s of SHORTCUTS) {
        if (!matchesShortcut(s, e)) continue;
        if (isTyping && s.id !== "openPalette" && s.id !== "openShortcuts") {
          return;
        }
        e.preventDefault();
        runShortcut(s.id);
        return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [runShortcut, selectGroupByDigit, orderedGroupTargets.length]);

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
    [processingUrls],
  );

  const updateNotifications = useUpdateNotifications();
  const { isUpdating } = updateNotifications;
  useAppUpdateNotifications();

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

  useEffect(() => {
    if (profilesError) showErrorToast(profilesError);
  }, [profilesError]);

  useEffect(() => {
    if (groupsError) showErrorToast(groupsError);
  }, [groupsError]);

  useEffect(() => {
    if (proxiesError) showErrorToast(proxiesError);
  }, [proxiesError]);

  const _checkAllPermissions = useCallback(() => {
    try {
      if (!isInitialized) return;
      if (!isMicrophoneAccessGranted) {
        setCurrentPermissionType("microphone");
        setPermissionDialogOpen(true);
      } else if (!isCameraAccessGranted) {
        setCurrentPermissionType("camera");
        setPermissionDialogOpen(true);
      }
    } catch (error) {
      console.error("Failed to check permissions:", error);
    }
  }, [isMicrophoneAccessGranted, isCameraAccessGranted, isInitialized]);

  const checkNextPermission = useCallback(
    (justGranted?: PermissionType) => {
      try {
        const micGranted =
          isMicrophoneAccessGranted || justGranted === "microphone";
        const camGranted = isCameraAccessGranted || justGranted === "camera";

        if (!micGranted) {
          setCurrentPermissionType("microphone");
          setPermissionDialogOpen(true);
        } else if (!camGranted) {
          setCurrentPermissionType("camera");
          setPermissionDialogOpen(true);
        } else {
          setPermissionDialogOpen(false);
        }
      } catch (error) {
        console.error("Failed to check next permission:", error);
      }
    },
    [isMicrophoneAccessGranted, isCameraAccessGranted],
  );

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
  }, [handleUrlOpen, t]);

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

  const launchProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Starting launch for profile:", profile.name);

      // Password-protected: must be unlocked before launch
      if (profile.password_protected) {
        try {
          const isLocked = await invoke<boolean>("is_profile_locked", {
            profileId: profile.id,
          });
          if (isLocked) {
            pendingLaunchAfterUnlockRef.current = profile;
            setPasswordDialogMode("unlock");
            setPasswordDialogProfile(profile);
            return;
          }
        } catch (err) {
          console.error("Failed to check profile lock state:", err);
        }
      }

      // Show one-time warning about window resizing for fingerprinted browsers
      if (profile.browser === "camoufox" || profile.browser === "wayfern") {
        try {
          const dismissed = await invoke<boolean>(
            "get_window_resize_warning_dismissed",
          );
          if (!dismissed) {
            const proceed = await new Promise<boolean>((resolve) => {
              windowResizeWarningResolver.current = resolve;
              setWindowResizeWarningBrowserType(profile.browser);
              setWindowResizeWarningOpen(true);
            });
            if (!proceed) {
              return;
            }
          }
        } catch (error) {
          console.error("Failed to check window resize warning:", error);
        }
      }

      try {
        const result = await invoke<BrowserProfile>("launch_browser_profile", {
          profile,
        });
        console.log("Successfully launched profile:", result.name);
      } catch (err: unknown) {
        console.error("Failed to launch browser:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(
          t("errors.launchBrowserFailed", { error: errorMessage }),
        );
        throw err;
      }
    },
    [t],
  );

  const handleKillProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Starting kill for profile:", profile.name);

      try {
        await invoke("kill_browser_profile", { profile });
        console.log("Successfully killed profile:", profile.name);
        // No need to manually reload - useProfileEvents will handle the update
      } catch (err: unknown) {
        console.error("Failed to kill browser:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(t("errors.killBrowserFailed", { error: errorMessage }));
        // Re-throw the error so the table component can handle loading state cleanup
        throw err;
      }
    },
    [t],
  );

  const handleCreateProfile = useCallback(
    async (profileData: {
      name: string;
      browserStr: BrowserTypeString;
      version: string;
      releaseType: string;
      proxyId?: string;
      vpnId?: string;
      camoufoxConfig?: CamoufoxConfig;
      wayfernConfig?: WayfernConfig;
      groupId?: string;
      extensionGroupId?: string;
      ephemeral?: boolean;
      dnsBlocklist?: string;
      launchHook?: string;
      password?: string;
    }) => {
      try {
        const profile = await invoke<BrowserProfile>(
          "create_browser_profile_new",
          {
            name: profileData.name,
            browserStr: profileData.browserStr,
            version: profileData.version,
            releaseType: profileData.releaseType,
            proxyId: profileData.proxyId,
            vpnId: profileData.vpnId,
            camoufoxConfig: profileData.camoufoxConfig,
            wayfernConfig: profileData.wayfernConfig,
            groupId:
              profileData.groupId ??
              (selectedGroupId && selectedGroupId !== "__all__"
                ? selectedGroupId
                : undefined),
            ephemeral: profileData.ephemeral,
            dnsBlocklist: profileData.dnsBlocklist,
            launchHook: profileData.launchHook,
          },
        );

        if (profileData.extensionGroupId) {
          try {
            await invoke("assign_extension_group_to_profile", {
              profileId: profile.id,
              extensionGroupId: profileData.extensionGroupId,
            });
          } catch (err) {
            console.error("Failed to assign extension group:", err);
          }
        }

        if (profileData.password && !profileData.ephemeral) {
          try {
            await invoke("set_profile_password", {
              profileId: profile.id,
              password: profileData.password,
            });
          } catch (err) {
            showErrorToast(
              t("errors.setProfilePasswordFailed", {
                error: translateBackendError(t, err),
              }),
            );
          }
        }

        // No need to manually reload - useProfileEvents will handle the update
      } catch (error) {
        showErrorToast(
          t("errors.createProfileFailed", {
            error: translateBackendError(t, error),
          }),
        );
        // Rethrow so the create dialog keeps itself open (its own handler
        // skips closing on error), letting the user fix the proxy/VPN and retry.
        throw error;
      }
    },
    [selectedGroupId, t],
  );

  const handleCloneProfile = useCallback((profile: BrowserProfile) => {
    setCloneProfile(profile);
  }, []);

  const handleSetPassword = useCallback((profile: BrowserProfile) => {
    setPasswordDialogMode("set");
    setPasswordDialogProfile(profile);
  }, []);

  const handleChangePassword = useCallback((profile: BrowserProfile) => {
    setPasswordDialogMode("change");
    setPasswordDialogProfile(profile);
  }, []);

  const handleRemovePassword = useCallback((profile: BrowserProfile) => {
    setPasswordDialogMode("remove");
    setPasswordDialogProfile(profile);
  }, []);

  const handleDeleteProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Attempting to delete profile:", profile.name);

      try {
        // First check if the browser is running for this profile
        const isRunning = await invoke<boolean>("check_browser_status", {
          profile,
        });

        if (isRunning) {
          showErrorToast(t("errors.cannotDeleteRunningProfile"));
          return;
        }

        // Attempt to delete the profile
        await invoke("delete_profile", { profileId: profile.id });
        console.log("Profile deletion command completed successfully");

        // No need to manually reload - useProfileEvents will handle the update
        console.log("Profile deleted successfully");
      } catch (err: unknown) {
        console.error("Failed to delete profile:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(
          t("errors.deleteProfileFailed", { error: errorMessage }),
        );
      }
    },
    [t],
  );

  const handleRenameProfile = useCallback(
    async (profileId: string, name: string) => {
      try {
        await invoke("rename_profile", { profileId, name });
      } catch (err: unknown) {
        console.error("Rename profile failed:", err);
        showErrorToast(translateBackendError(t, err));
      }
    },
    [t],
  );

  const handleConfigureCamoufox = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForCamoufoxConfig(profile);
    setCamoufoxConfigDialogOpen(true);
  }, []);

  const handleCopyCookiesToProfile = useCallback((profile: BrowserProfile) => {
    setSelectedProfilesForCookies([profile.id]);
    setCookieCopyDialogOpen(true);
  }, []);

  const handleOpenCookieManagement = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForCookieManagement(profile);
    setCookieManagementDialogOpen(true);
  }, []);

  const handleSaveCamoufoxConfig = useCallback(
    async (config: CamoufoxConfig) => {
      if (!currentProfileForCamoufoxConfig) return;
      try {
        await invoke("update_camoufox_config", {
          profileId: currentProfileForCamoufoxConfig.id,
          config,
        });
        showSuccessToast(t("camoufoxConfig.savedToast"));
        setCamoufoxConfigDialogOpen(false);
      } catch (err: unknown) {
        showErrorToast(translateBackendError(t, err));
      }
    },
    [currentProfileForCamoufoxConfig, t],
  );

  const handleSaveWayfernConfig = useCallback(
    async (config: WayfernConfig) => {
      if (!currentProfileForCamoufoxConfig) return;
      try {
        await invoke("update_wayfern_config", {
          profileId: currentProfileForCamoufoxConfig.id,
          config,
        });
        showSuccessToast(t("camoufoxConfig.savedToast"));
        setCamoufoxConfigDialogOpen(false);
      } catch (err: unknown) {
        showErrorToast(translateBackendError(t, err));
      }
    },
    [currentProfileForCamoufoxConfig, t],
  );

  const handleDeleteSelectedProfiles = useCallback(
    async (profileIds: string[]) => {
      try {
        await invoke("delete_selected_profiles", { profileIds });
        // No need to manually reload - useProfileEvents will handle the update
      } catch (err: unknown) {
        console.error("Failed to delete selected profiles:", err);
        showErrorToast(
          t("errors.deleteSelectedProfilesFailed", {
            error: JSON.stringify(err),
          }),
        );
      }
    },
    [t],
  );

  const confirmBulkDelete = useCallback(async () => {
    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedProfiles.map((id) =>
          invoke("delete_profile", { profileId: id }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        showSuccessToast(
          t("profiles.bulkDelete.success", { count: succeeded }),
        );
      }
      if (failed > 0) {
        showErrorToast(t("profiles.bulkDelete.failed", { count: failed }));
      }
      setSelectedProfiles([]);
      setShowBulkDeleteConfirmation(false);
    } catch (err: unknown) {
      console.error("Bulk delete failed:", err);
    } finally {
      setIsBulkDeleting(false);
    }
  }, [selectedProfiles, t]);

  const handleAssignProfilesToGroup = useCallback((profileIds: string[]) => {
    setSelectedProfilesForGroup(profileIds);
    setGroupAssignmentDialogOpen(true);
  }, []);

  const handleGroupAssignmentComplete = useCallback(() => {
    setGroupAssignmentDialogOpen(false);
    setSelectedProfilesForGroup([]);
    setSelectedProfiles([]);
  }, []);

  const handleAssignExtensionGroup = useCallback((profileIds: string[]) => {
    setSelectedProfilesForExtensionGroup(profileIds);
    setExtensionGroupAssignmentDialogOpen(true);
  }, []);

  const handleExtensionGroupAssignmentComplete = useCallback(() => {
    setExtensionGroupAssignmentDialogOpen(false);
    setSelectedProfilesForExtensionGroup([]);
    setSelectedProfiles([]);
  }, []);

  const handleAssignProxyToProfiles = useCallback((profileIds: string[]) => {
    setSelectedProfilesForProxy(profileIds);
    setProxyAssignmentDialogOpen(true);
  }, []);

  const handleProxyAssignmentComplete = useCallback(() => {
    setProxyAssignmentDialogOpen(false);
    setSelectedProfilesForProxy([]);
    setSelectedProfiles([]);
  }, []);

  const handleBulkDelete = useCallback(() => {
    setShowBulkDeleteConfirmation(true);
  }, []);

  const handleBulkGroupAssignment = useCallback(() => {
    handleAssignProfilesToGroup(selectedProfiles);
  }, [selectedProfiles, handleAssignProfilesToGroup]);

  const handleBulkProxyAssignment = useCallback(() => {
    handleAssignProxyToProfiles(selectedProfiles);
  }, [selectedProfiles, handleAssignProxyToProfiles]);

  const handleBulkExtensionGroupAssignment = useCallback(() => {
    handleAssignExtensionGroup(selectedProfiles);
  }, [selectedProfiles, handleAssignExtensionGroup]);

  const handleBulkCopyCookies = useCallback(() => {
    setSelectedProfilesForCookies(selectedProfiles);
    setCookieCopyDialogOpen(true);
  }, [selectedProfiles]);

  const executeBulkRun = useCallback(
    async (profilesToRun: BrowserProfile[]) => {
      setIsBulkActing(true);
      try {
        const results = await Promise.allSettled(
          profilesToRun.map((profile) => launchProfile(profile)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          showErrorToast(t("profiles.bulkRun.failedCount", { count: failed }));
        } else {
          showSuccessToast(
            t("profiles.bulkRun.successCount", { count: results.length }),
          );
        }
        setSelectedProfiles([]);
        setPendingBulkAction(null);
      } finally {
        setIsBulkActing(false);
      }
    },
    [launchProfile, t],
  );

  const executeBulkStop = useCallback(
    async (profilesToStop: BrowserProfile[]) => {
      setIsBulkActing(true);
      try {
        const results = await Promise.allSettled(
          profilesToStop.map((profile) => handleKillProfile(profile)),
        );
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed > 0) {
          showErrorToast(t("profiles.bulkStop.failedCount", { count: failed }));
        } else {
          showSuccessToast(
            t("profiles.bulkStop.successCount", { count: results.length }),
          );
        }
        setSelectedProfiles([]);
        setPendingBulkAction(null);
      } finally {
        setIsBulkActing(false);
      }
    },
    [handleKillProfile, t],
  );

  const handleBulkRun = useCallback(() => {
    const list = profiles.filter(
      (p) => selectedProfiles.includes(p.id) && !runningProfiles.has(p.id),
    );
    if (list.length === 0) return;
    setPendingBulkAction({ action: "run", profiles: list });
  }, [profiles, selectedProfiles, runningProfiles]);

  const handleBulkStop = useCallback(() => {
    const list = profiles.filter(
      (p) => selectedProfiles.includes(p.id) && runningProfiles.has(p.id),
    );
    if (list.length === 0) return;
    setPendingBulkAction({ action: "stop", profiles: list });
  }, [profiles, selectedProfiles, runningProfiles]);

  const handleOpenProfileSyncDialog = useCallback((profile: BrowserProfile) => {
    setCurrentProfileForSync(profile);
    setProfileSyncDialogOpen(true);
  }, []);

  const handleToggleProfileSync = useCallback(
    async (profile: BrowserProfile) => {
      const mode = profile.sync_mode === "Disabled" ? "Regular" : "Disabled";
      try {
        await invoke("set_profile_sync_mode", {
          profileId: profile.id,
          syncMode: mode,
        });
        showSuccessToast(
          mode === "Disabled"
            ? t("profiles.sync.disabled")
            : t("profiles.sync.enabled"),
        );
      } catch (err: unknown) {
        showErrorToast(translateBackendError(t, err));
      }
    },
    [t],
  );

  const handleProfilePasswordSuccess = useCallback(
    (p: BrowserProfile) => {
      if (
        passwordDialogMode === "unlock" &&
        pendingLaunchAfterUnlockRef.current?.id === p.id
      ) {
        const target = pendingLaunchAfterUnlockRef.current;
        pendingLaunchAfterUnlockRef.current = null;
        void launchProfile(target);
      }
      if (
        (passwordDialogMode === "set" ||
          passwordDialogMode === "change" ||
          passwordDialogMode === "remove") &&
        !runningProfiles.has(p.id) &&
        p.sync_mode !== "Disabled"
      ) {
        void invoke("request_profile_sync", { profileId: p.id }).catch(
          (err: unknown) => {
            console.error("post-password sync failed", err);
          },
        );
      }
    },
    [passwordDialogMode, runningProfiles, launchProfile],
  );

  const handlePendingBulkActionConfirm = useCallback(() => {
    if (!pendingBulkAction) return;
    if (pendingBulkAction.action === "run") {
      void executeBulkRun(pendingBulkAction.profiles);
    } else {
      void executeBulkStop(pendingBulkAction.profiles);
    }
  }, [pendingBulkAction, executeBulkRun, executeBulkStop]);

  const handleSyncConfigClose = useCallback(
    (loginOccurred?: boolean) => {
      setSyncConfigDialogOpen(false);
      void checkSelfHostedSync();
      if (loginOccurred) {
        setSyncAllDialogOpen(true);
      }
    },
    [checkSelfHostedSync],
  );

  const handleDeviceCodeClose = useCallback((loginOccurred?: boolean) => {
    setDeviceCodeDialogOpen(false);
    if (loginOccurred) {
      setSyncAllDialogOpen(true);
    }
  }, []);

  const handleWindowResizeWarningResult = useCallback((proceed: boolean) => {
    setWindowResizeWarningOpen(false);
    windowResizeWarningResolver.current?.(proceed);
    windowResizeWarningResolver.current = null;
  }, []);

  const handleGroupManagementComplete = useCallback(() => {
    // Reset group filters or reload groups if necessary
  }, []);

  const filteredProfiles = useMemo(() => {
    let filtered = profiles;

    if (!selectedGroupId || selectedGroupId === "__all__") {
      filtered = profiles;
    } else {
      filtered = profiles.filter(
        (profile) => profile.group_id === selectedGroupId,
      );
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter((profile) => {
        if (profile.name.toLowerCase().includes(query)) return true;
        if (profile.note?.toLowerCase().includes(query)) return true;
        if (profile.tags?.some((tag) => tag.toLowerCase().includes(query)))
          return true;
        return false;
      });
    }

    return filtered;
  }, [profiles, selectedGroupId, searchQuery]);

  const _isLoading = profilesLoading || groupsLoading || proxiesLoading;

  const subPageTitle =
    currentPage === "profiles"
      ? undefined
      : currentPage === "import"
        ? t("pageTitle.import")
        : t(`pageTitle.${currentPage}`);

  return (
    <div className="flex h-dvh flex-col bg-background font-(family-name:--font-geist-sans)">
      <CloseConfirmDialog />
      <CamoufoxDeprecationDialog profiles={profiles} />
      <HomeHeader
        onCreateProfileDialogOpen={setCreateProfileDialogOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        groups={groupsData}
        totalProfiles={profiles.length}
        selectedGroupId={selectedGroupId}
        onGroupSelect={handleSelectGroup}
        pageTitle={subPageTitle}
      />
      <div className="flex min-h-0 flex-1">
        <RailNav currentPage={currentPage} onNavigate={handleRailNavigate} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {currentPage === "profiles" && (
            <div className="flex min-h-0 flex-1 flex-col px-3 pt-2.5">
              <ProfilesDataTable
                profiles={filteredProfiles}
                infoDialogProfile={profileInfoDialog}
                onInfoDialogProfileChange={setProfileInfoDialog}
                onLaunchProfile={launchProfile}
                onKillProfile={handleKillProfile}
                onCloneProfile={handleCloneProfile}
                onSetPassword={handleSetPassword}
                onChangePassword={handleChangePassword}
                onRemovePassword={handleRemovePassword}
                onDeleteProfile={handleDeleteProfile}
                onRenameProfile={handleRenameProfile}
                onConfigureCamoufox={handleConfigureCamoufox}
                onCopyCookiesToProfile={handleCopyCookiesToProfile}
                onOpenCookieManagement={handleOpenCookieManagement}
                runningProfiles={runningProfiles}
                isUpdating={isUpdating}
                onDeleteSelectedProfiles={handleDeleteSelectedProfiles}
                onAssignProfilesToGroup={handleAssignProfilesToGroup}
                selectedGroupId={selectedGroupId}
                selectedProfiles={selectedProfiles}
                onSelectedProfilesChange={setSelectedProfiles}
                onBulkDelete={handleBulkDelete}
                onBulkGroupAssignment={handleBulkGroupAssignment}
                onBulkProxyAssignment={handleBulkProxyAssignment}
                onBulkCopyCookies={handleBulkCopyCookies}
                onBulkRun={handleBulkRun}
                onBulkStop={handleBulkStop}
                bulkActionsUnlocked={automationUnlocked}
                onBulkExtensionGroupAssignment={
                  handleBulkExtensionGroupAssignment
                }
                onAssignExtensionGroup={handleAssignExtensionGroup}
                onOpenProfileSyncDialog={handleOpenProfileSyncDialog}
                onToggleProfileSync={handleToggleProfileSync}
                crossOsUnlocked={crossOsUnlocked}
                syncUnlocked={syncUnlocked}
                getProfileSyncInfo={getProfileSyncInfo}
                onLaunchWithSync={(profile) => {
                  setSyncLeaderProfile(profile);
                }}
              />
            </div>
          )}

          {currentPage === "shortcuts" && (
            <ShortcutsPage groupTargets={orderedGroupTargets} />
          )}

          {settingsDialogOpen && (
            <SettingsDialog
              isOpen={settingsDialogOpen}
              onClose={() => {
                setSettingsDialogOpen(false);
                setCurrentPage("profiles");
              }}
              onIntegrationsOpen={() => {
                setSettingsDialogOpen(false);
                setIntegrationsDialogOpen(true);
                setCurrentPage("integrations");
              }}
              subPage={currentPage === "settings"}
            />
          )}

          {integrationsDialogOpen && (
            <IntegrationsDialog
              isOpen={integrationsDialogOpen}
              onClose={() => {
                setIntegrationsDialogOpen(false);
                setCurrentPage("profiles");
              }}
              subPage={currentPage === "integrations"}
              initialTab={integrationsInitialTab}
            />
          )}

          {proxyManagementDialogOpen && (
            <ProxyManagementDialog
              isOpen={proxyManagementDialogOpen}
              onClose={() => {
                setProxyManagementDialogOpen(false);
                setCurrentPage("profiles");
              }}
              subPage={currentPage === "proxies" || currentPage === "vpns"}
              initialTab={proxyManagementInitialTab}
            />
          )}

          {groupManagementDialogOpen && (
            <GroupManagementDialog
              isOpen={groupManagementDialogOpen}
              onClose={() => {
                setGroupManagementDialogOpen(false);
                setCurrentPage("profiles");
              }}
              onGroupManagementComplete={handleGroupManagementComplete}
              subPage={currentPage === "groups"}
            />
          )}

          {extensionManagementDialogOpen && (
            <ExtensionManagementDialog
              isOpen={extensionManagementDialogOpen}
              onClose={() => {
                setExtensionManagementDialogOpen(false);
                setCurrentPage("profiles");
              }}
              limitedMode={false}
              subPage={currentPage === "extensions"}
              initialTab={extensionManagementInitialTab}
            />
          )}

          {importProfileDialogOpen && (
            <ImportProfileDialog
              isOpen={importProfileDialogOpen}
              onClose={() => {
                setImportProfileDialogOpen(false);
                setCurrentPage("profiles");
              }}
              crossOsUnlocked={crossOsUnlocked}
              subPage={currentPage === "import"}
            />
          )}

          {accountDialogOpen && (
            <AccountPage
              isOpen={accountDialogOpen}
              onClose={() => {
                setAccountDialogOpen(false);
                setCurrentPage("profiles");
              }}
              subPage={currentPage === "account"}
              onOpenSignIn={() => {
                setAccountDialogOpen(false);
                setCurrentPage("profiles");
                setDeviceCodeDialogOpen(true);
              }}
            />
          )}
        </main>
      </div>

      <HomeDialogs
        crossOsUnlocked={crossOsUnlocked}
        profiles={profiles}
        runningProfiles={runningProfiles}
        storedProxies={storedProxies}
        vpnConfigs={vpnConfigs}
        selectedProfiles={selectedProfiles}
        createProfileDialogOpen={createProfileDialogOpen}
        setCreateProfileDialogOpen={setCreateProfileDialogOpen}
        commandPaletteOpen={commandPaletteOpen}
        setCommandPaletteOpen={setCommandPaletteOpen}
        pendingUrls={pendingUrls}
        setPendingUrls={setPendingUrls}
        permissionDialogOpen={permissionDialogOpen}
        setPermissionDialogOpen={setPermissionDialogOpen}
        welcomeOpen={welcomeOpen}
        thankYouOpen={thankYouOpen}
        setThankYouOpen={setThankYouOpen}
        cloneProfile={cloneProfile}
        setCloneProfile={setCloneProfile}
        passwordDialogProfile={passwordDialogProfile}
        setPasswordDialogProfile={setPasswordDialogProfile}
        passwordDialogMode={passwordDialogMode}
        camoufoxConfigDialogOpen={camoufoxConfigDialogOpen}
        setCamoufoxConfigDialogOpen={setCamoufoxConfigDialogOpen}
        currentProfileForCamoufoxConfig={currentProfileForCamoufoxConfig}
        groupAssignmentDialogOpen={groupAssignmentDialogOpen}
        setGroupAssignmentDialogOpen={setGroupAssignmentDialogOpen}
        selectedProfilesForGroup={selectedProfilesForGroup}
        extensionGroupAssignmentDialogOpen={extensionGroupAssignmentDialogOpen}
        setExtensionGroupAssignmentDialogOpen={
          setExtensionGroupAssignmentDialogOpen
        }
        selectedProfilesForExtensionGroup={selectedProfilesForExtensionGroup}
        proxyAssignmentDialogOpen={proxyAssignmentDialogOpen}
        setProxyAssignmentDialogOpen={setProxyAssignmentDialogOpen}
        selectedProfilesForProxy={selectedProfilesForProxy}
        cookieCopyDialogOpen={cookieCopyDialogOpen}
        setCookieCopyDialogOpen={setCookieCopyDialogOpen}
        selectedProfilesForCookies={selectedProfilesForCookies}
        setSelectedProfilesForCookies={setSelectedProfilesForCookies}
        cookieManagementDialogOpen={cookieManagementDialogOpen}
        setCookieManagementDialogOpen={setCookieManagementDialogOpen}
        currentProfileForCookieManagement={currentProfileForCookieManagement}
        setCurrentProfileForCookieManagement={
          setCurrentProfileForCookieManagement
        }
        pendingBulkAction={pendingBulkAction}
        setPendingBulkAction={setPendingBulkAction}
        showBulkDeleteConfirmation={showBulkDeleteConfirmation}
        setShowBulkDeleteConfirmation={setShowBulkDeleteConfirmation}
        syncConfigDialogOpen={syncConfigDialogOpen}
        setSyncConfigDialogOpen={setSyncConfigDialogOpen}
        deviceCodeDialogOpen={deviceCodeDialogOpen}
        setDeviceCodeDialogOpen={setDeviceCodeDialogOpen}
        syncAllDialogOpen={syncAllDialogOpen}
        setSyncAllDialogOpen={setSyncAllDialogOpen}
        profileSyncDialogOpen={profileSyncDialogOpen}
        setProfileSyncDialogOpen={setProfileSyncDialogOpen}
        currentProfileForSync={currentProfileForSync}
        setCurrentProfileForSync={setCurrentProfileForSync}
        syncLeaderProfile={syncLeaderProfile}
        setSyncLeaderProfile={setSyncLeaderProfile}
        windowResizeWarningOpen={windowResizeWarningOpen}
        windowResizeWarningBrowserType={windowResizeWarningBrowserType}
        selectedGroupId={selectedGroupId}
        isUpdating={isUpdating}
        currentPermissionType={currentPermissionType}
        termsLoading={termsLoading}
        termsAccepted={termsAccepted}
        trialStatus={trialStatus}
        trialAcknowledged={trialAcknowledged}
        handleCreateProfile={handleCreateProfile}
        runShortcut={runShortcut}
        orderedGroupTargets={orderedGroupTargets}
        handleRailNavigate={handleRailNavigate}
        handleSelectGroup={handleSelectGroup}
        launchProfile={launchProfile}
        handleKillProfile={handleKillProfile}
        setProfileInfoDialog={setProfileInfoDialog}
        checkNextPermission={checkNextPermission}
        handleWelcomeComplete={handleWelcomeComplete}
        handleProfilePasswordSuccess={handleProfilePasswordSuccess}
        handleSaveCamoufoxConfig={handleSaveCamoufoxConfig}
        handleSaveWayfernConfig={handleSaveWayfernConfig}
        handleGroupAssignmentComplete={handleGroupAssignmentComplete}
        handleExtensionGroupAssignmentComplete={
          handleExtensionGroupAssignmentComplete
        }
        handleProxyAssignmentComplete={handleProxyAssignmentComplete}
        handlePendingBulkActionConfirm={handlePendingBulkActionConfirm}
        isBulkActing={isBulkActing}
        confirmBulkDelete={confirmBulkDelete}
        isBulkDeleting={isBulkDeleting}
        handleSyncConfigClose={handleSyncConfigClose}
        handleDeviceCodeClose={handleDeviceCodeClose}
        checkTerms={checkTerms}
        checkTrialStatus={checkTrialStatus}
        handleWindowResizeWarningResult={handleWindowResizeWarningResult}
      />
    </div>
  );
}
