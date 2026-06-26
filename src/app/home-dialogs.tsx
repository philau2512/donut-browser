"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { CookieCopyDialog, CookieManagementDialog } from "@/components/cookie";
import {
  ExtensionGroupAssignmentDialog,
  GroupAssignmentDialog,
} from "@/components/group";
import { type AppPage, CommandPalette } from "@/components/navigation";
import { ThankYouDialog, WelcomeDialog } from "@/components/onboarding";
import {
  CloneProfileDialog,
  CreateProfileDialog,
  ProfilePasswordDialog,
  ProfileSelectorDialog,
  ProfileSyncDialog,
  TagsAssignmentDialog,
} from "@/components/profile";
import {
  CamoufoxConfigDialog,
  WayfernTermsDialog,
} from "@/components/profile/camoufox";
import { ProxyAssignmentDialog } from "@/components/proxy";
import { QuickProxyDialog } from "@/components/proxy/quick-proxy-dialog";
import {
  CommercialTrialModal,
  ConfirmationDialog,
  DeleteConfirmationDialog,
  PermissionDialog,
  WindowResizeWarningDialog,
} from "@/components/shared";
import {
  DeviceCodeVerifyDialog,
  SyncAllDialog,
  SyncConfigDialog,
  SyncFollowerDialog,
} from "@/components/sync";
import type { PermissionType } from "@/hooks/use-permissions";
import type { ShortcutId } from "@/lib/shortcuts";
import type {
  BrowserProfile,
  CamoufoxConfig,
  StoredProxy,
  VpnConfig,
  WayfernConfig,
} from "@/types";

type BrowserTypeString = "camoufox" | "wayfern";

interface PendingUrl {
  id: string;
  url: string;
}

interface PendingBulkAction {
  action: "run" | "stop";
  profiles: BrowserProfile[];
}

interface HomeDialogsProps {
  // Entitlements
  crossOsUnlocked: boolean;

  // Profiles and other collections
  profiles: BrowserProfile[];
  runningProfiles: Set<string>;
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];

  // Dialog open states
  createProfileDialogOpen: boolean;
  setCreateProfileDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: React.Dispatch<React.SetStateAction<boolean>>;
  pendingUrls: PendingUrl[];
  setPendingUrls: React.Dispatch<React.SetStateAction<PendingUrl[]>>;
  permissionDialogOpen: boolean;
  setPermissionDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  welcomeOpen: boolean;
  thankYouOpen: boolean;
  setThankYouOpen: React.Dispatch<React.SetStateAction<boolean>>;
  cloneProfile: BrowserProfile | null;
  setCloneProfile: React.Dispatch<React.SetStateAction<BrowserProfile | null>>;
  passwordDialogProfile: BrowserProfile | null;
  setPasswordDialogProfile: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  passwordDialogMode: "set" | "change" | "remove" | "unlock";
  camoufoxConfigDialogOpen: boolean;
  setCamoufoxConfigDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentProfileForCamoufoxConfig: BrowserProfile | null;
  groupAssignmentDialogOpen: boolean;
  setGroupAssignmentDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedProfilesForGroup: string[];
  extensionGroupAssignmentDialogOpen: boolean;
  setExtensionGroupAssignmentDialogOpen: React.Dispatch<
    React.SetStateAction<boolean>
  >;
  selectedProfilesForExtensionGroup: string[];
  proxyAssignmentDialogOpen: boolean;
  setProxyAssignmentDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedProfilesForProxy: string[];
  tagsAssignmentDialogOpen: boolean;
  setTagsAssignmentDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedProfilesForTags: string[];
  cookieCopyDialogOpen: boolean;
  setCookieCopyDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selectedProfilesForCookies: string[];
  setSelectedProfilesForCookies: React.Dispatch<React.SetStateAction<string[]>>;
  cookieManagementDialogOpen: boolean;
  setCookieManagementDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentProfileForCookieManagement: BrowserProfile | null;
  setCurrentProfileForCookieManagement: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  pendingBulkAction: PendingBulkAction | null;
  setPendingBulkAction: React.Dispatch<
    React.SetStateAction<PendingBulkAction | null>
  >;
  showBulkDeleteConfirmation: boolean;
  setShowBulkDeleteConfirmation: React.Dispatch<React.SetStateAction<boolean>>;
  syncConfigDialogOpen: boolean;
  setSyncConfigDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  deviceCodeDialogOpen: boolean;
  setDeviceCodeDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  syncAllDialogOpen: boolean;
  setSyncAllDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  profileSyncDialogOpen: boolean;
  setProfileSyncDialogOpen: React.Dispatch<React.SetStateAction<boolean>>;
  currentProfileForSync: BrowserProfile | null;
  setCurrentProfileForSync: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  syncLeaderProfile: BrowserProfile | null;
  setSyncLeaderProfile: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  windowResizeWarningOpen: boolean;
  windowResizeWarningBrowserType: string | undefined;
  quickProxyEditProfile: BrowserProfile | null;
  setQuickProxyEditProfile: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;

  // Other props
  selectedGroupId: string;
  selectedProfiles: string[];
  isUpdating: (browser: string) => boolean;
  currentPermissionType: PermissionType;
  termsLoading: boolean;
  termsAccepted: boolean | null;
  trialStatus: {
    type: string;
    days_remaining?: number;
    hours_remaining?: number;
  } | null;
  trialAcknowledged: boolean;

  // Callbacks
  handleCreateProfile: (profileData: {
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
  }) => Promise<void>;
  runShortcut: (id: ShortcutId) => void;
  orderedGroupTargets: { id: string; name: string }[];
  handleRailNavigate: (page: AppPage) => void;
  handleSelectGroup: (id: string) => void;
  launchProfile: (profile: BrowserProfile) => Promise<void>;
  handleKillProfile: (profile: BrowserProfile) => Promise<void>;
  setProfileInfoDialog: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  checkNextPermission: (justGranted?: PermissionType) => void;
  handleWelcomeComplete: () => void;
  handleProfilePasswordSuccess: (p: BrowserProfile) => void;
  handleSaveCamoufoxConfig: (config: CamoufoxConfig) => Promise<void>;
  handleSaveWayfernConfig: (config: WayfernConfig) => Promise<void>;
  handleGroupAssignmentComplete: () => void;
  handleExtensionGroupAssignmentComplete: () => void;
  handleProxyAssignmentComplete: () => void;
  handleTagsAssignmentComplete: () => void;
  handlePendingBulkActionConfirm: () => void;
  isBulkActing: boolean;
  confirmBulkDelete: () => void;
  isBulkDeleting: boolean;
  handleSyncConfigClose: (loginOccurred?: boolean) => void;
  handleDeviceCodeClose: (loginOccurred?: boolean) => void;
  checkTerms: () => void;
  checkTrialStatus: () => void;
  handleWindowResizeWarningResult: (proceed: boolean) => void;
}

