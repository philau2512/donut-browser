"use client";

import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useCreateResourceWizard } from "./wizard-context";

export function StepOneInfo() {
  const { t } = useTranslation();
  const {
    name,
    setName,
    descriptionEn,
    setDescriptionEn,
    descriptionRu,
    setDescriptionRu,
    enableHint,
    setEnableHint,
  } = useCreateResourceWizard();

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label
          htmlFor="wiz-name"
          className="text-xs font-semibold text-zinc-300"
        >
          {t("automation.editor.resources.wizard.step1_name_label")}
        </Label>
        <Input
          id="wiz-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="data_input"
          className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500 focus-visible:border-purple-500"
        />
        <p className="text-[10px] text-zinc-500">
          {t("automation.editor.resources.wizard.step1_name_help")}
        </p>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="wiz-desc-en"
          className="text-xs font-semibold text-zinc-300"
        >
          {t("automation.editor.resources.wizard.step1_desc_en_label")}
        </Label>
        <Input
          id="wiz-desc-en"
          value={descriptionEn}
          onChange={(e) => setDescriptionEn(e.target.value)}
          placeholder="Enter English description"
          className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
        />
        <p className="text-[10px] text-zinc-500">
          {t("automation.editor.resources.wizard.step1_desc_en_help")}
        </p>
      </div>

      <div className="space-y-2">
        <Label
          htmlFor="wiz-desc-ru"
          className="text-xs font-semibold text-zinc-300"
        >
          {t("automation.editor.resources.wizard.step1_desc_ru_label")}
        </Label>
        <Input
          id="wiz-desc-ru"
          value={descriptionRu}
          onChange={(e) => setDescriptionRu(e.target.value)}
          placeholder="Введите описание на русском"
          className="h-9 border-zinc-700 bg-zinc-950 text-xs text-white focus-visible:ring-purple-500"
        />
        <p className="text-[10px] text-zinc-500">
          {t("automation.editor.resources.wizard.step1_desc_ru_help")}
        </p>
      </div>

      <label className="flex items-center gap-2 text-xs text-zinc-300 mt-2 select-none cursor-pointer">
        <input
          type="checkbox"
          checked={enableHint}
          onChange={(e) => setEnableHint(e.target.checked)}
          className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
        />
        {t("automation.editor.resources.wizard.step1_hint_label")}
      </label>
    </div>
  );
}
