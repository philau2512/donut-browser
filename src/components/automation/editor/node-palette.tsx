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

  const itemsCount = useMemo(() => {
    const counts: Record<string, number> = {};
    GROUPS.forEach((group) => {
      counts[group] = AUTOMATION_NODE_CATALOG.filter(
        (item) => item.group === group,
      ).length;
    });
    return counts;
  }, []);

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
          className="pl-8"
        />
      </div>

      {isSearching ? (
        /* Search results view (flat grid of actions) */
        <div className="flex-1">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("common.labels.status", { defaultValue: "Search Results" })} (
            {filtered.length})
          </p>
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((item) => {
              const Icon = item.icon;
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
                  className="flex cursor-grab items-center gap-1.5 rounded-md border border-border bg-background/50 p-2 text-left transition hover:border-primary/50 hover:bg-accent/40 active:cursor-grabbing min-w-0 select-none"
                >
                  <Icon className="size-3.5 shrink-0 text-primary" />
                  <span className="truncate text-[11px] font-semibold">
                    {t(item.labelKey)}
                  </span>
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
        /* Category grid view (Main screen) */
        <div className="grid grid-cols-2 gap-3 pt-1">
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
                  "flex flex-col items-center justify-center rounded-xl border p-4 text-center transition-all duration-200 hover:scale-[1.02] hover:shadow-sm cursor-pointer select-none h-24",
                  colors.border,
                  colors.bg,
                  colors.hoverBg,
                  colors.hoverBorder,
                )}
              >
                <Icon className={cn("size-6 mb-2 shrink-0", colors.text)} />
                <span className="text-[11px] font-bold text-foreground truncate w-full">
                  {t(`automation.editor.groups.${group}`)}
                </span>
                <span className="mt-1 text-[9px] text-muted-foreground">
                  {itemsCount[group] || 0}{" "}
                  {t("common.labels.actions").toLowerCase()}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        /* Sub-category actions grid view */
        <div className="flex flex-col gap-4 pt-1">
          {/* BAS style header */}
          <div className="flex gap-4 items-center pb-2 border-b border-border/40">
            {/* Left side: Category card square */}
            {(() => {
              const colors =
                PALETTE_GROUP_COLORS[selectedGroup] ||
                PALETTE_GROUP_COLORS.other;
              const GroupIcon = GROUP_ICONS[selectedGroup] || LuCpu;
              return (
                <div
                  className={cn(
                    "w-20 h-20 shrink-0 flex flex-col items-center justify-between rounded-md border p-2 text-center select-none shadow-sm",
                    colors.border,
                    colors.bg,
                  )}
                >
                  <span className="text-[10px] font-bold text-foreground truncate w-full">
                    {t(`automation.editor.groups.${selectedGroup}`)}
                  </span>
                  <GroupIcon className={cn("size-8 mb-0.5", colors.text)} />
                </div>
              );
            })()}

            {/* Right side: return link & description */}
            <div className="flex-1 flex flex-col justify-center gap-1.5 min-w-0">
              <button
                type="button"
                onClick={() => setSelectedGroup(null)}
                className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline transition-all self-start"
              >
                <LuArrowLeft className="size-3.5" />
                <span>{t("automation.editor.returnToMain")}</span>
              </button>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                {t(`automation.editor.groupDescriptions.${selectedGroup}`)}
              </p>
            </div>
          </div>

          {/* Action buttons (centered text, no icons, rectangular border) */}
          <div className="grid grid-cols-2 gap-2.5">
            {AUTOMATION_NODE_CATALOG.filter(
              (item) => item.group === selectedGroup,
            ).map((item) => {
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
                  className="flex cursor-grab items-center justify-center rounded border border-border bg-card p-3 text-center transition-all duration-200 hover:border-primary/50 hover:bg-accent/40 active:cursor-grabbing shadow-sm hover:shadow-md min-w-0 select-none h-11"
                >
                  <span className="truncate text-xs font-medium text-foreground">
                    {t(item.labelKey)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
