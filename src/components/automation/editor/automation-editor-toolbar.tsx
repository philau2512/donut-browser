"use client";

import { useTranslation } from "react-i18next";
import {
  LuChartBar,
  LuCircleStop,
  LuDatabase,
  LuList,
  LuPlay,
  LuSave,
  LuVariable,
} from "react-icons/lu";
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
import type { BrowserProfile } from "@/types";

interface AutomationEditorToolbarProps {
  flowName: string;
  profiles?: BrowserProfile[];
  selectedDebugProfileId?: string;
  isVariablesPanelOpen: boolean;
  isLogPanelOpen: boolean;
  isDebugRunning: boolean;
  isFlowRunning: boolean;
  isLoading: boolean;
  isSaving: boolean;
  hasCurrentFlowPath: boolean;
  onBack: () => void;
  onFlowNameChange: (name: string) => void;
  onDebugProfileChange: (profileId: string) => void;
  onToggleVariablesPanel: () => void;
  onOpenResourceConfig: () => void;
  onOpenScriptReport: () => void;
  onOpenResourceReport: () => void;
  onToggleLogPanel: () => void;
  onRunFlow: () => void;
  onStopDebugRun: () => void;
  onSaveAsClick: () => void;
  onSave: () => void;
}

export function AutomationEditorToolbar({
  flowName,
  profiles,
  selectedDebugProfileId,
  isVariablesPanelOpen,
  isLogPanelOpen,
  isDebugRunning,
  isFlowRunning,
  isLoading,
  isSaving,
  hasCurrentFlowPath,
  onBack,
  onFlowNameChange,
  onDebugProfileChange,
  onToggleVariablesPanel,
  onOpenResourceConfig,
  onOpenScriptReport,
  onOpenResourceReport,
  onToggleLogPanel,
  onRunFlow,
  onStopDebugRun,
  onSaveAsClick,
  onSave,
}: AutomationEditorToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 items-center gap-2 rounded-lg border border-border bg-card p-3">
      <Button type="button" variant="ghost" onClick={onBack}>
        {t("common.buttons.back")}
      </Button>
      <div className="max-w-sm flex-1">
        <Label htmlFor="automation-flow-name" className="sr-only">
          {t("automation.editor.name")}
        </Label>
        <Input
          id="automation-flow-name"
          value={flowName}
          onChange={(event) => onFlowNameChange(event.target.value)}
          placeholder={t("automation.editor.namePlaceholder")}
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {profiles && profiles.length > 0 && (
          <div className="w-44 text-left">
            <Select
              value={selectedDebugProfileId ?? ""}
              onValueChange={onDebugProfileChange}
              disabled={isDebugRunning}
            >
              <SelectTrigger className="h-9 w-full text-xs">
                <SelectValue
                  placeholder={
                    t("automation.editor.debugProfile.placeholder") ||
                    "Select profile..."
                  }
                />
              </SelectTrigger>
              <SelectContent>
                {profiles.map((profile) => (
                  <SelectItem key={profile.id} value={profile.id}>
                    {profile.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <Button
          type="button"
          variant={isVariablesPanelOpen ? "secondary" : "outline"}
          size="icon"
          className="size-9"
          title={t("automation.editor.tabs.variables")}
          onClick={onToggleVariablesPanel}
        >
          <LuVariable className="size-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          disabled={isDebugRunning}
          onClick={onOpenResourceConfig}
        >
          <LuDatabase className="mr-2 size-4" />
          Resources
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          title={t("automation.report.script.title", "Script Report")}
          onClick={onOpenScriptReport}
        >
          <LuChartBar className="size-4" />
        </Button>

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-9"
          title={t("automation.report.resource.title", "Resource Report")}
          onClick={onOpenResourceReport}
        >
          <LuDatabase className="size-4" />
        </Button>

        <Button
          type="button"
          variant={isLogPanelOpen ? "secondary" : "outline"}
          size="icon"
          className="size-9"
          title={t("automation.editor.sidebar.showLogs")}
          onClick={onToggleLogPanel}
        >
          <LuList className="size-4" />
        </Button>

        {isDebugRunning ? (
          <Button type="button" variant="destructive" onClick={onStopDebugRun}>
            <LuCircleStop className="mr-2 size-4" />
            {t("common.buttons.stop") || "Stop"}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            disabled={isFlowRunning || isLoading}
            onClick={onRunFlow}
          >
            <LuPlay className="mr-2 size-4 fill-emerald-500/20 text-emerald-500" />
            {t("common.buttons.run")}
          </Button>
        )}

        {hasCurrentFlowPath && (
          <Button
            type="button"
            variant="outline"
            disabled={isSaving || isLoading}
            onClick={onSaveAsClick}
          >
            {t("common.buttons.saveAs") || "Save As"}
          </Button>
        )}

        <Button type="button" disabled={isSaving || isLoading} onClick={onSave}>
          <LuSave className="mr-2 size-4" />
          {isSaving ? t("automation.editor.saving") : t("common.buttons.save")}
        </Button>
      </div>
    </div>
  );
}
