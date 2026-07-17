"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { LuArrowRight, LuCalendar } from "react-icons/lu";
import { MultipleSelector, type Option } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  EMPTY_PROFILE_FILTER,
  PROFILE_FILTER_STATUS_ALL,
  PROFILE_FILTER_STATUS_NONE,
  type ProfileFilterCriteria,
} from "@/lib/profile-filter";
import type { GroupWithCount, ProfileStatusConfig } from "@/types";

interface ProfileFilterDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: ProfileFilterCriteria;
  onApply: (criteria: ProfileFilterCriteria) => void;
  folders: GroupWithCount[];
}

export function ProfileFilterDialog({
  open,
  onOpenChange,
  value,
  onApply,
  folders,
}: ProfileFilterDialogProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<ProfileFilterCriteria>(value);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<ProfileStatusConfig[]>([]);

  useEffect(() => {
    if (!open) return;
    setDraft(value);

    void (async () => {
      try {
        const [tags, profileStatuses] = await Promise.all([
          invoke<string[]>("get_all_tags"),
          invoke<ProfileStatusConfig[]>("get_profile_statuses"),
        ]);
        setAllTags(tags);
        setStatuses(profileStatuses);
      } catch (error) {
        console.error("Failed to load filter options:", error);
      }
    })();
  }, [open, value]);

  const folderOptions = useMemo<Option[]>(
    () => folders.map((folder) => ({ value: folder.id, label: folder.name })),
    [folders],
  );

  const tagOptions = useMemo<Option[]>(
    () => allTags.map((tag) => ({ value: tag, label: tag })),
    [allTags],
  );

  const selectedFolders = useMemo<Option[]>(
    () =>
      draft.folderIds.map((id) => {
        const match = folderOptions.find((opt) => opt.value === id);
        return match ?? { value: id, label: id };
      }),
    [draft.folderIds, folderOptions],
  );

  const selectedTags = useMemo<Option[]>(
    () => draft.tags.map((tag) => ({ value: tag, label: tag })),
    [draft.tags],
  );

  const handleReset = () => {
    setDraft(EMPTY_PROFILE_FILTER);
  };

  const handleApply = () => {
    onApply(draft);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 !overflow-visible p-0 sm:max-w-md">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="text-base font-semibold text-blue-500">
            {t("profiles.filter.title")}
          </DialogTitle>
        </DialogHeader>

        <div className="max-h-[min(70vh,640px)] space-y-4 overflow-x-hidden overflow-y-auto px-5 py-4">
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("profiles.filter.uuid")}
            </Label>
            <Textarea
              value={draft.uuidsText}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, uuidsText: e.target.value }))
              }
              placeholder={t("profiles.filter.uuidPlaceholder")}
              className="min-h-24 resize-y bg-muted/40 text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("profiles.filter.name")}
            </Label>
            <Textarea
              value={draft.namesText}
              onChange={(e) =>
                setDraft((prev) => ({ ...prev, namesText: e.target.value }))
              }
              placeholder={t("profiles.filter.namePlaceholder")}
              className="min-h-24 resize-y bg-muted/40 text-sm"
            />
          </div>

          <div className="flex items-center gap-3 py-1">
            <Switch
              id="filter-running-only"
              checked={draft.runningOnly}
              onCheckedChange={(checked) =>
                setDraft((prev) => ({ ...prev, runningOnly: checked }))
              }
            />
            <Label
              htmlFor="filter-running-only"
              className="cursor-pointer text-sm font-medium"
            >
              {t("profiles.filter.runningOnly")}
            </Label>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("profiles.filter.folder")}
            </Label>
            <MultipleSelector
              value={selectedFolders}
              options={folderOptions}
              onChange={(opts) =>
                setDraft((prev) => ({
                  ...prev,
                  folderIds: opts.map((opt) => opt.value),
                }))
              }
              placeholder={t("profiles.filter.selectPlaceholder")}
              hidePlaceholderWhenSelected
              className="w-full rounded-md border border-border bg-muted/40"
              badgeClassName="shrink-0 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
              emptyIndicator={
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {t("profiles.filter.noFolders")}
                </p>
              }
            />
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("profiles.filter.tag")}
            </Label>
            <MultipleSelector
              value={selectedTags}
              options={tagOptions}
              onChange={(opts) =>
                setDraft((prev) => ({
                  ...prev,
                  tags: opts.map((opt) => opt.value),
                }))
              }
              placeholder={t("profiles.filter.selectPlaceholder")}
              hidePlaceholderWhenSelected
              className="w-full rounded-md border border-border bg-muted/40"
              badgeClassName="shrink-0 bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
              emptyIndicator={
                <p className="py-2 text-center text-sm text-muted-foreground">
                  {t("profiles.filter.noTags")}
                </p>
              }
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("profiles.filter.status")}
              </Label>
              <Select
                value={draft.status}
                onValueChange={(status) =>
                  setDraft((prev) => ({ ...prev, status }))
                }
              >
                <SelectTrigger className="h-9 w-full bg-muted/40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={PROFILE_FILTER_STATUS_ALL}>
                    {t("profiles.filter.statusAll")}
                  </SelectItem>
                  <SelectItem value={PROFILE_FILTER_STATUS_NONE}>
                    {t("profiles.status.noStatus")}
                  </SelectItem>
                  {statuses.map((status) => (
                    <SelectItem key={status.label} value={status.label}>
                      {status.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("profiles.filter.createdDate")}
              </Label>
              <div className="flex items-center gap-1.5 rounded-md border border-input bg-muted/40 px-2 py-1">
                <input
                  type="date"
                  value={draft.createdFrom}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      createdFrom: e.target.value,
                    }))
                  }
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
                  aria-label={t("profiles.filter.startDate")}
                />
                <LuArrowRight className="size-3 shrink-0 text-muted-foreground" />
                <input
                  type="date"
                  value={draft.createdTo}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      createdTo: e.target.value,
                    }))
                  }
                  className="min-w-0 flex-1 bg-transparent text-xs text-foreground outline-none [color-scheme:dark]"
                  aria-label={t("profiles.filter.endDate")}
                />
                <LuCalendar className="size-3.5 shrink-0 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border px-5 py-4 sm:justify-end">
          <Button
            type="button"
            onClick={handleReset}
            className="h-9 min-w-20 bg-red-500 font-medium text-white hover:bg-red-600"
          >
            {t("common.buttons.reset")}
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            className="h-9 min-w-20 bg-blue-600 font-medium text-white hover:bg-blue-700"
          >
            {t("profiles.filter.apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
