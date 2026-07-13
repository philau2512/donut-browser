"use client";

import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { useTranslation } from "react-i18next";
import { LuInfo } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";

interface ResourceAdvancedSettingsProps {
  res: ResourceDefinition;
  previewValues: Record<string, string>;
  setPreviewValues: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  onUpdateResource?: (updatedFields: Partial<ResourceDefinition>) => void;
}

const AdvancedLabel = ({
  label,
  tooltip,
}: {
  label: string;
  tooltip: string;
}) => (
  <div className="flex items-center justify-end gap-1.5 text-right text-zinc-400 select-none cursor-help">
    <span className="truncate">{label}</span>
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <button
          type="button"
          tabIndex={-1}
          className="p-0.5 border-0 bg-transparent text-zinc-500 hover:text-zinc-300 transition-colors focus:outline-none cursor-help"
          onClick={(e) => e.stopPropagation()}
        >
          <LuInfo className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        sideOffset={6}
        className="bg-zinc-950 border border-zinc-800 text-zinc-300 text-xs px-2.5 py-1.5 max-w-xs shadow-lg rounded"
      >
        {tooltip}
      </TooltipContent>
    </Tooltip>
  </div>
);

export function ResourceAdvancedSettings({
  res,
  previewValues,
  setPreviewValues,
  onUpdateResource,
}: ResourceAdvancedSettingsProps) {
  const { t } = useTranslation();

  return (
    <TooltipProvider delayDuration={150}>
      <div className="w-full space-y-2 text-zinc-300 text-xs">
        {/* Row 1: Filenames or directory */}
        <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
          <AdvancedLabel
            label="Filenames or directory"
            tooltip={t("automation.editor.resources.advanced.filenames")}
          />
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
          <AdvancedLabel
            label="Read file"
            tooltip={t("automation.editor.resources.advanced.readFile")}
          />
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
          <AdvancedLabel
            label="Write file"
            tooltip={t("automation.editor.resources.advanced.writeFile")}
          />
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
          <AdvancedLabel
            label="Mix lines"
            tooltip={t("automation.editor.resources.advanced.mix")}
          />
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
          <AdvancedLabel
            label="Max success usage"
            tooltip={t("automation.editor.resources.advanced.maxSuccess")}
          />
          <input
            type="number"
            value={res.limits?.maxSuccessUsage ?? 0}
            onChange={(e) => {
              onUpdateResource?.({
                limits: {
                  ...(res.limits || {}),
                  maxSuccessUsage: Math.max(
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

        {/* Row 6: Max fail usage */}
        <div className="grid grid-cols-[160px_1fr] gap-2 items-center">
          <AdvancedLabel
            label="Max fail usage"
            tooltip={t("automation.editor.resources.advanced.maxFail")}
          />
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
          <AdvancedLabel
            label="Max number of simultaneous use"
            tooltip={t("automation.editor.resources.advanced.maxSimultaneous")}
          />
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
          <AdvancedLabel
            label="Interval between usage(millisecond)"
            tooltip={t("automation.editor.resources.advanced.interval")}
          />
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
          <AdvancedLabel
            label="Greedy algorithm"
            tooltip={t("automation.editor.resources.advanced.greedy")}
          />
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
        <div className="grid grid-cols-[160px_1fr] gap-2 items-start">
          <AdvancedLabel
            label="Reload periodically"
            tooltip={t("automation.editor.resources.advanced.reload")}
          />
          <div className="space-y-1">
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
              className="size-4 accent-purple-650 cursor-pointer block"
            />
            {res.fileBehavior?.reloadPeriodically && (
              <p className="text-[10px] text-amber-500 font-sans italic leading-tight">
                Notice: Periodic file monitoring is active. Changes made to the
                external file will be reloaded into the flow automatically.
              </p>
            )}
          </div>
        </div>

        {/* Row 11: Renew periodically */}
        <div className="grid grid-cols-[160px_1fr] gap-2 items-start">
          <AdvancedLabel
            label="Renew periodically"
            tooltip={t("automation.editor.resources.advanced.renew")}
          />
          <div className="space-y-1">
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
              className="size-4 accent-purple-650 cursor-pointer block"
            />
            {res.fileBehavior?.renewPeriodically && (
              <p className="text-[10px] text-amber-500 font-sans italic leading-tight">
                Notice: Quotas for used items (success/fail count) will be
                automatically reset to available state every 30 seconds.
              </p>
            )}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
