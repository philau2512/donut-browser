"use client";

// ScriptReportDialog — Phase 4 (resource allocation plan).
// Renders the ScriptReport view model. Pure display — does NOT mutate runtime state.

import { useTranslation } from "react-i18next";
import { LuCircleCheck, LuCircleX } from "react-icons/lu";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type {
  ProfileSummaryMessage,
  ScriptReport,
} from "@/types/automation-report-types";

interface ScriptReportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  report: ScriptReport | null;
}

export function ScriptReportDialog({
  open,
  onOpenChange,
  report,
}: ScriptReportDialogProps) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {t("automation.report.script.title", "Script Report")}
            {report && <StatusBadge status={report.status} />}
          </DialogTitle>
        </DialogHeader>

        {!report ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground text-sm">
            {t("automation.report.script.empty", "No run data yet.")}
          </div>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto pr-1">
            {/* Timing summary */}
            <div className="grid grid-cols-3 gap-3 text-sm">
              <StatCard
                label={t("automation.report.script.startedAt", "Started")}
                value={new Date(report.startedAt).toLocaleTimeString()}
              />
              <StatCard
                label={t("automation.report.script.duration", "Duration")}
                value={formatDuration(report.durationMs)}
              />
              <StatCard
                label={t("automation.report.script.finishedAt", "Finished")}
                value={
                  report.finishedAt
                    ? new Date(report.finishedAt).toLocaleTimeString()
                    : "—"
                }
              />
            </div>

            {/* Profile stats */}
            <section>
              <SectionTitle>
                {t("automation.report.script.profileStats", "Profiles")}
              </SectionTitle>
              <div className="grid grid-cols-5 gap-2 text-xs">
                <CountChip
                  label={t("automation.report.script.total", "Total")}
                  count={report.profileStats.total}
                />
                <CountChip
                  label={t("automation.report.script.running", "Running")}
                  count={report.profileStats.running}
                  color="text-blue-400"
                />
                <CountChip
                  label={t("automation.report.script.success", "Success")}
                  count={report.profileStats.success}
                  color="text-emerald-400"
                />
                <CountChip
                  label={t("automation.report.script.failed", "Failed")}
                  count={report.profileStats.failed}
                  color="text-destructive"
                />
                <CountChip
                  label={t("automation.report.script.cancelled", "Cancelled")}
                  count={report.profileStats.cancelled}
                  color="text-muted-foreground"
                />
              </div>
            </section>

            {/* Node stats */}
            <section>
              <SectionTitle>
                {t("automation.report.script.nodeStats", "Nodes")}
              </SectionTitle>
              <div className="grid grid-cols-4 gap-2 text-xs">
                <CountChip
                  label={t("automation.report.script.total", "Total")}
                  count={report.nodeStats.total}
                />
                <CountChip
                  label={t("automation.report.script.success", "Success")}
                  count={report.nodeStats.success}
                  color="text-emerald-400"
                />
                <CountChip
                  label={t("automation.report.script.failed", "Failed")}
                  count={report.nodeStats.failed}
                  color="text-destructive"
                />
                <CountChip
                  label={t("automation.report.script.skipped", "Skipped")}
                  count={report.nodeStats.skipped}
                  color="text-amber-400"
                />
              </div>
            </section>

            {/* Profile messages */}
            {report.messages.length > 0 && (
              <section>
                <SectionTitle>
                  {t("automation.report.script.messages", "Profile Messages")}
                </SectionTitle>
                <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto">
                  {report.messages.map((msg, i) => (
                    <MessageRow key={`${msg.profileId}-${i}`} msg={msg} />
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: ScriptReport["status"] }) {
  const map = {
    running: {
      label: "Running",
      className: "bg-blue-500/20 text-blue-400 border-blue-500/30",
    },
    success: {
      label: "Success",
      className: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    },
    failed: {
      label: "Failed",
      className: "bg-destructive/20 text-destructive border-destructive/30",
    },
    cancelled: {
      label: "Cancelled",
      className: "bg-muted text-muted-foreground",
    },
  } as const;
  const { label, className } = map[status] ?? map.running;
  return (
    <Badge variant="outline" className={cn("text-xs", className)}>
      {label}
    </Badge>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold">{value}</p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h4 className="mb-2 text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
      {children}
    </h4>
  );
}

function CountChip({
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
          "text-lg font-bold tabular-nums",
          color ?? "text-foreground",
        )}
      >
        {count}
      </p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}

function MessageRow({ msg }: { msg: ProfileSummaryMessage }) {
  const isSuccess = msg.status === "success";
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        isSuccess
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-destructive/20 bg-destructive/5",
      )}
    >
      {isSuccess ? (
        <LuCircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-400" />
      ) : (
        <LuCircleX className="mt-0.5 size-3.5 shrink-0 text-destructive" />
      )}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-foreground">{msg.profileId}</span>
        {msg.reasonCode && (
          <Badge variant="outline" className="ml-2 text-[9px] px-1">
            {msg.reasonCode}
          </Badge>
        )}
        {msg.message && (
          <p className="mt-0.5 text-muted-foreground break-words">
            {msg.message}
          </p>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}
