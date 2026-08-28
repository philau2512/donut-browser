/**
 * Pure helpers for Quick Create template draft ↔ payload conversion.
 * Kept free of React so unit tests can cover serialization without UI.
 */

import type {
  QuickCreateTemplate,
  WayfernConfig,
  WayfernFingerprintConfig,
  WayfernOS,
} from "@/types";

export const QUICK_CREATE_NONE = "__none__";
export const QUICK_CREATE_MAX_QTY = 100;

export type QuickCreateTemplateDraft = {
  id: string;
  name: string;
  browser: "wayfern" | "camoufox";
  version: string;
  release_type: string;
  /** proxy id, or `vpn-{id}`, or QUICK_CREATE_NONE */
  proxySelection: string;
  extension_group_id: string;
  os: WayfernOS;
  dns_blocklist: string;
  launch_hook: string;
  tags: string;
  profile_status: string;
  fingerprint_overrides: WayfernFingerprintConfig;
  auto_location: boolean;
  ephemeral: boolean;
};

export function emptyQuickCreateDraft(os: WayfernOS): QuickCreateTemplateDraft {
  return {
    id: "",
    name: "",
    browser: "wayfern",
    version: "",
    release_type: "stable",
    proxySelection: QUICK_CREATE_NONE,
    extension_group_id: QUICK_CREATE_NONE,
    os,
    dns_blocklist: "",
    launch_hook: "",
    tags: "",
    profile_status: QUICK_CREATE_NONE,
    fingerprint_overrides: {},
    auto_location: true,
    ephemeral: false,
  };
}

export function clampQuickCreateQuantity(raw: number): number {
  if (Number.isNaN(raw)) return 1;
  return Math.min(QUICK_CREATE_MAX_QTY, Math.max(1, Math.floor(raw)));
}

export function draftFromTemplate(
  t: QuickCreateTemplate,
  fallbackOs: WayfernOS,
): QuickCreateTemplateDraft {
  const vpnSel = t.vpn_id ? `vpn-${t.vpn_id}` : null;
  return {
    id: t.id,
    name: t.name,
    browser: t.browser === "camoufox" ? "camoufox" : "wayfern",
    version: t.version,
    release_type: t.release_type || "stable",
    proxySelection: vpnSel ?? t.proxy_id ?? QUICK_CREATE_NONE,
    extension_group_id: t.extension_group_id ?? QUICK_CREATE_NONE,
    os: (t.wayfern_config?.os ||
      t.camoufox_config?.os ||
      fallbackOs) as WayfernOS,
    dns_blocklist: t.dns_blocklist ?? "",
    launch_hook: t.launch_hook ?? "",
    tags: (t.tags ?? []).join(", "),
    profile_status: t.profile_status ?? QUICK_CREATE_NONE,
    fingerprint_overrides: t.fingerprint_overrides ?? {},
    auto_location: t.wayfern_config?.geoip !== false,
    ephemeral: t.ephemeral ?? false,
  };
}

export function draftToTemplate(
  d: QuickCreateTemplateDraft,
): QuickCreateTemplate {
  const isVpn = d.proxySelection.startsWith("vpn-");
  const proxy_id =
    !isVpn && d.proxySelection !== QUICK_CREATE_NONE
      ? d.proxySelection
      : undefined;
  const vpn_id = isVpn ? d.proxySelection.slice(4) : undefined;

  const tags = d.tags
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const wayfern_config: WayfernConfig | undefined =
    d.browser === "wayfern"
      ? {
          os: d.os,
          geoip: d.auto_location,
        }
      : undefined;

  const camoufox_config =
    d.browser === "camoufox"
      ? {
          os: d.os as "windows" | "macos" | "linux",
          geoip: d.auto_location,
        }
      : undefined;

  return {
    id: d.id,
    name: d.name.trim(),
    browser: d.browser,
    version: d.version,
    release_type: d.release_type || "stable",
    proxy_id,
    vpn_id,
    wayfern_config,
    camoufox_config,
    extension_group_id:
      d.extension_group_id !== QUICK_CREATE_NONE
        ? d.extension_group_id
        : undefined,
    dns_blocklist: d.dns_blocklist.trim() || undefined,
    launch_hook: d.launch_hook.trim() || undefined,
    tags,
    profile_status:
      d.profile_status !== QUICK_CREATE_NONE ? d.profile_status : undefined,
    fingerprint_overrides: d.fingerprint_overrides,
    ephemeral: d.ephemeral,
    created_at: 0,
    updated_at: 0,
  };
}

/** Progress percent for the Quick Create progress modal. */
export function quickCreateProgressPercent(
  completed: number,
  total: number,
): number {
  return Math.round((completed / Math.max(total, 1)) * 100);
}
