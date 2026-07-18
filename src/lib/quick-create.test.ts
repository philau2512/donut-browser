import { describe, expect, it } from "vitest";
import type { QuickCreateTemplate } from "@/types";
import {
  clampQuickCreateQuantity,
  draftFromTemplate,
  draftToTemplate,
  emptyQuickCreateDraft,
  QUICK_CREATE_MAX_QTY,
  QUICK_CREATE_NONE,
  type QuickCreateTemplateDraft,
  quickCreateProgressPercent,
} from "./quick-create";

function sampleTemplate(
  overrides: Partial<QuickCreateTemplate> = {},
): QuickCreateTemplate {
  return {
    id: "tpl-1",
    name: "Nextdoor-US",
    browser: "wayfern",
    version: "1.2.3",
    release_type: "stable",
    proxy_id: "proxy-a",
    tags: ["us", "real"],
    profile_status: "Ready",
    wayfern_config: { os: "windows", geoip: true },
    created_at: 100,
    updated_at: 200,
    ...overrides,
  };
}

describe("quick-create helpers", () => {
  describe("clampQuickCreateQuantity", () => {
    it("clamps to 1..MAX", () => {
      expect(clampQuickCreateQuantity(0)).toBe(1);
      expect(clampQuickCreateQuantity(-5)).toBe(1);
      expect(clampQuickCreateQuantity(1)).toBe(1);
      expect(clampQuickCreateQuantity(50)).toBe(50);
      expect(clampQuickCreateQuantity(QUICK_CREATE_MAX_QTY)).toBe(
        QUICK_CREATE_MAX_QTY,
      );
      expect(clampQuickCreateQuantity(999)).toBe(QUICK_CREATE_MAX_QTY);
      expect(clampQuickCreateQuantity(Number.NaN)).toBe(1);
      expect(clampQuickCreateQuantity(3.9)).toBe(3);
    });
  });

  describe("draft ↔ template", () => {
    it("round-trips proxy and tags", () => {
      const tpl = sampleTemplate();
      const draft = draftFromTemplate(tpl, "linux");
      expect(draft.proxySelection).toBe("proxy-a");
      expect(draft.tags).toBe("us, real");
      expect(draft.os).toBe("windows");
      expect(draft.profile_status).toBe("Ready");

      const back = draftToTemplate(draft);
      expect(back.name).toBe("Nextdoor-US");
      expect(back.proxy_id).toBe("proxy-a");
      expect(back.vpn_id).toBeUndefined();
      expect(back.tags).toEqual(["us", "real"]);
      expect(back.profile_status).toBe("Ready");
      expect(back.wayfern_config?.os).toBe("windows");
      expect(back.camoufox_config).toBeUndefined();
    });

    it("encodes VPN selection as vpn-{id}", () => {
      const tpl = sampleTemplate({
        proxy_id: undefined,
        vpn_id: "abc-uuid",
      });
      const draft = draftFromTemplate(tpl, "macos");
      expect(draft.proxySelection).toBe("vpn-abc-uuid");

      const back = draftToTemplate(draft);
      expect(back.vpn_id).toBe("abc-uuid");
      expect(back.proxy_id).toBeUndefined();
    });

    it("maps NONE to undefined optional fields", () => {
      const draft: QuickCreateTemplateDraft = {
        ...emptyQuickCreateDraft("linux"),
        name: "  Minimal  ",
        version: "9.0.0",
        tags: " a , , b ",
      };
      const tpl = draftToTemplate(draft);
      expect(tpl.name).toBe("Minimal");
      expect(tpl.proxy_id).toBeUndefined();
      expect(tpl.extension_group_id).toBeUndefined();
      expect(tpl.profile_status).toBeUndefined();
      expect(tpl.tags).toEqual(["a", "b"]);
      expect(tpl.wayfern_config).toEqual({ os: "linux", geoip: true });
    });

    it("builds camoufox config for camoufox browser", () => {
      const draft: QuickCreateTemplateDraft = {
        ...emptyQuickCreateDraft("windows"),
        name: "CF",
        browser: "camoufox",
        version: "1",
        os: "macos",
      };
      const tpl = draftToTemplate(draft);
      expect(tpl.browser).toBe("camoufox");
      expect(tpl.camoufox_config?.os).toBe("macos");
      expect(tpl.wayfern_config).toBeUndefined();
    });

    it("falls back OS when template has none", () => {
      const tpl = sampleTemplate({
        wayfern_config: undefined,
        camoufox_config: undefined,
      });
      const draft = draftFromTemplate(tpl, "android");
      expect(draft.os).toBe("android");
    });
  });

  describe("quickCreateProgressPercent", () => {
    it("computes percent safely", () => {
      expect(quickCreateProgressPercent(0, 10)).toBe(0);
      expect(quickCreateProgressPercent(5, 10)).toBe(50);
      expect(quickCreateProgressPercent(10, 10)).toBe(100);
      expect(quickCreateProgressPercent(0, 0)).toBe(0);
      expect(quickCreateProgressPercent(1, 3)).toBe(33);
    });
  });

  describe("QUICK_CREATE_NONE sentinel", () => {
    it("is stable", () => {
      expect(QUICK_CREATE_NONE).toBe("__none__");
    });
  });

  describe("smoke: create-form readiness", () => {
    it("rejects empty template name and version", () => {
      const empty = emptyQuickCreateDraft("windows");
      const invalidName = draftToTemplate({
        ...empty,
        name: "  ",
        version: "1",
      });
      expect(invalidName.name).toBe("");
      const invalidVersion = draftToTemplate({
        ...empty,
        name: "ok",
        version: "",
      });
      expect(invalidVersion.version).toBe("");
    });

    it("maps launch hook and dns blocklist", () => {
      const draft = {
        ...emptyQuickCreateDraft("linux"),
        name: "With Hooks",
        version: "2",
        launch_hook: "  https://hook.test  ",
        dns_blocklist: "  ads.com  ",
      };
      const tpl = draftToTemplate(draft);
      expect(tpl.launch_hook).toBe("https://hook.test");
      expect(tpl.dns_blocklist).toBe("ads.com");
    });

    it("round-trips extension group", () => {
      const tpl = sampleTemplate({ extension_group_id: "eg-1" });
      const draft = draftFromTemplate(tpl, "windows");
      expect(draft.extension_group_id).toBe("eg-1");
      expect(draftToTemplate(draft).extension_group_id).toBe("eg-1");
    });

    it("progress reaches 100 only when complete", () => {
      expect(quickCreateProgressPercent(9, 10)).toBe(90);
      expect(quickCreateProgressPercent(10, 10)).toBe(100);
    });
  });
});
