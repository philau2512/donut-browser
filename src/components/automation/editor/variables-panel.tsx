"use client";

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuFilter, LuLink, LuPlus, LuSearch, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  isReservedFlowVariable,
  RESERVED_FLOW_VARIABLES,
} from "@/lib/automation/flow-variables";

interface VariablesPanelProps {
  variables: Record<string, string>;
  onChange: (variables: Record<string, string>) => void;
}

function isReservedVariable(key: string) {
  return isReservedFlowVariable(key);
}

export function VariablesPanel({ variables, onChange }: VariablesPanelProps) {
  const { t } = useTranslation();
  const [searchQuery, setSearchQuery] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");

  const entries = Object.entries(variables).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const addVariable = () => {
    const key = draftKey.trim().toUpperCase();
    if (!key || isReservedVariable(key) || key in variables) return;
    onChange({ ...variables, [key]: draftValue });
    setDraftKey("");
    setDraftValue("");
    setIsAdding(false);
  };

  const updateVariable = (key: string, value: string) => {
    onChange({ ...variables, [key]: value });
  };

  const deleteVariable = (key: string) => {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  };

  const filteredReserved = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return RESERVED_FLOW_VARIABLES;
    return RESERVED_FLOW_VARIABLES.filter((v) =>
      v.toLowerCase().includes(query),
    );
  }, [searchQuery]);

  const filteredUserEntries = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return entries;
    return entries.filter(([key]) => key.toLowerCase().includes(query));
  }, [entries, searchQuery]);

  return (
    <div className="relative flex h-full flex-col min-h-0 bg-card rounded-md">
      {/* Search & Filter Header */}
      <div className="shrink-0 flex items-center gap-2 border-b border-border p-3">
        <div className="relative flex-1">
          <LuSearch className="-translate-y-1/2 absolute top-1/2 left-2 size-3.5 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={
              t("automation.editor.variables.search") || "Search variables..."
            }
            className="pl-7 h-8 text-xs"
          />
        </div>
        <Button type="button" size="icon" variant="ghost" className="size-8">
          <LuFilter className="size-3.5 text-muted-foreground" />
        </Button>
      </div>

      {/* Variables List Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-4 min-h-0 pb-16">
        {/* Reserved System Variables */}
        {filteredReserved.length > 0 && (
          <div className="space-y-1.5">
            <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              {t("automation.editor.variables.system") || "System Variables"}
            </h4>
            <div className="space-y-1">
              {filteredReserved.map((key) => (
                <div
                  key={key}
                  className="flex items-center gap-2 rounded-md border border-border/50 bg-background/30 px-2 py-1 text-xs font-mono group"
                >
                  <LuLink className="size-3 text-muted-foreground shrink-0" />
                  <span className="font-semibold text-foreground/80 truncate flex-1">
                    {key}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 bg-muted px-1.5 py-0.5 rounded">
                    Auto-injected
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* User Variables */}
        <div className="space-y-1.5">
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            {t("automation.editor.variables.user") || "User Variables"}
          </h4>
          <div className="space-y-1">
            {filteredUserEntries.map(([key, value]) => (
              <div
                key={key}
                className="flex items-center gap-2 rounded-md border border-border bg-background/50 px-2 py-1 text-xs font-mono group hover:border-primary/30"
              >
                <LuLink className="size-3 text-muted-foreground shrink-0" />
                <span className="font-semibold text-foreground/80 truncate min-w-[80px] max-w-[120px]">
                  {key}
                </span>
                <span className="text-muted-foreground truncate flex-1 border-l border-border pl-2 mr-2">
                  <input
                    value={value}
                    onChange={(e) => updateVariable(key, e.target.value)}
                    className="w-full bg-transparent border-0 outline-none font-mono text-xs text-foreground p-0 focus:ring-0 focus:border-0"
                    placeholder="undefined"
                  />
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => deleteVariable(key)}
                  title="Delete variable"
                >
                  <LuTrash2 className="size-3" />
                </Button>
              </div>
            ))}

            {filteredUserEntries.length === 0 && (
              <p className="text-xs text-muted-foreground italic p-2 text-center">
                {t("automation.editor.variables.empty") ||
                  "No variables found."}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Floating Add Variable Form or Button */}
      {isAdding ? (
        <div className="absolute inset-x-0 bottom-0 border-t border-border bg-card p-3 shadow-lg animate-in slide-in-from-bottom-2 duration-200">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold">
              {t("automation.editor.variables.add") || "Add Variable"}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-5 px-1.5 text-xs text-muted-foreground"
              onClick={() => setIsAdding(false)}
            >
              Cancel
            </Button>
          </div>
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label
                  htmlFor="var-key"
                  className="text-[10px] uppercase text-muted-foreground"
                >
                  Name
                </Label>
                <Input
                  id="var-key"
                  value={draftKey}
                  onChange={(e) => setDraftKey(e.target.value)}
                  placeholder="e.g. EMAIL"
                  className="h-8 text-xs font-mono uppercase"
                  autoFocus
                />
              </div>
              <div>
                <Label
                  htmlFor="var-val"
                  className="text-[10px] uppercase text-muted-foreground"
                >
                  Value
                </Label>
                <Input
                  id="var-val"
                  value={draftValue}
                  onChange={(e) => setDraftValue(e.target.value)}
                  placeholder="value"
                  className="h-8 text-xs"
                />
              </div>
            </div>
            {draftKey && isReservedVariable(draftKey) && (
              <p className="text-[10px] text-destructive">
                {t("automation.editor.variables.reserved")}
              </p>
            )}
            <Button
              type="button"
              size="sm"
              className="w-full h-8 text-xs"
              onClick={addVariable}
              disabled={
                !draftKey.trim() ||
                isReservedVariable(draftKey) ||
                draftKey.trim().toUpperCase() in variables
              }
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <div className="absolute right-4 bottom-4 z-10">
          <Button
            type="button"
            size="icon"
            className="size-10 rounded-full bg-red-500 hover:bg-red-600 text-white shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95"
            onClick={() => setIsAdding(true)}
            title="Add variable"
          >
            <LuPlus className="size-5" />
          </Button>
        </div>
      )}
    </div>
  );
}
