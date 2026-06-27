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
import { isAutomationNodeType } from "@/lib/automation/node-catalog";
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
  /** Node type being dragged from the palette — bypasses DataTransfer which
   * is blocked by WebView2 security policy on Windows. */
  draggedNodeType: string | null;
}

function FlowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  draggedNodeType,
}: FlowCanvasProps) {
  const { t } = useTranslation();
  const [instance, setInstance] = useState<ReactFlowInstance<
    AutomationCanvasNode,
    AutomationCanvasEdge
  > | null>(null);
  const [draggingHandleId, setDraggingHandleId] = useState<string | null>(null);

  const outgoingSourceHandles = useMemo(
    () => new Set(edges.map((edge) => `${edge.source}-${edge.sourceHandle}`)),
    [edges],
  );

  const isValidConnection: IsValidConnection<AutomationCanvasEdge> =
    useCallback(
      (connection) => {
        if (!connection.source || !connection.target) return false;
        if (connection.source === connection.target) return false;

        const sourceKey = `${connection.source}-${connection.sourceHandle}`;

        const replacingSameEdge = edges.some(
          (edge) =>
            edge.source === connection.source &&
            edge.sourceHandle === connection.sourceHandle &&
            edge.target === connection.target &&
            edge.targetHandle === connection.targetHandle,
        );
        return replacingSameEdge || !outgoingSourceHandles.has(sourceKey);
      },
      [edges, outgoingSourceHandles],
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

  const onConnectStart = useCallback(
    (_: any, { handleId }: { handleId: string | null }) => {
      setDraggingHandleId(handleId);
    },
    [],
  );

  const onConnectEnd = useCallback(() => {
    setDraggingHandleId(null);
  }, []);

  const onEdgeDoubleClick = useCallback(
    (_: any, edge: AutomationCanvasEdge) => {
      setEdges((current) => current.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (!instance) return;
      // Prefer the React-state copy (set by the parent on dragstart) because
      // WebView2 on Windows blocks DataTransfer.getData() in drop handlers.
      const type =
        draggedNodeType ||
        event.dataTransfer.getData("application/donut-node-type") ||
        event.dataTransfer.getData("text/plain");
      if (!isAutomationNodeType(type)) return;
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      setNodes((current) => [...current, createAutomationNode(type, position)]);
    },
    [instance, draggedNodeType, setNodes],
  );

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  }, []);

  const styledEdges = useMemo(() => {
    return edges.map((edge) => {
      const isFail = edge.sourceHandle === "fail";
      return {
        ...edge,
        style: {
          ...edge.style,
          stroke: edge.selected ? "#eab308" : isFail ? "#ef4444" : "#22c55e",
          strokeWidth: edge.selected ? 4 : 2.5,
          opacity: edge.selected ? 1 : 0.8,
        },
      };
    });
  }, [edges]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: dragOver preventDefault required on wrapper to show drop cursor in WebView2
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background"
      onDragOver={onDragOver}
    >
      <ReactFlow
        nodes={nodes}
        edges={styledEdges}
        nodeTypes={nodeTypes}
        onInit={setInstance}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onEdgeDoubleClick={onEdgeDoubleClick}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        isValidConnection={isValidConnection}
        connectionLineStyle={{
          stroke: draggingHandleId === "fail" ? "#ef4444" : "#22c55e",
          strokeWidth: 2.5,
        }}
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
