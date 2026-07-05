"use client";

import { open as openTauriDialog } from "@tauri-apps/plugin-dialog";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";

interface EditResourceDialogProps {
  open: boolean;
  resource: ResourceDefinition | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (updatedResource: ResourceDefinition) => void;
}

export function EditResourceDialog({
  open,
  resource,
  onOpenChange,
  onConfirm,
}: EditResourceDialogProps) {
  const { t } = useTranslation();

  // State
  const [name, setName] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [descriptionRu, setDescriptionRu] = useState("");
  const [lang, setLang] = useState<"en" | "ru">("en");
  const [wizardType, setWizardType] = useState("FixedString");
  const [enableHint, setEnableHint] = useState(false);

  // Read/write modes
  const [readWriteMode, setReadWriteMode] = useState<
    "read" | "read-delete" | "write"
  >("read");
  const [mixLines, setMixLines] = useState(false);

  // Type-specific properties
  const [defaultValue, setDefaultValue] = useState("");
  const [notEmpty, setNotEmpty] = useState(false);
  const [multiline, setMultiline] = useState(false);
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const [selectOptions, setSelectOptions] = useState("");
  const [selectType, setSelectType] = useState<
    "Combo" | "Radio" | "Check" | "DragAndDrop"
  >("Combo");
  const [selectDefaultValue, setSelectDefaultValue] = useState("");
  const [checkboxDefault, setCheckboxDefault] = useState(false);
  const [dbConnection, setDbConnection] = useState("");
  const [infoMessage, setInfoMessage] = useState("");
  const [minInteger, setMinInteger] = useState(0);
  const [maxInteger, setMaxInteger] = useState(100);

  // UI States
  const [showValues, setShowValues] = useState(true);

  // Load resource data when opened
  useEffect(() => {
    if (!open || !resource) return;

    setName(resource.name);
    setDescriptionEn(resource.descriptionEn ?? "");
    setDescriptionRu(resource.descriptionRu ?? "");
    setEnableHint(resource.enableHint ?? false);
    setWizardType(resource.wizardType ?? "FixedString");
    setLang("en");

    const fileMode =
      resource.fileBehavior.readFile && resource.fileBehavior.writeFile
        ? "read-write"
        : resource.fileBehavior.writeFile
          ? "write"
          : "read";
    setReadWriteMode(fileMode as any);
    setMixLines(resource.mode.selection === "mix");

    setDefaultValue(resource.defaultValue ?? "");
    setNotEmpty(resource.notEmpty ?? false);
    setMultiline(resource.multiline ?? false);
    setFilePath(resource.source.path ?? "");
    setUrl(resource.source.path ?? "");

    if (resource.wizardType === "Select") {
      setSelectOptions((resource.source.inlineItems ?? []).join("\n"));
      setSelectType((resource.selectType as any) ?? "Combo");
      setSelectDefaultValue(resource.selectDefaultValue ?? "");
    } else {
      setSelectOptions("");
      setSelectType("Combo");
      setSelectDefaultValue("");
    }

    setCheckboxDefault(
      resource.defaultValue === "true" ||
        resource.source.inlineItems?.[0] === "true",
    );
    setDbConnection(resource.source.inlineItems?.[0] ?? "");
    setInfoMessage(resource.source.inlineItems?.[0] ?? "");
    setMinInteger(resource.minInteger ?? 0);
    setMaxInteger(resource.maxInteger ?? 100);
    setShowValues(true);
  }, [open, resource]);

  const parsedSelectOptions = useMemo(() => {
    return selectOptions
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }, [selectOptions]);

  const handleBrowseFile = async () => {
    try {
      const selected = await openTauriDialog({
        directory: false,
        multiple: false,
        title: "Select Resource File",
        filters: [{ name: "Text Files", extensions: ["txt", "csv", "log"] }],
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
      }
    } catch (error) {
      console.error("Failed to open file dialog:", error);
    }
  };

  const handleBrowseDirectory = async () => {
    try {
      const selected = await openTauriDialog({
        directory: true,
        multiple: false,
        title: "Select Resource Directory",
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
      }
    } catch (error) {
      console.error("Failed to open folder dialog:", error);
    }
  };

  const handleSave = () => {
    if (!resource) return;

    // Map wizardType to schema ResourceType
    let schemaType: ResourceDefinition["type"] = "line-pool";
    if (wizardType === "LinesFromFile" || wizardType === "FilesFromDirectory") {
      schemaType = "file";
    } else if (wizardType === "LinesFromUrl") {
      schemaType = "custom";
    }

    // Map readWriteMode to schema ResourceDirection
    let direction: ResourceDefinition["direction"] = "input";
    if (readWriteMode === "write") {
      direction = "output";
    } else if (readWriteMode === "read-delete") {
      direction = "input";
    }

    // Source properties
    let kind: "static" | "file" = "static";
    let path;
    let inlineItems: string[] = [];

    if (wizardType === "LinesFromFile" || wizardType === "FilesFromDirectory") {
      kind = "file";
      path = filePath;
    } else if (wizardType === "LinesFromUrl") {
      kind = "file";
      path = url;
    } else if (wizardType === "Select") {
      kind = "static";
      inlineItems = parsedSelectOptions;
    } else if (wizardType === "FixedString" || wizardType === "FixedInteger") {
      kind = "static";
      inlineItems = defaultValue.trim() ? [defaultValue.trim()] : [];
    } else if (wizardType === "Checkbox") {
      kind = "static";
      inlineItems = [String(checkboxDefault)];
    } else if (wizardType === "Database") {
      kind = "static";
      inlineItems = dbConnection.trim() ? [dbConnection.trim()] : [];
    } else if (wizardType === "Information") {
      kind = "static";
      inlineItems = infoMessage.trim() ? [infoMessage.trim()] : [];
    }

    const updated: ResourceDefinition = {
      ...resource,
      name: name.trim() || resource.name,
      type: schemaType,
      direction,
      source: { kind, path, inlineItems },
      mode: {
        selection: mixLines ? "mix" : "sequential",
        greedy: resource.mode.greedy,
      },
      fileBehavior: {
        readFile: readWriteMode === "read" || readWriteMode === "read-delete",
        writeFile: readWriteMode === "write",
        reloadPeriodically: resource.fileBehavior.reloadPeriodically,
        renewPeriodically: resource.fileBehavior.renewPeriodically,
      },
      wizardType,
      descriptionEn,
      descriptionRu,
      enableHint,
      defaultValue: wizardType === "Select" ? selectDefaultValue : defaultValue,
      notEmpty,
      multiline,
      minInteger,
      maxInteger,
      selectType,
      selectDefaultValue,
    };

    onConfirm(updated);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl border-zinc-700 bg-zinc-900 text-zinc-100 p-0 overflow-hidden flex flex-col h-[540px]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader className="border-b border-zinc-700 bg-zinc-950/60 px-5 py-3.5 shrink-0 flex flex-row items-center justify-between">
          <DialogTitle className="text-sm font-semibold text-zinc-100">
            Edit resource
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 min-h-0 space-y-4">
          {/* Border Fieldset / Box style like BAS Image 3 */}
          <div className="border border-zinc-700 rounded-md p-4 bg-zinc-950/10 relative pt-6 space-y-3.5">
            <span className="absolute -top-2.5 left-3 bg-zinc-900 px-2 text-[11px] font-bold text-zinc-300">
              {lang === "en" ? descriptionEn || name : descriptionRu || name}
            </span>

            {/* Variable Name */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-3">
              <Label className="text-right text-xs text-zinc-400">
                Variable Name
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-8 border-zinc-800 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500 font-mono"
              />
            </div>

            {/* Description with lang toggle */}
            <div className="grid grid-cols-[110px_1fr_60px] items-center gap-3">
              <Label className="text-right text-xs text-zinc-400">
                Description
              </Label>
              <Input
                value={lang === "en" ? descriptionEn : descriptionRu}
                onChange={(e) => {
                  if (lang === "en") setDescriptionEn(e.target.value);
                  else setDescriptionRu(e.target.value);
                }}
                className="h-8 border-zinc-800 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
              />
              <select
                value={lang}
                onChange={(e) => setLang(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded px-1.5 h-8 text-xs text-zinc-300 outline-none focus:border-zinc-700 cursor-pointer"
              >
                <option value="en">en</option>
                <option value="ru">ru</option>
              </select>
            </div>

            {/* Type Selector */}
            <div className="grid grid-cols-[110px_1fr] items-center gap-3">
              <Label className="text-right text-xs text-zinc-400">Type</Label>
              <Select
                value={wizardType}
                onValueChange={(val) => setWizardType(val)}
              >
                <SelectTrigger className="h-8 border-zinc-800 bg-zinc-950 text-xs text-white focus:ring-purple-500">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
                  <SelectItem value="FixedString">FixedString</SelectItem>
                  <SelectItem value="RandomString">RandomString</SelectItem>
                  <SelectItem value="Select">Select</SelectItem>
                  <SelectItem value="Checkbox">Checkbox</SelectItem>
                  <SelectItem value="LinesFromFile">LinesFromFile</SelectItem>
                  <SelectItem value="FilesFromDirectory">
                    FilesFromDirectory
                  </SelectItem>
                  <SelectItem value="LinesFromUrl">LinesFromUrl</SelectItem>
                  <SelectItem value="Database">Database</SelectItem>
                  <SelectItem value="Information">Information</SelectItem>
                  <SelectItem value="FixedInteger">FixedInteger</SelectItem>
                  <SelectItem value="RandomInteger">RandomInteger</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Dynamic Type Config Section */}
            <div className="border-t border-zinc-800 pt-3 mt-1 pl-[122px] pr-2 space-y-3">
              {wizardType === "Select" && (
                <div className="space-y-3">
                  {/* Select Options Previews (like Image 3's Radio buttons) */}
                  {parsedSelectOptions.length > 0 && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                          Preview List ({selectType})
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => setShowValues(!showValues)}
                          className="h-5 px-2 text-[10px] text-purple-400 hover:text-purple-300 hover:bg-transparent"
                        >
                          {showValues ? "Hide" : "Show Values"}
                        </Button>
                      </div>
                      <div className="space-y-1.5 max-h-24 overflow-y-auto bg-zinc-950/40 p-2 border border-zinc-850 rounded">
                        {parsedSelectOptions.map((opt) => (
                          <div key={opt} className="flex items-center gap-2">
                            {selectType === "Radio" ? (
                              <input
                                type="radio"
                                checked={selectDefaultValue === opt}
                                onChange={() => setSelectDefaultValue(opt)}
                                className="size-3 accent-purple-600 cursor-pointer"
                              />
                            ) : selectType === "Check" ? (
                              <input
                                type="checkbox"
                                checked={selectDefaultValue === opt}
                                onChange={() => setSelectDefaultValue(opt)}
                                className="size-3 accent-purple-600 cursor-pointer"
                              />
                            ) : (
                              <span className="size-1.5 rounded-full bg-purple-500 shrink-0" />
                            )}
                            <span className="text-xs text-zinc-300">{opt}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {showValues && (
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
                        Values :
                      </Label>
                      <Textarea
                        value={selectOptions}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSelectOptions(val);
                          const opts = val
                            .split("\n")
                            .map((l) => l.trim())
                            .filter(Boolean);
                          if (
                            opts.length > 0 &&
                            !opts.includes(selectDefaultValue)
                          ) {
                            setSelectDefaultValue(opts[0]);
                          }
                        }}
                        placeholder="Option 1&#10;Option 2&#10;Option 3"
                        className="min-h-20 border-zinc-800 bg-zinc-950 text-xs text-white"
                      />
                    </div>
                  )}

                  {/* Select type combo dropdown */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div className="space-y-1">
                      <Label className="text-[10px] text-zinc-500">
                        Selection Method
                      </Label>
                      <Select
                        value={selectType}
                        onValueChange={(val: any) => setSelectType(val)}
                      >
                        <SelectTrigger className="h-7 text-[11px] border-zinc-800 bg-zinc-950 text-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
                          <SelectItem value="Combo">Combo</SelectItem>
                          <SelectItem value="Radio">Radio</SelectItem>
                          <SelectItem value="Check">Check</SelectItem>
                          <SelectItem value="DragAndDrop">
                            DragAndDrop
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[10px] text-zinc-500">
                        Default Value
                      </Label>
                      <Select
                        value={selectDefaultValue}
                        onValueChange={(val) => setSelectDefaultValue(val)}
                        disabled={parsedSelectOptions.length === 0}
                      >
                        <SelectTrigger className="h-7 text-[11px] border-zinc-800 bg-zinc-950 text-white">
                          <SelectValue placeholder="Choose default" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-zinc-700 text-white">
                          {parsedSelectOptions.map((opt) => (
                            <SelectItem key={opt} value={opt}>
                              {opt}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
              )}

              {wizardType === "Checkbox" && (
                <div className="space-y-1.5 pt-1">
                  <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={checkboxDefault}
                      onChange={(e) => setCheckboxDefault(e.target.checked)}
                      className="size-4 accent-purple-600 rounded border-zinc-800 bg-zinc-950"
                    />
                    <span>Default value (Checked)</span>
                  </label>
                  <p className="text-[10px] text-zinc-500">
                    If selected, the checkbox will be ticked by default when
                    running.
                  </p>
                </div>
              )}

              {(wizardType === "LinesFromFile" ||
                wizardType === "FilesFromDirectory") && (
                <div className="space-y-2">
                  <Label className="text-[10px] text-zinc-500 block">
                    {wizardType === "LinesFromFile"
                      ? "File path"
                      : "Directory path"}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={filePath}
                      onChange={(e) => setFilePath(e.target.value)}
                      placeholder={
                        wizardType === "LinesFromFile"
                          ? "D:\\data.txt"
                          : "D:\\folder"
                      }
                      className="h-8 flex-1 border-zinc-800 bg-zinc-950 text-xs text-white font-mono"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={
                        wizardType === "LinesFromFile"
                          ? handleBrowseFile
                          : handleBrowseDirectory
                      }
                      className="h-8 bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 text-xs px-3 shrink-0"
                    >
                      Browse
                    </Button>
                  </div>
                </div>
              )}

              {wizardType === "LinesFromUrl" && (
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500 block">URL</Label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com/api/items"
                    className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white font-mono"
                  />
                </div>
              )}

              {(wizardType === "FixedString" ||
                wizardType === "RandomString") && (
                <div className="space-y-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-zinc-500 block">
                      Default string value
                    </Label>
                    <Input
                      value={defaultValue}
                      onChange={(e) => setDefaultValue(e.target.value)}
                      placeholder="Default text"
                      className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white"
                    />
                  </div>
                  <div className="flex gap-4 pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={notEmpty}
                        onChange={(e) => setNotEmpty(e.target.checked)}
                        className="size-3.5 accent-purple-600 rounded border-zinc-800 bg-zinc-950"
                      />
                      <span>Not empty</span>
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={multiline}
                        onChange={(e) => setMultiline(e.target.checked)}
                        className="size-3.5 accent-purple-600 rounded border-zinc-800 bg-zinc-950"
                      />
                      <span>Multiline</span>
                    </label>
                  </div>
                </div>
              )}

              {(wizardType === "FixedInteger" ||
                wizardType === "RandomInteger") && (
                <div className="space-y-2">
                  {wizardType === "FixedInteger" ? (
                    <div className="space-y-1">
                      <Label className="text-[10px] text-zinc-500 block">
                        Default integer value
                      </Label>
                      <Input
                        type="number"
                        value={defaultValue}
                        onChange={(e) => setDefaultValue(e.target.value)}
                        className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white"
                      />
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500 block">
                          Min value
                        </Label>
                        <Input
                          type="number"
                          value={minInteger}
                          onChange={(e) =>
                            setMinInteger(Number(e.target.value))
                          }
                          className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-[10px] text-zinc-500 block">
                          Max value
                        </Label>
                        <Input
                          type="number"
                          value={maxInteger}
                          onChange={(e) =>
                            setMaxInteger(Number(e.target.value))
                          }
                          className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white"
                        />
                      </div>
                    </div>
                  )}
                  <div className="pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-zinc-400 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={notEmpty}
                        onChange={(e) => setNotEmpty(e.target.checked)}
                        className="size-3.5 accent-purple-600 rounded border-zinc-800 bg-zinc-950"
                      />
                      <span>Must be valid number</span>
                    </label>
                  </div>
                </div>
              )}

              {wizardType === "Database" && (
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500 block">
                    Connection string
                  </Label>
                  <Input
                    value={dbConnection}
                    onChange={(e) => setDbConnection(e.target.value)}
                    placeholder="mysql://user:pass@localhost:3306/db"
                    className="h-8 w-full border-zinc-800 bg-zinc-950 text-xs text-white font-mono"
                  />
                </div>
              )}

              {wizardType === "Information" && (
                <div className="space-y-1">
                  <Label className="text-[10px] text-zinc-500 block">
                    Message
                  </Label>
                  <Textarea
                    value={infoMessage}
                    onChange={(e) => setInfoMessage(e.target.value)}
                    placeholder="Enter message here..."
                    className="min-h-16 w-full border-zinc-800 bg-zinc-950 text-xs text-white"
                  />
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="border-t border-zinc-700 bg-zinc-800 px-4 py-2.5 shrink-0 flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-zinc-400 hover:text-white hover:bg-zinc-700"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            className="bg-purple-600 hover:bg-purple-500 text-white px-5"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
