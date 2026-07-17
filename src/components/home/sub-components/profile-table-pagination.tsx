"use client";

import * as React from "react";
import { useTranslation } from "react-i18next";
import { LuChevronLeft, LuChevronRight } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100, 200, 500] as const;

/** Shared control height so select / buttons / input stay aligned. */
const CTRL = "h-8 min-h-8";

interface ProfileTablePaginationProps {
  totalProfiles: number;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  onPageIndexChange: (pageIndex: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}

export function ProfileTablePagination({
  totalProfiles,
  pageIndex,
  pageSize,
  pageCount,
  onPageIndexChange,
  onPageSizeChange,
}: ProfileTablePaginationProps) {
  const { t } = useTranslation();
  const [goToDraft, setGoToDraft] = React.useState("");

  const safePageCount = Math.max(1, pageCount);
  const currentPage = Math.min(pageIndex + 1, safePageCount);

  const pageButtons = React.useMemo(() => {
    const maxButtons = 5;
    if (safePageCount <= maxButtons) {
      return Array.from({ length: safePageCount }, (_, i) => i);
    }
    const half = Math.floor(maxButtons / 2);
    let start = Math.max(0, pageIndex - half);
    const end = Math.min(safePageCount - 1, start + maxButtons - 1);
    start = Math.max(0, end - maxButtons + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [pageIndex, safePageCount]);

  const commitGoTo = () => {
    const n = Number.parseInt(goToDraft, 10);
    if (!Number.isFinite(n)) return;
    const clamped = Math.min(Math.max(n, 1), safePageCount);
    onPageIndexChange(clamped - 1);
    setGoToDraft("");
  };

  return (
    <div className="flex h-12 flex-wrap items-center justify-end gap-x-3 gap-y-2 border-t border-border px-1 text-xs text-muted-foreground">
      <span className="leading-8 tabular-nums">
        {t("profiles.pagination.total", { count: totalProfiles })}
      </span>

      <div className="flex h-8 items-center gap-1.5">
        <Select
          value={String(pageSize)}
          onValueChange={(v) => onPageSizeChange(Number(v))}
        >
          <SelectTrigger
            size="sm"
            className={cn(CTRL, "w-[4.75rem] px-2 text-xs shadow-none")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((size) => (
              <SelectItem key={size} value={String(size)} className="text-xs">
                {size}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="leading-8">{t("profiles.pagination.perPage")}</span>
      </div>

      <div className="flex h-8 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(CTRL, "w-8 shrink-0 p-0 shadow-none")}
          disabled={pageIndex <= 0}
          onClick={() => onPageIndexChange(pageIndex - 1)}
          aria-label={t("profiles.pagination.prev")}
        >
          <LuChevronLeft className="size-3.5" />
        </Button>

        {pageButtons.map((idx) => (
          <Button
            key={idx}
            type="button"
            variant="outline"
            size="icon"
            className={cn(
              CTRL,
              "w-8 shrink-0 p-0 text-xs tabular-nums shadow-none",
              idx === pageIndex &&
                "border-blue-500 text-blue-400 hover:text-blue-300",
            )}
            onClick={() => onPageIndexChange(idx)}
          >
            {idx + 1}
          </Button>
        ))}

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={cn(CTRL, "w-8 shrink-0 p-0 shadow-none")}
          disabled={pageIndex >= safePageCount - 1}
          onClick={() => onPageIndexChange(pageIndex + 1)}
          aria-label={t("profiles.pagination.next")}
        >
          <LuChevronRight className="size-3.5" />
        </Button>
      </div>

      <div className="flex h-8 items-center gap-1.5">
        <span className="leading-8">{t("profiles.pagination.goTo")}</span>
        <Input
          type="number"
          min={1}
          max={safePageCount}
          value={goToDraft}
          placeholder={String(currentPage)}
          onChange={(e) => setGoToDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitGoTo();
          }}
          onBlur={commitGoTo}
          className={cn(
            CTRL,
            "w-12 px-1.5 text-center text-xs tabular-nums shadow-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
          )}
        />
        <span className="leading-8">{t("profiles.pagination.page")}</span>
      </div>
    </div>
  );
}
