"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  LuCopy,
  LuFolder,
  LuFolderPlus,
  LuPlus,
  LuTrash2,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  makeDefaultResourceDefinition,
  type ResourceDefinition,
} from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";

interface ResourceManagerPanelProps {
  resources: ResourceDefinition[];
  onChange: (resources: ResourceDefinition[]) => void;
  onAddResource?: () => void;
  onDoubleClickResource?: (id: string) => void;
  disabled?: boolean;
}

export function ResourceManagerPanel({
  resources,
  onChange,
  onAddResource,
  onDoubleClickResource,
  disabled = false,
}: ResourceManagerPanelProps) {
  const { t } = useTranslation();

  // Tabs management states
  const [tabs, setTabs] = useState<string[]>(["General"]);
  const [selectedTab, setSelectedTab] = useState<string>("General");
  const [editingTabName, setEditingTabName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Sync tabs from resources
  useEffect(() => {
    const uniqueTabs = Array.from(
      new Set(resources.map((r) => r.tabName || "General")),
    );
    setTabs((prev) => {
      const merged = Array.from(new Set([...prev, ...uniqueTabs]));
      if (merged.length === 0) merged.push("General");
      return merged;
    });
  }, [resources]);

  const addTab = () => {
    let nextNum = 1;
    let newTabName = `Tab ${nextNum}`;
    while (tabs.includes(newTabName)) {
      nextNum++;
      newTabName = `Tab ${nextNum}`;
    }
    setTabs([...tabs, newTabName]);
    setSelectedTab(newTabName);
  };

  const renameTab = (oldName: string, newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed || oldName === trimmed) {
      setEditingTabName(null);
      return;
    }
    if (tabs.includes(trimmed)) {
      setEditingTabName(null);
      return;
    }
    setTabs(tabs.map((t) => (t === oldName ? trimmed : t)));
    onChange(
      resources.map((r) => {
        if ((r.tabName || "General") === oldName) {
          return { ...r, tabName: trimmed };
        }
        return r;
      }),
    );
    if (selectedTab === oldName) {
      setSelectedTab(trimmed);
    }
    setEditingTabName(null);
  };

  const deleteTab = (tabToDelete: string) => {
    if (tabs.length <= 1) return;
    setTabs(tabs.filter((t) => t !== tabToDelete));
    onChange(resources.filter((r) => (r.tabName || "General") !== tabToDelete));
    if (selectedTab === tabToDelete) {
      const remaining = tabs.filter((t) => t !== tabToDelete);
      setSelectedTab(remaining[0]);
    }
  };

  function addResource() {
    const id = `res-${Date.now()}`;
    const nextNumber = resources.length + 1;
    const newRes = makeDefaultResourceDefinition({
      id,
      name: `data_input_${nextNumber}`,
      tabName: selectedTab,
    });
    onChange([...resources, newRes]);
    onDoubleClickResource?.(id);
  }

  const duplicateResource = (resourceId: string) => {
    const source = resources.find((r) => r.id === resourceId);
    if (!source) return;
    const id = `res-${Date.now()}`;
    const cloned: ResourceDefinition = {
      ...structuredClone(source),
      id,
      name: `${source.name || "resource"}_copy`,
    };
    onChange([...resources, cloned]);
    onDoubleClickResource?.(id);
  };

  const deleteResource = (resourceId: string) => {
    onChange(resources.filter((r) => r.id !== resourceId));
  };

  const handleMoveToTab = (resourceId: string, targetTab: string) => {
    onChange(
      resources.map((r) => {
        if (r.id === resourceId) {
          return { ...r, tabName: targetTab };
        }
        return r;
      }),
    );
  };

  // Filter current tab resources
  const currentTabResources = useMemo(() => {
    return resources.filter((r) => (r.tabName || "General") === selectedTab);
  }, [resources, selectedTab]);

  return (
    <div className="flex h-full flex-col bg-card rounded-md">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("automation.editor.resources.title", "Resources")}
        </span>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={addTab}
            disabled={disabled}
            title="Create New Tab"
          >
            <LuFolderPlus className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={onAddResource || addResource}
            disabled={disabled}
            title={t("automation.editor.resources.add", "Add resource")}
          >
            <LuPlus className="size-3.5" />
          </Button>
        </div>
      </div>

      {/* 2-Column Body */}
      <div className="flex-1 min-h-0 flex overflow-hidden divide-x divide-border">
        {/* LEFT COLUMN: Tabs */}
        <aside className="w-28 shrink-0 bg-muted/10 flex flex-col justify-between overflow-y-auto p-1.5 space-y-2">
          <div className="space-y-1">
            {tabs.map((tab) => {
              const isSelected = selectedTab === tab;
              const resourceCount = resources.filter(
                (r) => (r.tabName || "General") === tab,
              ).length;

              if (editingTabName === tab) {
                return (
                  <div key={tab} className="p-0.5">
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameTab(tab, renameValue);
                        if (e.key === "Escape") setEditingTabName(null);
                      }}
                      onBlur={() => renameTab(tab, renameValue)}
                      autoFocus
                      className="h-7 border-zinc-700 bg-zinc-950 text-[10px] px-1 text-white"
                    />
                  </div>
                );
              }

              return (
                <div
                  key={tab}
                  className={cn(
                    "group flex items-center justify-between gap-1 p-0.5 rounded transition",
                    isSelected ? "bg-muted-foreground/15" : "hover:bg-muted/40",
                  )}
                >
                  <button
                    type="button"
                    className={cn(
                      "flex-1 text-left px-1 py-1 rounded text-[10px] truncate font-medium",
                      isSelected
                        ? "text-foreground font-semibold"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                    onClick={() => setSelectedTab(tab)}
                    onDoubleClick={() => {
                      setEditingTabName(tab);
                      setRenameValue(tab);
                    }}
                  >
                    <span className="flex items-center gap-1">
                      <LuFolder className="size-3 text-muted-foreground shrink-0" />
                      <span className="truncate">
                        {tab} ({resourceCount})
                      </span>
                    </span>
                  </button>

                  {tabs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => deleteTab(tab)}
                      title="Delete Tab"
                      className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-destructive/20 rounded text-destructive transition shrink-0"
                    >
                      <LuTrash2 className="size-2.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="text-[8px] text-muted-foreground italic pl-1 border-t border-border/50 pt-1 shrink-0 select-none">
            Double-click to rename.
          </div>
        </aside>

        {/* RIGHT COLUMN: Variables List */}
        <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5 bg-card/40">
          {currentTabResources.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center p-4 border border-dashed border-border/50 rounded">
              <p className="text-[10px] text-muted-foreground italic">
                No variables in this tab.
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={addResource}
                className="text-[10px] text-primary hover:text-primary/80 mt-1 hover:bg-transparent h-6"
              >
                + Add one
              </Button>
            </div>
          ) : (
            currentTabResources.map((r) => (
              <div
                key={r.id}
                role="button"
                tabIndex={0}
                onDoubleClick={() => onDoubleClickResource?.(r.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    onDoubleClickResource?.(r.id);
                  }
                }}
                className="group flex items-center justify-between h-8 px-2 border border-border/60 bg-muted/20 hover:bg-muted/40 rounded cursor-pointer transition select-none relative focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary"
              >
                <span className="text-[11px] font-mono text-foreground truncate max-w-[120px]">
                  {r.name}
                </span>

                {/* Right side status / hover menu */}
                <div className="flex items-center gap-1 shrink-0">
                  {/* Visual checkbox simulation just like image 1 */}
                  {((r.wizardType === "Checkbox" &&
                    (r.defaultValue === "true" ||
                      r.source.inlineItems?.[0] === "true")) ||
                    r.wizardType === "Select") && (
                    <div className="size-3.5 bg-muted border border-border flex items-center justify-center rounded">
                      <span className="text-[8px] text-foreground font-bold">
                        ✓
                      </span>
                    </div>
                  )}

                  {/* Actions on hover */}
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition ml-1">
                    {/* Move selector */}
                    <select
                      value={r.tabName || "General"}
                      onChange={(e) => {
                        e.stopPropagation();
                        handleMoveToTab(r.id, e.target.value);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="bg-background border border-border rounded px-0.5 text-[8px] text-muted-foreground outline-none cursor-pointer h-5 max-w-[50px]"
                    >
                      {tabs.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateResource(r.id);
                      }}
                      className="p-0.5 hover:bg-muted-foreground/10 rounded text-muted-foreground hover:text-foreground transition"
                      title="Duplicate"
                    >
                      <LuCopy className="size-2.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteResource(r.id);
                      }}
                      className="p-0.5 hover:bg-destructive/20 rounded text-destructive transition"
                      title="Delete"
                    >
                      <LuTrash2 className="size-2.5" />
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
