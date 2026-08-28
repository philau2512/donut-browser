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
import { Switch } from "@/components/ui/switch";
import type { BrowserProfile } from "@/types";
import { ValidationBadge, type ValidationWarning } from "./validation-badge";

interface OpenProfileAutomationConfig {
  proxyString?: string;
  proxyType?: string;
  proxyLogin?: string;
  proxyPassword?: string;
  changeTimezone?: string;
  changeGeolocation?: string;
  changeLanguage?: string;
  webrtcMode?: string;
  customDns?: string;
  ipDetection?: boolean;
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

// Stable empty defaults — inline `= []` would allocate a new array every render
// and re-trigger effects that depend on the prop reference.
const EMPTY_VARIABLES: Record<string, string> = {};
const EMPTY_WARNINGS: ValidationWarning[] = [];

export function OpenProfileForm({
  value,
  onChange,
  profiles: _profiles,
  variables: _variables = EMPTY_VARIABLES,
  variableWarnings = EMPTY_WARNINGS,
}: OpenProfileFormProps) {
  const { t } = useTranslation();
  // Use prop directly — no mirrored state (avoids infinite setState loops).
  const warnings = variableWarnings;
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
      setParsedAutomation({
        proxyType: "http",
        changeTimezone: "true",
        changeGeolocation: "false",
        changeLanguage: "true",
        webrtcMode: "alter",
        ipDetection: true,
      });
    }
  }, [value.automation]);

  const updateAutomation = (updates: Partial<OpenProfileAutomationConfig>) => {
    const newAutomation = {
      proxyType: "http",
      changeTimezone: "true",
      changeGeolocation: "false",
      changeLanguage: "true",
      webrtcMode: "alter",
      ipDetection: true,
      ...parsedAutomation,
      ...updates,
    };

    // Clean up empty fields
    const cleaned: Partial<OpenProfileAutomationConfig> = {};
    if (newAutomation.proxyString !== undefined)
      cleaned.proxyString = newAutomation.proxyString;
    if (newAutomation.proxyType !== undefined)
      cleaned.proxyType = newAutomation.proxyType;
    if (newAutomation.proxyLogin !== undefined)
      cleaned.proxyLogin = newAutomation.proxyLogin;
    if (newAutomation.proxyPassword !== undefined)
      cleaned.proxyPassword = newAutomation.proxyPassword;
    if (newAutomation.changeTimezone !== undefined)
      cleaned.changeTimezone = newAutomation.changeTimezone;
    if (newAutomation.changeGeolocation !== undefined)
      cleaned.changeGeolocation = newAutomation.changeGeolocation;
    if (newAutomation.changeLanguage !== undefined)
      cleaned.changeLanguage = newAutomation.changeLanguage;
    if (newAutomation.webrtcMode !== undefined)
      cleaned.webrtcMode = newAutomation.webrtcMode;
    if (newAutomation.customDns !== undefined)
      cleaned.customDns = newAutomation.customDns;
    if (newAutomation.ipDetection !== undefined)
      cleaned.ipDetection = newAutomation.ipDetection;

    const automationStr =
      Object.keys(cleaned).length > 0 ? JSON.stringify(cleaned, null, 2) : "";

    onChange({
      ...value,
      automation: automationStr,
    });
  };

  return (
    <div className="space-y-4 p-4">
      {/* Profile Selection */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          {t("automation.nodes.openProfile.params.profileId") ||
            "Profile Override"}
        </Label>
        <Input
          value={value.profileId}
          onChange={(e) => onChange({ ...value, profileId: e.target.value })}
          placeholder="{{PROFILE_ID}} or profile name"
          className="font-mono text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          {t("automation.nodes.openProfile.params.profileIdHelp") ||
            "Select a profile to override, or leave blank to use the current profile"}
        </p>
      </div>

      {/* Settings Accordion */}
      <div className="space-y-2">
        <Label className="text-xs">Browser Settings Override</Label>
        <Accordion
          type="multiple"
          defaultValue={["proxy"]}
          className="w-full border rounded-md"
        >
          {/* Proxy Config */}
          <AccordionItem value="proxy" className="border-b px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Proxy settings
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Proxy String</Label>
                <Input
                  value={parsedAutomation.proxyString || ""}
                  onChange={(e) =>
                    updateAutomation({ proxyString: e.target.value })
                  }
                  placeholder="ip:port:user:pass or http://user:pass@ip:port"
                  className="text-sm font-mono"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Proxy Type</Label>
                  <select
                    value={parsedAutomation.proxyType || "http"}
                    onChange={(e) =>
                      updateAutomation({ proxyType: e.target.value })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="http">http</option>
                    <option value="socks5">socks5</option>
                    <option value="socks4">socks4</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <Label className="text-xs">Proxy Login</Label>
                  <Input
                    value={parsedAutomation.proxyLogin || ""}
                    onChange={(e) =>
                      updateAutomation({ proxyLogin: e.target.value })
                    }
                    placeholder="Login"
                    className="text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Proxy password</Label>
                <Input
                  type="password"
                  value={parsedAutomation.proxyPassword || ""}
                  onChange={(e) =>
                    updateAutomation({ proxyPassword: e.target.value })
                  }
                  placeholder="Password"
                  className="text-sm"
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Security settings */}
          <AccordionItem value="security" className="border-b px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Security settings
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Options below will help you to adjust different browser settings
                to match new proxy, for example: timezone and geolocation.
                Default settings will work fine.
              </p>

              <div className="space-y-1.5">
                <Label className="text-xs">Change timezone</Label>
                <select
                  value={parsedAutomation.changeTimezone || "true"}
                  onChange={(e) =>
                    updateAutomation({ changeTimezone: e.target.value })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Change geolocation</Label>
                <select
                  value={parsedAutomation.changeGeolocation || "false"}
                  onChange={(e) =>
                    updateAutomation({ changeGeolocation: e.target.value })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Change browser language</Label>
                <select
                  value={parsedAutomation.changeLanguage || "true"}
                  onChange={(e) =>
                    updateAutomation({ changeLanguage: e.target.value })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* WebRTC settings */}
          <AccordionItem value="webrtc" className="border-b px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              WebRTC settings
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-1.5">
              <Label className="text-xs">WebRTC mode</Label>
              <select
                value={parsedAutomation.webrtcMode || "alter"}
                onChange={(e) =>
                  updateAutomation({ webrtcMode: e.target.value })
                }
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <option value="alter">alter</option>
                <option value="block">block</option>
                <option value="forward">forward</option>
              </select>
            </AccordionContent>
          </AccordionItem>

          {/* Custom DNS */}
          <AccordionItem value="dns" className="border-b px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              Custom DNS
            </AccordionTrigger>
            <AccordionContent className="pb-3 space-y-1.5">
              <Label className="text-xs">DNS Address</Label>
              <Input
                value={parsedAutomation.customDns || ""}
                onChange={(e) =>
                  updateAutomation({ customDns: e.target.value })
                }
                placeholder="e.g. 8.8.8.8"
                className="text-sm font-mono"
              />
            </AccordionContent>
          </AccordionItem>

          {/* IP detection */}
          <AccordionItem value="ipDetect" className="border-b px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              IP detection
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Enable IP fraud check before opening
                </span>
                <Switch
                  checked={parsedAutomation.ipDetection !== false}
                  onCheckedChange={(checked) =>
                    updateAutomation({ ipDetection: checked })
                  }
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* IP information */}
          <AccordionItem value="ipInfo" className="px-3">
            <AccordionTrigger className="py-2 text-sm hover:no-underline">
              IP information
            </AccordionTrigger>
            <AccordionContent className="pb-3">
              <p className="text-xs text-muted-foreground italic">
                IP and geo coordinates will be resolved from proxy at launch.
              </p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>

      {/* Validation Warnings */}
      <ValidationBadge warnings={warnings} />
    </div>
  );
}
