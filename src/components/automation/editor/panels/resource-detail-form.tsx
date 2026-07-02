"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  ResourceDefinition,
  ResourceDirection,
  ResourceType,
  SelectionStrategy,
} from "@/lib/automation/resource-schema";
import { ResourceLimitsSection } from "./resource-limits-section";
import { ResourceSourceSection } from "./resource-source-section";

interface ResourceDetailFormProps {
  resource: ResourceDefinition | null;
  onChange: (resource: ResourceDefinition) => void;
}

export function ResourceDetailForm({
  resource,
  onChange,
}: ResourceDetailFormProps) {
  if (!resource) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Select or create a resource to configure.
      </div>
    );
  }

  const update = (patch: Partial<ResourceDefinition>) => {
    onChange({ ...resource, ...patch });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-zinc-900 text-zinc-100">
      <section className="grid grid-cols-[220px_1fr_220px] border-b border-zinc-700">
        <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-4 text-sm text-zinc-200">
          Resource name:
        </div>
        <div className="grid grid-cols-2 gap-4 border-r border-zinc-700 px-5 py-4">
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Name</Label>
            <Input
              value={resource.name}
              onChange={(event) => update({ name: event.target.value })}
              className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100"
              placeholder="data_input"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">Syntax</Label>
            <div className="flex h-8 items-center rounded border border-zinc-700 bg-zinc-950 px-3 font-mono text-xs text-blue-300">
              {resource.name
                ? `{{resource:${resource.name}}}`
                : "{{resource:name}}"}
            </div>
          </div>
        </div>
        <div className="px-5 py-4 text-xs text-zinc-500">
          This name is used in node params as a resource reference.
        </div>
      </section>

      <section className="grid grid-cols-[220px_1fr_220px] border-b border-zinc-700">
        <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-4 text-sm text-zinc-200">
          Resource options:
        </div>
        <div className="grid grid-cols-3 gap-4 border-r border-zinc-700 px-5 py-4">
          <SelectField
            label="Type"
            value={resource.type}
            onValueChange={(value) => update({ type: value as ResourceType })}
            options={["line-pool", "proxy-pool", "file", "custom"]}
          />
          <SelectField
            label="Direction"
            value={resource.direction}
            onValueChange={(value) =>
              update({ direction: value as ResourceDirection })
            }
            options={["input", "output", "read-write"]}
          />
          <SelectField
            label="Selection"
            value={resource.mode.selection}
            onValueChange={(value) =>
              update({
                mode: {
                  ...resource.mode,
                  selection: value as SelectionStrategy,
                },
              })
            }
            options={["sequential", "random", "rotate", "mix"]}
          />
        </div>
        <div className="px-5 py-4 text-xs text-zinc-500">
          Output resources are write targets and are not allocated as input
          pool.
        </div>
      </section>

      <ResourceSourceSection
        resource={resource}
        onChange={(sourcePatch) =>
          update({ source: { ...resource.source, ...sourcePatch } })
        }
      />

      <section className="grid grid-cols-[220px_1fr_220px] border-b border-zinc-700">
        <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-5 text-sm text-zinc-200">
          use_other_data
        </div>
        <div className="space-y-3 border-r border-zinc-700 px-5 py-5">
          <YesNoRow
            label="Greedy algorithm"
            value={resource.mode.greedy}
            onChange={(value) =>
              update({ mode: { ...resource.mode, greedy: value } })
            }
          />
          <YesNoRow
            label="Read file"
            value={resource.fileBehavior.readFile}
            onChange={(value) =>
              update({
                fileBehavior: { ...resource.fileBehavior, readFile: value },
              })
            }
          />
          <YesNoRow
            label="Write file"
            value={resource.fileBehavior.writeFile}
            onChange={(value) =>
              update({
                fileBehavior: { ...resource.fileBehavior, writeFile: value },
              })
            }
          />
          <YesNoRow
            label="Reload periodically"
            value={resource.fileBehavior.reloadPeriodically}
            onChange={(value) =>
              update({
                fileBehavior: {
                  ...resource.fileBehavior,
                  reloadPeriodically: value,
                },
              })
            }
          />
          <YesNoRow
            label="Renew periodically"
            value={resource.fileBehavior.renewPeriodically}
            onChange={(value) =>
              update({
                fileBehavior: {
                  ...resource.fileBehavior,
                  renewPeriodically: value,
                },
              })
            }
          />
        </div>
        <div className="px-5 py-5 text-xs text-zinc-500">
          YES/NO options map to runtime allocation, reload and write behavior.
        </div>
      </section>

      <ResourceLimitsSection
        limits={resource.limits}
        onChange={(limitsPatch) =>
          update({ limits: { ...resource.limits, ...limitsPatch } })
        }
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onValueChange,
  options,
}: {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  options: string[];
}) {
  return (
    <div className="space-y-2">
      <Label className="text-xs text-zinc-400">{label}</Label>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="h-8 border-zinc-700 bg-zinc-950 text-xs text-zinc-100">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function YesNoRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-[180px_120px_120px] items-center gap-4 text-sm text-zinc-200">
      <span className="text-right text-zinc-300">{label}</span>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={value}
          onChange={() => onChange(true)}
          className="accent-purple-500"
        />
        YES
      </label>
      <label className="flex items-center gap-2">
        <input
          type="radio"
          checked={!value}
          onChange={() => onChange(false)}
          className="accent-purple-500"
        />
        NO
      </label>
    </div>
  );
}
