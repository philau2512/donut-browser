"use client";

import { type ColumnDef, type RowData } from "@tanstack/react-table";
import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { FiMoreVertical, FiWifi } from "react-icons/fi";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuPlay,
  LuSquare,
} from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useBrowserState } from "@/hooks/use-browser-state";
import {
  getBrowserDisplayName,
  getProfileIcon,
  isCrossOsProfile,
} from "@/lib/browser-utils";
import { formatRelativeTime, getFlagIconClass } from "@/lib/flag-utils";
import { cn } from "@/lib/utils";
import type {
  BrowserProfile,
  ExtensionGroup,
  LocationItem,
  ProxyCheckResult,
  StoredProxy,
  SyncSessionInfo,
  TrafficSnapshot,
  VpnConfig,
} from "@/types";
import { NoteCell } from "./note-cell";
import { OverflowTooltipText } from "./overflow-tooltip";
import { TagsCell } from "./tags-cell";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    flexWidth?: boolean;
  }
}

export interface TableMeta {
  t: (key: string, options?: Record<string, unknown>) => string;
  selectedProfiles: string[];
  selectableCount: number;
  showCheckboxes: boolean;
  isClient: boolean;
  runningProfiles: Set<string>;
  launchingProfiles: Set<string>;
  stoppingProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  browserState: ReturnType<typeof useBrowserState>;

  // Refs
  renameContainerRef: React.RefObject<HTMLDivElement | null>;

  // Tags editor state
  tagsOverrides: Record<string, string[]>;
  allTags: string[];
  openTagsEditorFor: string | null;
  setAllTags: React.Dispatch<React.SetStateAction<string[]>>;
  setOpenTagsEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setTagsOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string[]>>
  >;

  // Note editor state
  noteOverrides: Record<string, string | null>;
  openNoteEditorFor: string | null;
  setOpenNoteEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setNoteOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;

  // Proxy selector state
  openProxySelectorFor: string | null;
  setOpenProxySelectorFor: React.Dispatch<React.SetStateAction<string | null>>;
  proxyOverrides: Record<string, string | null>;
  storedProxies: StoredProxy[];
  handleProxySelection: (
    profileId: string,
    proxyId: string | null,
  ) => void | Promise<void>;
  checkingProfileId: string | null;
  proxyCheckResults: Record<string, ProxyCheckResult>;

  // VPN selector state
  vpnConfigs: VpnConfig[];
  vpnOverrides: Record<string, string | null>;
  handleVpnSelection: (
    profileId: string,
    vpnId: string | null,
  ) => void | Promise<void>;

  // Extension groups
  extensionGroups: ExtensionGroup[];

  // Click handlers for inline Ext / DNS cell editing
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  setDnsBlocklistProfile: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;

  // Selection helpers
  isProfileSelected: (id: string) => boolean;
  handleToggleAll: (checked: boolean) => void;
  handleCheckboxChange: (id: string, checked: boolean) => void;
  handleIconClick: (id: string) => void;

  // Rename helpers
  handleRename: () => void | Promise<void>;
  setProfileToRename: React.Dispatch<
    React.SetStateAction<BrowserProfile | null>
  >;
  setNewProfileName: React.Dispatch<React.SetStateAction<string>>;
  setRenameError: React.Dispatch<React.SetStateAction<string | null>>;
  profileToRename: BrowserProfile | null;
  newProfileName: string;
  isRenamingSaving: boolean;
  renameError: string | null;

  // Launch/stop helpers
  setLaunchingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  setStoppingProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;

  // Overflow actions
  onAssignProfilesToGroup?: (profileIds: string[]) => void;
  onConfigureCamoufox?: (profile: BrowserProfile) => void;
  onCloneProfile?: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  onBulkProxyAssignment?: (profileIds: string[]) => void;
  onQuickProxyEdit?: (profile: BrowserProfile) => void;
  onAssignTags?: (profileIds: string[]) => void;
  onDeleteProfile?: (profile: BrowserProfile) => void;
  setProfileForInfoDialog: (profile: BrowserProfile | null) => void;

  // Traffic snapshots
  trafficSnapshots: Record<string, TrafficSnapshot>;
  onOpenTrafficDialog?: (profileId: string) => void;

  // Sync
  syncStatuses: Record<string, { status: string; error?: string }>;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;

