"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface ObjectEditorProps {
  value: Record<string, unknown> | undefined;
  onChange: (value: Record<string, unknown> | undefined) => void;
  title: string;
  readOnly?: boolean;
}

export function ObjectEditor({
  value,
  onChange,
  title,
  readOnly = false,
}: ObjectEditorProps) {
  const { t } = useTranslation();
  const [jsonString, setJsonString] = useState("");

  useEffect(() => {
    setJsonString(JSON.stringify(value ?? {}, null, 2));
  }, [value]);

  const handleChange = (newValue: string) => {
    if (readOnly) return;
    setJsonString(newValue);
    try {
      if (newValue.trim() === "" || newValue.trim() === "{}") {
        onChange(undefined); // Treat empty objects as undefined
        return;
      }
      const parsed = JSON.parse(newValue);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        Object.keys(parsed).length === 0
      ) {
        onChange(undefined);
        return;
      }
      onChange(parsed as Record<string, unknown>);
    } catch (err) {
      console.warn("Invalid JSON:", err);
    }
  };

  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      <Textarea
        value={jsonString}
        onChange={(e) => {
          handleChange(e.target.value);
        }}
        placeholder={t("fingerprint.enterAsJson", { title })}
        className="font-mono text-sm"
        rows={6}
        disabled={readOnly}
      />
    </div>
  );
}
