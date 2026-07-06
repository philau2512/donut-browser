"use client";

import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";

interface ResourceAdvancedSettingsProps {
  res: ResourceDefinition;
  previewValues: Record<string, string>;
  setPreviewValues: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  onUpdateResource?: (updatedFields: Partial<ResourceDefinition>) => void;
}

export function ResourceAdvancedSettings({
  res,
  previewValues,
  setPreviewValues,
  onUpdateResource,
}: ResourceAdvancedSettingsProps) {
  return (
    <div className="w-full space-y-2 text-zinc-300 text-xs">
      {/* Row 1: Filenames or directory */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Filenames or directory
        </span>
        <div
          className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate relative group/file"
          title={previewValues[res.name] || res.source.path || ""}
        >
          <span className="truncate mr-14">
            {previewValues[res.name] || res.source.path
              ? (previewValues[res.name] || res.source.path || "")
                  .split(/[\\/]/)
                  .pop()
              : res.wizardType === "LinesFromFile"
                ? "No file chosen"
                : "No folder chosen"}
          </span>
          <Button
            type="button"
            variant="ghost"
            onClick={async (e) => {
              e.stopPropagation();
              try {
                const isDir = res.wizardType === "FilesFromDirectory";
                const selected = await openTauriDialog({
                  directory: isDir,
                  multiple: false,
                  title: isDir
                    ? `Select Folder for ${res.name}`
                    : `Select File for ${res.name}`,
                  ...(!isDir && {
                    filters: [
                      {
                        name: "Text Files",
                        extensions: ["txt", "csv", "log"],
                      },
                    ],
                  }),
                });
                if (selected && typeof selected === "string") {
                  setPreviewValues((prev) => ({
                    ...prev,
                    [res.name]: selected,
                  }));
                  onUpdateResource?.({
                    source: {
                      kind: "file",
                      path: selected,
                    },
                  });
                }
              } catch (err) {
                console.error("Failed to select source path:", err);
              }
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            className="absolute right-1 top-[2px] h-[22px] text-[10px] text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded px-1.5 transition shrink-0 font-sans"
          >
            Browse
          </Button>
        </div>
      </div>

      {/* Row 2: Read file */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">Read file</span>
        <input
          type="checkbox"
          checked={res.fileBehavior?.readFile ?? false}
          onChange={(e) => {
            onUpdateResource?.({
              fileBehavior: {
                ...(res.fileBehavior || {}),
                readFile: e.target.checked,
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>

      {/* Row 3: Write file */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">Write file</span>
        <input
          type="checkbox"
          checked={res.fileBehavior?.writeFile ?? false}
          onChange={(e) => {
            onUpdateResource?.({
              fileBehavior: {
                ...(res.fileBehavior || {}),
                writeFile: e.target.checked,
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>

      {/* Row 4: Mix lines */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">Mix lines</span>
        <input
          type="checkbox"
          checked={res.mode?.selection === "mix"}
          onChange={(e) => {
            onUpdateResource?.({
              mode: {
                ...(res.mode || {}),
                selection: e.target.checked ? "mix" : "sequential",
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>

      {/* Row 5: Max success usage */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Max success usage
        </span>
        <input
          type="number"
          value={res.limits?.maxSuccessUsage ?? 0}
          onChange={(e) => {
            onUpdateResource?.({
              limits: {
                ...(res.limits || {}),
                maxSuccessUsage: Math.max(0, parseInt(e.target.value, 10) || 0),
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-24 outline-none rounded focus:border-zinc-700"
        />
      </div>

      {/* Row 6: Max fail usage */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Max fail usage
        </span>
        <input
          type="number"
          value={res.limits?.maxFailUsage ?? 0}
          onChange={(e) => {
            onUpdateResource?.({
              limits: {
                ...(res.limits || {}),
                maxFailUsage: Math.max(0, parseInt(e.target.value, 10) || 0),
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-24 outline-none rounded focus:border-zinc-700"
        />
      </div>

      {/* Row 7: Max number of simultaneous use */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Max number of simultaneous use
        </span>
        <input
          type="number"
          value={res.limits?.maxSimultaneousUse ?? 1}
          onChange={(e) => {
            onUpdateResource?.({
              limits: {
                ...(res.limits || {}),
                maxSimultaneousUse: Math.max(
                  1,
                  parseInt(e.target.value, 10) || 1,
                ),
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-24 outline-none rounded focus:border-zinc-700"
        />
      </div>

      {/* Row 8: Interval between usage (millisecond) */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Interval between usage(millisecond)
        </span>
        <input
          type="number"
          value={res.limits?.intervalBetweenUsageMs ?? 0}
          onChange={(e) => {
            onUpdateResource?.({
              limits: {
                ...(res.limits || {}),
                intervalBetweenUsageMs: Math.max(
                  0,
                  parseInt(e.target.value, 10) || 0,
                ),
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-24 outline-none rounded focus:border-zinc-700"
        />
      </div>

      {/* Row 9: Greedy algorithm */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Greedy algorithm
        </span>
        <input
          type="checkbox"
          checked={res.mode?.greedy ?? false}
          onChange={(e) => {
            onUpdateResource?.({
              mode: {
                ...(res.mode || {}),
                greedy: e.target.checked,
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>

      {/* Row 10: Reload periodically */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Reload periodically
        </span>
        <input
          type="checkbox"
          checked={res.fileBehavior?.reloadPeriodically ?? false}
          onChange={(e) => {
            onUpdateResource?.({
              fileBehavior: {
                ...(res.fileBehavior || {}),
                reloadPeriodically: e.target.checked,
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>

      {/* Row 11: Renew periodically */}
      <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
        <span className="text-right text-zinc-400 select-none">
          Renew periodically
        </span>
        <input
          type="checkbox"
          checked={res.fileBehavior?.renewPeriodically ?? false}
          onChange={(e) => {
            onUpdateResource?.({
              fileBehavior: {
                ...(res.fileBehavior || {}),
                renewPeriodically: e.target.checked,
              } as any,
            });
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-650 cursor-pointer"
        />
      </div>
    </div>
  );
}
