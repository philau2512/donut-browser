"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResourceDefinition } from "@/lib/automation/resource-schema";

interface ResourceSourceSectionProps {
  resource: ResourceDefinition;
  onChange: (patch: Partial<ResourceDefinition["source"]>) => void;
}

export function ResourceSourceSection({
  resource,
  onChange,
}: ResourceSourceSectionProps) {
  const sourceMode = resource.source.kind === "file" ? "from_file" : "text";

  return (
    <section className="grid grid-cols-[220px_1fr_220px] border-b border-zinc-700">
      <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-5 text-sm text-zinc-200">
        1. Lấy link từ:
      </div>
      <div className="space-y-3 border-r border-zinc-700 px-5 py-5">
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="radio"
            checked={sourceMode === "text"}
            onChange={() => onChange({ kind: "static" })}
            className="accent-purple-500"
          />
          text
        </label>
        <label className="flex items-center gap-2 text-sm text-zinc-200">
          <input
            type="radio"
            checked={sourceMode === "from_file"}
            onChange={() => onChange({ kind: "file" })}
            className="accent-purple-500"
          />
          from_file
        </label>
      </div>
      <div className="px-5 py-5 text-xs text-zinc-500">
        Preview:{" "}
        {resource.name ? `{{resource:${resource.name}}}` : "{{resource:name}}"}
      </div>

      <div className="flex items-center justify-end border-r border-zinc-700 px-5 py-5 text-sm text-zinc-200">
        1.1 Nhập link ref:
      </div>
      <div className="border-r border-zinc-700 px-5 py-5">
        {sourceMode === "text" ? (
          <textarea
            value={(resource.source.inlineItems ?? []).join("\n")}
            onChange={(event) =>
              onChange({
                kind: "static",
                inlineItems: event.target.value
                  .split("\n")
                  .map((line) => line.trim())
                  .filter(Boolean),
              })
            }
            className="min-h-24 w-full resize-y rounded border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-zinc-100 outline-none focus:border-purple-500"
            placeholder="https://example.com/login"
          />
        ) : (
          <div className="space-y-2">
            <Label className="text-xs text-zinc-400">File path</Label>
            <Input
              value={resource.source.path ?? ""}
              onChange={(event) =>
                onChange({ kind: "file", path: event.target.value })
              }
              className="h-8 border-zinc-700 bg-zinc-950 font-mono text-xs text-zinc-100"
              placeholder="D:\\data\\resource.txt"
            />
          </div>
        )}
      </div>
      <div className="px-5 py-5 text-xs text-zinc-500">
        One item per line. Raw values are masked in reports.
      </div>
    </section>
  );
}
