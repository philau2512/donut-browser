import { describe, expect, it } from "vitest";
import { getThemeById, THEMES } from "./themes";

describe("themes (ST-06 smoke)", () => {
  it("has unique theme ids and resolves by id", () => {
    const ids = THEMES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(5);

    const mono = getThemeById("donut-mono");
    expect(mono?.name).toBe("Donut Mono");
    expect(mono?.colors["--background"]).toBeTruthy();
    expect(getThemeById("missing-theme")).toBeUndefined();
  });
});
