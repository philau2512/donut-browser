"use client";

import { useTranslation } from "react-i18next";
import { LuCircleHelp } from "react-icons/lu";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { AutomationNodeCatalogItem } from "@/lib/automation/node-catalog";
import { ExpressionInput } from "./expression-input";
import {
  ValidationBadge,
  type ValidationWarning,
} from "./nodes/forms/validation-badge";
import { SelectorInput } from "./selector-input";
import type { AutomationCanvasNode } from "./serialize";
import { VariableSelectInput } from "./variable-select-input";

interface PropertyFormProps {
  catalog: AutomationNodeCatalogItem;
  node: AutomationCanvasNode;
  variables: Record<string, string>;
  variableWarnings?: ValidationWarning[];
  onParamChange: (key: string, value: string | number | boolean) => void;
  onCreateVariable?: (name: string) => void;
  functions?: string[];
}

function formatParamKey(key: string): string {
  if (key === "url") return "URL";
  if (key === "xpath") return "XPath";
  if (key === "cdpPort") return "CDP Port";

  const result = key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .trim();

  return result
    .split(" ")
    .map((word) => {
      const lower = word.toLowerCase();
      if (lower === "url") return "URL";
      if (lower === "xpath") return "XPath";
      if (lower === "cdp") return "CDP";
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

export function PropertyForm({
  catalog,
  node,
  variables,
  variableWarnings = [],
  onParamChange,
  onCreateVariable,
  functions = ["Main"],
}: PropertyFormProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className="space-y-4">
      <ValidationBadge warnings={variableWarnings} />
      {catalog.params.map((param) => {
        // Conditional visibility: hide this param unless the guard condition is met
        if (param.showIf) {
          const guardValue =
            node.data.params[param.showIf.key] ??
            catalog.defaults?.[param.showIf.key];
          if (guardValue !== param.showIf.value) return null;
        }

        const value =
          node.data.params[param.key] ?? catalog.defaults?.[param.key];

        // Auto format label if labelKey is not specified or fallback
        const formattedLabel = formatParamKey(param.key);
        const label = param.labelKey ? t(param.labelKey) : formattedLabel;

        // Try getting help text from helpKey, fallback to auto help translations
        const autoHelpKey = `automation.editor.help.${param.key}`;
        const helpText = param.helpKey
          ? t(param.helpKey)
          : i18n?.exists(autoHelpKey)
            ? t(autoHelpKey)
            : null;

        return (
          <div key={param.key} className="space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Label className="text-xs">
                {label}
                {param.required && <span className="text-destructive"> *</span>}
              </Label>
              {helpText && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground cursor-help rounded-full p-0.5 focus:outline-hidden"
                    >
                      <LuCircleHelp className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs whitespace-pre-line text-xs">
                    {helpText}
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
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
                  {(param.key === "functionName"
                    ? functions.map(
                        (f) =>
                          ({ value: f }) as {
                            value: string;
                            labelKey?: string;
                          },
                      )
                    : (param.options ?? [])
                  ).map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.labelKey ? t(option.labelKey) : option.value}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : param.key === "saveToVar" ||
              (catalog.type === "setVariable" && param.key === "name") ? (
              <VariableSelectInput
                value={String(value ?? "")}
                onChange={(next) => onParamChange(param.key, next)}
                placeholder={param.placeholder}
                variables={variables}
                onCreateVariable={onCreateVariable}
              />
            ) : param.kind === "string" && param.supportsExpression ? (
              <ExpressionInput
                value={String(value ?? "")}
                onChange={(next) => onParamChange(param.key, next)}
                placeholder={param.placeholder}
                multiline={param.multiline}
                variables={variables}
              />
            ) : param.kind === "selector" ? (
              <SelectorInput
                value={String(value ?? "")}
                onChange={(next) => onParamChange(param.key, next)}
                placeholder={param.placeholder}
                supportsExpression={param.supportsExpression}
                variables={variables}
              />
            ) : (
              <Input
                value={String(value ?? "")}
                type={param.kind === "number" ? "number" : "text"}
                min={param.kind === "number" ? 0 : undefined}
                onChange={(event) => {
                  const rawValue = event.target.value;
                  if (param.kind === "number") {
                    if (rawValue === "") {
                      onParamChange(param.key, "");
                    } else {
                      const num = Number(rawValue);
                      if (!Number.isNaN(num)) {
                        onParamChange(param.key, Math.max(0, num));
                      }
                    }
                  } else {
                    onParamChange(param.key, rawValue);
                  }
                }}
                placeholder={param.placeholder}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
