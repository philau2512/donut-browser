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
import type { ProxyCheckResult, StoredProxy } from "@/types";
import { ProxyCheckButton } from "../proxy-check-button";

type SyncStatus = "disabled" | "syncing" | "synced" | "error" | "waiting";

interface ProxyListTabProps {
  storedProxies: StoredProxy[];
  proxyUsage: Record<string, number>;
  isLoading: boolean;
  proxySyncStatus: Record<string, SyncStatus>;
  proxySyncErrors: Record<string, string>;
  proxyInUse: Record<string, boolean>;
  isTogglingSync: Record<string, boolean>;
  handleToggleSync: (proxy: StoredProxy) => Promise<void>;
  checkingProxyId: string | null;
  setCheckingProxyId: (id: string | null) => void;
  proxyCheckResults: Record<string, ProxyCheckResult>;
  setProxyCheckResults: React.Dispatch<
    React.SetStateAction<Record<string, ProxyCheckResult>>
  >;
  onEditProxy: (proxy: StoredProxy) => void;
  onDeleteProxy: (proxy: StoredProxy) => void;
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

export function ProxyListTab({
  storedProxies,
  proxyUsage,
  isLoading,
  proxySyncStatus,
  proxySyncErrors,
  proxyInUse,
  isTogglingSync,
  handleToggleSync,
  checkingProxyId,
  setCheckingProxyId,
  proxyCheckResults,
  setProxyCheckResults,
  onEditProxy,
  onDeleteProxy,
  isOpen,
}: ProxyListTabProps) {
  const { t } = useTranslation();
  const [sorting, setSorting] = React.useState<SortingState>([
    { id: "name", desc: false },
  ]);
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});

  const [isBulkDeleting, setIsBulkDeleting] = React.useState(false);
  const [showBulkDeleteDialog, setShowBulkDeleteDialog] = React.useState(false);

  // Reset selection when tab closes / dialog closes
  React.useEffect(() => {
    if (!isOpen) {
      setRowSelection({});
    }
  }, [isOpen]);

  const columns = React.useMemo<ColumnDef<StoredProxy>[]>(
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
        id: "status",
        size: 28,
        enableSorting: false,
        header: () => null,
        cell: ({ row }) => {
          const proxy = row.original;
          const syncDot = getSyncStatusDot(
            proxy,
            proxySyncStatus[proxy.id],
            t,
            proxySyncErrors[proxy.id],
          );
          return (
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
          );
        },
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
        cell: ({ row }) => (
          <span className="block truncate font-medium">
            {row.original.name}
          </span>
        ),
      },
      {
        id: "protocol",
        size: 96,
        enableSorting: false,
        header: () => t("proxies.management.protocolCol"),
        cell: ({ row }) => (
          <span className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
            {row.original.proxy_settings.proxy_type}
          </span>
        ),
      },
      {
        id: "hostPort",
        enableSorting: false,
        header: () => t("proxies.management.hostPort"),
        cell: ({ row }) => (
          <span className="block truncate font-mono text-xs text-muted-foreground">
            {row.original.proxy_settings.host}:
            {row.original.proxy_settings.port}
          </span>
        ),
      },
      {
        id: "usage",
        size: 80,
        enableSorting: false,
        header: () => t("proxies.management.usage"),
        cell: ({ row }) => (
          <Badge variant="secondary">{proxyUsage[row.original.id] ?? 0}</Badge>
        ),
      },
      {
        id: "sync",
        size: 96,
        enableSorting: false,
        header: () => t("proxies.management.syncCol"),
        cell: ({ row }) => {
          const proxy = row.original;
          const locked = proxyInUse[proxy.id];
          return (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex items-center">
                  <AnimatedSwitch
                    checked={proxy.sync_enabled}
                    onCheckedChange={() => void handleToggleSync(proxy)}
                    disabled={isTogglingSync[proxy.id] || locked}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {locked ? (
                  <p>{t("syncTooltips.lockedInUse")}</p>
                ) : (
                  <p>
                    {proxy.sync_enabled
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
          const proxy = row.original;
          return (
            <div className="flex gap-1">
              <ProxyCheckButton
                proxy={proxy}
                profileId={proxy.id}
                checkingProfileId={checkingProxyId}
                cachedResult={proxyCheckResults[proxy.id]}
                setCheckingProfileId={setCheckingProxyId}
                onCheckComplete={(result) => {
                  setProxyCheckResults((prev) => ({
                    ...prev,
                    [proxy.id]: result,
                  }));
                }}
                onCheckFailed={(result) => {
                  setProxyCheckResults((prev) => ({
                    ...prev,
                    [proxy.id]: result,
                  }));
                }}
              />
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onEditProxy(proxy);
                    }}
                  >
                    <LuPencil className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("proxies.management.editProxy")}</p>
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        onDeleteProxy(proxy);
                      }}
                      disabled={(proxyUsage[proxy.id] ?? 0) > 0}
                    >
                      <LuTrash2 className="size-4" />
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {(proxyUsage[proxy.id] ?? 0) > 0 ? (
                    <p>
                      {(proxyUsage[proxy.id] ?? 0) === 1
                        ? t("proxies.management.cannotDelete_one", {
                            count: proxyUsage[proxy.id],
                          })
                        : t("proxies.management.cannotDelete_other", {
                            count: proxyUsage[proxy.id],
                          })}
                    </p>
                  ) : (
                    <p>{t("proxies.management.deleteProxy")}</p>
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
      proxySyncStatus,
      proxySyncErrors,
      proxyUsage,
      isTogglingSync,
      proxyInUse,
      checkingProxyId,
      proxyCheckResults,
      handleToggleSync,
      setProxyCheckResults,
      setCheckingProxyId,
      onEditProxy,
      onDeleteProxy,
    ],
  );

  const table = useReactTable({
    data: storedProxies,
    columns,
    state: {
      sorting,
      rowSelection,
    },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: (row) => !proxyInUse[row.original.id],
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.id,
  });

  const selectedProxies = table
    .getFilteredSelectedRowModel()
    .rows.map((row) => row.original);

  const handleBulkDelete = React.useCallback(async () => {
    if (selectedProxies.length === 0) return;
    setIsBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        selectedProxies.map((proxy) =>
          invoke("delete_stored_proxy", { proxyId: proxy.id }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      const succeeded = results.length - failed;
      if (succeeded > 0) {
        toast.success(t("proxies.management.deleteSuccess"));
      }
      if (failed > 0) {
        toast.error(t("proxies.management.deleteFailed"));
      }
      await emit("stored-proxies-changed");
      setRowSelection({});
    } finally {
      setIsBulkDeleting(false);
      setShowBulkDeleteDialog(false);
    }
  }, [selectedProxies, t]);

  const handleBulkToggleSync = React.useCallback(async () => {
    if (selectedProxies.length === 0) return;
    const allOn = selectedProxies.every((p) => p.sync_enabled);
    const targetEnabled = !allOn;
    const targets = selectedProxies.filter((p) =>
      targetEnabled ? !p.sync_enabled : p.sync_enabled && !proxyInUse[p.id],
    );
    if (targets.length === 0) return;
    const results = await Promise.allSettled(
      targets.map((proxy) =>
        invoke("set_proxy_sync_enabled", {
          proxyId: proxy.id,
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
    await emit("stored-proxies-changed");
  }, [selectedProxies, proxyInUse, t]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      {isLoading ? (
        <div className="text-sm text-muted-foreground">
          {t("proxies.management.loading")}
        </div>
      ) : storedProxies.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          {t("proxies.management.noneCreated")}
        </div>
      ) : (
        <FadingScrollArea
          className={cn(
            "min-h-0 flex-1",
            selectedProxies.length > 0 && "pb-16",
          )}
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
        title={t("proxies.bulkDelete.proxiesTitle")}
        description={t("proxies.bulkDelete.proxiesDescription", {
          count: selectedProxies.length,
          names: selectedProxies.map((p) => p.name).join(", "),
        })}
        confirmButtonText={t("proxies.bulkDelete.confirmButton", {
          count: selectedProxies.length,
        })}
        isLoading={isBulkDeleting}
      />
    </div>
  );
}
