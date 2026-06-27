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
import type { AutomationNodeCatalogItem } from "@/lib/automation/node-catalog";
import { showErrorToast, showSuccessToast } from "@/lib/toast-utils";
import { FlowCanvas } from "./flow-canvas";
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
  const [flowName, setFlowName] = useState("Untitled flow");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(Boolean(flowPath));
  const [isSaving, setIsSaving] = useState(false);

  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) ?? null,
    [nodes, selectedNodeId],
  );

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
      event.dataTransfer.effectAllowed = "copy";
    },
    [],
  );

  const updateSelectedParam = (
    key: string,
    value: string | number | boolean,
  ) => {
    if (!selectedNode) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
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
    if (!selectedNode) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNode.id
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
        <NodePalette onDragStart={handleDragStart} />
        <FlowCanvas
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          setNodes={setNodes}
          setEdges={setEdges}
          onSelectNode={setSelectedNodeId}
        />
        <VariablesPanel variables={variables} onChange={setVariables} />
      </div>

      <NodePropertiesDialog
        node={selectedNode}
        variables={variables}
        onOpenChange={(open) => {
          if (!open) setSelectedNodeId(null);
        }}
        onParamChange={updateSelectedParam}
        onContinueOnErrorChange={updateSelectedContinueOnError}
      />
    </div>
  );
}
