"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
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
    <section className="grid grid-cols-4 border-b border-zinc-700 text-sm">
      <NumberCell
        label="Max success usage"
        value={limits.maxSuccessUsage}
        min={0}
        onChange={(value) => onChange({ maxSuccessUsage: value })}
      />
      <NumberCell
        label="Max fail usage"
        value={limits.maxFailUsage}
        min={0}
        onChange={(value) => onChange({ maxFailUsage: value })}
      />
      <NumberCell
        label="Max simultaneous use"
        value={limits.maxSimultaneousUse}
        min={1}
        onChange={(value) => onChange({ maxSimultaneousUse: value })}
      />
      <NumberCell
        label="Interval between usage (ms)"
        value={limits.intervalBetweenUsageMs}
        min={0}
        onChange={(value) => onChange({ intervalBetweenUsageMs: value })}
      />
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
    <label
      htmlFor={inputId}
      className="space-y-2 border-r border-zinc-700 px-5 py-4 last:border-r-0"
    >
      <span className="block text-xs text-zinc-400">{label}</span>
      <Input
        id={inputId}
        type="number"
        min={min}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100"
      />
    </label>
  );
}
