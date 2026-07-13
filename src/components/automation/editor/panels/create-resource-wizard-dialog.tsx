"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { type ResourceDefinition } from "@/lib/automation/resource-schema";
import { StepFourProperties } from "./create-resource-wizard/step-four-properties";
import { StepOneInfo } from "./create-resource-wizard/step-one-info";
import { StepThreeMode } from "./create-resource-wizard/step-three-mode";
import { StepTwoTypes } from "./create-resource-wizard/step-two-types";
import {
  CreateResourceWizardProvider,
  useCreateResourceWizard,
} from "./create-resource-wizard/wizard-context";

interface CreateResourceWizardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (resource: ResourceDefinition) => void;
  existingNames?: string[];
  editingResource?: ResourceDefinition | null;
}

function CreateResourceWizardDialogContent() {
  const { t } = useTranslation();
  const {
    step,
    wizardType,
    handleClose,
    handleNext,
    handleBack,
    isNextDisabled,
  } = useCreateResourceWizard();

  return (
    <DialogContent
      className="max-w-2xl border-zinc-700 bg-zinc-900 p-0 text-zinc-100 overflow-hidden h-[620px] flex flex-col justify-between"
      onPointerDownOutside={(e) => e.preventDefault()}
      onInteractOutside={(e) => e.preventDefault()}
    >
      {/* Step headers */}
      <div className="border-b border-zinc-700 bg-zinc-950/60 px-5 py-4 shrink-0">
        {step === 1 && (
          <div>
            <h2 className="text-base font-semibold text-white">
              {t("automation.editor.resources.wizard.step1_title")}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {t("automation.editor.resources.wizard.step1_subtitle")}
            </p>
          </div>
        )}
        {step === 2 && (
          <div>
            <h2 className="text-base font-semibold text-white">
              {t("automation.editor.resources.wizard.step2_title")}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {t("automation.editor.resources.wizard.step2_subtitle")}
            </p>
          </div>
        )}
        {step === 3 && (
          <div>
            <h2 className="text-base font-semibold text-white">
              {t("automation.editor.resources.wizard.step3_title")}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {t("automation.editor.resources.wizard.step3_subtitle")}
            </p>
          </div>
        )}
        {step === 4 && (
          <div>
            <h2 className="text-base font-semibold text-white">
              {wizardType === "FixedString" || wizardType === "RandomString"
                ? t("automation.editor.resources.wizard.step4_title_string")
                : wizardType === "Select"
                  ? t("automation.editor.resources.wizard.step4_title_select")
                  : t(
                      "automation.editor.resources.wizard.step4_title_generic",
                      {
                        type: wizardType,
                      },
                    )}
            </h2>
            <p className="text-xs text-zinc-400 mt-1">
              {wizardType === "FixedString" || wizardType === "RandomString"
                ? t("automation.editor.resources.wizard.step4_subtitle_string")
                : wizardType === "Select"
                  ? t(
                      "automation.editor.resources.wizard.step4_subtitle_select",
                    )
                  : t(
                      "automation.editor.resources.wizard.step4_subtitle_generic",
                    )}
            </p>
          </div>
        )}
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0">
        {step === 1 && <StepOneInfo />}
        {step === 2 && <StepTwoTypes />}
        {step === 3 && <StepThreeMode />}
        {step === 4 && <StepFourProperties />}
      </div>

      {/* Footers */}
      <DialogFooter className="border-t border-zinc-700 bg-zinc-800 px-5 py-4 shrink-0 flex items-center justify-between gap-2">
        <div>
          {step > 1 && (
            <Button
              type="button"
              variant="outline"
              onClick={handleBack}
              className="bg-zinc-700 border-zinc-600 text-zinc-100 hover:bg-zinc-600 hover:text-white"
            >
              {t("automation.editor.resources.wizard.btn_back")}
            </Button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={handleClose}
            className="text-zinc-400 hover:text-white hover:bg-zinc-700"
          >
            {t("automation.editor.resources.wizard.btn_cancel")}
          </Button>
          <Button
            type="button"
            disabled={isNextDisabled()}
            onClick={handleNext}
            className="bg-purple-600 hover:bg-purple-500 text-white font-medium px-5"
          >
            {step === 4
              ? t("automation.editor.resources.wizard.btn_finish")
              : t("automation.editor.resources.wizard.btn_next")}
          </Button>
        </div>
      </DialogFooter>
    </DialogContent>
  );
}

export function CreateResourceWizardDialog({
  open,
  onOpenChange,
  onConfirm,
  existingNames = [],
  editingResource = null,
}: CreateResourceWizardDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        // useContext can only be used under the provider, so we handle close here
        // to pass to onOpenChange. The provider resets itself when open changes or handleClose fires.
        if (!val) {
          onOpenChange(false);
        }
      }}
    >
      <CreateResourceWizardProvider
        open={open}
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
        existingNames={existingNames}
        editingResource={editingResource}
      >
        <CreateResourceWizardDialogContent />
      </CreateResourceWizardProvider>
    </Dialog>
  );
}
