"use client";

import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { LoadingButton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { RippleButton } from "@/components/ui/ripple";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { WayfernConfig } from "@/types";
import { WayfernConfigForm } from "../camoufox/wayfern-config-form";

interface CreateProfileAntiDetectTabProps {
  profileName: string;
  setProfileName: (name: string) => void;
  isCreating: boolean;
  isCreateDisabled: boolean;
  handleCreate: () => Promise<void>;
  ephemeral: boolean;
  setEphemeral: (checked: boolean) => void;
  enablePassword: (checked: boolean) => void;
  enablePasswordVal: boolean;
  password: string;
  setPassword: (pass: string) => void;
  passwordConfirm: string;
  setPasswordConfirm: (pass: string) => void;
  passwordError: string | null;
  setPasswordError: (err: string | null) => void;
  selectedBrowser: "camoufox" | "wayfern";
  isLoadingReleaseTypes: boolean;
  releaseTypesError: string | null;
  loadReleaseTypes: (browser: string) => Promise<void>;
  getBestAvailableVersion: (
    browser: string,
  ) => { version: string; releaseType: "stable" | "nightly" } | null;
  getCreatableVersion: (
    browser: string,
  ) => { version: string; releaseType: "stable" | "nightly" } | null;
  isBrowserCurrentlyDownloading: (browser: string) => boolean;
  handleDownload: (browser: string) => Promise<void>;
  isBrowserVersionAvailable: (browser: string) => boolean;
  wayfernConfig: WayfernConfig;
  updateWayfernConfig: (key: keyof WayfernConfig, value: unknown) => void;
  crossOsUnlocked: boolean;
  storedProxies: any[];
  vpnConfigs: any[];
  selectedProxyId: string | undefined;
  setSelectedProxyId: (id: string | undefined) => void;
  proxyPopoverOpen: boolean;
  setProxyPopoverOpen: (open: boolean) => void;
  proxyListboxIdAntiDetect: string;
  setShowProxyForm: (show: boolean) => void;
  launchHook: string;
  setLaunchHook: (hook: string) => void;
  dnsBlocklist: string;
  setDnsBlocklist: (val: string) => void;
  extensionGroups: any[];
  selectedExtensionGroupId: string | undefined;
  setSelectedExtensionGroupId: (id: string | undefined) => void;
}

export function CreateProfileAntiDetectTab({
  profileName,
  setProfileName,
  isCreating,
  isCreateDisabled,
  handleCreate,
  ephemeral,
  setEphemeral,
  enablePassword,
  enablePasswordVal,
  password,
  setPassword,
  passwordConfirm,
  setPasswordConfirm,
  passwordError,
  setPasswordError,
  selectedBrowser,
  isLoadingReleaseTypes,
  releaseTypesError,
  loadReleaseTypes,
  getBestAvailableVersion,
  getCreatableVersion,
  isBrowserCurrentlyDownloading,
  handleDownload,
  isBrowserVersionAvailable,
  wayfernConfig,
  updateWayfernConfig,
  crossOsUnlocked,
  storedProxies,
  vpnConfigs,
  selectedProxyId,
  setSelectedProxyId,
  proxyPopoverOpen,
  setProxyPopoverOpen,
  proxyListboxIdAntiDetect,
  setShowProxyForm,
  launchHook,
  setLaunchHook,
  dnsBlocklist,
  setDnsBlocklist,
  extensionGroups,
  selectedExtensionGroupId,
  setSelectedExtensionGroupId,
}: CreateProfileAntiDetectTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Profile Name */}
      <div className="space-y-2">
        <Label htmlFor="profile-name">{t("createProfile.profileName")}</Label>
        <Input
          id="profile-name"
          value={profileName}
          onChange={(e) => {
            setProfileName(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !isCreateDisabled && !isCreating) {
              void handleCreate();
            }
          }}
          placeholder={t("createProfile.profileNamePlaceholder")}
        />
      </div>

      {/* Ephemeral Option */}
      <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
        <div className="flex items-center gap-x-2">
          <Checkbox
            id="ephemeral"
            checked={ephemeral}
            onCheckedChange={(checked) => {
              setEphemeral(checked === true);
            }}
          />
          <Label htmlFor="ephemeral" className="font-medium">
            {t("profiles.ephemeral")}
          </Label>
        </div>
        <p className="ml-6 text-sm text-muted-foreground">
          {t("profiles.ephemeralDescription")}
        </p>
      </div>

      {/* Password Option */}
      {!ephemeral && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center gap-x-2">
            <Checkbox
              id="enable-password"
              checked={enablePasswordVal}
              onCheckedChange={(checked) => {
                enablePassword(checked === true);
                if (checked !== true) {
                  setPassword("");
                  setPasswordConfirm("");
                  setPasswordError(null);
                }
              }}
            />
            <Label htmlFor="enable-password" className="font-medium">
              {t("createProfile.passwordProtect.label")}
            </Label>
          </div>
          <p className="ml-6 text-sm text-muted-foreground">
            {t("createProfile.passwordProtect.description")}
          </p>
          {enablePasswordVal && (
            <div className="ml-6 space-y-2">
              <Input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setPasswordError(null);
                }}
                placeholder={t("profilePassword.fields.newPassword")}
                autoComplete="new-password"
              />
              <Input
                type="password"
                value={passwordConfirm}
                onChange={(e) => {
                  setPasswordConfirm(e.target.value);
                  setPasswordError(null);
                }}
                placeholder={t("profilePassword.fields.confirm")}
                autoComplete="new-password"
              />
              {passwordError && (
                <p className="text-sm text-destructive">{passwordError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {selectedBrowser === "wayfern" && (
        // Wayfern Configuration
        <div className="space-y-6">
          {/* Wayfern Download Status */}
          {isLoadingReleaseTypes && (
            <div className="flex items-center gap-3 rounded-md border p-3">
              <div className="size-4 animate-spin rounded-full border-2 border-muted/40 border-t-primary" />
              <p className="text-sm text-muted-foreground">
                {t("createProfile.version.fetching")}
              </p>
            </div>
          )}
          {!isLoadingReleaseTypes && releaseTypesError && (
            <div className="flex items-center gap-3 rounded-md border border-destructive/50 bg-destructive/10 p-3">
              <p className="flex-1 text-sm text-destructive">
                {releaseTypesError}
              </p>
              <RippleButton
                onClick={() =>
                  selectedBrowser && loadReleaseTypes(selectedBrowser)
                }
                size="sm"
                variant="outline"
              >
                {t("common.buttons.retry")}
              </RippleButton>
            </div>
          )}
          {!isLoadingReleaseTypes &&
            !releaseTypesError &&
            !getBestAvailableVersion("wayfern") && (
              <div className="flex items-center gap-3 rounded-md border border-warning/50 bg-warning/10 p-3">
                <p className="text-sm text-warning">
                  {t("createProfile.platformUnavailable", {
                    browser: "Wayfern",
                  })}
                </p>
              </div>
            )}
          {!isLoadingReleaseTypes &&
            !releaseTypesError &&
            !isBrowserCurrentlyDownloading("wayfern") &&
            !getCreatableVersion("wayfern") &&
            getBestAvailableVersion("wayfern") && (
              <div className="flex items-center gap-3 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">
                  {t("createProfile.version.needsDownload", {
                    browser: "Wayfern",
                    version: getBestAvailableVersion("wayfern")?.version,
                  })}
                </p>
                <LoadingButton
                  onClick={() => {
                    void handleDownload("wayfern");
                  }}
                  isLoading={isBrowserCurrentlyDownloading("wayfern")}
                  size="sm"
                  disabled={isBrowserCurrentlyDownloading("wayfern")}
                >
                  {isBrowserCurrentlyDownloading("wayfern")
                    ? t("common.buttons.downloading")
                    : t("common.buttons.download")}
                </LoadingButton>
              </div>
            )}
          {!isLoadingReleaseTypes &&
            !releaseTypesError &&
            !isBrowserCurrentlyDownloading("wayfern") &&
            getCreatableVersion("wayfern") && (
              <div className="rounded-md border p-3 text-sm text-muted-foreground">
                ✓{" "}
                {t("createProfile.version.available", {
                  browser: "Wayfern",
                  version: getCreatableVersion("wayfern")?.version,
                })}
              </div>
            )}
          {!isLoadingReleaseTypes &&
            !releaseTypesError &&
            !isBrowserCurrentlyDownloading("wayfern") &&
            getCreatableVersion("wayfern") &&
            !isBrowserVersionAvailable("wayfern") &&
            getBestAvailableVersion("wayfern") && (
              <div className="flex items-center gap-3 rounded-md border p-3">
                <p className="flex-1 text-sm text-muted-foreground">
                  {t("createProfile.version.upgradeAvailable", {
                    browser: "Wayfern",
                    version: getBestAvailableVersion("wayfern")?.version,
                  })}
                </p>
                <LoadingButton
                  onClick={() => {
                    void handleDownload("wayfern");
                  }}
                  isLoading={isBrowserCurrentlyDownloading("wayfern")}
                  size="sm"
                  variant="outline"
                  disabled={isBrowserCurrentlyDownloading("wayfern")}
                >
                  {isBrowserCurrentlyDownloading("wayfern")
                    ? t("common.buttons.downloading")
                    : t("common.buttons.download")}
                </LoadingButton>
              </div>
            )}
          {isBrowserCurrentlyDownloading("wayfern") && (
            <div className="rounded-md border p-3 text-sm text-muted-foreground">
              {t("createProfile.version.downloading", {
                browser: "Wayfern",
                version: getBestAvailableVersion("wayfern")?.version,
              })}
            </div>
          )}

          <WayfernConfigForm
            config={wayfernConfig}
            onConfigChange={updateWayfernConfig}
            isCreating
            crossOsUnlocked={crossOsUnlocked}
            limitedMode={!crossOsUnlocked}
            profileVersion={getCreatableVersion("wayfern")?.version}
            profileBrowser="wayfern"
          />
        </div>
      )}

      {/* Proxy / VPN Selection - Always visible */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>{t("createProfile.proxy.title")}</Label>
          <RippleButton
            size="sm"
            variant="outline"
            onClick={() => {
              setShowProxyForm(true);
            }}
            className="h-7 px-2 text-xs"
          >
            <GoPlus className="mr-1 size-3" />{" "}
            {t("createProfile.proxy.addProxy")}
          </RippleButton>
        </div>
        {storedProxies.length > 0 || vpnConfigs.length > 0 ? (
          <Popover open={proxyPopoverOpen} onOpenChange={setProxyPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={proxyPopoverOpen}
                aria-controls={proxyListboxIdAntiDetect}
                className="w-full justify-between font-normal"
              >
                {(() => {
                  if (!selectedProxyId) return t("createProfile.proxy.noProxy");
                  if (selectedProxyId.startsWith("vpn-")) {
                    const vpn = vpnConfigs.find(
                      (v) => v.id === selectedProxyId.slice(4),
                    );
                    return vpn
                      ? `WG — ${vpn.name}`
                      : t("createProfile.proxy.noProxy");
                  }
                  const proxy = storedProxies.find(
                    (p) => p.id === selectedProxyId,
                  );
                  return proxy?.name ?? t("createProfile.proxy.noProxy");
                })()}
                <LuChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              id={proxyListboxIdAntiDetect}
              className="w-[240px] p-0"
              sideOffset={8}
            >
              <Command>
                <CommandInput placeholder={t("createProfile.proxy.search")} />
                <CommandList>
                  <CommandEmpty>
                    {t("createProfile.proxy.notFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        setSelectedProxyId(undefined);
                        setProxyPopoverOpen(false);
                      }}
                    >
                      <LuCheck
                        className={cn(
                          "mr-2 size-4",
                          !selectedProxyId ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {t("common.labels.none")}
                    </CommandItem>
                    {storedProxies.map((proxy) => (
                      <CommandItem
                        key={proxy.id}
                        value={proxy.name}
                        onSelect={() => {
                          setSelectedProxyId(proxy.id);
                          setProxyPopoverOpen(false);
                        }}
                      >
                        <LuCheck
                          className={cn(
                            "mr-2 size-4",
                            selectedProxyId === proxy.id
                              ? "opacity-100"
                              : "opacity-0",
                          )}
                        />
                        {proxy.name}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                  {vpnConfigs.length > 0 && (
                    <CommandGroup heading="VPNs">
                      {vpnConfigs.map((vpn) => (
                        <CommandItem
                          key={vpn.id}
                          value={`vpn-${vpn.name}`}
                          onSelect={() => {
                            setSelectedProxyId(`vpn-${vpn.id}`);
                            setProxyPopoverOpen(false);
                          }}
                        >
                          <LuCheck
                            className={cn(
                              "mr-2 size-4",
                              selectedProxyId === `vpn-${vpn.id}`
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          <Badge
                            variant="outline"
                            className="mr-1 px-1 py-0 text-[10px] leading-tight"
                          >
                            WG
                          </Badge>
                          {vpn.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex items-center gap-3 rounded-md border p-3 text-sm text-muted-foreground">
            {t("createProfile.proxy.noProxiesAvailable")}
          </div>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="launch-hook-url">
          {t("createProfile.launchHook.label")}
        </Label>
        <Input
          id="launch-hook-url"
          value={launchHook}
          onChange={(e) => {
            setLaunchHook(e.target.value);
          }}
          placeholder={t("createProfile.launchHook.placeholder")}
          disabled={isCreating}
        />
      </div>

      {/* DNS Blocklist */}
      <div className="space-y-2">
        <Label>{t("dnsBlocklist.title")}</Label>
        <Select
          value={dnsBlocklist || "none"}
          onValueChange={(val) => {
            setDnsBlocklist(val === "none" ? "" : val);
          }}
        >
          <SelectTrigger>
            <SelectValue placeholder={t("dnsBlocklist.none")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("dnsBlocklist.none")}</SelectItem>
            <SelectItem value="light">{t("dnsBlocklist.light")}</SelectItem>
            <SelectItem value="normal">{t("dnsBlocklist.normal")}</SelectItem>
            <SelectItem value="pro">{t("dnsBlocklist.pro")}</SelectItem>
            <SelectItem value="pro_plus">
              {t("dnsBlocklist.proPlus")}
            </SelectItem>
            <SelectItem value="ultimate">
              {t("dnsBlocklist.ultimate")}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Extension Group */}
      {extensionGroups.length > 0 && (
        <div className="space-y-2">
          <Label>{t("extensions.extensionGroup")}</Label>
          <Select
            value={selectedExtensionGroupId ?? "none"}
            onValueChange={(val) => {
              setSelectedExtensionGroupId(val === "none" ? undefined : val);
            }}
          >
            <SelectTrigger>
              <SelectValue placeholder={t("profileInfo.values.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("profileInfo.values.none")}
              </SelectItem>
              {extensionGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} ({g.extension_ids.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
