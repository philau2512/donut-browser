"use client";

import { useTranslation } from "react-i18next";
import { ConfirmationDialog } from "./confirmation-dialog";

interface DeleteConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmButtonText?: string;
  confirmButtonVariant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost";
  isLoading?: boolean;
  profileIds?: string[];
  profiles?: { id: string; name: string }[];
}

export function DeleteConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmButtonText,
  confirmButtonVariant = "destructive",
  isLoading = false,
  profileIds,
  profiles = [],
}: DeleteConfirmationDialogProps) {
  const { t } = useTranslation();

  return (
    <ConfirmationDialog
      isOpen={isOpen}
      onClose={onClose}
      onConfirm={onConfirm}
      title={title}
      description={description}
      confirmButtonText={confirmButtonText ?? t("common.buttons.delete")}
      confirmButtonVariant={confirmButtonVariant}
      isLoading={isLoading}
    >
      {profileIds && profileIds.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">
            {t("deleteDialog.profilesToDelete")}
          </p>
          <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-3">
            <ul className="space-y-1">
              {profileIds.map((id) => {
                const profile = profiles.find((p) => p.id === id);
                const displayName = profile ? profile.name : id;
                return (
                  <li
                    key={id}
                    className="truncate text-sm text-muted-foreground"
                  >
                    • {displayName}
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}
    </ConfirmationDialog>
  );
}
