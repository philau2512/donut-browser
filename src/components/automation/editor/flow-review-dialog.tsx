"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { LuExternalLink, LuMousePointerClick } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FlowReviewItem } from "@/lib/automation/flow-review";

interface FlowReviewDialogProps {
  open: boolean;
  flowName: string;
  items: FlowReviewItem[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function FlowReviewDialog({
  open,
  flowName,
  items,
  onCancel,
  onConfirm,
}: FlowReviewDialogProps) {
  const { t } = useTranslation();
  const urls = items.filter((item) => item.type === "url");
  const selectors = items.filter((item) => item.type === "selector");
  const groupedUrls = useMemo(() => {
    const groups = new Map<string, FlowReviewItem[]>();
    for (const item of urls) {
      const key = item.host ?? t("automation.review.templatedOrInvalidHost");
      groups.set(key, [...(groups.get(key) ?? []), item]);
    }
    return [...groups.entries()];
  }, [t, urls]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {t("automation.review.title", { name: flowName })}
          </DialogTitle>
          <DialogDescription>
            {t("automation.review.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          <section className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <LuExternalLink className="size-4 text-amber-600" />
              {t("automation.review.urls")}
            </div>
            {groupedUrls.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("automation.review.noUrls")}
              </p>
            ) : (
              groupedUrls.map(([host, hostItems]) => (
                <div
                  key={host}
                  className="space-y-1 rounded bg-background/60 p-2"
                >
                  <p className="text-xs font-medium">{host}</p>
                  <ul className="space-y-1 text-xs text-muted-foreground">
                    {hostItems.map((item) => (
                      <li
                        key={`${item.nodeId}-${item.value}`}
                        className="break-all"
                      >
                        <span className="font-mono">{item.nodeId}</span>:{" "}
                        {item.value}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </section>

          <section className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <LuMousePointerClick className="size-4 text-muted-foreground" />
              {t("automation.review.selectors")}
            </div>
            {selectors.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("automation.review.noSelectors")}
              </p>
            ) : (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {selectors.map((item) => (
                  <li
                    key={`${item.nodeId}-${item.value}`}
                    className="break-all"
                  >
                    <span className="font-mono">{item.nodeId}</span>:{" "}
                    {item.value}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("common.buttons.cancel")}
          </Button>
          <Button type="button" onClick={onConfirm}>
            {t("automation.review.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
