"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  FaBookmark,
  FaCookieBite,
  FaEllipsisH,
  FaExchangeAlt,
  FaHdd,
  FaInfoCircle,
  FaMapMarkerAlt,
  FaNetworkWired,
  FaPlus,
  FaPuzzlePiece,
  FaTerminal,
} from "react-icons/fa";
import {
  LuCheck,
  LuChevronsUpDown,
  LuInfo,
  LuLoaderCircle,
  LuRefreshCw,
} from "react-icons/lu";
import { toast } from "sonner";

import { ProxyFormDialog } from "@/components/proxy";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { useBrowserDownload } from "@/hooks/use-browser-download";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { cn } from "@/lib/utils";
import type {
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";

import { BaseInfoTab } from "./sub-components/base-info-tab";
import { CommandTab } from "./sub-components/command-tab";
import { CookiesTab } from "./sub-components/cookies-tab";
import { HardwareTab } from "./sub-components/hardware-tab";
import { LocationTab } from "./sub-components/location-tab";
import { OtherTab } from "./sub-components/other-tab";

const getCurrentOS = (): WayfernOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

const osLabels: Record<WayfernOS, string> = {
  windows: "Windows",
  macos: "macOS",
  linux: "Linux",
  android: "Android",
  ios: "iOS",
};

interface CreateProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProfile: (profileData: {
    name: string;
    browserStr: "camoufox" | "wayfern";
    version: string;
    releaseType: string;
    proxyId?: string;
    vpnId?: string;
    wayfernConfig?: WayfernConfig;
    groupId?: string;
    extensionGroupId?: string;
    ephemeral?: boolean;
    dnsBlocklist?: string;
    launchHook?: string;
    password?: string;
  }) => Promise<any>;
  selectedGroupId?: string;
  crossOsUnlocked?: boolean;
}

