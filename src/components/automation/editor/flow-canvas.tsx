"use client";

import {
  addEdge,
  Background,
  type Connection,
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
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import {
  LuCopy,
  LuMessageSquare,
  LuPlay,
  LuTrash2,
} from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { isAutomationNodeType } from "@/lib/automation/node-catalog";
import { FlowControlsOverlay } from "./flow-controls-overlay";
import { AutomationNode } from "./nodes/automation-node";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  createAutomationNode,
  START_NODE_ID,
} from "./serialize";

interface NodeContextMenuState {
  nodeId: string;
  x: number;
  y: number;
}

const nodeTypes = { automation: AutomationNode };

interface FlowCanvasProps {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  onNodesChange: (changes: NodeChange<AutomationCanvasNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<AutomationCanvasEdge>[]) => void;
  setNodes: Dispatch<SetStateAction<AutomationCanvasNode[]>>;
  setEdges: Dispatch<SetStateAction<AutomationCanvasEdge[]>>;
  onSelectNode: (nodeId: string | null) => void;
  selectedNodeId?: string | null;
  focusNodeTrigger?: { nodeId: string } | null;
  /** Node type being dragged from the palette — bypasses DataTransfer which
   * is blocked by WebView2 security policy on Windows. */
  draggedNodeType: string | null;
  isLocked: boolean;
  onToggleLock: () => void;
  // Context menu action callbacks — wired from FlowEditorPage
  onEditNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onCommentNode?: (nodeId: string) => void;
  onDuplicateNode?: (nodeId: string) => void;
  onStartFromHereNode?: (nodeId: string) => void;
}

