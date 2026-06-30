"use client";

import { type DragEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuSearch } from "react-icons/lu";
import { Input } from "@/components/ui/input";
import {
  AUTOMATION_NODE_CATALOG,
  type AutomationNodeCatalogItem,
  type AutomationNodeGroup,
} from "@/lib/automation/node-catalog";

const GROUPS: AutomationNodeGroup[] = [
  "navigator",
  "mouse",
  "keyboard",
  "data",
  "network",
  "other",
];

interface NodePaletteProps {
  onDragStart: (event: DragEvent, item: AutomationNodeCatalogItem) => void;
}

export function NodePalette({ onDragStart }: NodePaletteProps) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");

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

  return (
    <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-3">
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
      <div className="space-y-4">
        {GROUPS.map((group) => {
          const items = filtered.filter((item) => item.group === group);
          if (items.length === 0) return null;
          return (
            <details key={group} open className="group space-y-2">
              <summary className="flex cursor-pointer items-center justify-between text-[10px] font-bold uppercase tracking-wider text-muted-foreground list-none select-none hover:text-foreground [&::-webkit-details-marker]:hidden">
                <span>{t(`automation.editor.groups.${group}`)}</span>
                <span className="text-[9px] text-muted-foreground transition-transform group-open:rotate-180">
                  ▼
                </span>
              </summary>
              <div className="grid grid-cols-2 gap-2 pt-1.5">
                {items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.type}
                      role="button"
                      tabIndex={0}
                      draggable
                      onDragStart={(event) => onDragStart(event, item)}
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
            </details>
          );
        })}
      </div>
    </aside>
  );
}
