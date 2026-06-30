"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { FaChrome, FaFirefox } from "react-icons/fa";
import {
  LuChevronDown,
  LuChevronUp,
  LuPencil,
  LuPuzzle,
  LuTrash2,
} from "react-icons/lu";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Extension } from "@/types";
import type { SyncStatus } from "../extension-management-dialog";

export interface ExtensionColumnsProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  extSyncStatus: Record<string, SyncStatus>;
  isTogglingExtSync: Record<string, boolean>;
  extensionIcons: Record<string, string>;
  handleToggleExtSync: (ext: Extension) => Promise<void> | void;
  setEditingExtension: (ext: Extension | null) => void;
  setEditExtensionName: (name: string) => void;
  setPendingUpdateFile: (file: { name: string; data: number[] } | null) => void;
  setExtensionToDelete: (ext: Extension | null) => void;
  getSyncStatusDot: (
    item: { sync_enabled?: boolean; last_sync?: number },
    liveStatus: SyncStatus | undefined,
    t: (key: string, options?: Record<string, unknown>) => string,
  ) => { color: string; tooltip: string; animate: boolean };
}

export function getExtensionColumns({
  t,
  extSyncStatus,
  isTogglingExtSync,
  extensionIcons,
  handleToggleExtSync,
  setEditingExtension,
  setEditExtensionName,
  setPendingUpdateFile,
  setExtensionToDelete,
  getSyncStatusDot,
}: ExtensionColumnsProps): ColumnDef<Extension>[] {
  const renderExtensionIcon = (ext: Extension, size: "sm" | "md" = "md") => {
    const sizeClass = size === "sm" ? "size-4" : "size-5";
    if (extensionIcons[ext.id]) {
      return (
        // biome-ignore lint/performance/noImgElement: base64 data URI icons cannot use next/image
        <img
          src={extensionIcons[ext.id]}
          alt=""
          className={`${sizeClass} shrink-0 rounded-sm`}
        />
      );
    }
    return (
      <LuPuzzle className={`${sizeClass} shrink-0 text-muted-foreground`} />
    );
  };

  const renderCompatIcons = (compat: string[]) => {
    const hasChromium = compat.includes("chromium");
    const hasFirefox = compat.includes("firefox");
    if (!hasChromium && !hasFirefox) return null;
    return (
      <div className="flex shrink-0 items-center gap-1">
        {hasChromium && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <FaChrome className="size-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("extensions.compatibility.chromium")}
            </TooltipContent>
          </Tooltip>
        )}
        {hasFirefox && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <FaFirefox className="size-3.5 text-muted-foreground" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {t("extensions.compatibility.firefox")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    );
  };

  return [
    {
      id: "select",
      size: 36,
      enableSorting: false,
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllRowsSelected() ||
            (table.getIsSomeRowsSelected() && "indeterminate")
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
          onCheckedChange={(value) => {
            row.toggleSelected(!!value);
          }}
          aria-label={t("common.aria.selectRow")}
        />
      ),
    },
    {
      id: "icon",
      size: 36,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => renderExtensionIcon(row.original, "sm"),
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
        <span className="block min-w-0 truncate text-sm font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      id: "compat",
      size: 56,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => renderCompatIcons(row.original.browser_compatibility),
    },
    {
      id: "sync",
      size: 88,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const ext = row.original;
        const syncDot = getSyncStatusDot(ext, extSyncStatus[ext.id], t);
        return (
          <div className="flex shrink-0 items-center gap-2">
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
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 items-center">
                  <AnimatedSwitch
                    checked={ext.sync_enabled}
                    onCheckedChange={() => void handleToggleExtSync(ext)}
                    disabled={isTogglingExtSync[ext.id]}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {ext.sync_enabled
                    ? t("syncTooltips.disable")
                    : t("syncTooltips.enable")}
                </p>
              </TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
    {
      id: "actions",
      size: 80,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const ext = row.original;
        return (
          <div className="flex shrink-0 justify-end gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => {
                    setEditingExtension(ext);
                    setEditExtensionName(ext.name);
                    setPendingUpdateFile(null);
                  }}
                >
                  <LuPencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("extensions.editExtension")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => {
                    setExtensionToDelete(ext);
                  }}
                >
                  <LuTrash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("extensions.delete")}</TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
  ];
}
