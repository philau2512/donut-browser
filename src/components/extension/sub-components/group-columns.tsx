"use client";

import type { ColumnDef } from "@tanstack/react-table";
import {
  LuChevronDown,
  LuChevronUp,
  LuPencil,
  LuPuzzle,
  LuTrash2,
} from "react-icons/lu";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Extension, ExtensionGroup } from "@/types";
import type { SyncStatus } from "../extension-management-dialog";

export interface GroupColumnsProps {
  t: (key: string, options?: Record<string, unknown>) => string;
  extensions: Extension[];
  extSyncStatus: Record<string, SyncStatus>;
  isTogglingGroupSync: Record<string, boolean>;
  extensionIcons: Record<string, string>;
  handleToggleGroupSync: (group: ExtensionGroup) => Promise<void> | void;
  setEditingGroup: (group: ExtensionGroup | null) => void;
  setEditGroupName: (name: string) => void;
  setEditGroupExtensionIds: (ids: string[]) => void;
  setGroupToDelete: (group: ExtensionGroup | null) => void;
  getSyncStatusDot: (
    item: { sync_enabled?: boolean; last_sync?: number },
    liveStatus: SyncStatus | undefined,
    t: (key: string, options?: Record<string, unknown>) => string,
  ) => { color: string; tooltip: string; animate: boolean };
}

const MAX_VISIBLE_ICONS = 3;

export function getGroupColumns({
  t,
  extensions,
  extSyncStatus,
  isTogglingGroupSync,
  extensionIcons,
  handleToggleGroupSync,
  setEditingGroup,
  setEditGroupName,
  setEditGroupExtensionIds,
  setGroupToDelete,
  getSyncStatusDot,
}: GroupColumnsProps): ColumnDef<ExtensionGroup>[] {
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
      id: "extensions",
      size: 120,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const group = row.original;
        const groupExts = group.extension_ids
          .map((id) => extensions.find((e) => e.id === id))
          .filter(Boolean) as Extension[];
        const visibleExts = groupExts.slice(0, MAX_VISIBLE_ICONS);
        const overflowCount = groupExts.length - MAX_VISIBLE_ICONS;
        return (
          <div className="flex min-w-0 items-center gap-1">
            {visibleExts.map((ext) => (
              <Tooltip key={ext.id}>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    {renderExtensionIcon(ext, "sm")}
                  </span>
                </TooltipTrigger>
                <TooltipContent>{ext.name}</TooltipContent>
              </Tooltip>
            ))}
            {overflowCount > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge
                    variant="secondary"
                    className="h-5 shrink-0 px-1.5 text-xs"
                  >
                    +{overflowCount}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-0.5">
                    {groupExts.slice(MAX_VISIBLE_ICONS).map((ext) => (
                      <p key={ext.id} className="text-xs">
                        {ext.name}
                      </p>
                    ))}
                  </div>
                </TooltipContent>
              </Tooltip>
            )}
            {groupExts.length === 0 && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {t("extensions.noExtensionsInGroup")}
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: "sync",
      size: 88,
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const group = row.original;
        const groupSyncDot = getSyncStatusDot(
          group,
          extSyncStatus[group.id],
          t,
        );
        return (
          <div className="flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className={`size-2 rounded-full shrink-0 ${groupSyncDot.color} ${
                    groupSyncDot.animate ? "animate-pulse" : ""
                  }`}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>{groupSyncDot.tooltip}</p>
              </TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex shrink-0 items-center">
                  <AnimatedSwitch
                    checked={group.sync_enabled}
                    onCheckedChange={() => void handleToggleGroupSync(group)}
                    disabled={isTogglingGroupSync[group.id]}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {group.sync_enabled
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
        const group = row.original;
        return (
          <div className="flex shrink-0 justify-end gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => {
                    setEditingGroup(group);
                    setEditGroupName(group.name);
                    setEditGroupExtensionIds([...group.extension_ids]);
                  }}
                >
                  <LuPencil className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("common.buttons.edit")}</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-7 p-0"
                  onClick={() => {
                    setGroupToDelete(group);
                  }}
                >
                  <LuTrash2 className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t("extensions.deleteGroup")}</TooltipContent>
            </Tooltip>
          </div>
        );
      },
    },
  ];
}
