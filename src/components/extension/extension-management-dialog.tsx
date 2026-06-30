"use client";

import { useTranslation } from "react-i18next";
import { GoPlus } from "react-icons/go";
import { LuPuzzle, LuRefreshCw, LuTrash2, LuUpload } from "react-icons/lu";
import {
  DataTableActionBar,
  DataTableActionBarAction,
  DataTableActionBarSelection,
} from "@/components/home";
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
import { ProBadge } from "@/components/ui/pro-badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useExtensionManagement } from "@/hooks/use-extension-management";
import { RippleButton } from "../ui/ripple";
import { EditExtensionDialog } from "./sub-components/edit-extension-dialog";
import { EditGroupDialog } from "./sub-components/edit-group-dialog";
import { ExtensionGroupTab } from "./sub-components/extension-group-tab";
import { ExtensionListTab } from "./sub-components/extension-list-tab";

// Re-export for backward compatibility (used by other sub-components)
export type { SyncStatus } from "./extension-sync-utils";
export { getSyncStatusDot } from "./extension-sync-utils";

interface ExtensionManagementDialogProps {
  isOpen: boolean;
  onClose: () => void;
  limitedMode: boolean;
  subPage?: boolean;
  /** Which tab is displayed when the dialog mounts; defaults to "extensions". */
  initialTab?: "extensions" | "groups";
}

