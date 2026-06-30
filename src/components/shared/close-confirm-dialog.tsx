"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmationDialog } from "./confirmation-dialog";

export function CloseConfirmDialog() {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unlistenPromise = listen("close-confirm-requested", () => {
      setIsOpen(true);
    });
    return () => {
      void unlistenPromise.then((u) => {
        u();
      });
    };
  }, []);

  // The native tray menu is built in Rust and cannot read the active language,
  // so push localized labels to it on mount and whenever the language changes.
  useEffect(() => {
    const syncTrayMenu = () => {
      void invoke("update_tray_menu", {
        showLabel: t("tray.show"),
        quitLabel: t("tray.quit"),
      }).catch(() => {
        // Tray is desktop-only; ignore on platforms without one.
      });
    };
    syncTrayMenu();
    i18n.on("languageChanged", syncTrayMenu);
    return () => {
      i18n.off("languageChanged", syncTrayMenu);
    };
  }, [t, i18n]);

  const handleMinimize = async () => {
    setIsOpen(false);
    try {
      await invoke("hide_to_tray");
    } catch (error) {
      console.error("Failed to hide to tray:", error);
    }
  };

  const handleQuit = async () => {
    setIsOpen(false);
    try {
      await invoke("confirm_quit");
    } catch (error) {
      console.error("Failed to quit app:", error);
    }
  };

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={handleMinimize}
      onConfirm={handleQuit}
      title={t("closeConfirm.title")}
      description={t("closeConfirm.description")}
      cancelButtonText={t("closeConfirm.minimize")}
      confirmButtonText={t("closeConfirm.quit")}
      confirmButtonVariant="destructive"
    />
  );
}
