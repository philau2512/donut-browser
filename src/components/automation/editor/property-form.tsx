"use client";

import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { AutomationNodeCatalogItem } from "@/lib/automation/node-catalog";
import { ExpressionInput } from "./expression-input";
import type { AutomationCanvasNode } from "./serialize";

interface PropertyFormProps {
  catalog: AutomationNodeCatalogItem;
  node: AutomationCanvasNode;
  variables: Record<string, string>;
  onParamChange: (key: string, value: string | number | boolean) => void;
}

export function PropertyForm({
  catalog,
  node,
  variables,
  onParamChange,
}: PropertyFormProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      {catalog.params.map((param) => {
        const value = node.data.params[param.key];
        const label = param.labelKey ? t(param.labelKey) : param.key;
        return (
          <div key={param.key} className="space-y-1.5">
            <Label className="text-xs">
              {label}
              {param.required && <span className="text-destructive"> *</span>}
            </Label>
            {param.kind === "boolean" ? (
              <div className="flex items-center gap-2 rounded-md border border-border p-2">
                <Checkbox
                  checked={Boolean(value)}
                  onCheckedChange={(checked) =>
                    onParamChange(param.key, checked === true)
                  }
                />
                <span className="text-sm">
                  {t("automation.editor.booleanEnabled")}
                </span>
              </div>
            ) : param.kind === "enum" ? (
              <Select
                value={String(value ?? "")}
                onValueChange={(next) => onParamChange(param.key, next)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={param.placeholder} />
                </SelectTrigger>
                <SelectContent>
                  {(param.options ?? []).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.labelKey ? t(option.labelKey) : option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : param.kind === "string" && param.supportsExpression ? (
              <ExpressionInput
                value={String(value ?? "")}
                onChange={(next) => onParamChange(param.key, next)}
                placeholder={param.placeholder}
                multiline={param.multiline}
                variables={variables}
              />
            ) : (
              <Input
                value={String(value ?? "")}
                type={param.kind === "number" ? "number" : "text"}
                onChange={(event) =>
                  onParamChange(
                    param.key,
                    param.kind === "number"
                      ? Number(event.target.value)
                      : event.target.value,
                  )
                }
                placeholder={param.placeholder}
              />
            )}
            {param.helpKey && (
              <p className="text-[11px] text-muted-foreground">
                {t(param.helpKey)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