export function ExtensionManagementDialog({
  isOpen,
  onClose,
  limitedMode,
  subPage,
  initialTab = "extensions",
}: ExtensionManagementDialogProps) {
  const { t } = useTranslation();
  const {
    extensions,
    extensionGroups,
    isLoading,
    isUploading,
    extensionName,
    setExtensionName,
    showUploadForm,
    setShowUploadForm,
    pendingFile,
    setPendingFile,
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
    extensionToDelete,
    setExtensionToDelete,
    groupToDelete,
    setGroupToDelete,
    isDeleting,
    bulkExtDeleteOpen,
    setBulkExtDeleteOpen,
    bulkGroupDeleteOpen,
    setBulkGroupDeleteOpen,
    editingExtension,
    setEditingExtension,
    editExtensionName,
    setEditExtensionName,
    pendingUpdateFile,
    setPendingUpdateFile,
    extTable,
    groupTable,
    activeTab,
    setActiveTab,
    selectedExtensions,
    selectedGroups,
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
    renderExtensionIcon,
    renderCompatIcons,
  } = useExtensionManagement({ isOpen, limitedMode, initialTab });

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose} subPage={subPage}>
        <DialogContent className="flex max-h-[90vh] max-w-[min(80rem,calc(100%-4rem))] flex-col">
          {!subPage && (
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <LuPuzzle className="size-5" />
                {t("extensions.title")}
                {limitedMode && <ProBadge />}
              </DialogTitle>
              <DialogDescription>
                {t("extensions.description")}
              </DialogDescription>
            </DialogHeader>
          )}

          <div className="@container relative flex min-h-0 w-full flex-1 flex-col">
            {limitedMode && (
              <>
                <div className="absolute inset-0 z-1 bg-background/30 backdrop-blur-[6px]" />
                <div className="absolute inset-y-0 left-0 z-2 w-6 bg-linear-to-r from-background to-transparent" />
                <div className="absolute inset-y-0 right-0 z-2 w-6 bg-linear-to-l from-background to-transparent" />
                <div className="absolute inset-x-0 top-0 z-2 h-6 bg-linear-to-b from-background to-transparent" />
                <div className="absolute inset-x-0 bottom-0 z-2 h-6 bg-linear-to-t from-background to-transparent" />
                <div className="absolute inset-0 z-3 flex items-center justify-center">
                  <div className="flex items-center gap-2 rounded-md bg-background/80 px-3 py-1.5">
                    <ProBadge />
                    <span className="text-sm font-medium text-muted-foreground">
                      {t("extensions.proRequired")}
                    </span>
                  </div>
                </div>
              </>
            )}

            <AnimatedTabs
              key={initialTab}
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "extensions" | "groups")}
              className="flex min-h-0 flex-1 flex-col"
            >
              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
                <AnimatedTabsList>
                  <AnimatedTabsTrigger
                    value="extensions"
                    disabled={limitedMode}
                  >
                    <span>{t("extensions.extensionsTab")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {extensions.length}
                    </span>
                  </AnimatedTabsTrigger>
                  <AnimatedTabsTrigger value="groups" disabled={limitedMode}>
                    <span>{t("extensions.groupsTab")}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {extensionGroups.length}
                    </span>
                  </AnimatedTabsTrigger>
                </AnimatedTabsList>
                <div className="flex items-center gap-2">
                  {activeTab === "extensions" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <RippleButton
                          size="sm"
                          variant="outline"
                          disabled={limitedMode}
                          onClick={() =>
                            document.getElementById("ext-file-input")?.click()
                          }
                          aria-label={t("extensions.upload")}
                        >
                          <LuUpload className="size-4" />
                          <span className="hidden @2xl:inline">
                            {t("extensions.upload")}
                          </span>
                        </RippleButton>
                      </TooltipTrigger>
                      <TooltipContent>{t("extensions.upload")}</TooltipContent>
                    </Tooltip>
                  )}
                  {activeTab === "groups" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <RippleButton
                          size="sm"
                          disabled={limitedMode}
                          onClick={() => setShowCreateGroup(true)}
                          aria-label={t("extensions.newGroup")}
                        >
                          <GoPlus className="size-4" />
                          <span className="hidden @2xl:inline">
                            {t("extensions.newGroup")}
                          </span>
                        </RippleButton>
                      </TooltipTrigger>
                      <TooltipContent>
                        {t("extensions.newGroup")}
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              </div>

              {/* Notice */}
              <div className="mt-4 shrink-0 rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">
                {t("extensions.managedNotice")}
              </div>

              <AnimatedTabsContent
                value="extensions"
                className="mt-4 min-h-0 flex-1 flex-col data-[state=active]:flex"
              >
                <ExtensionListTab
                  extensions={extensions}
                  isLoading={isLoading}
                  limitedMode={limitedMode}
                  selectedExtensions={selectedExtensions}
                  extTable={extTable}
                  showUploadForm={showUploadForm}
                  setShowUploadForm={setShowUploadForm}
                  pendingFile={pendingFile}
                  setPendingFile={setPendingFile}
                  extensionName={extensionName}
                  setExtensionName={setExtensionName}
                  isUploading={isUploading}
                  handleFileSelect={handleFileSelect}
                  handleUpload={handleUpload}
                />
              </AnimatedTabsContent>

              <AnimatedTabsContent
                value="groups"
                className="mt-4 min-h-0 flex-1 flex-col data-[state=active]:flex"
              >
                <ExtensionGroupTab
                  extensionGroups={extensionGroups}
                  selectedGroups={selectedGroups}
                  groupTable={groupTable}
                  showCreateGroup={showCreateGroup}
                  setShowCreateGroup={setShowCreateGroup}
                  newGroupName={newGroupName}
                  setNewGroupName={setNewGroupName}
                  handleCreateGroup={handleCreateGroup}
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

      {/* Group editing dialog */}
      <EditGroupDialog
        editingGroup={editingGroup}
        onClose={() => {
          setEditingGroup(null);
          setEditGroupName("");
          setEditGroupExtensionIds([]);
        }}
        editGroupName={editGroupName}
        setEditGroupName={setEditGroupName}
        extensions={extensions}
        editGroupExtensionIds={editGroupExtensionIds}
        setEditGroupExtensionIds={setEditGroupExtensionIds}
        handleSaveGroupEdits={handleSaveGroupEdits}
        renderExtensionIcon={renderExtensionIcon}
        renderCompatIcons={renderCompatIcons}
      />

      <EditExtensionDialog
        editingExtension={editingExtension}
        onClose={() => {
          setEditingExtension(null);
          setEditExtensionName("");
          setPendingUpdateFile(null);
        }}
        editExtensionName={editExtensionName}
        setEditExtensionName={setEditExtensionName}
        pendingUpdateFile={pendingUpdateFile}
        setPendingUpdateFile={setPendingUpdateFile}
        handleEditFileSelect={handleEditFileSelect}
        handleUpdateExtension={handleUpdateExtension}
        renderCompatIcons={renderCompatIcons}
      />

      {/* Delete extension confirmation */}
      <DeleteConfirmationDialog
        isOpen={extensionToDelete !== null}
        onClose={() => {
          setExtensionToDelete(null);
        }}
        onConfirm={handleDeleteExtension}
        title={t("extensions.deleteConfirmTitle")}
        description={t("extensions.deleteConfirmDescription", {
          name: extensionToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />

      {/* Delete group confirmation */}
      <DeleteConfirmationDialog
        isOpen={groupToDelete !== null}
        onClose={() => {
          setGroupToDelete(null);
        }}
        onConfirm={handleDeleteGroup}
        title={t("extensions.deleteGroupConfirmTitle")}
        description={t("extensions.deleteGroupConfirmDescription", {
          name: groupToDelete?.name ?? "",
        })}
        isLoading={isDeleting}
      />

      {/* Bulk delete extensions confirmation */}
      <DeleteConfirmationDialog
        isOpen={bulkExtDeleteOpen}
        onClose={() => {
          setBulkExtDeleteOpen(false);
        }}
        onConfirm={handleBulkDeleteExtensions}
        title={t("extensions.bulkDelete.extensionsTitle")}
        description={t("extensions.bulkDelete.extensionsDescription", {
          count: selectedExtensions.length,
          names: selectedExtensions.map((ext) => ext.name).join(", "),
        })}
        confirmButtonText={t("extensions.bulkDelete.confirmButton")}
        isLoading={isDeleting}
      />

      {/* Bulk delete groups confirmation */}
      <DeleteConfirmationDialog
        isOpen={bulkGroupDeleteOpen}
        onClose={() => {
          setBulkGroupDeleteOpen(false);
        }}
        onConfirm={handleBulkDeleteGroups}
        title={t("extensions.bulkDelete.groupsTitle")}
        description={t("extensions.bulkDelete.groupsDescription", {
          count: selectedGroups.length,
          names: selectedGroups.map((group) => group.name).join(", "),
        })}
        confirmButtonText={t("extensions.bulkDelete.confirmButton")}
        isLoading={isDeleting}
      />

      {/* Bulk action bars — only mount the active tab's bar; an always-
          mounted DataTableActionBar (even with visible=false) keeps an
          AnimatePresence wrapper alive that intermittently captured pointer
          input on the proxy/extension subpages. */}
      {isOpen && activeTab === "extensions" && (
        <DataTableActionBar table={extTable}>
          <DataTableActionBarSelection table={extTable} />
          <DataTableActionBarAction
            tooltip={t("syncTooltips.bulkToggle")}
            size="icon"
            onClick={() => {
              void handleBulkToggleExtSync();
            }}
          >
            <LuRefreshCw />
          </DataTableActionBarAction>
          <DataTableActionBarAction
            tooltip={t("common.buttons.delete")}
            variant="destructive"
            size="icon"
            className="border-destructive bg-destructive/50 hover:bg-destructive/70"
            onClick={() => {
              setBulkExtDeleteOpen(true);
            }}
          >
            <LuTrash2 />
          </DataTableActionBarAction>
        </DataTableActionBar>
      )}

      {isOpen && activeTab === "groups" && (
        <DataTableActionBar table={groupTable}>
          <DataTableActionBarSelection table={groupTable} />
          <DataTableActionBarAction
            tooltip={t("syncTooltips.bulkToggle")}
            size="icon"
            onClick={() => {
              void handleBulkToggleGroupSync();
            }}
          >
            <LuRefreshCw />
          </DataTableActionBarAction>
          <DataTableActionBarAction
            tooltip={t("common.buttons.delete")}
            variant="destructive"
            size="icon"
            className="border-destructive bg-destructive/50 hover:bg-destructive/70"
            onClick={() => {
              setBulkGroupDeleteOpen(true);
            }}
          >
            <LuTrash2 />
          </DataTableActionBarAction>
        </DataTableActionBar>
      )}
    </>
  );
}
