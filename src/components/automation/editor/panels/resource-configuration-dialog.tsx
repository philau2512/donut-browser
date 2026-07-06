"use client";

import { closestCenter, DndContext, DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useEffect, useMemo, useState } from "react";
import {
  LuFolder,
  LuFolderPlus,
  LuInfo,
  LuPlus,
  LuTrash2,
} from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";
import { CreateResourceWizardDialog } from "./create-resource-wizard-dialog";
import { EditResourceDialog } from "./edit-resource-dialog";
import {
  normalizeResource,
  SortableResourceItem,
} from "./sortable-resource-item";

interface ResourceConfigurationDialogProps {
  open: boolean;
  resources: ResourceDefinition[];
  initialSelectedResourceId?: string | null;
  onOpenChange: (open: boolean) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
}

export function ResourceConfigurationDialog({
  open,
  resources,
  initialSelectedResourceId = null,
  onOpenChange,
  onResourcesChange,
}: ResourceConfigurationDialogProps) {
  const [draftResources, setDraftResources] = useState<ResourceDefinition[]>(
    [],
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );

  // Tabs management states
  const [tabs, setTabs] = useState<string[]>([]);
  const [selectedTab, setSelectedTab] = useState<string>("General");
  const [editingTabName, setEditingTabName] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Wizard state
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingResource, setEditingResource] =
    useState<ResourceDefinition | null>(null);

  // Preview runtime values state for interactive UI simulation
  const [previewValues, setPreviewValues] = useState<Record<string, string>>(
    {},
  );

  // Filter draft resources belonging to selectedTab
  const currentTabResources = useMemo(() => {
    return draftResources.filter(
      (r) => (r.tabName || "General") === selectedTab,
    );
  }, [draftResources, selectedTab]);

  // Evaluate conditional visibility (Visible if) for resources
  const isResourceVisible = useMemo(() => {
    return (res: ResourceDefinition) => {
      if (res.visibleIfVariable?.trim()) {
        const condVar = res.visibleIfVariable.trim();
        const condValue = (res.visibleIfContains || "").trim();
        const currentValue = (previewValues[condVar] || "").trim();
        return currentValue.toLowerCase().includes(condValue.toLowerCase());
      }
      return true;
    };
  }, [previewValues]);

  // Filter current tab resources that are visible
  const visibleTabResources = useMemo(() => {
    return currentTabResources.filter(isResourceVisible);
  }, [currentTabResources, isResourceVisible]);

  // Sync draftResources default values to previewValues on load/change
  useEffect(() => {
    if (!open) return;
    setPreviewValues((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const res of draftResources) {
        if (next[res.name] === undefined) {
          let val = "";
          if (res.wizardType === "Checkbox") {
            val =
              res.defaultValue === "true" ||
              res.source.inlineItems?.[0] === "true"
                ? "true"
                : "false";
          } else if (res.wizardType === "Select") {
            val =
              res.selectDefaultValue ||
              res.defaultValue ||
              res.source.inlineItems?.[0] ||
              "";
          } else {
            val = res.defaultValue || res.source.inlineItems?.[0] || "";
          }
          next[res.name] = val;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [open, draftResources]);

  useEffect(() => {
    if (!open) return;
    const cloned = structuredClone(resources) as ResourceDefinition[];
    setDraftResources(cloned);

    // Initialize tabs from existing resources
    const uniqueTabs = Array.from(
      new Set(cloned.map((r) => r.tabName || "General")),
    );
    if (uniqueTabs.length === 0) {
      uniqueTabs.push("General");
    }
    setTabs(uniqueTabs);
    setSelectedTab(uniqueTabs[0]);

    setSelectedResourceId(
      initialSelectedResourceId &&
        cloned.some((r) => r.id === initialSelectedResourceId)
        ? initialSelectedResourceId
        : (cloned[0]?.id ?? null),
    );
  }, [open, resources, initialSelectedResourceId]);

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
    setDraftResources(
      draftResources.map((r) => {
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
    if (tabs.length <= 1) return; // Cannot delete the last tab
    setTabs(tabs.filter((t) => t !== tabToDelete));
    setDraftResources(
      draftResources.filter((r) => (r.tabName || "General") !== tabToDelete),
    );
    if (selectedTab === tabToDelete) {
      const remaining = tabs.filter((t) => t !== tabToDelete);
      setSelectedTab(remaining[0]);
    }
  };

  const handleWizardConfirm = (newResource: ResourceDefinition) => {
    // Inject the currently selected tabName
    newResource.tabName = selectedTab;

    if (editingResource) {
      // Update existing resource
      setDraftResources((current) =>
        current.map((r) => (r.id === editingResource.id ? newResource : r)),
      );
      setEditingResource(null);
    } else {
      // Add new resource
      setDraftResources((current) => [...current, newResource]);
      setSelectedResourceId(newResource.id);
    }
  };

  const duplicateResource = (resourceId: string) => {
    const source = draftResources.find(
      (resource) => resource.id === resourceId,
    );
    if (!source) return;
    const id = `res-${Date.now()}`;
    const cloned: ResourceDefinition = {
      ...structuredClone(source),
      id,
      name: `${source.name || "resource"}_copy`,
    };
    setDraftResources((current) => [...current, cloned]);
    setSelectedResourceId(id);
  };

  const deleteResource = (resourceId: string) => {
    setDraftResources((current) => {
      const next = current.filter((resource) => resource.id !== resourceId);
      if (selectedResourceId === resourceId) {
        setSelectedResourceId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleMoveToTab = (resourceId: string, targetTab: string) => {
    setDraftResources(
      draftResources.map((res) => {
        if (res.id === resourceId) {
          return { ...res, tabName: targetTab };
        }
        return res;
      }),
    );
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    setDraftResources((prev) => {
      const oldIndex = prev.findIndex((r) => r.id === activeId);
      const newIndex = prev.findIndex((r) => r.id === overId);

      if (oldIndex !== -1 && newIndex !== -1) {
        return arrayMove(prev, oldIndex, newIndex);
      }
      return prev;
    });
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleOk = () => {
    onResourcesChange(draftResources.map(normalizeResource));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="h-[82vh] max-w-5xl overflow-hidden border-zinc-700 bg-zinc-900 p-0 text-zinc-100 flex flex-col"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-zinc-700 px-4 py-3 shrink-0">
          <DialogTitle className="text-sm font-semibold text-zinc-100">
            Please define resources
          </DialogTitle>
        </DialogHeader>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* LEFT COLUMN: Tab list & Actions */}
          <aside className="w-64 border-r border-zinc-700 bg-zinc-950/20 p-3 flex flex-col justify-between shrink-0">
            <div className="space-y-4">
              {/* Alert box */}
              <div className="p-3 bg-blue-950/20 border border-blue-900/30 rounded text-[11px] text-zinc-300 flex gap-2">
                <LuInfo className="size-4 text-blue-400 shrink-0" />
                <span>
                  Add all data, which script will use: files, text controls,
                  database connection.
                </span>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingResource(null);
                    setIsWizardOpen(true);
                  }}
                  className="flex-1 bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 hover:text-white text-xs h-8"
                >
                  <LuPlus className="size-3.5 mr-1" />
                  Create New Resource
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={addTab}
                  title="Create New Tab"
                  className="size-8 bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 shrink-0"
                >
                  <LuFolderPlus className="size-4" />
                </Button>
              </div>

              {/* Tabs list */}
              <div className="space-y-1">
                <Label className="text-[10px] uppercase font-bold tracking-wider text-zinc-500 block mb-1">
                  Tabs / Groups
                </Label>
                <div className="space-y-1 max-h-[35vh] overflow-y-auto pr-1">
                  {tabs.map((tab) => {
                    const isSelected = selectedTab === tab;
                    const resourceCount = draftResources.filter(
                      (r) => (r.tabName || "General") === tab,
                    ).length;

                    if (editingTabName === tab) {
                      return (
                        <div key={tab} className="p-0.5">
                          <Input
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter")
                                renameTab(tab, renameValue);
                              if (e.key === "Escape") setEditingTabName(null);
                            }}
                            onBlur={() => renameTab(tab, renameValue)}
                            autoFocus
                            className="h-8 border-zinc-700 bg-zinc-950 text-xs px-2 text-white"
                          />
                        </div>
                      );
                    }

                    return (
                      <div
                        key={tab}
                        className={cn(
                          "group flex items-center justify-between gap-1 p-1 rounded transition",
                          isSelected ? "bg-zinc-800" : "hover:bg-zinc-800/40",
                        )}
                      >
                        <button
                          type="button"
                          className={cn(
                            "flex-1 text-left px-2 py-1.5 rounded text-xs truncate font-medium",
                            isSelected
                              ? "text-white"
                              : "text-zinc-400 hover:text-zinc-200",
                          )}
                          onClick={() => setSelectedTab(tab)}
                          onDoubleClick={() => {
                            setEditingTabName(tab);
                            setRenameValue(tab);
                          }}
                        >
                          <span className="flex items-center gap-1.5">
                            <LuFolder className="size-3.5 text-zinc-500" />
                            {tab} ({resourceCount})
                          </span>
                        </button>

                        {/* Inline actions shown on hover */}
                        <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition shrink-0 pr-1">
                          {tabs.length > 1 && (
                            <button
                              type="button"
                              onClick={() => deleteTab(tab)}
                              title="Delete Tab"
                              className="p-1 hover:bg-red-950/40 rounded text-red-400 hover:text-red-300 transition"
                            >
                              <LuTrash2 className="size-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="text-[10px] text-zinc-500 italic pl-1 border-t border-zinc-800/60 pt-2 shrink-0">
              Double-click tab name to rename it.
            </div>
          </aside>

          {/* RIGHT COLUMN: Resource Variables List */}
          <main className="flex-1 bg-zinc-900/60 p-6 overflow-y-auto flex flex-col min-h-0">
            {/* Header / Info box */}
            <div className="text-center space-y-2 mb-6 max-w-md mx-auto shrink-0">
              <p className="text-zinc-400 text-xs font-semibold leading-relaxed">
                Looking for customizable user interface for your scripts? <br />
                Check{" "}
                <span className="underline cursor-pointer hover:text-purple-400">
                  interface constructor
                </span>{" "}
                (need premium).
              </p>
              <p className="text-zinc-400 text-xs leading-relaxed">
                See free{" "}
                <span className="underline cursor-pointer hover:text-purple-400">
                  demo
                </span>{" "}
                to test how it works.
                <br />
                And final result as{" "}
                <span className="underline cursor-pointer hover:text-purple-400">
                  generated interface
                </span>
                .
              </p>
            </div>

            {/* This is how user interface will look like label */}
            <div className="text-zinc-500 text-[11px] font-semibold text-center mb-5 tracking-wide shrink-0">
              This is how user interface will look like:
            </div>

            {/* Simulated UI container */}
            <div className="flex-1 min-h-[300px] border border-zinc-800 bg-zinc-950/20 rounded p-4 overflow-y-auto">
              {currentTabResources.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center p-8 border border-dashed border-zinc-850 rounded">
                  <p className="text-xs text-zinc-500 italic">
                    No resource variables in this tab.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => {
                      setEditingResource(null);
                      setIsWizardOpen(true);
                    }}
                    className="text-xs text-purple-400 hover:text-purple-300 mt-2 hover:bg-transparent"
                  >
                    + Add one now
                  </Button>
                </div>
              ) : (
                <DndContext
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={visibleTabResources.map((r) => r.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-4 max-w-2xl mx-auto">
                      {visibleTabResources.map((res, index) => (
                        <SortableResourceItem
                          key={res.id}
                          res={res}
                          index={index}
                          tabs={tabs}
                          handleMoveToTab={handleMoveToTab}
                          duplicateResource={duplicateResource}
                          deleteResource={deleteResource}
                          setEditingResource={setEditingResource}
                          setIsEditOpen={setIsEditOpen}
                          previewValues={previewValues}
                          setPreviewValues={setPreviewValues}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </main>
        </div>

        <DialogFooter className="border-t border-zinc-700 bg-zinc-800 px-3 py-2 shrink-0">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleOk}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>

      <CreateResourceWizardDialog
        open={isWizardOpen}
        onOpenChange={(val) => {
          setIsWizardOpen(val);
          if (!val) setEditingResource(null);
        }}
        onConfirm={handleWizardConfirm}
        existingNames={draftResources.map((r) => r.name)}
        editingResource={editingResource}
      />

      <EditResourceDialog
        open={isEditOpen}
        resource={editingResource}
        resources={draftResources}
        onOpenChange={(val) => {
          setIsEditOpen(val);
          if (!val) setEditingResource(null);
        }}
        onConfirm={handleWizardConfirm}
      />
    </Dialog>
  );
}