export function HomeDialogs({
  crossOsUnlocked,
  profiles,
  runningProfiles,
  storedProxies,
  vpnConfigs,
  createProfileDialogOpen,
  setCreateProfileDialogOpen,
  commandPaletteOpen,
  setCommandPaletteOpen,
  pendingUrls,
  setPendingUrls,
  permissionDialogOpen,
  setPermissionDialogOpen,
  welcomeOpen,
  thankYouOpen,
  setThankYouOpen,
  cloneProfile,
  setCloneProfile,
  passwordDialogProfile,
  setPasswordDialogProfile,
  passwordDialogMode,
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
  pendingBulkAction,
  setPendingBulkAction,
  showBulkDeleteConfirmation,
  setShowBulkDeleteConfirmation,
  syncConfigDialogOpen,
  setSyncConfigDialogOpen,
  deviceCodeDialogOpen,
  setDeviceCodeDialogOpen,
  syncAllDialogOpen,
  setSyncAllDialogOpen,
  profileSyncDialogOpen,
  setProfileSyncDialogOpen,
  currentProfileForSync,
  setCurrentProfileForSync,
  syncLeaderProfile,
  setSyncLeaderProfile,
  windowResizeWarningOpen,
  windowResizeWarningBrowserType,
  quickProxyEditProfile,
  setQuickProxyEditProfile,
  selectedGroupId,
  selectedProfiles,
  isUpdating,
  currentPermissionType,
  termsLoading,
  termsAccepted,
  trialStatus,
  trialAcknowledged,
  handleCreateProfile,
  runShortcut,
  orderedGroupTargets,
  handleRailNavigate,
  handleSelectGroup,
  launchProfile,
  handleKillProfile,
  setProfileInfoDialog,
  checkNextPermission,
  handleWelcomeComplete,
  handleProfilePasswordSuccess,
  handleSaveCamoufoxConfig,
  handleSaveWayfernConfig,
  handleGroupAssignmentComplete,
  handleExtensionGroupAssignmentComplete,
  handleProxyAssignmentComplete,
  handleTagsAssignmentComplete,
  handlePendingBulkActionConfirm,
  isBulkActing,
  confirmBulkDelete,
  isBulkDeleting,
  handleSyncConfigClose,
  handleDeviceCodeClose,
  checkTerms,
  checkTrialStatus,
  handleWindowResizeWarningResult,
}: HomeDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <CreateProfileDialog
        isOpen={createProfileDialogOpen}
        onClose={() => {
          setCreateProfileDialogOpen(false);
        }}
        onCreateProfile={handleCreateProfile}
        selectedGroupId={selectedGroupId}
        crossOsUnlocked={crossOsUnlocked}
      />

      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onAction={runShortcut}
        groupTargets={orderedGroupTargets}
        onSelectGroup={(id) => {
          handleRailNavigate("profiles");
          handleSelectGroup(id);
        }}
        profiles={profiles}
        runningProfileIds={runningProfiles}
        onLaunchProfile={(profile) => {
          void launchProfile(profile);
        }}
        onKillProfile={(profile) => {
          void handleKillProfile(profile);
        }}
        onShowProfileInfo={(profile) => {
          handleRailNavigate("profiles");
          setProfileInfoDialog(profile);
        }}
      />

      {pendingUrls.map((pendingUrl) => (
        <ProfileSelectorDialog
          key={pendingUrl.id}
          isOpen={true}
          onClose={() => {
            setPendingUrls((prev) =>
              prev.filter((u) => u.id !== pendingUrl.id),
            );
          }}
          url={pendingUrl.url}
          isUpdating={isUpdating}
          runningProfiles={runningProfiles}
        />
      ))}

      <PermissionDialog
        isOpen={permissionDialogOpen}
        onClose={() => {
          setPermissionDialogOpen(false);
        }}
        permissionType={currentPermissionType}
        onPermissionGranted={checkNextPermission}
      />

      <WelcomeDialog
        isOpen={welcomeOpen}
        needsSetup={profiles.length === 0}
        onComplete={handleWelcomeComplete}
      />
      <ThankYouDialog
        isOpen={thankYouOpen}
        onClose={() => setThankYouOpen(false)}
      />

      <CloneProfileDialog
        isOpen={!!cloneProfile}
        onClose={() => {
          setCloneProfile(null);
        }}
        profile={cloneProfile}
      />

      <ProfilePasswordDialog
        isOpen={!!passwordDialogProfile}
        onClose={() => {
          setPasswordDialogProfile(null);
        }}
        profile={passwordDialogProfile}
        mode={passwordDialogMode}
        onSuccess={handleProfilePasswordSuccess}
      />

      <CamoufoxConfigDialog
        isOpen={camoufoxConfigDialogOpen}
        onClose={() => {
          setCamoufoxConfigDialogOpen(false);
        }}
        profile={currentProfileForCamoufoxConfig}
        onSave={(_profile, config) => handleSaveCamoufoxConfig(config)}
        onSaveWayfern={(_profile, config) =>
          handleSaveWayfernConfig(config as WayfernConfig)
        }
        isRunning={
          currentProfileForCamoufoxConfig
            ? runningProfiles.has(currentProfileForCamoufoxConfig.id)
            : false
        }
        crossOsUnlocked={crossOsUnlocked}
      />

      <GroupAssignmentDialog
        isOpen={groupAssignmentDialogOpen}
        onClose={() => {
          setGroupAssignmentDialogOpen(false);
        }}
        selectedProfiles={selectedProfilesForGroup}
        onAssignmentComplete={handleGroupAssignmentComplete}
        profiles={profiles}
      />

      <ExtensionGroupAssignmentDialog
        isOpen={extensionGroupAssignmentDialogOpen}
        onClose={() => {
          setExtensionGroupAssignmentDialogOpen(false);
        }}
        selectedProfiles={selectedProfilesForExtensionGroup}
        onAssignmentComplete={handleExtensionGroupAssignmentComplete}
        profiles={profiles}
      />

      <ProxyAssignmentDialog
        isOpen={proxyAssignmentDialogOpen}
        onClose={() => {
          setProxyAssignmentDialogOpen(false);
        }}
        selectedProfiles={selectedProfilesForProxy}
        onAssignmentComplete={handleProxyAssignmentComplete}
        profiles={profiles}
        storedProxies={storedProxies}
        vpnConfigs={vpnConfigs}
      />

      <TagsAssignmentDialog
        isOpen={tagsAssignmentDialogOpen}
        onClose={() => {
          setTagsAssignmentDialogOpen(false);
        }}
        selectedProfiles={selectedProfilesForTags}
        onAssignmentComplete={handleTagsAssignmentComplete}
        profiles={profiles}
      />

      <CookieCopyDialog
        isOpen={cookieCopyDialogOpen}
        onClose={() => {
          setCookieCopyDialogOpen(false);
          setSelectedProfilesForCookies([]);
        }}
        selectedProfiles={selectedProfilesForCookies}
        profiles={profiles}
        runningProfiles={runningProfiles}
        onCopyComplete={() => {
          setSelectedProfilesForCookies([]);
        }}
      />

      <CookieManagementDialog
        isOpen={cookieManagementDialogOpen}
        onClose={() => {
          setCookieManagementDialogOpen(false);
          setCurrentProfileForCookieManagement(null);
        }}
        profile={currentProfileForCookieManagement}
      />

      <ConfirmationDialog
        isOpen={pendingBulkAction !== null}
        onClose={() => {
          setPendingBulkAction(null);
        }}
        onConfirm={handlePendingBulkActionConfirm}
        title={
          pendingBulkAction?.action === "stop"
            ? t("profiles.bulkStop.confirmTitle", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
            : t("profiles.bulkRun.confirmTitle", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
        }
        description={
          pendingBulkAction?.action === "stop"
            ? t("profiles.bulkStop.confirmDescription", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
            : t("profiles.bulkRun.confirmDescription", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
        }
        confirmButtonText={
          pendingBulkAction?.action === "stop"
            ? t("profiles.bulkStop.confirmButton", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
            : t("profiles.bulkRun.confirmButton", {
                count: pendingBulkAction?.profiles.length ?? 0,
              })
        }
        confirmButtonVariant="default"
        isLoading={isBulkActing}
      />
      <DeleteConfirmationDialog
        isOpen={showBulkDeleteConfirmation}
        onClose={() => {
          setShowBulkDeleteConfirmation(false);
        }}
        onConfirm={confirmBulkDelete}
        title={t("profiles.bulkDelete.title")}
        description={t("profiles.bulkDelete.description", {
          count: selectedProfiles.length,
        })}
        confirmButtonText={t("profiles.bulkDelete.confirmButton", {
          count: selectedProfiles.length,
        })}
        isLoading={isBulkDeleting}
        profileIds={selectedProfiles}
        profiles={profiles.map((p) => ({ id: p.id, name: p.name }))}
      />

      <SyncConfigDialog
        isOpen={syncConfigDialogOpen}
        onClose={handleSyncConfigClose}
        onLoginStarted={() => {
          setSyncConfigDialogOpen(false);
          setDeviceCodeDialogOpen(true);
        }}
      />

      {pendingUrls.length === 0 && (
        <DeviceCodeVerifyDialog
          isOpen={deviceCodeDialogOpen}
          onClose={handleDeviceCodeClose}
        />
      )}

      <SyncAllDialog
        isOpen={syncAllDialogOpen}
        onClose={() => {
          setSyncAllDialogOpen(false);
        }}
      />

      <ProfileSyncDialog
        isOpen={profileSyncDialogOpen}
        onClose={() => {
          setProfileSyncDialogOpen(false);
          setCurrentProfileForSync(null);
        }}
        profile={currentProfileForSync}
        onSyncConfigOpen={() => {
          setSyncConfigDialogOpen(true);
        }}
      />

      <WayfernTermsDialog
        isOpen={!termsLoading && termsAccepted === false}
        onAccepted={checkTerms}
      />

      <CommercialTrialModal
        isOpen={
          !termsLoading &&
          termsAccepted === true &&
          trialStatus?.type === "Expired" &&
          !trialAcknowledged &&
          !crossOsUnlocked
        }
        onClose={checkTrialStatus}
      />

      <WindowResizeWarningDialog
        isOpen={windowResizeWarningOpen}
        browserType={windowResizeWarningBrowserType}
        onResult={handleWindowResizeWarningResult}
      />

      <SyncFollowerDialog
        isOpen={syncLeaderProfile !== null}
        onClose={() => {
          setSyncLeaderProfile(null);
        }}
        leaderProfile={syncLeaderProfile}
        allProfiles={profiles}
        runningProfiles={runningProfiles}
      />

      <QuickProxyDialog
        isOpen={quickProxyEditProfile !== null}
        onClose={() => {
          setQuickProxyEditProfile(null);
        }}
        profile={quickProxyEditProfile}
        storedProxies={storedProxies}
      />
    </>
  );
}
