"use client";

import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";
import { ResourceAdvancedSettings } from "./resource-advanced-settings";

interface ResourceControlPreviewProps {
  res: ResourceDefinition;
  previewValues: Record<string, string>;
  setPreviewValues: React.Dispatch<
    React.SetStateAction<Record<string, string>>
  >;
  showAdvanced?: boolean;
  onUpdateResource?: (updatedFields: Partial<ResourceDefinition>) => void;
}

export function ResourceControlPreview({
  res,
  previewValues,
  setPreviewValues,
  showAdvanced = false,
  onUpdateResource,
}: ResourceControlPreviewProps) {
  const inlineItems = res.source.inlineItems ?? [];

  if (res.wizardType === "Checkbox") {
    return (
      <div className="flex items-center gap-2 select-none">
        <input
          type="checkbox"
          checked={
            (previewValues[res.name] ??
              (res.defaultValue === "true" || inlineItems[0] === "true"
                ? "true"
                : "false")) === "true"
          }
          onChange={(e) => {
            setPreviewValues((prev) => ({
              ...prev,
              [res.name]: e.target.checked ? "true" : "false",
            }));
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          className="size-4 accent-purple-600 cursor-pointer"
        />
        <span className="text-xs text-zinc-400">
          {(previewValues[res.name] ??
            (res.defaultValue === "true" || inlineItems[0] === "true"
              ? "true"
              : "false")) === "true"
            ? "true"
            : "false"}
        </span>
      </div>
    );
  }

  if (res.wizardType === "Select") {
    return (
      <div className="w-full space-y-1">
        {res.selectType === "Radio" ? (
          <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
            {inlineItems.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none"
              >
                <input
                  type="radio"
                  name={`preview-${res.id}`}
                  checked={
                    (previewValues[res.name] ??
                      res.selectDefaultValue ??
                      res.defaultValue ??
                      inlineItems[0] ??
                      "") === opt
                  }
                  onChange={() => {
                    setPreviewValues((prev) => ({
                      ...prev,
                      [res.name]: opt,
                    }));
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="size-3 accent-purple-600"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        ) : res.selectType === "Check" ? (
          <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
            {inlineItems.map((opt) => (
              <label
                key={opt}
                className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none"
              >
                <input
                  type="checkbox"
                  checked={(
                    (previewValues[res.name] ??
                      res.selectDefaultValue ??
                      res.defaultValue ??
                      "") ||
                    ""
                  )
                    .split(",")
                    .includes(opt)}
                  onChange={(e) => {
                    setPreviewValues((prev) => {
                      const currentList = (
                        prev[res.name] ??
                        res.selectDefaultValue ??
                        res.defaultValue ??
                        ""
                      )
                        .split(",")
                        .filter(Boolean);
                      let newList;
                      if (e.target.checked) {
                        newList = [...currentList, opt];
                      } else {
                        newList = currentList.filter((x) => x !== opt);
                      }
                      return {
                        ...prev,
                        [res.name]: newList.join(","),
                      };
                    });
                  }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                  className="size-3 accent-purple-600"
                />
                <span className="truncate">{opt}</span>
              </label>
            ))}
          </div>
        ) : (
          // Default/Combo dropdown
          <select
            value={
              previewValues[res.name] ??
              res.selectDefaultValue ??
              res.defaultValue ??
              inlineItems[0] ??
              ""
            }
            onChange={(e) => {
              setPreviewValues((prev) => ({
                ...prev,
                [res.name]: e.target.value,
              }));
            }}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
            className="h-7 px-2 border border-zinc-800 bg-zinc-950 text-xs text-zinc-300 w-full outline-none rounded focus:border-zinc-700 cursor-pointer"
          >
            {inlineItems.map((opt) => (
              <option
                key={opt}
                value={opt}
                className="bg-zinc-900 text-zinc-300"
              >
                {opt}
              </option>
            ))}
          </select>
        )}
      </div>
    );
  }

  if (res.wizardType === "LinesFromFile" && !showAdvanced) {
    return (
      <div
        className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate relative group/file"
        title={previewValues[res.name] || res.source.path || ""}
      >
        <span className="truncate mr-14">
          {previewValues[res.name] || res.source.path
            ? (previewValues[res.name] || res.source.path || "")
                .split(/[\\/]/)
                .pop()
            : "No file chosen"}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={async (e) => {
            e.stopPropagation();
            try {
              const selected = await openTauriDialog({
                directory: false,
                multiple: false,
                title: `Select File for ${res.name}`,
                filters: [
                  {
                    name: "Text Files",
                    extensions: ["txt", "csv", "log"],
                  },
                ],
              });
              if (selected && typeof selected === "string") {
                setPreviewValues((prev) => ({
                  ...prev,
                  [res.name]: selected,
                }));
              }
            } catch (err) {
              console.error("Failed to select file:", err);
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute right-1 top-[2px] h-[22px] text-[10px] text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded px-1.5 transition shrink-0 font-sans"
        >
          Browse
        </Button>
      </div>
    );
  }

  if (res.wizardType === "FilesFromDirectory" && !showAdvanced) {
    return (
      <div
        className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate relative group/dir"
        title={previewValues[res.name] || res.source.path || ""}
      >
        <span className="truncate mr-14">
          {previewValues[res.name] || res.source.path
            ? (previewValues[res.name] || res.source.path || "")
                .split(/[\\/]/)
                .pop()
            : "No folder chosen"}
        </span>
        <Button
          type="button"
          variant="ghost"
          onClick={async (e) => {
            e.stopPropagation();
            try {
              const selected = await openTauriDialog({
                directory: true,
                multiple: false,
                title: `Select Folder for ${res.name}`,
              });
              if (selected && typeof selected === "string") {
                setPreviewValues((prev) => ({
                  ...prev,
                  [res.name]: selected,
                }));
              }
            } catch (err) {
              console.error("Failed to select directory:", err);
            }
          }}
          onDoubleClick={(e) => e.stopPropagation()}
          className="absolute right-1 top-[2px] h-[22px] text-[10px] text-zinc-400 hover:text-white bg-zinc-900 border border-zinc-800 rounded px-1.5 transition shrink-0 font-sans"
        >
          Browse
        </Button>
      </div>
    );
  }

  if (
    showAdvanced &&
    (res.wizardType === "LinesFromFile" ||
      res.wizardType === "FilesFromDirectory")
  ) {
    return (
      <ResourceAdvancedSettings
        res={res}
        previewValues={previewValues}
        setPreviewValues={setPreviewValues}
        onUpdateResource={onUpdateResource}
      />
    );
  }

  if (res.wizardType === "LinesFromUrl") {
    return (
      <div
        className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate"
        title={res.source.path || ""}
      >
        <span className="truncate">
          {res.source.path || "No URL specified"}
        </span>
        <span className="text-[10px] text-blue-500 bg-blue-950/20 border border-blue-900/30 rounded px-1 shrink-0 ml-1">
          URL
        </span>
      </div>
    );
  }

  if (res.wizardType === "Database") {
    return (
      <div
        className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 font-mono w-full truncate"
        title={inlineItems[0] || ""}
      >
        <span className="truncate">{inlineItems[0] || "No connection"}</span>
        <span className="text-[10px] text-amber-500 bg-amber-950/20 border border-amber-900/30 rounded px-1 shrink-0 ml-1">
          DB
        </span>
      </div>
    );
  }

  if (res.wizardType === "Information") {
    return (
      <div
        className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-400 w-full truncate"
        title={inlineItems[0] || ""}
      >
        <span className="truncate italic text-zinc-500">
          {inlineItems[0] || "Info message"}
        </span>
        <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1 shrink-0 ml-1">
          Info
        </span>
      </div>
    );
  }

  // Generic values inputs (FixedString, FixedInteger, etc)
  return (
    <div className="h-7 px-2 border border-zinc-800 bg-zinc-950/80 rounded flex items-center justify-between text-xs text-zinc-300 w-full">
      {res.wizardType === "FixedString" || res.wizardType === "RandomString" ? (
        <input
          type="text"
          value={previewValues[res.name] ?? ""}
          onChange={(e) => {
            setPreviewValues((prev) => ({
              ...prev,
              [res.name]: e.target.value,
            }));
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          placeholder="Enter value..."
          className="bg-transparent border-0 outline-none w-full text-zinc-300 placeholder-zinc-650 h-full py-1 text-xs"
        />
      ) : res.wizardType === "FixedInteger" ||
        res.wizardType === "RandomInteger" ? (
        <input
          type="number"
          value={previewValues[res.name] ?? ""}
          onChange={(e) => {
            setPreviewValues((prev) => ({
              ...prev,
              [res.name]: e.target.value,
            }));
          }}
          onClick={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          placeholder="Enter number..."
          className="bg-transparent border-0 outline-none w-full text-zinc-300 placeholder-zinc-650 h-full py-1 text-xs"
        />
      ) : (
        <span className="truncate text-zinc-400">
          {res.defaultValue ||
            (res.minInteger !== undefined &&
            res.wizardType !== "FixedString" &&
            res.wizardType !== "RandomString"
              ? `[${res.minInteger} .. ${res.maxInteger}]`
              : inlineItems[0]) ||
            "empty"}
        </span>
      )}
      {res.wizardType !== "FixedString" &&
        res.wizardType !== "RandomString" &&
        res.wizardType !== "FixedInteger" &&
        res.wizardType !== "RandomInteger" && (
          <span className="text-[10px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded px-1 shrink-0 ml-1">
            Value
          </span>
        )}
    </div>
  );
}