export function CreateProfileDialog({
  isOpen,
  onClose,
  onCreateProfile,
  selectedGroupId,
  crossOsUnlocked = false,
}: CreateProfileDialogProps) {
  const { t } = useTranslation();
  const proxyListboxId = useId();

  // Dialog Navigation & Basic States
  const [activeTab, setActiveTab] = useState("base-info");
  const [profileName, setProfileName] = useState("");
  const [groupId, setGroupId] = useState<string | undefined>(selectedGroupId);
  const [profileGroups, setProfileGroups] = useState<any[]>([]);
  const [batchCount, setBatchCount] = useState(1);

  // Configuration States
  const [selectedProxyId, setSelectedProxyId] = useState<string>();
  const [proxyPopoverOpen, setProxyPopoverOpen] = useState(false);
  const [dnsBlocklist, setDnsBlocklist] = useState<string>("");
  const [launchHook, setLaunchHook] = useState("");
  const [rawCookies, setRawCookies] = useState("");

  // Wayfern Config
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>(() => ({
    os: getCurrentOS(),
  }));
  const [fingerprintConfig, setFingerprintConfig] =
    useState<WayfernFingerprintConfig>({});

  // Extensions
  const [selectedExtensionGroupId, setSelectedExtensionGroupId] =
    useState<string>();
  const [extensionGroups, setExtensionGroups] = useState<any[]>([]);

  // Other configurations
  const [ephemeral, setEphemeral] = useState(false);
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const PASSWORD_MIN_LEN = 8;

  // Loading States
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isGeneratingFingerprint, setIsGeneratingFingerprint] = useState(false);

  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();

  // Browser version fetching hooks
  const {
    isBrowserDownloading,
    downloadBrowser,
    loadDownloadedVersions,
    isVersionDownloaded,
    downloadedVersionsMap,
  } = useBrowserDownload();

  const [releaseTypes, setReleaseTypes] = useState<any>({});
  const [isLoadingReleaseTypes, setIsLoadingReleaseTypes] = useState(false);
  const [_releaseTypesError, setReleaseTypesError] = useState<string | null>(
    null,
  );

  // Load profile groups and extension groups
  useEffect(() => {
    if (isOpen) {
      void invoke<any[]>("get_groups_with_profile_counts")
        .then(setProfileGroups)
        .catch(() => setProfileGroups([]));

      void invoke<any[]>("list_extension_groups")
        .then(setExtensionGroups)
        .catch(() => setExtensionGroups([]));

      // Reset default GroupId
      setGroupId(selectedGroupId);
    }
  }, [isOpen, selectedGroupId]);

  // Check and download GeoIP database (required by Wayfern)
  const checkAndDownloadGeoIPDatabase = useCallback(async () => {
    try {
      const isAvailable = await invoke<boolean>("is_geoip_database_available");
      if (!isAvailable) {
        await invoke("download_geoip_database");
      }
    } catch (error) {
      console.error("Failed to check/download GeoIP database:", error);
    }
  }, []);

  // Fetch available Wayfern browser versions
  const loadReleaseTypes = useCallback(
    async (browser: string) => {
      setIsLoadingReleaseTypes(true);
      setReleaseTypesError(null);

      try {
        const rawReleaseTypes = await invoke<any>("get_browser_release_types", {
          browserStr: browser,
        });

        await loadDownloadedVersions(browser);

        const filtered: any = {};
        if (rawReleaseTypes.stable) filtered.stable = rawReleaseTypes.stable;
        setReleaseTypes(filtered);
      } catch (error) {
        console.error(`Failed to load release types for ${browser}:`, error);
        try {
          const downloaded = await loadDownloadedVersions(browser);
          if (downloaded.length > 0) {
            const fallback: any = {};
            fallback.stable = downloaded[0];
            setReleaseTypes(fallback);
          } else {
            setReleaseTypesError(
              "Failed to fetch browser versions. Please check your internet connection.",
            );
          }
        } catch (_e) {
          setReleaseTypesError(
            "Failed to fetch browser versions. Please check your internet connection.",
          );
        }
      } finally {
        setIsLoadingReleaseTypes(false);
      }
    },
    [loadDownloadedVersions],
  );

  const getBestAvailableVersion = useCallback(
    (_browserStr?: string) => {
      if (!releaseTypes) return null;
      if (releaseTypes.stable) {
        return { version: releaseTypes.stable, releaseType: "stable" as const };
      }
      return null;
    },
    [releaseTypes],
  );

  const getCreatableVersion = useCallback(
    (browserType?: string) => {
      const bestVersion = getBestAvailableVersion(browserType);
      if (bestVersion && isVersionDownloaded(bestVersion.version)) {
        return bestVersion;
      }
      const browserDownloaded = downloadedVersionsMap[browserType ?? ""] ?? [];
      if (browserDownloaded.length > 0) {
        const fallbackVersion = browserDownloaded[0];
        return {
          version: fallbackVersion,
          releaseType: "stable" as const,
        };
      }
      return null;
    },
    [getBestAvailableVersion, isVersionDownloaded, downloadedVersionsMap],
  );

  // Generate a random sample fingerprint inside the UI
  const handleGenerateFingerprint = useCallback(
    async (currentConfig?: WayfernConfig) => {
      const bestVersion = getCreatableVersion("wayfern");
      if (!bestVersion) return;
      setIsGeneratingFingerprint(true);
      try {
        const configToUse = currentConfig || wayfernConfig;
        const configJson = JSON.stringify(configToUse);
        const result = await invoke<string>("generate_sample_fingerprint", {
          browser: "wayfern",
          version: bestVersion.version,
          configJson,
        });
        setWayfernConfig((prev) => ({ ...prev, fingerprint: result }));
        toast.success("New sample fingerprint generated successfully");
      } catch (error) {
        console.error("Failed to generate fingerprint:", error);
        toast.error("Failed to generate sample fingerprint");
      } finally {
        setIsGeneratingFingerprint(false);
      }
    },
    [getCreatableVersion, wayfernConfig],
  );

  // Load versions and GeoIP data on mount
  useEffect(() => {
    if (isOpen) {
      void loadDownloadedVersions("wayfern");
      void loadReleaseTypes("wayfern");
      void checkAndDownloadGeoIPDatabase();
    }
  }, [
    isOpen,
    loadReleaseTypes,
    loadDownloadedVersions,
    checkAndDownloadGeoIPDatabase,
  ]);

  // Sync fingerprintConfig state with wayfernConfig.fingerprint JSON string
  useEffect(() => {
    if (wayfernConfig.fingerprint) {
      try {
        const parsed = JSON.parse(
          wayfernConfig.fingerprint,
        ) as WayfernFingerprintConfig;
        setFingerprintConfig(parsed);
      } catch (error) {
        console.error("Failed to parse fingerprint config:", error);
        setFingerprintConfig({});
      }
    } else {
      setFingerprintConfig({});
    }
  }, [wayfernConfig.fingerprint]);

  // Tự động sinh vân tay lần đầu khi mở Dialog và phiên bản trình duyệt đã sẵn sàng
  useEffect(() => {
    if (isOpen && !wayfernConfig.fingerprint && !isGeneratingFingerprint) {
      const bestVersion = getCreatableVersion("wayfern");
      if (bestVersion) {
        void handleGenerateFingerprint(wayfernConfig);
      }
    }
  }, [
    isOpen,
    wayfernConfig,
    isGeneratingFingerprint,
    getCreatableVersion,
    handleGenerateFingerprint,
  ]);

  const updateWayfernConfig = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => {
      const updated = { ...prev, [key]: value };
      if (key === "os") {
        void handleGenerateFingerprint(updated);
      }
      return updated;
    });
  };

  const updateFingerprintConfig = (
    key: keyof WayfernFingerprintConfig,
    value: unknown,
  ) => {
    const newConfig = { ...fingerprintConfig };

    if (
      value === undefined ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    ) {
      delete newConfig[key];
    } else {
      (newConfig as Record<string, unknown>)[key] = value;
    }

    setFingerprintConfig(newConfig);

    try {
      const jsonString = JSON.stringify(newConfig);
      updateWayfernConfig("fingerprint", jsonString);
    } catch (error) {
      console.error("Failed to serialize fingerprint config:", error);
    }
  };

  const handleAutoLocationToggle = (enabled: boolean) => {
    updateWayfernConfig("geoip", enabled);
  };

  const isAutoLocationEnabled = wayfernConfig.geoip !== false;

  const isFingerprintEditingDisabled =
    wayfernConfig.randomize_fingerprint_on_launch === true;

  const _handleDownload = async (browserStr: string) => {
    const bestVersion = getBestAvailableVersion(browserStr);
    if (!bestVersion) return;
    try {
      await downloadBrowser(browserStr, bestVersion.version);
    } catch (error) {
      console.error("Failed to download browser:", error);
    }
  };

  const handleCreate = async () => {
    if (!profileName.trim()) return;

    if (enablePassword && !ephemeral) {
      if (password.length < PASSWORD_MIN_LEN) {
        setPasswordError(
          t("profilePassword.errors.tooShort", { min: PASSWORD_MIN_LEN }),
        );
        return;
      }
      if (password !== passwordConfirm) {
        setPasswordError(t("profilePassword.errors.mismatch"));
        return;
      }
    }
    setPasswordError(null);
    setIsCreating(true);

    const isVpnSelection = selectedProxyId?.startsWith("vpn-") ?? false;
    const resolvedProxyId = isVpnSelection ? undefined : selectedProxyId;
    const resolvedVpnId =
      isVpnSelection && selectedProxyId ? selectedProxyId.slice(4) : undefined;

    const passwordToSet =
      enablePassword && !ephemeral && password.length >= PASSWORD_MIN_LEN
        ? password
        : undefined;

    try {
      const bestWayfernVersion = getCreatableVersion("wayfern");
      if (!bestWayfernVersion) {
        toast.error(
          "No Wayfern browser version downloaded. Please download it first.",
        );
        return;
      }

      const finalWayfernConfig = { ...wayfernConfig };
      const count = Math.max(1, batchCount);

      for (let i = 1; i <= count; i++) {
        const finalName =
          count > 1 ? `${profileName.trim()} ${i}` : profileName.trim();

        // 1. Create the browser profile
        const createdProfile = await onCreateProfile({
          name: finalName,
          browserStr: "wayfern",
          version: bestWayfernVersion.version,
          releaseType: bestWayfernVersion.releaseType,
          proxyId: resolvedProxyId,
          vpnId: resolvedVpnId,
          wayfernConfig: finalWayfernConfig,
          groupId: groupId && groupId !== "none" ? groupId : undefined,
          extensionGroupId: selectedExtensionGroupId,
          ephemeral,
          dnsBlocklist: dnsBlocklist || undefined,
          launchHook: launchHook.trim() || undefined,
          password: passwordToSet,
        });

        // 2. Import raw cookies if provided
        if (createdProfile?.id && rawCookies.trim()) {
          try {
            await invoke("import_cookies_from_file", {
              profileId: createdProfile.id,
              content: rawCookies.trim(),
            });
          } catch (cookieErr) {
            console.error(
              `Failed to import cookies for profile ${finalName}:`,
              cookieErr,
            );
            toast.warning(
              `Profile created, but cookie import failed for ${finalName}`,
            );
          }
        }
      }

      toast.success(
        count > 1
          ? `Successfully created ${count} profiles`
          : "Profile created successfully",
      );
      handleClose();
    } catch (error) {
      console.error("Failed to create profile:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    setProfileName("");
    setGroupId(selectedGroupId);
    setBatchCount(1);
    setSelectedProxyId(undefined);
    setLaunchHook("");
    setDnsBlocklist("");
    setRawCookies("");
    setSelectedExtensionGroupId(undefined);
    setWayfernConfig({
      os: getCurrentOS(),
    });
    setEphemeral(false);
    setEnablePassword(false);
    setPassword("");
    setPasswordConfirm("");
    setPasswordError(null);
    setActiveTab("base-info");
    onClose();
  };

  const isBrowserCurrentlyDownloading = useCallback(
    (browserStr: string) => {
      return isBrowserDownloading(browserStr);
    },
    [isBrowserDownloading],
  );

  const _isBrowserVersionAvailable = useCallback(
    (browserStr: string) => {
      const bestVersion = getBestAvailableVersion(browserStr);
      return !!(bestVersion && isVersionDownloaded(bestVersion.version));
    },
    [isVersionDownloaded, getBestAvailableVersion],
  );

  const isCreateDisabled = useMemo(() => {
    if (!profileName.trim()) return true;
    if (isBrowserCurrentlyDownloading("wayfern")) return true;
    if (!getCreatableVersion("wayfern")) return true;
    return false;
  }, [profileName, isBrowserCurrentlyDownloading, getCreatableVersion]);

  // Sidebar Items Definition
  const tabItems = [
    {
      index: 1,
      value: "base-info",
      label: t("createProfile.tabs.baseInfo") || "Base info",
      icon: FaInfoCircle,
      color: "text-primary",
    },
    {
      index: 2,
      value: "location",
      label: t("createProfile.tabs.location") || "Location",
      icon: FaMapMarkerAlt,
      color: "text-success",
    },
    {
      index: 3,
      value: "proxy",
      label: t("createProfile.tabs.proxy") || "Proxy",
      icon: FaNetworkWired,
      color: "text-warning",
    },
    {
      index: 4,
      value: "cookies",
      label: t("createProfile.tabs.cookies") || "Cookies",
      icon: FaCookieBite,
      color: "text-accent",
    },
    {
      index: 5,
      value: "hardware",
      label: t("createProfile.tabs.hardware") || "Hardware",
      icon: FaHdd,
      color: "text-destructive",
    },
    {
      index: 6,
      value: "command",
      label: t("createProfile.tabs.command") || "Command",
      icon: FaTerminal,
      color: "text-primary",
    },
    {
      index: 7,
      value: "bookmark",
      label: t("createProfile.tabs.bookmark") || "Bookmark",
      icon: FaBookmark,
      color: "text-accent",
    },
    {
      index: 8,
      value: "extension",
      label: t("createProfile.tabs.extension") || "Extension",
      icon: FaPuzzlePiece,
      color: "text-success",
    },
    {
      index: 9,
      value: "requests",
      label: t("createProfile.tabs.requests") || "Requests",
      icon: FaExchangeAlt,
      color: "text-warning",
    },
    {
      index: 10,
      value: "other",
      label: t("createProfile.tabs.other") || "Other",
      icon: FaEllipsisH,
      color: "text-muted-foreground",
    },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-5xl h-[85vh] flex flex-col p-0 overflow-hidden bg-background">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b shrink-0 bg-muted/5">
          <div>
            <DialogTitle className="text-lg font-bold">
              {t("createProfile.title")}
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Configure your browser anti-detect parameters, location and
              proxies
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="text-xs gap-1.5 text-muted-foreground hover:text-foreground"
          >
            <LuInfo className="size-4" />
            How to create a profile
          </Button>
        </div>

        {/* Sidebar + Content Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={setActiveTab}
          className="flex flex-1 min-h-0 w-full"
        >
          {/* Sidebar Left List */}
          <TabsList className="flex flex-col justify-start items-stretch w-56 shrink-0 border-r bg-gradient-to-b from-muted/20 via-muted/5 to-transparent p-3 h-full gap-1.5 rounded-none">
            {tabItems.map((tab) => {
              const TabIcon = tab.icon;
              return (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={cn(
                    "justify-start gap-3 px-3 py-2.5 h-auto text-xs md:text-sm font-medium text-left w-full transition-all border-l-4 border-transparent rounded-r-md rounded-l-none",
                    "data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:border-primary data-[state=active]:font-semibold data-[state=active]:shadow-sm text-muted-foreground hover:text-foreground hover:bg-muted/30",
                  )}
                >
                  <span className="text-xs opacity-60 w-4 text-right shrink-0">
                    {tab.index}.
                  </span>
                  <TabIcon className={cn("size-4 shrink-0", tab.color)} />
                  <span className="truncate">{tab.label}</span>
                </TabsTrigger>
              );
            })}
          </TabsList>

          {/* Right Scrollable Content */}
          <div className="flex-1 flex flex-col min-w-0">
            <ScrollArea className="flex-1 p-6">
              {/* 1. Base Info */}
              <TabsContent value="base-info" className="m-0 space-y-6">
                <BaseInfoTab
                  profileName={profileName}
                  setProfileName={setProfileName}
                  groupId={groupId}
                  setGroupId={setGroupId}
                  groups={profileGroups}
                  wayfernConfig={wayfernConfig}
                  updateWayfernConfig={updateWayfernConfig}
                  fingerprintConfig={fingerprintConfig}
                  updateFingerprintConfig={updateFingerprintConfig}
                  isLoadingReleaseTypes={isLoadingReleaseTypes}
                  getCreatableVersion={getCreatableVersion}
                  crossOsUnlocked={crossOsUnlocked}
                  currentOS={getCurrentOS()}
                  osLabels={osLabels}
                  isCreateDisabled={isCreateDisabled}
                  isCreating={isCreating}
                  handleCreate={handleCreate}
                />
              </TabsContent>

              {/* 2. Location */}
              <TabsContent value="location" className="m-0 space-y-6">
                <LocationTab
                  fingerprintConfig={fingerprintConfig}
                  updateFingerprintConfig={updateFingerprintConfig}
                  isEditingDisabled={isFingerprintEditingDisabled}
                  isAutoLocationEnabled={isAutoLocationEnabled}
                  handleAutoLocationToggle={handleAutoLocationToggle}
                />
              </TabsContent>

              {/* 3. Proxy */}
              <TabsContent value="proxy" className="m-0 space-y-4">
                <div className="space-y-1 pb-2">
                  <h3 className="text-base font-bold">
                    {t("createProfile.proxy.title")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Select a proxy or a WireGuard VPN configuration for this
                    profile.
                  </p>
                </div>
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label>Connection Routing</Label>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setShowProxyForm(true)}
                      className="h-8 px-2.5 text-xs gap-1.5 border-dashed"
                    >
                      <FaPlus className="size-2.5" />
                      {t("createProfile.proxy.addProxy")}
                    </Button>
                  </div>
                  {storedProxies.length > 0 || vpnConfigs.length > 0 ? (
                    <Popover
                      open={proxyPopoverOpen}
                      onOpenChange={setProxyPopoverOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          role="combobox"
                          aria-expanded={proxyPopoverOpen}
                          aria-controls={proxyListboxId}
                          className="w-full justify-between font-normal h-9 text-xs md:text-sm"
                        >
                          {(() => {
                            if (!selectedProxyId)
                              return t("createProfile.proxy.noProxy");
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
                            return (
                              proxy?.name ?? t("createProfile.proxy.noProxy")
                            );
                          })()}
                          <LuChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        id={proxyListboxId}
                        className="w-[300px] p-0"
                        sideOffset={8}
                      >
                        <Command>
                          <CommandInput
                            placeholder={t("createProfile.proxy.search")}
                            className="h-9"
                          />
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
                                    !selectedProxyId
                                      ? "opacity-100"
                                      : "opacity-0",
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
                                      className="mr-2 px-1 py-0 text-[10px]"
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
                    <div className="flex items-center justify-center border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                      {t("createProfile.proxy.noProxiesAvailable")}
                    </div>
                  )}
                </div>
              </TabsContent>

              {/* 4. Cookies */}
              <TabsContent value="cookies" className="m-0">
                <CookiesTab
                  rawCookies={rawCookies}
                  setRawCookies={setRawCookies}
                />
              </TabsContent>

              {/* 5. Hardware */}
              <TabsContent value="hardware" className="m-0 space-y-6">
                <HardwareTab
                  fingerprintConfig={fingerprintConfig}
                  updateFingerprintConfig={updateFingerprintConfig}
                  isEditingDisabled={isFingerprintEditingDisabled}
                />
              </TabsContent>

              {/* 6. Command */}
              <TabsContent value="command" className="m-0 space-y-6">
                <CommandTab
                  launchHook={launchHook}
                  setLaunchHook={setLaunchHook}
                  isCreating={isCreating}
                />
              </TabsContent>

              {/* 7. Bookmark */}
              <TabsContent value="bookmark" className="m-0 space-y-4">
                <div className="space-y-1">
                  <h3 className="text-base font-bold">Default Bookmarks</h3>
                  <p className="text-xs text-muted-foreground">
                    Configure initial bookmarks that will be available inside
                    the profile.
                  </p>
                </div>
                <div className="flex flex-col items-center justify-center border border-dashed rounded-lg p-12 text-center bg-muted/5">
                  <FaBookmark className="size-10 text-muted-foreground/30 mb-4 animate-pulse" />
                  <h4 className="text-sm font-semibold text-foreground">
                    Bookmarks Import & Sync
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-sm mt-1 mb-3">
                    This feature is currently under active development. In the
                    next release, you will be able to bulk import bookmarks via
                    HTML file upload.
                  </p>
                </div>
              </TabsContent>

              {/* 8. Extension */}
              <TabsContent value="extension" className="m-0 space-y-4">
                <div className="space-y-1 pb-2">
                  <h3 className="text-base font-bold">Extension Group</h3>
                  <p className="text-xs text-muted-foreground">
                    Select an extension group to automatically load required
                    extensions into the profile.
                  </p>
                </div>
                {extensionGroups.length > 0 ? (
                  <div className="space-y-2">
                    <Label htmlFor="ext-group-sel">
                      {t("extensions.extensionGroup")}
                    </Label>
                    <Select
                      value={selectedExtensionGroupId ?? "none"}
                      onValueChange={(val) => {
                        setSelectedExtensionGroupId(
                          val === "none" ? undefined : val,
                        );
                      }}
                    >
                      <SelectTrigger id="ext-group-sel" className="h-9">
                        <SelectValue
                          placeholder={t("profileInfo.values.none")}
                        />
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
                ) : (
                  <div className="flex flex-col items-center justify-center border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
                    No extension groups created yet. Create groups in the
                    Extension settings page to use this feature.
                  </div>
                )}
              </TabsContent>

              {/* 9. Requests */}
              <TabsContent value="requests" className="m-0 space-y-4">
                <div className="space-y-1 pb-2">
                  <h3 className="text-base font-bold">Requests & Blocking</h3>
                  <p className="text-xs text-muted-foreground">
                    Block tracking, ads, and malicious domains at the DNS level.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dns-blocklist-sel">
                    {t("dnsBlocklist.title")}
                  </Label>
                  <Select
                    value={dnsBlocklist || "none"}
                    onValueChange={(val) => {
                      setDnsBlocklist(val === "none" ? "" : val);
                    }}
                  >
                    <SelectTrigger id="dns-blocklist-sel" className="h-9">
                      <SelectValue placeholder={t("dnsBlocklist.none")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">
                        {t("dnsBlocklist.none")}
                      </SelectItem>
                      <SelectItem value="light">
                        {t("dnsBlocklist.light")}
                      </SelectItem>
                      <SelectItem value="normal">
                        {t("dnsBlocklist.normal")}
                      </SelectItem>
                      <SelectItem value="pro">
                        {t("dnsBlocklist.pro")}
                      </SelectItem>
                      <SelectItem value="pro_plus">
                        {t("dnsBlocklist.proPlus")}
                      </SelectItem>
                      <SelectItem value="ultimate">
                        {t("dnsBlocklist.ultimate")}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </TabsContent>

              {/* 10. Other */}
              <TabsContent value="other" className="m-0 space-y-6">
                <OtherTab
                  ephemeral={ephemeral}
                  setEphemeral={setEphemeral}
                  enablePassword={setEnablePassword}
                  enablePasswordVal={enablePassword}
                  password={password}
                  setPassword={setPassword}
                  passwordConfirm={passwordConfirm}
                  setPasswordConfirm={setPasswordConfirm}
                  passwordError={passwordError}
                  setPasswordError={setPasswordError}
                />
              </TabsContent>
            </ScrollArea>
          </div>
        </Tabs>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t shrink-0 bg-muted/5">
          {/* Footer Left: Qty and Get Fingerprint */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Label
                htmlFor="batch-count-input"
                className="text-xs font-semibold text-muted-foreground select-none shrink-0"
              >
                {t("createProfile.quantity") || "Qty"}:
              </Label>
              <Input
                id="batch-count-input"
                type="number"
                min={1}
                max={100}
                value={batchCount}
                onChange={(e) =>
                  setBatchCount(Math.max(1, parseInt(e.target.value, 10) || 1))
                }
                className="w-16 h-8 text-center font-bold text-xs"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleGenerateFingerprint()}
              disabled={
                isGeneratingFingerprint || !getCreatableVersion("wayfern")
              }
              className="h-8 px-3 text-xs gap-1.5 border-warning/60 bg-warning/5 text-warning hover:bg-warning/20 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isGeneratingFingerprint ? (
                <LuLoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <LuRefreshCw className="size-3.5" />
              )}
              {t("createProfile.getFingerprint") || "Get new fingerprint"}
            </Button>
          </div>

          {/* Footer Right: Action Buttons */}
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
              className="h-8 text-xs md:text-sm hover:bg-muted/50"
            >
              {t("common.buttons.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreateDisabled || isCreating}
              className="h-8 text-xs md:text-sm gap-1.5 bg-gradient-to-r from-primary to-primary/85 hover:from-primary/95 hover:to-primary/75 text-primary-foreground font-semibold shadow-md shadow-primary/15 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isCreating && (
                <LuLoaderCircle className="size-3.5 animate-spin" />
              )}
              {t("common.buttons.create")}
            </Button>
          </div>
        </div>
      </DialogContent>
      <ProxyFormDialog
        isOpen={showProxyForm}
        onClose={() => setShowProxyForm(false)}
      />
    </Dialog>
  );
}
