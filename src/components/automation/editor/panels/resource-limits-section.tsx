"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResourceDefinition } from "@/lib/automation/resource-schema";

interface ResourceLimitsSectionProps {
  limits: ResourceDefinition["limits"];
  onChange: (patch: Partial<ResourceDefinition["limits"]>) => void;
}

export function ResourceLimitsSection({
  limits,
  onChange,
}: ResourceLimitsSectionProps) {
  return (
    <section className="grid grid-cols-[220px_1fr_220px] border-b border-zinc-700">
      <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-5 text-sm text-zinc-200">
        Resource limits:
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 border-r border-zinc-700 px-5 py-5">
        <NumberCell
          label="Max success"
          value={limits.maxSuccessUsage}
          min={0}
          onChange={(value) => onChange({ maxSuccessUsage: value })}
        />
        <NumberCell
          label="Max fail"
          value={limits.maxFailUsage}
          min={0}
          onChange={(value) => onChange({ maxFailUsage: value })}
        />
        <NumberCell
          label="Max concurrent"
          value={limits.maxSimultaneousUse}
          min={1}
          onChange={(value) => onChange({ maxSimultaneousUse: value })}
        />
        <NumberCell
          label="Cooldown (ms)"
          value={limits.intervalBetweenUsageMs}
          min={0}
          onChange={(value) => onChange({ intervalBetweenUsageMs: value })}
        />
      </div>
      <div className="px-5 py-5 text-xs text-zinc-500">
        Set success/fail quotas, concurrency limits, and reuse cooldowns.
      </div>
    </section>
  );
}

function NumberCell({
  label,
  value,
  min,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  onChange: (value: number) => void;
}) {
  const inputId = useId();

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={inputId}
        className="text-[10px] text-zinc-400 font-medium"
      >
        {label}
      </Label>
      <Input
        id={inputId}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100 focus-visible:ring-purple-500"
      />
    </div>
  );
}
