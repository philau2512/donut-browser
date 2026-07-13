"use client";

import { type DragEvent, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuArrowLeft,
  LuCompass,
  LuCpu,
  LuDatabase,
  LuGitFork,
  LuKeyboard,
  LuMousePointer,
  LuNetwork,
  LuSearch,
  LuWrench,
  LuX,
} from "react-icons/lu";
import { Input } from "@/components/ui/input";
import {
  AUTOMATION_NODE_CATALOG,
  type AutomationNodeCatalogItem,
  type AutomationNodeGroup,
} from "@/lib/automation/node-catalog";
import { cn } from "@/lib/utils";

const GROUPS: AutomationNodeGroup[] = [
  "navigator",
  "mouse",
  "keyboard",
  "data",
  "network",
  "control",
  "utility",
  "other",
];

const GROUP_ICONS: Record<AutomationNodeGroup, any> = {
  navigator: LuCompass,
  mouse: LuMousePointer,
  keyboard: LuKeyboard,
  data: LuDatabase,
  network: LuNetwork,
  control: LuGitFork,
  utility: LuWrench,
  other: LuCpu,
  interaction: LuMousePointer, // fallback if any
};

const PALETTE_GROUP_COLORS: Record<
  AutomationNodeGroup,
  {
    border: string;
    bg: string;
    text: string;
    hoverBg: string;
    hoverBorder: string;
  }
> = {
  navigator: {
    border: "border-sky-200 dark:border-sky-900/40",
    bg: "bg-sky-500/10 dark:bg-sky-950/20",
    text: "text-sky-500",
    hoverBg: "hover:bg-sky-500/15 dark:hover:bg-sky-950/30",
    hoverBorder: "hover:border-sky-400",
  },
  mouse: {
    border: "border-rose-200 dark:border-rose-900/40",
    bg: "bg-rose-500/10 dark:bg-rose-950/20",
    text: "text-rose-500",
    hoverBg: "hover:bg-rose-500/15 dark:hover:bg-rose-950/30",
    hoverBorder: "hover:border-rose-400",
  },
  keyboard: {
    border: "border-amber-200 dark:border-amber-900/40",
    bg: "bg-amber-500/10 dark:bg-amber-950/20",
    text: "text-amber-500",
    hoverBg: "hover:bg-amber-500/15 dark:hover:bg-amber-950/30",
    hoverBorder: "hover:border-amber-400",
  },
  data: {
    border: "border-emerald-200 dark:border-emerald-900/40",
    bg: "bg-emerald-500/10 dark:bg-emerald-950/20",
    text: "text-emerald-500",
    hoverBg: "hover:bg-emerald-500/15 dark:hover:bg-emerald-950/30",
    hoverBorder: "hover:border-emerald-400",
  },
  network: {
    border: "border-indigo-200 dark:border-indigo-900/40",
    bg: "bg-indigo-500/10 dark:bg-indigo-950/20",
    text: "text-indigo-500",
    hoverBg: "hover:bg-indigo-500/15 dark:hover:bg-indigo-950/30",
    hoverBorder: "hover:border-indigo-400",
  },
  control: {
    border: "border-pink-200 dark:border-pink-900/40",
    bg: "bg-pink-500/10 dark:bg-pink-950/20",
    text: "text-pink-500",
    hoverBg: "hover:bg-pink-500/15 dark:hover:bg-pink-950/30",
    hoverBorder: "hover:border-pink-400",
  },
  utility: {
    border: "border-teal-200 dark:border-teal-900/40",
    bg: "bg-teal-500/10 dark:bg-teal-950/20",
    text: "text-teal-600 dark:text-teal-400",
    hoverBg: "hover:bg-teal-500/15 dark:hover:bg-teal-950/30",
    hoverBorder: "hover:border-teal-400",
  },
  other: {
    border: "border-slate-200 dark:border-slate-800/40",
    bg: "bg-slate-500/10 dark:bg-slate-900/20",
    text: "text-slate-500",
    hoverBg: "hover:bg-slate-500/15 dark:hover:bg-slate-900/30",
    hoverBorder: "hover:border-slate-400",
  },
  interaction: {
    border: "border-rose-200 dark:border-rose-900/40",
    bg: "bg-rose-500/10 dark:bg-rose-950/20",
    text: "text-rose-500",
    hoverBg: "hover:bg-rose-500/15 dark:hover:bg-rose-950/30",
    hoverBorder: "hover:border-rose-400",
  },
};

