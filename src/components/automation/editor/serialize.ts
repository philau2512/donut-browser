import type { Edge, Node, XYPosition } from "@xyflow/react";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
  isAutomationNodeType,
} from "@/lib/automation/node-catalog";

export const START_NODE_ID = "__start__";

export interface DonutFlowNode {
  id: string;
  type: AutomationNodeType;
  params?: Record<string, string | number | boolean>;
  continueOnError?: boolean;
}

export interface DonutFlowEdge {
  from: string;
  to: string;
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
    draggable: false,
    data: {
      label: "Start",
      nodeType: "start",
      params: {},
    },
  };
}

export function createAutomationNode(
  nodeType: AutomationNodeType,
  position: XYPosition,
): AutomationCanvasNode {
  const spec = AUTOMATION_NODE_BY_TYPE[nodeType];
  return {
    id: `${nodeType}-${crypto.randomUUID()}`,
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
      };
      if (node.data.continueOnError === true) out.continueOnError = true;
      return out;
    }),
    edges: edges
      .filter(
        (edge) =>
          edge.source !== START_NODE_ID &&
          realNodeIds.has(edge.source) &&
          realNodeIds.has(edge.target),
      )
      .map((edge) => ({ from: edge.source, to: edge.target })),
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
    nodes.push({
      id: node.id,
      type: "automation",
      position: positions[node.id] ?? { x: 360, y: 120 + index * 120 },
      data: {
        label: node.type,
        nodeType: node.type,
        params: { ...(node.params ?? {}) },
        continueOnError: node.continueOnError,
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
    });
  }
  for (const edge of flow.edges) {
    edges.push({
      id: `edge-${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
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
