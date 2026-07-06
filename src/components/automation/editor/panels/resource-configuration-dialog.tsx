"use client";

import { closestCenter, DndContext, DragEndEvent } from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import {
  LuCopy,
  LuFolder,
  LuFolderPlus,
  LuGripVertical,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";
import { CreateResourceWizardDialog } from "./create-resource-wizard-dialog";
import { EditResourceDialog } from "./edit-resource-dialog";

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

interface SortableResourceItemProps {
  res: ResourceDefinition;
  index: number;
  tabs: string[];
  handleMoveToTab: (id: string, tab: string) => void;
  duplicateResource: (id: string) => void;
  deleteResource: (id: string) => void;
  setEditingResource: (res: ResourceDefinition | null) => void;
  setIsEditOpen: (open: boolean) => void;
  previewValues: Record<string, string>;
  setPreviewValues: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
}

function SortableResourceItem({
  res,
  index,
  tabs,
  handleMoveToTab,
  duplicateResource,
  deleteResource,
  setEditingResource,
  setIsEditOpen,
  previewValues,
  setPreviewValues,
}: SortableResourceItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: res.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const inlineItems = res.source.inlineItems ?? [];

  return (
    <div
      ref={setNodeRef}
      style={style}
      role="button"
      tabIndex={0}
      onDoubleClick={() => {
        setEditingResource(res);
        setIsEditOpen(true);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          const target = e.target as HTMLElement;
          if (
            target.tagName === "BUTTON" ||
            target.tagName === "SELECT" ||
            target.tagName === "INPUT" ||
            target.closest("button") ||
            target.closest("select")
          ) {
            return;
          }
          e.preventDefault();
          setEditingResource(res);
          setIsEditOpen(true);
        }
      }}
      title="Double click to edit resource"
      className="group relative flex border border-zinc-800 bg-zinc-900/40 rounded transition hover:border-zinc-700/60 focus:outline-none focus:ring-1 focus:ring-purple-500 focus-within:ring-1 focus-within:ring-purple-500 cursor-pointer select-none"
    >
      {/* Column 1: Index & Variable Name (Left box / button style like BAS) */}
      <div className="w-48 bg-zinc-950/40 hover:bg-zinc-800/40 border-r border-zinc-800 p-2.5 flex items-center gap-1.5 shrink-0 rounded-l text-left group/label">
        {/* Grip handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing p-1 -ml-1 hover:bg-zinc-800 rounded shrink-0 border-0 bg-transparent outline-none focus:ring-0"
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <LuGripVertical className="size-3.5 text-zinc-500 hover:text-zinc-300" />
        </button>
        <span className="text-[11px] text-zinc-500 font-mono font-medium">
          {index + 1}.
        </span>
        <span className="text-xs text-zinc-200 font-mono font-semibold truncate group-hover/label:text-purple-400 transition">
          {res.name}
        </span>
      </div>

      {/* Column 2: Description & Control Interface (Middle area like BAS) */}
      <div className="flex-1 p-2.5 flex items-center justify-between gap-4 min-w-0">
        {/* Left sub-column: Description (Tiếng Anh/Nga làm nhãn hiển thị bên trái của control) */}
        <div className="flex-1 min-w-0">
          <span className="text-xs text-zinc-300 font-medium break-words block">
            {res.descriptionEn || res.name}
          </span>
        </div>

        {/* Divider line style */}
        <div className="h-6 w-px bg-zinc-800 shrink-0 self-center" />

        {/* Right sub-column: Control representation (options, inputs, checkbox) */}
        <div className="w-56 shrink-0 flex items-center justify-start min-w-0">
          {res.wizardType === "Checkbox" && (
            <div className="flex items-center gap-2 select-none">
              <input
                type="checkbox"
                checked={
                  (previewValues[res.name] ??
                    (res.defaultValue === "true" || inlineItems[0] === "true"
                      ? "true"
                      : "false")) === "true"
                }
                onChange={(e) => {
                  setPreviewValues((prev) => ({
                    ...prev,
                    [res.name]: e.target.checked ? "true" : "false",
                  }));
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => e.stopPropagation()}
                className="size-4 accent-purple-600 cursor-pointer"
              />
              <span className="text-xs text-zinc-400">
                {(previewValues[res.name] ??
                  (res.defaultValue === "true" || inlineItems[0] === "true"
                    ? "true"
                    : "false")) === "true"
                  ? "true"
                  : "false"}
              </span>
            </div>
          )}

          {res.wizardType === "Select" && (
            <div className="w-full space-y-1">
              {res.selectType === "Radio" ? (
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  {inlineItems.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none"
                    >
                      <input
                        type="radio"
                        name={`preview-${res.id}`}
                        checked={
                          (previewValues[res.name] ??
                            res.selectDefaultValue ??
                            res.defaultValue ??
                            inlineItems[0] ??
                            "") === opt
                        }
                        onChange={() => {
                          setPreviewValues((prev) => ({
                            ...prev,
                            [res.name]: opt,
                          }));
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="size-3 accent-purple-600"
                      />
                      <span className="truncate">{opt}</span>
                    </label>
                  ))}
                </div>
              ) : res.selectType === "Check" ? (
                <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                  {inlineItems.map((opt) => (
                    <label
                      key={opt}
                      className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none"
                    >
                      <input
                        type="checkbox"
                        checked={(
                          (previewValues[res.name] ??
                            res.selectDefaultValue ??
                            res.defaultValue ??
                            "") ||
                          ""
                        )
                          .split(",")
                          .includes(opt)}
                        onChange={(e) => {
                          setPreviewValues((prev) => {
                            const currentList = (
                              prev[res.name] ??
                              res.selectDefaultValue ??
                              res.defaultValue ??
                              ""
                            )
                              .split(",")
                              .filter(Boolean);
                            let newList;
                            if (e.target.checked) {
                              newList = [...currentList, opt];
                            } else {
                              newList = currentList.filter((x) => x !== opt);
                            }
                            return {
                              ...prev,
                              [res.name]: newList.join(","),
                            };
                          });
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onDoubleClick={(e) => e.stopPropagation()}
                        className="size-3 accent-purple-600"
                      />
                      <span className="truncate">{opt}</span>
                    </label>
                  ))}
                </div>
              ) : (
                // Default/Combo dropdown
                <select
                  value={
                    previewValues[res.name] ??
                    res.selectDefaultValue ??
                    res.defaultValue ??
                    inlineItems[0] ??
                    ""
                  }
                  onChange={(e) => {
                    setPreviewValues((prev) => ({
                      ...prev,
                      [res.name]: e.target.value,
                    }));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-full outline-none rounded focus:border-zinc-700 cursor-pointer"
                >
                  {inlineItems.map((opt) => (
                    <option
                      key={opt}
                      value={opt}
                      className="bg-zinc-900 text-zinc-300"
                    >
                      {opt}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {res.wizardType === "LinesFromFile" && (
            <div
              className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate relative group/file"
              title={previewValues[res.name] || res.source.path || ""}
            >
              <span className="truncate mr-14">
                {(previewValues[res.name] || res.source.path)
                  ? (previewValues[res.name] || res.source.path || "").split(/[\\/]/).pop()
                  : "No file chosen"}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const selected = await openTauriDialog({
                      directory: false,
                      multiple: false,
                      title: `Select File for ${res.name}`,
                      filters: [{ name: "Text Files", extensions: ["txt", "csv", "log"] }],
                    });
                    if (selected && typeof selected === "string") {
                      setPreviewValues((prev) => ({
                        ...prev,
                        [res.name]: selected,
                      }));
                    }
                  } catch (err) {
                    console.error("Failed to select file:", err);
                  }
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute right-1 top-[2px] h-[22px] text-[10px] text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded px-1.5 transition shrink-0 font-sans"
              >
                Browse
              </Button>
            </div>
          )}

          {res.wizardType === "FilesFromDirectory" && (
            <div
              className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate relative group/dir"
              title={previewValues[res.name] || res.source.path || ""}
            >
              <span className="truncate mr-14">
                {(previewValues[res.name] || res.source.path)
                  ? (previewValues[res.name] || res.source.path || "").split(/[\\/]/).pop()
                  : "No folder chosen"}
              </span>
              <Button
                type="button"
                variant="ghost"
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    const selected = await openTauriDialog({
                      directory: true,
                      multiple: false,
                      title: `Select Folder for ${res.name}`,
                    });
                    if (selected && typeof selected === "string") {
                      setPreviewValues((prev) => ({
                        ...prev,
                        [res.name]: selected,
                      }));
                    }
                  } catch (err) {
                    console.error("Failed to select directory:", err);
                  }
                }}
                onDoubleClick={(e) => e.stopPropagation()}
                className="absolute right-1 top-[2px] h-[22px] text-[10px] text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded px-1.5 transition shrink-0 font-sans"
              >
                Browse
              </Button>
            </div>
          )}

          {res.wizardType === "LinesFromUrl" && (
            <div
              className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate"
              title={res.source.path || ""}
            >
              <span className="truncate">
                {res.source.path || "No URL specified"}
              </span>
              <span className="text-[10px] text-blue-500 bg-blue-950/20 border border-blue-900/30 rounded px-1 shrink-0 ml-1">
                URL
              </span>
            </div>
          )}

          {res.wizardType === "Database" && (
            <div
              className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate"
              title={inlineItems[0] || ""}
            >
              <span className="truncate">
                {inlineItems[0] || "No connection"}
              </span>
              <span className="text-[10px] text-amber-500 bg-amber-950/20 border border-amber-900/30 rounded px-1 shrink-0 ml-1">
                DB
              </span>
            </div>
          )}

          {res.wizardType === "Information" && (
            <div
              className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 w-full truncate"
              title={inlineItems[0] || ""}
            >
              <span className="truncate italic text-zinc-500">
                {inlineItems[0] || "Info message"}
              </span>
              <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1 shrink-0 ml-1">
                Info
              </span>
            </div>
          )}

          {/* Generic values inputs (FixedString, FixedInteger, etc) */}
          {res.wizardType !== "Checkbox" &&
            res.wizardType !== "Select" &&
            res.wizardType !== "LinesFromFile" &&
            res.wizardType !== "FilesFromDirectory" &&
            res.wizardType !== "LinesFromUrl" &&
            res.wizardType !== "Database" &&
            res.wizardType !== "Information" && (
              <div className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-300 w-full">
                {res.wizardType === "FixedString" ||
                res.wizardType === "RandomString" ? (
                  <input
                    type="text"
                    value={previewValues[res.name] ?? ""}
                    onChange={(e) => {
                      setPreviewValues((prev) => ({
                        ...prev,
                        [res.name]: e.target.value,
                      }));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    placeholder="Enter value..."
                    className="bg-transparent border-0 outline-none w-full text-zinc-300 placeholder-zinc-650 h-full py-1 text-xs"
                  />
                ) : res.wizardType === "FixedInteger" ||
                  res.wizardType === "RandomInteger" ? (
                  <input
                    type="number"
                    value={previewValues[res.name] ?? ""}
                    onChange={(e) => {
                      setPreviewValues((prev) => ({
                        ...prev,
                        [res.name]: e.target.value,
                      }));
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onDoubleClick={(e) => e.stopPropagation()}
                    placeholder="Enter number..."
                    className="bg-transparent border-0 outline-none w-full text-zinc-300 placeholder-zinc-650 h-full py-1 text-xs"
                  />
                ) : (
                  <span className="truncate text-zinc-400">
                    {res.defaultValue ||
                      (res.minInteger !== undefined &&
                      res.wizardType !== "FixedString" &&
                      res.wizardType !== "RandomString"
                        ? `[${res.minInteger} .. ${res.maxInteger}]`
                        : inlineItems[0]) ||
                      "empty"}
                  </span>
                )}
                {res.wizardType !== "FixedString" &&
                  res.wizardType !== "RandomString" &&
                  res.wizardType !== "FixedInteger" &&
                  res.wizardType !== "RandomInteger" && (
                    <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1 shrink-0 ml-1">
                      Value
                    </span>
                  )}
              </div>
            )}
        </div>
      </div>

      {/* Context Menu Trigger for rightmost column / or entire item */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            className="absolute right-0 top-0 bottom-0 w-8 h-full flex items-center justify-center text-zinc-600 hover:text-zinc-300 transition-colors z-20 cursor-context-menu p-0 hover:bg-transparent rounded-none"
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <span className="text-xs select-none">⋮</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-zinc-900 border-zinc-800 text-zinc-300 text-xs min-w-[120px] z-50">
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              duplicateResource(res.id);
            }}
            className="hover:bg-zinc-800 cursor-pointer"
          >
            <LuCopy className="size-3.5 mr-2" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={(e) => {
              e.stopPropagation();
              deleteResource(res.id);
            }}
            className="hover:bg-red-950/40 text-red-400 hover:text-red-300 cursor-pointer"
          >
            <LuTrash2 className="size-3.5 mr-2" />
            Delete
          </DropdownMenuItem>
          <DropdownMenuSeparator className="bg-zinc-800" />
          <DropdownMenuLabel className="text-[10px] text-zinc-500 py-1 font-semibold uppercase tracking-wider">Move to Tab</DropdownMenuLabel>
          {tabs.map((t) => (
            <DropdownMenuItem
              key={t}
              onClick={(e) => {
                e.stopPropagation();
                handleMoveToTab(res.id, t);
              }}
              className="hover:bg-zinc-800 cursor-pointer pl-4"
            >
              {t}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

function normalizeResource(resource: ResourceDefinition): ResourceDefinition {
  const name = resource.name.trim();
  return {
    ...resource,
    name,
    limits: {
      maxSuccessUsage: Math.max(
        0,
        Number(resource.limits.maxSuccessUsage) || 0,
      ),
      maxFailUsage: Math.max(0, Number(resource.limits.maxFailUsage) || 0),
      maxSimultaneousUse: Math.max(
        1,
        Number(resource.limits.maxSimultaneousUse) || 1,
      ),
      intervalBetweenUsageMs: Math.max(
        0,
        Number(resource.limits.intervalBetweenUsageMs) || 0,
      ),
    },
  };
}
