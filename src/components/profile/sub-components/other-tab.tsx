"use client";

import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface OtherTabProps {
  ephemeral: boolean;
  setEphemeral: (checked: boolean) => void;
  enablePassword: (checked: boolean) => void;
  enablePasswordVal: boolean;
  password: string;
  setPassword: (pass: string) => void;
  passwordConfirm: string;
  setPasswordConfirm: (pass: string) => void;
  passwordError: string | null;
  setPasswordError: (err: string | null) => void;
}

export function OtherTab({
  ephemeral,
  setEphemeral,
  enablePassword,
  enablePasswordVal,
  password,
  setPassword,
  passwordConfirm,
  setPasswordConfirm,
  passwordError,
  setPasswordError,
}: OtherTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Ephemeral Option */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">
            {t("profiles.ephemeral")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("profiles.ephemeralDescription")}
          </p>
        </div>
        <AnimatedSwitch
          id="ephemeral-switch"
          checked={ephemeral}
          onCheckedChange={(checked) => {
            setEphemeral(checked);
            if (checked) {
              enablePassword(false);
              setPassword("");
              setPasswordConfirm("");
              setPasswordError(null);
            }
          }}
        />
      </div>

      {/* Password Option */}
      {!ephemeral && (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-sm font-medium">
                {t("createProfile.passwordProtect.label")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("createProfile.passwordProtect.description")}
              </p>
            </div>
            <AnimatedSwitch
              id="enable-password-switch"
              checked={enablePasswordVal}
              onCheckedChange={(checked) => {
                enablePassword(checked);
                if (!checked) {
                  setPassword("");
                  setPasswordConfirm("");
                  setPasswordError(null);
                }
              }}
            />
          </div>
          {enablePasswordVal && (
            <div className="space-y-3 pt-2 pl-2 max-w-sm border-l-2 border-primary/20 ml-1">
              <div className="space-y-1">
                <Label htmlFor="new-pass">
                  {t("profilePassword.fields.newPassword")}
                </Label>
                <Input
                  id="new-pass"
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Enter master password"
                  autoComplete="new-password"
                  className="h-9"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="confirm-pass">
                  {t("profilePassword.fields.confirm")}
                </Label>
                <Input
                  id="confirm-pass"
                  type="password"
                  value={passwordConfirm}
                  onChange={(e) => {
                    setPasswordConfirm(e.target.value);
                    setPasswordError(null);
                  }}
                  placeholder="Confirm master password"
                  autoComplete="new-password"
                  className="h-9"
                />
              </div>
              {passwordError && (
                <p className="text-xs text-destructive">{passwordError}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
