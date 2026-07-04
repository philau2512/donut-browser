"use client";

import { useAutomationFlowState } from "@/hooks/use-automation-flow-state";
import type { BrowserProfile } from "@/types";
import { AutomationEditorDialogs } from "./automation-editor-dialogs";
import { AutomationEditorToolbar } from "./automation-editor-toolbar";
import { AutomationEditorWorkspace } from "./automation-editor-workspace";

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
    isFlowRunning,
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
    selectedResourceIdForConfig,
    setSelectedResourceIdForConfig,
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
    nodesWithCallbacks,
    handleDragStart,
    updateSelectedParam,
    updateSelectedContinueOnError,
    updateSelectedSleepAfter,
    handleSave,
    handleSaveAsClick,
    handleConfirmSaveAs,
    handleRunFlow,
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
  } = useAutomationFlowState({
    flowPath,
    onSaved,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <AutomationEditorToolbar
        flowName={flowName}
        profiles={profiles}
        selectedDebugProfileId={selectedDebugProfile?.id}
        isVariablesPanelOpen={isVariablesPanelOpen}
        isLogPanelOpen={isLogPanelOpen}
        isDebugRunning={debugRun.isRunning}
        isFlowRunning={isFlowRunning}
        isLoading={isLoading}
        isSaving={isSaving}
        hasCurrentFlowPath={Boolean(currentFlowPath)}
        onBack={onBack}
        onFlowNameChange={setFlowName}
        onDebugProfileChange={(id) => {
          const profile =
            profiles?.find((profile) => profile.id === id) ?? null;
          setSelectedDebugProfile(profile);
        }}
        onToggleVariablesPanel={() =>
          setIsVariablesPanelOpen((value) => !value)
        }
        onOpenResourceConfig={() => setIsResourceConfigOpen(true)}
        onOpenScriptReport={() => setIsScriptReportOpen(true)}
        onOpenResourceReport={() => setIsResourceReportOpen(true)}
        onToggleLogPanel={() => setIsLogPanelOpen((value) => !value)}
        onRunFlow={handleRunFlow}
        onStopDebugRun={() => void debugRun.stopDebugRun()}
        onSaveAsClick={handleSaveAsClick}
        onSave={() => void handleSave()}
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
        // Multi-select props
        isMultiSelectMode={isMultiSelectMode}
        onToggleMultiSelectMode={() => setIsMultiSelectMode((v) => !v)}
        selectedNodeIds={selectedNodeIds}
        onSelectNodeWithToggle={handleSelectNode}
        onSelectAll={setSelectedNodeIds}
        // History props
        onUndo={handleUndo}
        onRedo={handleRedo}
        canUndo={historyPast.length > 0}
        canRedo={historyFuture.length > 0}
        // Clipboard props
        onCopy={handleCopy}
        onCut={handleCut}
        onPaste={handlePaste}
      />

      <AutomationEditorDialogs
        isPropertiesDialogOpen={isPropertiesDialogOpen}
        selectedNode={selectedNode}
        nodes={nodes}
        edges={edges}
        variables={variables}
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
        onResourcesChange={setV2Resources}
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
