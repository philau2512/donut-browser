"use client";

import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { useEdgesState, useNodesState } from "@xyflow/react";
import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { LuSave } from "react-icons/lu";
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
  layoutPathForFlow,
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [commentingNodeId, setCommentingNodeId] = useState<string | null>(null);
  const [flowName, setFlowName] = useState("Untitled flow");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(Boolean(flowPath));
  const [isSaving, setIsSaving] = useState(false);
  const [draggedNodeType, setDraggedNodeType] = useState<string | null>(null);

  const _selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

  const editingNode = useMemo(
    () => nodes.find((node) => node.id === editingNodeId) ?? null,
    [nodes, editingNodeId],
  );

  const commentingNode = useMemo(
    () => nodes.find((node) => node.id === commentingNodeId) ?? null,
    [nodes, commentingNodeId],
  );

  const handleEditNode = useCallback((nodeId: string) => {
    setEditingNodeId(nodeId);
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
      if (editingNodeId === nodeId) {
        setEditingNodeId(null);
      }
      if (commentingNodeId === nodeId) {
        setCommentingNodeId(null);
      }
    },
    [selectedNodeId, editingNodeId, commentingNodeId, setEdges, setNodes],
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
          layout = JSON.parse(
            await readTextFile(layoutPathForFlow(flowPath)),
          ) as FlowLayoutSidecarV1;
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

  const handleDragEnd = useCallback(() => {
    setDraggedNodeType(null);
  }, []);

  const updateSelectedParam = (
    key: string,
    value: string | number | boolean,
  ) => {
    if (!editingNode) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === editingNode.id
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
    if (!editingNode) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === editingNode.id
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

      await writeTextFile(
        layoutPathForFlow(savedPath),
        JSON.stringify(toLayoutSidecar(nodes), null, 2),
      );
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
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
        <Button
          type="button"
          disabled={isSaving || isLoading}
          onClick={() => void handleSave()}
        >
          <LuSave className="mr-2 size-4" />
          {isSaving ? t("automation.editor.saving") : t("common.buttons.save")}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <NodePalette onDragStart={handleDragStart} onDragEnd={handleDragEnd} />
        <FlowCanvas
          nodes={nodesWithCallbacks}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={setSelectedNodeId}
          draggedNodeType={draggedNodeType}
        />
        <VariablesPanel variables={variables} onChange={setVariables} />
      </div>

      <NodePropertiesDialog
        node={editingNode}
        variables={variables}
        onOpenChange={(open) => {
          if (!open) setEditingNodeId(null);
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
