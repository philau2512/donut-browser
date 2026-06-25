"use client";

import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import * as React from "react";
import { useTranslation } from "react-i18next";
import {
  LuChevronDown,
  LuChevronUp,
  LuPencil,
  LuRefreshCw,
  LuTrash2,
} from "react-icons/lu";
import { toast } from "sonner";
import {
  DataTableActionBar,
  DataTableActionBarAction,
  DataTableActionBarSelection,
} from "@/components/home";
import { DeleteConfirmationDialog } from "@/components/shared";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { FadingScrollArea } from "@/components/ui/fading-scroll-area";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseBackendError, translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import type { VpnConfig } from "@/types";
import { VpnCheckButton } from "../../vpn";

type SyncStatus = "disabled" | "syncing" | "synced" | "error" | "waiting";

interface VpnListTabProps {
  vpnConfigs: VpnConfig[];
  vpnUsage: Record<string, number>;
  isLoadingVpns: boolean;
  vpnSyncStatus: Record<string, SyncStatus>;
  vpnSyncErrors: Record<string, string>;
  vpnInUse: Record<string, boolean>;
  isTogglingVpnSync: Record<string, boolean>;
  handleToggleVpnSync: (vpn: VpnConfig) => Promise<void>;
  checkingVpnId: string | null;
  setCheckingVpnId: (id: string | null) => void;
  onEditVpn: (vpn: VpnConfig) => void;
  onDeleteVpn: (vpn: VpnConfig) => void;
  isOpen: boolean;
}

function getSyncStatusDot(
  item: { sync_enabled?: boolean; last_sync?: number },
  liveStatus: SyncStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
  errorMessage?: string,
): { color: string; tooltip: string; animate: boolean } {
  const status = liveStatus ?? (item.sync_enabled ? "synced" : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("syncTooltips.syncing"),
        animate: true,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: item.last_sync
          ? t("syncTooltips.syncedAt", {
              time: new Date(item.last_sync * 1000).toLocaleString(),
            })
          : t("syncTooltips.synced"),
        animate: false,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("syncTooltips.waiting"),
        animate: false,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: errorMessage
          ? t("syncTooltips.errorWith", { error: errorMessage })
          : t("syncTooltips.error"),
        animate: false,
      };
    default:
      return {
        color: "bg-muted-foreground",
        tooltip: t("syncTooltips.notSynced"),
        animate: false,
      };
  }
}

