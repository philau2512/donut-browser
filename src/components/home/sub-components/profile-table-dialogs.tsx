"use client";

import { useTranslation } from "react-i18next";
import {
  ProfileBypassRulesDialog,
  ProfileDnsBlocklistDialog,
  ProfileInfoDialog,
  ProfileLaunchHookDialog,
} from "@/components/profile";
import {
  DeleteConfirmationDialog,
  TrafficDetailsDialog,
} from "@/components/shared";
import { isCrossOsProfile } from "@/lib/browser-utils";
import type { BrowserProfile, StoredProxy, VpnConfig } from "@/types";

interface ProfileTableDialogsProps {
  // Profiles for context
  profiles: BrowserProfile[];
  vpnConfigs: VpnConfig[];
  storedProxies: StoredProxy[];

  // Info dialog
  profileForInfoDialog: BrowserProfile | null;
  setProfileForInfoDialog: (p: BrowserProfile | null) => void;
  runningProfiles: Set<string>;
  launchingProfiles: Set<string>;
  stoppingProfiles: Set<string>;
  isClient: boolean;
  syncStatuses: Record<string, { status: string; error?: string }>;

  // Delete dialog
  profileToDelete: BrowserProfile | null;
  setProfileToDelete: (p: BrowserProfile | null) => void;
  isDeleting: boolean;
  handleDelete: () => Promise<void>;

  // Bypass rules dialog
  bypassRulesProfile: BrowserProfile | null;
  setBypassRulesProfile: (p: BrowserProfile | null) => void;

  // DNS blocklist dialog
  dnsBlocklistProfile: BrowserProfile | null;
  setDnsBlocklistProfile: (p: BrowserProfile | null) => void;

  // Launch hook dialog
  launchHookProfile: BrowserProfile | null;
  setLaunchHookProfile: (p: BrowserProfile | null) => void;

  // Traffic dialog
  trafficDialogProfile: { id: string; name?: string } | null;
  setTrafficDialogProfile: (p: { id: string; name?: string } | null) => void;

  // Callbacks for ProfileInfoDialog
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onAssignProfilesToGroup: (profileIds: string[]) => void;
  onConfigureCamoufox: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  onCloneProfile?: (profile: BrowserProfile) => void | Promise<void>;
  onLaunchWithSync?: (profile: BrowserProfile) => void;
  onSetPassword?: (profile: BrowserProfile) => void;
  onChangePassword?: (profile: BrowserProfile) => void;
  onRemovePassword?: (profile: BrowserProfile) => void;
  crossOsUnlocked: boolean;
}

export function ProfileTableDialogs({
  profiles,
  vpnConfigs,
  storedProxies,
  profileForInfoDialog,
  setProfileForInfoDialog,
  runningProfiles,
  launchingProfiles,
  stoppingProfiles,
  isClient,
  syncStatuses,
  profileToDelete,
  setProfileToDelete,
  isDeleting,
  handleDelete,
  bypassRulesProfile,
  setBypassRulesProfile,
  dnsBlocklistProfile,
  setDnsBlocklistProfile,
  launchHookProfile,
  setLaunchHookProfile,
  trafficDialogProfile,
  setTrafficDialogProfile,
  onOpenProfileSyncDialog,
  onAssignProfilesToGroup,
  onConfigureCamoufox,
  onCopyCookiesToProfile,
  onOpenCookieManagement,
  onAssignExtensionGroup,
  onCloneProfile,
  onLaunchWithSync,
  onSetPassword,
  onChangePassword,
  onRemovePassword,
  crossOsUnlocked,
}: ProfileTableDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <DeleteConfirmationDialog
        isOpen={profileToDelete !== null}
        onClose={() => {
          setProfileToDelete(null);
        }}
        onConfirm={handleDelete}
        title={t("profiles.delete.title")}
        description={t("profiles.delete.description", {
          profileName: profileToDelete?.name ?? "",
        })}
        confirmButtonText={t("profiles.delete.confirmButton")}
        isLoading={isDeleting}
      />

      {profileForInfoDialog &&
        (() => {
          const infoProfile =
            profiles.find((p) => p.id === profileForInfoDialog.id) ??
            profileForInfoDialog;
          const infoIsRunning = isClient && runningProfiles.has(infoProfile.id);
          const infoIsLaunching = launchingProfiles.has(infoProfile.id);
          const infoIsStopping = stoppingProfiles.has(infoProfile.id);
          const infoIsCrossOs = isCrossOsProfile(infoProfile);
          const infoIsDisabled =
            infoIsRunning || infoIsLaunching || infoIsStopping || infoIsCrossOs;
          return (
            <ProfileInfoDialog
              isOpen={profileForInfoDialog !== null}
              onClose={() => {
                setProfileForInfoDialog(null);
              }}
              profile={infoProfile}
              storedProxies={storedProxies}
              vpnConfigs={vpnConfigs}
              onOpenTrafficDialog={(profileId) => {
                const profile = profiles.find((p) => p.id === profileId);
                setTrafficDialogProfile({ id: profileId, name: profile?.name });
              }}
              onOpenProfileSyncDialog={onOpenProfileSyncDialog}
              onAssignProfilesToGroup={onAssignProfilesToGroup}
              onConfigureCamoufox={onConfigureCamoufox}
              onCopyCookiesToProfile={onCopyCookiesToProfile}
              onOpenCookieManagement={onOpenCookieManagement}
              onAssignExtensionGroup={onAssignExtensionGroup}
              onOpenBypassRules={(profile) => {
                setBypassRulesProfile(profile);
              }}
              onOpenDnsBlocklist={(profile) => {
                setDnsBlocklistProfile(profile);
              }}
              onOpenLaunchHook={(profile) => {
                setLaunchHookProfile(profile);
              }}
              onCloneProfile={onCloneProfile}
              onLaunchWithSync={onLaunchWithSync}
              onSetPassword={onSetPassword}
              onChangePassword={onChangePassword}
              onRemovePassword={onRemovePassword}
              onDeleteProfile={(profile) => {
                setProfileForInfoDialog(null);
                setProfileToDelete(profile);
              }}
              crossOsUnlocked={crossOsUnlocked}
              isRunning={infoIsRunning}
              isDisabled={infoIsDisabled}
              isCrossOs={infoIsCrossOs}
              syncStatuses={syncStatuses}
            />
          );
        })()}

      {trafficDialogProfile && (
        <TrafficDetailsDialog
          isOpen={trafficDialogProfile !== null}
          onClose={() => {
            setTrafficDialogProfile(null);
          }}
          profileId={trafficDialogProfile.id}
          profileName={trafficDialogProfile.name}
        />
      )}

      <ProfileBypassRulesDialog
        isOpen={bypassRulesProfile !== null}
        onClose={() => {
          setBypassRulesProfile(null);
        }}
        profileId={bypassRulesProfile?.id ?? null}
        initialRules={bypassRulesProfile?.proxy_bypass_rules ?? []}
      />

      <ProfileDnsBlocklistDialog
        isOpen={dnsBlocklistProfile !== null}
        onClose={() => {
          setDnsBlocklistProfile(null);
        }}
        profileId={dnsBlocklistProfile?.id ?? null}
        currentLevel={dnsBlocklistProfile?.dns_blocklist ?? null}
      />

      <ProfileLaunchHookDialog
        isOpen={launchHookProfile !== null}
        onClose={() => {
          setLaunchHookProfile(null);
        }}
        profileId={launchHookProfile?.id ?? null}
        currentLaunchHook={launchHookProfile?.launch_hook ?? null}
      />
    </>
  );
}
