"use client";

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
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
import { useCreateResourceWizard } from "./wizard-context";

export function StepFourProperties() {
  const { t } = useTranslation();
  const {
    wizardType,
    defaultValue,
    setDefaultValue,
    notEmpty,
    setNotEmpty,
    multiline,
    setMultiline,
    minInteger,
    setMinInteger,
    maxInteger,
    setMaxInteger,
    filePath,
    setFilePath,
    url,
    setUrl,
    selectType,
    setSelectType,
    selectOptions,
    setSelectOptions,
    selectDefaultValue,
    setSelectDefaultValue,
    checkboxDefault,
    setCheckboxDefault,
    dbConnection,
    setDbConnection,
    infoMessage,
    setInfoMessage,
    handleBrowseFile,
    handleBrowseDirectory,
  } = useCreateResourceWizard();

  // Tối ưu hóa việc phân tách options bằng useMemo để tránh chạy lại khi gõ phím ở các input khác
  const parsedSelectOptions = useMemo(() => {
    return selectOptions
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  }, [selectOptions]);

  const isSelectEmpty = parsedSelectOptions.length === 0;

  return (
    <div className="space-y-4">
      {(wizardType === "FixedString" || wizardType === "RandomString") && (
        <>
          <div className="space-y-2">
            <Label
              htmlFor="wiz-default"
              className="text-xs font-semibold text-zinc-300"
            >
              {t("automation.editor.resources.wizard.step4_default_value")}
            </Label>
            <Input
              id="wiz-default"
              value={defaultValue}
              onChange={(e) => setDefaultValue(e.target.value)}
              placeholder={t(
                "automation.editor.resources.wizard.step4_default_value_help",
              )}
              className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
            />
            <p className="text-[10px] text-zinc-500">
              {t("automation.editor.resources.wizard.step4_default_value_help")}
            </p>
          </div>

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={notEmpty}
                onChange={(e) => setNotEmpty(e.target.checked)}
                className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
              />
              {t("automation.editor.resources.wizard.step4_not_empty")}
            </label>

            <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer mt-2">
              <input
                type="checkbox"
                checked={multiline}
                onChange={(e) => setMultiline(e.target.checked)}
                className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
              />
              {t("automation.editor.resources.wizard.step4_multiline")}
            </label>
          </div>
        </>
      )}

      {(wizardType === "FixedInteger" || wizardType === "RandomInteger") && (
        <>
          {wizardType === "FixedInteger" ? (
            <div className="space-y-2">
              <Label
                htmlFor="wiz-default-int"
                className="text-xs font-semibold text-zinc-300"
              >
                {t("automation.editor.resources.wizard.step4_default_value")}
              </Label>
              <Input
                id="wiz-default-int"
                type="number"
                value={defaultValue}
                onChange={(e) => setDefaultValue(e.target.value)}
                className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label
                  htmlFor="wiz-min-int"
                  className="text-xs font-semibold text-zinc-300"
                >
                  {t("automation.editor.resources.wizard.step4_min_value")}
                </Label>
                <Input
                  id="wiz-min-int"
                  type="number"
                  value={minInteger}
                  onChange={(e) => setMinInteger(Number(e.target.value))}
                  className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="wiz-max-int"
                  className="text-xs font-semibold text-zinc-300"
                >
                  {t("automation.editor.resources.wizard.step4_max_value")}
                </Label>
                <Input
                  id="wiz-max-int"
                  type="number"
                  value={maxInteger}
                  onChange={(e) => setMaxInteger(Number(e.target.value))}
                  className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
                />
              </div>
            </div>
          )}

          <div className="space-y-2 pt-2">
            <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
              <input
                type="checkbox"
                checked={notEmpty}
                onChange={(e) => setNotEmpty(e.target.checked)}
                className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
              />
              {t("automation.editor.resources.wizard.step4_not_empty_number")}
            </label>
          </div>
        </>
      )}

      {(wizardType === "LinesFromFile" ||
        wizardType === "FilesFromDirectory") && (
        <div className="space-y-2">
          <Label
            htmlFor="wiz-file"
            className="text-xs font-semibold text-zinc-300"
          >
            {wizardType === "LinesFromFile"
              ? t("automation.editor.resources.wizard.step4_file_path")
              : t("automation.editor.resources.wizard.step4_directory_path")}
          </Label>
          <div className="flex gap-2">
            <Input
              id="wiz-file"
              value={filePath}
              onChange={(e) => setFilePath(e.target.value)}
              placeholder={
                wizardType === "LinesFromFile"
                  ? "D:\\data\\resource.txt"
                  : "D:\\data\\folder"
              }
              className="flex-1 h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500 font-mono"
            />
            <Button
              type="button"
              variant="outline"
              onClick={
                wizardType === "LinesFromFile"
                  ? handleBrowseFile
                  : handleBrowseDirectory
              }
              className="h-9 bg-zinc-800 border-zinc-700 text-zinc-100 hover:bg-zinc-700 hover:text-white px-3 shrink-0"
            >
              {wizardType === "LinesFromFile"
                ? t("automation.editor.resources.wizard.step4_btn_choose_file")
                : t(
                    "automation.editor.resources.wizard.step4_btn_choose_folder",
                  )}
            </Button>
          </div>
          <p className="text-[10px] text-zinc-500">
            {wizardType === "LinesFromFile"
              ? t("automation.editor.resources.wizard.step4_file_path_help")
              : t(
                  "automation.editor.resources.wizard.step4_directory_path_help",
                )}
          </p>
        </div>
      )}

      {wizardType === "LinesFromUrl" && (
        <div className="space-y-2">
          <Label
            htmlFor="wiz-url"
            className="text-xs font-semibold text-zinc-300"
          >
            {t("automation.editor.resources.wizard.step4_url")}
          </Label>
          <Input
            id="wiz-url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com/api/items"
            className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500 font-mono"
          />
          <p className="text-[10px] text-zinc-500">
            {t("automation.editor.resources.wizard.step4_url_help")}
          </p>
        </div>
      )}

      {wizardType === "Select" && (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label
              htmlFor="wiz-select-type"
              className="text-xs font-semibold text-zinc-300"
            >
              {t("automation.editor.resources.wizard.step4_select_type")}
            </Label>
            <Select
              value={selectType}
              onValueChange={(
                val: "Combo" | "Radio" | "Check" | "DragAndDrop",
              ) => setSelectType(val)}
            >
              <SelectTrigger
                id="wiz-select-type"
                className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus:ring-purple-500"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Combo">Combo</SelectItem>
                <SelectItem value="Radio">Radio</SelectItem>
                <SelectItem value="Check">Check</SelectItem>
                <SelectItem value="DragAndDrop">DragAndDrop</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label
              htmlFor="wiz-options"
              className="text-xs font-semibold text-zinc-300"
            >
              {t("automation.editor.resources.wizard.step4_select_options")}
            </Label>
            <Textarea
              id="wiz-options"
              value={selectOptions}
              onChange={(e) => {
                const val = e.target.value;
                setSelectOptions(val);
                const opts = val
                  .split("\n")
                  .map((l) => l.trim())
                  .filter(Boolean);
                if (opts.length > 0 && !opts.includes(selectDefaultValue)) {
                  setSelectDefaultValue(opts[0]);
                }
              }}
              placeholder="Option 1&#10;Option 2&#10;Option 3"
              className="min-h-32 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
            />
          </div>

          <hr className="border-zinc-800 my-4" />

          <div className="space-y-2">
            <Label
              htmlFor="wiz-select-default"
              className="text-xs font-semibold text-zinc-300"
            >
              {t("automation.editor.resources.wizard.step4_default_value")}
            </Label>
            <Select
              value={selectDefaultValue}
              onValueChange={(val) => setSelectDefaultValue(val)}
              disabled={isSelectEmpty}
            >
              <SelectTrigger
                id="wiz-select-default"
                className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus:ring-purple-500"
              >
                <SelectValue
                  placeholder={t(
                    "automation.editor.resources.wizard.step4_select_placeholder",
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {parsedSelectOptions.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {wizardType === "Checkbox" && (
        <div className="space-y-2 pt-2">
          <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
            <input
              type="checkbox"
              checked={checkboxDefault}
              onChange={(e) => setCheckboxDefault(e.target.checked)}
              className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
            />
            {t("automation.editor.resources.wizard.step4_default_value")}
          </label>
          <p className="text-[10px] text-zinc-500 pl-5.5">
            {t("automation.editor.resources.wizard.step4_checkbox_help")}
          </p>
        </div>
      )}

      {wizardType === "Database" && (
        <div className="space-y-2">
          <Label
            htmlFor="wiz-db"
            className="text-xs font-semibold text-zinc-300"
          >
            {t("automation.editor.resources.wizard.step4_connection_string")}
          </Label>
          <Input
            id="wiz-db"
            value={dbConnection}
            onChange={(e) => setDbConnection(e.target.value)}
            placeholder="mysql://user:pass@localhost:3306/db"
            className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500 font-mono"
          />
          <p className="text-[10px] text-zinc-500">
            {t("automation.editor.resources.wizard.step4_db_connection_help")}
          </p>
        </div>
      )}

      {wizardType === "Information" && (
        <div className="space-y-2">
          <Label
            htmlFor="wiz-info"
            className="text-xs font-semibold text-zinc-300"
          >
            {t("automation.editor.resources.wizard.step4_message")}
          </Label>
          <Textarea
            id="wiz-info"
            value={infoMessage}
            onChange={(e) => setInfoMessage(e.target.value)}
            placeholder="This flow requires an input file..."
            className="min-h-32 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
          />
          <p className="text-[10px] text-zinc-500">
            {t("automation.editor.resources.wizard.step4_info_message_help")}
          </p>
        </div>
      )}
    </div>
  );
}
