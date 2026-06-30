"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AutomationCanvasNode } from "./serialize";

interface NodeCommentDialogProps {
  node: AutomationCanvasNode | null;
  onClose: (comment: string) => void;
}

export function NodeCommentDialog({ node, onClose }: NodeCommentDialogProps) {
  const { t } = useTranslation();
  const [comment, setComment] = useState(node?.data.comment || "");

  if (!node) return null;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      onClose(comment);
    }
  };

  return (
    <Dialog open={true} onOpenChange={handleOpenChange}>
      <DialogContent
        className="max-w-sm flex flex-col h-[260px] p-6"
        onPointerDownOutside={(e) => {
          // Allow clicks on portal overlays to not break dismiss flow
          const target = e.target as HTMLElement;
          if (target.closest("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="button"
          onClick={() => setComment("")}
          className="absolute top-4 right-12 cursor-pointer rounded-xs opacity-70 transition-opacity hover:opacity-100 text-xs font-semibold px-1 flex items-center justify-center h-5 hover:text-foreground text-muted-foreground"
          title="Clear comment"
        >
          C
        </button>
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-sm font-semibold select-none">
            {t("automation.editor.comment.title", "Add comment")}
          </DialogTitle>
        </DialogHeader>

        <div className="border-t border-border -mx-6 mt-1" />

        <div className="flex-1 flex flex-col min-h-0">
          <Textarea
            value={comment}
            onChange={(e) => setComment(e.target.value.slice(0, 255))}
            placeholder={t(
              "automation.editor.comment.placeholder",
              "Type a comment...",
            )}
            className="flex-1 resize-none text-xs border-0 focus-visible:ring-0 focus-visible:ring-offset-0 p-0 mt-3 bg-transparent outline-hidden shadow-none min-h-0"
          />
          <div className="text-[10px] text-muted-foreground text-right mt-1 select-none font-medium">
            {comment.length}/255{" "}
            {t("automation.editor.comment.characters", "characters")}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