export function VpnListTab({
  vpnConfigs,
  vpnUsage,
  isLoadingVpns,
  vpnSyncStatus,
  vpnSyncErrors,
  vpnInUse,
  isTogglingVpnSync,
  handleToggleVpnSync,
  checkingVpnId,
  setCheckingVpnId,
  onEditVpn,
  onDeleteVpn,
  isOpen,
}: VpnListTabProps) {
  const { t } = useTranslation();
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = React.useState(false);

  React.useEffect(() => {
    if (!isOpen) {
      setRowSelection({});
    }
  }, [isOpen]);

  const columns = React.useMemo<ColumnDef<VpnConfig>[]>(
    () => [
      {
        id: "select",
        size: 36,
        enableSorting: false,
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllRowsSelected()
                ? true
                : table.getIsSomeRowsSelected()
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(value) => {
              table.toggleAllRowsSelected(!!value);
            }}
            aria-label={t("common.aria.selectAll")}
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onCheckedChange={(value) => {
              row.toggleSelected(!!value);
            }}
            aria-label={t("common.aria.selectRow")}
          />
        ),
      },
      {
        accessorKey: "name",
        enableSorting: true,
        sortingFn: "alphanumeric",
        header: ({ column }) => (
          <Button
            variant="ghost"
            onClick={() => {
              column.toggleSorting(column.getIsSorted() === "asc");
            }}
            className="h-auto cursor-pointer justify-start p-0 text-left font-semibold"
          >
            {t("common.labels.name")}
            {column.getIsSorted() === "asc" ? (
              <LuChevronUp className="ml-2 size-4" />
            ) : column.getIsSorted() === "desc" ? (
              <LuChevronDown className="ml-2 size-4" />
            ) : null}
          </Button>
        ),
        cell: ({ row }) => {
          const vpn = row.original;
          const syncDot = getSyncStatusDot(
            vpn,
            vpnSyncStatus[vpn.id],
            t,
            vpnSyncErrors[vpn.id],
          );
          return (
            <div className="flex min-w-0 items-center gap-2 font-medium">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className={`size-2 rounded-full shrink-0 ${syncDot.color} ${
                      syncDot.animate ? "animate-pulse" : ""
                    }`}
                  />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{syncDot.tooltip}</p>
                </TooltipContent>
              </Tooltip>
              <span className="truncate">{vpn.name}</span>
            </div>
          );
        },
      },
      {
        id: "type",
        size: 96,
        enableSorting: false,
        header: () => t("common.labels.type"),
        cell: () => <Badge variant="outline">WG</Badge>,
      },
      {
        id: "usage",
        size: 80,
        enableSorting: false,
        header: () => t("proxies.management.usage"),
        cell: ({ row }) => (
          <Badge variant="secondary">{vpnUsage[row.original.id] ?? 0}</Badge>
        ),
      },
      {
        id: "sync",
        size: 96,
        enableSorting: false,
        header: () => t("proxies.management.syncCol"),
        cell: ({ row }) => {
          const vpn = row.original;
          const locked = vpnInUse[vpn.id];
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <AnimatedSwitch
                    checked={vpn.sync_enabled}
                    onCheckedChange={() => void handleToggleVpnSync(vpn)}
                    disabled={isTogglingVpnSync[vpn.id] || locked}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {locked ? (
                  <p>{t("syncTooltips.lockedInUse")}</p>
                ) : (
                  <p>
                    {vpn.sync_enabled
                      ? t("syncTooltips.disable")
                      : t("syncTooltips.enable")}
                  </p>
                )}
              </TooltipContent>
            </Tooltip>
          );
        },
      },
      {
        id: "actions",
        size: 144,
        enableSorting: false,
        header: () => t("common.labels.actions"),
        cell: ({ row }) => {
          const vpn = row.original;
          return (
            <div className="flex gap-1">
              <VpnCheckButton
                vpnId={vpn.id}
                vpnName={vpn.name}
                checkingVpnId={checkingVpnId}
                setCheckingVpnId={setCheckingVpnId}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onEditVpn(vpn);
                    }}
                  >
                    <LuPencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("vpns.management.editVpn")}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onDeleteVpn(vpn);
                      }}
                      disabled={(vpnUsage[vpn.id] ?? 0) > 0}
                    >
                      <LuTrash2 className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {(vpnUsage[vpn.id] ?? 0) > 0 ? (
                    <p>
                      {(vpnUsage[vpn.id] ?? 0) === 1
                        ? t("vpns.management.cannotDelete_one", {
                            count: vpnUsage[vpn.id],
                          })
                        : t("vpns.management.cannotDelete_other", {
                            count: vpnUsage[vpn.id],
                          })}
                    </p>
                  ) : (
                    <p>{t("vpns.management.deleteVpn")}</p>
                  )}
                </TooltipContent>
              </Tooltip>
            </div>
          );
        },
      },
    ],
    [
      t,
      vpnSyncStatus,
      vpnSyncErrors,
      vpnUsage,
      isTogglingVpnSync,
      vpnInUse,
      checkingVpnId,
      handleToggleVpnSync,
      setCheckingVpnId,
      onEditVpn,
      onDeleteVpn,
    ],
  );

  const table = useReactTable({
    data: vpnConfigs,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: (row) => !vpnInUse[row.original.id],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const selectedVpns = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original);

  const handleBulkDelete = React.useCallback(async () => {
    if (selectedVpns.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedVpns.map((vpn) =>
          invoke("delete_vpn_config", { vpnId: vpn.id }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        toast.success(t("vpns.management.deleteSuccess"));
      }
      if (failed > 0) {
        toast.error(t("vpns.management.deleteFailed"));
      }
      await emit("vpn-configs-changed");
      setRowSelection({});
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteDialog(false);
    }
  }, [selectedVpns, t]);

  const handleBulkToggleSync = React.useCallback(async () => {
    if (selectedVpns.length === 0) return;
    const allOn = selectedVpns.every((v) => v.sync_enabled);
    const targetEnabled = !allOn;
    const targets = selectedVpns.filter((v) =>
      targetEnabled ? !v.sync_enabled : v.sync_enabled && !vpnInUse[v.id],
    );
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((vpn) =>
        invoke("set_vpn_sync_enabled", {
          vpnId: vpn.id,
          enabled: targetEnabled,
        }),
      ),
    );
    const firstRejection = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    if (firstRejection) {
      showErrorToast(
        parseBackendError(firstRejection.reason)
          ? translateBackendError(t, firstRejection.reason)
          : t("proxies.management.updateSyncFailed"),
      );
    } else {
      showSuccessToast(
        targetEnabled
          ? t("proxies.management.syncEnabled")
          : t("proxies.management.syncDisabled"),
      );
    }
    await emit("vpn-configs-changed");
  }, [selectedVpns, vpnInUse, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {isLoadingVpns ? (
        <div className="text-sm text-muted-foreground">
          {t("vpns.management.loading")}
        </div>
      ) : vpnConfigs.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("vpns.management.noneCreated")}
        </div>
      ) : (
        <FadingScrollArea
          className={cn("min-h-0 flex-1", selectedVpns.length > 0 && "pb-16")}
          style={
            {
              "--scroll-fade-top-offset": "32px",
            } as React.CSSProperties
          }
        >
          <Table
            className="w-full table-fixed"
            containerClassName="overflow-visible"
          >
            <TableHeader className="sticky top-0 z-10 bg-background">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      style={{
                        width:
                          header.column.id === "name" ||
                          header.column.id === "hostPort"
                            ? undefined
                            : `${header.column.getSize()}px`,
                      }}
                      className={cn(
                        header.column.id === "name" && "max-w-0",
                        header.column.id === "hostPort" &&
                          "hidden max-w-0 @2xl:table-cell",
                        (header.column.id === "protocol" ||
                          header.column.id === "type") &&
                          "hidden @2xl:table-cell",
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell
                      key={cell.id}
                      style={{
                        width:
                          cell.column.id === "name" ||
                          cell.column.id === "hostPort"
                            ? undefined
                            : `${cell.column.getSize()}px`,
                      }}
                      className={cn(
                        cell.column.id === "name" && "max-w-0",
                        cell.column.id === "hostPort" &&
                          "hidden max-w-0 @2xl:table-cell",
                        (cell.column.id === "protocol" ||
                          cell.column.id === "type") &&
                          "hidden @2xl:table-cell",
                      )}
                    >
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </FadingScrollArea>
      )}

      {isOpen && (
        <DataTableActionBar table={table}>
          <DataTableActionBarSelection table={table} />
          <DataTableActionBarAction
            tooltip={t("syncTooltips.bulkToggle")}
            onClick={() => void handleBulkToggleSync()}
            size="icon"
          >
            <LuRefreshCw />
          </DataTableActionBarAction>
          <DataTableActionBarAction
            tooltip={t("common.buttons.delete")}
            onClick={() => {
              setShowBulkDeleteDialog(true);
            }}
            size="icon"
            variant="destructive"
            className="border-destructive bg-destructive/50 hover:bg-destructive/70"
          >
            <LuTrash2 />
          </DataTableActionBarAction>
        </DataTableActionBar>
      )}

      <DeleteConfirmationDialog
        isOpen={showBulkDeleteDialog}
        onClose={() => {
          setShowBulkDeleteDialog(false);
        }}
        onConfirm={handleBulkDelete}
        title={t("vpns.management.vpnsTitle")}
        description={t("proxies.bulkDelete.vpnsDescription", {
          count: selectedVpns.length,
          names: selectedVpns.map((v) => v.name).join(", "),
        })}
        confirmButtonText={t("proxies.bulkDelete.confirmButton", {
          count: selectedVpns.length,
        })}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
