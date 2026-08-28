import { describe, expect, it, vi } from "vitest";
import {
  getBrowserDisplayName,
  getOSDisplayName,
  isCrossOsProfile,
} from "./browser-utils";
import {
  formatShortcut,
  matchesGroupDigit,
  matchesShortcut,
  SHORTCUTS,
  type ShortcutDef,
} from "./shortcuts";
import { getThemeById, THEMES } from "./themes";

describe("shortcuts (ST-06 / SH-01 smoke)", () => {
  it("defines unique navigation + action ids", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("openPalette");
    expect(ids).toContain("goProfiles");
    expect(ids).toContain("goSettings");
  });

  it("formats mod shortcuts with Ctrl on non-mac", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Windows",
      platform: "Win32",
    });
    const def: ShortcutDef = {
      id: "openPalette",
      labelKey: "x",
      group: "actions",
      key: "k",
      mod: true,
    };
    expect(formatShortcut(def)).toEqual(["Ctrl", "K"]);
    vi.unstubAllGlobals();
  });

  it("matches shortcuts exactly (no extra modifiers)", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Windows",
      platform: "Win32",
    });
    const def = SHORTCUTS.find((s) => s.id === "openPalette");
    if (!def) {
      throw new Error("Expected openPalette shortcut to be registered");
    }
    const match = matchesShortcut(def, {
      key: "k",
      metaKey: false,
      ctrlKey: true,
      shiftKey: false,
      altKey: false,
    } as KeyboardEvent);
    expect(match).toBe(true);

    const noMatch = matchesShortcut(def, {
      key: "k",
      metaKey: false,
      ctrlKey: true,
      shiftKey: true,
      altKey: false,
    } as KeyboardEvent);
    expect(noMatch).toBe(false);
    vi.unstubAllGlobals();
  });

  it("matches group digit shortcuts", () => {
    vi.stubGlobal("navigator", {
      userAgent: "Windows",
      platform: "Win32",
    });
    expect(
      matchesGroupDigit({
        key: "3",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBe(3);
    expect(
      matchesGroupDigit({
        key: "a",
        metaKey: false,
        ctrlKey: true,
        shiftKey: false,
        altKey: false,
      } as KeyboardEvent),
    ).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe("themes (ST-06 smoke)", () => {
  it("has unique theme ids and resolves by id", () => {
    const ids = THEMES.map((t) => t.id);
    expect(ids.length).toBeGreaterThan(5);
    expect(new Set(ids).size).toBe(ids.length);
    expect(getThemeById("donut-mono")?.name).toBe("Donut Mono");
    expect(getThemeById("missing-theme")).toBeUndefined();
  });
});

describe("browser-utils smoke", () => {
  it("maps browser and OS display names", () => {
    expect(getBrowserDisplayName("wayfern")).toMatch(/wayfern/i);
    expect(getBrowserDisplayName("camoufox")).toMatch(/camoufox/i);
    expect(getOSDisplayName("windows")).toBeTruthy();
  });

  it("detects cross-os profiles", () => {
    expect(
      isCrossOsProfile({
        host_os: "linux",
        wayfern_config: { os: "linux" },
      }),
    ).toBeTypeOf("boolean");
  });
});
