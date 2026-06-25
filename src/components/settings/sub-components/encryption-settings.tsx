"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LoadingButton } from "@/components/shared";
import { Badge } from "@/components/ui/badge";
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
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";

interface EncryptionSettingsProps {
  canUseEncryption: boolean;
  hasE2ePassword: boolean;
  setHasE2ePassword: React.Dispatch<React.SetStateAction<boolean>>;
  isRemovingE2e: boolean;
  setIsRemovingE2e: React.Dispatch<React.SetStateAction<boolean>>;
  e2ePassword: string;
  setE2ePassword: React.Dispatch<React.SetStateAction<string>>;
  e2ePasswordConfirm: string;
  setE2ePasswordConfirm: React.Dispatch<React.SetStateAction<string>>;
  e2eError: string;
  setE2eError: React.Dispatch<React.SetStateAction<string>>;
  isSavingE2e: boolean;
  setIsSavingE2e: React.Dispatch<React.SetStateAction<boolean>>;
  isVerifyE2eOpen: boolean;
  setIsVerifyE2eOpen: React.Dispatch<React.SetStateAction<boolean>>;
  verifyE2ePassword: string;
  setVerifyE2ePassword: React.Dispatch<React.SetStateAction<string>>;
  isVerifyingE2e: boolean;
  setIsVerifyingE2e: React.Dispatch<React.SetStateAction<boolean>>;
}

