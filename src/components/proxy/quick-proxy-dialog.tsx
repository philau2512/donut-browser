"use client";

import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { LoadingButton } from "@/components/shared";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import {
  Dialog,
  DialogContent,
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
import { translateBackendError } from "@/lib/backend-errors";
import type { BrowserProfile, ProxyCheckResult, StoredProxy } from "@/types";

interface QuickProxyDialogProps {
  isOpen: boolean;
  onClose: () => void;
  profile: BrowserProfile | null;
  storedProxies: StoredProxy[];
}

export const parseFormatProxy = (str: string) => {
  const trimmed = str.trim();
  if (!trimmed) return null;

  let type = "http";
  let rest = trimmed;

  // 1. Detect protocol prefix (e.g. socks5://)
  const protocols = [
    "http://",
    "https://",
    "socks4://",
    "socks5://",
    "socks://",
    "ss://",
    "shadowsocks://",
  ];
  for (const proto of protocols) {
    if (trimmed.toLowerCase().startsWith(proto)) {
      type = proto.replace("://", "");
      if (type === "socks" || type === "shadowsocks") type = "socks5";
      rest = trimmed.substring(proto.length);
      break;
    }
  }

  // 2. Handle username:password@host:port format if present
  const atIdx = rest.lastIndexOf("@");
  if (atIdx !== -1) {
    const auth = rest.substring(0, atIdx);
    const hostPort = rest.substring(atIdx + 1);

    const authParts = auth.split(/[:|,]/);
    const username = authParts[0] || "";
    const password = authParts[1] || "";

    const hpParts = hostPort.split(/[:|,]/);
    const host = hpParts[0] || "";
    const port = Number.parseInt(hpParts[1], 10) || 8080;

    return { type, host, port, username, password };
  }

  // 3. Otherwise, split by any delimiters: :, |, ,
  const parts = rest
    .split(/[:|,]/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length === 2) {
    const host = parts[0];
    const port = Number.parseInt(parts[1], 10);
    if (!Number.isNaN(port)) {
      return { type, host, port, username: "", password: "" };
    }
  } else if (parts.length === 4) {
    const portAt1 = Number.parseInt(parts[1], 10);
    const portAt3 = Number.parseInt(parts[3], 10);

    const isPort1Valid =
      !Number.isNaN(portAt1) && portAt1 > 0 && portAt1 <= 65535;
    const isPort3Valid =
      !Number.isNaN(portAt3) && portAt3 > 0 && portAt3 <= 65535;

    if (isPort1Valid && !isPort3Valid) {
      return {
        type,
        host: parts[0],
        port: portAt1,
        username: parts[2],
        password: parts[3],
      };
    } else if (!isPort1Valid && isPort3Valid) {
      return {
        type,
        host: parts[2],
        port: portAt3,
        username: parts[0],
        password: parts[1],
      };
    } else if (isPort1Valid && isPort3Valid) {
      return {
        type,
        host: parts[0],
        port: portAt1,
        username: parts[2],
        password: parts[3],
      };
    }
  } else if (parts.length === 3) {
    const portAt1 = Number.parseInt(parts[1], 10);
    if (!Number.isNaN(portAt1) && portAt1 > 0 && portAt1 <= 65535) {
      return {
        type,
        host: parts[0],
        port: portAt1,
        username: parts[2],
        password: "",
      };
    }
  }

  return null;
};

export function QuickProxyDialog({
  isOpen,
  onClose,
  profile,
  storedProxies,
}: QuickProxyDialogProps) {
  const { t } = useTranslation();
  const [proxyType, setProxyType] = useState<string>("http");
  const [formatProxy, setFormatProxy] = useState<string>(
    "1: type://user:pass@ip:port",
  );
  const [host, setHost] = useState<string>("");
  const [port, setPort] = useState<number>(8080);
  const [username, setUsername] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [checkHost, setCheckHost] = useState<string>("donut-engine");
  const [checkBeforeStart, setCheckBeforeStart] = useState<boolean>(true);

  const [isChecking, setIsChecking] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [checkResult, setCheckResult] = useState<ProxyCheckResult | null>(null);
  const [hasBeenChecked, setHasBeenChecked] = useState(false);

  const associatedProxy = profile?.proxy_id
    ? storedProxies.find((px) => px.id === profile.proxy_id)
    : null;

  useEffect(() => {
    if (isOpen) {
      setFormatProxy("");
      if (associatedProxy) {
        setProxyType(associatedProxy.proxy_settings.proxy_type);
        setHost(associatedProxy.proxy_settings.host);
        setPort(associatedProxy.proxy_settings.port);
        setUsername(associatedProxy.proxy_settings.username ?? "");
        setPassword(associatedProxy.proxy_settings.password ?? "");

        invoke<ProxyCheckResult | null>("get_cached_proxy_check", {
          proxyId: associatedProxy.id,
        })
          .then((res) => {
            if (res) {
              setCheckResult(res);
              setHasBeenChecked(true);
            } else {
              setCheckResult(null);
              setHasBeenChecked(false);
            }
          })
          .catch((err) => {
            console.error("Failed to fetch cached proxy check:", err);
            setCheckResult(null);
            setHasBeenChecked(false);
          });
      } else {
        setProxyType("http");
        setHost("");
        setPort(8080);
        setUsername("");
        setPassword("");
        setCheckResult(null);
        setHasBeenChecked(false);
      }
    }
  }, [isOpen, associatedProxy]);

  // Handle format parsing
  const handleFormatChange = (val: string) => {
    setFormatProxy(val);
    const parsed = parseFormatProxy(val);
    if (parsed) {
      setProxyType(parsed.type);
      setHost(parsed.host);
      setPort(parsed.port);
      setUsername(parsed.username);
      setPassword(parsed.password);
    }
  };

  const handleCheck = async () => {
    if (!host.trim() || !port) {
      toast.error(t("proxies.form.hostPortRequired"));
      return;
    }
    setIsChecking(true);
    setHasBeenChecked(true);
    setCheckResult(null);
    try {
      const tempId = crypto.randomUUID();
      const settings = {
        proxy_type: proxyType,
        host: host.trim(),
        port: port,
        username: username.trim() || undefined,
        password: password.trim() || undefined,
      };

      const result = await invoke<ProxyCheckResult>("check_proxy_validity", {
        proxyId: tempId,
        proxySettings: settings,
      });

      setCheckResult(result);
      if (result.is_valid) {
        const loc = [result.city, result.country].filter(Boolean).join(", ");
        toast.success(`Proxy Valid! IP: ${result.ip} ${loc ? `(${loc})` : ""}`);
      } else {
        toast.error("Proxy connection failed.");
      }
    } catch (error) {
      console.error("Failed to check proxy:", error);
      toast.error(
        t("proxyCheck.failed", { error: translateBackendError(t, error) }),
      );
    } finally {
      setIsChecking(false);
    }
  };

  const handleSave = async () => {
    if (!profile) return;
    if (!host.trim() || !port) {
      toast.error(t("proxies.form.hostPortRequired"));
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        name: `Proxy_${host.trim()}:${port}`,
        proxySettings: {
          proxy_type: proxyType,
          host: host.trim(),
          port: port,
          username: username.trim() || undefined,
          password: password.trim() || undefined,
        },
      };

      if (associatedProxy) {
        // Edit existing stored proxy
        await invoke("update_stored_proxy", {
          proxyId: associatedProxy.id,
          ...payload,
        });
        toast.success(t("toasts.success.proxyUpdated"));
      } else {
        // Create new profile-specific proxy
        const newProxy = await invoke<StoredProxy>("create_stored_proxy", {
          ...payload,
          isProfileSpecific: true,
        });
        // Assign to profile
        await invoke("update_profile_proxy", {
          profileId: profile.id,
          proxyId: newProxy.id,
        });
        toast.success(t("toasts.success.proxyCreated"));
      }

      await emit("profile-updated");
      await emit("stored-proxies-changed");
      onClose();
    } catch (error) {
      console.error("Failed to save proxy:", error);
      toast.error(
        t("proxies.form.saveFailed", {
          error: translateBackendError(t, error),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const isFormValid = host.trim() && port > 0 && port <= 65535;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md bg-card">
        <DialogHeader className="border-b border-border pb-3">
          <DialogTitle>
            {associatedProxy
              ? t("proxies.quickEdit.quickEditTitle")
              : t("proxies.add")}
          </DialogTitle>
        </DialogHeader>

        <div className="grid gap-4 py-4 text-sm">
          {/* Proxy Type */}
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground font-semibold">
              * {t("proxies.form.type")}
            </Label>
            <Select value={proxyType} onValueChange={setProxyType}>
              <SelectTrigger className="h-9 cursor-pointer">
                <SelectValue placeholder="HTTP" />
              </SelectTrigger>
              <SelectContent>
                {["http", "https", "socks4", "socks5", "ss"].map((type) => (
                  <SelectItem
                    key={type}
                    value={type}
                    className="cursor-pointer"
                  >
                    {type === "ss" ? "Shadowsocks" : type.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Format Proxy Input */}
          <div className="grid gap-1.5">
            <Label
              htmlFor="quick-format-proxy"
              className="text-muted-foreground font-semibold"
            >
              {t("proxies.quickEdit.formatLabel")}
            </Label>
            <Input
              id="quick-format-proxy"
              placeholder={t("proxies.quickEdit.formatPlaceholder")}
              value={formatProxy}
              onChange={(e) => handleFormatChange(e.target.value)}
            />
            <p className="text-[10px] text-muted-foreground leading-normal">
              Ví dụ: HTTP://user:pass@ip:port | SOCKS5://ip:port | ip:port
            </p>
          </div>

          {/* IP & Port */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label
                htmlFor="quick-proxy-host"
                className="text-muted-foreground font-semibold"
              >
                * {t("proxies.form.host")}
              </Label>
              <Input
                id="quick-proxy-host"
                placeholder="192.168.1.1"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label
                htmlFor="quick-proxy-port"
                className="text-muted-foreground font-semibold"
              >
                * {t("proxies.form.port")}
              </Label>
              <Input
                id="quick-proxy-port"
                type="number"
                placeholder="8080"
                value={port || ""}
                onChange={(e) =>
                  setPort(Number.parseInt(e.target.value, 10) || 0)
                }
              />
            </div>
          </div>

          {/* Username & Password */}
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label
                htmlFor="quick-proxy-user"
                className="text-muted-foreground font-semibold"
              >
                {t("proxies.form.username")}
              </Label>
              <Input
                id="quick-proxy-user"
                placeholder="Optional"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label
                htmlFor="quick-proxy-pass"
                className="text-muted-foreground font-semibold"
              >
                {t("proxies.form.password")}
              </Label>
              <Input
                id="quick-proxy-pass"
                type="password"
                placeholder="Optional"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          {/* Check Proxy Host */}
          <div className="grid gap-1.5">
            <Label className="text-muted-foreground font-semibold">
              * {t("proxies.quickEdit.checkHostLabel")}
            </Label>
            <Select value={checkHost} onValueChange={setCheckHost}>
              <SelectTrigger className="h-9 cursor-pointer">
                <SelectValue placeholder="Donut Engine (Default)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="donut-engine" className="cursor-pointer">
                  Donut Engine (Default)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Check before start switch */}
          <div className="flex items-center justify-between border-t border-border pt-3 mt-1">
            <div className="grid gap-0.5">
              <Label className="font-semibold text-foreground">
                {t("proxies.quickEdit.checkBeforeStart")}
              </Label>
            </div>
            <AnimatedSwitch
              checked={checkBeforeStart}
              onCheckedChange={setCheckBeforeStart}
            />
          </div>

          {/* Check Proxy Connection result status banner */}
          {hasBeenChecked && (
            <div
              className={`relative p-3 rounded-lg text-xs border transition-colors ${
                isChecking
                  ? "bg-muted/10 border-border text-foreground"
                  : checkResult?.is_valid
                    ? "bg-success/5 border-success/20 text-foreground"
                    : "bg-destructive/5 border-destructive/20 text-foreground"
              }`}
            >
              {isChecking && (
                <div className="absolute inset-0 flex items-center justify-center bg-card/60 rounded-lg">
                  <div className="size-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                </div>
              )}
              <div className="space-y-1.5 font-mono">
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    ip:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success font-semibold"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.ip || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    loc:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.loc || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    city:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.city || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    country:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.country || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    timezone:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.timezone || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    zip_code:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.zip_code || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    name:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.name || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    asn:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.asn || "-"}
                  </span>
                </div>
                <div className="flex gap-2">
                  <span className="text-muted-foreground w-24 inline-block">
                    country_text:
                  </span>
                  <span
                    className={
                      checkResult?.is_valid
                        ? "text-success"
                        : "text-muted-foreground"
                    }
                  >
                    {checkResult?.country_text || "-"}
                  </span>
                </div>
              </div>
              {checkResult && !checkResult.is_valid && !isChecking && (
                <div className="mt-2 text-destructive font-semibold border-t border-destructive/10 pt-2">
                  Check Failed! Proxy connection is offline or invalid.
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-border pt-3 gap-2">
          <LoadingButton
            variant="outline"
            isLoading={isChecking}
            onClick={handleCheck}
            disabled={isSaving || !isFormValid}
            className="flex-1"
          >
            {t("proxies.quickEdit.checkButton")}
          </LoadingButton>
          <LoadingButton
            isLoading={isSaving}
            onClick={handleSave}
            disabled={isChecking || !isFormValid}
            className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          >
            {t("proxies.quickEdit.saveButton")}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
