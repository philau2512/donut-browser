"use client";

import { type DragEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AutomationNodeCatalogItem,
  AutomationNodeType,
} from "@/lib/automation/node-catalog";
import type { ResourceDefinition } from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";
import {
  type CardStackSlot,
  ScriptCardStack,
} from "./card-stack/script-card-stack";
import {
  type FlowExecutionStep,
  type FlowLogLine,
  FlowLogPanel,
} from "./flow-log-panel";
import { NodePalette } from "./node-palette";
import { ResourceManagerPanel } from "./panels/resource-manager-panel";
import type { AutomationCanvasEdge, AutomationCanvasNode } from "./serialize";

type DebugNodeStatus = "idle" | "running" | "success" | "error";

interface AutomationEditorWorkspaceProps {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  selectedNodeId: string | null;
  draggedNodeType: string | null;
  debugNodeStatuses: Record<string, DebugNodeStatus>;
  disabled: boolean;
  isVariablesPanelOpen: boolean;
  isLogPanelOpen: boolean;
  showDebugOutput: boolean;
  debugLogs: FlowLogLine[];
  flowLogs: FlowLogLine[];
  debugSteps: FlowExecutionStep[];
  logSteps: FlowExecutionStep[];
  variables: Record<string, string>;
  resources: ResourceDefinition[];
  isDebugRunning: boolean;
  onPaletteDragStart: (
    event: DragEvent,
    item: AutomationNodeCatalogItem,
  ) => void;
  onSelectNode: (nodeId: string | null) => void;
  onInsertNode: (type: AutomationNodeType, slot: CardStackSlot) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onEditNode: (nodeId: string) => void;
  onCommentNode: (nodeId: string) => void;
  onStartFromHereNode: (nodeId: string) => void;
  onCreateLabel: (slot: CardStackSlot) => void;
  onMoveToLabel: (
    sourceNodeId: string,
    labelId: string,
    sourceHandle: string,
  ) => void;
  onVariablesChange: (variables: Record<string, string>) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
  onEditResource: (id: string) => void;
  onCloseLogPanel: () => void;
  onSelectLogNode: (nodeId: string | null) => void;
  activeInsertSlot: CardStackSlot | null;
  onSelectSlot: (slot: CardStackSlot) => void;
  onPaletteItemClick: (item: AutomationNodeCatalogItem) => void;
}

export function AutomationEditorWorkspace({
  nodes,
  edges,
  selectedNodeId,
  draggedNodeType,
  debugNodeStatuses,
  disabled,
  isVariablesPanelOpen,
  isLogPanelOpen,
  showDebugOutput,
  debugLogs,
  flowLogs,
  debugSteps,
  logSteps,
  variables,
  resources,
  isDebugRunning: _isDebugRunning,
  onPaletteDragStart,
  onSelectNode,
  onInsertNode,
  onDeleteNode,
  onDuplicateNode,
  onEditNode,
  onCommentNode,
  onStartFromHereNode,
  onCreateLabel,
  onMoveToLabel,
  onVariablesChange: _onVariablesChange,
  onResourcesChange,
  onEditResource,
  onCloseLogPanel,
  onSelectLogNode,
  activeInsertSlot,
  onSelectSlot,
  onPaletteItemClick,
}: AutomationEditorWorkspaceProps) {
  const { t } = useTranslation();
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = Math.max(260, Math.min(600, e.clientX));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  return (
    <div className="relative flex min-h-0 flex-1 gap-3">
      {/* COLUMN 1: Script Editor (formerly Column 2) */}
      <aside
        style={{ width: `${sidebarWidth}px` }}
        className="relative flex shrink-0 flex-col gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 shadow-sm select-none"
      >
        <div className="flex items-center justify-between border-b border-border pb-2">
          <h2 className="text-sm font-semibold">
            {t("automation.editor.scriptEditor")}
          </h2>
        </div>
        <ScriptCardStack
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          draggedNodeType={draggedNodeType}
          debugNodeStatuses={debugNodeStatuses}
          disabled={disabled}
          onSelectNode={onSelectNode}
          onInsertNode={onInsertNode}
          onDeleteNode={onDeleteNode}
          onDuplicateNode={onDuplicateNode}
          onEditNode={onEditNode}
          onCommentNode={onCommentNode}
          onStartFromHereNode={onStartFromHereNode}
          onCreateLabel={onCreateLabel}
          onMoveToLabel={onMoveToLabel}
          activeInsertSlot={activeInsertSlot}
          onSelectSlot={onSelectSlot}
        />
        {/* Resize Handle */}
        <button
          type="button"
          onMouseDown={startResizing}
          className={cn(
            "absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-primary/40 active:bg-primary transition-colors z-50 p-0 border-0 bg-transparent outline-none focus:ring-0",
            isResizing && "bg-primary",
          )}
          aria-label="Resize sidebar"
        />
      </aside>

      {/* COLUMN 2: Node Selector / Palette (formerly Column 1) */}
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto rounded-lg border border-border bg-card p-4">
          <NodePalette
            onDragStart={onPaletteDragStart}
            onClickItem={onPaletteItemClick}
          />
        </div>

        {isLogPanelOpen && (
          <FlowLogPanel
            logs={showDebugOutput ? debugLogs : flowLogs}
            steps={showDebugOutput ? debugSteps : logSteps}
            variables={variables}
            onClose={onCloseLogPanel}
            onSelectNode={onSelectLogNode}
            selectedNodeId={selectedNodeId}
          />
        )}
      </div>

      {/* COLUMN 3: Resource Management / Variables Panel */}
      {isVariablesPanelOpen && (
        <aside className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-md">
          <ResourceManagerPanel
            resources={resources}
            onChange={onResourcesChange}
            onDoubleClickResource={onEditResource}
            disabled={disabled}
          />
        </aside>
      )}
    </div>
  );
}

export type { CardStackSlot } from "./card-stack/script-card-stack";
