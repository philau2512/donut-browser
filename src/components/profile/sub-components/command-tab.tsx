"use client";

import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface CommandTabProps {
  launchHook: string;
  setLaunchHook: (val: string) => void;
  isCreating: boolean;
}

export function CommandTab({
  launchHook,
  setLaunchHook,
  isCreating,
}: CommandTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      {/* Launch Hook */}
      <div className="space-y-2">
        <Label htmlFor="launch-hook-input">
          {t("createProfile.launchHook.label")}
        </Label>
        <Input
          id="launch-hook-input"
          value={launchHook}
          onChange={(e) => setLaunchHook(e.target.value)}
          placeholder={t("createProfile.launchHook.placeholder")}
          disabled={isCreating}
          className="h-9"
        />
        <p className="text-xs text-muted-foreground">
          Webhook URL triggered automatically every time this profile is
          launched.
        </p>
      </div>
    </div>
  );
}
