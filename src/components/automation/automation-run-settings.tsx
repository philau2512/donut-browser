"use client";

import { useTranslation } from "react-i18next";
import { AnimatedSwitch } from "@/components/ui/animated-switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RunSettings } from "@/types/automation-types";

interface AutomationRunSettingsProps {
  settings: RunSettings;
  onChange: (settings: RunSettings) => void;
  disabled?: boolean;
}

/**
 * RunSettings panel — mirrors Hidemium's Campaign Settings (MVP subset).
 * Window-tiling (screen arrangement / auto scale / set size) is deferred to
 * Phase 5, so it is intentionally absent here.
 */
export function AutomationRunSettings({
  settings,
  onChange,
  disabled = false,
}: AutomationRunSettingsProps) {
  const { t } = useTranslation();

  const setNumber = (key: "concurrency" | "delayOpenSecs", raw: string) => {
    const n = Number.parseInt(raw, 10);
    onChange({ ...settings, [key]: Number.isFinite(n) && n >= 0 ? n : 0 });
  };

  const toggle = (
    key:
      | "headless"
      | "closeOnComplete"
      | "writeLogs"
      | "noOverlapping"
      | "runWithoutProfile",
    value: boolean,
  ) => {
    onChange({ ...settings, [key]: value });
  };

  const setVirtualProfileCount = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    onChange({
      ...settings,
      virtualProfileCount: Number.isFinite(n) && n >= 1 ? n : 1,
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="automation-concurrency" className="text-xs">
            {t("automation.settings.concurrency")}
          </Label>
          <Input
            id="automation-concurrency"
            type="number"
            min={1}
            inputMode="numeric"
            value={settings.concurrency}
            disabled={disabled}
            onChange={(e) => setNumber("concurrency", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("automation.settings.concurrencyHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="automation-delay-open" className="text-xs">
            {t("automation.settings.delayOpen")}
          </Label>
          <Input
            id="automation-delay-open"
            type="number"
            min={0}
            inputMode="numeric"
            value={settings.delayOpenSecs}
            disabled={disabled}
            onChange={(e) => setNumber("delayOpenSecs", e.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            {t("automation.settings.delayOpenHint")}
          </p>
        </div>
      </div>

      <div className="space-y-2.5">
        <ToggleRow
          id="automation-headless"
          label={t("automation.settings.headless")}
          hint={t("automation.settings.headlessHint")}
          checked={settings.headless}
          disabled={disabled}
          onCheckedChange={(v) => toggle("headless", v)}
        />
        <ToggleRow
          id="automation-no-overlapping"
          label={t("automation.settings.noOverlapping")}
          hint={t("automation.settings.noOverlappingHint")}
          checked={settings.noOverlapping}
          disabled={disabled}
          onCheckedChange={(v) => toggle("noOverlapping", v)}
        />
        <ToggleRow
          id="automation-close-on-complete"
          label={t("automation.settings.closeOnComplete")}
          hint={t("automation.settings.closeOnCompleteHint")}
          checked={settings.closeOnComplete}
          disabled={disabled}
          onCheckedChange={(v) => toggle("closeOnComplete", v)}
        />
        <ToggleRow
          id="automation-write-logs"
          label={t("automation.settings.writeLogs")}
          hint={t("automation.settings.writeLogsHint")}
          checked={settings.writeLogs}
          disabled={disabled}
          onCheckedChange={(v) => toggle("writeLogs", v)}
        />
        <ToggleRow
          id="automation-run-without-profile"
          label="Chạy không cần Profile"
          hint="Tự sinh profile ảo tạm thời, ngẫu nhiên hóa vân tay và tự dọn dẹp sau khi chạy"
          checked={settings.runWithoutProfile || false}
          disabled={disabled}
          onCheckedChange={(v) => toggle("runWithoutProfile", v)}
        />

        {settings.runWithoutProfile && (
          <div className="space-y-1.5 pl-6 pt-1">
            <Label htmlFor="automation-virtual-count" className="text-xs">
              Số lượng luồng ảo chạy song song
            </Label>
            <Input
              id="automation-virtual-count"
              type="number"
              min={1}
              max={50}
              inputMode="numeric"
              value={settings.virtualProfileCount}
              disabled={disabled}
              onChange={(e) => setVirtualProfileCount(e.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              Mỗi luồng ảo sẽ tự động giả lập 1 profile riêng biệt.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (value: boolean) => void;
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  disabled,
  onCheckedChange,
}: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <AnimatedSwitch
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
