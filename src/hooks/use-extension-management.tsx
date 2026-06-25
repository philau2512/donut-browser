"use client";

import {
  type ColumnDef,
  getCoreRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaChrome, FaFirefox } from "react-icons/fa";
import { LuPuzzle } from "react-icons/lu";
import type { SyncStatus } from "@/components/extension/extension-sync-utils";
import { getSyncStatusDot } from "@/components/extension/extension-sync-utils";
import { getExtensionColumns } from "@/components/extension/sub-components/extension-columns";
import { getGroupColumns } from "@/components/extension/sub-components/group-columns";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { parseBackendError, translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { Extension, ExtensionGroup } from "@/types";

interface UseExtensionManagementProps {
  isOpen: boolean;
  limitedMode: boolean;
  initialTab?: "extensions" | "groups";
}

export function useExtensionManagement({
  isOpen,
  limitedMode,
  initialTab = "extensions",
}: UseExtensionManagementProps) {
  const { t } = useTranslation();
  const [extensions, setExtensions] = useState<Extension[]>([]);
  const [extensionGroups, setExtensionGroups] = useState<ExtensionGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Extension upload state
  const [isUploading, setIsUploading] = useState(false);
  const [extensionName, setExtensionName] = useState("");
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [pendingFile, setPendingFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Group state
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [editingGroup, setEditingGroup] = useState<ExtensionGroup | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupExtensionIds, setEditGroupExtensionIds] = useState<string[]>(
    [],
  );

  // Delete state
  const [extensionToDelete, setExtensionToDelete] = useState<Extension | null>(
    null,
  );
  const [groupToDelete, setGroupToDelete] = useState<ExtensionGroup | null>(
    null,
  );
  const [isDeleting, setIsDeleting] = useState(false);

  // Bulk delete state
  const [bulkExtDeleteOpen, setBulkExtDeleteOpen] = useState(false);
  const [bulkGroupDeleteOpen, setBulkGroupDeleteOpen] = useState(false);

  // Table state
  const [extSorting, setExtSorting] = useState<SortingState>([]);
  const [extRowSelection, setExtRowSelection] = useState<RowSelectionState>({});
  const [groupSorting, setGroupSorting] = useState<SortingState>([]);
  const [groupRowSelection, setGroupRowSelection] = useState<RowSelectionState>(
    {},
  );

  // Edit extension state
  const [editingExtension, setEditingExtension] = useState<Extension | null>(
    null,
  );
  const [editExtensionName, setEditExtensionName] = useState("");
  const [pendingUpdateFile, setPendingUpdateFile] = useState<{
    name: string;
    data: number[];
  } | null>(null);

  // Extension icons
  const [extensionIcons, setExtensionIcons] = useState<Record<string, string>>(
    {},
  );

  // Sync state
  const [extSyncStatus, setExtSyncStatus] = useState<
    Record<string, SyncStatus>
  >({});
  const [isTogglingExtSync, setIsTogglingExtSync] = useState<
    Record<string, boolean>
  >({});
  const [isTogglingGroupSync, setIsTogglingGroupSync] = useState<
    Record<string, boolean>
  >({});

  // Tab state
  const [activeTab, setActiveTab] = useState<"extensions" | "groups">(
    initialTab,
  );

  const renderExtensionIcon = useCallback(
    (ext: Extension, size: "sm" | "md" = "md") => {
      const sizeClass = size === "sm" ? "size-4" : "size-5";
      if (extensionIcons[ext.id]) {
        return (
          // biome-ignore lint/performance/noImgElement: base64 data URI icons cannot use next/image
          <img
            src={extensionIcons[ext.id]}
            alt=""
            className={`${sizeClass} shrink-0 rounded-sm`}
          />
        );
      }
      return (
        <LuPuzzle className={`${sizeClass} shrink-0 text-muted-foreground`} />
      );
    },
    [extensionIcons],
  );

  const renderCompatIcons = useCallback(
    (compat: string[]) => {
      const hasChromium = compat.includes("chromium");
      const hasFirefox = compat.includes("firefox");
      if (!hasChromium && !hasFirefox) return null;
      return (
        <div className="flex shrink-0 items-center gap-1">
          {hasChromium && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <FaChrome className="size-3.5 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("extensions.compatibility.chromium")}
              </TooltipContent>
            </Tooltip>
          )}
          {hasFirefox && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <FaFirefox className="size-3.5 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {t("extensions.compatibility.firefox")}
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      );
    },
    [t],
  );

  const loadData = useCallback(async () => {
    if (limitedMode) return;
    setIsLoading(true);
    try {
      const [exts, groups] = await Promise.all([
        invoke<Extension[]>("list_extensions"),
        invoke<ExtensionGroup[]>("list_extension_groups"),
      ]);
      setExtensions(exts);
      setExtensionGroups(groups);
    } catch {
      // User may not have pro subscription
      setExtensions([]);
      setExtensionGroups([]);
    } finally {
      setIsLoading(false);
    }
  }, [limitedMode]);

  const loadIcons = useCallback(async (exts: Extension[]) => {
    const icons: Record<string, string> = {};
    for (const ext of exts) {
      try {
        const icon = await invoke<string | null>("get_extension_icon", {
          extensionId: ext.id,
        });
        if (icon) {
          icons[ext.id] = icon;
        }
      } catch {
        // Icon not available
      }
    }
    setExtensionIcons(icons);
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadData();
    } else {
      // Drop selection when the dialog closes so the floating action
      // bars (portaled to body) don't linger on the page.
      setExtRowSelection({});
      setGroupRowSelection({});
    }
  }, [isOpen, loadData]);

  useEffect(() => {
    if (extensions.length > 0) {
      void loadIcons(extensions);
    }
  }, [extensions, loadIcons]);

  // Listen for extension sync status events
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<{ id: string; status: string }>(
        "extension-sync-status",
        (event) => {
          const { id, status } = event.payload;
          setExtSyncStatus((prev) => ({
            ...prev,
            [id]: status as SyncStatus,
          }));
        },
      );
    };

    void setupListener();
    return () => {
      unlisten?.();
    };
  }, []);

  const handleToggleExtSync = useCallback(
    async (ext: Extension) => {
      setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: true }));
      try {
        await invoke("set_extension_sync_enabled", {
          extensionId: ext.id,
          enabled: !ext.sync_enabled,
        });
        showSuccessToast(
          ext.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(
          parseBackendError(err)
            ? translateBackendError(t, err)
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingExtSync((prev) => ({ ...prev, [ext.id]: false }));
      }
    },
    [loadData, t],
  );

  const handleToggleGroupSync = useCallback(
    async (group: ExtensionGroup) => {
      setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: true }));
      try {
        await invoke("set_extension_group_sync_enabled", {
          extensionGroupId: group.id,
          enabled: !group.sync_enabled,
        });
        showSuccessToast(
          group.sync_enabled
            ? t("extensions.syncDisabled")
            : t("extensions.syncEnabled"),
        );
        void loadData();
      } catch (err) {
        showErrorToast(
          parseBackendError(err)
            ? translateBackendError(t, err)
            : t("proxies.management.updateSyncFailed"),
        );
      } finally {
        setIsTogglingGroupSync((prev) => ({ ...prev, [group.id]: false }));
      }
    },
    [loadData, t],
  );

  const handleUpdateExtension = useCallback(async () => {
    if (!editingExtension || !editExtensionName.trim()) return;
    try {
      await invoke("update_extension", {
        extensionId: editingExtension.id,
        name: editExtensionName.trim(),
        fileName: pendingUpdateFile?.name ?? null,
        fileData: pendingUpdateFile?.data ?? null,
      });
      showSuccessToast(t("extensions.updateSuccess"));
      setEditingExtension(null);
      setEditExtensionName("");
      setPendingUpdateFile(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [editingExtension, editExtensionName, pendingUpdateFile, loadData, t]);

  const handleEditFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        setPendingUpdateFile({ name: file.name, data });
      };
      reader.readAsArrayBuffer(file);
      e.target.value = "";
    },
    [t],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      const validExtensions = [".xpi", ".crx", ".zip"];
      const isValid = validExtensions.some((ext) =>
        file.name.toLowerCase().endsWith(ext),
      );
      if (!isValid) {
        showErrorToast(t("extensions.invalidFileType"));
        return;
      }

      const reader = new FileReader();
      reader.onload = (event) => {
        const arrayBuffer = event.target?.result as ArrayBuffer;
        const data = Array.from(new Uint8Array(arrayBuffer));
        const baseName = file.name
          .replace(/\.(xpi|crx|zip)$/i, "")
          .replace(/[-_]/g, " ");
        setExtensionName(baseName);
        setPendingFile({ name: file.name, data });
        setShowUploadForm(true);
      };
      reader.onerror = () => {
        showErrorToast(t("extensions.readError"));
      };
      reader.readAsArrayBuffer(file);

      // Reset input
      e.target.value = "";
    },
    [t],
  );

  const handleUpload = useCallback(async () => {
    if (!pendingFile || !extensionName.trim()) return;
    setIsUploading(true);
    try {
      await invoke("add_extension", {
        name: extensionName.trim(),
        fileName: pendingFile.name,
        fileData: pendingFile.data,
      });
      showSuccessToast(t("extensions.uploadSuccess"));
      setShowUploadForm(false);
      setPendingFile(null);
      setExtensionName("");
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  }, [pendingFile, extensionName, loadData, t]);

  const handleDeleteExtension = useCallback(async () => {
    if (!extensionToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension", { extensionId: extensionToDelete.id });
      showSuccessToast(t("extensions.deleteSuccess"));
      setExtensionToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [extensionToDelete, loadData, t]);

  const handleCreateGroup = useCallback(async () => {
    if (!newGroupName.trim()) return;
    try {
      await invoke("create_extension_group", { name: newGroupName.trim() });
      showSuccessToast(t("extensions.groupCreateSuccess"));
      setShowCreateGroup(false);
      setNewGroupName("");
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [newGroupName, loadData, t]);

  const handleSaveGroupEdits = useCallback(async () => {
    if (!editingGroup || !editGroupName.trim()) return;
    try {
      // Update group name
      await invoke("update_extension_group", {
        groupId: editingGroup.id,
        name: editGroupName.trim(),
      });

      // Compute diff of extensions
      const originalIds = new Set(editingGroup.extension_ids);
      const newIds = new Set(editGroupExtensionIds);

      // Add new extensions
      for (const extId of editGroupExtensionIds) {
        if (!originalIds.has(extId)) {
          await invoke("add_extension_to_group", {
            groupId: editingGroup.id,
            extensionId: extId,
          });
        }
      }

      // Remove removed extensions
      for (const extId of editingGroup.extension_ids) {
        if (!newIds.has(extId)) {
          await invoke("remove_extension_from_group", {
            groupId: editingGroup.id,
            extensionId: extId,
          });
        }
      }

      showSuccessToast(t("extensions.groupUpdateSuccess"));
      setEditingGroup(null);
      setEditGroupName("");
      setEditGroupExtensionIds([]);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    }
  }, [editingGroup, editGroupName, editGroupExtensionIds, loadData, t]);

  const handleDeleteGroup = useCallback(async () => {
    if (!groupToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_extension_group", { groupId: groupToDelete.id });
      showSuccessToast(t("extensions.groupDeleteSuccess"));
      setGroupToDelete(null);
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [groupToDelete, loadData, t]);

  const selectedExtensions = useMemo(
    () => extensions.filter((ext) => extRowSelection[ext.id]),
    [extensions, extRowSelection],
  );

  const selectedGroups = useMemo(
    () => extensionGroups.filter((group) => groupRowSelection[group.id]),
    [extensionGroups, groupRowSelection],
  );

  const handleBulkDeleteExtensions = useCallback(async () => {
    if (selectedExtensions.length === 0) return;
    setIsDeleting(true);
    try {
      await Promise.allSettled(
        selectedExtensions.map((ext) =>
          invoke("delete_extension", { extensionId: ext.id }),
        ),
      );
      showSuccessToast(t("extensions.deleteSuccess"));
      setBulkExtDeleteOpen(false);
      setExtRowSelection({});
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [selectedExtensions, loadData, t]);

  const handleBulkDeleteGroups = useCallback(async () => {
    if (selectedGroups.length === 0) return;
    setIsDeleting(true);
    try {
      await Promise.allSettled(
        selectedGroups.map((group) =>
          invoke("delete_extension_group", { groupId: group.id }),
        ),
      );
      showSuccessToast(t("extensions.groupDeleteSuccess"));
      setBulkGroupDeleteOpen(false);
      setGroupRowSelection({});
      void loadData();
    } catch (err) {
      showErrorToast(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDeleting(false);
    }
  }, [selectedGroups, loadData, t]);

  const handleBulkToggleExtSync = useCallback(async () => {
    if (selectedExtensions.length === 0) return;
    const allOn = selectedExtensions.every((e) => e.sync_enabled);
    const targetEnabled = !allOn;
    const results = await Promise.allSettled(
      selectedExtensions.map((ext) =>
        invoke("set_extension_sync_enabled", {
          extensionId: ext.id,
          enabled: targetEnabled,
        }),
      ),
    );
    const firstRejection = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    if (firstRejection) {
      showErrorToast(
        parseBackendError(firstRejection.reason)
          ? translateBackendError(t, firstRejection.reason)
          : t("proxies.management.updateSyncFailed"),
      );
    } else {
      showSuccessToast(
        targetEnabled
          ? t("extensions.syncEnabled")
          : t("extensions.syncDisabled"),
      );
    }
    void loadData();
  }, [selectedExtensions, loadData, t]);

  const handleBulkToggleGroupSync = useCallback(async () => {
    if (selectedGroups.length === 0) return;
    const allOn = selectedGroups.every((g) => g.sync_enabled);
    const targetEnabled = !allOn;
    const results = await Promise.allSettled(
      selectedGroups.map((group) =>
        invoke("set_extension_group_sync_enabled", {
          extensionGroupId: group.id,
          enabled: targetEnabled,
        }),
      ),
    );
    const firstRejection = results.find((r) => r.status === "rejected") as
      | PromiseRejectedResult
      | undefined;
    if (firstRejection) {
      showErrorToast(
        parseBackendError(firstRejection.reason)
          ? translateBackendError(t, firstRejection.reason)
          : t("proxies.management.updateSyncFailed"),
      );
    } else {
      showSuccessToast(
        targetEnabled
          ? t("extensions.syncEnabled")
          : t("extensions.syncDisabled"),
      );
    }
    void loadData();
  }, [selectedGroups, loadData, t]);

  const extensionColumns = useMemo<ColumnDef<Extension>[]>(
    () =>
      getExtensionColumns({
        t,
        extSyncStatus,
        isTogglingExtSync,
        extensionIcons,
        handleToggleExtSync,
        setEditingExtension,
        setEditExtensionName,
        setPendingUpdateFile,
        setExtensionToDelete,
        getSyncStatusDot,
      }),
    [t, extSyncStatus, isTogglingExtSync, extensionIcons, handleToggleExtSync],
  );

  const extTable = useReactTable({
    data: extensions,
    columns: extensionColumns,
    state: { sorting: extSorting, rowSelection: extRowSelection },
    onSortingChange: setExtSorting,
    onRowSelectionChange: setExtRowSelection,
    enableRowSelection: () => !limitedMode,
    getSortedRowModel: getSortedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  const groupColumns = useMemo<ColumnDef<ExtensionGroup>[]>(
    () =>
      getGroupColumns({
        t,
        extensions,
        extSyncStatus,
        isTogglingGroupSync,
        extensionIcons,
        handleToggleGroupSync,
        setEditingGroup,
        setEditGroupName,
        setEditGroupExtensionIds,
        setGroupToDelete,
        getSyncStatusDot,
      }),
    [
      t,
      extensions,
      extSyncStatus,
      isTogglingGroupSync,
      extensionIcons,
      handleToggleGroupSync,
    ],
  );

  const groupTable = useReactTable({
    data: extensionGroups,
    columns: groupColumns,
    state: { sorting: groupSorting, rowSelection: groupRowSelection },
    onSortingChange: setGroupSorting,
    onRowSelectionChange: setGroupRowSelection,
    enableRowSelection: () => !limitedMode,
    getSortedRowModel: getSortedRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

  return {
    // Data
    extensions,
    extensionGroups,
    isLoading,

    // Upload state
    isUploading,
    extensionName,
    setExtensionName,
    showUploadForm,
    setShowUploadForm,
    pendingFile,
    setPendingFile,

    // Group state
    showCreateGroup,
    setShowCreateGroup,
    newGroupName,
    setNewGroupName,
    editingGroup,
    setEditingGroup,
    editGroupName,
    setEditGroupName,
    editGroupExtensionIds,
    setEditGroupExtensionIds,

    // Delete state
    extensionToDelete,
    setExtensionToDelete,
    groupToDelete,
    setGroupToDelete,
    isDeleting,
    bulkExtDeleteOpen,
    setBulkExtDeleteOpen,
    bulkGroupDeleteOpen,
    setBulkGroupDeleteOpen,

    // Edit extension state
    editingExtension,
    setEditingExtension,
    editExtensionName,
    setEditExtensionName,
    pendingUpdateFile,
    setPendingUpdateFile,

    // Table state
    extRowSelection,
    setExtRowSelection,
    groupRowSelection,
    setGroupRowSelection,
    extTable,
    groupTable,

    // Tab state
    activeTab,
    setActiveTab,

    // Selection
    selectedExtensions,
    selectedGroups,

    // Handlers
    handleFileSelect,
    handleUpload,
    handleDeleteExtension,
    handleUpdateExtension,
    handleEditFileSelect,
    handleCreateGroup,
    handleSaveGroupEdits,
    handleDeleteGroup,
    handleBulkDeleteExtensions,
    handleBulkDeleteGroups,
    handleBulkToggleExtSync,
    handleBulkToggleGroupSync,
    handleToggleExtSync,
    handleToggleGroupSync,

    // Render helpers
    renderExtensionIcon,
    renderCompatIcons,
  };
}
