"use client";

// VariableManagerPanel — Phase 5 (resource allocation plan).
//
// CRUD for flow VariableDefinition[] with [[variable]] syntax preview.
// State ownership: manages variable form drafts internally.
// Does NOT own resource state or runtime lease data.

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LuCopy, LuPlus, LuTrash2 } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  makeDefaultVariableDefinition,
  type VariableDefinition,
  type VariableScope,
  type VariableValueType,
} from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";

interface VariableManagerPanelProps {
  variables: VariableDefinition[];
  onChange: (variables: VariableDefinition[]) => void;
  disabled?: boolean;
}

export function VariableManagerPanel({
  variables,
  onChange,
  disabled = false,
}: VariableManagerPanelProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedVar = variables.find((v) => v.id === selectedId) ?? null;

  function addVariable() {
    const id = `var-${Date.now()}`;
    const newVar = makeDefaultVariableDefinition({ id, name: "" });
    onChange([...variables, newVar]);
    setSelectedId(id);
  }

  function deleteVariable(id: string) {
    onChange(variables.filter((v) => v.id !== id));
    if (selectedId === id) setSelectedId(null);
  }

  function updateVariable(id: string, patch: Partial<VariableDefinition>) {
    onChange(variables.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }

  function copyToken(name: string) {
    if (name.trim()) void navigator.clipboard.writeText(`[[${name}]]`);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t("automation.editor.variables.title", "Variables")}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-6"
          onClick={addVariable}
          disabled={disabled}
          title={t("automation.editor.variables.add", "Add variable")}
        >
          <LuPlus className="size-3.5" />
        </Button>
      </div>

      <div className="flex flex-1 min-h-0 flex-col gap-0 divide-y divide-border overflow-y-auto">
        {variables.length === 0 && (
          <p className="px-3 py-4 text-xs text-muted-foreground italic">
            {t("automation.editor.variables.empty", "No variables defined.")}
          </p>
        )}

        {variables.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setSelectedId(v.id === selectedId ? null : v.id)}
            className={cn(
              "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-muted/40 transition-colors",
              selectedId === v.id && "bg-muted/60",
            )}
          >
            <span className="truncate font-medium text-foreground">
              {v.name || (
                <span className="italic text-muted-foreground">
                  {t("automation.editor.variables.unnamed", "unnamed")}
                </span>
              )}
            </span>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="outline" className="text-[9px] px-1">
                {v.scope}
              </Badge>
              <Badge variant="outline" className="text-[9px] px-1">
                {v.valueType}
              </Badge>
            </div>
          </button>
        ))}
      </div>

      {/* Edit form for selected variable */}
      {selectedVar && (
        <div className="shrink-0 border-t border-border p-3 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase tracking-wide font-bold text-muted-foreground">
              {t("automation.editor.variables.edit", "Edit variable")}
            </span>
            <div className="flex gap-1">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6"
                title={t(
                  "automation.editor.variables.copyToken",
                  "Copy [[token]]",
                )}
                onClick={() => copyToken(selectedVar.name)}
              >
                <LuCopy className="size-3" />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-6 text-destructive hover:text-destructive"
                onClick={() => deleteVariable(selectedVar.id)}
                disabled={disabled}
              >
                <LuTrash2 className="size-3" />
              </Button>
            </div>
          </div>

          {/* Name */}
          <div className="space-y-1">
            <Label className="text-[10px]">
              {t("automation.editor.variables.name", "Name")}
            </Label>
            <Input
              value={selectedVar.name}
              onChange={(e) =>
                updateVariable(selectedVar.id, { name: e.target.value })
              }
              placeholder="my_variable"
              className="h-7 text-xs"
              disabled={disabled}
            />
            {selectedVar.name && (
              <p className="font-mono text-[10px] text-amber-500">
                [[{selectedVar.name}]]
              </p>
            )}
          </div>

          {/* Scope */}
          <div className="space-y-1">
            <Label className="text-[10px]">
              {t("automation.editor.variables.scope", "Scope")}
            </Label>
            <Select
              value={selectedVar.scope}
              onValueChange={(v) =>
                updateVariable(selectedVar.id, { scope: v as VariableScope })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="flow">flow</SelectItem>
                <SelectItem value="run">run</SelectItem>
                <SelectItem value="node">node</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Value type */}
          <div className="space-y-1">
            <Label className="text-[10px]">
              {t("automation.editor.variables.valueType", "Type")}
            </Label>
            <Select
              value={selectedVar.valueType}
              onValueChange={(v) =>
                updateVariable(selectedVar.id, {
                  valueType: v as VariableValueType,
                })
              }
              disabled={disabled}
            >
              <SelectTrigger className="h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="string">string</SelectItem>
                <SelectItem value="number">number</SelectItem>
                <SelectItem value="boolean">boolean</SelectItem>
                <SelectItem value="json">json</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Default value */}
          <div className="space-y-1">
            <Label className="text-[10px]">
              {t("automation.editor.variables.defaultValue", "Default value")}
            </Label>
            <Input
              value={selectedVar.defaultValue ?? ""}
              onChange={(e) =>
                updateVariable(selectedVar.id, { defaultValue: e.target.value })
              }
              placeholder=""
              className="h-7 text-xs"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </div>
  );
}
