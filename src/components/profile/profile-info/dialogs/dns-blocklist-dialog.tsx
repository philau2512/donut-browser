"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface ProfileDnsBlocklistDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profileId: string | null;
  currentLevel: string | null;
}

export function ProfileDnsBlocklistDialog({
  isOpen,
  onClose,
  profileId,
  currentLevel,
}: ProfileDnsBlocklistDialogProps) {
  const { t } = useTranslation();
  const [level, setLevel] = React.useState(currentLevel ?? "");
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (isOpen) {
      setLevel(currentLevel ?? "");
    }
  }, [isOpen, currentLevel]);

  const handleSave = async () => {
    if (!profileId) return;
    setIsSaving(true);
    try {
      await invoke("update_profile_dns_blocklist", {
        profileId,
        dnsBlocklist: level || null,
      });
      onClose();
    } catch (err) {
      console.error("Failed to update DNS blocklist:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const options = [
    { value: "", label: t("dnsBlocklist.none") },
    { value: "light", label: t("dnsBlocklist.light") },
    { value: "normal", label: t("dnsBlocklist.normal") },
    { value: "pro", label: t("dnsBlocklist.pro") },
    { value: "pro_plus", label: t("dnsBlocklist.proPlus") },
    { value: "ultimate", label: t("dnsBlocklist.ultimate") },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>{t("dnsBlocklist.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {t("dnsBlocklist.settingsDescription")}{" "}
          <a
            href="https://github.com/hagezi/dns-blocklists"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
          >
            {t("common.buttons.moreInfo")}
          </a>
        </p>
        <div className="space-y-1">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setLevel(option.value)}
              className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                level === option.value
                  ? "bg-primary/10 text-primary border border-primary/30"
                  : "hover:bg-accent border border-transparent"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <Button
          onClick={() => void handleSave()}
          disabled={isSaving || level === (currentLevel ?? "")}
          className="w-full"
        >
          {t("common.buttons.save")}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
