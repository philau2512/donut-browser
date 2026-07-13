"use client";

import { useCallback, useEffect, useState } from "react";
import { useAutomationFlowState } from "@/hooks/use-automation-flow-state";
import type { BrowserProfile } from "@/types";
import { AutomationEditorDialogs } from "./automation-editor-dialogs";
import { AutomationEditorToolbar } from "./automation-editor-toolbar";
import { AutomationEditorWorkspace } from "./automation-editor-workspace";

const VIRTUAL_DEBUG_PROFILE: BrowserProfile = {
  id: "00000000-0000-0000-0000-000000000000",
  name: "Virtual Profile",
  browser: "wayfern",
  version: "latest",
  release_type: "stable",
  ephemeral: true,
  sync_mode: "Disabled" as any,
  tags: [],
  proxy_bypass_rules: [],
  password_protected: false,
};

interface FlowEditorPageProps {
  flowPath?: string;
  profiles?: BrowserProfile[];
  onBack: () => void;
  onSaved?: (flowPath: string) => void;
}

export function FlowEditorPage({
  flowPath,
  profiles,
  onBack,
  onSaved,
}: FlowEditorPageProps) {
  const {
    nodes,
    edges,
    isVariablesPanelOpen,
    setIsVariablesPanelOpen,
    isPropertiesDialogOpen,
    setIsPropertiesDialogOpen,
    isLogPanelOpen,
    setIsLogPanelOpen,
    isCanvasLocked,
    logSteps,
    flowLogs,
    selectedDebugProfile,
    setSelectedDebugProfile,
    debugRun,
    debugNodeStatuses,
    debugLogs,
    debugSteps,
    currentFlowPath,
    selectedNodeId,
    setSelectedNodeId,
    commentingNodeId,
    setCommentingNodeId,
    flowName,
    setFlowName,
    variables,
    setVariables,
    v2Variables,
    setV2Variables,
    v2Resources,
    setV2Resources,
    isScriptReportOpen,
    setIsScriptReportOpen,
    isResourceReportOpen,
    setIsResourceReportOpen,
    isResourceConfigOpen,
    setIsResourceConfigOpen,
    isEditResourceOpen,
    setIsEditResourceOpen,
    selectedResourceIdForConfig,
    setSelectedResourceIdForConfig,
    selectedResourceIdForEdit,
    setSelectedResourceIdForEdit,
    collapsedBlockIds,
    deletingBlockId,
    setDeletingBlockId,
    handleEditResource,
    report,
    isLoading,
    isSaving,
    isSaveAsDialogOpen,
    setIsSaveAsDialogOpen,
    saveAsName,
    setSaveAsName,
    draggedNodeType,
    activeInsertSlot,
    setActiveInsertSlot,
    labelCreationSlot,
    setLabelCreationSlot,
    newLabelName,
    setNewLabelName,
    selectedNode,
    commentingNode,
    handleEditNode,
    handleCommentNode,
    handleSaveComment,
    handleInsertNode,
    handleConfirmCreateLabel,
    handleCreateLabel,
    handleConnectSlots,
    handleMoveNode,
    handlePaletteItemClick,
    handleMoveToLabel,
    handleConfirmDeleteBlock,
    handleToggleCollapseBlock,
    handleToggleErrorHandling,
    handleDeleteNode,
    handleDuplicateNode,
    handleStartFromHere,
    handleDebugRunFull,
    handleDebugStepNext,
    handleDebugStepCurrent,
    handleStopDebugRun,
    nodesWithCallbacks,
    handleDragStart,
    updateSelectedParam,
    updateSelectedContinueOnError,
    updateSelectedSleepAfter,
    handleSave,
    handleSaveAsClick,
    handleConfirmSaveAs,
    selectNodeNoFocus,
    selectNodeAndFocus,
    // Search
    searchQuery,
    setSearchQuery,
    searchResults,
    currentResultIndex,
    setCurrentResultIndex,
    // History
    historyPast,
    historyFuture,
    handleUndo,
    handleRedo,
    // Clipboard
    handleCopy,
    handleCut,
    handlePaste,
    // Multi-select
    isMultiSelectMode,
    setIsMultiSelectMode,
    selectedNodeIds,
    setSelectedNodeIds,
    handleSelectNode,
    pendingAddNodeId,
    handleConfirmProperties,
    handleCancelProperties,
    justAddedNodeId,
    setJustAddedNodeId,
    // Multi-function states
    functions,
    activeFunctionName,
    switchActiveFunction,
    addFunction,
    renameFunction,
    deleteFunction,
  } = useAutomationFlowState({
    flowPath,
    onSaved,
  });

  const [isCreateResourceWizardOpen, setIsCreateResourceWizardOpen] =
    useState(false);
  const [zoom, setZoom] = useState(0.9);

  const handleZoomIn = useCallback(
    () => setZoom((z) => Math.min(1.5, z + 0.05)),
    [],
  );
  const handleZoomOut = useCallback(
    () => setZoom((z) => Math.max(0.7, z - 0.05)),
    [],
  );
  const handleResetZoom = useCallback(() => setZoom(1.0), []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          handleZoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          handleZoomOut();
        } else if (e.key === "0") {
          e.preventDefault();
          handleResetZoom();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleZoomIn, handleZoomOut, handleResetZoom]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 relative">
      <AutomationEditorToolbar
        flowName={flowName}
        profiles={profiles}
        selectedDebugProfileId={selectedDebugProfile?.id}
        isVariablesPanelOpen={isVariablesPanelOpen}
        isLogPanelOpen={isLogPanelOpen}
        isDebugRunning={debugRun.isRunning}
        isLoading={isLoading}
        isSaving={isSaving}
        hasCurrentFlowPath={Boolean(currentFlowPath)}
        zoom={zoom}
        onBack={onBack}
        onFlowNameChange={setFlowName}
        onDebugProfileChange={(id) => {
          if (!id) {
            setSelectedDebugProfile(null);
          } else if (id === "00000000-0000-0000-0000-000000000000") {
            setSelectedDebugProfile(VIRTUAL_DEBUG_PROFILE);
          } else {
            const profile =
              profiles?.find((profile) => profile.id === id) ?? null;
            setSelectedDebugProfile(profile);
          }
        }}
        onToggleVariablesPanel={() =>
          setIsVariablesPanelOpen((value) => !value)
        }
        onOpenResourceConfig={() => setIsResourceConfigOpen(true)}
        onOpenScriptReport={() => setIsScriptReportOpen(true)}
        onOpenResourceReport={() => setIsResourceReportOpen(true)}
        onToggleLogPanel={() => setIsLogPanelOpen((value) => !value)}
        onDebugRunFull={handleDebugRunFull}
        onDebugStepNext={handleDebugStepNext}
        onDebugStepCurrent={handleDebugStepCurrent}
        onStopDebugRun={handleStopDebugRun}
        onSaveAsClick={handleSaveAsClick}
        onSave={() => void handleSave()}
        onZoomIn={handleZoomIn}
        onZoomOut={handleZoomOut}
        onResetZoom={handleResetZoom}
      />

      <AutomationEditorWorkspace
        nodes={nodesWithCallbacks}
        edges={edges}
        selectedNodeId={selectedNodeId}
        pendingAddNodeId={pendingAddNodeId}
        justAddedNodeId={justAddedNodeId}
        draggedNodeType={draggedNodeType}
        debugNodeStatuses={debugNodeStatuses}
        disabled={isCanvasLocked || debugRun.isRunning}
        isVariablesPanelOpen={isVariablesPanelOpen}
        isLogPanelOpen={isLogPanelOpen}
        showDebugOutput={debugRun.isRunning || debugRun.logs.length > 0}
        debugLogs={debugLogs}
        flowLogs={flowLogs}
        debugSteps={debugSteps}
        logSteps={logSteps}
        variables={variables}
        v2Variables={v2Variables}
        resources={v2Resources}
        isDebugRunning={debugRun.isRunning}
        collapsedBlockIds={collapsedBlockIds}
        onToggleCollapseBlock={handleToggleCollapseBlock}
        onToggleErrorHandling={handleToggleErrorHandling}
        onPaletteDragStart={handleDragStart}
        onSelectNode={selectNodeNoFocus}
        onInsertNode={handleInsertNode}
        onDeleteNode={handleDeleteNode}
        onDuplicateNode={handleDuplicateNode}
        onEditNode={handleEditNode}
        onCommentNode={handleCommentNode}
        onStartFromHereNode={handleStartFromHere}
        onCreateLabel={handleCreateLabel}
        onMoveToLabel={handleMoveToLabel}
        onVariablesChange={setVariables}
        onV2VariablesChange={setV2Variables}
        onResourcesChange={setV2Resources}
        onAddResource={() => setIsCreateResourceWizardOpen(true)}
        onEditResource={handleEditResource}
        onCloseLogPanel={() => setIsLogPanelOpen(false)}
        onSelectLogNode={selectNodeAndFocus}
        activeInsertSlot={activeInsertSlot}
        onSelectSlot={setActiveInsertSlot}
        onPaletteItemClick={handlePaletteItemClick}
        onMoveNode={handleMoveNode}
        onConnectSlots={handleConnectSlots}
        // Search props
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        searchResults={searchResults}
        currentResultIndex={currentResultIndex}
        onCurrentResultIndexChange={setCurrentResultIndex}
        // Zoom prop
        zoom={zoom}
        // Multi-select props
        isMultiSelectMode={isMultiSelectMode}
        onToggleMultiSelectMode={() => setIsMultiSelectMode((v) => !v)}
        selectedNodeIds={selectedNodeIds}
        onSelectNodeWithToggle={handleSelectNode}
        onSelectAll={setSelectedNodeIds}
        // History props
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={(historyPast[activeFunctionName] ?? []).length > 0}
        canRedo={(historyFuture[activeFunctionName] ?? []).length > 0}
        // Clipboard props
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
        // Multi-function props
        functions={functions}
        activeFunctionName={activeFunctionName}
        switchActiveFunction={switchActiveFunction}
        addFunction={addFunction}
        renameFunction={renameFunction}
        deleteFunction={deleteFunction}
      />

      <AutomationEditorDialogs
        isPropertiesDialogOpen={isPropertiesDialogOpen}
        selectedNode={selectedNode}
        nodes={nodes}
        edges={edges}
        variables={variables}
        functions={functions.map((f) => f.name)}
        onPropertiesOpenChange={(open) => {
          setIsPropertiesDialogOpen(open);
          if (!open) {
            if (pendingAddNodeId) {
              handleCancelProperties();
            } else {
              if (selectedNodeId !== justAddedNodeId) {
                setSelectedNodeId(null);
              }
              setJustAddedNodeId(null);
            }
          }
        }}
        onConfirmProperties={handleConfirmProperties}
        onCancelProperties={handleCancelProperties}
        onParamChange={updateSelectedParam}
        onContinueOnErrorChange={updateSelectedContinueOnError}
        onSleepAfterChange={updateSelectedSleepAfter}
        onCommentChange={handleSaveComment}
        onCreateVariable={(name) => {
          setVariables((prev) => {
            if (name in prev) return prev;
            return { ...prev, [name]: "" };
          });
        }}
        commentingNodeId={commentingNodeId}
        commentingNode={commentingNode}
        onCloseComment={(comment) => {
          if (commentingNodeId) {
            handleSaveComment(commentingNodeId, comment);
          }
          setCommentingNodeId(null);
        }}
        isSaveAsDialogOpen={isSaveAsDialogOpen}
        saveAsName={saveAsName}
        isSaving={isSaving}
        onSaveAsOpenChange={setIsSaveAsDialogOpen}
        onSaveAsNameChange={setSaveAsName}
        onConfirmSaveAs={handleConfirmSaveAs}
        isResourceConfigOpen={isResourceConfigOpen}
        resources={v2Resources}
        selectedResourceIdForConfig={selectedResourceIdForConfig}
        onResourceConfigOpenChange={(open) => {
          setIsResourceConfigOpen(open);
          if (!open) setSelectedResourceIdForConfig(null);
        }}
        isEditResourceOpen={isEditResourceOpen}
        selectedResourceIdForEdit={selectedResourceIdForEdit}
        onEditResourceOpenChange={(open) => {
          setIsEditResourceOpen(open);
          if (!open) setSelectedResourceIdForEdit(null);
        }}
        onResourcesChange={setV2Resources}
        isCreateResourceWizardOpen={isCreateResourceWizardOpen}
        onCreateResourceWizardOpenChange={setIsCreateResourceWizardOpen}
        isScriptReportOpen={isScriptReportOpen}
        scriptReport={report.state.scriptReport}
        onScriptReportOpenChange={setIsScriptReportOpen}
        isResourceReportOpen={isResourceReportOpen}
        resourceReport={report.state.resourceReport}
        onResourceReportOpenChange={setIsResourceReportOpen}
        labelCreationSlot={labelCreationSlot}
        newLabelName={newLabelName}
        onLabelCreationSlotChange={setLabelCreationSlot}
        onNewLabelNameChange={setNewLabelName}
        onConfirmCreateLabel={handleConfirmCreateLabel}
        deletingBlockId={deletingBlockId}
        onConfirmDeleteBlock={handleConfirmDeleteBlock}
        onCancelDeleteBlock={() => setDeletingBlockId(null)}
      />
    </div>
  );
}
