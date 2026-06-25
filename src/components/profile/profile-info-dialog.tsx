"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { FaApple, FaLinux, FaWindows } from "react-icons/fa";
import {
  LuClipboard,
  LuClipboardCheck,
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
  LuX,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { getProfileIcon } from "@/lib/browser-utils";
import { formatRelativeTime } from "@/lib/flag-utils";
import { cn } from "@/lib/utils";
import type {
  BrowserProfile,
  ProfileGroup,
  StoredProxy,
  VpnConfig,
} from "@/types";
import { CookiesSectionInline } from "./profile-info/cookies-section";
import { ExtensionsSectionInline } from "./profile-info/extensions-section";
// Import sub-components and sub-dialogs
import { FingerprintSectionInline } from "./profile-info/fingerprint-section";
import { LaunchHookEditor } from "./profile-info/launch-hook-editor";
import { NetworkSectionInline } from "./profile-info/network-section";
import { SecuritySectionInline } from "./profile-info/security-section";
import { SyncSectionInline } from "./profile-info/sync-section";

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

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm">{value}</p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function LocalDataTransferCard({
  profileId,
  t,
}: {
  profileId: string;
  t: (key: string, options?: Record<string, unknown>) => string;
}) {
  type Snapshot = {
    total_bytes_sent: number;
    total_bytes_received: number;
  };
  const [value, setValue] = React.useState<string>("—");

  React.useEffect(() => {
    let mounted = true;
    const fetchSnapshot = async () => {
      try {
        const snap = await invoke<Snapshot | null>(
          "get_profile_traffic_snapshot",
          { profileId },
        );
        if (!mounted) return;
        if (!snap) {
          setValue("0 B");
          return;
        }
        setValue(
          formatBytes(snap.total_bytes_sent + snap.total_bytes_received),
        );
      } catch {
        if (mounted) setValue("—");
      }
    };
    void fetchSnapshot();
    const interval = window.setInterval(fetchSnapshot, 5000);
    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, [profileId]);

  return (
    <InfoCard label={t("profileInfo.fields.localDataTransfer")} value={value} />
  );
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

interface ProfileInfoLayoutProps {
  profile: BrowserProfile;
  ProfileIcon: React.ComponentType<{ className?: string }>;
  isRunning: boolean;
  isDisabled: boolean;
  networkLabel: string;
  groupName: string | null;
  extensionGroupName: string | null;
  syncMode: string;
  syncStatus: { status: string; error?: string } | undefined;
  hasTags: boolean | undefined;
  hasNote: boolean;
  copied: boolean;
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  handleCopyId: () => Promise<void>;
  onClose: () => void;
  onCloneProfile?: (profile: BrowserProfile) => void;
  onKillProfile?: (profile: BrowserProfile) => void;
  visibleActions: {
    id?: string;
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
    disabled?: boolean;
    destructive?: boolean;
    proBadge?: boolean;
    runningBadge?: boolean;
  }[];
  t: (key: string, options?: Record<string, unknown>) => string;
}

type ProfileSection =
  | "overview"
  | "fingerprint"
  | "network"
  | "cookies"
  | "extensions"
  | "sync"
  | "automation"
  | "security"
  | "delete";

function ProfileInfoLayout({
  profile,
  ProfileIcon,
  isRunning,
  isDisabled,
  networkLabel,
  groupName,
  extensionGroupName,
  syncMode,
  syncStatus,
  storedProxies,
  vpnConfigs,
  hasTags,
  hasNote,
  copied,
  handleCopyId,
  onClose,
  onCloneProfile,
  visibleActions,
  t,
}: ProfileInfoLayoutProps) {
  const [section, setSection] = React.useState<ProfileSection>("overview");

  const findAction = React.useCallback(
    (id: string) => visibleActions.find((a) => a.id === id),
    [visibleActions],
  );

  const deleteAction = findAction("delete");
  const fingerprintAction = findAction("fingerprint");
  const cookiesManageAction = findAction("cookiesManage");
  const cookiesCopyAction = findAction("cookiesCopy");
  const cookiesAction = cookiesManageAction ?? cookiesCopyAction;
  const extensionAction = findAction("extension");
  const syncAction = findAction("sync");

  const cookiesSupported = !!cookiesAction;
  const [cookieCount, setCookieCount] = React.useState<number | null>(null);
  React.useEffect(() => {
    if (!cookiesSupported || isRunning) {
      setCookieCount(null);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const data = await invoke<{ total_count: number }>(
          "get_profile_cookie_stats",
          { profileId: profile.id },
        );
        if (mounted) setCookieCount(data.total_count);
      } catch {
        if (mounted) setCookieCount(null);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [profile.id, cookiesSupported, isRunning]);

  const sidebarItems: {
    id: ProfileSection;
    icon: React.ReactNode;
    label: string;
    badge?: string;
    destructive?: boolean;
    hidden?: boolean;
  }[] = [
    {
      id: "overview",
      icon: <LuClipboard className="size-3.5" />,
      label: t("profileInfo.sections.overview"),
    },
    {
      id: "fingerprint",
      icon: <LuFingerprint className="size-3.5" />,
      label: t("profileInfo.sections.fingerprint"),
      badge: profile.password_protected
        ? t("profileInfo.badges.locked")
        : undefined,
      hidden: !fingerprintAction,
    },
    {
      id: "network",
      icon: <LuGlobe className="size-3.5" />,
      label: t("profileInfo.sections.network"),
      badge: profile.proxy_id || profile.vpn_id ? networkLabel : undefined,
    },
    {
      id: "cookies",
      icon: <LuCookie className="size-3.5" />,
      label: t("profileInfo.sections.cookies"),
      badge:
        cookieCount !== null && cookieCount > 0
          ? cookieCount.toLocaleString()
          : undefined,
      hidden: !cookiesAction,
    },
    {
      id: "extensions",
      icon: <LuPuzzle className="size-3.5" />,
      label: t("profileInfo.sections.extensions"),
      badge: extensionGroupName ?? undefined,
      hidden: !extensionAction,
    },
    {
      id: "sync",
      icon: <LuRefreshCw className="size-3.5" />,
      label: t("profileInfo.sections.sync"),
      hidden: !syncAction,
    },
    {
      id: "automation",
      icon: <LuLink className="size-3.5" />,
      label: t("profileInfo.sections.launchHook"),
      badge: profile.launch_hook ? t("profileInfo.badges.active") : undefined,
    },
    {
      id: "security",
      icon: <LuKey className="size-3.5" />,
      label: t("profileInfo.sections.security"),
    },
  ];

  return (
    <>
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <LuUsers className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-xs">
          <span className="font-semibold">
            {t("profileInfo.breadcrumbRoot")}
          </span>
          <span className="text-muted-foreground">/</span>
          <span className="truncate text-muted-foreground">{profile.name}</span>
        </div>
        {onCloneProfile && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={isDisabled}
            onClick={() => onCloneProfile(profile)}
          >
            <LuCopy className="size-3" />
            {t("profileInfo.duplicate")}
          </Button>
        )}
        <button
          type="button"
          aria-label={t("common.buttons.close")}
          onClick={onClose}
          className="grid size-7 place-items-center rounded-md text-muted-foreground transition-colors duration-100 hover:bg-accent/50 hover:text-foreground"
        >
          <LuX className="size-3.5" />
        </button>
      </div>

      <div className="flex min-h-0 flex-1">
        <nav className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2">
          {sidebarItems
            .filter((it) => !it.hidden)
            .map((it) => {
              const active = section === it.id;
              return (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => setSection(it.id)}
                  className={cn(
                    "flex h-7 items-center gap-2 rounded-md px-2 text-left text-xs transition-colors duration-100",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <span className="shrink-0">{it.icon}</span>
                  <span className="flex-1 truncate">{it.label}</span>
                  {it.badge && (
                    <span className="max-w-[60px] truncate text-[9px] tracking-wide text-muted-foreground uppercase">
                      {it.badge}
                    </span>
                  )}
                </button>
              );
            })}
          {deleteAction && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={deleteAction.onClick}
                disabled={deleteAction.disabled}
                className="flex h-7 items-center gap-2 rounded-md px-2 text-xs text-destructive transition-colors duration-100 hover:bg-destructive/10 disabled:pointer-events-none disabled:opacity-50"
              >
                <LuTrash2 className="size-3.5 shrink-0" />
                <span className="flex-1 text-left">
                  {t("profileInfo.sections.delete")}
                </span>
              </button>
            </>
          )}
        </nav>

        <div className="scroll-fade min-w-0 flex-1 overflow-y-auto p-4">
          {section === "overview" && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="shrink-0 rounded-lg bg-muted p-2.5">
                  <ProfileIcon className="size-7 text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <h3 className="truncate text-base font-semibold">
                      {profile.name}
                    </h3>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                    <span className="font-mono text-muted-foreground">
                      {profile.version}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2">
                <span className="shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
                  ID
                </span>
                <span className="flex-1 truncate font-mono text-xs">
                  {profile.id}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopyId()}
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={t("common.buttons.copy")}
                >
                  {copied ? (
                    <LuClipboardCheck className="size-3.5" />
                  ) : (
                    <LuClipboard className="size-3.5" />
                  )}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <InfoCard
                  label={t("profileInfo.fields.group")}
                  value={groupName ?? t("profileInfo.values.none")}
                />
                <InfoCard
                  label={t("profileInfo.fields.proxyVpn")}
                  value={networkLabel}
                />
                <InfoCard
                  label={t("profileInfo.fields.tags")}
                  value={
                    hasTags
                      ? (profile.tags ?? []).join(", ")
                      : t("profileInfo.values.none")
                  }
                />
                <InfoCard
                  label={t("profileInfo.fields.note")}
                  value={
                    hasNote
                      ? (profile.note ?? "")
                      : t("profileInfo.values.none")
                  }
                />
              </div>

              <div className="mt-1 flex flex-col gap-1.5">
                <span className="text-[10px] tracking-wide text-muted-foreground uppercase">
                  {t("profileInfo.sections.activity")}
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <InfoCard
                    label={t("profileInfo.fields.created")}
                    value={
                      profile.created_at
                        ? new Date(profile.created_at * 1000).toLocaleString(
                            undefined,
                            { dateStyle: "medium", timeStyle: "short" },
                          )
                        : t("profileInfo.values.unknown")
                    }
                  />
                  <InfoCard
                    label={t("profileInfo.fields.lastLaunched")}
                    value={
                      isRunning
                        ? t("profileInfo.values.activeNow")
                        : profile.last_launch
                          ? formatRelativeTime(profile.last_launch)
                          : t("profileInfo.values.never")
                    }
                  />
                  <LocalDataTransferCard profileId={profile.id} t={t} />
                </div>
              </div>

              {profile.created_by_email && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                  <p className="text-[10px] tracking-wide text-muted-foreground uppercase">
                    {t("sync.team.title")}
                  </p>
                  <p className="mt-0.5 text-sm">
                    {t("sync.team.createdBy", {
                      email: profile.created_by_email,
                    })}
                  </p>
                </div>
              )}
            </div>
          )}

          {section === "fingerprint" && (
            <FingerprintSectionInline
              profile={profile}
              isDisabled={isDisabled}
              crossOsUnlocked={Boolean(
                fingerprintAction && !fingerprintAction.proBadge,
              )}
              onSaved={onClose}
              t={t}
            />
          )}

          {section === "network" && (
            <NetworkSectionInline
              profile={profile}
              storedProxies={storedProxies}
              vpnConfigs={vpnConfigs}
              isDisabled={isDisabled}
              t={t}
            />
          )}

          {section === "cookies" && (
            <CookiesSectionInline
              profile={profile}
              isRunning={isRunning}
              isDisabled={isDisabled}
              onCopyCookies={cookiesCopyAction?.onClick}
              onImportCookies={cookiesManageAction?.onClick}
              t={t}
            />
          )}

          {section === "extensions" && (
            <ExtensionsSectionInline
              profile={profile}
              isDisabled={isDisabled}
              t={t}
            />
          )}

          {section === "sync" && (
            <SyncSectionInline
              profile={profile}
              syncMode={syncMode}
              syncStatus={syncStatus}
              isDisabled={isDisabled}
              t={t}
            />
          )}

          {section === "automation" && (
            <LaunchHookEditor profile={profile} t={t} />
          )}

          {section === "security" && (
            <SecuritySectionInline
              profile={profile}
              isRunning={isRunning}
              t={t}
            />
          )}
        </div>
      </div>
    </>
  );
}
