"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BrowserProfile } from "@/types";
import { ValidationBadge, type ValidationWarning } from "./validation-badge";

interface OpenProfileAutomationConfig {
  dynamicProxy?: {
    url: string;
  };
  ipCheck?: {
    allowedCountries?: string[];
    maxFraudScore?: number;
  };
  webhooks?: Array<{
    url: string;
    method?: string;
    body?: string;
  }>;
  telegram?: {
    chatId: string;
    message: string;
  };
}

interface OpenProfileNodeData {
  profileId: string;
  automation?: string; // JSON string
}

interface OpenProfileFormProps {
  value: OpenProfileNodeData;
  onChange: (value: OpenProfileNodeData) => void;
  profiles: BrowserProfile[];
  variables?: Record<string, string>;
  variableWarnings?: ValidationWarning[];
}

export function OpenProfileForm({
  value,
  onChange,
  profiles: _profiles,
  variables = {},
  variableWarnings = [],
}: OpenProfileFormProps) {
  const { t } = useTranslation();
  const [warnings, setWarnings] = useState<ValidationWarning[]>([]);
  const [parsedAutomation, setParsedAutomation] =
    useState<OpenProfileAutomationConfig>({});

  // Parse automation JSON when value changes
  useEffect(() => {
    if (value.automation) {
      try {
        const parsed = JSON.parse(value.automation);
        setParsedAutomation(parsed);
      } catch {
        setParsedAutomation({});
      }
    } else {
      setParsedAutomation({});
    }
  }, [value.automation]);

  // Validation
  useEffect(() => {
    const newWarnings: ValidationWarning[] = [];

    if (!value.profileId) {
      newWarnings.push({
        type: "error",
        message:
          t("automation.validation.profileRequired") || "Profile is required",
      });
    }

    // Warn if IP check configured without dynamic proxy
    if (
      parsedAutomation.ipCheck?.allowedCountries?.length &&
      !parsedAutomation.dynamicProxy?.url
    ) {
      newWarnings.push({
        type: "warning",
        message:
          t("automation.validation.ipCheckNeedsProxy") ||
          "IP check requires dynamic proxy to be configured",
      });
    }

    for (const w of variableWarnings) {
      newWarnings.push(w);
    }

    setWarnings(newWarnings);
  }, [value, parsedAutomation, t, variableWarnings]);

  const updateAutomation = (updates: Partial<OpenProfileAutomationConfig>) => {
    const newAutomation = { ...parsedAutomation, ...updates };
    // Remove empty sections
    const cleaned: OpenProfileAutomationConfig = {};
    if (newAutomation.dynamicProxy?.url) {
      cleaned.dynamicProxy = newAutomation.dynamicProxy;
    }
    if (newAutomation.ipCheck?.allowedCountries?.length) {
      cleaned.ipCheck = newAutomation.ipCheck;
    }
    if (newAutomation.webhooks?.some((w) => w.url)) {
      cleaned.webhooks = newAutomation.webhooks.filter((w) => w.url);
    }
    if (newAutomation.telegram?.chatId) {
      cleaned.telegram = newAutomation.telegram;
    }

    const automationStr =
      Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned, null, 2) : "";

    onChange({
      ...value,
      automation: automationStr,
    });
  };

  const updateProxyUrl = (url: string) => {
    updateAutomation({
      dynamicProxy: url ? { url } : undefined,
    });
  };

  const updateTelegram = (field: "chatId" | "message", val: string) => {
    const current = parsedAutomation.telegram || { chatId: "", message: "" };
    const updated = { ...current, [field]: val };
    // Only keep if chatId is set
    updateAutomation({
      telegram: updated.chatId ? updated : undefined,
    });
  };

  const addWebhook = () => {
    const current = parsedAutomation.webhooks || [];
    updateAutomation({
      webhooks: [...current, { url: "", method: "POST" }],
    });
  };

  const updateWebhook = (index: number, field: string, val: string) => {
    const current = [...(parsedAutomation.webhooks || [])];
    if (current[index]) {
      current[index] = { ...current[index], [field]: val };
      updateAutomation({ webhooks: current });
    }
  };

  const removeWebhook = (index: number) => {
    const current = [...(parsedAutomation.webhooks || [])];
    current.splice(index, 1);
    updateAutomation({ webhooks: current.length ? current : undefined });
  };

  // Available variables for autocomplete hint
  const availableVars = [
    "PROFILE_ID",
    "PROFILE_NAME",
    "CDP_PORT",
    "PROXY_IP",
    "IP_COUNTRY",
    "BROWSER_PID",
    ...Object.keys(variables),
  ];

  return (
    <div className="space-y-4 p-4">
      {/* Profile Selection */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          {t("automation.nodes.openProfile.params.profileId")}
          <span className="text-destructive"> *</span>
        </Label>
        <Input
          value={value.profileId}
          onChange={(e) => onChange({ ...value, profileId: e.target.value })}
          placeholder="{{PROFILE_ID}} or profile name"
          className="font-mono text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("automation.nodes.openProfile.params.profileIdHelp")}
        </p>
      </div>

      {/* Automation Accordion */}
      <div className="space-y-2">
        <Label className="text-xs">Automation (Optional)</Label>
        <Accordion type="multiple" className="w-full border rounded-md">
          {/* Dynamic Proxy */}
          <AccordionItem value="proxy" className="border-b-0 px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Dynamic Proxy
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="space-y-1.5">
                <Input
                  value={parsedAutomation.dynamicProxy?.url || ""}
                  onChange={(e) => updateProxyUrl(e.target.value)}
                  placeholder="https://api.example.com/proxy"
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  URL to fetch proxy from. Use {`{{PROFILE_ID}}`} for
                  interpolation.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* IP Check */}
          <AccordionItem value="ipCheck" className="border-b-0 px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              IP Check
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-2">
              <div className="space-y-1.5">
                <Label className="text-xs">
                  Allowed Countries (comma-separated)
                </Label>
                <Input
                  value={
                    parsedAutomation.ipCheck?.allowedCountries?.join(", ") || ""
                  }
                  onChange={(e) =>
                    updateAutomation({
                      ipCheck: {
                        ...parsedAutomation.ipCheck,
                        allowedCountries: e.target.value
                          .split(",")
                          .map((s) => s.trim().toUpperCase())
                          .filter(Boolean),
                      },
                    })
                  }
                  placeholder="US, GB, DE"
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty to allow all countries.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Max Fraud Score (0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={parsedAutomation.ipCheck?.maxFraudScore ?? 100}
                  onChange={(e) =>
                    updateAutomation({
                      ipCheck: {
                        ...parsedAutomation.ipCheck,
                        maxFraudScore: parseInt(e.target.value, 10) || 100,
                      },
                    })
                  }
                  className="text-sm"
                />
                <p className="text-[11px] text-muted-foreground">
                  Set to 100 to disable fraud score check.
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Webhooks */}
          <AccordionItem value="webhooks" className="border-b-0 px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Webhooks ({parsedAutomation.webhooks?.length || 0})
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-2">
              {(parsedAutomation.webhooks || []).map((webhook, i) => (
                <div key={i} className="space-y-1.5 p-2 border rounded">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Webhook {i + 1}</Label>
                    <button
                      type="button"
                      onClick={() => removeWebhook(i)}
                      className="text-xs text-destructive hover:underline"
                    >
                      Remove
                    </button>
                  </div>
                  <Input
                    value={webhook.url}
                    onChange={(e) => updateWebhook(i, "url", e.target.value)}
                    placeholder="https://example.com/webhook"
                    className="text-sm"
                  />
                  <div className="flex gap-2">
                    <Input
                      value={webhook.method || "POST"}
                      onChange={(e) =>
                        updateWebhook(i, "method", e.target.value)
                      }
                      placeholder="POST"
                      className="text-sm w-24"
                    />
                    <Input
                      value={webhook.body || ""}
                      onChange={(e) => updateWebhook(i, "body", e.target.value)}
                      placeholder="Body (optional)"
                      className="text-sm flex-1"
                    />
                  </div>
                </div>
              ))}
              <button
                type="button"
                onClick={addWebhook}
                className="text-xs text-primary hover:underline"
              >
                + Add Webhook
              </button>
            </AccordionContent>
          </AccordionItem>

          {/* Telegram */}
          <AccordionItem value="telegram" className="px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Telegram Alert
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Chat ID</Label>
                <Input
                  value={parsedAutomation.telegram?.chatId || ""}
                  onChange={(e) => updateTelegram("chatId", e.target.value)}
                  placeholder="-1001234567890"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Message</Label>
                <Textarea
                  value={parsedAutomation.telegram?.message || ""}
                  onChange={(e) => updateTelegram("message", e.target.value)}
                  placeholder="Profile {{PROFILE_ID}} opened with IP {{proxy_ip}}"
                  className="text-sm min-h-[60px]"
                />
                <p className="text-[11px] text-muted-foreground">
                  Variables:{" "}
                  {availableVars
                    .slice(0, 5)
                    .map((v) => `{{${v}}}`)
                    .join(", ")}
                  {availableVars.length > 5 ? "..." : ""}
                </p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Validation Warnings */}
      <ValidationBadge warnings={warnings} />
    </div>
  );
}
