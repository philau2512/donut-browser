"use client";

import { useTranslation } from "react-i18next";
import {
  LuArrowLeft,
  LuChartBar,
  LuCircleStop,
  LuDatabase,
  LuList,
  LuPlay,
  LuSave,
  LuVariable,
} from "react-icons/lu";
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
  zoom: number;
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
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
  zoom,
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
  onZoomIn,
  onZoomOut,
  onResetZoom,
}: AutomationEditorToolbarProps) {
  const { t } = useTranslation();

  return (
    <div className="flex shrink-0 flex-col rounded-lg border border-zinc-800 bg-[#222222] text-zinc-300 shadow-md">
      {/* Top Menu Bar like BAS */}
      <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-1.5 text-xs font-normal text-zinc-400">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-zinc-400 hover:text-white transition-colors mr-2"
        >
          <LuArrowLeft className="size-3" />
          <span>{t("common.buttons.back")}</span>
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
        >
          Project
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
          onClick={onOpenScriptReport}
        >
          Reports
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
        >
          Build
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
        >
          Interface
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
        >
          Tools
        </button>
        <button
          type="button"
          className="cursor-pointer hover:text-white transition-colors bg-transparent border-none p-0 text-zinc-400"
        >
          Help
        </button>

        <div className="ml-auto flex items-center gap-2 select-none">
          <span className="text-[10px] text-zinc-500 font-mono">
            Zoom: {Math.round(zoom * 100)}%
          </span>
          <button
            type="button"
            onClick={onZoomOut}
            className="w-5 h-5 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded text-[10px] transition-colors"
            title="Zoom Out (Ctrl -)"
          >
            -
          </button>
          <button
            type="button"
            onClick={onResetZoom}
            className="px-1.5 h-5 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded text-[9px] transition-colors"
            title="Reset Zoom (Ctrl 0)"
          >
            100%
          </button>
          <button
            type="button"
            onClick={onZoomIn}
            className="w-5 h-5 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white rounded text-[10px] transition-colors"
            title="Zoom In (Ctrl +)"
          >
            +
          </button>
        </div>
      </div>

      {/* Main Action Bar */}
      <div className="flex flex-wrap items-center gap-2 p-2">
        {/* Flow Name Input */}
        <div className="flex items-center gap-1.5 bg-[#2d2d2d] px-2 py-1 rounded border border-zinc-700 min-w-[180px] max-w-xs">
          <span className="text-[11px] text-zinc-400 select-none">Flow:</span>
          <input
            id="automation-flow-name"
            value={flowName}
            onChange={(event) => onFlowNameChange(event.target.value)}
            placeholder={t("automation.editor.namePlaceholder")}
            className="bg-transparent text-xs text-white outline-none border-none p-0 w-full focus:ring-0 placeholder:text-zinc-500"
          />
        </div>

        <div className="h-6 w-px bg-zinc-800 mx-1" />

        {/* Buttons styled like BAS */}
        <div className="flex flex-wrap items-center gap-1">
          {/* Save Button */}
          <button
            type="button"
            disabled={isSaving || isLoading}
            onClick={onSave}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <LuSave className="size-4 text-sky-400" />
            <span>
              {isSaving
                ? t("automation.editor.saving")
                : t("common.buttons.save")}
            </span>
          </button>

          {/* Save As Button */}
          {hasCurrentFlowPath && (
            <button
              type="button"
              disabled={isSaving || isLoading}
              onClick={onSaveAsClick}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <LuSave className="size-4 text-zinc-400" />
              <span>{t("common.buttons.saveAs") || "Save As"}</span>
            </button>
          )}

          <div className="h-5 w-px bg-zinc-800 mx-1" />

          {/* Variables Button */}
          <button
            type="button"
            onClick={onToggleVariablesPanel}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              isVariablesPanelOpen
                ? "bg-zinc-800 text-amber-400"
                : "text-zinc-300 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <LuVariable className="size-4 text-amber-500" />
            <span>Variables</span>
          </button>

          {/* Resources Button */}
          <button
            type="button"
            disabled={isDebugRunning}
            onClick={onOpenResourceConfig}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors disabled:opacity-50"
          >
            <LuDatabase className="size-4 text-emerald-400" />
            <span>Resources</span>
          </button>

          {/* Script Report */}
          <button
            type="button"
            onClick={onOpenScriptReport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <LuChartBar className="size-4 text-purple-400" />
            <span>Script Report</span>
          </button>

          {/* Resource Report */}
          <button
            type="button"
            onClick={onOpenResourceReport}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <LuDatabase className="size-4 text-indigo-400" />
            <span>Resource Report</span>
          </button>

          {/* Log Panel Toggle */}
          <button
            type="button"
            onClick={onToggleLogPanel}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-medium transition-colors ${
              isLogPanelOpen
                ? "bg-zinc-800 text-teal-400"
                : "text-zinc-300 hover:text-white hover:bg-zinc-800"
            }`}
          >
            <LuList className="size-4 text-teal-400" />
            <span>Logs</span>
          </button>

          <div className="h-5 w-px bg-zinc-800 mx-1" />

          {/* Profile Selector for Debug */}
          {profiles && profiles.length > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-zinc-500 mr-1 select-none">
                Profile:
              </span>
              <select
                value={selectedDebugProfileId ?? ""}
                onChange={(e) => onDebugProfileChange(e.target.value)}
                disabled={isDebugRunning}
                className="bg-[#2d2d2d] text-white text-xs border border-zinc-700 rounded px-2 py-1 outline-none h-7 max-w-[150px] focus:border-zinc-500"
              >
                <option value="">
                  {t("automation.editor.debugProfile.placeholder") ||
                    "Select profile..."}
                </option>
                {profiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Run / Stop Button */}
          {isDebugRunning ? (
            <button
              type="button"
              onClick={onStopDebugRun}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-950/80 hover:bg-red-900 border border-red-800 rounded text-xs font-medium text-red-200 transition-colors"
            >
              <LuCircleStop className="size-4 text-red-500 animate-pulse" />
              <span>Stop</span>
            </button>
          ) : (
            <button
              type="button"
              disabled={isFlowRunning || isLoading}
              onClick={onRunFlow}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-800 rounded text-xs font-medium text-emerald-200 transition-colors disabled:opacity-50"
            >
              <LuPlay className="size-4 text-emerald-400 fill-emerald-400/20" />
              <span>Run</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
