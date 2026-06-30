"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuUpload } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RippleButton } from "@/components/ui/ripple";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { Extension } from "@/types";

interface EditExtensionDialogProps {
  editingExtension: Extension | null;
  onClose: () => void;
  editExtensionName: string;
  setEditExtensionName: (name: string) => void;
  pendingUpdateFile: { name: string; data: number[] } | null;
  setPendingUpdateFile: (file: { name: string; data: number[] } | null) => void;
  handleEditFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  handleUpdateExtension: () => Promise<void>;
  renderCompatIcons: (compat: string[]) => React.ReactNode;
}

export function EditExtensionDialog({
  editingExtension,
  onClose,
  editExtensionName,
  setEditExtensionName,
  pendingUpdateFile,
  setPendingUpdateFile,
  handleEditFileSelect,
  handleUpdateExtension,
  renderCompatIcons,
}: EditExtensionDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={editingExtension !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("extensions.editExtension")}</DialogTitle>
          <DialogDescription>
            {t("extensions.editExtensionDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-6 flex-1 overflow-y-auto px-6">
          {editingExtension && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>{t("common.labels.name")}</Label>
                <Input
                  value={editExtensionName}
                  onChange={(e) => setEditExtensionName(e.target.value)}
                  placeholder={t("extensions.namePlaceholder")}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void handleUpdateExtension();
                  }}
                />
              </div>

              {/* Metadata from manifest.json */}
              <div className="space-y-2 rounded-md border p-3">
                <Label className="text-xs tracking-wide text-muted-foreground uppercase">
                  {t("extensions.metadata")}
                </Label>
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {editingExtension.version && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.version")}
                      </span>
                      <span>{editingExtension.version}</span>
                    </>
                  )}
                  {editingExtension.author && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.author")}
                      </span>
                      <span>{editingExtension.author}</span>
                    </>
                  )}
                  {editingExtension.description && (
                    <>
                      <span className="text-muted-foreground">
                        {t("common.labels.description")}
                      </span>
                      <span className="line-clamp-3">
                        {editingExtension.description}
                      </span>
                    </>
                  )}
                  <span className="text-muted-foreground">
                    {t("extensions.compatibility.label")}
                  </span>
                  <div className="flex items-center gap-1">
                    {renderCompatIcons(editingExtension.browser_compatibility)}
                  </div>
                  <span className="text-muted-foreground">
                    {t("common.labels.type")}
                  </span>
                  <span>.{editingExtension.file_type}</span>
                  {editingExtension.homepage_url && (
                    <>
                      <span className="text-muted-foreground">
                        {t("extensions.homepage")}
                      </span>
                      <a
                        href={editingExtension.homepage_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-w-0 items-center gap-1 text-primary hover:underline"
                      >
                        <span className="truncate">
                          {editingExtension.homepage_url}
                        </span>
                        <LuExternalLink className="size-3 shrink-0" />
                      </a>
                    </>
                  )}
                  {!editingExtension.version &&
                    !editingExtension.author &&
                    !editingExtension.description &&
                    !editingExtension.homepage_url && (
                      <span className="col-span-2 text-xs text-muted-foreground">
                        {t("extensions.noMetadata")}
                      </span>
                    )}
                </div>
              </div>

              {/* Re-upload */}
              <div className="space-y-2">
                <Label>{t("extensions.reupload")}</Label>
                <div className="flex items-center gap-2">
                  <RippleButton
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      document.getElementById("ext-edit-file-input")?.click()
                    }
                  >
                    <LuUpload className="mr-1 size-3" />
                    {t("extensions.selectFile")}
                  </RippleButton>
                  <input
                    id="ext-edit-file-input"
                    type="file"
                    accept=".xpi,.crx,.zip"
                    className="hidden"
                    onChange={handleEditFileSelect}
                  />
                  {pendingUpdateFile && (
                    <span className="max-w-[200px] truncate text-xs text-muted-foreground">
                      {pendingUpdateFile.name}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </ScrollArea>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              setPendingUpdateFile(null);
            }}
          >
            {t("common.buttons.cancel")}
          </Button>
          <RippleButton
            onClick={() => void handleUpdateExtension()}
            disabled={!editExtensionName.trim()}
          >
            {t("common.buttons.save")}
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
