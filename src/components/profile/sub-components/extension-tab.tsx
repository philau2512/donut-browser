"use client";

import { useTranslation } from "react-i18next";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface ExtensionTabProps {
  extensionGroups: any[];
  selectedExtensionGroupId: string | undefined;
  setSelectedExtensionGroupId: (id: string | undefined) => void;
}

export function ExtensionTab({
  extensionGroups,
  selectedExtensionGroupId,
  setSelectedExtensionGroupId,
}: ExtensionTabProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-4">
      <div className="space-y-1 pb-2">
        <h3 className="text-base font-bold">Extension Group</h3>
        <p className="text-xs text-muted-foreground">
          Select an extension group to automatically load required extensions
          into the profile.
        </p>
      </div>
      {extensionGroups.length > 0 ? (
        <div className="space-y-2">
          <Label htmlFor="ext-group-sel">
            {t("extensions.extensionGroup")}
          </Label>
          <Select
            value={selectedExtensionGroupId ?? "none"}
            onValueChange={(val) => {
              setSelectedExtensionGroupId(val === "none" ? undefined : val);
            }}
          >
            <SelectTrigger id="ext-group-sel" className="h-9">
              <SelectValue placeholder={t("profileInfo.values.none")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {t("profileInfo.values.none")}
              </SelectItem>
              {extensionGroups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name} ({g.extension_ids.length})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
          No extension groups created yet. Create groups in the Extension
          settings page to use this feature.
        </div>
      )}
    </div>
  );
}
