"use client";

import { invoke } from "@tauri-apps/api/core";
import React from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { BrowserProfile } from "@/types";

interface NoteCellProps {
  profile: BrowserProfile;
  isDisabled: boolean;
  noteOverrides: Record<string, string | null>;
  openNoteEditorFor: string | null;
  setOpenNoteEditorFor: React.Dispatch<React.SetStateAction<string | null>>;
  setNoteOverrides: React.Dispatch<
    React.SetStateAction<Record<string, string | null>>
  >;
}

export const NoteCell = React.memo<NoteCellProps>(
  ({
    profile,
    isDisabled,
    noteOverrides,
    openNoteEditorFor,
    setOpenNoteEditorFor,
    setNoteOverrides,
  }) => {
    const { t } = useTranslation();
    const isOpen = openNoteEditorFor === profile.id;

    const effectiveNote: string | null = Object.hasOwn(
      noteOverrides,
      profile.id,
    )
      ? noteOverrides[profile.id]
      : (profile.note ?? null);

    const onNoteChange = React.useCallback(
      async (newNote: string | null) => {
        const trimmedNote = newNote?.trim() ?? null;
        setNoteOverrides((prev) => ({ ...prev, [profile.id]: trimmedNote }));
        try {
          await invoke<BrowserProfile>("update_profile_note", {
            profileId: profile.id,
            note: trimmedNote,
          });
        } catch (error) {
          console.error("Failed to update note:", error);
        }
      },
      [profile.id, setNoteOverrides],
    );

    const textareaRef = React.useRef<HTMLTextAreaElement | null>(null);
    const [noteValue, setNoteValue] = React.useState(effectiveNote ?? "");

    // Sync local state when dialog opens or effective note changes
    React.useEffect(() => {
      if (isOpen) {
        setNoteValue(effectiveNote ?? "");
      }
    }, [isOpen, effectiveNote]);

    // Auto-resize textarea when dialog opens
    React.useEffect(() => {
      if (isOpen && textareaRef.current) {
        const textarea = textareaRef.current;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
        // Focus and move cursor to end
        textarea.focus();
        const len = textarea.value.length;
        textarea.setSelectionRange(len, len);
      }
    }, [isOpen]);

    const handleSave = React.useCallback(() => {
      void onNoteChange(noteValue);
      setOpenNoteEditorFor(null);
    }, [onNoteChange, noteValue, setOpenNoteEditorFor]);

    const handleCancel = React.useCallback(() => {
      setNoteValue(effectiveNote ?? "");
      setOpenNoteEditorFor(null);
    }, [effectiveNote, setOpenNoteEditorFor]);

    const handleTextareaChange = React.useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        setNoteValue(e.target.value);
        const textarea = e.target;
        textarea.style.height = "auto";
        textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
      },
      [],
    );

    const displayNote = effectiveNote ?? "";
    const showTooltip = displayNote.length > 0;

    return (
      <>
        <div className="min-h-6 w-full">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className={cn(
                  "flex min-h-6 w-full min-w-0 items-center rounded border-none bg-transparent px-2 py-1 text-left",
                  isDisabled
                    ? "cursor-not-allowed opacity-60"
                    : "cursor-pointer hover:bg-accent/50",
                  !effectiveNote && "justify-center",
                )}
                onClick={() => {
                  if (!isDisabled) {
                    setOpenNoteEditorFor(profile.id);
                  }
                }}
              >
                <span
                  className={cn(
                    "block w-full truncate text-sm",
                    !effectiveNote && "text-muted-foreground text-center",
                  )}
                >
                  {effectiveNote ? displayNote : "---"}
                </span>
              </button>
            </TooltipTrigger>
            {showTooltip && (
              <TooltipContent className="max-w-[320px]">
                <p className="wrap-break-word whitespace-pre-wrap">
                  {effectiveNote}
                </p>
              </TooltipContent>
            )}
          </Tooltip>
        </div>

        <Dialog
          open={isOpen}
          onOpenChange={(open) => {
            if (!open) handleCancel();
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{t("profileTable.noteHeader")}</DialogTitle>
            </DialogHeader>
            <textarea
              ref={textareaRef}
              value={noteValue}
              onChange={handleTextareaChange}
              placeholder={t("profiles.note.placeholder")}
              className="min-h-[120px] w-full resize-none rounded-md border bg-secondary/50 px-3 py-2 text-sm focus:ring-0 focus:outline-none"
              rows={4}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSave();
                }
              }}
            />
            <DialogFooter>
              <Button onClick={handleSave} className="cursor-pointer">
                {t("common.buttons.save")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  },
);

NoteCell.displayName = "NoteCell";