interface NodePaletteProps {
  onDragStart: (event: DragEvent, item: AutomationNodeCatalogItem) => void;
  onClickItem?: (item: AutomationNodeCatalogItem) => void;
}

export function NodePalette({ onDragStart, onClickItem }: NodePaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedGroup, setSelectedGroup] =
    useState<AutomationNodeGroup | null>(null);

  // Clear selected group when query is active
  useEffect(() => {
    if (query.trim()) {
      setSelectedGroup(null);
    }
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return AUTOMATION_NODE_CATALOG;
    return AUTOMATION_NODE_CATALOG.filter((item) => {
      const label = t(item.labelKey).toLowerCase();
      const desc = t(item.descriptionKey).toLowerCase();
      return (
        item.type.toLowerCase().includes(q) ||
        label.includes(q) ||
        desc.includes(q)
      );
    });
  }, [query, t]);

  const isSearching = !!query.trim();

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto pr-1">
      <div>
        <h2 className="text-sm font-semibold">
          {t("automation.editor.palette")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("automation.editor.paletteHint")}
        </p>
      </div>

      <div className="relative">
        <LuSearch className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("automation.editor.searchNodes")}
          className="pr-8 pl-8"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="-translate-y-1/2 absolute top-1/2 right-2.5 flex size-5 items-center justify-center rounded-full hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <LuX className="size-3.5" />
          </button>
        )}
      </div>

      {isSearching ? (
        /* Search results view (detailed horizontal cards in grid) */
        <div className="flex-1">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("common.labels.status", { defaultValue: "Search Results" })} (
            {filtered.length})
          </p>
          <div className="grid grid-cols-2 gap-3">
            {filtered.map((item, index) => {
              const Icon = GROUP_ICONS[item.group] || LuCpu;
              const colors =
                PALETTE_GROUP_COLORS[item.group] || PALETTE_GROUP_COLORS.other;
              return (
                <div
                  key={item.type}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onClickItem?.(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onClickItem?.(item);
                    }
                  }}
                  className={cn(
                    "flex cursor-grab rounded border bg-card/65 transition hover:shadow-sm active:cursor-grabbing min-w-0 select-none p-2 gap-2 h-24 text-left",
                    colors.border,
                    colors.hoverBg,
                    colors.hoverBorder,
                  )}
                >
                  {/* Left Column: Icon & STT */}
                  <div className="w-8 flex flex-col items-center justify-between py-0.5 border-r border-border/40 shrink-0 select-none">
                    <Icon className={cn("size-5", colors.text)} />
                    <span className="text-[9px] font-bold font-mono text-muted-foreground/60 leading-none">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                  </div>

                  {/* Right Column: Title, Description, Group Badge */}
                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div className="space-y-0.5 min-w-0">
                      <h3 className="font-bold text-[11px] leading-tight truncate text-foreground">
                        {t(item.labelKey)}
                      </h3>
                      <p className="text-[9.5px] text-muted-foreground line-clamp-2 leading-tight">
                        {t(item.descriptionKey)}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-block self-start text-[7.5px] font-bold px-1.5 py-0.5 rounded border uppercase leading-none tracking-wider scale-90 origin-left mt-0.5",
                        colors.border,
                        colors.bg,
                        colors.text,
                      )}
                    >
                      {t(`automation.editor.groups.${item.group}`)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {filtered.length === 0 && (
            <p className="py-8 text-center text-xs text-muted-foreground">
              {t("automation.editor.noMatches", {
                defaultValue: "No actions found",
              })}
            </p>
          )}
        </div>
      ) : selectedGroup === null ? (
        /* Category grid view (Main screen as compact squares) */
        <div
          className="grid gap-2 pt-1"
          style={{
            gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
          }}
        >
          {GROUPS.map((group) => {
            const Icon = GROUP_ICONS[group] || LuCpu;
            const colors =
              PALETTE_GROUP_COLORS[group] || PALETTE_GROUP_COLORS.other;
            return (
              <div
                key={group}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedGroup(group)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedGroup(group);
                  }
                }}
                className={cn(
                  "flex flex-col items-center justify-between rounded-md border p-2 text-center transition-all duration-200 hover:shadow-sm cursor-pointer select-none aspect-square w-full",
                  colors.border,
                  colors.bg,
                  colors.hoverBg,
                  colors.hoverBorder,
                )}
              >
                <span className="text-[11px] font-bold text-foreground leading-tight line-clamp-2 w-full h-8 flex items-center justify-center">
                  {t(`automation.editor.groups.${group}`)}
                </span>
                <Icon className={cn("size-7 my-auto shrink-0", colors.text)} />
              </div>
            );
          })}
        </div>
      ) : (
        /* Sub-category actions grid view */
        <div className="flex flex-col gap-3 pt-1">
          {/* BAS style header - very compact */}
          <div className="flex gap-3 items-center pb-2 border-b border-border/40">
            {/* Left side: Category card square */}
            {(() => {
              const colors =
                PALETTE_GROUP_COLORS[selectedGroup] ||
                PALETTE_GROUP_COLORS.other;
              const GroupIcon = GROUP_ICONS[selectedGroup] || LuCpu;
              return (
                <div
                  className={cn(
                    "w-12 h-12 shrink-0 flex flex-col items-center justify-center rounded border p-1 text-center select-none shadow-sm",
                    colors.border,
                    colors.bg,
                  )}
                >
                  <GroupIcon className={cn("size-5 shrink-0", colors.text)} />
                  <span className="text-[8px] font-bold text-foreground truncate w-full mt-0.5 leading-none">
                    {t(`automation.editor.groups.${selectedGroup}`)}
                  </span>
                </div>
              );
            })()}

            {/* Right side: return link & description */}
            <div className="flex-1 flex flex-col justify-center gap-1 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedGroup(null)}
                className="flex items-center gap-1 text-[10px] font-semibold text-primary hover:underline transition-all self-start"
              >
                <LuArrowLeft className="size-3" />
                <span>{t("automation.editor.returnToMain")}</span>
              </button>
              <p className="text-[9.5px] text-muted-foreground leading-tight line-clamp-2">
                {t(`automation.editor.groupDescriptions.${selectedGroup}`)}
              </p>
            </div>
          </div>

          {/* Action buttons (centered text, custom icons, compact squares) */}
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
            }}
          >
            {AUTOMATION_NODE_CATALOG.filter(
              (item) => item.group === selectedGroup,
            ).map((item) => {
              const ActionIcon = item.icon || LuCpu;
              return (
                <div
                  key={item.type}
                  role="button"
                  tabIndex={0}
                  draggable
                  onDragStart={(event) => onDragStart(event, item)}
                  onClick={() => onClickItem?.(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onClickItem?.(item);
                    }
                  }}
                  className="group flex cursor-grab flex-col items-center justify-between rounded border border-border bg-card p-2 text-center transition-all duration-200 hover:border-primary/50 hover:bg-accent/45 active:cursor-grabbing shadow-sm hover:shadow-md min-w-0 select-none aspect-square w-full"
                >
                  <span className="text-[11px] font-semibold text-foreground leading-tight line-clamp-2 w-full h-8 flex items-center justify-center">
                    {t(item.labelKey)}
                  </span>
                  <ActionIcon className="size-7 my-auto shrink-0 text-muted-foreground group-hover:text-primary transition-colors" />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
