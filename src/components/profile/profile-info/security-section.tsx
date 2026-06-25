"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { useTranslation } from "react-i18next";
import { LuKey } from "react-icons/lu";
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
import { translateBackendError } from "@/lib/backend-errors";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { cn } from "@/lib/utils";
import type { BrowserProfile } from "@/types";

interface SecuritySectionInlineProps {
  profile: BrowserProfile;
  isRunning: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

type Mode = "set" | "change" | "remove";

export function SecuritySectionInline({
  profile,
  isRunning,
  t,
}: SecuritySectionInlineProps) {
  const { t: tFn } = useTranslation();
  const initialMode: Mode = profile.password_protected ? "change" : "set";
  const [mode, setMode] = React.useState<Mode>(initialMode);
  const [oldPassword, setOldPassword] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [success, setSuccess] = React.useState<string | null>(null);
  const [isVerifyOpen, setIsVerifyOpen] = React.useState(false);
  const [verifyPassword, setVerifyPassword] = React.useState("");
  const [isVerifying, setIsVerifying] = React.useState(false);

  const onVerify = async () => {
    setIsVerifying(true);
    try {
      await invoke("verify_profile_password", {
        profileId: profile.id,
        password: verifyPassword,
      });
      showSuccessToast(t("profilePassword.verifyDialog.matchToast"));
      setIsVerifyOpen(false);
      setVerifyPassword("");
    } catch (e) {
      const message = translateBackendError(tFn, e);
      showErrorToast(message);
    } finally {
      setIsVerifying(false);
    }
  };

  React.useEffect(() => {
    setMode(profile.password_protected ? "change" : "set");
    setOldPassword("");
    setPassword("");
    setConfirm("");
    setError(null);
    setSuccess(null);
  }, [profile.password_protected]);

  const reset = () => {
    setOldPassword("");
    setPassword("");
    setConfirm("");
    setError(null);
  };

  const validate = (): string | null => {
    if (mode === "change" || mode === "remove") {
      if (!oldPassword) return t("profilePassword.errors.passwordRequired");
    }
    if (mode === "set" || mode === "change") {
      if (password.length < 8) return t("profilePassword.errors.tooShort");
      if (password !== confirm)
        return t("profilePassword.errors.passwordMismatch");
    }
    return null;
  };

  const onSubmit = async () => {
    if (isRunning) return;
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      if (mode === "set") {
        await invoke("set_profile_password", {
          profileId: profile.id,
          password,
        });
        showSuccessToast(t("profilePassword.toasts.set"));
      } else if (mode === "change") {
        await invoke("change_profile_password", {
          profileId: profile.id,
          oldPassword,
          newPassword: password,
        });
        showSuccessToast(t("profilePassword.toasts.changed"));
      } else {
        await invoke("remove_profile_password", {
          profileId: profile.id,
          password: oldPassword,
        });
        showSuccessToast(t("profilePassword.toasts.removed"));
      }
      reset();
    } catch (e) {
      const message = translateBackendError(tFn, e);
      setError(message);
      showErrorToast(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuKey className="size-4" />
        {t("profileInfo.sections.security")}
      </div>
      <p className="text-xs text-muted-foreground">
        {profile.password_protected
          ? t("profileInfo.security.protected")
          : t("profileInfo.security.unprotected")}
      </p>

      {profile.password_protected && (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => {
              setVerifyPassword("");
              setIsVerifyOpen(true);
            }}
            className={cn(
              "h-7 flex-1 rounded-md border px-2 text-xs transition-colors",
              "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t("profilePassword.modes.validate")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("change");
              reset();
            }}
            className={cn(
              "h-7 flex-1 rounded-md border px-2 text-xs transition-colors",
              mode === "change"
                ? "border-transparent bg-accent text-accent-foreground"
                : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t("profilePassword.modes.change")}
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("remove");
              reset();
            }}
            className={cn(
              "h-7 flex-1 rounded-md border px-2 text-xs transition-colors",
              mode === "remove"
                ? "border-transparent bg-destructive/10 text-destructive"
                : "border-border text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            {t("profilePassword.modes.remove")}
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {(mode === "change" || mode === "remove") && (
          <Input
            type="password"
            value={oldPassword}
            onChange={(e) => {
              setOldPassword(e.target.value);
              setError(null);
            }}
            placeholder={t("profilePassword.fields.currentPassword")}
            disabled={isRunning || isSubmitting}
            className="h-8 text-xs"
          />
        )}
        {(mode === "set" || mode === "change") && (
          <>
            <Input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError(null);
              }}
              placeholder={t("profilePassword.fields.newPassword")}
              disabled={isRunning || isSubmitting}
              className="h-8 text-xs"
            />
            <Input
              type="password"
              value={confirm}
              onChange={(e) => {
                setConfirm(e.target.value);
                setError(null);
              }}
              placeholder={t("profilePassword.fields.confirmPassword")}
              disabled={isRunning || isSubmitting}
              className="h-8 text-xs"
            />
          </>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
      {success && !error && <p className="text-xs text-success">{success}</p>}

      {isRunning && (
        <p className="text-xs text-muted-foreground">
          {t("profileInfo.security.cannotWhileRunning")}
        </p>
      )}

      <Button
        size="sm"
        variant={mode === "remove" ? "destructive" : "default"}
        className="h-7 self-start text-xs"
        disabled={isRunning || isSubmitting}
        onClick={() => {
          void onSubmit();
        }}
      >
        {mode === "set"
          ? t("profilePassword.modes.set")
          : mode === "change"
            ? t("profilePassword.modes.change")
            : t("profilePassword.modes.remove")}
      </Button>

      <Dialog
        open={isVerifyOpen}
        onOpenChange={(open) => {
          if (!isVerifying) {
            setIsVerifyOpen(open);
            if (!open) setVerifyPassword("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("profilePassword.verifyDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("profilePassword.verifyDialog.description")}
            </DialogDescription>
          </DialogHeader>
          <Input
            type="password"
            placeholder={t("profilePassword.fields.currentPassword")}
            value={verifyPassword}
            autoFocus
            onChange={(e) => setVerifyPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && verifyPassword.length > 0) {
                e.preventDefault();
                void onVerify();
              }
            }}
          />
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isVerifying}
              onClick={() => {
                setIsVerifyOpen(false);
                setVerifyPassword("");
              }}
            >
              {t("common.buttons.cancel")}
            </Button>
            <Button
              disabled={isVerifying || verifyPassword.length === 0}
              onClick={() => void onVerify()}
            >
              {isVerifying
                ? t("common.buttons.loading")
                : t("profilePassword.verifyDialog.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
