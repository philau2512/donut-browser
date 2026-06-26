"use client";

import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowData,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Dispatch, SetStateAction } from "react";
import * as React from "react";
import { useTranslation } from "react-i18next";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useProfilesTableState } from "@/hooks/use-profiles-table-state";
import { useScrollFade } from "@/hooks/use-scroll-fade";
import { getOSDisplayName, isCrossOsProfile } from "@/lib/browser-utils";
import { cn } from "@/lib/utils";
import type { BrowserProfile, SyncSessionInfo } from "@/types";
import { ProfileBulkActionsBar } from "./sub-components/profile-bulk-actions-bar";
import {
  getProfileTableColumns,
  type TableMeta,
} from "./sub-components/profile-table-columns";
import { ProfileTableDialogs } from "./sub-components/profile-table-dialogs";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData extends RowData, TValue> {
    flexWidth?: boolean;
  }
}

interface ProfilesDataTableProps {
  profiles: BrowserProfile[];
  onLaunchProfile: (profile: BrowserProfile) => void | Promise<void>;
  onKillProfile: (profile: BrowserProfile) => void | Promise<void>;
  onCloneProfile: (profile: BrowserProfile) => void | Promise<void>;
  onDeleteProfile: (profile: BrowserProfile) => void | Promise<void>;
  onRenameProfile: (profileId: string, newName: string) => Promise<void>;
  onConfigureCamoufox: (profile: BrowserProfile) => void;
  onCopyCookiesToProfile?: (profile: BrowserProfile) => void;
  onOpenCookieManagement?: (profile: BrowserProfile) => void;
  runningProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  onDeleteSelectedProfiles: (profileIds: string[]) => Promise<void>;
  onAssignProfilesToGroup: (profileIds: string[]) => void;
  selectedGroupId: string | null;
  selectedProfiles: string[];
  onSelectedProfilesChange: Dispatch<SetStateAction<string[]>>;
  onBulkDelete?: () => void;
  onBulkGroupAssignment?: () => void;
  onBulkProxyAssignment?: () => void;
  onBulkCopyCookies?: () => void;
  onBulkRun?: () => void;
  onBulkStop?: () => void;
  bulkActionsUnlocked?: boolean;
  onBulkExtensionGroupAssignment?: () => void;
  onAssignExtensionGroup?: (profileIds: string[]) => void;
  onOpenProfileSyncDialog?: (profile: BrowserProfile) => void;
  onToggleProfileSync?: (profile: BrowserProfile) => void;
  crossOsUnlocked?: boolean;
  syncUnlocked?: boolean;
  getProfileSyncInfo?: (profileId: string) =>
    | {
        session: SyncSessionInfo;
        isLeader: boolean;
        failedAtUrl: string | null;
      }
    | undefined;
  onLaunchWithSync?: (profile: BrowserProfile, followerIds?: string[]) => void;
  onSetPassword?: (profile: BrowserProfile) => void;
  onChangePassword?: (profile: BrowserProfile) => void;
  onRemovePassword?: (profile: BrowserProfile) => void;
  infoDialogProfile?: BrowserProfile | null;
  onInfoDialogProfileChange?: (profile: BrowserProfile | null) => void;
  onQuickProxyEdit?: (profile: BrowserProfile) => void;
  onBulkTagsAssignment?: () => void;
  onAssignTags?: (profileIds: string[]) => void;
}

