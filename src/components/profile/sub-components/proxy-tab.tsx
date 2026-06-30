"use client";

import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { FaPlus } from "react-icons/fa";
import { LuCheck, LuChevronsUpDown } from "react-icons/lu";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StoredProxy, VpnConfig } from "@/types";

interface ProxyTabProps {
  storedProxies: StoredProxy[];
  vpnConfigs: VpnConfig[];
  selectedProxyId: string | undefined;
  setSelectedProxyId: (id: string | undefined) => void;
  setShowProxyForm: (show: boolean) => void;
}

export function ProxyTab({
  storedProxies,
  vpnConfigs,
  selectedProxyId,
  setSelectedProxyId,
  setShowProxyForm,
}: ProxyTabProps) {
  const { t } = useTranslation();
  const proxyListboxId = useId();
  const [proxyPopoverOpen, setProxyPopoverOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="space-y-1 pb-2">
        <h3 className="text-base font-bold">
          {t("createProfile.proxy.title")}
        </h3>
        <p className="text-xs text-muted-foreground">
          Select a proxy or a WireGuard VPN configuration for this profile.
        </p>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Connection Routing</Label>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowProxyForm(true)}
            className="h-8 px-2.5 text-xs gap-1.5 border-dashed"
          >
            <FaPlus className="size-2.5" />
            {t("createProfile.proxy.addProxy")}
          </Button>
        </div>
        {storedProxies.length > 0 || vpnConfigs.length > 0 ? (
          <Popover open={proxyPopoverOpen} onOpenChange={setProxyPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                role="combobox"
                aria-expanded={proxyPopoverOpen}
                aria-controls={proxyListboxId}
                className="w-full justify-between font-normal h-9 text-xs md:text-sm"
              >
                {(() => {
                  if (!selectedProxyId) return t("createProfile.proxy.noProxy");
                  if (selectedProxyId.startsWith("vpn-")) {
                    const vpn = vpnConfigs.find(
                      (v) => v.id === selectedProxyId.slice(4),
                    );
                    return vpn
                      ? `WG — ${vpn.name}`
                      : t("createProfile.proxy.noProxy");
                  }
                  const proxy = storedProxies.find(
                    (p) => p.id === selectedProxyId,
                  );
                  return proxy?.name ?? t("createProfile.proxy.noProxy");
                })()}
                <LuChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              id={proxyListboxId}
              className="w-[300px] p-0"
              sideOffset={8}
            >
              <Command>
                <CommandInput
                  placeholder={t("createProfile.proxy.search")}
                  className="h-9"
                />
                <CommandList>
                  <CommandEmpty>
                    {t("createProfile.proxy.notFound")}
                  </CommandEmpty>
                  <CommandGroup>
                    <CommandItem
                      value="__none__"
                      onSelect={() => {
                        setSelectedProxyId(undefined);
                        setProxyPopoverOpen(false);
                      }}
                    >
                      <LuCheck
                        className={cn(
                          "mr-2 size-4",
                          !selectedProxyId ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {t("common.labels.none")}
                    </CommandItem>
                    {storedProxies
                      .filter(
                        (proxy) =>
                          !proxy.is_profile_specific ||
                          selectedProxyId === proxy.id,
                      )
                      .map((proxy) => (
                        <CommandItem
                          key={proxy.id}
                          value={proxy.name}
                          onSelect={() => {
                            setSelectedProxyId(proxy.id);
                            setProxyPopoverOpen(false);
                          }}
                        >
                          <LuCheck
                            className={cn(
                              "mr-2 size-4",
                              selectedProxyId === proxy.id
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          {proxy.name}
                        </CommandItem>
                      ))}
                  </CommandGroup>
                  {vpnConfigs.length > 0 && (
                    <CommandGroup heading="VPNs">
                      {vpnConfigs.map((vpn) => (
                        <CommandItem
                          key={vpn.id}
                          value={`vpn-${vpn.name}`}
                          onSelect={() => {
                            setSelectedProxyId(`vpn-${vpn.id}`);
                            setProxyPopoverOpen(false);
                          }}
                        >
                          <LuCheck
                            className={cn(
                              "mr-2 size-4",
                              selectedProxyId === `vpn-${vpn.id}`
                                ? "opacity-100"
                                : "opacity-0",
                            )}
                          />
                          <Badge
                            variant="outline"
                            className="mr-2 px-1 py-0 text-[10px]"
                          >
                            WG
                          </Badge>
                          {vpn.name}
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        ) : (
          <div className="flex items-center justify-center border border-dashed rounded-lg p-6 text-center text-sm text-muted-foreground">
            {t("createProfile.proxy.noProxiesAvailable")}
          </div>
        )}
      </div>
    </div>
  );
}
