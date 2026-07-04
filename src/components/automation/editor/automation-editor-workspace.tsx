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
import { LuPencil, LuPlus, LuSearch, LuTrash2, LuZap } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import type {
  AutomationCanvasEdge,
  AutomationCanvasNode,
  CanvasFunctionState,
} from "./serialize";

type DebugNodeStatus = "idle" | "running" | "success" | "error";

interface AutomationEditorWorkspaceProps {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  selectedNodeId: string | null;
  pendingAddNodeId?: string | null;
  justAddedNodeId?: string | null;
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

  // Multi-function props
  functions: CanvasFunctionState[];
  activeFunctionName: string;
  switchActiveFunction: (name: string) => void;
  addFunction: (name: string) => void;
  renameFunction: (oldName: string, newName: string) => void;
  deleteFunction: (name: string) => void;
}

export function AutomationEditorWorkspace({
  nodes,
  edges,
  selectedNodeId,
  pendingAddNodeId,
  justAddedNodeId,
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

  // Multi-function props
  functions,
  activeFunctionName,
  switchActiveFunction,
  addFunction,
  renameFunction,
  deleteFunction,
}: AutomationEditorWorkspaceProps) {
  const { t } = useTranslation();
  const [sidebarWidth, setSidebarWidth] = useState(384);
  const [isResizing, setIsResizing] = useState(false);

  // Switcher state
  const [funcSearchQuery, setFuncSearchQuery] = useState("");
  const [newFuncName, setNewFuncName] = useState("");
  const [editingFuncName, setEditingFuncName] = useState<string | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");
  const [deletingFuncName, setDeletingFuncName] = useState<string | null>(null);

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
          pendingAddNodeId={pendingAddNodeId}
          justAddedNodeId={justAddedNodeId}
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

        {/* Bottom Function Switcher in Left Column */}
        <div className="border-t border-border pt-2 mt-auto">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full rounded-md shadow-sm bg-background border-border text-xs px-3 py-2 flex items-center justify-between hover:bg-muted font-medium transition-all"
              >
                <div className="flex items-center gap-1.5 min-w-0">
                  <LuZap className="size-3 text-amber-500 fill-amber-500/20 shrink-0" />
                  <span className="truncate">{activeFunctionName}</span>
                </div>
                <ChevronDown className="size-3 text-muted-foreground shrink-0" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-[360px] p-3 bg-card border border-border shadow-lg rounded-lg flex flex-col gap-3"
              side="top"
              align="center"
            >
              <div className="flex items-center justify-between border-b border-border pb-2">
                <span className="text-xs font-semibold text-foreground">
                  Function list ({functions.length})
                </span>
              </div>

              {/* Search Box */}
              <div className="relative">
                <LuSearch className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
                <Input
                  placeholder="Search function..."
                  value={funcSearchQuery}
                  onChange={(e) => setFuncSearchQuery(e.target.value)}
                  className="pl-8 h-8 text-xs bg-muted/20 border-border"
                />
              </div>

              {/* Function list */}
              <div className="max-h-48 overflow-y-auto flex flex-col gap-1 min-h-12 pr-1">
                {functions
                  .filter((f) =>
                    f.name
                      .toLowerCase()
                      .includes(funcSearchQuery.toLowerCase()),
                  )
                  .map((f) => {
                    const isActive = f.name === activeFunctionName;
                    const isEditing = editingFuncName === f.name;

                    return (
                      <div
                        key={f.name}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          if (!isEditing) {
                            switchActiveFunction(f.name);
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            if (!isEditing) {
                              switchActiveFunction(f.name);
                            }
                          }
                        }}
                        className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                          isActive
                            ? "bg-primary/10 text-primary font-medium"
                            : "hover:bg-muted text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <LuZap
                            className={`size-3 shrink-0 ${isActive ? "text-primary fill-primary/10" : "text-muted-foreground"}`}
                          />
                          {isEditing ? (
                            <Input
                              size={1}
                              value={renameInputVal}
                              onChange={(e) =>
                                setRenameInputVal(e.target.value)
                              }
                              onClick={(e) => e.stopPropagation()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.stopPropagation();
                                  if (renameInputVal.trim()) {
                                    renameFunction(
                                      f.name,
                                      renameInputVal.trim(),
                                    );
                                    setEditingFuncName(null);
                                  }
                                } else if (e.key === "Escape") {
                                  e.stopPropagation();
                                  setEditingFuncName(null);
                                }
                              }}
                              className="h-6 text-xs px-1 py-0.5 border-border focus-visible:ring-1"
                              autoFocus
                            />
                          ) : (
                            <span className="truncate">{f.name}</span>
                          )}
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {isEditing ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (renameInputVal.trim()) {
                                  renameFunction(f.name, renameInputVal.trim());
                                }
                                setEditingFuncName(null);
                              }}
                              className="p-1 hover:text-primary rounded-md"
                            >
                              ✓
                            </button>
                          ) : (
                            f.name !== "Main" && (
                              <>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setEditingFuncName(f.name);
                                    setRenameInputVal(f.name);
                                  }}
                                  className="p-1 hover:text-foreground rounded-md"
                                  title="Rename"
                                >
                                  <LuPencil className="size-3 text-muted-foreground hover:text-foreground" />
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeletingFuncName(f.name);
                                  }}
                                  className="p-1 hover:text-destructive rounded-md"
                                  title="Delete"
                                >
                                  <LuTrash2 className="size-3 text-muted-foreground hover:text-destructive" />
                                </button>
                              </>
                            )
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Create new function input */}
              <div className="flex items-center gap-1.5 border-t border-border pt-2 mt-1">
                <Input
                  placeholder="New function name..."
                  value={newFuncName}
                  onChange={(e) => setNewFuncName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && newFuncName.trim()) {
                      addFunction(newFuncName.trim());
                      setNewFuncName("");
                    }
                  }}
                  className="h-8 text-xs bg-muted/20 border-border"
                />
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    if (newFuncName.trim()) {
                      addFunction(newFuncName.trim());
                      setNewFuncName("");
                    }
                  }}
                  className="h-8 px-2.5 bg-red-600 hover:bg-red-700 text-white shrink-0"
                >
                  <LuPlus className="size-3.5" />
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {/* Confirmation Dialog for Function Deletion inside Left Column */}
        <Dialog
          open={deletingFuncName !== null}
          onOpenChange={(open) => {
            if (!open) setDeletingFuncName(null);
          }}
        >
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Function</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete function &quot;
                {deletingFuncName}&quot;? All nodes inside this function will be
                deleted. This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => setDeletingFuncName(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (deletingFuncName) {
                    deleteFunction(deletingFuncName);
                  }
                  setDeletingFuncName(null);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