function FlowCanvasInner({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  onSelectNode,
  selectedNodeId = null,
  focusNodeTrigger = null,
  draggedNodeType,
  isLocked,
  onToggleLock,
  onEditNode,
  onDeleteNode,
  onCommentNode,
  onDuplicateNode,
  onStartFromHereNode,
}: FlowCanvasProps) {
  const { t } = useTranslation();
  const [instance, setInstance] = useState<ReactFlowInstance<
    AutomationCanvasNode,
    AutomationCanvasEdge
  > | null>(null);
  const [draggingHandleId, setDraggingHandleId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<NodeContextMenuState | null>(null);
  const contextMenuTriggerRef = useRef<HTMLDivElement>(null);

  // Focus and center on the selected node only when focusNodeTrigger is fired
  useEffect(() => {
    if (!instance || !focusNodeTrigger) return;
    const { nodeId } = focusNodeTrigger;
    const node = nodes.find((n) => n.id === nodeId);
    if (node) {
      void instance.fitView({
        nodes: [{ id: nodeId }],
        duration: 800,
        minZoom: 1,
        maxZoom: 1.2,
      });
    }
  }, [focusNodeTrigger, instance, nodes]);

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

  const onNodeContextMenu = useCallback(
    (event: React.MouseEvent, node: AutomationCanvasNode) => {
      event.preventDefault();
      // Don't show context menu for start node — it has no meaningful actions
      if (node.id === START_NODE_ID) return;
      setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
      onSelectNode(node.id);
    },
    [onSelectNode],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  const onEdgeDoubleClick = useCallback(
    (_: any, edge: AutomationCanvasEdge) => {
      setEdges((current) => current.filter((e) => e.id !== edge.id));
    },
    [setEdges],
  );

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      if (!instance) {
        console.warn("FlowCanvas onDrop: ReactFlow instance is not ready");
        return;
      }
      // Try DataTransfer first (works on macOS/Linux), fall back to React state
      // only if empty (needed for WebView2 on Windows which blocks DataTransfer).
      const rawType =
        event.dataTransfer.getData("application/donut-node-type") ||
        event.dataTransfer.getData("text/plain");
      const type = isAutomationNodeType(rawType) ? rawType : draggedNodeType;

      console.log("FlowCanvas onDrop details:", {
        rawType,
        draggedNodeType,
        resolvedType: type,
        isAutomationNode: isAutomationNodeType(type),
        clientX: event.clientX,
        clientY: event.clientY,
      });

      if (!isAutomationNodeType(type)) {
        console.warn(
          "FlowCanvas onDrop: Resolved type is not a valid automation node type:",
          type,
        );
        return;
      }
      const position = instance.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      console.log("FlowCanvas onDrop: calculated position", position);

      const newNode = createAutomationNode(type, position);
      console.log("FlowCanvas onDrop: adding new node", newNode);

      setNodes((current) => {
        const next = [...current, newNode];
        console.log(
          "FlowCanvas onDrop: setNodes updating nodes array to:",
          next,
        );
        return next;
      });
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
    // biome-ignore lint/a11y/noStaticElementInteractions: dragOver preventDefault required on wrapper to show drop cursor
    <div
      className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background"
      onDragOver={onDragOver}
      onDrop={onDrop}
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
        onNodeClick={(_, node) => {
          const isAlreadySelected = selectedNodeId === node.id;
          onSelectNode(node.id);
          if (isAlreadySelected && node.id !== START_NODE_ID) {
            (node.data as any).onEdit?.(node.id);
          }
        }}
        onNodeContextMenu={onNodeContextMenu}
        onPaneClick={() => {
          onSelectNode(null);
          closeContextMenu();
        }}
        isValidConnection={isValidConnection}
        connectionLineStyle={{
          stroke: draggingHandleId === "fail" ? "#ef4444" : "#22c55e",
          strokeWidth: 2.5,
        }}
        nodesDraggable={!isLocked}
        nodesConnectable={!isLocked}
        elementsSelectable={true}
        panOnDrag={!isLocked}
        fitView
      >
        <Background />
        <FlowControlsOverlay isLocked={isLocked} onToggleLock={onToggleLock} />
      </ReactFlow>

      {/* Invisible anchor for DropdownMenu — positioned at right-click coordinates */}
      {contextMenu && (
        <DropdownMenu
          open
          onOpenChange={(open: boolean) => { if (!open) closeContextMenu(); }}
        >
          <div
            ref={contextMenuTriggerRef}
            className="fixed pointer-events-none"
            style={{ left: contextMenu.x, top: contextMenu.y, width: 1, height: 1 }}
          />
          <DropdownMenuContent
            className="w-44"
            style={{ position: "fixed", left: contextMenu.x, top: contextMenu.y }}
            onCloseAutoFocus={(e: Event) => e.preventDefault()}
          >
            {onStartFromHereNode && (
              <DropdownMenuItem
                onSelect={() => {
                  closeContextMenu();
                  onStartFromHereNode(contextMenu.nodeId);
                }}
              >
                <LuPlay className="mr-2 size-3.5 fill-success text-success" />
                {t("automation.editor.toolbar.startFromHere")}
              </DropdownMenuItem>
            )}
            {onEditNode && (
              <DropdownMenuItem
                onSelect={() => {
                  closeContextMenu();
                  onEditNode(contextMenu.nodeId);
                }}
              >
                <LuCopy className="mr-2 size-3.5" />
                {t("automation.editor.toolbar.edit")}
              </DropdownMenuItem>
            )}
            {onCommentNode && (
              <DropdownMenuItem
                onSelect={() => {
                  closeContextMenu();
                  onCommentNode(contextMenu.nodeId);
                }}
              >
                <LuMessageSquare className="mr-2 size-3.5" />
                {t("automation.editor.comment.title")}
              </DropdownMenuItem>
            )}
            {onDuplicateNode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => {
                    closeContextMenu();
                    onDuplicateNode(contextMenu.nodeId);
                  }}
                >
                  <LuCopy className="mr-2 size-3.5" />
                  {t("automation.editor.toolbar.duplicate") || "Duplicate"}
                </DropdownMenuItem>
              </>
            )}
            {onDeleteNode && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => {
                    closeContextMenu();
                    onDeleteNode(contextMenu.nodeId);
                  }}
                >
                  <LuTrash2 className="mr-2 size-3.5" />
                  {t("automation.editor.toolbar.delete")}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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
