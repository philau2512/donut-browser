"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

interface ProfileLaunchHookDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string | null;
  currentLaunchHook: string | null;
}

export function ProfileLaunchHookDialog({
  isOpen,
  onClose,
  profileId,
  currentLaunchHook,
}: ProfileLaunchHookDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(currentLaunchHook ?? "");
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setValue(currentLaunchHook ?? "");
    }
  }, [isOpen, currentLaunchHook]);

  const trimmed = value.trim();
  const saved = currentLaunchHook ?? "";
  const isDirty = trimmed !== saved;

  const handleSave = async () => {
    if (!profileId) return;
    setIsSaving(true);
    try {
      await invoke("update_profile_launch_hook", {
        profileId,
        launchHook: trimmed || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to update launch hook:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("profileInfo.launchHook.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("profileInfo.launchHook.description")}
        </p>
        <Input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
          }}
          placeholder={t("profileInfo.launchHook.placeholder")}
          disabled={isSaving}
        />
        <DialogFooter>
          <Button
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
            className="w-full"
          >
            {t("common.buttons.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
