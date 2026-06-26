"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuDownload, LuUpload } from "react-icons/lu";
import { toast } from "sonner";
import { DeleteConfirmationDialog } from "@/components/shared";
import {
  AnimatedTabs,
  AnimatedTabsContent,
  AnimatedTabsList,
  AnimatedTabsTrigger,
} from "@/components/ui/animated-tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useProxyEvents } from "@/hooks/use-proxy-events";
import { useVpnEvents } from "@/hooks/use-vpn-events";
import { parseBackendError, translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { ProxyCheckResult, StoredProxy, VpnConfig } from "@/types";
import { RippleButton } from "../ui/ripple";
import { VpnFormDialog, VpnImportDialog } from "../vpn";
import { ProxyExportDialog } from "./proxy-export-dialog";
import { ProxyFormDialog } from "./proxy-form-dialog";
import { ProxyImportDialog } from "./proxy-import-dialog";

// Import sub-components
import { ProxyListTab } from "./sub-components/proxy-list-tab";
import { VpnListTab } from "./sub-components/vpn-list-tab";

type SyncStatus = "disabled" | "syncing" | "synced" | "error" | "waiting";

interface ProxyManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  subPage?: boolean;
  initialTab?: "proxies" | "vpns";
}

export function ProxyManagementDialog({
  isOpen,
  onClose,
  subPage,
  initialTab = "proxies",
}: ProxyManagementDialogProps) {
  const { t } = useTranslation();
  // Proxy state
  const [showProxyForm, setShowProxyForm] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [editingProxy, setEditingProxy] = useState<StoredProxy | null>(null);
  const [proxyToDelete, setProxyToDelete] = useState<StoredProxy | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [checkingProxyId, setCheckingProxyId] = useState<string | null>(null);
  const [proxyCheckResults, setProxyCheckResults] = useState<
    Record<string, ProxyCheckResult>
  >({});
  const [proxySyncStatus, setProxySyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [proxySyncErrors, setProxySyncErrors] = useState<
    Record<string, string>
  >({});
  const [proxyInUse, setProxyInUse] = useState<Record<string, boolean>>({});
  const [isTogglingSync, setIsTogglingSync] = useState<Record<string, boolean>>(
    {},
  );

  // VPN state
  const [showVpnForm, setShowVpnForm] = useState(false);
  const [showVpnImportDialog, setShowVpnImportDialog] = useState(false);
  const [editingVpn, setEditingVpn] = useState<VpnConfig | null>(null);
  const [vpnToDelete, setVpnToDelete] = useState<VpnConfig | null>(null);
  const [isDeletingVpn, setIsDeletingVpn] = useState(false);
  const [checkingVpnId, setCheckingVpnId] = useState<string | null>(null);
  const [vpnSyncStatus, setVpnSyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [vpnSyncErrors, setVpnSyncErrors] = useState<Record<string, string>>(
    {},
  );
  const [vpnInUse, setVpnInUse] = useState<Record<string, boolean>>({});
  const [isTogglingVpnSync, setIsTogglingVpnSync] = useState<
    Record<string, boolean>
  >({});

  const [activeTab, setActiveTab] = useState<"proxies" | "vpns">(initialTab);

  const { storedProxies: rawProxies, proxyUsage, isLoading } = useProxyEvents();
  const { vpnConfigs, vpnUsage, isLoading: isLoadingVpns } = useVpnEvents();

  const storedProxies = useMemo(
    () =>
      rawProxies
        .filter(
          (p) =>
            !p.is_cloud_managed &&
            !p.is_cloud_derived &&
            !p.is_profile_specific,
        )
        .sort((a, b) =>
          a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
        ),
    [rawProxies],
  );

  // Listen for proxy sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string; error?: string }>(
        "proxy-sync-status",
        (event) => {
          const { id, status, error } = event.payload;
          setProxySyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
          if (error) {
            setProxySyncErrors((prev) => ({ ...prev, [id]: error }));
          }
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  // Listen for VPN sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string; error?: string }>(
        "vpn-sync-status",
        (event) => {
          const { id, status, error } = event.payload;
          setVpnSyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
          if (error) {
            setVpnSyncErrors((prev) => ({ ...prev, [id]: error }));
          }
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  // Load cached check results on mount and when proxies change
  useEffect(() => {
    const loadCachedResults = async () => {
      const results: Record<string, ProxyCheckResult> = {};
      const inUse: Record<string, boolean> = {};
      for (const proxy of storedProxies) {
        try {
          const cached = await invoke<ProxyCheckResult | null>(
            "get_cached_proxy_check",
            { proxyId: proxy.id },
          );
          if (cached) {
            results[proxy.id] = cached;
          }

          const inUseBySynced = await invoke<boolean>(
            "is_proxy_in_use_by_synced_profile",
            { proxyId: proxy.id },
          );
          inUse[proxy.id] = inUseBySynced;
        } catch (_error) {
          // Ignore errors
        }
      }
      setProxyCheckResults(results);
      setProxyInUse(inUse);
    };
    if (storedProxies.length > 0) {
      void loadCachedResults();
    }
  }, [storedProxies]);

  // Load VPN in-use status
  useEffect(() => {
    const loadVpnInUse = async () => {
      const inUse: Record<string, boolean> = {};
      for (const vpn of vpnConfigs) {
        try {
          const inUseBySynced = await invoke<boolean>(
            "is_vpn_in_use_by_synced_profile",
            { vpnId: vpn.id },
          );
          inUse[vpn.id] = inUseBySynced;
        } catch (_error) {
          // Ignore errors
        }
      }
      setVpnInUse(inUse);
    };
    if (vpnConfigs.length > 0) {
      void loadVpnInUse();
    }
  }, [vpnConfigs]);

  // Proxy handlers
  const handleDeleteProxy = useCallback((proxy: StoredProxy) => {
    setProxyToDelete(proxy);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    if (!proxyToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_stored_proxy", { proxyId: proxyToDelete.id });
      toast.success(t("proxies.management.deleteSuccess"));
      await emit("stored-proxies-changed");
    } catch (error) {
      console.error("Failed to delete proxy:", error);
      toast.error(t("proxies.management.deleteFailed"));
    } finally {
      setIsDeleting(false);
      setProxyToDelete(null);
    }
  }, [proxyToDelete, t]);

  const handleCreateProxy = useCallback(() => {
    setEditingProxy(null);
    setShowProxyForm(true);
  }, []);

  const handleEditProxy = useCallback((proxy: StoredProxy) => {
    setEditingProxy(proxy);
    setShowProxyForm(true);
  }, []);

  const handleProxyFormClose = useCallback(() => {
    setShowProxyForm(false);
    setEditingProxy(null);
  }, []);

  const handleToggleSync = useCallback(
    async (proxy: StoredProxy) => {
      setIsTogglingSync((prev) => ({ ...prev, [proxy.id]: true }));
      try {
        await invoke("set_proxy_sync_enabled", {
          proxyId: proxy.id,
          enabled: !proxy.sync_enabled,
        });
        showSuccessToast(
          proxy.sync_enabled
            ? t("proxies.management.syncDisabled")
            : t("proxies.management.syncEnabled"),
        );
        await emit("stored-proxies-changed");
      } catch (error) {
        console.error("Failed to toggle sync:", error);
        showErrorToast(
          parseBackendError(error)
            ? translateBackendError(t, error)
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingSync((prev) => ({ ...prev, [proxy.id]: false }));
      }
    },
    [t],
  );

  // VPN handlers
  const handleDeleteVpn = useCallback((vpn: VpnConfig) => {
    setVpnToDelete(vpn);
  }, []);

  const handleConfirmDeleteVpn = useCallback(async () => {
    if (!vpnToDelete) return;
    setIsDeletingVpn(true);
    try {
      await invoke("delete_vpn_config", { vpnId: vpnToDelete.id });
      toast.success(t("vpns.management.deleteSuccess"));
      await emit("vpn-configs-changed");
    } catch (error) {
      console.error("Failed to delete VPN:", error);
      toast.error(t("vpns.management.deleteFailed"));
    } finally {
      setIsDeletingVpn(false);
      setVpnToDelete(null);
    }
  }, [vpnToDelete, t]);

  const handleCreateVpn = useCallback(() => {
    setEditingVpn(null);
    setShowVpnForm(true);
  }, []);

  const handleEditVpn = useCallback((vpn: VpnConfig) => {
    setEditingVpn(vpn);
    setShowVpnForm(true);
  }, []);

  const handleVpnFormClose = useCallback(() => {
    setShowVpnForm(false);
    setEditingVpn(null);
  }, []);

  const handleToggleVpnSync = useCallback(
    async (vpn: VpnConfig) => {
      setIsTogglingVpnSync((prev) => ({ ...prev, [vpn.id]: true }));
      try {
        await invoke("set_vpn_sync_enabled", {
          vpnId: vpn.id,
          enabled: !vpn.sync_enabled,
        });
        showSuccessToast(
          vpn.sync_enabled
            ? t("proxies.management.syncDisabled")
            : t("proxies.management.syncEnabled"),
        );
        await emit("vpn-configs-changed");
      } catch (error) {
        console.error("Failed to toggle VPN sync:", error);
        showErrorToast(
          parseBackendError(error)
            ? translateBackendError(t, error)
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingVpnSync((prev) => ({ ...prev, [vpn.id]: false }));
      }
    },
    [t],
  );

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose} subPage={subPage}>
        <DialogContent className="flex max-h-[85vh] max-w-[min(80rem,calc(100%-4rem))] flex-col">
          {!subPage && (
            <DialogHeader>
              <DialogTitle>{t("proxies.management.title")}</DialogTitle>
              <DialogDescription>
                {t("proxies.management.description")}
              </DialogDescription>
            </DialogHeader>
          )}

          <div className="@container flex min-h-0 w-full flex-1 flex-col">
            <AnimatedTabs
              key={initialTab}
              defaultValue={initialTab}
              onValueChange={(v) => setActiveTab(v as "proxies" | "vpns")}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <AnimatedTabsList>
                  <AnimatedTabsTrigger value="proxies">
                    <span>{t("proxies.management.tabProxies")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {storedProxies.length}
                    </span>
                  </AnimatedTabsTrigger>
                  <AnimatedTabsTrigger value="vpns">
                    <span>{t("proxies.management.tabVpns")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {vpnConfigs.length}
                    </span>
                  </AnimatedTabsTrigger>
                </AnimatedTabsList>
                <div className="flex items-center gap-2">
                  {activeTab === "proxies" && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RippleButton
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setShowImportDialog(true);
                            }}
                            className="flex items-center gap-2"
                            aria-label={t("common.buttons.import")}
                          >
                            <LuUpload className="size-4" />
                            <span className="hidden @2xl:inline">
                              {t("common.buttons.import")}
                            </span>
                          </RippleButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("common.buttons.import")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RippleButton
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setShowExportDialog(true);
                            }}
                            className="flex items-center gap-2"
                            aria-label={t("common.buttons.export")}
                            disabled={storedProxies.length === 0}
                          >
                            <LuDownload className="size-4" />
                            <span className="hidden @2xl:inline">
                              {t("common.buttons.export")}
                            </span>
                          </RippleButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("common.buttons.export")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RippleButton
                            size="sm"
                            onClick={handleCreateProxy}
                            className="flex items-center gap-2"
                            aria-label={t("proxies.management.newProxy")}
                          >
                            <GoPlus className="size-4" />
                            <span className="hidden @2xl:inline">
                              {t("proxies.management.newProxy")}
                            </span>
                          </RippleButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("proxies.management.newProxy")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                  {activeTab === "vpns" && (
                    <>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RippleButton
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setShowVpnImportDialog(true);
                            }}
                            className="flex items-center gap-2"
                            aria-label={t("common.buttons.import")}
                          >
                            <LuUpload className="size-4" />
                            <span className="hidden @2xl:inline">
                              {t("common.buttons.import")}
                            </span>
                          </RippleButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("common.buttons.import")}</p>
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <RippleButton
                            size="sm"
                            onClick={handleCreateVpn}
                            className="flex items-center gap-2"
                            aria-label={t("proxies.management.newVpn")}
                          >
                            <GoPlus className="size-4" />
                            <span className="hidden @2xl:inline">
                              {t("proxies.management.newVpn")}
                            </span>
                          </RippleButton>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>{t("proxies.management.newVpn")}</p>
                        </TooltipContent>
                      </Tooltip>
                    </>
                  )}
                </div>
              </div>

              <AnimatedTabsContent
                value="proxies"
                className="mt-4 min-h-0 flex-1 flex-col data-[state=active]:flex"
              >
                <ProxyListTab
                  storedProxies={storedProxies}
                  proxyUsage={proxyUsage}
                  isLoading={isLoading}
                  proxySyncStatus={proxySyncStatus}
                  proxySyncErrors={proxySyncErrors}
                  proxyInUse={proxyInUse}
                  isTogglingSync={isTogglingSync}
                  handleToggleSync={handleToggleSync}
                  checkingProxyId={checkingProxyId}
                  setCheckingProxyId={setCheckingProxyId}
                  proxyCheckResults={proxyCheckResults}
                  setProxyCheckResults={setProxyCheckResults}
                  onEditProxy={handleEditProxy}
                  onDeleteProxy={handleDeleteProxy}
                  isOpen={isOpen}
                />
              </AnimatedTabsContent>

              <AnimatedTabsContent
                value="vpns"
                className="mt-4 min-h-0 flex-1 flex-col data-[state=active]:flex"
              >
                <VpnListTab
                  vpnConfigs={vpnConfigs}
                  vpnUsage={vpnUsage}
                  isLoadingVpns={isLoadingVpns}
                  vpnSyncStatus={vpnSyncStatus}
                  vpnSyncErrors={vpnSyncErrors}
                  vpnInUse={vpnInUse}
                  isTogglingVpnSync={isTogglingVpnSync}
                  handleToggleVpnSync={handleToggleVpnSync}
                  checkingVpnId={checkingVpnId}
                  setCheckingVpnId={setCheckingVpnId}
                  onEditVpn={handleEditVpn}
                  onDeleteVpn={handleDeleteVpn}
                  isOpen={isOpen}
                />
              </AnimatedTabsContent>
            </AnimatedTabs>
          </div>

          {!subPage && (
            <DialogFooter>
              <RippleButton variant="outline" onClick={onClose}>
                {t("common.buttons.close")}
              </RippleButton>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ProxyFormDialog
        isOpen={showProxyForm}
        onClose={handleProxyFormClose}
        editingProxy={editingProxy}
      />
      <DeleteConfirmationDialog
        isOpen={proxyToDelete !== null}
        onClose={() => {
          setProxyToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title={t("proxies.management.deleteTitle")}
        description={t("proxies.management.deleteDescription", {
          name: proxyToDelete?.name ?? "",
        })}
        confirmButtonText={t("common.buttons.delete")}
        isLoading={isDeleting}
      />
      <ProxyImportDialog
        isOpen={showImportDialog}
        onClose={() => {
          setShowImportDialog(false);
        }}
      />
      <ProxyExportDialog
        isOpen={showExportDialog}
        onClose={() => {
          setShowExportDialog(false);
        }}
      />
      <VpnFormDialog
        isOpen={showVpnForm}
        onClose={handleVpnFormClose}
        editingVpn={editingVpn}
      />
      <DeleteConfirmationDialog
        isOpen={vpnToDelete !== null}
        onClose={() => {
          setVpnToDelete(null);
        }}
        onConfirm={handleConfirmDeleteVpn}
        title={t("vpns.management.deleteTitle")}
        description={t("vpns.management.deleteDescription", {
          name: vpnToDelete?.name ?? "",
        })}
        confirmButtonText={t("common.buttons.delete")}
        isLoading={isDeletingVpn}
      />
      <VpnImportDialog
        isOpen={showVpnImportDialog}
        onClose={() => {
          setShowVpnImportDialog(false);
        }}
      />
    </>
  );
}
