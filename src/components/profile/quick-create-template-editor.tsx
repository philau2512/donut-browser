"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";

import { CommandTab } from "@/components/profile/sub-components/command-tab";
import { ExtensionTab } from "@/components/profile/sub-components/extension-tab";
import { HardwareTab } from "@/components/profile/sub-components/hardware-tab";
import { LocationTab } from "@/components/profile/sub-components/location-tab";
import { RequestsTab } from "@/components/profile/sub-components/requests-tab";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  QUICK_CREATE_NONE,
  type QuickCreateTemplateDraft,
} from "@/lib/quick-create";
import type {
  ExtensionGroup,
  ProfileStatusConfig,
  StoredProxy,
  VpnConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";

const NONE = QUICK_CREATE_NONE;

interface QuickCreateTemplateEditorProps {
  draft: QuickCreateTemplateDraft;
  onDraftChange: (
    updater: (current: QuickCreateTemplateDraft) => QuickCreateTemplateDraft,
  ) => void;
  versions: string[];
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  extensionGroups: ExtensionGroup[];
  statuses: ProfileStatusConfig[];
  hostOs: WayfernOS;
  crossOsUnlocked: boolean;
  isSaving: boolean;
}

const setFingerprintOverride = (
  current: QuickCreateTemplateDraft,
  updates: Partial<WayfernFingerprintConfig>,
): QuickCreateTemplateDraft => ({
  ...current,
  fingerprint_overrides: {
    ...current.fingerprint_overrides,
    ...updates,
  },
});

const withoutFingerprintOverride = (
  current: QuickCreateTemplateDraft,
  keys: Array<keyof WayfernFingerprintConfig>,
): QuickCreateTemplateDraft => {
  const next = { ...current.fingerprint_overrides };
  keys.forEach((key) => delete next[key]);
  return { ...current, fingerprint_overrides: next };
};

export function QuickCreateTemplateEditor({
  draft,
  onDraftChange,
  versions,
  storedProxies,
  vpnConfigs,
  extensionGroups,
  statuses,
  hostOs,
  crossOsUnlocked,
  isSaving,
}: QuickCreateTemplateEditorProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState("base");
  const fixedLanguageEnabled = Boolean(draft.fingerprint_overrides.language);
  const fixedLanguage = draft.fingerprint_overrides.language ?? "en-US";

  const updateOverrides = (updates: Partial<WayfernFingerprintConfig>) => {
    onDraftChange((current) => setFingerprintOverride(current, updates));
  };

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0">
      <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-none bg-transparent p-0">
        {[
          ["base", "createProfile.tabs.baseInfo"],
          ["location", "createProfile.tabs.location"],
          ["hardware", "createProfile.tabs.hardware"],
          ["proxy", "createProfile.tabs.proxy"],
          ["command", "createProfile.tabs.command"],
          ["extension", "createProfile.tabs.extension"],
          ["requests", "createProfile.tabs.requests"],
          ["other", "createProfile.tabs.other"],
        ].map(([value, label]) => (
          <TabsTrigger
            key={value}
            value={value}
            className="shrink-0 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent"
          >
            {t(label)}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="base" className="mt-5 space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("quickCreate.templateName")}</Label>
            <Input
              value={draft.name}
              onChange={(event) =>
                onDraftChange((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={t("quickCreate.templateNamePlaceholder")}
            />
          </div>
          <div className="space-y-2">
            <Label>{t("quickCreate.status")}</Label>
            <Select
              value={draft.profile_status}
              onValueChange={(profile_status) =>
                onDraftChange((current) => ({ ...current, profile_status }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>
                  {t("quickCreate.noStatus")}
                </SelectItem>
                {statuses.map((status) => (
                  <SelectItem key={status.label} value={status.label}>
                    {status.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("quickCreate.browser")}</Label>
            <Select
              value={draft.browser}
              onValueChange={(browser) =>
                onDraftChange((current) => ({
                  ...current,
                  browser: browser as QuickCreateTemplateDraft["browser"],
                  version: "",
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="wayfern">Wayfern</SelectItem>
                <SelectItem value="camoufox">Camoufox</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("quickCreate.version")}</Label>
            <Select
              value={draft.version || undefined}
              onValueChange={(version) =>
                onDraftChange((current) => ({ ...current, version }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t("quickCreate.selectVersion")} />
              </SelectTrigger>
              <SelectContent>
                {versions.map((version) => (
                  <SelectItem key={version} value={version}>
                    {version}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("quickCreate.fingerprintOs")}</Label>
            <Select
              value={draft.os}
              onValueChange={(os) =>
                onDraftChange((current) => ({
                  ...current,
                  os: os as WayfernOS,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(
                  ["windows", "macos", "linux", "android", "ios"] as WayfernOS[]
                ).map((os) => (
                  <SelectItem
                    key={os}
                    value={os}
                    disabled={!crossOsUnlocked && os !== hostOs}
                  >
                    {os}
                    {!crossOsUnlocked && os !== hostOs ? " (Pro)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>{t("fingerprint.platformVersion")}</Label>
            <Input
              value={draft.fingerprint_overrides.platformVersion ?? ""}
              onChange={(event) =>
                updateOverrides({
                  platformVersion: event.target.value || undefined,
                })
              }
              placeholder={t("common.labels.default")}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label>{t("quickCreate.tags")}</Label>
          <Input
            value={draft.tags}
            onChange={(event) =>
              onDraftChange((current) => ({
                ...current,
                tags: event.target.value,
              }))
            }
            placeholder={t("quickCreate.tagsPlaceholder")}
          />
        </div>
      </TabsContent>

      <TabsContent value="location" className="mt-5">
        <LocationTab
          fingerprintConfig={draft.fingerprint_overrides}
          updateFingerprintConfig={(key, value) =>
            updateOverrides({
              [key]: value,
            } as Partial<WayfernFingerprintConfig>)
          }
          isEditingDisabled={false}
          isAutoLocationEnabled={draft.auto_location}
          handleAutoLocationToggle={(auto_location) =>
            onDraftChange((current) => ({ ...current, auto_location }))
          }
          fixedLanguageEnabled={fixedLanguageEnabled}
          fixedLanguage={fixedLanguage}
          handleFixedLanguageToggle={(enabled) =>
            onDraftChange((current) =>
              enabled
                ? setFingerprintOverride(current, {
                    language: fixedLanguage,
                    languages: [fixedLanguage, fixedLanguage.split("-")[0]],
                  })
                : withoutFingerprintOverride(current, [
                    "language",
                    "languages",
                  ]),
            )
          }
          handleFixedLanguageChange={(language) =>
            updateOverrides({
              language,
              languages: [language, language.split("-")[0]],
            })
          }
        />
      </TabsContent>

      <TabsContent value="hardware" className="mt-5">
        <HardwareTab
          fingerprintConfig={draft.fingerprint_overrides}
          updateFingerprintConfig={(key, value) =>
            updateOverrides({
              [key]: value,
            } as Partial<WayfernFingerprintConfig>)
          }
          updateFingerprintConfigs={updateOverrides}
          isEditingDisabled={false}
        />
      </TabsContent>

      <TabsContent value="proxy" className="mt-5 space-y-3">
        <Label>{t("quickCreate.proxy")}</Label>
        <Select
          value={draft.proxySelection}
          onValueChange={(proxySelection) =>
            onDraftChange((current) => ({ ...current, proxySelection }))
          }
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>{t("quickCreate.noProxy")}</SelectItem>
            {storedProxies
              .filter(
                (proxy) =>
                  !proxy.is_profile_specific ||
                  draft.proxySelection === proxy.id,
              )
              .map((proxy) => (
                <SelectItem key={proxy.id} value={proxy.id}>
                  {proxy.name}
                </SelectItem>
              ))}
            {vpnConfigs.map((vpn) => (
              <SelectItem key={vpn.id} value={`vpn-${vpn.id}`}>
                VPN · {vpn.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TabsContent>

      <TabsContent value="command" className="mt-5">
        <CommandTab
          launchHook={draft.launch_hook}
          setLaunchHook={(launch_hook) =>
            onDraftChange((current) => ({ ...current, launch_hook }))
          }
          isCreating={isSaving}
        />
      </TabsContent>

      <TabsContent value="extension" className="mt-5">
        <ExtensionTab
          extensionGroups={extensionGroups}
          selectedExtensionGroupId={
            draft.extension_group_id === NONE
              ? undefined
              : draft.extension_group_id
          }
          setSelectedExtensionGroupId={(extensionGroupId) =>
            onDraftChange((current) => ({
              ...current,
              extension_group_id: extensionGroupId ?? NONE,
            }))
          }
        />
      </TabsContent>

      <TabsContent value="requests" className="mt-5">
        <RequestsTab
          dnsBlocklist={draft.dns_blocklist}
          setDnsBlocklist={(dns_blocklist) =>
            onDraftChange((current) => ({ ...current, dns_blocklist }))
          }
        />
      </TabsContent>

      <TabsContent value="other" className="mt-5">
        <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium">
              {t("profiles.ephemeral")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("profiles.ephemeralDescription")}
            </p>
          </div>
          <AnimatedSwitch
            id="quick-create-template-ephemeral"
            checked={draft.ephemeral}
            onCheckedChange={(ephemeral) =>
              onDraftChange((current) => ({ ...current, ephemeral }))
            }
          />
        </div>
      </TabsContent>
    </Tabs>
  );
}
