"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LuLoaderCircle } from "react-icons/lu";
import { ProxyFormDialog } from "@/components/proxy";
import { LoadingButton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useBrowserDownload } from "@/hooks/use-browser-download";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { getBrowserIcon } from "@/lib/browser-utils";
import type { BrowserReleaseTypes, WayfernConfig, WayfernOS } from "@/types";
import { CreateProfileAntiDetectTab } from "./sub-components/create-profile-anti-detect-tab";
import { CreateProfileRegularTab } from "./sub-components/create-profile-regular-tab";

const getCurrentOS = (): WayfernOS => {
  if (typeof navigator === "undefined") return "linux";
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("win")) return "windows";
  if (platform.includes("mac")) return "macos";
  return "linux";
};

import { RippleButton } from "../ui/ripple";

type BrowserTypeString = "camoufox" | "wayfern";

interface CreateProfileDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProfile: (profileData: {
    name: string;
    browserStr: BrowserTypeString;
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
  }) => Promise<void>;
  selectedGroupId?: string;
  crossOsUnlocked?: boolean;
}

interface BrowserOption {
  value: BrowserTypeString;
  label: string;
}

const browserOptions: BrowserOption[] = [
  {
    value: "wayfern",
    label: "Wayfern",
  },
];

export function CreateProfileDialog({
  isOpen,
  onClose,
  onCreateProfile,
  selectedGroupId,
  crossOsUnlocked = false,
}: CreateProfileDialogProps) {
  const { t } = useTranslation();
  const proxyListboxIdAntiDetect = useId();
  const proxyListboxIdRegular = useId();
  const [profileName, setProfileName] = useState("");
  // Camoufox is deprecated: only Wayfern profiles can be created, so the dialog
  // opens straight into the Wayfern config step (no browser-selection screen).
  const [currentStep, setCurrentStep] = useState<
    "browser-selection" | "browser-config"
  >("browser-config");
  const [activeTab, setActiveTab] = useState("anti-detect");

  // Browser selection states. Defaults to Wayfern — the only creatable browser.
  const [selectedBrowser, setSelectedBrowser] =
    useState<BrowserTypeString>("wayfern");
  const [selectedProxyId, setSelectedProxyId] = useState<string>();
  const [proxyPopoverOpen, setProxyPopoverOpen] = useState(false);
  const [dnsBlocklist, setDnsBlocklist] = useState<string>("");
  const [launchHook, setLaunchHook] = useState("");

  // Wayfern anti-detect states
  const [wayfernConfig, setWayfernConfig] = useState<WayfernConfig>(() => ({
    os: getCurrentOS(), // Default to current OS
  }));

  // Handle browser selection from the initial screen
  const handleBrowserSelect = (browser: BrowserTypeString) => {
    setSelectedBrowser(browser);
    setCurrentStep("browser-config");
  };

  // Reset the form fields without leaving the Wayfern config step — Camoufox is
  // deprecated, so there is no browser-selection screen to go back to.
  const resetForm = () => {
    setSelectedBrowser("wayfern");
    setProfileName("");
    setSelectedProxyId(undefined);
    setLaunchHook("");
  };

  // Handle back button
  const handleBack = () => {
    resetForm();
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    resetForm();
  };

  const [supportedBrowsers, setSupportedBrowsers] = useState<string[]>([]);
  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [enablePassword, setEnablePassword] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const PASSWORD_MIN_LEN = 8;
  const [selectedExtensionGroupId, setSelectedExtensionGroupId] =
    useState<string>();
  const [extensionGroups, setExtensionGroups] = useState<
    { id: string; name: string; extension_ids: string[] }[]
  >([]);

  useEffect(() => {
    if (isOpen) {
      void invoke<{ id: string; name: string; extension_ids: string[] }[]>(
        "list_extension_groups",
      )
        .then(setExtensionGroups)
        .catch(() => {
          setExtensionGroups([]);
        });
    }
  }, [isOpen]);
  const [releaseTypes, setReleaseTypes] = useState<BrowserReleaseTypes>();
  const [isLoadingReleaseTypes, setIsLoadingReleaseTypes] = useState(false);
  const [releaseTypesError, setReleaseTypesError] = useState<string | null>(
    null,
  );
  const loadingBrowserRef = useRef<string | null>(null);

  // Use the browser download hook
  const {
    isBrowserDownloading,
    downloadBrowser,
    loadDownloadedVersions,
    isVersionDownloaded,
    downloadedVersionsMap,
  } = useBrowserDownload();

  const loadSupportedBrowsers = useCallback(async () => {
    try {
      const browsers = await invoke<string[]>("get_supported_browsers");
      setSupportedBrowsers(browsers);
    } catch (error) {
      console.error("Failed to load supported browsers:", error);
    }
  }, []);

  const checkAndDownloadGeoIPDatabase = useCallback(async () => {
    try {
      const isAvailable = await invoke<boolean>("is_geoip_database_available");
      if (!isAvailable) {
        console.log("GeoIP database not available, downloading...");
        await invoke("download_geoip_database");
        console.log("GeoIP database downloaded successfully");
      }
    } catch (error) {
      console.error("Failed to check/download GeoIP database:", error);
      // Don't show error to user as this is not critical for profile creation
    }
  }, []);

  const loadReleaseTypes = useCallback(
    async (browser: string) => {
      // Set loading state
      loadingBrowserRef.current = browser;
      setIsLoadingReleaseTypes(true);
      setReleaseTypesError(null);

      try {
        const rawReleaseTypes = await invoke<BrowserReleaseTypes>(
          "get_browser_release_types",
          { browserStr: browser },
        );

        await loadDownloadedVersions(browser);

        // Only update state if this browser is still the one we're loading
        if (loadingBrowserRef.current === browser) {
          const filtered: BrowserReleaseTypes = {};
          if (rawReleaseTypes.stable) filtered.stable = rawReleaseTypes.stable;
          setReleaseTypes(filtered);
          setReleaseTypesError(null);
        }
      } catch (error) {
        console.error(`Failed to load release types for ${browser}:`, error);

        // Fallback: still load downloaded versions and derive release type from them if possible
        try {
          const downloaded = await loadDownloadedVersions(browser);
          if (loadingBrowserRef.current === browser && downloaded.length > 0) {
            const latest = downloaded[0];
            const fallback: BrowserReleaseTypes = {};
            fallback.stable = latest;
            setReleaseTypes(fallback);
            setReleaseTypesError(null);
          } else if (loadingBrowserRef.current === browser) {
            // No downloaded versions and API failed - show error
            setReleaseTypesError(
              "Failed to fetch browser versions. Please check your internet connection and try again.",
            );
          }
        } catch (e) {
          console.error(
            `Failed to load downloaded versions for ${browser}:`,
            e,
          );
          if (loadingBrowserRef.current === browser) {
            setReleaseTypesError(
              "Failed to fetch browser versions. Please check your internet connection and try again.",
            );
          }
        }
      } finally {
        // Clear loading state only if we're still loading this browser
        if (loadingBrowserRef.current === browser) {
          loadingBrowserRef.current = null;
          setIsLoadingReleaseTypes(false);
        }
      }
    },
    [loadDownloadedVersions],
  );

  // Load data when dialog opens
  useEffect(() => {
    if (isOpen) {
      void loadSupportedBrowsers();
      // Load downloaded Wayfern versions up front so the availability gate is
      // accurate. Camoufox is deprecated and no longer creatable.
      void loadDownloadedVersions("wayfern");
      // Load release types when a browser is selected
      if (selectedBrowser) {
        void loadReleaseTypes(selectedBrowser);
      }
      // Wayfern needs the GeoIP database for fingerprint generation.
      if (selectedBrowser === "wayfern") {
        void checkAndDownloadGeoIPDatabase();
      }
    }
  }, [
    isOpen,
    loadSupportedBrowsers,
    loadReleaseTypes,
    loadDownloadedVersions,
    checkAndDownloadGeoIPDatabase,
    selectedBrowser,
  ]);

  // Load release types when browser selection changes
  useEffect(() => {
    if (selectedBrowser) {
      // Cancel any previous loading
      loadingBrowserRef.current = null;
      // Clear previous release types immediately to prevent showing stale data
      setReleaseTypes({});
      void loadReleaseTypes(selectedBrowser);
    }
  }, [selectedBrowser, loadReleaseTypes]);

  // Helper function to get the best available version respecting rules
  const getBestAvailableVersion = useCallback(
    (_browserType?: string) => {
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

  const handleDownload = async (browserStr: string) => {
    const bestVersion = getBestAvailableVersion(browserStr);

    if (!bestVersion) {
      console.error("No version available for download");
      return;
    }

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
      if (activeTab === "anti-detect") {
        // Camoufox is deprecated — only Wayfern anti-detect profiles are created.
        const bestWayfernVersion = getCreatableVersion("wayfern");
        if (!bestWayfernVersion) {
          console.error("No Wayfern version available");
          return;
        }

        // The fingerprint will be generated at launch time by the Rust backend
        const finalWayfernConfig = { ...wayfernConfig };

        await onCreateProfile({
          name: profileName.trim(),
          browserStr: "wayfern" as BrowserTypeString,
          version: bestWayfernVersion.version,
          releaseType: bestWayfernVersion.releaseType,
          proxyId: resolvedProxyId,
          vpnId: resolvedVpnId,
          wayfernConfig: finalWayfernConfig,
          groupId:
            selectedGroupId && selectedGroupId !== "__all__"
              ? selectedGroupId
              : undefined,
          extensionGroupId: selectedExtensionGroupId,
          ephemeral,
          dnsBlocklist: dnsBlocklist || undefined,
          launchHook: launchHook.trim() || undefined,
          password: passwordToSet,
        });
      } else {
        // Regular browser
        if (!selectedBrowser) {
          console.error("Missing required browser selection");
          return;
        }

        // Use the best available version (stable preferred, nightly as fallback)
        const bestVersion = getCreatableVersion(selectedBrowser);
        if (!bestVersion) {
          console.error("No version available");
          return;
        }

        await onCreateProfile({
          name: profileName.trim(),
          browserStr: selectedBrowser,
          version: bestVersion.version,
          releaseType: bestVersion.releaseType,
          proxyId: selectedProxyId,
          groupId:
            selectedGroupId && selectedGroupId !== "__all__"
              ? selectedGroupId
              : undefined,
          dnsBlocklist: dnsBlocklist || undefined,
          launchHook: launchHook.trim() || undefined,
          password: passwordToSet,
        });
      }

      handleClose();
    } catch (error) {
      console.error("Failed to create profile:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    // Cancel any ongoing loading
    loadingBrowserRef.current = null;

    // Reset all states. Stay on the Wayfern config step — Camoufox is
    // deprecated, so the browser-selection screen is gone.
    setProfileName("");
    setCurrentStep("browser-config");
    setActiveTab("anti-detect");
    setSelectedBrowser("wayfern");
    setSelectedProxyId(undefined);
    setLaunchHook("");
    setReleaseTypes({});
    setIsLoadingReleaseTypes(false);
    setReleaseTypesError(null);
    setWayfernConfig({
      os: getCurrentOS(), // Reset to current OS
    });
    setEphemeral(false);
    setEnablePassword(false);
    setPassword("");
    setPasswordConfirm("");
    setPasswordError(null);
    onClose();
  };

  const updateWayfernConfig = (key: keyof WayfernConfig, value: unknown) => {
    setWayfernConfig((prev) => ({ ...prev, [key]: value }));
  };

  // Check if browser version is downloaded and available
  const isBrowserVersionAvailable = useCallback(
    (browserStr: string) => {
      const bestVersion = getBestAvailableVersion(browserStr);
      return !!(bestVersion && isVersionDownloaded(bestVersion.version));
    },
    [isVersionDownloaded, getBestAvailableVersion],
  );

  // Check if browser is currently downloading
  const isBrowserCurrentlyDownloading = useCallback(
    (browserStr: string) => {
      return isBrowserDownloading(browserStr);
    },
    [isBrowserDownloading],
  );

  const isCreateDisabled = useMemo(() => {
    if (!profileName.trim()) return true;
    if (!selectedBrowser) return true;
    if (isBrowserCurrentlyDownloading(selectedBrowser)) return true;
    if (!getCreatableVersion(selectedBrowser)) return true;

    return false;
  }, [
    profileName,
    selectedBrowser,
    isBrowserCurrentlyDownloading,
    getCreatableVersion,
  ]);

  // Filter supported browsers for regular browsers
  const regularBrowsers = browserOptions.filter((browser) =>
    supportedBrowsers.includes(browser.value),
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="flex max-h-[90vh] max-w-[min(48rem,calc(100%-4rem))] flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {currentStep === "browser-selection"
              ? t("createProfile.title")
              : t("createProfile.configureTitle", {
                  browser:
                    selectedBrowser === "wayfern"
                      ? t("createProfile.chromiumLabel")
                      : t("createProfile.firefoxLabel"),
                })}
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex min-h-0 w-full flex-1 flex-col"
        >
          {/* Tab list hidden - only anti-detect browsers are supported */}

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="flex w-full flex-col items-center justify-center">
              <div className="w-full space-y-6 py-4">
                {currentStep === "browser-selection" ? (
                  <>
                    <TabsContent value="anti-detect" className="mt-0 space-y-6">
                      {/* Anti-Detect Browser Selection */}
                      <div className="space-y-3 pt-8">
                        {/* Wayfern (Chromium) - First */}
                        <Button
                          onClick={() => {
                            handleBrowserSelect("wayfern");
                          }}
                          disabled={!getCreatableVersion("wayfern")}
                          className="flex h-16 w-full items-center justify-start gap-3 border-2 p-4 transition-colors hover:border-primary/50"
                          variant="outline"
                        >
                          <div className="flex size-8 items-center justify-center">
                            {isBrowserCurrentlyDownloading("wayfern") ? (
                              <LuLoaderCircle className="size-6 animate-spin" />
                            ) : (
                              (() => {
                                const IconComponent = getBrowserIcon("wayfern");
                                return IconComponent ? (
                                  <IconComponent className="size-6" />
                                ) : null;
                              })()
                            )}
                          </div>
                          <div className="text-left">
                            <div className="font-medium">
                              {t("createProfile.chromiumLabel")}
                            </div>
                            <div className="text-sm text-muted-foreground">
                              {isBrowserCurrentlyDownloading("wayfern")
                                ? t("createProfile.downloadingSubtitle")
                                : t("createProfile.chromiumSubtitle")}
                            </div>
                          </div>
                        </Button>

                        {/* Camoufox is deprecated — no longer offered for new
                            profiles. Only Wayfern can be created. */}

                        {!getCreatableVersion("wayfern") && (
                          <p className="pt-2 text-center text-sm text-muted-foreground">
                            {t("createProfile.browsersDownloading")}
                          </p>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="regular" className="mt-0 space-y-6">
                      {/* Regular Browser Selection */}
                      <div className="space-y-6">
                        <div className="text-center">
                          <h3 className="text-lg font-medium">
                            {t("createProfile.regular.title")}
                          </h3>
                          <p className="mt-2 text-sm text-muted-foreground">
                            {t("createProfile.regular.description")}
                          </p>
                        </div>

                        <div className="space-y-3">
                          {regularBrowsers.map((browser) => {
                            if (browser.value === "camoufox") return null; // Skip camoufox as it's handled in anti-detect tab
                            const IconComponent = getBrowserIcon(browser.value);
                            return (
                              <Button
                                key={browser.value}
                                onClick={() => {
                                  handleBrowserSelect(browser.value);
                                }}
                                className="flex h-16 w-full items-center justify-start gap-3 border-2 p-4 transition-colors hover:border-primary/50"
                                variant="outline"
                              >
                                <div className="flex size-8 items-center justify-center">
                                  {IconComponent && (
                                    <IconComponent className="size-6" />
                                  )}
                                </div>
                                <div className="text-left">
                                  <div className="font-medium">
                                    {browser.label}
                                  </div>
                                  <div className="text-sm text-muted-foreground">
                                    {t("createProfile.regular.badge")}
                                  </div>
                                </div>
                              </Button>
                            );
                          })}
                        </div>
                      </div>
                    </TabsContent>
                  </>
                ) : (
                  <>
                    <TabsContent value="anti-detect" className="mt-0">
                      <CreateProfileAntiDetectTab
                        profileName={profileName}
                        setProfileName={setProfileName}
                        isCreating={isCreating}
                        isCreateDisabled={isCreateDisabled}
                        handleCreate={handleCreate}
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
                        selectedBrowser={selectedBrowser}
                        isLoadingReleaseTypes={isLoadingReleaseTypes}
                        releaseTypesError={releaseTypesError}
                        loadReleaseTypes={loadReleaseTypes}
                        getBestAvailableVersion={getBestAvailableVersion}
                        getCreatableVersion={getCreatableVersion}
                        isBrowserCurrentlyDownloading={
                          isBrowserCurrentlyDownloading
                        }
                        handleDownload={handleDownload}
                        isBrowserVersionAvailable={isBrowserVersionAvailable}
                        wayfernConfig={wayfernConfig}
                        updateWayfernConfig={updateWayfernConfig}
                        crossOsUnlocked={crossOsUnlocked}
                        storedProxies={storedProxies}
                        vpnConfigs={vpnConfigs}
                        selectedProxyId={selectedProxyId}
                        setSelectedProxyId={setSelectedProxyId}
                        proxyPopoverOpen={proxyPopoverOpen}
                        setProxyPopoverOpen={setProxyPopoverOpen}
                        proxyListboxIdAntiDetect={proxyListboxIdAntiDetect}
                        setShowProxyForm={setShowProxyForm}
                        launchHook={launchHook}
                        setLaunchHook={setLaunchHook}
                        dnsBlocklist={dnsBlocklist}
                        setDnsBlocklist={setDnsBlocklist}
                        extensionGroups={extensionGroups}
                        selectedExtensionGroupId={selectedExtensionGroupId}
                        setSelectedExtensionGroupId={
                          setSelectedExtensionGroupId
                        }
                      />
                    </TabsContent>

                    <TabsContent value="regular" className="mt-0">
                      <CreateProfileRegularTab
                        profileName={profileName}
                        setProfileName={setProfileName}
                        isCreating={isCreating}
                        isCreateDisabled={isCreateDisabled}
                        handleCreate={handleCreate}
                        selectedBrowser={selectedBrowser}
                        isLoadingReleaseTypes={isLoadingReleaseTypes}
                        releaseTypesError={releaseTypesError}
                        loadReleaseTypes={loadReleaseTypes}
                        getBestAvailableVersion={getBestAvailableVersion}
                        getCreatableVersion={getCreatableVersion}
                        isBrowserCurrentlyDownloading={
                          isBrowserCurrentlyDownloading
                        }
                        handleDownload={handleDownload}
                        storedProxies={storedProxies}
                        vpnConfigs={vpnConfigs}
                        selectedProxyId={selectedProxyId}
                        setSelectedProxyId={setSelectedProxyId}
                        proxyPopoverOpen={proxyPopoverOpen}
                        setProxyPopoverOpen={setProxyPopoverOpen}
                        proxyListboxIdRegular={proxyListboxIdRegular}
                        setShowProxyForm={setShowProxyForm}
                        launchHook={launchHook}
                        setLaunchHook={setLaunchHook}
                      />
                    </TabsContent>
                  </>
                )}
              </div>
            </div>
          </ScrollArea>
        </Tabs>

        <DialogFooter className="shrink-0 border-t pt-4">
          {currentStep === "browser-config" ? (
            <>
              <RippleButton variant="outline" onClick={handleBack}>
                {t("common.buttons.back")}
              </RippleButton>
              <LoadingButton
                onClick={handleCreate}
                isLoading={isCreating}
                disabled={isCreateDisabled}
              >
                {t("common.buttons.create")}
              </LoadingButton>
            </>
          ) : (
            <RippleButton variant="outline" onClick={handleClose}>
              {t("common.buttons.cancel")}
            </RippleButton>
          )}
        </DialogFooter>
      </DialogContent>
      <ProxyFormDialog
        isOpen={showProxyForm}
        onClose={() => {
          setShowProxyForm(false);
        }}
      />
    </Dialog>
  );
}