  // Country proxy creation
  countries: LocationItem[];
  canCreateLocationProxy: boolean;
  loadCountries: () => Promise<void>;
  handleCreateCountryProxy: (
    profileId: string,
    country: LocationItem,
  ) => Promise<void>;

  // Team locks
  isProfileLockedByAnother: (profileId: string) => boolean;
  getProfileLockEmail: (profileId: string) => string | undefined;

  // Synchronizer
  getProfileSyncInfo: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync: (profile: BrowserProfile, followerIds?: string[]) => void;
}

const _MAX_VISIBLE_ICONS = 3;

export function getProfileTableColumns(
  t: (key: string) => string,
): ColumnDef<BrowserProfile>[] {
  return [
    {
      id: "select",
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return (
          <span>
            <Checkbox
              checked={
                meta.selectedProfiles.length === meta.selectableCount &&
                meta.selectableCount !== 0
              }
              onCheckedChange={(value) => {
                meta.handleToggleAll(!!value);
              }}
              aria-label={t("common.aria.selectAll")}
              className="cursor-pointer"
            />
          </span>
        );
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isSelected = meta.isProfileSelected(profile.id);

        return (
          <span className="flex size-4 items-center justify-center">
            <Checkbox
              checked={isSelected}
              onCheckedChange={(value) => {
                meta.handleCheckboxChange(profile.id, !!value);
              }}
              aria-label={t("common.aria.selectRow")}
              className="size-4"
            />
          </span>
        );
      },
      enableSorting: false,
      enableHiding: false,
      size: 28,
    },
    {
      accessorKey: "name",
      meta: { flexWidth: true },
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        const sort = table.getState().sorting[0];
        const isActive = (id: string, desc: boolean) =>
          sort?.id === id && !!sort.desc === desc;
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="h-auto cursor-pointer justify-start p-0 text-left font-semibold hover:bg-transparent"
              >
                {meta.t("common.labels.name")}
                {isActive("name", false) ? (
                  <LuChevronUp className="ml-2 size-4" />
                ) : isActive("name", true) ? (
                  <LuChevronDown className="ml-2 size-4" />
                ) : (
                  <LuChevronDown className="ml-2 size-4 opacity-50" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem
                onClick={() => table.setSorting([{ id: "name", desc: false }])}
              >
                {isActive("name", false) && (
                  <LuCheck className="mr-2 size-3.5" />
                )}
                {meta.t("profiles.sort.nameAsc")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => table.setSorting([{ id: "name", desc: true }])}
              >
                {isActive("name", true) && (
                  <LuCheck className="mr-2 size-3.5" />
                )}
                {meta.t("profiles.sort.nameDesc")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  table.setSorting([{ id: "created_at", desc: true }])
                }
              >
                {isActive("created_at", true) && (
                  <LuCheck className="mr-2 size-3.5" />
                )}
                {meta.t("profiles.sort.newest")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() =>
                  table.setSorting([{ id: "created_at", desc: false }])
                }
              >
                {isActive("created_at", false) && (
                  <LuCheck className="mr-2 size-3.5" />
                )}
                {meta.t("profiles.sort.oldest")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        );
      },
      enableSorting: true,
      sortingFn: "alphanumeric",
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original as BrowserProfile;
        const rawName: string = row.getValue("name");
        const name = getBrowserDisplayName(rawName);
        const isEditing = meta.profileToRename?.id === profile.id;

        if (isEditing) {
          return (
            <div
              ref={meta.renameContainerRef}
              className="relative overflow-visible"
            >
              <Input
                autoFocus
                value={meta.newProfileName}
                onChange={(e) => {
                  meta.setNewProfileName(e.target.value);
                  if (meta.renameError) meta.setRenameError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !(e.metaKey || e.ctrlKey)) {
                    void meta.handleRename();
                  } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    void meta.handleRename();
                  } else if (e.key === "Escape") {
                    meta.setProfileToRename(null);
                    meta.setNewProfileName("");
                    meta.setRenameError(null);
                  }
                }}
                onBlur={() => {
                  if (
                    meta.newProfileName.trim().length > 0 &&
                    meta.newProfileName.trim() !== profile.name
                  ) {
                    void meta.handleRename();
                  } else {
                    meta.setProfileToRename(null);
                    meta.setNewProfileName("");
                    meta.setRenameError(null);
                  }
                }}
                className="h-6 w-full max-w-full min-w-0 border-0 px-2 py-1 text-sm leading-none font-medium shadow-none focus-visible:ring-0"
              />
            </div>
          );
        }

        // Browser icon
        const BrowserIcon = getProfileIcon(profile);

        // Chromium/Firefox version major
        const versionMajor = profile.version
          ? profile.version.split(".")[0]
          : "142";

        return (
          <div className="flex w-full min-w-0 items-center gap-3 overflow-hidden py-0.5">
            <button
              type="button"
              className={cn(
                "h-6 max-w-[240px] truncate rounded border-none bg-transparent px-2 py-1 text-left grow min-w-0",
                "cursor-pointer hover:bg-accent/50 text-sm font-medium",
              )}
              onClick={() => {
                meta.setProfileToRename(profile);
                meta.setNewProfileName(profile.name);
                meta.setRenameError(null);
              }}
            >
              <OverflowTooltipText text={name} className="text-left" />
            </button>

            <div className="flex items-center gap-1.5 shrink-0 bg-secondary/50 border border-border px-2 py-0.5 rounded-md text-[10px] text-muted-foreground select-none font-mono ml-auto mr-2">
              {/* Browser icon */}
              {BrowserIcon && (
                <BrowserIcon className="size-3 text-foreground" />
              )}
              {/* Version */}
              <span>{versionMajor}</span>
            </div>
          </div>
        );
      },
    },
    {
      id: "proxy",
      size: 120,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profiles.table.proxy");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const effectiveProxyId = profile.proxy_id;
        const effectiveProxy = effectiveProxyId
          ? meta.storedProxies.find((p) => p.id === effectiveProxyId)
          : null;
        const vpnId = profile.vpn_id;
        const effectiveVpn = vpnId
          ? meta.vpnConfigs.find((v) => v.id === vpnId)
          : null;

        const hasProxy = !!effectiveProxyId || !!vpnId;

        let proxyDisplay = "DIRECT";
        if (effectiveVpn) {
          proxyDisplay = `WG: ${effectiveVpn.name}`;
        } else if (effectiveProxy) {
          proxyDisplay = `${effectiveProxy.proxy_settings.host}:${effectiveProxy.proxy_settings.port}`;
        }

        const countryCode = effectiveProxy?.geo_country;

        return (
          <div className="flex items-center gap-2 text-xs">
            <button
              type="button"
              className={cn(
                "flex items-center gap-1.5 px-2 py-0.5 rounded border border-border/50 transition-colors cursor-pointer",
                hasProxy
                  ? "bg-success/10 text-success border-success/30 hover:bg-success/20"
                  : "bg-muted text-muted-foreground hover:bg-accent",
              )}
              onClick={(e) => {
                e.stopPropagation();
                meta.onQuickProxyEdit?.(profile);
              }}
              title={proxyDisplay}
            >
              {/* Status Indicator Dot */}
              <span
                className={cn(
                  "size-1.5 rounded-full shrink-0",
                  hasProxy
                    ? "bg-success animate-pulse"
                    : "bg-muted-foreground/40",
                )}
              />

              {/* Icon flag or wifi */}
              {countryCode ? (
                <span
                  className={cn(
                    "size-3 rounded-xs shrink-0 inline-block",
                    getFlagIconClass(countryCode),
                  )}
                />
              ) : (
                <FiWifi className={cn("size-3", hasProxy && "text-success")} />
              )}

              <span className="font-mono text-[10px] max-w-[80px] truncate">
                {proxyDisplay}
              </span>
            </button>
          </div>
        );
      },
    },
    {
      id: "tags",
      size: 100,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profileTable.tagsHeader");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isCrossOs = isCrossOsProfile(profile);
        const isCrossOsBlocked = isCrossOs;
        const isRunning = meta.isClient && meta.runningProfiles.has(profile.id);
        const isLaunching = meta.launchingProfiles.has(profile.id);
        const isStopping = meta.stoppingProfiles.has(profile.id);
        const isDisabled =
          isRunning || isLaunching || isStopping || isCrossOsBlocked;

        return (
          <TagsCell
            profile={profile}
            isDisabled={isDisabled}
            tagsOverrides={meta.tagsOverrides ?? {}}
            onAssignTags={meta.onAssignTags}
          />
        );
      },
    },
    {
      id: "note",
      size: 80,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profileTable.noteHeader");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isCrossOs = isCrossOsProfile(profile);
        const isCrossOsBlocked = isCrossOs;
        const isRunning = meta.isClient && meta.runningProfiles.has(profile.id);
        const isLaunching = meta.launchingProfiles.has(profile.id);
        const isStopping = meta.stoppingProfiles.has(profile.id);
        const isDisabled =
          isRunning || isLaunching || isStopping || isCrossOsBlocked;

        return (
          <NoteCell
            profile={profile}
            isDisabled={isDisabled}
            noteOverrides={meta.noteOverrides ?? {}}
            openNoteEditorFor={meta.openNoteEditorFor ?? null}
            setOpenNoteEditorFor={meta.setOpenNoteEditorFor}
            setNoteOverrides={meta.setNoteOverrides}
          />
        );
      },
    },
    {
      id: "last_open",
      size: 110,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profiles.table.lastOpen");
      },
      cell: ({ row }) => {
        const profile = row.original;
        if (!profile.last_launch)
          return <span className="text-muted-foreground/50 text-xs">---</span>;
        return (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="opacity-70 text-[10px]">⏱</span>
            <span>{formatRelativeTime(profile.last_launch)}</span>
          </div>
        );
      },
    },
    {
      id: "status",
      size: 90,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profiles.table.status");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isRunning = meta.isClient && meta.runningProfiles.has(profile.id);
        const isLaunching = meta.launchingProfiles.has(profile.id);
        const isStopping = meta.stoppingProfiles.has(profile.id);

        let statusText = meta.t("profiles.status.ready");
        let statusStyle = "bg-success/15 text-success border border-success/30";

        if (isRunning) {
          statusText = meta.t("profiles.status.running");
          statusStyle =
            "bg-blue-500/15 text-blue-500 border border-blue-500/30";
        } else if (isLaunching) {
          statusText = meta.t("profiles.status.launching");
          statusStyle =
            "bg-warning/15 text-warning border border-warning/30 animate-pulse";
        } else if (isStopping) {
          statusText = meta.t("profiles.status.stopping");
          statusStyle =
            "bg-destructive/15 text-destructive border border-destructive/30";
        } else if (!profile.last_launch) {
          statusText = meta.t("profiles.status.noStatus");
          statusStyle = "bg-muted text-muted-foreground border border-border";
        }

        return (
          <Badge
            className={cn(
              "px-2 py-0.5 rounded-sm text-[10px] font-medium shadow-none select-none",
              statusStyle,
            )}
          >
            {statusText}
          </Badge>
        );
      },
    },
    {
      id: "message",
      size: 100,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profiles.table.message");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isRunning = meta.isClient && meta.runningProfiles.has(profile.id);
        const isLaunching = meta.launchingProfiles.has(profile.id);
        const isStopping = meta.stoppingProfiles.has(profile.id);

        let msg = "Ready";
        if (isRunning) msg = "Running";
        else if (isLaunching) msg = "Launching...";
        else if (isStopping) msg = "Stopping...";

        return (
          <span className="text-xs text-muted-foreground truncate max-w-full block">
            {msg}
          </span>
        );
      },
    },
    {
      id: "actions",
      size: 110,
      header: ({ table }) => {
        const meta = table.options.meta as TableMeta;
        return meta.t("profiles.table.actions");
      },
      cell: ({ row, table }) => {
        const meta = table.options.meta as TableMeta;
        const profile = row.original;
        const isRunning = meta.isClient && meta.runningProfiles.has(profile.id);
        const isLaunching = meta.launchingProfiles.has(profile.id);
        const isStopping = meta.stoppingProfiles.has(profile.id);
        const isLockedByAnother = meta.isProfileLockedByAnother(profile.id);
        const isSyncing = meta.syncStatuses[profile.id]?.status === "syncing";
        const canLaunch =
          meta.browserState.canLaunchProfile(profile) &&
          !isLockedByAnother &&
          !isSyncing;

        const handleProfileStop = async (profile: BrowserProfile) => {
          meta.setStoppingProfiles((prev) => new Set(prev).add(profile.id));
          try {
            await meta.onKillProfile(profile);
          } catch (error) {
            meta.setStoppingProfiles((prev) => {
              const next = new Set(prev);
              next.delete(profile.id);
              return next;
            });
            throw error;
          }
        };

        const handleProfileLaunch = async (profile: BrowserProfile) => {
          meta.setLaunchingProfiles((prev) => new Set(prev).add(profile.id));
          try {
            await meta.onLaunchProfile(profile);
          } catch (error) {
            meta.setLaunchingProfiles((prev) => {
              const next = new Set(prev);
              next.delete(profile.id);
              return next;
            });
            throw error;
          }
        };

        const handleStop = async () => {
          const syncInfo = meta.getProfileSyncInfo(profile.id);
          if (syncInfo?.isLeader) {
            await invoke("stop_sync_session", {
              sessionId: syncInfo.session.id,
            });
          } else if (syncInfo?.isLeader === false) {
            await invoke("remove_sync_follower", {
              sessionId: syncInfo.session.id,
              followerProfileId: profile.id,
            });
          } else {
            await handleProfileStop(profile);
          }
        };

        return (
          <div className="flex items-center justify-end gap-1.5 w-full">
            <Button
              size="sm"
              variant={isRunning ? "destructive" : "default"}
              disabled={!canLaunch || isLaunching || isStopping}
              onClick={() =>
                isRunning
                  ? void handleStop()
                  : void handleProfileLaunch(profile)
              }
              className={cn(
                "h-7 px-3 text-xs font-semibold gap-1 shrink-0 shadow-none cursor-pointer",
                isRunning
                  ? "bg-orange-600 hover:bg-orange-700 text-white"
                  : "bg-blue-600 hover:bg-blue-700 text-white",
              )}
            >
              {isLaunching || isStopping ? (
                <div className="size-3 animate-spin rounded-full border border-current border-t-transparent" />
              ) : isRunning ? (
                <>
                  <LuSquare className="size-3 fill-current" />
                  {meta.t("profiles.actions.stop")}
                </>
              ) : (
                <>
                  <LuPlay className="size-3 fill-current" />
                  {meta.t("profiles.actions.launch")}
                </>
              )}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 p-0 hover:bg-accent cursor-pointer shrink-0"
                >
                  <span className="sr-only">Menu</span>
                  <FiMoreVertical className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem
                  onClick={() => {
                    meta.setProfileToRename(profile);
                    meta.setNewProfileName(profile.name);
                    meta.setRenameError(null);
                  }}
                >
                  {meta.t("profiles.menu.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => meta.setProfileForInfoDialog(profile)}
                >
                  {meta.t("profiles.menu.edit")}
                </DropdownMenuItem>
                {meta.onCopyCookiesToProfile && (
                  <DropdownMenuItem
                    onClick={() => meta.onCopyCookiesToProfile?.(profile)}
                  >
                    {meta.t("profiles.menu.copyCookies")}
                  </DropdownMenuItem>
                )}
                {meta.onOpenCookieManagement && (
                  <DropdownMenuItem
                    onClick={() => meta.onOpenCookieManagement?.(profile)}
                  >
                    {meta.t("profiles.menu.manageCookies")}
                  </DropdownMenuItem>
                )}
                {meta.onCloneProfile && (
                  <DropdownMenuItem
                    onClick={() => meta.onCloneProfile?.(profile)}
                  >
                    {meta.t("profiles.menu.clone")}
                  </DropdownMenuItem>
                )}
                {meta.onAssignProfilesToGroup && (
                  <DropdownMenuItem
                    onClick={() => meta.onAssignProfilesToGroup?.([profile.id])}
                  >
                    {meta.t("profiles.menu.assignGroup")}
                  </DropdownMenuItem>
                )}
                {meta.onAssignExtensionGroup && (
                  <DropdownMenuItem
                    onClick={() => meta.onAssignExtensionGroup?.([profile.id])}
                  >
                    {meta.t("profiles.menu.assignExtension")}
                  </DropdownMenuItem>
                )}
                {meta.onConfigureCamoufox && profile.browser === "camoufox" && (
                  <DropdownMenuItem
                    onClick={() => meta.onConfigureCamoufox?.(profile)}
                  >
                    {meta.t("profiles.menu.configureCamoufox")}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => meta.onDeleteProfile?.(profile)}
                >
                  {meta.t("common.buttons.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      },
    },
  ];
}
