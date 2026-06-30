"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface VariablesPanelProps {
  variables: Record<string, string>;
  onChange: (variables: Record<string, string>) => void;
}

const RESERVED_VARIABLES = ["PROFILE_ID", "PROFILE_NAME"];

function isReservedVariable(key: string) {
  return RESERVED_VARIABLES.includes(key.trim().toUpperCase());
}

export function VariablesPanel({ variables, onChange }: VariablesPanelProps) {
  const { t } = useTranslation();
  const [draftKey, setDraftKey] = useState("");
  const [draftValue, setDraftValue] = useState("");
  const entries = Object.entries(variables).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  const addVariable = () => {
    const key = draftKey.trim();
    if (!key || isReservedVariable(key) || key in variables) return;
    onChange({ ...variables, [key]: draftValue });
    setDraftKey("");
    setDraftValue("");
  };

  const updateVariable = (key: string, value: string) => {
    onChange({ ...variables, [key]: value });
  };

  const deleteVariable = (key: string) => {
    const next = { ...variables };
    delete next[key];
    onChange(next);
  };

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-sm font-semibold">
          {t("automation.editor.variables.title")}
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("automation.editor.variables.description")}
        </p>
      </div>

      <div className="space-y-2 rounded-md border border-border p-2">
        {RESERVED_VARIABLES.map((key) => (
          <div key={key} className="grid grid-cols-[1fr_1fr] gap-2">
            <Input value={key} readOnly className="text-xs" />
            <Input
              value={t("automation.editor.variables.autoInjected")}
              readOnly
              className="text-xs text-muted-foreground"
            />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[1fr_1fr_auto] gap-2">
            <Input value={key} readOnly className="text-xs" />
            <Input
              value={value}
              onChange={(event) => updateVariable(key, event.target.value)}
              className="text-xs"
            />
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="px-2 text-destructive hover:text-destructive"
              onClick={() => deleteVariable(key)}
            >
              <LuTrash2 className="size-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mt-auto space-y-2 rounded-md border border-border p-2">
        <Label className="text-xs">
          {t("automation.editor.variables.add")}
        </Label>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Input
            value={draftKey}
            onChange={(event) => setDraftKey(event.target.value)}
            placeholder="EMAIL"
            className="text-xs"
          />
          <Input
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder="value"
            className="text-xs"
          />
          <Button type="button" size="sm" onClick={addVariable}>
            <LuPlus className="size-3.5" />
          </Button>
        </div>
        {draftKey && isReservedVariable(draftKey) && (
          <p className="text-[11px] text-destructive">
            {t("automation.editor.variables.reserved")}
          </p>
        )}
      </div>
    </aside>
  );
}
