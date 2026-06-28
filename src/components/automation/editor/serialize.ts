import type { Edge, Node, XYPosition } from "@xyflow/react";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
  isAutomationNodeType,
} from "@/lib/automation/node-catalog";
import { generateNodeId } from "@/lib/automation/node-id";

export const START_NODE_ID = "__start__";

export interface DonutFlowNode {
  id: string;
  type: AutomationNodeType;
  params?: Record<string, string | number | boolean>;
  continueOnError?: boolean;
  comment?: string;
  /** Stable per-node ID for debug/search correlation. Generated at save time. */
  nodeId?: string;
}

export interface DonutFlowEdge {
  from: string;
  to: string;
  sourceHandle?: string;
}

export interface DonutFlowV1 {
  version: 1;
  name: string;
  variables: Record<string, string>;
  nodes: DonutFlowNode[];
  edges: DonutFlowEdge[];
}

export interface AutomationNodeData extends Record<string, unknown> {
  label: string;
  nodeType: AutomationNodeType | "start";
  params: Record<string, string | number | boolean>;
  continueOnError?: boolean;
  comment?: string;
}

export type AutomationCanvasNode = Node<AutomationNodeData, "automation">;
export type AutomationCanvasEdge = Edge;

export interface FlowLayoutSidecarV1 {
  version: 1;
  positions: Record<string, XYPosition>;
}

export function createStartNode(): AutomationCanvasNode {
  return {
    id: START_NODE_ID,
    type: "automation",
    position: { x: 120, y: 120 },
    deletable: false,
    draggable: true,
    data: {
      label: "Start",
      nodeType: "start",
      params: {},
    },
  };
}

/** Generate a 9-digit random instance ID for nodes (unique within a single flow). */
function generateNodeInstanceId(): string {
  // 9 digits: 100000000 - 999999999 (10^9 space, negligible collision for single-flow use)
  return Math.floor(100000000 + Math.random() * 900000000).toString();
}

export function createAutomationNode(
  nodeType: AutomationNodeType,
  position: XYPosition,
): AutomationCanvasNode {
  const spec = AUTOMATION_NODE_BY_TYPE[nodeType];
  return {
    id: `${nodeType}-${generateNodeInstanceId()}`,
    type: "automation",
    position,
    data: {
      label: nodeType,
      nodeType,
      params: { ...spec.defaults },
    },
  };
}

export function toDonutFlow(
  name: string,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  variables: Record<string, string> = {},
): DonutFlowV1 {
  const realNodes = nodes.filter(
    (node) => node.id !== START_NODE_ID && node.data.nodeType !== "start",
  );
  const realNodeIds = new Set(realNodes.map((node) => node.id));
  const startTargets = new Set(
    edges
      .filter(
        (edge) => edge.source === START_NODE_ID && realNodeIds.has(edge.target),
      )
      .map((edge) => edge.target),
  );

  const sortedNodes = [...realNodes].sort((a, b) => {
    const aRoot = startTargets.has(a.id) ? 0 : 1;
    const bRoot = startTargets.has(b.id) ? 0 : 1;
    if (aRoot !== bRoot) return aRoot - bRoot;
    return 0;
  });

  return {
    version: 1,
    name,
    variables,
    nodes: sortedNodes.map((node) => {
      const nodeType = node.data.nodeType;
      if (!isAutomationNodeType(nodeType)) {
        throw new Error(`Unknown automation node type: ${String(nodeType)}`);
      }
      const out: DonutFlowNode = {
        id: node.id,
        type: nodeType,
        params: pruneEmptyParams(node.data.params),
        nodeId:
          typeof node.data.nodeId === "string" ? node.data.nodeId : undefined,
      };
      if (node.data.continueOnError === true) out.continueOnError = true;
      if (node.data.comment) out.comment = node.data.comment;
      return out;
    }),
    edges: edges
      .filter(
        (edge) =>
          edge.source !== START_NODE_ID &&
          realNodeIds.has(edge.source) &&
          realNodeIds.has(edge.target),
      )
      .map((edge) => ({
        from: edge.source,
        to: edge.target,
        sourceHandle: edge.sourceHandle ?? "success",
      })),
  };
}

export function fromDonutFlow(
  flow: DonutFlowV1,
  layout?: FlowLayoutSidecarV1 | null,
): { nodes: AutomationCanvasNode[]; edges: AutomationCanvasEdge[] } {
  const nodes: AutomationCanvasNode[] = [createStartNode()];
  const positions = layout?.positions ?? {};

  flow.nodes.forEach((node, index) => {
    if (!isAutomationNodeType(node.type)) return;

    // Auto-generate nodeId on load if missing (transparent migration for old flows)
    const nodeId = node.nodeId ?? generateNodeId();

    nodes.push({
      id: node.id,
      type: "automation",
      position: positions[node.id] ?? { x: 360, y: 120 + index * 120 },
      data: {
        label: node.type,
        nodeType: node.type,
        params: { ...(node.params ?? {}) },
        continueOnError: node.continueOnError,
        comment: node.comment,
        nodeId,
      },
    });
  });

  const incoming = new Set(flow.edges.map((edge) => edge.to));
  const firstRoot = flow.nodes.find((node) => !incoming.has(node.id));
  const edges: AutomationCanvasEdge[] = [];
  if (firstRoot) {
    edges.push({
      id: `edge-${START_NODE_ID}-${firstRoot.id}`,
      source: START_NODE_ID,
      target: firstRoot.id,
      sourceHandle: "success",
    });
  }
  for (const edge of flow.edges) {
    edges.push({
      id: `edge-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      sourceHandle: edge.sourceHandle ?? "success",
    });
  }

  return { nodes, edges };
}

export function toLayoutSidecar(
  nodes: AutomationCanvasNode[],
): FlowLayoutSidecarV1 {
  const positions: Record<string, XYPosition> = {};
  for (const node of nodes) {
    if (node.id !== START_NODE_ID) positions[node.id] = node.position;
  }
  return { version: 1, positions };
}

export function layoutPathForFlow(flowPath: string): string {
  return flowPath.replace(/\.donutflow$/i, ".layout.json");
}

function pruneEmptyParams(
  params: Record<string, string | number | boolean>,
): Record<string, string | number | boolean> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== "" && value != null),
  );
}
