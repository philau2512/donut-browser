"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEdgesState, useNodesState } from "@xyflow/react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { useAutomationReport } from "@/hooks/use-automation-report";
import { useDebugRun } from "@/hooks/use-debug-run";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeCatalogItem,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import type {
  ResourceDefinition,
  VariableDefinition,
} from "@/lib/automation/resource-schema";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import type { BrowserProfile } from "@/types";
import { AutomationEditorDialogs } from "./automation-editor-dialogs";
import { AutomationEditorToolbar } from "./automation-editor-toolbar";
import {
  AutomationEditorWorkspace,
  type CardStackSlot,
} from "./automation-editor-workspace";
import {
  buildCardStackModel,
  edgeId,
} from "./card-stack/flow-card-stack-adapter";
import type { FlowExecutionStep, FlowLogLine } from "./flow-log-panel";
import { truncateFlowFromNode } from "./flow-truncation";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  createAutomationNode,
  createStartNode,
  type DonutFlow,
  type FlowLayoutSidecarV1,
  fromDonutFlow,
  START_NODE_ID,
  toDonutFlow,
  toLayoutSidecar,
} from "./serialize";

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
  const { t } = useTranslation();
  const [nodes, setNodes] = useNodesState<AutomationCanvasNode>([
    createStartNode(),
  ]);
  const [edges, setEdges] = useEdgesState<AutomationCanvasEdge>([]);

  // Workspace UI states
  const [isVariablesPanelOpen, setIsVariablesPanelOpen] = useState(true);
  const [isPropertiesDialogOpen, setIsPropertiesDialogOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);

  // Execution Simulation states
  const [isFlowRunning, setIsFlowRunning] = useState(false);
  const [logSteps, setLogSteps] = useState<FlowExecutionStep[]>([]);
  const [flowLogs, setFlowLogs] = useState<FlowLogLine[]>([]);

  // Debug run states
  const [selectedDebugProfile, setSelectedDebugProfile] =
    useState<BrowserProfile | null>(null);
  const debugRun = useDebugRun();
  const [debugNodeStatuses, setDebugNodeStatuses] = useState<
    Record<string, "idle" | "running" | "success" | "error">
  >({});

  const debugLogs = useMemo<FlowLogLine[]>(() => {
    return debugRun.logs.map((l, idx) => {
      let logType: "success" | "info" | "warn" | "error" = "info";
      if (l.level === "error") logType = "error";
      else if (l.level === "warn") logType = "warn";
      else if (l.level === "info" && l.msg?.startsWith("✓"))
        logType = "success";

      return {
        id: `debug-${idx}-${l.ts ?? ""}`,
        type: logType,
        message: l.msg ?? "",
        nodeId: l.nodeId ?? undefined,
      };
    });
  }, [debugRun.logs]);

  const debugSteps = useMemo<FlowExecutionStep[]>(() => {
    return nodes.map((n) => ({
      id: n.id,
      label:
        n.id === START_NODE_ID
          ? "Start"
          : t(
              AUTOMATION_NODE_BY_TYPE[n.data.nodeType as AutomationNodeType]
                ?.labelKey || "",
            ) || n.id,
      status:
        n.id === START_NODE_ID
          ? "success"
          : (debugNodeStatuses[n.id] ?? "idle"),
    }));
  }, [nodes, debugNodeStatuses, t]);

  // Parse debug logs -> update node statuses
  useEffect(() => {
    if (debugRun.logs.length === 0) return;
    const latest = debugRun.logs[debugRun.logs.length - 1];
    const { nodeId, msg } = latest;
    if (!nodeId || !msg) return;

    setDebugNodeStatuses((prev) => {
      const next = { ...prev };
      if (msg.startsWith("▶")) {
        // Mark previously running nodes as success
        for (const [id, status] of Object.entries(next)) {
          if (status === "running") next[id] = "success";
        }
        next[nodeId] = "running";
      } else if (msg.startsWith("✓")) {
        next[nodeId] = "success";
      } else if (msg.startsWith("✗")) {
        next[nodeId] = "error";
      }
      return next;
    });
  }, [debugRun.logs]);

  // Clear statuses when debug starts
  useEffect(() => {
    if (debugRun.isRunning) {
      setDebugNodeStatuses({});
    }
  }, [debugRun.isRunning]);

  const [currentFlowPath, setCurrentFlowPath] = useState<string | undefined>(
    flowPath,
  );
  const justSavedRef = useRef(false);

  // Sync prop flowPath with currentFlowPath
  useEffect(() => {
    setCurrentFlowPath(flowPath);
  }, [flowPath]);

  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [commentingNodeId, setCommentingNodeId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("Untitled flow");
  const [variables, setVariables] = useState<Record<string, string>>({});
  // Schema v2 structured variables and resources (resource allocation plan).
  const [v2Variables, setV2Variables] = useState<VariableDefinition[]>([]);
  const [v2Resources, setV2Resources] = useState<ResourceDefinition[]>([]);
  // Report dialog visibility.
  const [isScriptReportOpen, setIsScriptReportOpen] = useState(false);
  const [isResourceReportOpen, setIsResourceReportOpen] = useState(false);
  const [isResourceConfigOpen, setIsResourceConfigOpen] = useState(false);
  const [selectedResourceIdForConfig, setSelectedResourceIdForConfig] =
    useState<string | null>(null);

  const handleEditResource = useCallback((id: string) => {
    setSelectedResourceIdForConfig(id);
    setIsResourceConfigOpen(true);
  }, []);
  // Report state aggregated from automation-log events.
  const report = useAutomationReport(debugRun.runId ?? null);
  const [isLoading, setIsLoading] = useState(Boolean(flowPath));
  const [isSaving, setIsSaving] = useState(false);
  const [isSaveAsDialogOpen, setIsSaveAsDialogOpen] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);
  const [activeInsertSlot, setActiveInsertSlot] =
    useState<CardStackSlot | null>(null);
  const [labelCreationSlot, setLabelCreationSlot] =
    useState<CardStackSlot | null>(null);
  const [newLabelName, setNewLabelName] = useState("");
  const [connectionSourceSlot, setConnectionSourceSlot] =
    useState<CardStackSlot | null>(null);

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
    setActiveInsertSlot(null);
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

  const insertExistingNodeAtSlot = useCallback(
    (
      newNode: AutomationCanvasNode,
      slot: CardStackSlot,
      sourceHandle = "success",
    ) => {
      setNodes((current) => {
        if (current.some((node) => node.id === newNode.id)) return current;
        return [...current, newNode];
      });
      setEdges((current) => {
        const filtered = current.filter((edge) => {
          if (edge.source === newNode.id || edge.target === newNode.id)
            return false;
          if (!slot.previousNodeId) return true;
          return !(
            edge.source === slot.previousNodeId &&
            (edge.sourceHandle ?? "success") === sourceHandle
          );
        });
        const additions: AutomationCanvasEdge[] = [];
        if (slot.previousNodeId) {
          additions.push({
            id: edgeId(slot.previousNodeId, newNode.id, sourceHandle),
            source: slot.previousNodeId,
            target: newNode.id,
            sourceHandle,
          });
        }
        if (slot.nextNodeId && sourceHandle === "success") {
          additions.push({
            id: edgeId(newNode.id, slot.nextNodeId, "success"),
            source: newNode.id,
            target: slot.nextNodeId,
            sourceHandle: "success",
          });
        }
        return [...filtered, ...additions];
      });
      setSelectedNodeId(newNode.id);
    },
    [setEdges, setNodes],
  );

  const handleInsertNode = useCallback(
    (nodeType: AutomationNodeType, slot: CardStackSlot) => {
      const newNode = createAutomationNode(nodeType, {
        x: 360,
        y: 120 + slot.index * 120,
      });
      insertExistingNodeAtSlot(newNode, slot);
      setActiveInsertSlot({
        previousNodeId: newNode.id,
        nextNodeId: slot.nextNodeId,
        index: slot.index + 1,
      });
    },
    [insertExistingNodeAtSlot],
  );

  const generateDefaultLabelName = useCallback(() => {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `label name ${rand}`;
  }, []);

  const handleConfirmCreateLabel = useCallback(() => {
    if (!labelCreationSlot || !newLabelName.trim()) return;

    const labelName = newLabelName.trim();
    const slot = labelCreationSlot;

    const labelNode = createAutomationNode("label", {
      x: 360,
      y: 120 + slot.index * 120,
    });
    labelNode.data.params = {
      ...labelNode.data.params,
      labelName,
    };
    insertExistingNodeAtSlot(labelNode, slot);

    if (connectionSourceSlot) {
      const srcSlot = connectionSourceSlot;
      const moveNode = createAutomationNode("moveToLabel", {
        x: 520,
        y: 120 + srcSlot.index * 120,
      });
      moveNode.data.params = {
        ...moveNode.data.params,
        targetLabelNodeId: labelNode.id,
        targetLabelName: labelName,
      };
      insertExistingNodeAtSlot(moveNode, srcSlot);
    } else {
      setActiveInsertSlot({
        previousNodeId: labelNode.id,
        nextNodeId: slot.nextNodeId,
        index: slot.index + 1,
      });
    }

    setLabelCreationSlot(null);
    setNewLabelName("");
    setConnectionSourceSlot(null);
  }, [
    labelCreationSlot,
    connectionSourceSlot,
    newLabelName,
    insertExistingNodeAtSlot,
  ]);

  const handleCreateLabel = useCallback(
    (slot: CardStackSlot) => {
      setConnectionSourceSlot(null);
      setLabelCreationSlot(slot);
      setNewLabelName(generateDefaultLabelName());
    },
    [generateDefaultLabelName],
  );

  const handleConnectSlots = useCallback(
    (sourceSlot: CardStackSlot, targetSlot: CardStackSlot) => {
      setConnectionSourceSlot(sourceSlot);
      setLabelCreationSlot(targetSlot);
      setNewLabelName(generateDefaultLabelName());
    },
    [generateDefaultLabelName],
  );

  const handleMoveNode = useCallback(
    (nodeId: string, slot: CardStackSlot) => {
      const model = buildCardStackModel(nodes, edges);
      const orderedIds = model.items.map((item) => item.node.id);

      const oldIndex = orderedIds.indexOf(nodeId);
      if (oldIndex === -1) return;

      const targetIndex = slot.index;
      if (oldIndex === targetIndex || oldIndex === targetIndex - 1) return;

      const reorderedIds = [...orderedIds];
      reorderedIds.splice(oldIndex, 1);

      let newIndex = targetIndex;
      if (oldIndex < targetIndex) {
        newIndex = targetIndex - 1;
      }
      reorderedIds.splice(newIndex, 0, nodeId);

      setEdges((current) => {
        const nonSuccessEdges = current.filter(
          (edge) => (edge.sourceHandle ?? "success") !== "success",
        );

        const successEdges: AutomationCanvasEdge[] = [];
        for (let i = 0; i < reorderedIds.length - 1; i++) {
          const sourceId = reorderedIds[i];
          const targetId = reorderedIds[i + 1];
          successEdges.push({
            id: edgeId(sourceId, targetId, "success"),
            source: sourceId,
            target: targetId,
            sourceHandle: "success",
          });
        }

        return [...nonSuccessEdges, ...successEdges];
      });
    },
    [nodes, edges, setEdges],
  );

  const handlePaletteItemClick = useCallback(
    (item: AutomationNodeCatalogItem) => {
      if (activeInsertSlot) {
        handleInsertNode(item.type, activeInsertSlot);
      }
    },
    [activeInsertSlot, handleInsertNode],
  );

  const handleMoveToLabel = useCallback(
    (sourceNodeId: string, labelId: string, sourceHandle: string) => {
      const labelNode = nodes.find((node) => node.id === labelId);
      if (!labelNode) return;
      const moveNode = createAutomationNode("moveToLabel", {
        x: 520,
        y: 120 + nodes.length * 120,
      });
      moveNode.data.params = {
        ...moveNode.data.params,
        targetLabelNodeId: labelId,
        targetLabelName: String(labelNode.data.params.labelName ?? labelId),
      };
      insertExistingNodeAtSlot(
        moveNode,
        { previousNodeId: sourceNodeId, nextNodeId: null, index: nodes.length },
        sourceHandle,
      );
    },
    [insertExistingNodeAtSlot, nodes],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      const incomingSuccess = edges.find(
        (edge) =>
          edge.target === nodeId &&
          (edge.sourceHandle ?? "success") === "success",
      );
      const outgoingSuccess = edges.find(
        (edge) =>
          edge.source === nodeId &&
          (edge.sourceHandle ?? "success") === "success",
      );

      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => {
        const filtered = eds.filter(
          (e) => e.source !== nodeId && e.target !== nodeId,
        );
        if (
          incomingSuccess &&
          outgoingSuccess &&
          incomingSuccess.source !== outgoingSuccess.target
        ) {
          return [
            ...filtered,
            {
              id: edgeId(
                incomingSuccess.source,
                outgoingSuccess.target,
                "success",
              ),
              source: incomingSuccess.source,
              target: outgoingSuccess.target,
              sourceHandle: "success",
            },
          ];
        }
        return filtered;
      });
      if (selectedNodeId === nodeId) {
        setSelectedNodeId(null);
      }
    },
    [edges, selectedNodeId, setEdges, setNodes],
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      const source = nodes.find((n) => n.id === nodeId);
      if (!source || source.data.nodeType === "start") return;
      const successEdge = edges.find(
        (edge) =>
          edge.source === nodeId &&
          (edge.sourceHandle ?? "success") === "success",
      );
      const newNode: AutomationCanvasNode = {
        ...source,
        id: `${source.data.nodeType}-${Date.now()}`,
        position: {
          x: source.position.x,
          y: source.position.y + 120,
        },
        selected: false,
        data: { ...source.data, params: { ...source.data.params } },
      };
      insertExistingNodeAtSlot(newNode, {
        previousNodeId: nodeId,
        nextNodeId: successEdge?.target ?? null,
        index: 0,
      });
    },
    [edges, insertExistingNodeAtSlot, nodes],
  );

  const handleStartFromHere = useCallback(
    async (nodeId: string) => {
      if (!selectedDebugProfile) {
        showErrorToast(
          t("automation.editor.debugProfile.required") ||
            "Vui lòng chọn profile để debug",
        );
        return;
      }
      if (debugRun.isRunning) return;

      const node = nodes.find((n) => n.id === nodeId);
      const label = node
        ? t(
            AUTOMATION_NODE_BY_TYPE[node.data.nodeType as AutomationNodeType]
              ?.labelKey || "",
          )
        : nodeId;

      try {
        const fullFlow = toDonutFlow(flowName.trim(), nodes, edges, variables, {
          schemaVersion: 2,
          v2Variables: v2Variables.length > 0 ? v2Variables : undefined,
          resources: v2Resources,
        });
        const truncated = truncateFlowFromNode(fullFlow, nodeId);
        if (truncated.nodes.length === 0) {
          showErrorToast(
            t("automation.editor.debug.noNodes") ||
              "Không có node nào để chạy từ điểm này",
          );
          return;
        }

        showSuccessToast(
          t("automation.editor.debug.startFromHere", { name: label }) ||
            `Bắt đầu debug từ: ${label}`,
        );

        const json = JSON.stringify(truncated, null, 2);
        setIsLogPanelOpen(true);
        setIsCanvasLocked(true);
        await debugRun.startDebugRun(json, selectedDebugProfile);
      } catch (err) {
        showErrorToast(
          t("automation.editor.errors.startFailed", {
            error: JSON.stringify(err),
          }) || `Debug failed to start: ${JSON.stringify(err)}`,
        );
      }
    },
    [
      nodes,
      t,
      selectedDebugProfile,
      debugRun,
      flowName,
      edges,
      variables,
      v2Variables,
      v2Resources,
    ],
  );

  // Automatically unlock canvas when debug execution completes
  useEffect(() => {
    if (!debugRun.isRunning) {
      setIsCanvasLocked(false);
    }
  }, [debugRun.isRunning]);

  const nodesWithCallbacks = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        onEdit: handleEditNode,
        onDelete: handleDeleteNode,
        onStartFromHere: handleStartFromHere,
        onComment: handleCommentNode,
        debugStatus: debugNodeStatuses[node.id] ?? undefined,
      },
    }));
  }, [
    nodes,
    selectedNodeId,
    handleEditNode,
    handleDeleteNode,
    handleStartFromHere,
    handleCommentNode,
    debugNodeStatuses,
  ]);

  useEffect(() => {
    if (!currentFlowPath) {
      setFlowName("Untitled flow");
      setVariables({});
      setV2Variables([]);
      setV2Resources([]);
      setNodes([createStartNode()]);
      setEdges([]);
      setIsLoading(false);
      return;
    }
    if (justSavedRef.current) {
      justSavedRef.current = false;
      return;
    }
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const raw = await invoke<string>("read_automation_flow", {
          path: currentFlowPath,
        });
        const flow = JSON.parse(raw) as DonutFlow;
        let layout: FlowLayoutSidecarV1 | null = null;
        try {
          const rawLayout = await invoke<string>(
            "read_automation_flow_layout",
            {
              flowPath: currentFlowPath,
            },
          );
          layout = JSON.parse(rawLayout) as FlowLayoutSidecarV1;
        } catch {
          layout = null;
        }
        if (cancelled) return;
        const canvas = fromDonutFlow(flow, layout);
        setFlowName(flow.name);
        setVariables(canvas.variables);
        setV2Variables(canvas.v2Variables);
        setV2Resources(canvas.resources);
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
  }, [currentFlowPath, setEdges, setNodes, t]);

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

  const updateSelectedSleepAfter = (
    key: "sleepAfterFrom" | "sleepAfterTo",
    value: string | number | undefined,
  ) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                [key]: value,
              },
            }
          : node,
      ),
    );
  };

  const handleSave = async (customName?: string, isSaveAs = false) => {
    setIsSaving(true);
    try {
      const activeName = (customName || flowName).trim();
      if (!activeName) {
        showErrorToast(
          t("automation.editor.errors.nameRequired") || "Flow name is required",
        );
        return;
      }

      const flow = toDonutFlow(activeName, nodes, edges, variables, {
        schemaVersion: 2,
        v2Variables: v2Variables.length > 0 ? v2Variables : undefined,
        resources: v2Resources,
      });
      const json = JSON.stringify(flow, null, 2);

      const shouldOverwrite = !isSaveAs && Boolean(currentFlowPath);
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
            t("automation.script.confirm.overwriteImport", {
              name: flow.name,
            }) || `A flow named "${flow.name}" already exists. Overwrite?`,
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

      // If we are renaming the flow (not Save As), clean up the old file
      if (!isSaveAs && currentFlowPath && currentFlowPath !== savedPath) {
        try {
          await invoke("delete_automation_flow", { path: currentFlowPath });
        } catch (e) {
          console.warn(`Failed to clean up old flow file: ${e}`);
        }
      }

      justSavedRef.current = true;
      setCurrentFlowPath(savedPath);
      if (customName) {
        setFlowName(customName);
      }
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

  const handleSaveAsClick = () => {
    setSaveAsName(`${flowName} - Copy`);
    setIsSaveAsDialogOpen(true);
  };

  const handleConfirmSaveAs = () => {
    setIsSaveAsDialogOpen(false);
    void handleSave(saveAsName, true);
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
          nodeId: step.id,
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
            nodeId: step.id,
          },
        ]);
        currentIdx++;
        runNextStep();
      }, 1000);
    };

    runNextStep();
  }, [nodes, isFlowRunning, t]);

  const selectNodeNoFocus = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setIsPropertiesDialogOpen(false);
    if (nodeId !== null) {
      setActiveInsertSlot(null);
    }
  };

  const selectNodeAndFocus = (nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    setIsPropertiesDialogOpen(false);
    if (nodeId !== null) {
      setActiveInsertSlot(null);
    }
  };

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
        resources={v2Resources}
        isDebugRunning={debugRun.isRunning}
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
        onResourcesChange={setV2Resources}
        onEditResource={handleEditResource}
        onCloseLogPanel={() => setIsLogPanelOpen(false)}
        onSelectLogNode={selectNodeAndFocus}
        activeInsertSlot={activeInsertSlot}
        onSelectSlot={setActiveInsertSlot}
        onPaletteItemClick={handlePaletteItemClick}
        onMoveNode={handleMoveNode}
        onConnectSlots={handleConnectSlots}
      />

      <AutomationEditorDialogs
        isPropertiesDialogOpen={isPropertiesDialogOpen}
        selectedNode={selectedNode}
        nodes={nodes}
        edges={edges}
        variables={variables}
        onPropertiesOpenChange={(open) => {
          setIsPropertiesDialogOpen(open);
          if (!open) setSelectedNodeId(null);
        }}
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
      />
    </div>
  );
}
