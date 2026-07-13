"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
import { cn } from "@/lib/utils";
import { ResourceControlPreview } from "./resource-control-preview";

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
  showAdvanced?: boolean;
  onUpdateResource?: (updatedFields: Partial<ResourceDefinition>) => void;
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
  showAdvanced = false,
  onUpdateResource,
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

  const isBigControl =
    showAdvanced &&
    (res.wizardType === "LinesFromFile" ||
      res.wizardType === "FilesFromDirectory");

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
      <div
        className={cn(
          "flex-1 p-2.5 flex items-center justify-between gap-4 min-w-0",
          isBigControl && "items-start",
        )}
      >
        {/* Left sub-column: Description (Tiếng Anh/Nga làm nhãn hiển thị bên trái của control) */}
        <div
          className={cn(
            "flex-1 min-w-[160px] break-words",
            isBigControl && "pt-1",
          )}
        >
          <span className="text-xs text-zinc-300 font-medium block">
            {res.descriptionEn || res.name}
          </span>
        </div>

        {/* Divider line style */}
        <div
          className={cn(
            "h-6 w-px bg-zinc-800 shrink-0 self-center",
            isBigControl && "self-stretch h-auto",
          )}
        />

        {/* Right sub-column: Control representation (options, inputs, checkbox) */}
        <div
          className={cn(
            "w-56 shrink-0 flex items-center justify-start min-w-0",
            isBigControl && "w-[420px] flex-col items-stretch gap-2",
          )}
        >
          <ResourceControlPreview
            res={res}
            previewValues={previewValues}
            setPreviewValues={setPreviewValues}
            showAdvanced={showAdvanced}
            onUpdateResource={onUpdateResource}
          />
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
