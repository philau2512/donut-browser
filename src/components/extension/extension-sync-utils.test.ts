import { describe, expect, it } from "vitest";
import { getSyncStatusDot } from "./extension-sync-utils";

describe("extension-sync-utils (EX-04 smoke helper)", () => {
  const t = (key: string) => key;

  it("maps live and default statuses", () => {
    expect(getSyncStatusDot({ sync_enabled: false }, undefined, t).color).toBe(
      "bg-muted-foreground",
    );
    expect(getSyncStatusDot({ sync_enabled: true }, "syncing", t).animate).toBe(
      true,
    );
    expect(getSyncStatusDot({ sync_enabled: true }, "error", t).color).toBe(
      "bg-destructive",
    );
    expect(
      getSyncStatusDot({ sync_enabled: true, last_sync: 1 }, "synced", t)
        .tooltip,
    ).toBe("profileTable.syncTooltipSyncedAt");
  });
});
