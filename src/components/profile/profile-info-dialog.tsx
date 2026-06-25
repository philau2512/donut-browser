"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import {
  LuCookie,
  LuCopy,
  LuFingerprint,
  LuGlobe,
  LuGroup,
  LuKey,
  LuLink,
  LuLockOpen,
  LuPuzzle,
  LuRefreshCw,
  LuSettings,
  LuShield,
  LuShieldCheck,
  LuTrash2,
  LuUsers,
} from "react-icons/lu";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProfileIcon } from "@/lib/browser-utils";
import type {
  BrowserProfile,
  ProfileGroup,
  StoredProxy,
  VpnConfig,
} from "@/types";
import { ProfileInfoLayout } from "./profile-info/profile-info-layout";

export { ProfileBypassRulesDialog } from "./profile-info/dialogs/bypass-rules-dialog";
export { ProfileDnsBlocklistDialog } from "./profile-info/dialogs/dns-blocklist-dialog";
export { ProfileLaunchHookDialog } from "./profile-info/dialogs/launch-hook-dialog";

interface ProfileInfoDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profile: BrowserProfile | null;
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  onOpenTrafficDialog?: (profileId: string) => void;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onAssignProfilesToGroup?: (profileIds: string[]) => void;
  onConfigureCamoufox?: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  onOpenBypassRules?: (profile: BrowserProfile) => void;
  onOpenDnsBlocklist?: (profile: BrowserProfile) => void;
  onOpenLaunchHook?: (profile: BrowserProfile) => void;
  onCloneProfile?: (profile: BrowserProfile) => void;
  onDeleteProfile?: (profile: BrowserProfile) => void;
  onLaunchWithSync?: (profile: BrowserProfile) => void;
  onSetPassword?: (profile: BrowserProfile) => void;
  onChangePassword?: (profile: BrowserProfile) => void;
  onRemovePassword?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  isRunning?: boolean;
  isDisabled?: boolean;
  isCrossOs?: boolean;
  syncStatuses: Record<string, { status: string; error?: string }>;
}

function _OSIcon({ os }: { os: string }) {
  switch (os) {
    case "macos":
      return <FaApple className="size-3.5" />;
    case "windows":
      return <FaWindows className="size-3.5" />;
    case "linux":
      return <FaLinux className="size-3.5" />;
    default:
      return null;
  }
}

