"use client";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import * as React from "react";
import { LuPuzzle } from "react-icons/lu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile } from "@/types";

interface ExtensionsSectionInlineProps {
  profile: BrowserProfile;
  isDisabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

type ExtensionGroupOption = { id: string; name: string };

export function ExtensionsSectionInline({
  profile,
  isDisabled,
  t,
}: ExtensionsSectionInlineProps) {
  const [groups, setGroups] = React.useState<ExtensionGroupOption[]>([]);
  const [groupId, setGroupId] = React.useState<string | null>(
    profile.extension_group_id ?? null,
  );
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    setGroupId(profile.extension_group_id ?? null);
  }, [profile.extension_group_id]);

  React.useEffect(() => {
    let mounted = true;
    let unlisten: (() => void) | undefined;
    const load = async () => {
      try {
        const data = await invoke<ExtensionGroupOption[]>(
          "list_extension_groups",
        );
        if (mounted) setGroups(data);
      } catch (e) {
        if (mounted) setError(translateBackendError(t as never, e));
      }
    };
    void load();
    void listen("extensions-changed", () => {
      void load();
    }).then((u) => {
      if (mounted) unlisten = u;
      else u();
    });
    return () => {
      mounted = false;
      unlisten?.();
    };
  }, [t]);

  const onChange = async (value: string) => {
    const next = value === "__none__" ? null : value;
    setIsSaving(true);
    setError(null);
    try {
      await invoke("assign_extension_group_to_profile", {
        profileId: profile.id,
        extensionGroupId: next,
      });
      setGroupId(next);
    } catch (e) {
      setError(translateBackendError(t as never, e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuPuzzle className="size-4" />
        {t("profileInfo.sections.extensions")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.extensions")}
      </p>
      <div className="flex items-center gap-2">
        <span className="w-16 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("profileInfo.fields.extensionGroup")}
        </span>
        <Select
          value={groupId ?? "__none__"}
          disabled={isDisabled || isSaving}
          onValueChange={(v) => {
            void onChange(v);
          }}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("profileInfo.values.none")}
            </SelectItem>
            {groups.map((g) => (
              <SelectItem key={g.id} value={g.id}>
                {g.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
