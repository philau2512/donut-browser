"use client";

import {
  CheckSquare,
  ChevronDown,
  Clipboard,
  Copy,
  Layers,
  Redo2,
  Scissors,
  Search,
  Undo2,
  X,
} from "lucide-react";
import { type DragEvent, useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  AutomationNodeCatalogItem,
  AutomationNodeType,
} from "@/lib/automation/node-catalog";
import type {
  ResourceDefinition,
  VariableDefinition,
} from "@/lib/automation/resource-schema";
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
import { VariableResourcePanel } from "./panels/variable-resource-panel";
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
  v2Variables: VariableDefinition[];
  resources: ResourceDefinition[];
  isDebugRunning: boolean;
  collapsedBlockIds?: Set<string>;
  onToggleCollapseBlock?: (nodeId: string) => void;
  onToggleErrorHandling?: (nodeId: string) => void;
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
  onV2VariablesChange: (variables: VariableDefinition[]) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
  onEditResource: (id: string) => void;
  onCloseLogPanel: () => void;
  onSelectLogNode: (nodeId: string | null) => void;
  activeInsertSlot: CardStackSlot | null;
  onSelectSlot: (slot: CardStackSlot) => void;
  onPaletteItemClick: (item: AutomationNodeCatalogItem) => void;
  onMoveNode?: (nodeId: string, slot: CardStackSlot) => void;
  onConnectSlots?: (source: CardStackSlot, target: CardStackSlot) => void;

  // Search props
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: string[];
  currentResultIndex: number;
  onCurrentResultIndexChange: (idx: number) => void;
  // Multi-select props
  isMultiSelectMode: boolean;
  onToggleMultiSelectMode: () => void;
  selectedNodeIds: Set<string>;
  onSelectNodeWithToggle?: (nodeId: string | null, isMetaKey?: boolean) => void;
  onSelectAll?: (ids: Set<string>) => void;
  // History props
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  // Clipboard props
  onCopy: () => void;
  onCut: () => void;
  onPaste: () => void;
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
  v2Variables,
  resources,
  isDebugRunning: _isDebugRunning,
  collapsedBlockIds,
  onToggleCollapseBlock,
  onToggleErrorHandling,
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
  onV2VariablesChange,
  onResourcesChange,
  onEditResource,
  onCloseLogPanel,
  onSelectLogNode,
  activeInsertSlot,
  onSelectSlot,
  onPaletteItemClick,
  onMoveNode,
  onConnectSlots,

  // Search props
  searchQuery,
  onSearchQueryChange,
  searchResults,
  currentResultIndex,
  onCurrentResultIndexChange,
  // Multi-select props
  isMultiSelectMode,
  onToggleMultiSelectMode,
  selectedNodeIds,
  onSelectNodeWithToggle,
  onSelectAll,
  // History props
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  // Clipboard props
  onCopy,
  onCut,
  onPaste,
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
        <div className="flex flex-col gap-2 border-b border-border pb-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">
              {t("automation.editor.scriptEditor")}
            </h2>
            <div className="flex items-center gap-1.5">
              {/* Undo / Redo */}
              <button
                type="button"
                onClick={onUndo}
                disabled={!canUndo}
                title="Undo"
                className="p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onRedo}
                disabled={!canRedo}
                title="Redo"
                className="p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Redo2 className="h-4 w-4" />
              </button>

              <div className="h-4 w-[1px] bg-border mx-1" />

              {/* Copy / Cut / Paste */}
              <button
                type="button"
                onClick={onCopy}
                disabled={selectedNodeIds.size === 0}
                title="Copy"
                className="p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Copy className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onCut}
                disabled={selectedNodeIds.size === 0}
                title="Cut"
                className="p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
              >
                <Scissors className="h-4 w-4" />
              </button>
              {selectedNodeId && (
                <button
                  type="button"
                  onClick={onPaste}
                  title="Paste"
                  className="p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <Clipboard className="h-4 w-4 text-primary" />
                </button>
              )}

              <div className="h-4 w-[1px] bg-border mx-1" />

              {/* Select All & Multi-select Toggle */}
              <button
                type="button"
                onClick={() => {
                  if (nodes.length > 0) {
                    const eligibleNodeIds = nodes
                      .filter((n) => n.id !== "start")
                      .map((n) => n.id);
                    const isAllSelected = eligibleNodeIds.every((id) =>
                      selectedNodeIds.has(id),
                    );
                    if (isAllSelected) {
                      onSelectAll?.(new Set());
                    } else {
                      onSelectNodeWithToggle?.(null);
                      onSelectAll?.(new Set(eligibleNodeIds));
                    }
                  }
                }}
                title="Select All"
                className={cn(
                  "p-1 rounded hover:bg-accent hover:text-accent-foreground disabled:opacity-40",
                  nodes.length > 1 &&
                    nodes
                      .filter((n) => n.id !== "start")
                      .every((n) => selectedNodeIds.has(n.id)) &&
                    "bg-primary/10 text-primary hover:bg-primary/20",
                )}
              >
                <CheckSquare className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onToggleMultiSelectMode}
                title="Toggle Multi-select Mode"
                className={cn(
                  "p-1 rounded hover:bg-accent transition-colors",
                  isMultiSelectMode
                    ? "bg-primary/10 text-primary hover:bg-primary/20"
                    : "text-muted-foreground",
                )}
              >
                <Layers className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="text-[11px] text-muted-foreground text-center font-medium">
            Selected:{" "}
            <span className="font-bold text-foreground">
              {selectedNodeIds.size}
            </span>
          </div>

          <div className="flex items-center gap-1 bg-muted/50 rounded-md border border-border px-2 py-1">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchQueryChange(e.target.value)}
              placeholder="Search nodes..."
              className="flex-1 min-w-0 bg-transparent text-xs outline-none border-none placeholder-muted-foreground focus:ring-0 p-0"
            />
            {searchQuery && (
              <div className="flex items-center gap-0.5 shrink-0">
                <span className="text-[10px] text-muted-foreground mr-1">
                  {searchResults.length > 0
                    ? `${currentResultIndex + 1}/${searchResults.length}`
                    : "0/0"}
                </span>
                <button
                  type="button"
                  disabled={searchResults.length <= 1}
                  onClick={() => {
                    const nextIdx =
                      (currentResultIndex - 1 + searchResults.length) %
                      searchResults.length;
                    onCurrentResultIndexChange(nextIdx);
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5 rotate-180" />
                </button>
                <button
                  type="button"
                  disabled={searchResults.length <= 1}
                  onClick={() => {
                    const nextIdx =
                      (currentResultIndex + 1) % searchResults.length;
                    onCurrentResultIndexChange(nextIdx);
                  }}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground disabled:opacity-30"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onSearchQueryChange("")}
                  className="p-0.5 rounded hover:bg-accent text-muted-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </div>
        </div>
        <ScriptCardStack
          nodes={nodes}
          edges={edges}
          selectedNodeId={selectedNodeId}
          draggedNodeType={draggedNodeType}
          debugNodeStatuses={debugNodeStatuses}
          disabled={disabled}
          collapsedBlockIds={collapsedBlockIds}
          onToggleCollapseBlock={onToggleCollapseBlock}
          onToggleErrorHandling={onToggleErrorHandling}
          onSelectNode={onSelectNodeWithToggle || onSelectNode}
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
          onMoveNode={onMoveNode}
          onConnectSlots={onConnectSlots}
          selectedNodeIds={selectedNodeIds}
          searchResults={searchResults}
          currentActiveMatchId={
            searchResults.length > 0 ? searchResults[currentResultIndex] : null
          }
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
          <VariableResourcePanel
            variables={v2Variables}
            resources={resources}
            onVariablesChange={onV2VariablesChange}
            onResourcesChange={onResourcesChange}
            onDoubleClickResource={onEditResource}
            disabled={disabled}
          />
        </aside>
      )}
    </div>
  );
}

export type { CardStackSlot } from "./card-stack/script-card-stack";
