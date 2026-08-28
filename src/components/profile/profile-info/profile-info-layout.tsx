"use client";

import { invoke } from "@tauri-apps/api/core";
import Color from "color";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  LuClipboard,
  LuClipboardCheck,
  LuCookie,
  LuCopy,
  LuFingerprint,
  LuGlobe,
  LuKey,
  LuLink,
  LuPuzzle,
  LuRefreshCw,
  LuTrash2,
  LuUsers,
  LuX,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  ColorPicker,
  ColorPickerEyeDropper,
  ColorPickerFormat,
  ColorPickerHue,
  ColorPickerOutput,
  ColorPickerSelection,
} from "@/components/ui/color-picker";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { formatRelativeTime } from "@/lib/flag-utils";
import { cn } from "@/lib/utils";
import type { BrowserProfile, StoredProxy, VpnConfig } from "@/types";
import { CookiesSectionInline } from "./cookies-section";
import { ExtensionsSectionInline } from "./extensions-section";
import { FingerprintSectionInline } from "./fingerprint-section";
import { LaunchHookEditor } from "./launch-hook-editor";
import { NetworkSectionInline } from "./network-section";
import { SecuritySectionInline } from "./security-section";
import { SyncSectionInline } from "./sync-section";

export interface ProfileInfoLayoutProps {
  profile: BrowserProfile;
  ProfileIcon: React.ComponentType<{ className?: string }>;
  isRunning: boolean;
  isDisabled: boolean;
  /** Paid entitlement for cross-OS OS spoofing only (not same-host fingerprint edit). */
  crossOsUnlocked?: boolean;
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

export type ProfileSection =
  | "overview"
  | "fingerprint"
  | "network"
  | "cookies"
  | "extensions"
  | "sync"
  | "automation"
  | "security"
  | "delete";

// Shown only for legacy profiles that predate the feature and have no stored
// color yet (new profiles get a backend-derived one at creation/launch).
const DEFAULT_SWATCH_COLOR = "#94a3b8";

function WindowColorSwatch({ profile }: { profile: BrowserProfile }) {
  const { t } = useTranslation();
  const [color, setColor] = React.useState(profile.window_color);

  React.useEffect(() => {
    setColor(profile.window_color);
  }, [profile.window_color]);

  const persist = React.useCallback(
    async (hex: string) => {
      try {
        await invoke("update_profile_window_color", {
          profileId: profile.id,
          windowColor: hex,
        });
      } catch {
        setColor(profile.window_color);
      }
    },
    [profile.id, profile.window_color],
  );

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open && color && color !== profile.window_color)
          void persist(color);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t("profileInfo.fields.windowColor")}
          title={t("profileInfo.fields.windowColor")}
          className="size-9 shrink-0 cursor-pointer rounded-lg border shadow-sm ring-offset-background transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          style={{ backgroundColor: color ?? DEFAULT_SWATCH_COLOR }}
        />
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-[264px] p-3">
        <ColorPicker
          className="rounded-md border bg-background p-3 shadow-sm"
          value={color ?? DEFAULT_SWATCH_COLOR}
          onColorChange={([r, g, b]) => {
            setColor(Color({ r, g, b }).hex().toLowerCase());
          }}
        >
          <ColorPickerSelection className="h-32 rounded" />
          <div className="mt-3 flex items-center gap-3">
            <ColorPickerEyeDropper />
            <ColorPickerHue className="flex-1" />
          </div>
          <div className="mt-3 flex items-center gap-2">
            <ColorPickerOutput />
            <ColorPickerFormat />
          </div>
        </ColorPicker>
      </PopoverContent>
    </Popover>
  );
}

export function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-sm">{value}</p>
    </div>
  );
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function LocalDataTransferCard({
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

export function ProfileInfoLayout({
  profile,
  ProfileIcon,
  isRunning,
  isDisabled,
  crossOsUnlocked = false,
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

        <div
          className={cn(
            "min-w-0 flex-1",
            // Fingerprint keeps its own scroll + sticky Save/Cancel footer.
            section === "fingerprint"
              ? "flex min-h-0 flex-col overflow-hidden"
              : "scroll-fade overflow-y-auto p-4",
          )}
        >
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
                <WindowColorSwatch profile={profile} />
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
              crossOsUnlocked={crossOsUnlocked}
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
