"use client";

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ConfirmationDialog,
  LoadingButton,
  MultipleSelector,
  type MultipleSelectorRef,
} from "@/components/shared";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import type { BrowserProfile } from "@/types";
import { RippleButton } from "../ui/ripple";

interface TagsAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
}

export function TagsAssignmentDialog({
  isOpen,
  onClose,
  selectedProfiles,
  onAssignmentComplete,
  profiles = [],
}: TagsAssignmentDialogProps) {
  const { t } = useTranslation();
  const [allTags, setAllTags] = useState<string[]>([]);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tagToDelete, setTagToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const isInitializedRef = useRef(false);
  const selectorRef = useRef<MultipleSelectorRef>(null);

  const loadTags = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const tagsList = await invoke<string[]>("get_all_tags");
      setAllTags(tagsList);
    } catch (err) {
      console.error("Failed to load tags:", err);
      setError(err instanceof Error ? err.message : "Failed to load tags");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleAssign = useCallback(async () => {
    setIsAssigning(true);
    setError(null);
    try {
      // Pick up any tag currently being typed but not confirmed via Enter
      const currentInputText = selectorRef.current?.input?.value?.trim() || "";
      let submittedTags = [...selectedTags];
      if (currentInputText) {
        const extraTags = currentInputText
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0);
        submittedTags = Array.from(new Set([...submittedTags, ...extraTags]));
      }

      await Promise.all(
        selectedProfiles.map(async (profileId) => {
          const profile = profiles.find((p) => p.id === profileId);
          if (!profile) return;

          let newTags = [...submittedTags];
          if (selectedProfiles.length > 1) {
            // Append mode: combine existing tags with new tags
            const existingTags = profile.tags ?? [];
            const combined = [...existingTags, ...submittedTags];
            newTags = Array.from(new Set(combined));
          }

          await invoke("update_profile_tags", {
            profileId,
            tags: newTags,
          });
        }),
      );

      toast.success(
        t("tags.assignSuccess", {
          count: selectedProfiles.length,
        }),
      );
      onAssignmentComplete();
      onClose();
    } catch (err) {
      console.error("Failed to assign tags:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : t("tags.failed", { error: String(err) });
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsAssigning(false);
    }
  }, [
    selectedProfiles,
    selectedTags,
    profiles,
    onAssignmentComplete,
    onClose,
    t,
  ]);

  const handleDeleteTag = useCallback(async () => {
    if (!tagToDelete) return;
    setIsDeleting(true);
    try {
      await invoke("delete_tag", { tag: tagToDelete });
      toast.success(t("tags.deleteSuccess", { tag: tagToDelete }));
      setTagToDelete(null);
      void loadTags();
    } catch (err) {
      console.error("Failed to delete tag:", err);
      toast.error(
        err instanceof Error
          ? err.message
          : t("tags.deleteFailed", { error: String(err) }),
      );
    } finally {
      setIsDeleting(false);
    }
  }, [tagToDelete, loadTags, t]);

  useEffect(() => {
    if (isOpen) {
      if (!isInitializedRef.current) {
        void loadTags();
        setError(null);

        // Pre-populate tags if editing a single profile
        if (selectedProfiles.length === 1) {
          const profile = profiles.find((p) => p.id === selectedProfiles[0]);
          setSelectedTags(profile?.tags ?? []);
        } else {
          setSelectedTags([]);
        }
        isInitializedRef.current = true;
      }
    } else {
      isInitializedRef.current = false;
    }
  }, [isOpen, selectedProfiles, profiles, loadTags]);

  const valueOptions = selectedTags.map((t) => ({ value: t, label: t }));
  const allOptions = allTags.map((t) => ({ value: t, label: t }));

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md !overflow-visible">
        <DialogHeader>
          <DialogTitle>{t("tags.title")}</DialogTitle>
          <DialogDescription>
            {selectedProfiles.length === 1
              ? t("tags.description_one")
              : t("tags.description_other", {
                  count: selectedProfiles.length,
                })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t("tags.selectedProfilesLabel")}</Label>
            <div className="max-h-[min(8rem,20vh)] overflow-y-auto rounded-md bg-muted p-3">
              <ul className="space-y-1 text-sm">
                {selectedProfiles.map((profileId) => {
                  const profile = profiles.find((p) => p.id === profileId);
                  const displayName = profile ? profile.name : profileId;
                  return (
                    <li key={profileId} className="truncate">
                      • {displayName}
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t("tags.assignTagsLabel")}</Label>
            {isLoading ? (
              <div className="text-sm text-muted-foreground">
                {t("common.buttons.loading")}
              </div>
            ) : (
              <MultipleSelector
                ref={selectorRef}
                value={valueOptions}
                options={allOptions}
                onChange={(opts) => {
                  setSelectedTags(opts.map((o) => o.value));
                }}
                onDeleteOption={(opt) => {
                  setTagToDelete(opt.value);
                }}
                placeholder={t("tags.placeholder")}
                creatable
                className="w-full bg-background border border-border rounded-md"
                badgeClassName="shrink-0"
              />
            )}
          </div>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <RippleButton
            variant="destructive"
            onClick={onClose}
            disabled={isAssigning}
            className="bg-destructive hover:bg-destructive/90 text-white font-medium rounded-md"
          >
            {t("common.buttons.cancel")}
          </RippleButton>
          <LoadingButton
            isLoading={isAssigning}
            onClick={() => void handleAssign()}
            disabled={isLoading}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md"
          >
            {t("tags.assignButton")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>

      <ConfirmationDialog
        isOpen={tagToDelete !== null}
        onClose={() => setTagToDelete(null)}
        onConfirm={handleDeleteTag}
        title={t("tags.deleteConfirmTitle")}
        description={t("tags.deleteConfirmDesc", { tag: tagToDelete ?? "" })}
        confirmButtonText={t("common.buttons.delete")}
        confirmButtonVariant="destructive"
        isLoading={isDeleting}
      />
    </Dialog>
  );
}
