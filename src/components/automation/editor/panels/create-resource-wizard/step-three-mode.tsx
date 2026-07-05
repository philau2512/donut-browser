"use client";

import { useTranslation } from "react-i18next";
import { useCreateResourceWizard } from "./wizard-context";

export function StepThreeMode() {
  const { t } = useTranslation();
  const { readWriteMode, setReadWriteMode, mixLines, setMixLines } =
    useCreateResourceWizard();

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="flex items-start gap-3 p-3.5 rounded border border-zinc-800 bg-zinc-950/30 cursor-pointer select-none hover:bg-zinc-800/20">
          <input
            type="radio"
            name="wiz-mode"
            checked={readWriteMode === "read"}
            onChange={() => setReadWriteMode("read")}
            className="mt-0.5 size-4 accent-purple-500"
          />
          <div>
            <span className="block text-xs font-semibold text-zinc-200">
              {t("automation.editor.resources.wizard.step3_only_read")}
            </span>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3.5 rounded border border-zinc-800 bg-zinc-950/30 cursor-pointer select-none hover:bg-zinc-800/20">
          <input
            type="radio"
            name="wiz-mode"
            checked={readWriteMode === "read-delete"}
            onChange={() => setReadWriteMode("read-delete")}
            className="mt-0.5 size-4 accent-purple-500"
          />
          <div>
            <span className="block text-xs font-semibold text-zinc-200">
              {t("automation.editor.resources.wizard.step3_read_delete")}
            </span>
            <span className="block text-[10px] text-zinc-500 mt-1">
              {t("automation.editor.resources.wizard.step3_read_delete_help")}
            </span>
          </div>
        </label>

        <label className="flex items-start gap-3 p-3.5 rounded border border-zinc-800 bg-zinc-950/30 cursor-pointer select-none hover:bg-zinc-800/20">
          <input
            type="radio"
            name="wiz-mode"
            checked={readWriteMode === "write"}
            onChange={() => setReadWriteMode("write")}
            className="mt-0.5 size-4 accent-purple-500"
          />
          <div>
            <span className="block text-xs font-semibold text-zinc-200">
              {t("automation.editor.resources.wizard.step3_only_write")}
            </span>
          </div>
        </label>
      </div>

      <div className="border-t border-zinc-800 pt-4">
        <label className="flex items-center gap-2 text-xs text-zinc-300 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={mixLines}
            onChange={(e) => setMixLines(e.target.checked)}
            className="size-3.5 accent-purple-500 rounded border-zinc-700 bg-zinc-950"
          />
          {t("automation.editor.resources.wizard.step3_mix")}
        </label>
      </div>
    </div>
  );
}
