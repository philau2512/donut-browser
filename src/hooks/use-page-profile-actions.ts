"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { BrowserProfile, CamoufoxConfig, WayfernConfig } from "@/types";

export type PasswordDialogMode = "set" | "change" | "remove" | "unlock";

interface PendingBulkAction {
  action: "run" | "stop";
  profiles: BrowserProfile[];
}

interface UsePageProfileActionsProps {
  profiles: BrowserProfile[];
  runningProfiles: Set<string>;
  selectedGroupId: string;
}

export function usePageProfileActions({
  profiles,
  runningProfiles,
  selectedGroupId,
}: UsePageProfileActionsProps) {
  const { t } = useTranslation();

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

  const [camoufoxConfigDialogOpen, setCamoufoxConfigDialogOpen] =
    useState(false);
  const [currentProfileForCamoufoxConfig, setCurrentProfileForCamoufoxConfig] =
    useState<BrowserProfile | null>(null);

  const [groupAssignmentDialogOpen, setGroupAssignmentDialogOpen] =
    useState(false);
  const [selectedProfilesForGroup, setSelectedProfilesForGroup] = useState<
    string[]
  >([]);

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
  const [selectedProfilesForProxy, setSelectedProfilesForProxy] = useState<
    string[]
  >([]);

  const [cookieCopyDialogOpen, setCookieCopyDialogOpen] = useState(false);
  const [selectedProfilesForCookies, setSelectedProfilesForCookies] = useState<
    string[]
  >([]);

  const [cookieManagementDialogOpen, setCookieManagementDialogOpen] =
    useState(false);
  const [
    currentProfileForCookieManagement,
    setCurrentProfileForCookieManagement,
  ] = useState<BrowserProfile | null>(null);

  const [selectedProfiles, setSelectedProfiles] = useState<string[]>([]);

  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] =
    useState(false);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);

  const [pendingBulkAction, setPendingBulkAction] =
    useState<PendingBulkAction | null>(null);
  const [isBulkActing, setIsBulkActing] = useState(false);

  const [profileSyncDialogOpen, setProfileSyncDialogOpen] = useState(false);
  const [currentProfileForSync, setCurrentProfileForSync] =
    useState<BrowserProfile | null>(null);

  type BrowserTypeString = "camoufox" | "wayfern";

  const launchProfile = useCallback(
    async (profile: BrowserProfile) => {
      console.log("Starting launch for profile:", profile.name);

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
      } catch (err: unknown) {
        console.error("Failed to kill browser:", err);
        const errorMessage = err instanceof Error ? err.message : String(err);
        showErrorToast(t("errors.killBrowserFailed", { error: errorMessage }));
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
      } catch (error) {
        showErrorToast(
          t("errors.createProfileFailed", {
            error: translateBackendError(t, error),
          }),
        );
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
        const isRunning = await invoke<boolean>("check_browser_status", {
          profile,
        });

        if (isRunning) {
          showErrorToast(t("errors.cannotDeleteRunningProfile"));
          return;
        }

        await invoke("delete_profile", { profileId: profile.id });
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

  const handleWindowResizeWarningResult = useCallback((proceed: boolean) => {
    setWindowResizeWarningOpen(false);
    windowResizeWarningResolver.current?.(proceed);
    windowResizeWarningResolver.current = null;
  }, []);

  return {
    cloneProfile,
    setCloneProfile,
    passwordDialogProfile,
    setPasswordDialogProfile,
    passwordDialogMode,
    windowResizeWarningOpen,
    windowResizeWarningBrowserType,
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
    handleAssignProxyToProfiles,
    handleProxyAssignmentComplete,
    handleBulkDelete,
    handleBulkGroupAssignment,
    handleBulkProxyAssignment,
    handleBulkExtensionGroupAssignment,
    handleBulkCopyCookies,
    handleBulkRun,
    handleBulkStop,
    handleOpenProfileSyncDialog,
    handleToggleProfileSync,
    handleProfilePasswordSuccess,
    handlePendingBulkActionConfirm,
    handleWindowResizeWarningResult,
  };
}
