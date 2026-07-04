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
import type { CardStackSlot } from "@/components/automation/editor/automation-editor-workspace";
import {
  buildCardStackModel,
  edgeId,
} from "@/components/automation/editor/card-stack/flow-card-stack-adapter";
import {
  deleteBlock,
  moveNode,
  toggleErrorHandling,
} from "@/components/automation/editor/flow-graph-mutations";
import type {
  FlowExecutionStep,
  FlowLogLine,
} from "@/components/automation/editor/flow-log-panel";
import { truncateFlowFromNode } from "@/components/automation/editor/flow-truncation";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  type CanvasFunctionState,
  createAutomationNode,
  createStartNode,
  type DonutFlow,
  type FlowLayoutSidecarV1,
  fromDonutFlow,
  START_NODE_ID,
  toDonutFlow,
  toLayoutSidecar,
} from "@/components/automation/editor/serialize";
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

export interface UseAutomationFlowStateProps {
  flowPath?: string;
  onSaved?: (flowPath: string) => void;
}

export function useAutomationFlowState({
  flowPath,
  onSaved,
}: UseAutomationFlowStateProps) {
  const { t } = useTranslation();
  const [nodes, setNodes] = useNodesState<AutomationCanvasNode>([
    createStartNode(),
  ]);
  const [edges, setEdges] = useEdgesState<AutomationCanvasEdge>([]);

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
  const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<string>>(
    new Set(),
  );
  const [deletingBlockId, setDeletingBlockId] = useState<string | null>(null);

  // Workspace UI states
  const [isVariablesPanelOpen, setIsVariablesPanelOpen] = useState(true);
  const [isPropertiesDialogOpen, setIsPropertiesDialogOpen] = useState(false);
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const [isCanvasLocked, setIsCanvasLocked] = useState(false);

  // Search/Filter states
  const [searchQuery, setSearchQuery] = useState("");
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Pending node states for Palette add-confirm flow
  const [pendingAddNodeId, setPendingAddNodeId] = useState<string | null>(null);
  const [draftNode, setDraftNode] = useState<AutomationCanvasNode | null>(null);
  const [pendingAddSlot, setPendingAddSlot] = useState<CardStackSlot | null>(
    null,
  );
  const [justAddedNodeId, setJustAddedNodeId] = useState<string | null>(null);

  // Multi-function states
  const [functions, setFunctions] = useState<CanvasFunctionState[]>([
    { name: "Main", nodes: [createStartNode()], edges: [] },
  ]);
  const [activeFunctionName, setActiveFunctionName] = useState<string>("Main");

  // History (Undo/Redo) states per function name
  const [historyPast, setHistoryPast] = useState<
    Record<
      string,
      Array<{ nodes: AutomationCanvasNode[]; edges: AutomationCanvasEdge[] }>
    >
  >({});
  const [historyFuture, setHistoryFuture] = useState<
    Record<
      string,
      Array<{ nodes: AutomationCanvasNode[]; edges: AutomationCanvasEdge[] }>
    >
  >({});

  const searchResults = useMemo<string[]>(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];
    return nodes
      .filter((n) => {
        if (n.id.toLowerCase().includes(query)) return true;
        const label = t(
          AUTOMATION_NODE_BY_TYPE[n.data.nodeType as AutomationNodeType]
            ?.labelKey || "",
        ).toLowerCase();
        if (label.includes(query)) return true;
        if (n.data.comment?.toLowerCase().includes(query)) return true;
        return Object.values(n.data.params || {}).some((val) =>
          String(val).toLowerCase().includes(query),
        );
      })
      .map((n) => n.id);
  }, [nodes, searchQuery, t]);

  // Multi-select states
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(
    new Set(),
  );

  const pushHistory = useCallback(
    (
      currentNodes: AutomationCanvasNode[],
      currentEdges: AutomationCanvasEdge[],
    ) => {
      setHistoryPast((prev) => {
        const funcPast = prev[activeFunctionName] ?? [];
        return {
          ...prev,
          [activeFunctionName]: [
            ...funcPast,
            {
              nodes: JSON.parse(JSON.stringify(currentNodes)),
              edges: JSON.parse(JSON.stringify(currentEdges)),
            },
          ],
        };
      });
      setHistoryFuture((prev) => ({
        ...prev,
        [activeFunctionName]: [],
      }));
    },
    [activeFunctionName],
  );

  const handleUndo = useCallback(() => {
    const funcPast = historyPast[activeFunctionName] ?? [];
    if (funcPast.length === 0) return;
    const previous = funcPast[funcPast.length - 1];
    setHistoryPast((prev) => ({
      ...prev,
      [activeFunctionName]: (prev[activeFunctionName] ?? []).slice(0, -1),
    }));
    setHistoryFuture((prev) => {
      const funcFuture = prev[activeFunctionName] ?? [];
      return {
        ...prev,
        [activeFunctionName]: [
          ...funcFuture,
          {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
          },
        ],
      };
    });
    setNodes(previous.nodes);
    setEdges(previous.edges);
  }, [activeFunctionName, historyPast, nodes, edges, setNodes, setEdges]);

  const handleRedo = useCallback(() => {
    const funcFuture = historyFuture[activeFunctionName] ?? [];
    if (funcFuture.length === 0) return;
    const next = funcFuture[funcFuture.length - 1];
    setHistoryFuture((prev) => ({
      ...prev,
      [activeFunctionName]: (prev[activeFunctionName] ?? []).slice(0, -1),
    }));
    setHistoryPast((prev) => {
      const funcPast = prev[activeFunctionName] ?? [];
      return {
        ...prev,
        [activeFunctionName]: [
          ...funcPast,
          {
            nodes: JSON.parse(JSON.stringify(nodes)),
            edges: JSON.parse(JSON.stringify(edges)),
          },
        ],
      };
    });
    setNodes(next.nodes);
    setEdges(next.edges);
  }, [activeFunctionName, historyFuture, nodes, edges, setNodes, setEdges]);

  const switchActiveFunction = useCallback(
    (targetName: string) => {
      setFunctions((currentFuncs) => {
        const updated = currentFuncs.map((f) => {
          if (f.name === activeFunctionName) {
            return { ...f, nodes, edges };
          }
          return f;
        });

        const target = updated.find((f) => f.name === targetName);
        if (target) {
          setNodes(target.nodes);
          setEdges(target.edges);
          setActiveFunctionName(targetName);
        }
        return updated;
      });
    },
    [activeFunctionName, nodes, edges, setNodes, setEdges],
  );

  const addFunction = useCallback(
    (name: string) => {
      setFunctions((currentFuncs) => {
        if (currentFuncs.some((f) => f.name === name)) {
          showErrorToast(
            t("automation.editor.errors.functionExists") ||
              "Tên hàm đã tồn tại",
          );
          return currentFuncs;
        }
        return [
          ...currentFuncs,
          { name, nodes: [createStartNode()], edges: [] },
        ];
      });
    },
    [t],
  );

  const renameFunction = useCallback(
    (oldName: string, newName: string) => {
      if (newName === "Main" || oldName === "Main") {
        showErrorToast(
          t("automation.editor.errors.cannotRenameMain") ||
            "Không thể đổi tên hàm Main",
        );
        return;
      }
      setFunctions((currentFuncs) => {
        if (currentFuncs.some((f) => f.name === newName)) {
          showErrorToast(
            t("automation.editor.errors.functionExists") ||
              "Tên hàm đã tồn tại",
          );
          return currentFuncs;
        }
        return currentFuncs.map((f) => {
          if (f.name === oldName) {
            return { ...f, name: newName };
          }
          return f;
        });
      });
      if (activeFunctionName === oldName) {
        setActiveFunctionName(newName);
      }
    },
    [activeFunctionName, t],
  );

  const deleteFunction = useCallback(
    (nameToDelete: string) => {
      if (nameToDelete === "Main") {
        showErrorToast(
          t("automation.editor.errors.cannotDeleteMain") ||
            "Không thể xóa hàm Main",
        );
        return;
      }
      setFunctions((currentFuncs) => {
        const filtered = currentFuncs.filter((f) => f.name !== nameToDelete);
        if (activeFunctionName === nameToDelete) {
          const main = filtered.find((f) => f.name === "Main") || filtered[0];
          if (main) {
            setNodes(main.nodes);
            setEdges(main.edges);
            setActiveFunctionName(main.name);
          }
        }
        return filtered;
      });
    },
    [activeFunctionName, setNodes, setEdges, t],
  );

  // System Clipboard Copy/Cut/Paste
  const handleCopy = useCallback(async () => {
    const model = buildCardStackModel(nodes, edges);
    const orderedIds = model.items.map((item) => item.node.id);
    const selectedNodes = nodes
      .filter((n) => selectedNodeIds.has(n.id) && n.id !== START_NODE_ID)
      .sort((a, b) => orderedIds.indexOf(a.id) - orderedIds.indexOf(b.id));

    if (selectedNodes.length === 0) return;

    const selectedIdsSet = new Set(selectedNodes.map((n) => n.id));
    const selectedEdges = edges.filter(
      (e) => selectedIdsSet.has(e.source) && selectedIdsSet.has(e.target),
    );

    const payload = {
      signature: "donut-automation-nodes",
      version: 2,
      nodes: selectedNodes,
      edges: selectedEdges,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      showSuccessToast(
        t("automation.editor.toast.copied", { count: selectedNodes.length }) ||
          `Đã sao chép ${selectedNodes.length} node vào clipboard`,
      );
    } catch (_err) {
      showErrorToast("Không thể ghi vào clipboard hệ thống");
    }
  }, [nodes, edges, selectedNodeIds, t]);

  const handleCut = useCallback(async () => {
    if (selectedNodeIds.size === 0) return;
    pushHistory(nodes, edges);
    await handleCopy();

    setNodes((current) =>
      current.filter(
        (n) => !selectedNodeIds.has(n.id) || n.id === START_NODE_ID,
      ),
    );
    setEdges((current) =>
      current.filter(
        (e) => !selectedNodeIds.has(e.source) && !selectedNodeIds.has(e.target),
      ),
    );
    setSelectedNodeIds(new Set());
    setSelectedNodeId(null);
  }, [
    nodes,
    edges,
    selectedNodeIds,
    handleCopy,
    pushHistory,
    setNodes,
    setEdges,
  ]);

  const handlePaste = useCallback(async () => {
    if (!selectedNodeId) return;

    try {
      const text = await navigator.clipboard.readText();
      if (!text.startsWith('{"signature":"donut-automation-nodes"')) {
        showErrorToast("Clipboard không chứa dữ liệu Donut Flow hợp lệ");
        return;
      }

      const payload = JSON.parse(text);
      const copiedNodes: AutomationCanvasNode[] = payload.nodes || [];
      const copiedEdges: AutomationCanvasEdge[] = payload.edges || [];

      if (copiedNodes.length === 0) return;

      pushHistory(nodes, edges);

      const idMap = new Map<string, string>();
      const newNodes: AutomationCanvasNode[] = copiedNodes.map((n) => {
        const newId = `${n.data.nodeType}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
        idMap.set(n.id, newId);
        return {
          ...n,
          id: newId,
          selected: false,
        };
      });

      const newEdges: AutomationCanvasEdge[] = copiedEdges
        .filter((e) => idMap.has(e.source) && idMap.has(e.target))
        .map((e) => {
          const source = idMap.get(e.source) || "";
          const target = idMap.get(e.target) || "";
          return {
            ...e,
            id: edgeId(source, target, e.sourceHandle ?? "success"),
            source,
            target,
          };
        });

      const model = buildCardStackModel(nodes, edges);
      const orderedIds = model.items.map((item) => item.node.id);
      const selIndex = orderedIds.indexOf(selectedNodeId);
      if (selIndex === -1) return;

      const outgoingEdge = edges.find(
        (e) =>
          e.source === selectedNodeId &&
          (e.sourceHandle ?? "success") === "success",
      );

      setNodes((current) => {
        const next = [...current];
        const newIdsSet = new Set(newNodes.map((n) => n.id));
        const filtered = next.filter((n) => !newIdsSet.has(n.id));
        return [...filtered, ...newNodes];
      });

      setEdges((current) => {
        const newIdsSet = new Set(newNodes.map((n) => n.id));
        let filtered = current.filter(
          (e) => !newIdsSet.has(e.source) && !newIdsSet.has(e.target),
        );

        const successorNodeId = outgoingEdge?.target ?? null;

        if (successorNodeId) {
          filtered = filtered.filter(
            (e) =>
              !(
                e.source === selectedNodeId &&
                e.target === successorNodeId &&
                (e.sourceHandle ?? "success") === "success"
              ),
          );
        }

        const additions: AutomationCanvasEdge[] = [];

        additions.push({
          id: edgeId(selectedNodeId, newNodes[0].id, "success"),
          source: selectedNodeId,
          target: newNodes[0].id,
          sourceHandle: "success",
        });

        for (let i = 0; i < newNodes.length - 1; i++) {
          const src = newNodes[i].id;
          const tgt = newNodes[i + 1].id;
          if (!newEdges.some((e) => e.source === src && e.target === tgt)) {
            additions.push({
              id: edgeId(src, tgt, "success"),
              source: src,
              target: tgt,
              sourceHandle: "success",
            });
          }
        }

        if (successorNodeId) {
          additions.push({
            id: edgeId(
              newNodes[newNodes.length - 1].id,
              successorNodeId,
              "success",
            ),
            source: newNodes[newNodes.length - 1].id,
            target: successorNodeId,
            sourceHandle: "success",
          });
        }

        return [...filtered, ...newEdges, ...additions];
      });

      showSuccessToast(
        t("automation.editor.toast.pasted", { count: newNodes.length }) ||
          `Đã dán ${newNodes.length} node`,
      );
    } catch (_err) {
      showErrorToast("Không thể đọc từ clipboard hệ thống");
    }
  }, [selectedNodeId, nodes, edges, t, pushHistory, setNodes, setEdges]);

  // Handle single node select or toggle select
  const handleSelectNode = useCallback(
    (nodeId: string | null, isMetaKey = false) => {
      if (nodeId === null) {
        setSelectedNodeId(null);
        setSelectedNodeIds(new Set());
        return;
      }

      if (isMultiSelectMode || isMetaKey) {
        setSelectedNodeIds((prev) => {
          const next = new Set(prev);
          if (next.has(nodeId)) {
            next.delete(nodeId);
          } else {
            next.add(nodeId);
          }
          const arr = Array.from(next);
          setSelectedNodeId(arr[arr.length - 1] ?? null);
          return next;
        });
      } else {
        setSelectedNodeId(nodeId);
        setSelectedNodeIds(new Set([nodeId]));
      }
    },
    [isMultiSelectMode],
  );

  // Sync selectedNodeId -> selectedNodeIds when single select
  useEffect(() => {
    if (!isMultiSelectMode) {
      setSelectedNodeIds(
        selectedNodeId ? new Set([selectedNodeId]) : new Set(),
      );
    }
  }, [selectedNodeId, isMultiSelectMode]);

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

  const selectedNode = useMemo(() => {
    if (draftNode) return draftNode;
    return nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId, draftNode]);

  const commentingNode = useMemo(
    () => nodes.find((node) => node.id === commentingNodeId) ?? null,
    [nodes, commentingNodeId],
  );

  const handleEditNode = useCallback(
    (nodeId: string) => {
      pushHistory(nodes, edges);
      setSelectedNodeId(nodeId);
      setIsPropertiesDialogOpen(true);
      setActiveInsertSlot(null);
    },
    [nodes, edges, pushHistory],
  );

  const handleCommentNode = useCallback((nodeId: string) => {
    setCommentingNodeId(nodeId);
  }, []);

  const handleSaveComment = useCallback(
    (nodeId: string, commentText: string) => {
      if (draftNode && draftNode.id === nodeId) {
        setDraftNode((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            data: {
              ...prev.data,
              comment: commentText.trim() || undefined,
            },
          };
        });
        return;
      }
      pushHistory(nodes, edges);
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
    [draftNode, nodes, edges, pushHistory, setNodes],
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
      pushHistory(nodes, edges);
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
    [nodes, edges, pushHistory, insertExistingNodeAtSlot],
  );

  const generateDefaultLabelName = useCallback(() => {
    const rand = Math.floor(1000 + Math.random() * 9000);
    return `label name ${rand}`;
  }, []);

  const handleConfirmCreateLabel = useCallback(() => {
    if (!labelCreationSlot || !newLabelName.trim()) return;

    pushHistory(nodes, edges);
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
    nodes,
    edges,
    pushHistory,
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
      pushHistory(nodes, edges);
      const result = moveNode(nodeId, slot, nodes, edges);
      if (!result) return;
      setEdges(result.nextEdges);
    },
    [nodes, edges, pushHistory, setEdges],
  );

  const handleConfirmProperties = useCallback(() => {
    if (draftNode && pendingAddSlot) {
      pushHistory(nodes, edges);
      insertExistingNodeAtSlot(draftNode, pendingAddSlot);
      const addedId = draftNode.id;
      setJustAddedNodeId(addedId);
      setTimeout(() => {
        setJustAddedNodeId((curr) => (curr === addedId ? null : curr));
      }, 3000);
    }
    setDraftNode(null);
    setPendingAddSlot(null);
    setPendingAddNodeId(null);
  }, [
    draftNode,
    pendingAddSlot,
    nodes,
    edges,
    pushHistory,
    insertExistingNodeAtSlot,
  ]);

  const handleCancelProperties = useCallback(() => {
    setDraftNode(null);
    setPendingAddSlot(null);
    setPendingAddNodeId(null);
    setSelectedNodeId(null);
  }, []);

  const handlePaletteItemClick = useCallback(
    (item: AutomationNodeCatalogItem) => {
      let slot: CardStackSlot | null = null;
      if (activeInsertSlot) {
        slot = activeInsertSlot;
      } else if (selectedNodeId) {
        const outgoingEdge = edges.find(
          (edge) =>
            edge.source === selectedNodeId &&
            (edge.sourceHandle ?? "success") === "success",
        );
        const nextNodeId = outgoingEdge ? outgoingEdge.target : null;
        const nodeIndex = nodes.findIndex((n) => n.id === selectedNodeId);
        slot = {
          previousNodeId: selectedNodeId,
          nextNodeId,
          index: nodeIndex >= 0 ? nodeIndex + 1 : nodes.length,
        };
      } else {
        // Find the last node of the main success branch
        let currentId = "start";
        while (true) {
          const nextEdge = edges.find(
            (e) =>
              e.source === currentId &&
              (e.sourceHandle ?? "success") === "success",
          );
          if (!nextEdge) break;
          currentId = nextEdge.target;
        }
        const lastNodeIndex = nodes.findIndex((n) => n.id === currentId);
        slot = {
          previousNodeId: currentId,
          nextNodeId: null,
          index: lastNodeIndex >= 0 ? lastNodeIndex + 1 : nodes.length,
        };
      }

      if (slot) {
        const newNode = createAutomationNode(item.type, {
          x: 360,
          y: 120 + slot.index * 120,
        });

        setDraftNode(newNode);
        setPendingAddSlot(slot);
        setPendingAddNodeId(newNode.id);
        setIsPropertiesDialogOpen(true);
        setActiveInsertSlot(null);
      }
    },
    [activeInsertSlot, selectedNodeId, nodes, edges],
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

  const handleConfirmDeleteBlock = useCallback(
    (deleteAll: boolean) => {
      if (!deletingBlockId) return;
      pushHistory(nodes, edges);
      const result = deleteBlock(deletingBlockId, nodes, edges, deleteAll);
      if (!result) {
        setDeletingBlockId(null);
        return;
      }
      setNodes(result.nextNodes);
      setEdges(result.nextEdges);
      setDeletingBlockId(null);
      if (selectedNodeId && result.nodesToDelete.includes(selectedNodeId)) {
        setSelectedNodeId(null);
      }
    },
    [
      deletingBlockId,
      nodes,
      edges,
      pushHistory,
      selectedNodeId,
      setEdges,
      setNodes,
    ],
  );

  const handleToggleCollapseBlock = useCallback((nodeId: string) => {
    setCollapsedBlockIds((prev) => {
      const next = new Set(prev);
      if (next.has(nodeId)) {
        next.delete(nodeId);
      } else {
        next.add(nodeId);
      }
      return next;
    });
  }, []);

  const handleToggleErrorHandling = useCallback(
    (nodeId: string) => {
      pushHistory(nodes, edges);
      const result = toggleErrorHandling(
        nodeId,
        nodes,
        edges,
        v2Variables,
        variables,
      );
      if (!result) return;
      setNodes(result.nextNodes);
      setEdges(result.nextEdges);
      if (result.nextV2Variables) {
        setV2Variables(result.nextV2Variables);
      }
      if (result.nextVariables) {
        setVariables(result.nextVariables);
      }
    },
    [nodes, edges, pushHistory, v2Variables, variables, setNodes, setEdges],
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      pushHistory(nodes, edges);
      const node = nodes.find((n) => n.id === nodeId);
      if (
        node?.data.nodeType === "ignoreErrorsStart" ||
        node?.data.nodeType === "ifCondition"
      ) {
        setDeletingBlockId(nodeId);
        return;
      }

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
    [nodes, edges, pushHistory, selectedNodeId, setEdges, setNodes],
  );

  const handleDuplicateNode = useCallback(
    (nodeId: string) => {
      pushHistory(nodes, edges);
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
    [nodes, edges, pushHistory, insertExistingNodeAtSlot],
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
        const currentFuncs = functions.map((f) => {
          if (f.name === activeFunctionName) {
            return { ...f, nodes, edges };
          }
          return f;
        });

        const activeFunc =
          currentFuncs.find((f) => f.name === activeFunctionName) ||
          currentFuncs[0];

        const fullFlow = toDonutFlow(
          flowName.trim(),
          activeFunc.nodes,
          activeFunc.edges,
          variables,
          {
            schemaVersion: 2,
            v2Variables: v2Variables.length > 0 ? v2Variables : undefined,
            resources: v2Resources,
            functions: currentFuncs,
          },
        );
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
      functions,
      activeFunctionName,
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

        if (canvas.functions && canvas.functions.length > 0) {
          setFunctions(canvas.functions);
          const main =
            canvas.functions.find((f) => f.name === "Main") ||
            canvas.functions[0];
          if (main) {
            setNodes(main.nodes);
            setEdges(main.edges);
            setActiveFunctionName(main.name);
          }
        } else {
          setFunctions([
            { name: "Main", nodes: canvas.nodes, edges: canvas.edges },
          ]);
          setNodes(canvas.nodes);
          setEdges(canvas.edges);
          setActiveFunctionName("Main");
        }
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
    if (draftNode) {
      setDraftNode((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          data: {
            ...prev.data,
            params: { ...prev.data.params, [key]: value },
          },
        };
      });
      return;
    }
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
    if (draftNode) {
      setDraftNode((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          data: { ...prev.data, continueOnError: value },
        };
      });
      return;
    }
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
    if (draftNode) {
      setDraftNode((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          data: {
            ...prev.data,
            [key]: value,
          },
        };
      });
      return;
    }
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

      const currentFuncs = functions.map((f) => {
        if (f.name === activeFunctionName) {
          return { ...f, nodes, edges };
        }
        return f;
      });
      setFunctions(currentFuncs);

      const mainFunc =
        currentFuncs.find((f) => f.name === "Main") || currentFuncs[0];

      const flow = toDonutFlow(
        activeName,
        mainFunc.nodes,
        mainFunc.edges,
        variables,
        {
          schemaVersion: 2,
          v2Variables: v2Variables.length > 0 ? v2Variables : undefined,
          resources: v2Resources,
          functions: currentFuncs,
        },
      );
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

  return {
    nodes,
    setNodes,
    edges,
    setEdges,
    isVariablesPanelOpen,
    setIsVariablesPanelOpen,
    isPropertiesDialogOpen,
    setIsPropertiesDialogOpen,
    isLogPanelOpen,
    setIsLogPanelOpen,
    isCanvasLocked,
    setIsCanvasLocked,
    isFlowRunning,
    setIsFlowRunning,
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
    connectionSourceSlot,
    selectedNode,
    commentingNode,
    handleEditNode,
    handleCommentNode,
    handleSaveComment,
    insertExistingNodeAtSlot,
    handleInsertNode,
    generateDefaultLabelName,
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
    // Multi-function properties
    functions,
    activeFunctionName,
    switchActiveFunction,
    addFunction,
    renameFunction,
    deleteFunction,
  };
}
