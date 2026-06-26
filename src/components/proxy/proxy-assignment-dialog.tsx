"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LoadingButton } from "@/components/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { BrowserProfile, StoredProxy, VpnConfig } from "@/types";
import { RippleButton } from "../ui/ripple";
import { parseProxyString } from "./proxy-form-dialog";

interface ProxyAssignmentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedProfiles: string[];
  onAssignmentComplete: () => void;
  profiles?: BrowserProfile[];
  storedProxies?: StoredProxy[];
  vpnConfigs?: VpnConfig[];
}

export function ProxyAssignmentDialog({
  isOpen,
  onClose,
  selectedProfiles,
  onAssignmentComplete,
  profiles = [],
  storedProxies = [],
  vpnConfigs = [],
}: ProxyAssignmentDialogProps) {
  const { t } = useTranslation();
  const [localProfiles, setLocalProfiles] = useState<BrowserProfile[]>([]);
  const [tabValue, setTabValue] = useState<string>("proxy");
  const [proxyType, setProxyType] = useState<string>("http");
  const [rawProxyText, setRawProxyText] = useState<string>("");
  const [selectedStoredProxyId, setSelectedStoredProxyId] = useState<
    string | null
  >(null);

  // Rotating / IPs / IPv6 form states
  const [formHost, setFormHost] = useState<string>("");
  const [formPort, setFormPort] = useState<string>("");
  const [formUser, setFormUser] = useState<string>("");
  const [formPass, setFormPass] = useState<string>("");
  const [formRotateUrl, setFormRotateUrl] = useState<string>("");
  const [formConfigJson, setFormConfigJson] = useState<string>("");

  const handleHostPaste = useCallback(
    (e: React.ClipboardEvent<HTMLInputElement>) => {
      const pastedText = e.clipboardData.getData("text");
      const parsed = parseProxyString(pastedText);
      if (parsed) {
        e.preventDefault();
        setFormHost(parsed.host);
        setFormPort(parsed.port.toString());
        setFormUser(parsed.username);
        setFormPass(parsed.password);
        if (parsed.type && parsed.type !== "none") {
          setProxyType(parsed.type);
        }
      }
    },
    [],
  );

  const [isAssigning, setIsAssigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync selectedProfiles props to localProfiles state
  useEffect(() => {
    if (isOpen) {
      const selected = profiles.filter((p) => selectedProfiles.includes(p.id));
      setLocalProfiles(selected);
      setError(null);
      setRawProxyText("");
      setSelectedStoredProxyId(null);
      setFormHost("");
      setFormPort("");
      setFormUser("");
      setFormPass("");
      setFormRotateUrl("");
      setFormConfigJson("");
    }
  }, [isOpen, selectedProfiles, profiles]);

  const handleRemoveProfileFromList = useCallback((profileId: string) => {
    setLocalProfiles((prev) => prev.filter((p) => p.id !== profileId));
  }, []);

  const handleAssign = useCallback(async () => {
    setIsAssigning(true);
    setError(null);
    try {
      const validProfiles = localProfiles;

      if (validProfiles.length === 0) {
        setError(t("proxyAssignment.noValidProfiles"));
        setIsAssigning(false);
        return;
      }

      if (tabValue === "without-proxies") {
        // Without proxies: assign null to proxy_id and vpn_id
        for (const p of validProfiles) {
          await invoke("update_profile_proxy", {
            profileId: p.id,
            proxyId: null,
          });
          await invoke("update_profile_vpn", {
            profileId: p.id,
            vpnId: null,
          });
        }
        toast.success(t("proxyAssignment.successClear"));
      } else if (tabValue === "my-proxy") {
        // My proxy: Assign selected stored proxy or VPN
        if (!selectedStoredProxyId) {
          setError(t("proxyAssignment.pleaseSelectProxy"));
          setIsAssigning(false);
          return;
        }

        const isVpn = selectedStoredProxyId.startsWith("vpn-");
        const actualId = isVpn
          ? selectedStoredProxyId.slice(4)
          : selectedStoredProxyId;

        for (const p of validProfiles) {
          if (isVpn) {
            await invoke("update_profile_vpn", {
              profileId: p.id,
              vpnId: actualId,
            });
          } else {
            const nextId = actualId === "__none__" ? null : actualId;
            await invoke("update_profile_proxy", {
              profileId: p.id,
              proxyId: nextId,
            });
          }
        }
        toast.success(
          t("proxyAssignment.success", { count: validProfiles.length }),
        );
      } else if (tabValue === "proxy") {
        // Bulk Proxy input (textarea text)
        const lines = rawProxyText
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length === 0) {
          setError(t("proxyAssignment.pleaseInputProxy"));
          setIsAssigning(false);
          return;
        }

        // Sequential allocation: Profile i gets Proxy i. Remaining profiles keep their current proxy.
        let assignCount = 0;
        const now = Date.now();
        for (let i = 0; i < validProfiles.length; i++) {
          const profile = validProfiles[i];
          if (i >= lines.length) {
            // No more proxies, stop assigning (remaining profiles keep old settings)
            break;
          }

          const proxyLine = lines[i];
          const parts = proxyLine.split(":");
          if (parts.length < 2) continue;

          const host = parts[0];
          const port = parseInt(parts[1], 10);
          if (isNaN(port)) continue;

          let username;
          let password;
          if (parts.length >= 4) {
            username = parts[2];
            password = parts[3];
          }

          const payload = {
            name: `${profile.name}_Bulk_${proxyType.toUpperCase()}_${now}_${i}`,
            proxySettings: {
              proxy_type: proxyType === "none" ? "http" : proxyType,
              host,
              port,
              username: username || undefined,
              password: password || undefined,
            },
          };

          const newProxy = await invoke<StoredProxy>("create_stored_proxy", {
            ...payload,
            isProfileSpecific: true,
          });
          await invoke("update_profile_proxy", {
            profileId: profile.id,
            proxyId: newProxy.id,
          });
          assignCount++;
        }
        toast.success(t("proxyAssignment.success", { count: assignCount }));
      } else if (
        tabValue === "rotating-res" ||
        tabValue === "ips-res" ||
        tabValue === "ipv6-proxies"
      ) {
        // Form details
        if (!formHost.trim() || !formPort) {
          setError(t("proxies.form.hostPortRequired"));
          setIsAssigning(false);
          return;
        }

        const payload = {
          name: `Proxy_${tabValue.toUpperCase()}_${formHost.trim()}:${formPort}_${Date.now()}`,
          proxySettings: {
            proxy_type: proxyType === "none" ? "http" : proxyType,
            host: formHost.trim(),
            port: parseInt(formPort, 10),
            username: formUser.trim() || undefined,
            password: formPass.trim() || undefined,
          },
        };

        const newProxy = await invoke<StoredProxy>("create_stored_proxy", {
          ...payload,
          isProfileSpecific: true,
        });
        for (const p of validProfiles) {
          await invoke("update_profile_proxy", {
            profileId: p.id,
            proxyId: newProxy.id,
          });
        }
        toast.success(
          t("proxyAssignment.success", { count: validProfiles.length }),
        );
      } else if (tabValue === "proxy-config") {
        // JSON Config
        try {
          const config = JSON.parse(formConfigJson);
          if (!config.host || !config.port) {
            setError(t("proxies.form.hostPortRequired"));
            setIsAssigning(false);
            return;
          }

          const payload = {
            name: `Proxy_Config_${config.host.trim()}:${config.port}_${Date.now()}`,
            proxySettings: {
              proxy_type: config.proxy_type || config.type || "http",
              host: config.host.trim(),
              port: parseInt(config.port, 10),
              username: config.username || undefined,
              password: config.password || undefined,
            },
          };

          const newProxy = await invoke<StoredProxy>("create_stored_proxy", {
            ...payload,
            isProfileSpecific: true,
          });
          for (const p of validProfiles) {
            await invoke("update_profile_proxy", {
              profileId: p.id,
              proxyId: newProxy.id,
            });
          }
          toast.success(
            t("proxyAssignment.success", { count: validProfiles.length }),
          );
        } catch (_e) {
          setError(t("proxyAssignment.invalidJson"));
          setIsAssigning(false);
          return;
        }
      }

      await emit("profile-updated");
      await emit("stored-proxies-changed");
      onAssignmentComplete();
      onClose();
    } catch (err) {
      console.error("Failed to assign proxy/VPN to profiles:", err);
      const errorMessage =
        err instanceof Error
          ? err.message
          : t("proxyAssignment.failedFallback");
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsAssigning(false);
    }
  }, [
    localProfiles,
    tabValue,
    proxyType,
    rawProxyText,
    selectedStoredProxyId,
    formHost,
    formPort,
    formUser,
    formPass,
    formConfigJson,
    onAssignmentComplete,
    onClose,
    t,
  ]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl flex flex-col max-h-[90vh]">
        <DialogHeader className="pb-2 border-b border-border">
          <DialogTitle>{t("proxyAssignment.changeProxyTitle")}</DialogTitle>
          <DialogDescription>
            {t("proxyAssignment.bulkChangeDescription", {
              count: localProfiles.length,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1 scrollbar-thin">
          {/* Selected profiles table list */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-foreground/80">
              {t("proxyAssignment.selectedProfilesLabel")}
            </Label>
            <div className="border border-border rounded-md overflow-hidden bg-card/30 max-h-40 overflow-y-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead className="bg-secondary/40 text-muted-foreground uppercase font-semibold sticky top-0 z-10">
                  <tr>
                    <th className="px-3 py-2 w-10 text-center">No</th>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Current Proxy / VPN</th>
                    <th className="px-3 py-2 w-20 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {localProfiles.length === 0 ? (
                    <tr>
                      <td
                        colSpan={4}
                        className="px-3 py-4 text-center text-muted-foreground italic"
                      >
                        {t("proxyAssignment.noValidProfiles")}
                      </td>
                    </tr>
                  ) : (
                    localProfiles.map((p, index) => {
                      const proxy = p.proxy_id
                        ? storedProxies.find((px) => px.id === p.proxy_id)
                        : null;
                      const vpn = p.vpn_id
                        ? vpnConfigs.find((v) => v.id === p.vpn_id)
                        : null;
                      const currentDisplay = vpn
                        ? `WG - ${vpn.name}`
                        : proxy
                          ? `${proxy.name} (${proxy.proxy_settings.proxy_type.toUpperCase()})`
                          : t("proxyAssignment.noneOption");

                      return (
                        <tr key={p.id} className="hover:bg-accent/20">
                          <td className="px-3 py-2 text-center text-muted-foreground font-mono">
                            {index + 1}
                          </td>
                          <td className="px-3 py-2 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {currentDisplay}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 px-2 text-[10px] cursor-pointer"
                              onClick={() => handleRemoveProfileFromList(p.id)}
                            >
                              {t("common.buttons.delete")}
                            </Button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Configuration Tabs */}
          <Tabs value={tabValue} onValueChange={setTabValue} className="w-full">
            <TabsList className="w-full flex-wrap !bg-transparent !p-0 !h-auto !rounded-none justify-start gap-1 pb-3 border-b border-border">
              <TabsTrigger
                value="proxy"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Proxy
              </TabsTrigger>
              <TabsTrigger
                value="my-proxy"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                My proxy
              </TabsTrigger>
              <TabsTrigger
                value="ips-res"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                IPs Residential
              </TabsTrigger>
              <TabsTrigger
                value="rotating-res"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Rotating Residential
              </TabsTrigger>
              <TabsTrigger
                value="proxy-config"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                Proxy Config
              </TabsTrigger>
              <TabsTrigger
                value="ipv6-proxies"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
              >
                IPv6 Proxies
              </TabsTrigger>
              <TabsTrigger
                value="without-proxies"
                className="px-2.5 py-1.5 text-xs rounded hover:bg-accent cursor-pointer data-[state=active]:bg-primary data-[state=active]:text-primary-foreground text-destructive hover:text-destructive"
              >
                Without Proxies
              </TabsTrigger>
            </TabsList>

            {/* Bulk manual input */}
            <TabsContent value="proxy" className="pt-3 space-y-3">
              <div className="flex items-center gap-2">
                <Label className="text-xs shrink-0 font-medium">
                  Proxy Type:
                </Label>
                <Select value={proxyType} onValueChange={setProxyType}>
                  <SelectTrigger className="h-8 w-28 text-xs cursor-pointer">
                    <SelectValue placeholder="HTTP" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="http" className="cursor-pointer">
                      HTTP
                    </SelectItem>
                    <SelectItem value="socks4" className="cursor-pointer">
                      SOCKS4
                    </SelectItem>
                    <SelectItem value="socks5" className="cursor-pointer">
                      SOCKS5
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <textarea
                className="w-full h-32 bg-background border border-border rounded-md p-2.5 text-xs font-mono focus:border-primary focus:ring-0 focus:outline-none placeholder:text-muted-foreground/40"
                placeholder="Ex: 192.168.1.100:8080:user:pass (Một proxy trên mỗi dòng)"
                value={rawProxyText}
                onChange={(e) => setRawProxyText(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                * Phân bổ tuần tự: Profile thứ 1 nhận dòng Proxy thứ 1, Profile
                thứ 2 nhận dòng Proxy thứ 2, v.v.
              </p>
            </TabsContent>

            {/* My Proxy Selection */}
            <TabsContent value="my-proxy" className="pt-3 space-y-3">
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">
                  Select a Saved Proxy or VPN Config:
                </Label>
                <Select
                  value={selectedStoredProxyId ?? ""}
                  onValueChange={(val) => setSelectedStoredProxyId(val || null)}
                >
                  <SelectTrigger className="h-9 w-full text-xs cursor-pointer">
                    <SelectValue placeholder="Choose a saved configuration..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="__none__"
                      className="cursor-pointer italic text-muted-foreground"
                    >
                      None
                    </SelectItem>
                    {storedProxies
                      .filter(
                        (px) =>
                          !px.is_cloud_managed &&
                          !px.is_cloud_derived &&
                          !px.is_profile_specific,
                      )
                      .map((px) => (
                        <SelectItem
                          key={px.id}
                          value={px.id}
                          className="cursor-pointer"
                        >
                          Proxy: {px.name} (
                          {px.proxy_settings.proxy_type.toUpperCase()}://
                          {px.proxy_settings.host}:{px.proxy_settings.port})
                        </SelectItem>
                      ))}
                    {vpnConfigs.map((vpn) => (
                      <SelectItem
                        key={vpn.id}
                        value={`vpn-${vpn.id}`}
                        className="cursor-pointer"
                      >
                        VPN: {vpn.name} (WireGuard)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TabsContent>

            {/* IPs Residential */}
            <TabsContent value="ips-res" className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Host / IP</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    onPaste={handleHostPaste}
                    placeholder="residential.proxy.com"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Port</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    placeholder="8000"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Username</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formUser}
                    onChange={(e) => setFormUser(e.target.value)}
                    placeholder="user"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Password</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPass}
                    onChange={(e) => setFormPass(e.target.value)}
                    placeholder="pass"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Rotating Residential */}
            <TabsContent value="rotating-res" className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Host / IP</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    onPaste={handleHostPaste}
                    placeholder="rotating.proxy.com"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Port</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    placeholder="5000"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Username</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formUser}
                    onChange={(e) => setFormUser(e.target.value)}
                    placeholder="user"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Password</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPass}
                    onChange={(e) => setFormPass(e.target.value)}
                    placeholder="pass"
                  />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <Label className="text-[11px] font-medium">
                    Link API Rotate (Optional)
                  </Label>
                  <Input
                    className="h-8 text-xs"
                    value={formRotateUrl}
                    onChange={(e) => setFormRotateUrl(e.target.value)}
                    placeholder="https://api.proxy.com/rotate?key=..."
                  />
                </div>
              </div>
            </TabsContent>

            {/* Proxy Config */}
            <TabsContent value="proxy-config" className="pt-3 space-y-3">
              <div className="flex flex-col gap-2">
                <Label className="text-xs font-medium">
                  Config Content (JSON String):
                </Label>
                <textarea
                  className="w-full h-28 bg-background border border-border rounded-md p-2 text-xs font-mono focus:border-primary focus:ring-0 focus:outline-none"
                  placeholder='{"host": "1.1.1.1", "port": 8080, "type": "http"}'
                  value={formConfigJson}
                  onChange={(e) => setFormConfigJson(e.target.value)}
                />
              </div>
            </TabsContent>

            {/* IPv6 Proxies */}
            <TabsContent value="ipv6-proxies" className="pt-3 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">
                    IPv6 Address
                  </Label>
                  <Input
                    className="h-8 text-xs"
                    value={formHost}
                    onChange={(e) => setFormHost(e.target.value)}
                    onPaste={handleHostPaste}
                    placeholder="2001:db8::1"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Port</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPort}
                    onChange={(e) => setFormPort(e.target.value)}
                    placeholder="3128"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Username</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formUser}
                    onChange={(e) => setFormUser(e.target.value)}
                    placeholder="user"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="text-[11px] font-medium">Password</Label>
                  <Input
                    className="h-8 text-xs"
                    value={formPass}
                    onChange={(e) => setFormPass(e.target.value)}
                    placeholder="pass"
                  />
                </div>
              </div>
            </TabsContent>

            {/* Without Proxies */}
            <TabsContent value="without-proxies" className="pt-3">
              <div className="bg-destructive/15 border border-destructive/25 text-destructive p-3 rounded-md text-xs">
                ⚠️ Các profile được chọn sẽ chuyển sang chế độ **Không sử dụng
                Proxy (Without Proxies)** sau khi bấm Submit.
              </div>
            </TabsContent>
          </Tabs>

          {error && (
            <div className="rounded-md bg-destructive/10 p-3 text-xs text-destructive select-none">
              {error}
            </div>
          )}
        </div>

        <DialogFooter className="pt-2 border-t border-border">
          <RippleButton
            variant="outline"
            onClick={onClose}
            disabled={isAssigning}
            className="h-8 text-xs cursor-pointer"
          >
            {t("common.buttons.cancel")}
          </RippleButton>
          <LoadingButton
            isLoading={isAssigning}
            onClick={() => void handleAssign()}
            className="h-8 text-xs cursor-pointer"
          >
            {t("proxyAssignment.assignButton")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
