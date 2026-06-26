"use client";

import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";
import { LoadingButton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { cn } from "@/lib/utils";

interface CreateProfileRegularTabProps {
  profileName: string;
  setProfileName: (name: string) => void;
  isCreating: boolean;
  isCreateDisabled: boolean;
  handleCreate: () => Promise<void>;
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
  storedProxies: any[];
  vpnConfigs: any[];
  selectedProxyId: string | undefined;
  setSelectedProxyId: (id: string | undefined) => void;
  proxyPopoverOpen: boolean;
  setProxyPopoverOpen: (open: boolean) => void;
  proxyListboxIdRegular: string;
  setShowProxyForm: (show: boolean) => void;
  launchHook: string;
  setLaunchHook: (hook: string) => void;
}

export function CreateProfileRegularTab({
  profileName,
  setProfileName,
  isCreating,
  isCreateDisabled,
  handleCreate,
  selectedBrowser,
  isLoadingReleaseTypes,
  releaseTypesError,
  loadReleaseTypes,
  getBestAvailableVersion,
  getCreatableVersion,
  isBrowserCurrentlyDownloading,
  handleDownload,
  storedProxies,
  vpnConfigs,
  selectedProxyId,
  setSelectedProxyId,
  proxyPopoverOpen,
  setProxyPopoverOpen,
  proxyListboxIdRegular,
  setShowProxyForm,
  launchHook,
  setLaunchHook,
}: CreateProfileRegularTabProps) {
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

      {/* Regular Browser Configuration */}
      <div className="space-y-4">
        {selectedBrowser && (
          <div className="space-y-3">
            {isLoadingReleaseTypes && (
              <div className="flex items-center gap-3">
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
              !isBrowserCurrentlyDownloading(selectedBrowser) &&
              !getCreatableVersion(selectedBrowser) &&
              getBestAvailableVersion(selectedBrowser) && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-muted-foreground">
                    {t("createProfile.version.latestNeedsDownload", {
                      version:
                        getBestAvailableVersion(selectedBrowser)?.version,
                    })}
                  </p>
                  <LoadingButton
                    onClick={() => {
                      void handleDownload(selectedBrowser);
                    }}
                    isLoading={isBrowserCurrentlyDownloading(selectedBrowser)}
                    className="ml-auto"
                    size="sm"
                    disabled={isBrowserCurrentlyDownloading(selectedBrowser)}
                  >
                    {t("common.buttons.download")}
                  </LoadingButton>
                </div>
              )}
            {!isLoadingReleaseTypes &&
              !releaseTypesError &&
              !isBrowserCurrentlyDownloading(selectedBrowser) &&
              getCreatableVersion(selectedBrowser) && (
                <div className="text-sm text-muted-foreground">
                  ✓{" "}
                  {t("createProfile.version.latestAvailable", {
                    version: getCreatableVersion(selectedBrowser)?.version,
                  })}
                </div>
              )}
            {isBrowserCurrentlyDownloading(selectedBrowser) && (
              <div className="text-sm text-muted-foreground">
                {t("createProfile.version.latestDownloading", {
                  version: getBestAvailableVersion(selectedBrowser)?.version,
                })}
              </div>
            )}
          </div>
        )}
      </div>

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
                aria-controls={proxyListboxIdRegular}
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
              id={proxyListboxIdRegular}
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
                    {storedProxies
                      .filter(
                        (proxy) =>
                          !proxy.is_profile_specific ||
                          selectedProxyId === proxy.id,
                      )
                      .map((proxy) => (
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
        <Label htmlFor="launch-hook-url-regular">
          {t("createProfile.launchHook.label")}
        </Label>
        <Input
          id="launch-hook-url-regular"
          value={launchHook}
          onChange={(e) => {
            setLaunchHook(e.target.value);
          }}
          placeholder={t("createProfile.launchHook.placeholder")}
          disabled={isCreating}
        />
      </div>
    </div>
  );
}
