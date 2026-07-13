"use client";

import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { BrowserProfile } from "@/types";
import { ValidationBadge, type ValidationWarning } from "./validation-badge";

interface CloseProfileNodeData {
  profileId: string;
  cleanupMode: "cookies" | "full";
}

interface CloseProfileFormProps {
  value: CloseProfileNodeData;
  onChange: (value: CloseProfileNodeData) => void;
  profiles: BrowserProfile[];
  variableWarnings?: ValidationWarning[];
}

export function CloseProfileForm({
  value,
  onChange,
  profiles,
  variableWarnings = [],
}: CloseProfileFormProps) {
  const { t } = useTranslation();

  const handleProfileChange = (profileId: string) => {
    onChange({ ...value, profileId });
  };

  const handleCleanupModeChange = (mode: "cookies" | "full") => {
    onChange({ ...value, cleanupMode: mode });
  };

  return (
    <div className="space-y-4 p-4">
      {/* Profile Selection */}
      <div className="space-y-1.5">
        <Label className="text-xs">
          {t("automation.nodes.closeProfile.params.profileId")}
          <span className="text-destructive"> *</span>
        </Label>
        <Select value={value.profileId} onValueChange={handleProfileChange}>
          <SelectTrigger className="w-full">
            <SelectValue
              placeholder={t(
                "automation.nodes.closeProfile.params.profileIdHelp",
              )}
            />
          </SelectTrigger>
          <SelectContent>
            {profiles.length === 0 && (
              <div className="px-2 py-1.5 text-sm text-muted-foreground">
                No profiles available
              </div>
            )}
            {profiles.map((profile) => (
              <SelectItem key={profile.id} value={profile.id}>
                {profile.name || profile.id}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cleanup Mode */}
      <div className="space-y-2">
        <Label className="text-xs">
          {t("automation.nodes.closeProfile.params.cleanupMode")}
          <span className="text-destructive"> *</span>
        </Label>
        <RadioGroup
          value={value.cleanupMode}
          onValueChange={(v) =>
            handleCleanupModeChange(v as "cookies" | "full")
          }
          className="space-y-2"
        >
          <div className="flex items-start space-x-2 rounded-md border border-border p-3">
            <RadioGroupItem value="cookies" id="cookies" className="mt-0.5" />
            <Label
              htmlFor="cookies"
              className="flex-1 cursor-pointer font-normal"
            >
              <div className="font-medium text-sm">
                {t("automation.nodes.closeProfile.cleanupMode.cookies")}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("automation.nodes.closeProfile.cleanupMode.cookies")}
              </p>
            </Label>
          </div>
          <div className="flex items-start space-x-2 rounded-md border border-border p-3">
            <RadioGroupItem value="full" id="full" className="mt-0.5" />
            <Label htmlFor="full" className="flex-1 cursor-pointer font-normal">
              <div className="font-medium text-sm text-destructive">
                {t("automation.nodes.closeProfile.cleanupMode.full")}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("automation.nodes.closeProfile.cleanupMode.full")}
              </p>
            </Label>
          </div>
        </RadioGroup>
      </div>

      {/* Warning for full mode */}
      {value.cleanupMode === "full" && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            {t("automation.nodes.closeProfile.cleanupMode.full")}
            {" — "}
            This action is destructive and irreversible. All profile data
            including passwords, bookmarks, and configuration will be
            permanently deleted.
          </AlertDescription>
        </Alert>
      )}

      <ValidationBadge warnings={variableWarnings} />
    </div>
  );
}
