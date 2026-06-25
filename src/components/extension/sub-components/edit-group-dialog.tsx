"use client";

import React from "react";
import { useTranslation } from "react-i18next";
import { LuTrash2 } from "react-icons/lu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Extension, ExtensionGroup } from "@/types";

interface EditGroupDialogProps {
  editingGroup: ExtensionGroup | null;
  onClose: () => void;
  editGroupName: string;
  setEditGroupName: (name: string) => void;
  extensions: Extension[];
  editGroupExtensionIds: string[];
  setEditGroupExtensionIds: React.Dispatch<React.SetStateAction<string[]>>;
  handleSaveGroupEdits: () => Promise<void>;
  renderExtensionIcon: (ext: Extension, size?: "sm" | "md") => React.ReactNode;
  renderCompatIcons: (compat: string[]) => React.ReactNode;
}

export function EditGroupDialog({
  editingGroup,
  onClose,
  editGroupName,
  setEditGroupName,
  extensions,
  editGroupExtensionIds,
  setEditGroupExtensionIds,
  handleSaveGroupEdits,
  renderExtensionIcon,
  renderCompatIcons,
}: EditGroupDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog
      open={editingGroup !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>{t("extensions.editGroup")}</DialogTitle>
          <DialogDescription>
            {t("extensions.editGroupDescription")}
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="-mx-6 flex-1 overflow-y-auto px-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>{t("common.labels.name")}</Label>
              <Input
                value={editGroupName}
                onChange={(e) => setEditGroupName(e.target.value)}
                placeholder={t("extensions.groupNamePlaceholder")}
              />
            </div>

            {extensions.filter((e) => !editGroupExtensionIds.includes(e.id))
              .length > 0 && (
              <div className="space-y-2">
                <Label>{t("extensions.addToGroup")}</Label>
                <Select
                  value=""
                  onValueChange={(extId) => {
                    setEditGroupExtensionIds((prev) => [...prev, extId]);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t("extensions.addToGroup")} />
                  </SelectTrigger>
                  <SelectContent>
                    {extensions
                      .filter((e) => !editGroupExtensionIds.includes(e.id))
                      .map((ext) => (
                        <SelectItem key={ext.id} value={ext.id}>
                          <div className="flex items-center gap-2">
                            {renderExtensionIcon(ext, "sm")}
                            {ext.name}
                          </div>
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>{t("extensions.groupExtensions")}</Label>
              {editGroupExtensionIds.length === 0 ? (
                <div className="py-2 text-sm text-muted-foreground">
                  {t("extensions.noExtensionsInGroup")}
                </div>
              ) : (
                <div className="max-h-[min(40vh,320px)] space-y-1 overflow-y-auto">
                  {editGroupExtensionIds.map((extId) => {
                    const ext = extensions.find((e) => e.id === extId);
                    if (!ext) return null;
                    return (
                      <div
                        key={extId}
                        className="flex items-center gap-2 rounded-md border px-2 py-1.5"
                      >
                        {renderExtensionIcon(ext, "sm")}
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {ext.name}
                        </span>
                        {renderCompatIcons(ext.browser_compatibility)}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="size-6 shrink-0 p-0"
                          onClick={() => {
                            setEditGroupExtensionIds((prev) =>
                              prev.filter((id) => id !== extId),
                            );
                          }}
                        >
                          <LuTrash2 className="size-3" />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("common.buttons.cancel")}
          </Button>
          <RippleButton
            onClick={() => void handleSaveGroupEdits()}
            disabled={!editGroupName.trim()}
          >
            {t("common.buttons.save")}
          </RippleButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
