"use client";

export type SyncStatus =
  | "disabled"
  | "syncing"
  | "synced"
  | "error"
  | "waiting";

export function getSyncStatusDot(
  item: { sync_enabled?: boolean; last_sync?: number },
  liveStatus: SyncStatus | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): { color: string; tooltip: string; animate: boolean } {
  const status = liveStatus ?? (item.sync_enabled ? "synced" : "disabled");

  switch (status) {
    case "syncing":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipSyncing"),
        animate: true,
      };
    case "synced":
      return {
        color: "bg-success",
        tooltip: item.last_sync
          ? t("profileTable.syncTooltipSyncedAt", {
              time: new Date(item.last_sync * 1000).toLocaleString(),
            })
          : t("profileTable.syncTooltipSynced"),
        animate: false,
      };
    case "waiting":
      return {
        color: "bg-warning",
        tooltip: t("profileTable.syncTooltipWaiting"),
        animate: false,
      };
    case "error":
      return {
        color: "bg-destructive",
        tooltip: t("profileTable.syncTooltipError"),
        animate: false,
      };
    default:
      return {
        color: "bg-muted-foreground",
        tooltip: t("profileTable.syncTooltipNotSynced"),
        animate: false,
      };
  }
}
