"use client";

import {
  addEdge,
  Background,
  type Connection,
  Controls,
  type EdgeChange,
  type IsValidConnection,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  ReactFlowProvider,
} from "@xyflow/react";
import {
  type Dispatch,
  type DragEvent,
  type SetStateAction,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import type { AutomationNodeCatalogItem } from "@/lib/automation/node-catalog";
import { AutomationNode } from "./nodes/automation-node";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  createAutomationNode,
} from "./serialize";

const nodeTypes = { automation: AutomationNode };

interface FlowCanvasProps {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  onNodesChange: (changes: NodeChange<AutomationCanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<AutomationCanvasEdge>[]) => void;
  setNodes: Dispatch<SetStateAction<AutomationCanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<AutomationCanvasEdge[]>>;
  onSelectNode: (nodeId: string | null) => void;
}

function FlowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
}: FlowCanvasProps) {
  const { t } = useTranslation();
  const [instance, setInstance] = useState<ReactFlowInstance<
    AutomationCanvasNode,
    AutomationCanvasEdge
  > | null>(null);

  const outgoingSources = useMemo(
    () => new Set(edges.map((edge) => edge.source)),
    [edges],
  );

  const isValidConnection: IsValidConnection<AutomationCanvasEdge> =
    useCallback(
      (connection) => {
        if (!connection.source || !connection.target) return false;
        if (connection.source === connection.target) return false;
        const replacingSameEdge = edges.some(
          (edge) =>
            edge.source === connection.source &&
            edge.target === connection.target,
        );
        return replacingSameEdge || !outgoingSources.has(connection.source);
      },
      [edges, outgoingSources],
    );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) return;
      setEdges((current) =>
        addEdge(
          {
            ...connection,
            id: `edge-${connection.source}-${connection.target}`,
          },
          current,
        ),
      );
    },
    [isValidConnection, setEdges],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (!instance) return;
      const type = event.dataTransfer.getData("application/donut-node-type");
      if (!type) return;
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setNodes((current) => [
        ...current,
        createAutomationNode(
          type as AutomationNodeCatalogItem["type"],
          position,
        ),
      ]);
    },
    [instance, setNodes],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={setInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        isValidConnection={isValidConnection}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-md border border-border bg-card/90 px-2 py-1 text-[11px] text-muted-foreground">
        {t("automation.editor.linearHint")}
      </div>
    </div>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