export function ProfileInfoDialog({
  isOpen,
  onClose,
  profile,
  storedProxies,
  vpnConfigs,
  onOpenTrafficDialog,
  onOpenProfileSyncDialog,
  onAssignProfilesToGroup,
  onConfigureCamoufox,
  onCopyCookiesToProfile,
  onOpenCookieManagement,
  onAssignExtensionGroup,
  onOpenBypassRules,
  onOpenDnsBlocklist,
  onOpenLaunchHook,
  onCloneProfile,
  onDeleteProfile,
  onLaunchWithSync,
  onSetPassword,
  onChangePassword,
  onRemovePassword,
  crossOsUnlocked = false,
  isRunning = false,
  isDisabled = false,
  isCrossOs = false,
  syncStatuses,
}: ProfileInfoDialogProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = React.useState(false);
  const [groupName, setGroupName] = React.useState<string | null>(null);
  const [extensionGroupName, setExtensionGroupName] = React.useState<
    string | null
  >(null);

  React.useEffect(() => {
    if (!isOpen || !profile?.group_id) {
      setGroupName(null);
      return;
    }
    void (async () => {
      try {
        const groups = await invoke<ProfileGroup[]>("get_groups");
        const group = groups.find((g) => g.id === profile.group_id);
        setGroupName(group?.name ?? null);
      } catch {
        setGroupName(null);
      }
    })();
  }, [isOpen, profile?.group_id]);

  React.useEffect(() => {
    if (!isOpen || !profile?.extension_group_id) {
      setExtensionGroupName(null);
      return;
    }
    void (async () => {
      try {
        const group = await invoke<{ name: string } | null>(
          "get_extension_group_for_profile",
          { profileId: profile.id },
        );
        setExtensionGroupName(group?.name ?? null);
      } catch {
        setExtensionGroupName(null);
      }
    })();
  }, [isOpen, profile?.extension_group_id, profile?.id]);

  React.useEffect(() => {
    if (!isOpen) {
      setCopied(false);
    }
  }, [isOpen]);

  if (!profile) return null;

  const ProfileIcon = getProfileIcon(profile);
  const isCamoufoxOrWayfern =
    profile.browser === "camoufox" || profile.browser === "wayfern";
  const isDeleteDisabled = isRunning;

  const proxyName = profile.proxy_id
    ? storedProxies.find((p) => p.id === profile.proxy_id)?.name
    : null;
  const vpnName = profile.vpn_id
    ? vpnConfigs.find((v) => v.id === profile.vpn_id)?.name
    : null;
  const networkLabel = vpnName
    ? t("profileInfo.network.vpnLabel", { name: vpnName })
    : proxyName
      ? t("profileInfo.network.proxyLabel", { name: proxyName })
      : t("profileInfo.values.none");

  const syncStatus = syncStatuses[profile.id];
  const syncMode = profile.sync_mode ?? "Disabled";

  const handleCopyId = async () => {
    try {
      await navigator.clipboard.writeText(profile.id);
      setCopied(true);
      setTimeout(() => {
        setCopied(false);
      }, 2000);
    } catch {
      // ignore
    }
  };

  const handleAction = (action: () => void) => {
    onClose();
    action();
  };

  const hasTags = profile.tags && profile.tags.length > 0;
  const hasNote = !!profile.note;

  interface ActionItem {
    id?: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;
    proBadge?: boolean;
    runningBadge?: boolean;
    hidden?: boolean;
  }

  const actions: ActionItem[] = [
    {
      id: "network",
      icon: <LuGlobe className="size-4" />,
      label: t("profiles.actions.viewNetwork"),
      onClick: () => {
        handleAction(() => onOpenTrafficDialog?.(profile.id));
      },
      disabled: isCrossOs,
    },
    {
      id: "sync",
      icon: <LuRefreshCw className="size-4" />,
      label: t("profiles.actions.syncSettings"),
      onClick: () => {
        handleAction(() => onOpenProfileSyncDialog?.(profile));
      },
      disabled: isCrossOs,
      hidden: profile.ephemeral === true,
    },
    {
      icon: <LuGroup className="size-4" />,
      label: t("profiles.actions.assignToGroup"),
      onClick: () => {
        handleAction(() => onAssignProfilesToGroup?.([profile.id]));
      },
      disabled: isDisabled,
      runningBadge: isRunning,
    },
    {
      id: "fingerprint",
      icon: <LuFingerprint className="size-4" />,
      label: t("profiles.actions.changeFingerprint"),
      onClick: () => {
        handleAction(() => onConfigureCamoufox?.(profile));
      },
      disabled: isDisabled || !crossOsUnlocked,
      proBadge: !crossOsUnlocked,
      runningBadge: isRunning,
      hidden: !isCamoufoxOrWayfern || !onConfigureCamoufox,
    },
    {
      icon: <LuUsers className="size-4" />,
      label: t("profiles.synchronizer.launchWithSync"),
      onClick: () => {
        handleAction(() => onLaunchWithSync?.(profile));
      },
      disabled: isDisabled || isRunning || !crossOsUnlocked,
      proBadge: !crossOsUnlocked,
      hidden: profile.browser !== "wayfern" || !onLaunchWithSync,
    },
    {
      id: "cookiesCopy",
      icon: <LuCopy className="size-4" />,
      label: t("profiles.actions.copyCookiesToProfile"),
      onClick: () => {
        handleAction(() => onCopyCookiesToProfile?.(profile));
      },
      disabled: isDisabled,
      runningBadge: isRunning,
      hidden:
        !isCamoufoxOrWayfern ||
        profile.ephemeral === true ||
        !onCopyCookiesToProfile,
    },
    {
      id: "cookiesManage",
      icon: <LuCookie className="size-4" />,
      label: t("profileInfo.actions.manageCookies"),
      onClick: () => {
        handleAction(() => onOpenCookieManagement?.(profile));
      },
      disabled: isDisabled,
      runningBadge: isRunning,
      hidden:
        !isCamoufoxOrWayfern ||
        profile.ephemeral === true ||
        !onOpenCookieManagement,
    },
    {
      icon: <LuSettings className="size-4" />,
      label: t("profiles.actions.clone"),
      onClick: () => {
        handleAction(() => onCloneProfile?.(profile));
      },
      disabled: isDisabled,
      runningBadge: isRunning,
      hidden: profile.ephemeral === true,
    },
    {
      id: "extension",
      icon: <LuPuzzle className="size-4" />,
      label: t("profileInfo.actions.assignExtensionGroup"),
      onClick: () => {
        handleAction(() => onAssignExtensionGroup?.([profile.id]));
      },
      disabled: isDisabled,
      runningBadge: isRunning,
      hidden: profile.ephemeral === true,
    },
    {
      icon: <LuShieldCheck className="size-4" />,
      label: t("profileInfo.network.bypassRulesTitle"),
      onClick: () => {
        handleAction(() => onOpenBypassRules?.(profile));
      },
    },
    {
      icon: <LuShield className="size-4" />,
      label: t("dnsBlocklist.title"),
      onClick: () => {
        handleAction(() => onOpenDnsBlocklist?.(profile));
      },
    },
    {
      id: "hook",
      icon: <LuLink className="size-4" />,
      label: t("profiles.actions.launchHook"),
      onClick: () => {
        handleAction(() => onOpenLaunchHook?.(profile));
      },
      hidden: !onOpenLaunchHook,
    },
    {
      icon: <LuKey className="size-4" />,
      label: t("profiles.actions.setPassword"),
      onClick: () => {
        handleAction(() => onSetPassword?.(profile));
      },
      disabled: isDisabled || isRunning,
      runningBadge: isRunning,
      hidden:
        profile.password_protected === true ||
        profile.ephemeral === true ||
        !onSetPassword,
    },
    {
      icon: <LuKey className="size-4" />,
      label: t("profiles.actions.changePassword"),
      onClick: () => {
        handleAction(() => onChangePassword?.(profile));
      },
      disabled: isDisabled || isRunning,
      runningBadge: isRunning,
      hidden: profile.password_protected !== true || !onChangePassword,
    },
    {
      icon: <LuLockOpen className="size-4" />,
      label: t("profiles.actions.removePassword"),
      onClick: () => {
        handleAction(() => onRemovePassword?.(profile));
      },
      disabled: isDisabled || isRunning,
      runningBadge: isRunning,
      hidden: profile.password_protected !== true || !onRemovePassword,
      destructive: true,
    },
    {
      id: "delete",
      icon: <LuTrash2 className="size-4" />,
      label: t("profiles.actions.delete"),
      onClick: () => {
        handleAction(() => onDeleteProfile?.(profile));
      },
      disabled: isDeleteDisabled,
      destructive: true,
    },
  ];

  const visibleActions = actions.filter((a) => !a.hidden);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        hideClose
        className="flex h-[min(clamp(30rem,80vh,48rem),calc(100vh-3rem))] max-w-[min(60rem,calc(100%-4rem))] flex-col gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">{t("profileInfo.title")}</DialogTitle>
        <ProfileInfoLayout
          profile={profile}
          ProfileIcon={ProfileIcon}
          isRunning={isRunning}
          isDisabled={isDisabled}
          networkLabel={networkLabel}
          groupName={groupName}
          extensionGroupName={extensionGroupName}
          syncMode={syncMode}
          syncStatus={syncStatus}
          storedProxies={storedProxies}
          vpnConfigs={vpnConfigs}
          hasTags={hasTags}
          hasNote={hasNote}
          copied={copied}
          handleCopyId={handleCopyId}
          onClose={onClose}
          onCloneProfile={onCloneProfile}
          onKillProfile={undefined}
          visibleActions={visibleActions}
          t={t}
        />
      </DialogContent>
    </Dialog>
  );
}
