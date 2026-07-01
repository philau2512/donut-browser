"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ExpressionInput } from "./expression-input";

interface SelectorInputProps {
  value: string;
  onChange: (value: string) => void;
  variables: Record<string, string>;
  placeholder?: string;
  supportsExpression?: boolean;
}

type SelectorType = "css" | "xpath" | "text";
type TextMatchType = "exact" | "include" | "start" | "end";

function parseSelector(value: string): {
  type: SelectorType;
  val: string;
  match: TextMatchType;
} {
  let type: SelectorType = "css";
  let match: TextMatchType = "include";
  let val = value || "";

  if (val.startsWith("xpath=")) {
    type = "xpath";
    val = val.slice(6);
  } else if (val.startsWith("//") || val.startsWith("(//")) {
    type = "xpath";
  } else if (val.startsWith("text=")) {
    type = "text";
    const textPart = val.slice(5);
    if (textPart.startsWith('"') && textPart.endsWith('"')) {
      match = "exact";
      val = textPart.slice(1, -1).replace(/\\"/g, '"');
    } else if (textPart.startsWith("/^") && textPart.endsWith("/i")) {
      match = "start";
      val = textPart.slice(2, -2).replace(/\\\//g, "/");
    } else if (textPart.startsWith("/^") && textPart.endsWith("$/i")) {
      match = "exact";
      val = textPart.slice(2, -3).replace(/\\\//g, "/");
    } else if (textPart.startsWith("/") && textPart.endsWith("$/i")) {
      match = "end";
      val = textPart.slice(1, -3).replace(/\\\//g, "/");
    } else if (textPart.startsWith("/") && textPart.endsWith("/i")) {
      match = "include";
      val = textPart.slice(1, -2).replace(/\\\//g, "/");
    } else {
      match = "include";
      val = textPart;
    }
  } else if (val.startsWith("css=")) {
    type = "css";
    val = val.slice(4);
  }

  return { type, val, match };
}

function buildSelector(
  type: SelectorType,
  val: string,
  match: TextMatchType,
): string {
  if (!val) return "";
  if (type === "css") return val;
  if (type === "xpath")
    return val.startsWith("//") || val.startsWith("(//") ? val : `xpath=${val}`;
  if (type === "text") {
    const escapedVal = val.replace(/\//g, "\\/");
    switch (match) {
      case "exact":
        return `text="${val.replace(/"/g, '\\"')}"`;
      case "start":
        return `text=/^${escapedVal}/i`;
      case "end":
        return `text=/${escapedVal}$/i`;
      default:
        return `text=${val}`;
    }
  }
  return val;
}

export function SelectorInput({
  value,
  onChange,
  variables,
  placeholder,
  supportsExpression,
}: SelectorInputProps) {
  const { t } = useTranslation();

  const parsed = parseSelector(value);
  const [type, setType] = useState<SelectorType>(parsed.type);
  const [val, setVal] = useState<string>(parsed.val);
  const [match, setMatch] = useState<TextMatchType>(parsed.match);

  // Sync internal state when external value changes drastically (e.g. node switch)
  useEffect(() => {
    const p = parseSelector(value);
    if (
      buildSelector(p.type, p.val, p.match) !== buildSelector(type, val, match)
    ) {
      setType(p.type);
      setVal(p.val);
      setMatch(p.match);
    }
  }, [value, val, type, match]);

  const update = (
    newType: SelectorType,
    newVal: string,
    newMatch: TextMatchType,
  ) => {
    setType(newType);
    setVal(newVal);
    setMatch(newMatch);
    onChange(buildSelector(newType, newVal, newMatch));
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3 bg-card shadow-sm">
      <RadioGroup
        value={type}
        onValueChange={(v) => update(v as SelectorType, val, match)}
        className="flex gap-4"
      >
        <div className="flex items-center space-x-1.5">
          <RadioGroupItem value="css" id="sel-css" />
          <Label
            htmlFor="sel-css"
            className="font-normal cursor-pointer text-xs"
          >
            CSS
          </Label>
        </div>
        <div className="flex items-center space-x-1.5">
          <RadioGroupItem value="xpath" id="sel-xpath" />
          <Label
            htmlFor="sel-xpath"
            className="font-normal cursor-pointer text-xs"
          >
            XPath
          </Label>
        </div>
        <div className="flex items-center space-x-1.5">
          <RadioGroupItem value="text" id="sel-text" />
          <Label
            htmlFor="sel-text"
            className="font-normal cursor-pointer text-xs"
          >
            Text
          </Label>
        </div>
      </RadioGroup>

      {type === "text" && (
        <Select
          value={match}
          onValueChange={(v) => update(type, val, v as TextMatchType)}
        >
          <SelectTrigger className="w-full text-xs h-8">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="exact">
              {t("automation.editor.selector.exact", "Exact match")}
            </SelectItem>
            <SelectItem value="include">
              {t("automation.editor.selector.include", "Include (contains)")}
            </SelectItem>
            <SelectItem value="start">
              {t("automation.editor.selector.start", "Start with")}
            </SelectItem>
            <SelectItem value="end">
              {t("automation.editor.selector.end", "End with")}
            </SelectItem>
          </SelectContent>
        </Select>
      )}

      {supportsExpression ? (
        <ExpressionInput
          value={val}
          onChange={(v) => update(type, v, match)}
          placeholder={
            placeholder ||
            (type === "css"
              ? ".btn-primary"
              : type === "xpath"
                ? "//button"
                : "Click here")
          }
          variables={variables}
        />
      ) : (
        <Input
          value={val}
          onChange={(e) => update(type, e.target.value, match)}
          placeholder={
            placeholder ||
            (type === "css"
              ? ".btn-primary"
              : type === "xpath"
                ? "//button"
                : "Click here")
          }
        />
      )}
    </div>
  );
}
