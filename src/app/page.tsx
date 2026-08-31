"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useOnborda } from "onborda";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
// Automation
import { AutomationTab } from "@/components/automation";
// Settings
import { ExtensionManagementDialog } from "@/components/extension";
import { GroupManagementDialog } from "@/components/group";
// Home
import { HomeHeader, ProfilesDataTable } from "@/components/home";
import { ProfileFilterDialog } from "@/components/home/sub-components/profile-filter-dialog";
import type { AppPage } from "@/components/navigation";
// Navigation
import { RailNav } from "@/components/navigation";
// Onboarding
import { ONBOARDING_TOUR } from "@/components/onboarding";
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
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useCommercialTrial } from "@/hooks/use-commercial-trial";
import { useGroupEvents } from "@/hooks/use-group-events";
import { usePageProfileActions } from "@/hooks/use-page-profile-actions";
import { usePageStartup } from "@/hooks/use-page-startup";
import type { PermissionType } from "@/hooks/use-permissions";
import { usePermissions } from "@/hooks/use-permissions";
import { useProfileEvents } from "@/hooks/use-profile-events";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useSyncSessions } from "@/hooks/use-sync-session";
import { useUpdateNotifications } from "@/hooks/use-update-notifications";
import { useVersionUpdater } from "@/hooks/use-version-updater";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { useWayfernTerms } from "@/hooks/use-wayfern-terms";
import { getEntitlements } from "@/lib/entitlements";
import {
  ONBOARDING_TOUR_FINISHED_EVENT,
  setOnboardingActive,
} from "@/lib/onboarding-signal";
import {
  applyProfileFilter,
  countActiveProfileFilters,
  EMPTY_PROFILE_FILTER,
  type ProfileFilterCriteria,
} from "@/lib/profile-filter";
import {
  matchesProfile,
  type ProfileSearchContext,
  parseProfileSearch,
} from "@/lib/profile-search";
import {
  matchesGroupDigit,
  matchesShortcut,
  SHORTCUTS,
  type ShortcutId,
} from "@/lib/shortcuts";
import type { BrowserProfile, ExtensionGroup, SyncSettings } from "@/types";

// Import HomeDialogs
import { HomeDialogs } from "./home-dialogs";

interface PendingUrl {
  id: string;
  url: string;
}

