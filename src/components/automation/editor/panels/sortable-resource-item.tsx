"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { LuCopy, LuGripVertical, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";

export interface SortableResourceItemProps {
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

export function SortableResourceItem({
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
                {previewValues[res.name] || res.source.path
                  ? (previewValues[res.name] || res.source.path || "")
                      .split(/[\\/]/)
                      .pop()
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
                      filters: [
                        {
                          name: "Text Files",
                          extensions: ["txt", "csv", "log"],
                        },
                      ],
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
                {previewValues[res.name] || res.source.path
                  ? (previewValues[res.name] || res.source.path || "")
                      .split(/[\\/]/)
                      .pop()
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
        <DropdownMenuContent
          align="end"
          className="bg-zinc-900 border-zinc-800 text-zinc-300 text-xs min-w-[120px] z-50"
        >
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
          <DropdownMenuLabel className="text-[10px] text-zinc-500 py-1 font-semibold uppercase tracking-wider">
            Move to Tab
          </DropdownMenuLabel>
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

export function normalizeResource(
  resource: ResourceDefinition,
): ResourceDefinition {
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
