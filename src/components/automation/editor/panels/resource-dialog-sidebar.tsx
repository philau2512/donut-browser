"use client";

import { LuCopy, LuPlus, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import type { ResourceDefinition } from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";

interface ResourceDialogSidebarProps {
  resources: ResourceDefinition[];
  selectedResourceId: string | null;
  onSelectResource: (resourceId: string) => void;
  onAddResource: () => void;
  onDuplicateResource: (resourceId: string) => void;
  onDeleteResource: (resourceId: string) => void;
}

export function ResourceDialogSidebar({
  resources,
  selectedResourceId,
  onSelectResource,
  onAddResource,
  onDuplicateResource,
  onDeleteResource,
}: ResourceDialogSidebarProps) {
  return (
    <aside className="flex h-full w-44 shrink-0 flex-col border-r border-zinc-700 bg-zinc-900/90">
      <div className="flex items-center justify-between border-b border-zinc-700 px-2 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-300">
          Resources
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6 text-zinc-300 hover:bg-zinc-800 hover:text-white"
          onClick={onAddResource}
        >
          <LuPlus className="size-3.5" />
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-1">
        {resources.length === 0 ? (
          <p className="px-2 py-3 text-xs italic text-zinc-500">No resources</p>
        ) : (
          resources.map((resource, index) => (
            <div key={resource.id} className="group flex items-center gap-1">
              <button
                type="button"
                className={cn(
                  "min-w-0 flex-1 rounded border px-2 py-1.5 text-left text-xs text-zinc-200 shadow-sm transition",
                  selectedResourceId === resource.id
                    ? "border-purple-500 bg-zinc-700"
                    : "border-zinc-700 bg-zinc-800 hover:bg-zinc-700",
                )}
                onClick={() => onSelectResource(resource.id)}
              >
                <span className="block truncate">
                  {index + 1}. {resource.name || "unnamed_resource"}
                </span>
              </button>
              <div className="hidden shrink-0 gap-0.5 group-hover:flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                  onClick={() => onDuplicateResource(resource.id)}
                >
                  <LuCopy className="size-3" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-red-400 hover:bg-red-950/40 hover:text-red-300"
                  onClick={() => onDeleteResource(resource.id)}
                >
                  <LuTrash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
