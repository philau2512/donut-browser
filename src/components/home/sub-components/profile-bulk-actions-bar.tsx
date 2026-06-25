"use client";

import { useTranslation } from "react-i18next";
import { FiWifi } from "react-icons/fi";
import {
  LuChevronDown,
  LuCookie,
  LuInfo,
  LuPlay,
  LuPuzzle,
  LuSquare,
  LuTrash2,
  LuUsers,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ProfileBulkActionsBarProps {
  selectedCount: number;
  bulkActionsUnlocked: boolean;
  onBulkRun?: () => void;
  onBulkStop?: () => void;
  onBulkDelete?: () => void;
  onBulkProxyAssignment?: () => void;
  onBulkCopyCookies?: () => void;
  onBulkGroupAssignment?: () => void;
  onBulkExtensionGroupAssignment?: () => void;
}

export function ProfileBulkActionsBar({
  selectedCount,
  bulkActionsUnlocked,
  onBulkRun,
  onBulkStop,
  onBulkDelete,
  onBulkProxyAssignment,
  onBulkCopyCookies,
  onBulkGroupAssignment,
  onBulkExtensionGroupAssignment,
}: ProfileBulkActionsBarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2 pb-3 pt-1 border-b border-border mb-3 select-none">
      <Button
        size="sm"
        disabled={selectedCount === 0}
        onClick={bulkActionsUnlocked && onBulkRun ? onBulkRun : undefined}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none text-white",
          selectedCount > 0
            ? "bg-blue-600 hover:bg-blue-700"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <LuPlay className="size-3.5 fill-current" />
        {selectedCount > 0
          ? t("profiles.actionBar.startCount", { count: selectedCount })
          : t("profiles.actionBar.start")}
      </Button>

      <Button
        size="sm"
        disabled={selectedCount === 0}
        onClick={bulkActionsUnlocked && onBulkStop ? onBulkStop : undefined}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none text-white",
          selectedCount > 0
            ? "bg-orange-600 hover:bg-orange-700"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <LuSquare className="size-3.5 fill-current" />
        {selectedCount > 0
          ? t("profiles.actionBar.stopCount", { count: selectedCount })
          : t("profiles.actionBar.stop")}
      </Button>

      <Button
        size="sm"
        variant="destructive"
        disabled={selectedCount === 0}
        onClick={onBulkDelete}
        className="h-8 text-xs font-semibold gap-1.5 cursor-pointer shrink-0 shadow-none"
      >
        <LuTrash2 className="size-3.5" />
        {t("common.buttons.delete")}
      </Button>

      <Button
        size="sm"
        disabled={selectedCount === 0 || !bulkActionsUnlocked}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
          selectedCount > 0 && bulkActionsUnlocked
            ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <LuPlay className="size-3.5" />
        {t("profiles.actionBar.automation")}
      </Button>

      <Button
        size="sm"
        disabled={selectedCount === 0}
        onClick={onBulkProxyAssignment}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
          selectedCount > 0
            ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <LuInfo className="size-3.5" />
        {t("profiles.actionBar.updateMultiple")}
      </Button>

      <Button
        size="sm"
        disabled={selectedCount === 0}
        onClick={onBulkProxyAssignment}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
          selectedCount > 0
            ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <FiWifi className="size-3.5" />
        {t("profiles.actionBar.proxy")}
      </Button>

      <Button
        size="sm"
        disabled={selectedCount === 0}
        onClick={onBulkCopyCookies}
        className={cn(
          "h-8 text-xs font-semibold gap-1.5 shrink-0 shadow-none text-white",
          selectedCount > 0
            ? "bg-blue-600 hover:bg-blue-700 cursor-pointer"
            : "bg-muted text-muted-foreground cursor-not-allowed opacity-50",
        )}
      >
        <LuCookie className="size-3.5" />
        {t("profiles.actionBar.exportCookies")}
      </Button>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            disabled={selectedCount === 0}
            className="h-8 text-xs font-semibold gap-1.5 border border-border cursor-pointer shrink-0"
          >
            {t("profiles.actionBar.moreAction")}
            <LuChevronDown className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {onBulkGroupAssignment && (
            <DropdownMenuItem
              onClick={onBulkGroupAssignment}
              className="cursor-pointer"
            >
              <LuUsers className="mr-2 size-4" />
              {t("profiles.actionBar.assignToGroup")}
            </DropdownMenuItem>
          )}
          {onBulkExtensionGroupAssignment && (
            <DropdownMenuItem
              onClick={onBulkExtensionGroupAssignment}
              className="cursor-pointer"
            >
              <LuPuzzle className="mr-2 size-4" />
              {t("profiles.actionBar.assignExtensionGroup")}
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
