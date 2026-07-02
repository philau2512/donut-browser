"use client";

import { useTranslation } from "react-i18next";
import { LuPlus } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  makeDefaultResourceDefinition,
  type ResourceDefinition,
} from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";

interface ResourceManagerPanelProps {
  resources: ResourceDefinition[];
  onChange: (resources: ResourceDefinition[]) => void;
  onDoubleClickResource?: (id: string) => void;
  disabled?: boolean;
}

export function ResourceManagerPanel({
  resources,
  onChange,
  onDoubleClickResource,
  disabled = false,
}: ResourceManagerPanelProps) {
  const { t } = useTranslation();

  function addResource() {
    const id = `res-${Date.now()}`;
    const nextNumber = resources.length + 1;
    const newRes = makeDefaultResourceDefinition({
      id,
      name: `data_input_${nextNumber}`,
    });
    onChange([...resources, newRes]);
    // Automatically open the edit modal for the newly created resource
    onDoubleClickResource?.(id);
  }

  return (
    <div className="flex h-full flex-col bg-card rounded-md">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("automation.editor.resources.title", "Resources")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={addResource}
          disabled={disabled}
          title={t("automation.editor.resources.add", "Add resource")}
        >
          <LuPlus className="size-3.5" />
        </Button>
      </div>

      {/* Resource list */}
      <div className="flex-1 min-h-0 divide-y divide-border overflow-y-auto">
        {resources.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {t(
              "automation.editor.resources.empty",
              "No resources defined. Double-click to edit or create new.",
            )}
          </p>
        )}
        {resources.map((r) => (
          <button
            key={r.id}
            type="button"
            onDoubleClick={() => onDoubleClickResource?.(r.id)}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-xs hover:bg-muted/40 transition-colors select-none",
            )}
          >
            <span className="truncate font-semibold text-foreground">
              {r.name || (
                <span className="italic text-muted-foreground">
                  {t("automation.editor.resources.unnamed", "unnamed")}
                </span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Badge
                variant="outline"
                className="text-[9px] px-1 bg-background/50"
              >
                {r.type}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-[9px] px-1 bg-background/50",
                  r.direction === "output" &&
                    "text-amber-400 border-amber-400/40",
                  r.direction === "read-write" &&
                    "text-blue-400 border-blue-400/40",
                )}
              >
                {r.direction}
              </Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