export function EncryptionSettings({
  canUseEncryption,
  hasE2ePassword,
  setHasE2ePassword,
  isRemovingE2e,
  setIsRemovingE2e,
  e2ePassword,
  setE2ePassword,
  e2ePasswordConfirm,
  setE2ePasswordConfirm,
  e2eError,
  setE2eError,
  isSavingE2e,
  setIsSavingE2e,
  isVerifyE2eOpen,
  setIsVerifyE2eOpen,
  verifyE2ePassword,
  setVerifyE2ePassword,
  isVerifyingE2e,
  setIsVerifyingE2e,
}: EncryptionSettingsProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <Label className="text-base font-medium">
        {t("settings.encryption.title")}
      </Label>
      <p className="text-xs text-muted-foreground">
        {t("settings.encryption.description")}
      </p>

      {!canUseEncryption ? (
        <p className="text-sm text-muted-foreground">
          {t("settings.encryption.requiresProOrOwner")}
        </p>
      ) : hasE2ePassword ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Badge variant="default">
              {t("settings.encryption.passwordSet")}
            </Badge>
            <span className="text-sm text-muted-foreground">
              {t("settings.encryption.passwordSetDescription")}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={isRemovingE2e}
              onClick={() => {
                setVerifyE2ePassword("");
                setIsVerifyE2eOpen(true);
              }}
            >
              {t("settings.encryption.validatePassword")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isRemovingE2e}
              onClick={() => {
                setHasE2ePassword(false);
                setE2ePassword("");
                setE2ePasswordConfirm("");
                setE2eError("");
              }}
            >
              {t("settings.encryption.changePassword")}
            </Button>
            <LoadingButton
              variant="destructive"
              size="sm"
              isLoading={isRemovingE2e}
              onClick={async () => {
                setIsRemovingE2e(true);
                try {
                  await invoke("delete_e2e_password");
                  setHasE2ePassword(false);
                  try {
                    await invoke("rollover_encryption_for_all_entities");
                  } catch (rolloverErr) {
                    console.error(
                      "Rollover after password removal failed:",
                      rolloverErr,
                    );
                    showErrorToast(String(rolloverErr));
                  }
                  showSuccessToast(t("settings.encryption.removed"));
                } catch (error) {
                  showErrorToast(String(error));
                } finally {
                  setIsRemovingE2e(false);
                }
              }}
            >
              {t("settings.encryption.removePassword")}
            </LoadingButton>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <Input
            type="password"
            placeholder={t("settings.encryption.passwordPlaceholder")}
            value={e2ePassword}
            onChange={(e) => {
              setE2ePassword(e.target.value);
              setE2eError("");
            }}
          />
          <Input
            type="password"
            placeholder={t("settings.encryption.confirmPlaceholder")}
            value={e2ePasswordConfirm}
            onChange={(e) => {
              setE2ePasswordConfirm(e.target.value);
              setE2eError("");
            }}
          />
          {e2eError && <p className="text-sm text-destructive">{e2eError}</p>}
          <LoadingButton
            variant="default"
            size="sm"
            isLoading={isSavingE2e}
            onClick={async () => {
              if (e2ePassword.length < 8) {
                setE2eError(t("settings.encryption.passwordTooShort"));
                return;
              }
              if (e2ePassword !== e2ePasswordConfirm) {
                setE2eError(t("settings.encryption.passwordMismatch"));
                return;
              }
              setIsSavingE2e(true);
              try {
                await invoke("set_e2e_password", {
                  password: e2ePassword,
                });
                setHasE2ePassword(true);
                setE2ePassword("");
                setE2ePasswordConfirm("");
                try {
                  await invoke("rollover_encryption_for_all_entities");
                } catch (rolloverErr) {
                  console.error(
                    "Rollover after password set failed:",
                    rolloverErr,
                  );
                  showErrorToast(String(rolloverErr));
                }
                showSuccessToast(t("settings.encryption.passwordSaved"));
              } catch (error) {
                showErrorToast(String(error));
              } finally {
                setIsSavingE2e(false);
              }
            }}
          >
            {t("settings.encryption.setPassword")}
          </LoadingButton>
        </div>
      )}

      <Dialog
        open={isVerifyE2eOpen}
        onOpenChange={(open) => {
          if (!isVerifyingE2e) {
            setIsVerifyE2eOpen(open);
            if (!open) setVerifyE2ePassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("settings.encryption.validateDialog.title")}
            </DialogTitle>
            <DialogDescription>
              {t("settings.encryption.validateDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              placeholder={t("settings.encryption.passwordPlaceholder")}
              value={verifyE2ePassword}
              autoFocus
              onChange={(e) => setVerifyE2ePassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && verifyE2ePassword.length > 0) {
                  e.preventDefault();
                  void (async () => {
                    setIsVerifyingE2e(true);
                    try {
                      const ok = await invoke<boolean>("verify_e2e_password", {
                        password: verifyE2ePassword,
                      });
                      if (ok) {
                        showSuccessToast(
                          t("settings.encryption.validateDialog.matchToast"),
                        );
                        setIsVerifyE2eOpen(false);
                        setVerifyE2ePassword("");
                      } else {
                        showErrorToast(
                          t("settings.encryption.validateDialog.mismatchToast"),
                        );
                      }
                    } catch (error) {
                      showErrorToast(String(error));
                    } finally {
                      setIsVerifyingE2e(false);
                    }
                  })();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isVerifyingE2e}
              onClick={() => {
                setIsVerifyE2eOpen(false);
                setVerifyE2ePassword("");
              }}
            >
              {t("common.buttons.cancel")}
            </Button>
            <LoadingButton
              isLoading={isVerifyingE2e}
              disabled={verifyE2ePassword.length === 0}
              onClick={async () => {
                setIsVerifyingE2e(true);
                try {
                  const ok = await invoke<boolean>("verify_e2e_password", {
                    password: verifyE2ePassword,
                  });
                  if (ok) {
                    showSuccessToast(
                      t("settings.encryption.validateDialog.matchToast"),
                    );
                    setIsVerifyE2eOpen(false);
                    setVerifyE2ePassword("");
                  } else {
                    showErrorToast(
                      t("settings.encryption.validateDialog.mismatchToast"),
                    );
                  }
                } catch (error) {
                  showErrorToast(String(error));
                } finally {
                  setIsVerifyingE2e(false);
                }
              }}
            >
              {t("settings.encryption.validateDialog.submit")}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
