"use client";

// ResourceReportDialog — Phase 4 (resource allocation plan).
// Renders the ResourceReport view model. Pure display — does NOT mutate runtime state.
// Sensitive resource values (lines, proxy strings) are masked by default.

import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ResourceReport,
  ResourceReportEntry,
} from "@/types/automation-report-types";

interface ResourceReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ResourceReport | null;
}

export function ResourceReportDialog({
  open,
  onOpenChange,
  report,
}: ResourceReportDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>
            {t("automation.report.resource.title", "Resource Report")}
          </DialogTitle>
        </DialogHeader>

        {!report || report.resources.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {t("automation.report.resource.empty", "No resource data yet.")}
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            {report.resources.map((entry) => (
              <ResourceEntryCard key={entry.resourceId} entry={entry} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ResourceEntryCard({ entry }: { entry: ResourceReportEntry }) {
  const { t } = useTranslation();

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">{entry.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {entry.type}
          </Badge>
        </div>
        <span className="text-[10px] text-muted-foreground font-mono">
          {entry.resourceId.slice(0, 12)}…
        </span>
      </div>

      {/* Item status counts */}
      <div className="grid grid-cols-6 gap-1.5">
        <ItemCountChip
          label={t("automation.report.resource.total", "Total")}
          count={entry.totalItems}
        />
        <ItemCountChip
          label={t("automation.report.resource.available", "Avail")}
          count={entry.availableItems}
          color="text-emerald-400"
        />
        <ItemCountChip
          label={t("automation.report.resource.leased", "Leased")}
          count={entry.leasedItems}
          color="text-blue-400"
        />
        <ItemCountChip
          label={t("automation.report.resource.cooldown", "Cool")}
          count={entry.cooldownItems}
          color="text-amber-400"
        />
        <ItemCountChip
          label={t("automation.report.resource.exhausted", "Exhaust")}
          count={entry.exhaustedItems}
          color="text-orange-400"
        />
        <ItemCountChip
          label={t("automation.report.resource.disabled", "Disabled")}
          count={entry.disabledItems}
          color="text-destructive"
        />
      </div>

      {/* Usage quota */}
      <div className="flex gap-4 text-xs text-muted-foreground">
        <span>
          {t("automation.report.resource.successUsage", "Success usage")}:{" "}
          <span className="text-emerald-400 font-semibold">
            {entry.successUsage}
          </span>
        </span>
        <span>
          {t("automation.report.resource.failUsage", "Fail usage")}:{" "}
          <span className="text-destructive font-semibold">
            {entry.failUsage}
          </span>
        </span>
      </div>

      {/* Active leases */}
      {entry.activeLeases.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("automation.report.resource.activeLeases", "Active leases")}
          </p>
          <div className="flex flex-col gap-1">
            {entry.activeLeases.map((lease) => (
              <div
                key={`${lease.itemId}-${lease.profileId}`}
                className="flex items-center gap-2 rounded-md border border-blue-500/20 bg-blue-500/5 px-2 py-1 text-xs"
              >
                {/* Item ID masked — show only hash prefix */}
                <span className="font-mono text-muted-foreground">
                  {lease.itemId.slice(0, 8)}…
                </span>
                <span className="text-blue-400 font-medium">
                  {lease.profileId}
                </span>
                <span className="ml-auto text-muted-foreground">
                  {new Date(lease.leasedAt).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Write stats (output resources) */}
      {entry.writes && entry.writes.total > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1.5">
            {t("automation.report.resource.writes", "Writes")}
          </p>
          <div className="flex gap-4 text-xs">
            <span>
              {t("automation.report.resource.writesTotal", "Total")}:{" "}
              <span className="font-semibold">{entry.writes.total}</span>
            </span>
            <span className="text-emerald-400">
              {t("automation.report.resource.writesSuccess", "OK")}:{" "}
              {entry.writes.success}
            </span>
            <span className="text-destructive">
              {t("automation.report.resource.writesFailed", "Failed")}:{" "}
              {entry.writes.failed}
            </span>
            {entry.writes.lastError && (
              <span
                className="text-destructive truncate max-w-xs"
                title={entry.writes.lastError}
              >
                {entry.writes.lastError}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ItemCountChip({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-2 py-1.5 text-center">
      <p
        className={cn(
          "text-base font-bold tabular-nums",
          color ?? "text-foreground",
        )}
      >
        {count}
      </p>
      <p className="text-[9px] text-muted-foreground">{label}</p>
    </div>
  );
}
