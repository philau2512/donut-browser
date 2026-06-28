"use client";

import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Label } from "@/components/ui/label";

interface BatchOptionsSectionProps {
  randomizePerProfile: boolean;
  setRandomizePerProfile: (enabled: boolean) => void;
  proxyList: string;
  setProxyList: (list: string) => void;
}

/**
 * Batch creation options section: randomize toggle, proxy rotation textarea.
 * Extracted from create-profile-dialog.tsx to reduce dialog complexity.
 */
export function BatchOptionsSection({
  randomizePerProfile,
  setRandomizePerProfile,
  proxyList,
  setProxyList,
}: BatchOptionsSectionProps) {
  return (
    <div className="space-y-4 rounded-lg border bg-muted/10 p-4">
      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Batch Creation Options</h4>
        <p className="text-xs text-muted-foreground">
          Configure per-profile fingerprint randomization and proxy rotation for
          anti-detect batch creation.
        </p>
      </div>

      {/* Randomize per profile toggle */}
      <div className="flex items-center justify-between">
        <div className="space-y-0.5">
          <Label className="text-sm">Randomize fingerprint per profile</Label>
          <p className="text-xs text-muted-foreground">
            Each profile in the batch gets a unique fingerprint (recommended for
            anti-detect)
          </p>
        </div>
        <AnimatedSwitch
          checked={randomizePerProfile}
          onCheckedChange={setRandomizePerProfile}
        />
      </div>

      {/* Proxy rotation textarea */}
      <div className="space-y-2">
        <Label htmlFor="proxy-rotation-list" className="text-sm">
          Proxy Rotation (one per line, optional)
        </Label>
        <textarea
          id="proxy-rotation-list"
          value={proxyList}
          onChange={(e) => setProxyList(e.target.value)}
          placeholder="http://proxy1:8080&#10;http://proxy2:8080&#10;socks5://proxy3:1080"
          className="w-full h-24 rounded-md border bg-background px-3 py-2 text-xs font-mono resize-y"
        />
        <p className="text-xs text-muted-foreground">
          Proxies will be assigned round-robin across the batch. Leave empty to
          use no proxy.
        </p>
      </div>
    </div>
  );
}
