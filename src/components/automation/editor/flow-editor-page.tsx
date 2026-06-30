"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEdgesState, useNodesState } from "@xyflow/react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LuList, LuPlay, LuSave, LuVariable } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeCatalogItem,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { FlowCanvas } from "./flow-canvas";
import {
  type FlowExecutionStep,
  type FlowLogLine,
  FlowLogPanel,
} from "./flow-log-panel";
import { NodeCommentDialog } from "./node-comment-dialog";
import { NodePalette } from "./node-palette";
import { NodePropertiesDialog } from "./node-properties-dialog";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  createStartNode,
  type DonutFlowV1,
  type FlowLayoutSidecarV1,
  fromDonutFlow,
  START_NODE_ID,
  toDonutFlow,
  toLayoutSidecar,
} from "./serialize";
import { VariablesPanel } from "./variables-panel";

interface FlowEditorPageProps {
  flowPath?: string;
  onBack: () => void;
  onSaved?: (flowPath: string) => void;
}

export function FlowEditorPage({
  flowPath,
  onBack,
  onSaved,
}: FlowEditorPageProps) {
  const { t } = useTranslation();
  const [nodes, setNodes, onNodesChange] = useNodesState<AutomationCanvasNode>([
    createStartNode(),
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<AutomationCanvasEdge>(
    [],
  );

  // Workspace UI states
  const [isVariablesPanelOpen, setIsVariablesPanelOpen] = useState(false);
  const [isPropertiesDialogOpen, setIsPropertiesDialogOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);

  // Execution Simulation states
  const [isFlowRunning, setIsFlowRunning] = useState(false);
  const [logSteps, setLogSteps] = useState<FlowExecutionStep[]>([]);
  const [flowLogs, setFlowLogs] = useState<FlowLogLine[]>([]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [commentingNodeId, setCommentingNodeId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("Untitled flow");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(Boolean(flowPath));
  const [isSaving, setIsSaving] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const commentingNode = useMemo(
    () => nodes.find((node) => node.id === commentingNodeId) ?? null,
    [nodes, commentingNodeId],
  );

  const handleEditNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    setIsPropertiesDialogOpen(true);
  }, []);

  const handleCommentNode = useCallback((nodeId: string) => {
    setCommentingNodeId(nodeId);
  }, []);

  const handleSaveComment = useCallback(
    (nodeId: string, commentText: string) => {
      setNodes((current) =>
        current.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  comment: commentText.trim() || undefined,
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) =>
        eds.filter((e) => e.source !== nodeId && e.target !== nodeId),
      );
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [selectedNodeId, setEdges, setNodes],
  );

  const handleStartFromHere = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      const label = node
        ? t(
            AUTOMATION_NODE_BY_TYPE[node.data.nodeType as AutomationNodeType]
              ?.labelKey || "",
          )
        : nodeId;
      showSuccessToast(
        t("automation.editor.toast.startFromHere", { name: label }) ||
          `Chạy từ node: ${label}`,
      );
    },
    [nodes, t],
  );

  const nodesWithCallbacks = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        onEdit: handleEditNode,
        onDelete: handleDeleteNode,
        onStartFromHere: handleStartFromHere,
        onComment: handleCommentNode,
      },
    }));
  }, [
    nodes,
    handleEditNode,
    handleDeleteNode,
    handleStartFromHere,
    handleCommentNode,
  ]);

  useEffect(() => {
    if (!flowPath) return;
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const raw = await invoke<string>("read_automation_flow", {
          path: flowPath,
        });
        const flow = JSON.parse(raw) as DonutFlowV1;
        let layout: FlowLayoutSidecarV1 | null = null;
        try {
          const rawLayout = await invoke<string>(
            "read_automation_flow_layout",
            {
              flowPath,
            },
          );
          layout = JSON.parse(rawLayout) as FlowLayoutSidecarV1;
        } catch {
          layout = null;
        }
        if (cancelled) return;
        const canvas = fromDonutFlow(flow, layout);
        setFlowName(flow.name);
        setVariables(flow.variables ?? {});
        setNodes(canvas.nodes);
        setEdges(canvas.edges);
      } catch (err) {
        showErrorToast(
          t("automation.editor.errors.loadFailed", {
            error: JSON.stringify(err),
          }),
        );
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [flowPath, setEdges, setNodes, t]);

  const handleDragStart = useCallback(
    (event: DragEvent, item: AutomationNodeCatalogItem) => {
      event.dataTransfer.setData("application/donut-node-type", item.type);
      event.dataTransfer.setData("text/plain", item.type);
      event.dataTransfer.effectAllowed = "copy";
      setDraggedNodeType(item.type);
    },
    [],
  );

  // NOTE: Do NOT clear draggedNodeType here — onDragEnd fires before/during onDrop on Tauri/WKWebView.
  // The next drag will overwrite the value. Clearing causes race condition where onDrop reads null.

  const updateSelectedParam = (
    key: string,
    value: string | number | boolean,
  ) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                params: { ...node.data.params, [key]: value },
              },
            }
          : node,
      ),
    );
  };

  const updateSelectedContinueOnError = (value: boolean) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? { ...node, data: { ...node.data, continueOnError: value } }
          : node,
      ),
    );
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const flow = toDonutFlow(flowName.trim(), nodes, edges, variables);
      const json = JSON.stringify(flow, null, 2);
      const shouldOverwrite = Boolean(flowPath);
      let savedPath: string;
      try {
        savedPath = await invoke<string>("write_automation_flow", {
          name: flow.name,
          json,
          overwrite: shouldOverwrite,
        });
      } catch (err) {
        if (!shouldOverwrite && String(err) === "exists") {
          const ok = window.confirm(
            t("automation.script.confirm.overwriteImport", { name: flow.name }),
          );
          if (!ok) return;
          savedPath = await invoke<string>("write_automation_flow", {
            name: flow.name,
            json,
            overwrite: true,
          });
        } else {
          throw err;
        }
      }

      await invoke("write_automation_flow_layout", {
        flowPath: savedPath,
        layoutJson: JSON.stringify(toLayoutSidecar(nodes), null, 2),
      });
      showSuccessToast(t("automation.editor.toast.saved", { name: flow.name }));
      onSaved?.(savedPath);
    } catch (err) {
      showErrorToast(
        t("automation.editor.errors.saveFailed", {
          error: JSON.stringify(err),
        }),
      );
    } finally {
      setIsSaving(false);
    }
  };

  // Run flow simulation
  const handleRunFlow = useCallback(() => {
    if (nodes.length === 0 || isFlowRunning) return;
    setIsFlowRunning(true);
    setIsLogPanelOpen(true);
    setFlowLogs([]);

    // Build steps based on nodes on canvas
    const executionSteps: FlowExecutionStep[] = nodes.map((n) => ({
      id: n.id,
      label:
        n.id === START_NODE_ID
          ? "Start"
          : t(
              AUTOMATION_NODE_BY_TYPE[n.data.nodeType as AutomationNodeType]
                ?.labelKey || "",
            ) || n.id,
      status: "idle",
    }));
    setLogSteps(executionSteps);

    // Simulate step-by-step execution
    let currentIdx = 0;
    const runNextStep = () => {
      if (currentIdx >= executionSteps.length) {
        setFlowLogs((prev) => [
          ...prev,
          {
            id: `log-end`,
            type: "info",
            message: "Script completed successfully.",
          },
        ]);
        setIsFlowRunning(false);
        return;
      }

      const step = executionSteps[currentIdx];
      // Mark step as running
      setLogSteps((prev) =>
        prev.map((s, idx) =>
          idx === currentIdx ? { ...s, status: "running" } : s,
        ),
      );
      setFlowLogs((prev) => [
        ...prev,
        {
          id: `log-run-${step.id}`,
          type: "info",
          message: `Executing action: ${step.label}`,
        },
      ]);

      setTimeout(() => {
        // Mark step as success
        setLogSteps((prev) =>
          prev.map((s, idx) =>
            idx === currentIdx ? { ...s, status: "success" } : s,
          ),
        );
        setFlowLogs((prev) => [
          ...prev,
          {
            id: `log-success-${step.id}`,
            type: "success",
            message: `${step.label} execution succeeded`,
            duration: Math.floor(Math.random() * 200) + 50,
          },
        ]);
        currentIdx++;
        runNextStep();
      }, 1000);
    };

    runNextStep();
  }, [nodes, isFlowRunning, t]);

  const selectNodeAndFocus = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      {/* Top Header Bar */}
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
            onChange={(event) => setFlowName(event.target.value)}
            placeholder={t("automation.editor.namePlaceholder")}
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Toggle Variables Panel */}
          <Button
            type="button"
            variant={isVariablesPanelOpen ? "secondary" : "outline"}
            size="icon"
            className="size-9"
            title={t("automation.editor.tabs.variables")}
            onClick={() => setIsVariablesPanelOpen((v) => !v)}
          >
            <LuVariable className="size-4" />
          </Button>

          {/* Toggle Log Panel */}
          <Button
            type="button"
            variant={isLogPanelOpen ? "secondary" : "outline"}
            size="icon"
            className="size-9"
            title={t("automation.editor.sidebar.showLogs")}
            onClick={() => setIsLogPanelOpen((v) => !v)}
          >
            <LuList className="size-4" />
          </Button>

          {/* Run */}
          <Button
            type="button"
            variant="outline"
            disabled={isFlowRunning || isLoading}
            onClick={handleRunFlow}
          >
            <LuPlay className="mr-2 size-4 text-emerald-500 fill-emerald-500/20" />
            {t("common.buttons.run")}
          </Button>

          {/* Save */}
          <Button
            type="button"
            disabled={isSaving || isLoading}
            onClick={() => void handleSave()}
          >
            <LuSave className="mr-2 size-4" />
            {isSaving
              ? t("automation.editor.saving")
              : t("common.buttons.save")}
          </Button>
        </div>
      </div>

      {/* Main Workspace Layout */}
      <div className="flex min-h-0 flex-1 gap-3 relative">
        {/* Left Action Palette */}
        <NodePalette onDragStart={handleDragStart} />

        {/* Center Section: Canvas & Bottom Log Panel */}
        <div className="flex-1 flex flex-col min-h-0 gap-3">
          <FlowCanvas
            nodes={nodesWithCallbacks}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            setNodes={setNodes}
            setEdges={setEdges}
            onSelectNode={selectNodeAndFocus}
            draggedNodeType={draggedNodeType}
            isLocked={isCanvasLocked}
            onToggleLock={() => setIsCanvasLocked((v) => !v)}
          />

          {isLogPanelOpen && (
            <FlowLogPanel
              logs={flowLogs}
              steps={logSteps}
              variables={variables}
              onClose={() => setIsLogPanelOpen(false)}
            />
          )}
        </div>

        {/* Right Sidebar: Variables Panel */}
        {isVariablesPanelOpen && (
          <aside className="w-72 shrink-0 border border-border bg-card rounded-lg flex flex-col overflow-hidden shadow-md">
            <VariablesPanel variables={variables} onChange={setVariables} />
          </aside>
        )}
      </div>

      {/* Node Properties Dialog (modal) */}
      <NodePropertiesDialog
        node={selectedNode}
        nodes={nodes}
        edges={edges}
        variables={variables}
        onOpenChange={(open) => {
          setIsPropertiesDialogOpen(open);
          if (!open) setSelectedNodeId(null);
        }}
        onParamChange={updateSelectedParam}
        onContinueOnErrorChange={updateSelectedContinueOnError}
      />

      <NodeCommentDialog
        key={commentingNodeId || "none"}
        node={commentingNode}
        onClose={(comment) => {
          if (commentingNodeId) {
            handleSaveComment(commentingNodeId, comment);
          }
          setCommentingNodeId(null);
        }}
      />
    </div>
  );
}
