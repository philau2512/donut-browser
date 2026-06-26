"use client";

import { invoke } from "@tauri-apps/api/core";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { LuPlus, LuTrash2 } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ProfileStatusConfig } from "@/types";

interface StatusSettingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  statuses: ProfileStatusConfig[];
  onStatusesChange: (statuses: ProfileStatusConfig[]) => void;
}

export const StatusSettingDialog = React.memo<StatusSettingDialogProps>(
  ({ open, onOpenChange, statuses, onStatusesChange }) => {
    const { t } = useTranslation();
    const [draft, setDraft] = useState<ProfileStatusConfig[]>(statuses);
    const [newLabel, setNewLabel] = useState("");
    const [newColor, setNewColor] = useState("#6366f1");
    const [saving, setSaving] = useState(false);

    React.useEffect(() => {
      if (open) {
        setDraft(statuses);
        setNewLabel("");
        setNewColor("#6366f1");
      }
    }, [open, statuses]);

    const handleAdd = () => {
      const label = newLabel.trim();
      if (!label) return;
      if (draft.some((s) => s.label.toLowerCase() === label.toLowerCase()))
        return;
      setDraft([...draft, { label, color: newColor }]);
      setNewLabel("");
      setNewColor("#6366f1");
    };

    const handleDelete = (label: string) => {
      setDraft(draft.filter((s) => s.label !== label));
    };

    const handleColorChange = (label: string, color: string) => {
      setDraft(draft.map((s) => (s.label === label ? { ...s, color } : s)));
    };

    const handleSave = async () => {
      setSaving(true);
      try {
        const saved = await invoke<ProfileStatusConfig[]>(
          "save_profile_statuses",
          { statuses: draft },
        );
        onStatusesChange(saved);
        onOpenChange(false);
      } catch (e) {
        console.error("Failed to save profile statuses:", e);
      } finally {
        setSaving(false);
      }
    };

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("profiles.status.manageTitle")}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-2 py-2 max-h-64 overflow-y-auto">
            {draft.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t("profiles.status.setting")}
              </p>
            )}
            {draft.map((s) => (
              <div
                key={s.label}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50"
              >
                <input
                  type="color"
                  value={s.color}
                  onChange={(e) => handleColorChange(s.label, e.target.value)}
                  className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent"
                  aria-label={`Color for ${s.label}`}
                />
                <span className="flex-1 text-sm font-medium truncate">
                  {s.label}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 text-muted-foreground hover:text-destructive"
                  onClick={() => handleDelete(s.label)}
                  aria-label={`Delete ${s.label}`}
                >
                  <LuTrash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          {/* Add new status */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
              aria-label="New status color"
            />
            <Input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder={t("profiles.status.labelPlaceholder")}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
            />
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleAdd}
              disabled={!newLabel.trim()}
              aria-label={t("profiles.status.addStatus")}
            >
              <LuPlus className="h-4 w-4" />
            </Button>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              {t("common.buttons.cancel")}
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {t("common.buttons.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  },
);

StatusSettingDialog.displayName = "StatusSettingDialog";
