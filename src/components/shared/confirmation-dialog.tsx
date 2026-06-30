"use client";

import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RippleButton } from "@/components/ui/ripple";
import { LoadingButton } from "./loading-button";

interface ConfirmationDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: string | React.ReactNode;
  confirmButtonText: string;
  cancelButtonText?: string;
  confirmButtonVariant?:
    | "default"
    | "destructive"
    | "outline"
    | "secondary"
    | "ghost";
  isLoading?: boolean;
  children?: React.ReactNode;
}

export function ConfirmationDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmButtonText,
  cancelButtonText,
  confirmButtonVariant = "default",
  isLoading = false,
  children,
}: ConfirmationDialogProps) {
  const { t } = useTranslation();
  const handleConfirm = async () => {
    await onConfirm();
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
          {children}
        </DialogHeader>
        <DialogFooter>
          <RippleButton
            variant="outline"
            onClick={onClose}
            disabled={isLoading}
          >
            {cancelButtonText ?? t("common.buttons.cancel")}
          </RippleButton>
          <LoadingButton
            variant={confirmButtonVariant}
            onClick={() => void handleConfirm()}
            isLoading={isLoading}
          >
            {confirmButtonText}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
