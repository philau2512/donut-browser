import { describe, expect, it } from "vitest";
import {
  getBrowserDisplayName,
  getOSDisplayName,
  isCrossOsProfile,
} from "./browser-utils";

describe("browser-utils smoke", () => {
  it("maps browser and OS labels", () => {
    expect(getBrowserDisplayName("wayfern")).toBe("Wayfern");
    expect(getBrowserDisplayName("unknown-browser")).toBe("unknown-browser");
    expect(getOSDisplayName("windows")).toBe("Windows");
    expect(getOSDisplayName("macos")).toBe("macOS");
    expect(getOSDisplayName("linux")).toBe("Linux");
  });

  it("detects cross-os when host_os differs", () => {
    expect(isCrossOsProfile({ host_os: "not-a-real-os-xyz" })).toBe(true);
    expect(typeof isCrossOsProfile({ host_os: undefined })).toBe("boolean");
  });
});