export function ProfilesDataTable({
  profiles,
  onLaunchProfile,
  onKillProfile,
  onCloneProfile,
  onDeleteProfile,
  onRenameProfile,
  onConfigureCamoufox,
  onCopyCookiesToProfile,
  onOpenCookieManagement,
  runningProfiles,
  isUpdating,
  onAssignProfilesToGroup,
  selectedProfiles,
  onSelectedProfilesChange,
  onBulkDelete,
  onBulkGroupAssignment,
  onBulkProxyAssignment,
  onQuickProxyEdit,
  onBulkCopyCookies,
  onBulkRun,
  onBulkStop,
  bulkActionsUnlocked = false,
  onBulkExtensionGroupAssignment,
  onAssignExtensionGroup,
  onOpenProfileSyncDialog,
  onToggleProfileSync,
  crossOsUnlocked = false,
  syncUnlocked = false,
  getProfileSyncInfo,
  onLaunchWithSync,
  onSetPassword,
  onChangePassword,
  onRemovePassword,
  infoDialogProfile,
  onInfoDialogProfileChange,
  onBulkTagsAssignment,
  onAssignTags,
}: ProfilesDataTableProps) {
  const {
    sorting,
    rowSelection,
    showCheckboxes,
    profileToRename,
    setProfileToRename,
    newProfileName,
    setNewProfileName,
    renameError,
    setRenameError,
    isRenamingSaving,
    renameContainerRef,
    profileToDelete,
    setProfileToDelete,
    isDeleting,
    handleDelete,
    profileForInfoDialog,
    setProfileForInfoDialog,
    bypassRulesProfile,
    setBypassRulesProfile,
    dnsBlocklistProfile,
    setDnsBlocklistProfile,
    launchHookProfile,
    setLaunchHookProfile,
    launchingProfiles,
    setLaunchingProfiles,
    stoppingProfiles,
    setStoppingProfiles,
    storedProxies,
    vpnConfigs,
    proxyOverrides,
    vpnOverrides,
    tagsOverrides,
    setTagsOverrides,
    allTags,
    setAllTags,
    openTagsEditorFor,
    setOpenTagsEditorFor,
    openProxySelectorFor,
    setOpenProxySelectorFor,
    checkingProfileId,
    proxyCheckResults,
    noteOverrides,
    setNoteOverrides,
    openNoteEditorFor,
    setOpenNoteEditorFor,
    trafficSnapshots,
    trafficDialogProfile,
    setTrafficDialogProfile,
    syncStatuses,
    countries,
    extensionGroups,
    canCreateLocationProxy,
    loadCountries,
    handleProxySelection,
    handleVpnSelection,
    handleCreateCountryProxy,
    browserState,
    isProfileLocked,
    getLockInfo,
    handleSortingChange,
    handleRowSelectionChange,
    handleToggleAll,
    handleCheckboxChange,
    handleIconClick,
    handleRename,
    selectableProfiles,
  } = useProfilesTableState({
    profiles,
    runningProfiles,
    isUpdating,
    selectedProfiles,
    onSelectedProfilesChange,
    onRenameProfile,
    onDeleteProfile,
    infoDialogProfile,
    onInfoDialogProfileChange,
  });

  const { t } = useTranslation();

  const tableMeta = React.useMemo<TableMeta>(
    () => ({
      t,
      selectedProfiles,
      selectableCount: selectableProfiles.length,
      showCheckboxes,
      isClient: browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      browserState,

      renameContainerRef,

      tagsOverrides,
      allTags,
      openTagsEditorFor,
      setAllTags,
      setOpenTagsEditorFor,
      setTagsOverrides,

      noteOverrides,
      openNoteEditorFor,
      setOpenNoteEditorFor,
      setNoteOverrides,

      openProxySelectorFor,
      setOpenProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,

      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,

      extensionGroups,
      onAssignExtensionGroup,
      setDnsBlocklistProfile,
      onAssignTags,

      isProfileSelected: (id: string) => selectedProfiles.includes(id),
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,

      handleRename,
      setProfileToRename,
      setNewProfileName,
      setRenameError,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      renameError,

      setLaunchingProfiles,
      setStoppingProfiles,
      onKillProfile,
      onLaunchProfile,

      onAssignProfilesToGroup,
      onCloneProfile: onCloneProfile
        ? (profile: BrowserProfile) => {
            void onCloneProfile(profile);
          }
        : undefined,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,
      onQuickProxyEdit,
      setProfileForInfoDialog,

      trafficSnapshots,
      onOpenTrafficDialog: (profileId: string) => {
        const profile = profiles.find((p) => p.id === profileId);
        setTrafficDialogProfile({ id: profileId, name: profile?.name });
      },

      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,

      countries,
      canCreateLocationProxy,
      loadCountries,
      handleCreateCountryProxy,

      isProfileLockedByAnother: isProfileLocked,
      getProfileLockEmail: (profileId: string) =>
        getLockInfo(profileId)?.lockedByEmail,

      getProfileSyncInfo: getProfileSyncInfo ?? (() => undefined),
      onLaunchWithSync:
        onLaunchWithSync ??
        (() => {
          /* empty */
        }),
    }),
    [
      t,
      selectedProfiles,
      selectableProfiles.length,
      showCheckboxes,
      browserState,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
      isUpdating,
      tagsOverrides,
      allTags,
      openTagsEditorFor,
      noteOverrides,
      openNoteEditorFor,
      openProxySelectorFor,
      proxyOverrides,
      storedProxies,
      handleProxySelection,
      checkingProfileId,
      proxyCheckResults,
      vpnConfigs,
      vpnOverrides,
      handleVpnSelection,
      extensionGroups,
      onAssignExtensionGroup,
      handleToggleAll,
      handleCheckboxChange,
      handleIconClick,
      handleRename,
      profileToRename,
      newProfileName,
      isRenamingSaving,
      trafficSnapshots,
      profiles,
      renameError,
      onKillProfile,
      onLaunchProfile,
      onAssignProfilesToGroup,
      onCloneProfile,
      onConfigureCamoufox,
      onCopyCookiesToProfile,
      onOpenCookieManagement,
      onQuickProxyEdit,
      setProfileForInfoDialog,
      syncStatuses,
      onOpenProfileSyncDialog,
      onToggleProfileSync,
      crossOsUnlocked,
      syncUnlocked,
      countries,
      loadCountries,
      handleCreateCountryProxy,
      isProfileLocked,
      getLockInfo,
      getProfileSyncInfo,
      onLaunchWithSync,
      setTagsOverrides,
      setTrafficDialogProfile,
      setStoppingProfiles,
      setRenameError,
      setProfileToRename,
      setOpenTagsEditorFor,
      setOpenProxySelectorFor,
      setNewProfileName,
      setOpenNoteEditorFor,
      setLaunchingProfiles,
      renameContainerRef,
      setNoteOverrides,
      setDnsBlocklistProfile,
      setAllTags,
      canCreateLocationProxy,
      onAssignTags,
    ],
  );

  const columns = React.useMemo(() => getProfileTableColumns(t), [t]);

  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({ created_at: false });

  const [containerWidth, setContainerWidth] = React.useState(0);

  const table = useReactTable({
    data: profiles,
    columns,
    state: {
      sorting,
      rowSelection,
      columnVisibility,
    },
    onSortingChange: handleSortingChange,
    onRowSelectionChange: handleRowSelectionChange,
    onColumnVisibilityChange: setColumnVisibility,
    enableRowSelection: (row) => {
      const profile = row.original;
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    },
    getSortedRowModel: getSortedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    meta: tableMeta,
  });

  const scrollParentRef = React.useRef<HTMLDivElement | null>(null);
  const columnWidth = React.useCallback(
    (id: string, sizePx: number) => {
      const proportions: Record<string, { pct: number; floor: number }> = {
        tags: { pct: 0.12, floor: 100 },
        note: { pct: 0.1, floor: 80 },
        proxy: { pct: 0.13, floor: 110 },
        ext: { pct: 0.11, floor: 95 },
        dns: { pct: 0.11, floor: 95 },
      };
      const p = proportions[id];
      if (!p) return `${sizePx}px`;
      return `${Math.max(p.floor, Math.round(containerWidth * p.pct))}px`;
    },
    [containerWidth],
  );
  const sortedRows = table.getRowModel().rows;
  useScrollFade(scrollParentRef);

  React.useEffect(() => {
    const el = scrollParentRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      setContainerWidth(Math.round(w / 8) * 8);
      setColumnVisibility((prev) => {
        const next: VisibilityState = {
          created_at: false,
          dns: w >= 768,
          ext: w >= 672,
          note: w >= 576,
          tags: w >= 512,
        };
        return Object.keys(next).every((k) => prev[k] === next[k])
          ? prev
          : next;
      });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  const ROW_HEIGHT = 36;

  const rowVirtualizer = useVirtualizer({
    count: sortedRows.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();
  const paddingTop = virtualRows.length > 0 ? virtualRows[0].start : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - virtualRows[virtualRows.length - 1].end
      : 0;

  const selectedCount = selectedProfiles.length;

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <ProfileBulkActionsBar
          selectedCount={selectedCount}
          bulkActionsUnlocked={bulkActionsUnlocked}
          onBulkRun={onBulkRun}
          onBulkStop={onBulkStop}
          onBulkDelete={onBulkDelete}
          onBulkProxyAssignment={onBulkProxyAssignment}
          onBulkCopyCookies={onBulkCopyCookies}
          onBulkGroupAssignment={onBulkGroupAssignment}
          onBulkExtensionGroupAssignment={onBulkExtensionGroupAssignment}
          onBulkTagsAssignment={onBulkTagsAssignment}
          onBulkSync={
            onLaunchWithSync
              ? () => {
                  const selectedRows = table.getFilteredSelectedRowModel().rows;
                  if (selectedRows.length === 0) return;
                  const leader = selectedRows[0].original;
                  const followerIds = selectedRows
                    .slice(1)
                    .map((r) => r.original.id);
                  onLaunchWithSync(leader, followerIds);
                }
              : undefined
          }
        />

        <div
          ref={scrollParentRef}
          className={cn("scroll-fade relative min-h-0 flex-1 overflow-auto")}
          style={
            {
              "--scroll-fade-top-offset": "32px",
            } as React.CSSProperties
          }
        >
          <Table className="table-fixed" containerClassName="overflow-visible">
            <TableHeader className="sticky top-0 z-10 overflow-visible bg-background [&_tr]:border-0">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow
                  key={headerGroup.id}
                  className="overflow-visible border-0!"
                >
                  {headerGroup.headers.map((header) => {
                    return (
                      <TableHead
                        key={header.id}
                        style={{
                          width: header.column.columnDef.meta?.flexWidth
                            ? undefined
                            : columnWidth(
                                header.column.id,
                                header.column.getSize(),
                              ),
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext(),
                            )}
                      </TableHead>
                    );
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody className="overflow-visible">
              {sortedRows.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={table.getVisibleLeafColumns().length}
                    className="h-24 text-center"
                  >
                    {t("profiles.table.empty")}
                  </TableCell>
                </TableRow>
              ) : (
                <>
                  {paddingTop > 0 && (
                    <tr style={{ height: `${paddingTop}px` }}>
                      <td colSpan={table.getVisibleLeafColumns().length} />
                    </tr>
                  )}
                  {virtualRows.map((virtualRow) => {
                    const row = sortedRows[virtualRow.index];
                    const rowIsCrossOs = isCrossOsProfile(row.original);
                    const crossOsTitle = rowIsCrossOs
                      ? t("crossOs.viewOnly", {
                          os: getOSDisplayName(
                            row.original.host_os ||
                              row.original.camoufox_config?.os ||
                              row.original.wayfern_config?.os ||
                              "",
                          ),
                        })
                      : undefined;
                    return (
                      <TableRow
                        key={row.id}
                        data-state={row.getIsSelected() && "selected"}
                        title={crossOsTitle}
                        style={{ height: `${ROW_HEIGHT}px` }}
                        className={cn(
                          "overflow-visible border-0! hover:bg-accent/50",
                          rowIsCrossOs && "opacity-60",
                        )}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <TableCell
                            key={cell.id}
                            className="overflow-visible py-0"
                            style={{
                              width: cell.column.columnDef.meta?.flexWidth
                                ? undefined
                                : columnWidth(
                                    cell.column.id,
                                    cell.column.getSize(),
                                  ),
                            }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                  {paddingBottom > 0 && (
                    <tr style={{ height: `${paddingBottom}px` }}>
                      <td colSpan={table.getVisibleLeafColumns().length} />
                    </tr>
                  )}
                </>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      <ProfileTableDialogs
        profiles={profiles}
        vpnConfigs={vpnConfigs}
        storedProxies={storedProxies}
        profileForInfoDialog={profileForInfoDialog}
        setProfileForInfoDialog={setProfileForInfoDialog}
        runningProfiles={runningProfiles}
        launchingProfiles={launchingProfiles}
        stoppingProfiles={stoppingProfiles}
        isClient={browserState.isClient}
        syncStatuses={syncStatuses}
        profileToDelete={profileToDelete}
        setProfileToDelete={setProfileToDelete}
        isDeleting={isDeleting}
        handleDelete={handleDelete}
        bypassRulesProfile={bypassRulesProfile}
        setBypassRulesProfile={setBypassRulesProfile}
        dnsBlocklistProfile={dnsBlocklistProfile}
        setDnsBlocklistProfile={setDnsBlocklistProfile}
        launchHookProfile={launchHookProfile}
        setLaunchHookProfile={setLaunchHookProfile}
        trafficDialogProfile={trafficDialogProfile}
        setTrafficDialogProfile={setTrafficDialogProfile}
        onOpenProfileSyncDialog={onOpenProfileSyncDialog}
        onAssignProfilesToGroup={onAssignProfilesToGroup}
        onConfigureCamoufox={onConfigureCamoufox}
        onCopyCookiesToProfile={onCopyCookiesToProfile}
        onOpenCookieManagement={onOpenCookieManagement}
        onAssignExtensionGroup={onAssignExtensionGroup}
        onCloneProfile={onCloneProfile}
        onLaunchWithSync={onLaunchWithSync}
        onSetPassword={onSetPassword}
        onChangePassword={onChangePassword}
        onRemovePassword={onRemovePassword}
        crossOsUnlocked={crossOsUnlocked}
      />
    </>
  );
}
