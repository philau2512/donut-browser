import type { RowSelectionState, SortingState } from "@tanstack/react-table";
import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { useBrowserState } from "@/hooks/use-browser-state";
import { useCloudAuth } from "@/hooks/use-cloud-auth";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useTableSorting } from "@/hooks/use-table-sorting";
import { useTeamLocks } from "@/hooks/use-team-locks";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import type {
  BrowserProfile,
  ExtensionGroup,
  LocationItem,
  ProfileStatusConfig,
  ProxyCheckResult,
  StoredProxy,
  TrafficSnapshot,
} from "@/types";

export interface UseProfilesTableStateParams {
  profiles: BrowserProfile[];
  runningProfiles: Set<string>;
  isUpdating: (browser: string) => boolean;
  selectedProfiles: string[];
  onSelectedProfilesChange: (ids: string[]) => void;
  onRenameProfile: (profileId: string, newName: string) => Promise<void>;
  onDeleteProfile: (profile: BrowserProfile) => void | Promise<void>;
  infoDialogProfile?: BrowserProfile | null;
  onInfoDialogProfileChange?: (profile: BrowserProfile | null) => void;
}

export function useProfilesTableState({
  profiles,
  runningProfiles,
  isUpdating,
  selectedProfiles,
  onSelectedProfilesChange,
  onRenameProfile,
  onDeleteProfile,
  infoDialogProfile,
  onInfoDialogProfileChange,
}: UseProfilesTableStateParams) {
  const { t } = useTranslation();
  const { getTableSorting, updateSorting, isLoaded } = useTableSorting();
  const [sorting, setSorting] = React.useState<SortingState>([]);

  // Sync external selectedProfiles with table's row selection state
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>({});
  const prevSelectedProfilesRef = React.useRef<string[]>(selectedProfiles);
  const [showCheckboxes, setShowCheckboxes] = React.useState(false);

  // Update row selection when external selectedProfiles changes
  React.useEffect(() => {
    // Only update if selectedProfiles actually changed
    if (
      prevSelectedProfilesRef.current.length !== selectedProfiles.length ||
      !prevSelectedProfilesRef.current.every((id) =>
        selectedProfiles.includes(id),
      )
    ) {
      const newSelection: RowSelectionState = {};
      for (const profileId of selectedProfiles) {
        newSelection[profileId] = true;
      }
      setRowSelection(newSelection);
      prevSelectedProfilesRef.current = selectedProfiles;
      if (selectedProfiles.length === 0) {
        setShowCheckboxes(false);
      }
    }
  }, [selectedProfiles]);

  // Update external selectedProfiles when table selection changes
  const handleRowSelectionChange = React.useCallback(
    (updater: React.SetStateAction<RowSelectionState>) => {
      setRowSelection((prevSelection) => {
        const newSelection =
          typeof updater === "function" ? updater(prevSelection) : updater;

        const selectedIds = Object.keys(newSelection).filter(
          (id) => newSelection[id],
        );

        const prevIdSet = new Set(
          Object.keys(prevSelection).filter((id) => prevSelection[id]),
        );

        if (
          selectedIds.length !== prevIdSet.size ||
          !selectedIds.every((id) => prevIdSet.has(id))
        ) {
          onSelectedProfilesChange(selectedIds);
        }

        return newSelection;
      });
    },
    [onSelectedProfilesChange],
  );

  const [profileToRename, setProfileToRename] =
    React.useState<BrowserProfile | null>(null);
  const [newProfileName, setNewProfileName] = React.useState("");
  const [renameError, setRenameError] = React.useState<string | null>(null);
  const [isRenamingSaving, setIsRenamingSaving] = React.useState(false);
  const renameContainerRef = React.useRef<HTMLDivElement | null>(null);

  const [profileToDelete, setProfileToDelete] =
    React.useState<BrowserProfile | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);

  const [internalInfoDialogProfile, setInternalInfoDialogProfile] =
    React.useState<BrowserProfile | null>(null);
  const isInfoDialogControlled = onInfoDialogProfileChange !== undefined;
  const profileForInfoDialog = isInfoDialogControlled
    ? (infoDialogProfile ?? null)
    : internalInfoDialogProfile;

  const setProfileForInfoDialog = React.useCallback(
    (p: BrowserProfile | null) => {
      if (isInfoDialogControlled) {
        onInfoDialogProfileChange?.(p);
      } else {
        setInternalInfoDialogProfile(p);
      }
    },
    [isInfoDialogControlled, onInfoDialogProfileChange],
  );

  const [bypassRulesProfile, setBypassRulesProfile] =
    React.useState<BrowserProfile | null>(null);
  const [dnsBlocklistProfile, setDnsBlocklistProfile] =
    React.useState<BrowserProfile | null>(null);
  const [launchHookProfile, setLaunchHookProfile] =
    React.useState<BrowserProfile | null>(null);

  const [launchingProfiles, setLaunchingProfiles] = React.useState<Set<string>>(
    new Set(),
  );
  const [stoppingProfiles, setStoppingProfiles] = React.useState<Set<string>>(
    new Set(),
  );

  const { storedProxies } = useProxyEvents();
  const { vpnConfigs } = useVpnEvents();
  const { user } = useCloudAuth();
  const { isProfileLocked, getLockInfo } = useTeamLocks(user?.id);

  const [proxyOverrides, setProxyOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [vpnOverrides, setVpnOverrides] = React.useState<
    Record<string, string | null>
  >({});

  const [tagsOverrides, setTagsOverrides] = React.useState<
    Record<string, string[]>
  >({});
  const [allTags, setAllTags] = React.useState<string[]>([]);
  const [openTagsEditorFor, setOpenTagsEditorFor] = React.useState<
    string | null
  >(null);
  const [openProxySelectorFor, setOpenProxySelectorFor] = React.useState<
    string | null
  >(null);
  const [checkingProfileId, _setCheckingProfileId] = React.useState<
    string | null
  >(null);
  const [proxyCheckResults, setProxyCheckResults] = React.useState<
    Record<string, ProxyCheckResult>
  >({});
  const [noteOverrides, setNoteOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [openNoteEditorFor, setOpenNoteEditorFor] = React.useState<
    string | null
  >(null);
  const [profileStatuses, setProfileStatuses] = React.useState<
    ProfileStatusConfig[]
  >([]);
  const [statusOverrides, setStatusOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [trafficSnapshots, setTrafficSnapshots] = React.useState<
    Record<string, TrafficSnapshot>
  >({});
  const [trafficDialogProfile, setTrafficDialogProfile] = React.useState<{
    id: string;
    name?: string;
  } | null>(null);
  const [syncStatuses, setSyncStatuses] = React.useState<
    Record<string, { status: string; error?: string }>
  >({});

  const [countries, setCountries] = React.useState<LocationItem[]>([]);
  const [countriesLoaded, setCountriesLoaded] = React.useState(false);
  const [extensionGroups, setExtensionGroups] = React.useState<
    ExtensionGroup[]
  >([]);

  React.useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const data = await invoke<ExtensionGroup[]>("list_extension_groups");
        if (mounted) setExtensionGroups(data);
      } catch (e) {
        console.error("Failed to load extension groups:", e);
      }
    };
    void load();
    void listen("extensions-changed", () => {
      void load();
    }).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, []);

  const canCreateLocationProxy = false;

  const loadCountries = React.useCallback(async () => {
    if (countriesLoaded || !canCreateLocationProxy) return;
    try {
      const data = await invoke<LocationItem[]>("cloud_get_countries");
      setCountries(data);
      setCountriesLoaded(true);
    } catch (e) {
      console.error("Failed to load countries:", e);
    }
  }, [countriesLoaded]);

  React.useEffect(() => {
    const loadCachedResults = async () => {
      const results: Record<string, ProxyCheckResult> = {};
      const proxyIds = new Set<string>();
      for (const profile of profiles) {
        if (profile.proxy_id) {
          proxyIds.add(profile.proxy_id);
        }
      }
      for (const proxyId of proxyIds) {
        try {
          const cached = await invoke<ProxyCheckResult | null>(
            "get_cached_proxy_check",
            { proxyId },
          );
          if (cached) {
            results[proxyId] = cached;
          }
        } catch (_error) {
          // Ignore
        }
      }
      setProxyCheckResults(results);
    };
    if (profiles.length > 0) {
      void loadCachedResults();
    }
  }, [profiles]);

  const loadAllTags = React.useCallback(async () => {
    try {
      const tags = await invoke<string[]>("get_all_tags");
      setAllTags(tags);
    } catch (error) {
      console.error("Failed to load tags:", error);
    }
  }, []);

  const loadProfileStatuses = React.useCallback(async () => {
    try {
      const statuses = await invoke<ProfileStatusConfig[]>(
        "get_profile_statuses",
      );
      setProfileStatuses(statuses);
    } catch (error) {
      console.error("Failed to load profile statuses:", error);
    }
  }, []);

  const handleProxySelection = React.useCallback(
    async (profileId: string, proxyId: string | null) => {
      try {
        await invoke("update_profile_proxy", {
          profileId,
          proxyId,
        });
        setProxyOverrides((prev) => ({ ...prev, [profileId]: proxyId }));
        setVpnOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update proxy settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleVpnSelection = React.useCallback(
    async (profileId: string, vpnId: string | null) => {
      try {
        await invoke("update_profile_vpn", {
          profileId,
          vpnId,
        });
        setVpnOverrides((prev) => ({ ...prev, [profileId]: vpnId }));
        setProxyOverrides((prev) => ({ ...prev, [profileId]: null }));
        await emit("profile-updated");
      } catch (error) {
        console.error("Failed to update VPN settings:", error);
      } finally {
        setOpenProxySelectorFor(null);
      }
    },
    [],
  );

  const handleCreateCountryProxy = React.useCallback(
    async (profileId: string, country: LocationItem) => {
      try {
        await invoke("create_cloud_location_proxy", {
          name: country.name,
          country: country.code,
          region: null,
          city: null,
          isp: null,
        });
        await emit("stored-proxies-changed");
        await new Promise((r) => setTimeout(r, 200));
        const updatedProxies =
          await invoke<StoredProxy[]>("get_stored_proxies");
        const newProxy = updatedProxies.find(
          (p: StoredProxy) =>
            p.is_cloud_derived && p.geo_country === country.code,
        );
        if (newProxy) {
          await handleProxySelection(profileId, newProxy.id);
        }
        setOpenProxySelectorFor(null);
      } catch (error) {
        console.error("Failed to create country proxy:", error);
      }
    },
    [handleProxySelection],
  );

  const browserState = useBrowserState(
    profiles,
    runningProfiles,
    isUpdating,
    launchingProfiles,
    stoppingProfiles,
  );

  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{
          profile_id: string;
          status: string;
          error?: string;
        }>("profile-sync-status", (event) => {
          const { profile_id, status, error } = event.payload;
          setSyncStatuses((prev) => ({
            ...prev,
            [profile_id]: { status, error },
          }));
        });
      } catch (error) {
        console.error("Failed to listen for sync status events:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  const runningProfileIds = React.useMemo(
    () => Array.from(runningProfiles).sort(),
    [runningProfiles],
  );
  const runningCount = runningProfileIds.length;
  React.useEffect(() => {
    if (!browserState.isClient) return;

    if (runningCount === 0) {
      setTrafficSnapshots({});
      return;
    }

    const fetchTrafficSnapshots = async () => {
      try {
        const allSnapshots = await invoke<TrafficSnapshot[]>(
          "get_all_traffic_snapshots",
        );
        const newSnapshots: Record<string, TrafficSnapshot> = {};
        const runningSet = new Set(runningProfileIds);
        for (const snapshot of allSnapshots) {
          if (snapshot.profile_id) {
            if (runningSet.has(snapshot.profile_id)) {
              const existing = newSnapshots[snapshot.profile_id];
              if (!existing || snapshot.last_update > existing.last_update) {
                newSnapshots[snapshot.profile_id] = snapshot;
              }
            }
          }
        }
        setTrafficSnapshots(newSnapshots);
      } catch (error) {
        console.error("Failed to fetch traffic snapshots:", error);
      }
    };

    void fetchTrafficSnapshots();
    const interval = setInterval(() => {
      void fetchTrafficSnapshots();
    }, 1000);
    return () => {
      clearInterval(interval);
    };
  }, [browserState.isClient, runningCount, runningProfileIds]);

  React.useEffect(() => {
    if (!browserState.isClient) return;

    setTrafficSnapshots((prev) => {
      const cleaned: Record<string, TrafficSnapshot> = {};
      const runningSet = new Set(runningProfileIds);
      for (const [profileId, snapshot] of Object.entries(prev)) {
        if (runningSet.has(profileId)) {
          cleaned[profileId] = snapshot;
        }
      }
      if (Object.keys(cleaned).length !== Object.keys(prev).length) {
        return cleaned;
      }
      return prev;
    });
  }, [browserState.isClient, runningProfileIds]);

  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen<{ id: string; is_running: boolean }>(
          "profile-running-changed",
          (event) => {
            const { id } = event.payload;
            setLaunchingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            setStoppingProfiles((prev) => {
              if (!prev.has(id)) return prev;
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
          },
        );
      } catch (error) {
        console.error("Failed to listen for profile running changes:", error);
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient]);

  React.useEffect(() => {
    if (!browserState.isClient) return;
    let unlisten: (() => void) | undefined;
    void (async () => {
      try {
        unlisten = await listen("stored-proxies-changed", () => {
          void loadAllTags();
        });
      } catch (_err) {
        // ignore
      }
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, [browserState.isClient, loadAllTags]);

  React.useEffect(() => {
    const newSet = new Set(selectedProfiles);
    let hasChanges = false;

    for (const profileId of selectedProfiles) {
      const profile = profiles.find((p) => p.id === profileId);
      if (profile) {
        const isRunning =
          browserState.isClient && runningProfiles.has(profile.id);
        const isLaunching = launchingProfiles.has(profile.id);
        const isStopping = stoppingProfiles.has(profile.id);

        if (isRunning || isLaunching || isStopping) {
          newSet.delete(profileId);
          hasChanges = true;
        }
      }
    }

    if (hasChanges) {
      onSelectedProfilesChange(Array.from(newSet));
    }
  }, [
    profiles,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
    browserState.isClient,
    onSelectedProfilesChange,
    selectedProfiles,
  ]);

  React.useEffect(() => {
    if (isLoaded && browserState.isClient) {
      setSorting(getTableSorting());
    }
  }, [isLoaded, getTableSorting, browserState.isClient]);

  const handleSortingChange = React.useCallback(
    (updater: React.SetStateAction<SortingState>) => {
      if (!browserState.isClient) return;
      const newSorting =
        typeof updater === "function" ? updater(sorting) : updater;
      setSorting(newSorting);
      updateSorting(newSorting);
    },
    [browserState.isClient, sorting, updateSorting],
  );

  const handleRename = React.useCallback(async () => {
    if (!profileToRename || !newProfileName.trim()) return;

    try {
      setIsRenamingSaving(true);
      await onRenameProfile(profileToRename.id, newProfileName.trim());
      setProfileToRename(null);
      setNewProfileName("");
      setRenameError(null);
    } catch (error) {
      setRenameError(
        error instanceof Error
          ? error.message
          : t("errors.renameProfileFailed", { error: String(error) }),
      );
    } finally {
      setIsRenamingSaving(false);
    }
  }, [profileToRename, newProfileName, onRenameProfile, t]);

  React.useEffect(() => {
    if (!profileToRename) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (
        target &&
        renameContainerRef.current &&
        !renameContainerRef.current.contains(target)
      ) {
        setProfileToRename(null);
        setNewProfileName("");
        setRenameError(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [profileToRename]);

  const handleDelete = async () => {
    if (!profileToDelete) return;

    setIsDeleting(true);
    const minLoadingTime = new Promise((r) => setTimeout(r, 300));
    try {
      await Promise.all([onDeleteProfile(profileToDelete), minLoadingTime]);
      setProfileToDelete(null);
    } catch (error) {
      console.error("Failed to delete profile:", error);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleIconClick = React.useCallback(
    (profileId: string) => {
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) return;

      if (!browserState.canSelectProfile(profile)) {
        return;
      }

      setShowCheckboxes(true);
      const newSet = new Set(selectedProfiles);
      if (newSet.has(profileId)) {
        newSet.delete(profileId);
      } else {
        newSet.add(profileId);
      }

      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [profiles, browserState, onSelectedProfilesChange, selectedProfiles],
  );

  React.useEffect(() => {
    if (browserState.isClient) {
      void loadAllTags();
    }
  }, [browserState.isClient, loadAllTags]);

  React.useEffect(() => {
    if (browserState.isClient) {
      void loadProfileStatuses();
    }
  }, [browserState.isClient, loadProfileStatuses]);

  const handleCheckboxChange = React.useCallback(
    (profileId: string, checked: boolean) => {
      const newSet = new Set(selectedProfiles);
      if (checked) {
        newSet.add(profileId);
      } else {
        newSet.delete(profileId);
      }

      if (newSet.size === 0) {
        setShowCheckboxes(false);
      }

      onSelectedProfilesChange(Array.from(newSet));
    },
    [onSelectedProfilesChange, selectedProfiles],
  );

  const handleToggleAll = React.useCallback(
    (checked: boolean) => {
      const newSet = checked
        ? new Set(
            profiles
              .filter((profile) => {
                const isRunning =
                  browserState.isClient && runningProfiles.has(profile.id);
                const isLaunching = launchingProfiles.has(profile.id);
                const isStopping = stoppingProfiles.has(profile.id);
                return !isRunning && !isLaunching && !isStopping;
              })
              .map((profile) => profile.id),
          )
        : new Set<string>();

      setShowCheckboxes(checked);
      onSelectedProfilesChange(Array.from(newSet));
    },
    [
      profiles,
      onSelectedProfilesChange,
      browserState.isClient,
      runningProfiles,
      launchingProfiles,
      stoppingProfiles,
    ],
  );

  const selectableProfiles = React.useMemo(() => {
    return profiles.filter((profile) => {
      const isRunning =
        browserState.isClient && runningProfiles.has(profile.id);
      const isLaunching = launchingProfiles.has(profile.id);
      const isStopping = stoppingProfiles.has(profile.id);
      return !isRunning && !isLaunching && !isStopping;
    });
  }, [
    profiles,
    browserState.isClient,
    runningProfiles,
    launchingProfiles,
    stoppingProfiles,
  ]);

  return {
    sorting,
    setSorting,
    rowSelection,
    setRowSelection,
    showCheckboxes,
    setShowCheckboxes,
    handleRowSelectionChange,
    profileToRename,
    setProfileToRename,
    newProfileName,
    setNewProfileName,
    renameError,
    setRenameError,
    isRenamingSaving,
    renameContainerRef,
    profileToDelete,
    setProfileToDelete,
    isDeleting,
    handleDelete,
    profileForInfoDialog,
    setProfileForInfoDialog,
    bypassRulesProfile,
    setBypassRulesProfile,
    dnsBlocklistProfile,
    setDnsBlocklistProfile,
    launchHookProfile,
    setLaunchHookProfile,
    launchingProfiles,
    setLaunchingProfiles,
    stoppingProfiles,
    setStoppingProfiles,
    storedProxies,
    vpnConfigs,
    proxyOverrides,
    vpnOverrides,
    tagsOverrides,
    setTagsOverrides,
    allTags,
    setAllTags,
    openTagsEditorFor,
    setOpenTagsEditorFor,
    openProxySelectorFor,
    setOpenProxySelectorFor,
    checkingProfileId,
    proxyCheckResults,
    noteOverrides,
    setNoteOverrides,
    openNoteEditorFor,
    setOpenNoteEditorFor,
    profileStatuses,
    setProfileStatuses,
    statusOverrides,
    setStatusOverrides,
    trafficSnapshots,
    trafficDialogProfile,
    setTrafficDialogProfile,
    syncStatuses,
    countries,
    extensionGroups,
    canCreateLocationProxy,
    loadCountries,
    handleProxySelection,
    handleVpnSelection,
    handleCreateCountryProxy,
    browserState,
    isProfileLocked,
    getLockInfo,
    handleSortingChange,
    handleToggleAll,
    handleCheckboxChange,
    handleIconClick,
    handleRename,
    selectableProfiles,
  };
}