export default function Home() {
  const { t } = useTranslation();
  useVersionUpdater();

  const {
    profiles,
    runningProfiles,
    isLoading: profilesLoading,
    loadProfiles,
    loadGroups,
  } = useProfileEvents();

  const handleRefreshProfiles = useCallback(async () => {
    try {
      await Promise.all([loadProfiles(), loadGroups()]);
    } catch (err) {
      console.error("Failed to manual refresh profiles/groups:", err);
    }
  }, [loadProfiles, loadGroups]);

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
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        profile: BrowserProfile;
        result: import("@/components/consistency-warning-dialog").ConsistencyResult;
      } | null;
      if (detail?.profile && detail?.result) {
        setConsistencyWarning({
          profile: detail.profile,
          result: detail.result,
        });
      }
    };
    window.addEventListener("profile-consistency-warning", handler);
    return () =>
      window.removeEventListener("profile-consistency-warning", handler);
  }, []);

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

  const { groups: groupsData, isLoading: groupsLoading } = useGroupEvents();

  const { storedProxies, isLoading: proxiesLoading } = useProxyEvents();

  const { vpnConfigs } = useVpnEvents();

  // Extension groups feed both the table's Ext column and the search filter's
  // `ext:` lookup, so the list is loaded here and handed down rather than
  // fetched twice. Refreshed when the backend emits 'extensions-changed'
  // (group rename/create/delete).
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>([]);

  useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const data = await invoke<ExtensionGroup[]>("list_extension_groups");
        if (mounted) setExtensionGroups(data);
      } catch (e) {
        console.error("Failed to load extension groups:", e);
      }
    };
    void load();
    void listen("extensions-changed", () => {
      void load();
    }).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);
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
  const [quickCreateDialogOpen, setQuickCreateDialogOpen] = useState(false);
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [integrationsDialogOpen, setIntegrationsDialogOpen] = useState(false);
  const [importProfileDialogOpen, setImportProfileDialogOpen] = useState(false);
  const [proxyManagementDialogOpen, setProxyManagementDialogOpen] =
    useState(false);
  const [_camoufoxConfigDialogOpen, _setCamoufoxConfigDialogOpen] =
    useState(false);
  const [groupManagementDialogOpen, setGroupManagementDialogOpen] =
    useState(false);
  const [extensionManagementDialogOpen, setExtensionManagementDialogOpen] =
    useState(false);
  const [_groupAssignmentDialogOpen, _setGroupAssignmentDialogOpen] =
    useState(false);
  const [
    _extensionGroupAssignmentDialogOpen,
    _setExtensionGroupAssignmentDialogOpen,
  ] = useState(false);
  const [
    _selectedProfilesForExtensionGroup,
    _setSelectedProfilesForExtensionGroup,
  ] = useState<string[]>([]);
  const [_proxyAssignmentDialogOpen, _setProxyAssignmentDialogOpen] =
    useState(false);
  const [_cookieCopyDialogOpen, _setCookieCopyDialogOpen] = useState(false);
  const [_cookieManagementDialogOpen, _setCookieManagementDialogOpen] =
    useState(false);
  const [
    _currentProfileForCookieManagement,
    _setCurrentProfileForCookieManagement,
  ] = useState<BrowserProfile | null>(null);
  const [_selectedProfilesForCookies, _setSelectedProfilesForCookies] =
    useState<string[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<string>("__all__");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [profileFilter, setProfileFilter] =
    useState<ProfileFilterCriteria>(EMPTY_PROFILE_FILTER);
  const [profileFilterDialogOpen, setProfileFilterDialogOpen] = useState(false);
  const [pendingUrls, setPendingUrls] = useState<PendingUrl[]>([]);
  const [permissionDialogOpen, setPermissionDialogOpen] = useState(false);
  const [currentPermissionType, setCurrentPermissionType] =
    useState<PermissionType>("microphone");
  const [syncConfigDialogOpen, setSyncConfigDialogOpen] = useState(false);
  const [deviceCodeDialogOpen, setDeviceCodeDialogOpen] = useState(false);
  const [syncAllDialogOpen, setSyncAllDialogOpen] = useState(false);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [consistencyWarning, setConsistencyWarning] = useState<{
    profile: BrowserProfile;
    result: import("@/components/consistency-warning-dialog").ConsistencyResult;
  } | null>(null);
  const [profileInfoDialog, setProfileInfoDialog] =
    useState<BrowserProfile | null>(null);
  const [quickProxyEditProfile, setQuickProxyEditProfile] =
    useState<BrowserProfile | null>(null);
  const { isMicrophoneAccessGranted, isCameraAccessGranted, isInitialized } =
    usePermissions();
  const { isUpdating } = useUpdateNotifications();

  const checkAllPermissions = useCallback(async () => {
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
  }, [isInitialized, isMicrophoneAccessGranted, isCameraAccessGranted]);

  useEffect(() => {
    if (isInitialized) {
      void checkAllPermissions();
    }
  }, [isInitialized, checkAllPermissions]);

  const checkNextPermission = useCallback(
    (justGranted?: PermissionType) => {
      try {
        if (!isMicrophoneAccessGranted && justGranted !== "microphone") {
          setCurrentPermissionType("microphone");
          setPermissionDialogOpen(true);
        } else if (!isCameraAccessGranted && justGranted !== "camera") {
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

  const {
    cloneProfile,
    setCloneProfile,
    passwordDialogProfile,
    setPasswordDialogProfile,
    passwordDialogMode,
    windowResizeWarningOpen,
    camoufoxConfigDialogOpen,
    setCamoufoxConfigDialogOpen,
    currentProfileForCamoufoxConfig,
    groupAssignmentDialogOpen,
    setGroupAssignmentDialogOpen,
    selectedProfilesForGroup,
    extensionGroupAssignmentDialogOpen,
    setExtensionGroupAssignmentDialogOpen,
    selectedProfilesForExtensionGroup,
    proxyAssignmentDialogOpen,
    setProxyAssignmentDialogOpen,
    selectedProfilesForProxy,
    tagsAssignmentDialogOpen,
    setTagsAssignmentDialogOpen,
    selectedProfilesForTags,
    cookieCopyDialogOpen,
    setCookieCopyDialogOpen,
    selectedProfilesForCookies,
    setSelectedProfilesForCookies,
    cookieManagementDialogOpen,
    setCookieManagementDialogOpen,
    currentProfileForCookieManagement,
    setCurrentProfileForCookieManagement,
    selectedProfiles,
    setSelectedProfiles,
    showBulkDeleteConfirmation,
    setShowBulkDeleteConfirmation,
    isBulkDeleting,
    pendingBulkAction,
    setPendingBulkAction,
    isBulkActing,
    profileSyncDialogOpen,
    setProfileSyncDialogOpen,
    currentProfileForSync,
    setCurrentProfileForSync,

    // Handlers
    launchProfile,
    handleKillProfile,
    handleCreateProfile,
    handleCloneProfile,
    handleSetPassword,
    handleChangePassword,
    handleRemovePassword,
    handleDeleteProfile,
    handleRenameProfile,
    handleConfigureCamoufox,
    handleCopyCookiesToProfile,
    handleOpenCookieManagement,
    handleSaveCamoufoxConfig,
    handleSaveWayfernConfig,
    handleDeleteSelectedProfiles,
    confirmBulkDelete,
    handleAssignProfilesToGroup,
    handleGroupAssignmentComplete,
    handleAssignExtensionGroup,
    handleExtensionGroupAssignmentComplete,
    handleProxyAssignmentComplete,
    handleBulkDelete,
    handleBulkGroupAssignment,
    handleBulkProxyAssignment,
    handleBulkExtensionGroupAssignment,
    handleBulkCopyCookies,
    handleAssignTagsToProfiles,
    handleTagsAssignmentComplete,
    handleBulkTagsAssignment,
    handleBulkRun,
    handleBulkStop,
    handleOpenProfileSyncDialog,
    handleToggleProfileSync,
    handleProfilePasswordSuccess,
    handlePendingBulkActionConfirm,
    handleWindowResizeWarningResult,
  } = usePageProfileActions({
    profiles,
    runningProfiles,
    selectedGroupId,
  });

  const handleSelectGroup = useCallback(
    (groupId: string) => {
      setSelectedGroupId(groupId);
      setSelectedProfiles([]);
    },
    [setSelectedProfiles],
  );

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
      case "automation":
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

  usePageStartup({
    setPendingUrls,
    setCreateProfileDialogOpen,
    currentPage,
    isInitialized,
    firstRunOnboarding,
    t,
  });

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

  const handleGroupManagementComplete = useCallback(() => {
    // Reset group filters or reload groups if necessary
  }, []);

  // A profile stores ids, and the query asks about names, so the matcher is
  // handed the resolution up front. Built off the entity lists rather than off
  // `profiles`, because the alternative — a .find() per row per term — is
  // O(profiles x entities) on every single keystroke.
  const searchContext = useMemo<ProfileSearchContext>(
    () => ({
      groupNames: new Map(groupsData.map((g) => [g.id, g.name])),
      proxyNames: new Map(storedProxies.map((p) => [p.id, p.name])),
      vpnNames: new Map(vpnConfigs.map((v) => [v.id, v.name])),
      extensionGroupNames: new Map(extensionGroups.map((e) => [e.id, e.name])),
      runningProfiles,
    }),
    [groupsData, storedProxies, vpnConfigs, extensionGroups, runningProfiles],
  );

  // Filter data by selected group and search query. The two are independent
  // controls and both apply: the rail narrows to a group, the query narrows
  // within whatever the rail left.
  const filteredProfiles = useMemo(() => {
    // "__all__" is a virtual filter that shows every profile (including
    // ungrouped ones). Any other value is a real group id; ungrouped profiles
    // only show through "All".
    const inGroup =
      !selectedGroupId || selectedGroupId === "__all__"
        ? profiles
        : profiles.filter((profile) => profile.group_id === selectedGroupId);

    const parsed = parseProfileSearch(searchQuery);
    let matched = parsed.isEmpty
      ? inGroup
      : inGroup.filter((profile) =>
          matchesProfile(profile, parsed, searchContext),
        );

    matched = applyProfileFilter(matched, profileFilter, runningProfiles);
    return matched;
  }, [
    profiles,
    selectedGroupId,
    searchQuery,
    searchContext,
    profileFilter,
    runningProfiles,
  ]);

  const activeFilterCount = useMemo(
    () => countActiveProfileFilters(profileFilter),
    [profileFilter],
  );

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
        onQuickCreateDialogOpen={setQuickCreateDialogOpen}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        groups={groupsData}
        totalProfiles={profiles.length}
        selectedGroupId={selectedGroupId}
        onGroupSelect={handleSelectGroup}
        pageTitle={subPageTitle}
        onRefresh={handleRefreshProfiles}
        onOpenFilter={() => setProfileFilterDialogOpen(true)}
        activeFilterCount={activeFilterCount}
      />
      <ProfileFilterDialog
        open={profileFilterDialogOpen}
        onOpenChange={setProfileFilterDialogOpen}
        value={profileFilter}
        onApply={setProfileFilter}
        folders={groupsData}
      />
      <div className="flex min-h-0 flex-1">
        <RailNav
          currentPage={currentPage}
          onNavigate={handleRailNavigate}
          onCreateProfileClick={() => setCreateProfileDialogOpen(true)}
          totalProfiles={profiles.length}
          runningProfilesCount={runningProfiles.size}
        />
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
                groups={groupsData}
                selectedProfiles={selectedProfiles}
                onSelectedProfilesChange={setSelectedProfiles}
                onBulkDelete={handleBulkDelete}
                onBulkGroupAssignment={handleBulkGroupAssignment}
                onBulkProxyAssignment={handleBulkProxyAssignment}
                onBulkTagsAssignment={handleBulkTagsAssignment}
                onAssignTags={handleAssignTagsToProfiles}
                onQuickProxyEdit={setQuickProxyEditProfile}
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

          {currentPage === "automation" && (
            <AutomationTab profiles={profiles} />
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
        quickCreateDialogOpen={quickCreateDialogOpen}
        setQuickCreateDialogOpen={setQuickCreateDialogOpen}
        commandPaletteOpen={commandPaletteOpen}
        setCommandPaletteOpen={setCommandPaletteOpen}
        aboutDialogOpen={aboutDialogOpen}
        setAboutDialogOpen={setAboutDialogOpen}
        consistencyWarning={consistencyWarning}
        setConsistencyWarning={setConsistencyWarning}
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
        tagsAssignmentDialogOpen={tagsAssignmentDialogOpen}
        setTagsAssignmentDialogOpen={setTagsAssignmentDialogOpen}
        selectedProfilesForTags={selectedProfilesForTags}
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
        quickProxyEditProfile={quickProxyEditProfile}
        setQuickProxyEditProfile={setQuickProxyEditProfile}
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
        handleTagsAssignmentComplete={handleTagsAssignmentComplete}
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
