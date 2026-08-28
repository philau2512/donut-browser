import { describe, expect, it, vi } from "vitest";
import {
  formatGroupShortcut,
  formatShortcut,
  matchesGroupDigit,
  matchesShortcut,
  SHORTCUTS,
  type ShortcutDef,
} from "./shortcuts";

function keyEvent(
  partial: Partial<KeyboardEvent> & { key: string },
): KeyboardEvent {
  return {
    key: partial.key,
    metaKey: partial.metaKey ?? false,
    ctrlKey: partial.ctrlKey ?? false,
    shiftKey: partial.shiftKey ?? false,
    altKey: partial.altKey ?? false,
  } as KeyboardEvent;
}

describe("shortcuts (ST-06 / SH-01 smoke)", () => {
  it("registers core navigation and action shortcuts", () => {
    const ids = SHORTCUTS.map((s) => s.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "openPalette",
        "goProfiles",
        "goProxies",
        "goSettings",
        "goAccount",
      ]),
    );
  });

  it("formats tokens for non-mac", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows", platform: "Win32" });
    const s: ShortcutDef = {
      id: "openPalette",
      labelKey: "x",
      group: "actions",
      key: "k",
      mod: true,
    };
    expect(formatShortcut(s)).toEqual(["Ctrl", "K"]);
    expect(formatGroupShortcut(3)).toEqual(["Ctrl", "3"]);
    vi.unstubAllGlobals();
  });

  it("matches exact mod+key and rejects wrong modifiers", () => {
    vi.stubGlobal("navigator", { userAgent: "Windows", platform: "Win32" });
    const openPalette = SHORTCUTS.find((s) => s.id === "openPalette");
    if (!openPalette) {
      throw new Error("Expected openPalette shortcut to be registered");
    }
    expect(
      matchesShortcut(openPalette, keyEvent({ key: "k", ctrlKey: true })),
    ).toBe(true);
    expect(
      matchesShortcut(
        openPalette,
        keyEvent({ key: "k", ctrlKey: true, shiftKey: true }),
      ),
    ).toBe(false);
    expect(matchesGroupDigit(keyEvent({ key: "2", ctrlKey: true }))).toBe(2);
    expect(
      matchesGroupDigit(keyEvent({ key: "2", ctrlKey: true, shiftKey: true })),
    ).toBe(null);
    vi.unstubAllGlobals();
  });
});
