"use client";

import { invoke } from "@tauri-apps/api/core";
import * as React from "react";
import { LuGlobe } from "react-icons/lu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile, StoredProxy, VpnConfig } from "@/types";

interface NetworkSectionInlineProps {
  profile: BrowserProfile;
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  isDisabled: boolean;
  t: (key: string, options?: Record<string, unknown>) => string;
}

export function NetworkSectionInline({
  profile,
  storedProxies,
  vpnConfigs,
  isDisabled,
  t,
}: NetworkSectionInlineProps) {
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [proxyId, setProxyId] = React.useState<string | null>(
    profile.proxy_id ?? null,
  );
  const [vpnId, setVpnId] = React.useState<string | null>(
    profile.vpn_id ?? null,
  );

  React.useEffect(() => {
    setProxyId(profile.proxy_id ?? null);
    setVpnId(profile.vpn_id ?? null);
  }, [profile.proxy_id, profile.vpn_id]);

  const onProxyChange = async (value: string) => {
    const nextId = value === "__none__" ? null : value;
    setIsSaving(true);
    setError(null);
    try {
      await invoke("update_profile_proxy", {
        profileId: profile.id,
        proxyId: nextId,
      });
      setProxyId(nextId);
      if (nextId !== null) setVpnId(null);
    } catch (e) {
      setError(translateBackendError(t as never, e));
    } finally {
      setIsSaving(false);
    }
  };

  const onVpnChange = async (value: string) => {
    const nextId = value === "__none__" ? null : value;
    setIsSaving(true);
    setError(null);
    try {
      await invoke("update_profile_vpn", {
        profileId: profile.id,
        vpnId: nextId,
      });
      setVpnId(nextId);
      if (nextId !== null) setProxyId(null);
    } catch (e) {
      setError(translateBackendError(t as never, e));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <LuGlobe className="size-4" />
        {t("profileInfo.sections.network")}
      </div>
      <p className="text-xs text-muted-foreground">
        {t("profileInfo.sectionDesc.network")}
      </p>

      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("profileInfo.fields.proxy")}
        </span>
        <Select
          value={proxyId ?? "__none__"}
          disabled={isDisabled || isSaving}
          onValueChange={(v) => {
            void onProxyChange(v);
          }}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("profileInfo.values.none")}
            </SelectItem>
            {storedProxies.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[10px] tracking-wide text-muted-foreground uppercase">
          {t("profileInfo.fields.vpn")}
        </span>
        <Select
          value={vpnId ?? "__none__"}
          disabled={isDisabled || isSaving}
          onValueChange={(v) => {
            void onVpnChange(v);
          }}
        >
          <SelectTrigger className="h-7 flex-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">
              {t("profileInfo.values.none")}
            </SelectItem>
            {vpnConfigs.map((v) => (
              <SelectItem key={v.id} value={v.id}>
                {v.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
