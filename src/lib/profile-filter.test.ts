import { describe, expect, it } from "vitest";
import type { BrowserProfile } from "@/types";
import {
  applyProfileFilter,
  countActiveProfileFilters,
  EMPTY_PROFILE_FILTER,
  PROFILE_FILTER_STATUS_NONE,
  type ProfileFilterCriteria,
  parseFilterLines,
} from "./profile-filter";

function profile(
  partial: Partial<BrowserProfile> & { id: string; name: string },
): BrowserProfile {
  return {
    browser: "wayfern",
    version: "1.0.0",
    release_type: "stable",
    tags: [],
    proxy_bypass_rules: [],
    ephemeral: false,
    password_protected: false,
    clear_on_close: false,
    sync_mode: "disabled",
    ...partial,
  } as BrowserProfile;
}

describe("profile-filter (PR-18 smoke)", () => {
  it("parses multi-line and comma tokens", () => {
    expect(parseFilterLines("a\nb, c")).toEqual(["a", "b", "c"]);
    expect(parseFilterLines("  \n")).toEqual([]);
  });

  it("counts active criteria", () => {
    expect(countActiveProfileFilters(EMPTY_PROFILE_FILTER)).toBe(0);
    const active: ProfileFilterCriteria = {
      ...EMPTY_PROFILE_FILTER,
      namesText: "alice",
      runningOnly: true,
      tags: ["us"],
    };
    expect(countActiveProfileFilters(active)).toBe(3);
  });

  it("filters by name, tag, folder, status, running", () => {
    const profiles = [
      profile({
        id: "1",
        name: "Alice US",
        tags: ["us"],
        group_id: "g1",
        profile_status: "Ready",
        created_at: 1_700_000_000,
      }),
      profile({
        id: "2",
        name: "Bob EU",
        tags: ["eu"],
        group_id: "g2",
        profile_status: undefined,
        created_at: 1_700_000_100,
      }),
    ];
    const running = new Set(["1"]);

    const byName = applyProfileFilter(
      profiles,
      { ...EMPTY_PROFILE_FILTER, namesText: "alice" },
      running,
    );
    expect(byName.map((p) => p.id)).toEqual(["1"]);

    const byTag = applyProfileFilter(
      profiles,
      { ...EMPTY_PROFILE_FILTER, tags: ["eu"] },
      running,
    );
    expect(byTag.map((p) => p.id)).toEqual(["2"]);

    const byFolder = applyProfileFilter(
      profiles,
      { ...EMPTY_PROFILE_FILTER, folderIds: ["g1"] },
      running,
    );
    expect(byFolder.map((p) => p.id)).toEqual(["1"]);

    const runningOnly = applyProfileFilter(
      profiles,
      { ...EMPTY_PROFILE_FILTER, runningOnly: true },
      running,
    );
    expect(runningOnly.map((p) => p.id)).toEqual(["1"]);

    const noStatus = applyProfileFilter(
      profiles,
      { ...EMPTY_PROFILE_FILTER, status: PROFILE_FILTER_STATUS_NONE },
      running,
    );
    expect(noStatus.map((p) => p.id)).toEqual(["2"]);
  });
});
