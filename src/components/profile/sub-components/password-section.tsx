"use client";

import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordSectionProps {
  enablePassword: boolean;
  setEnablePassword: (enabled: boolean) => void;
  password: string;
  setPassword: (password: string) => void;
  passwordConfirm: string;
  setPasswordConfirm: (confirm: string) => void;
  passwordError: string | null;
  setPasswordError: (error: string | null) => void;
  ephemeral: boolean;
  PASSWORD_MIN_LEN: number;
}

/**
 * Password configuration section: enable toggle + password inputs + validation.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 */
export function PasswordSection({
  enablePassword,
  setEnablePassword,
  password,
  setPassword,
  passwordConfirm,
  setPasswordConfirm,
  passwordError,
  setPasswordError,
  ephemeral,
  PASSWORD_MIN_LEN,
}: PasswordSectionProps) {
  return (
    <div className="space-y-4">
      {/* Enable password switch */}
      <div className="flex items-center justify-between rounded-lg border bg-muted/20 p-4">
        <div className="space-y-0.5">
          <Label className="text-sm font-medium">Protect with password</Label>
          <p className="text-xs text-muted-foreground">
            Require password to launch this profile
          </p>
        </div>
        <AnimatedSwitch
          checked={enablePassword}
          onCheckedChange={setEnablePassword}
          disabled={ephemeral}
        />
      </div>

      {/* Password inputs */}
      {enablePassword && !ephemeral && (
        <div className="space-y-3 pl-1">
          <div className="space-y-2">
            <Label htmlFor="profile-password">Password</Label>
            <Input
              id="profile-password"
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              placeholder="Enter password"
              className="h-9"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="profile-password-confirm">Confirm Password</Label>
            <Input
              id="profile-password-confirm"
              type="password"
              value={passwordConfirm}
              onChange={(e) => {
                setPasswordConfirm(e.target.value);
                setPasswordError(null);
              }}
              placeholder="Confirm password"
              className="h-9"
            />
          </div>
          {passwordError && (
            <p className="text-xs text-destructive">{passwordError}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Password must be at least {PASSWORD_MIN_LEN} characters
          </p>
        </div>
      )}
    </div>
  );
}
