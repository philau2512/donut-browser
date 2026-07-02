import type { Edge, Node, XYPosition } from "@xyflow/react";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
  isAutomationNodeType,
} from "@/lib/automation/node-catalog";
import { generateNodeId } from "@/lib/automation/node-id";
import type {
  ResourceDefinition,
  VariableDefinition,
} from "@/lib/automation/resource-schema";

export const START_NODE_ID = "__start__";

export interface DonutFlowNode {
  id: string;
  type: AutomationNodeType;
  params?: Record<string, string | number | boolean>;
  continueOnError?: boolean;
  comment?: string;
  /** Stable per-node ID for debug/search correlation. Generated at save time. */
  nodeId?: string;
  sleepAfterFrom?: number | string;
  sleepAfterTo?: number | string;
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

export interface ToDonutFlowOptions {
  schemaVersion?: 1 | 2;
  v2Variables?: VariableDefinition[];
  resources?: ResourceDefinition[];
}

export interface FromDonutFlowResult {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  variables: Record<string, string>;
  v2Variables: VariableDefinition[];
  resources: ResourceDefinition[];
  schemaVersion: 1 | 2;
}

/**
 * Schema v2 flow — structured variables and resources.
 * Engine still uses version=1 for node execution during transition;
 * schemaVersion=2 is the frontend-layer marker.
 */
export interface DonutFlowV2 {
  schemaVersion: 2;
  version: 1;
  name: string;
  variables: VariableDefinition[];
  resources: ResourceDefinition[];
  nodes: DonutFlowNode[];
  edges: DonutFlowEdge[];
}

/** Union type accepted by the editor — either v1 (legacy) or v2 (new schema). */
export type DonutFlow = DonutFlowV1 | DonutFlowV2;

/** Type guard: check if a flow is schema v2. */
export function isDonutFlowV2(flow: DonutFlow): flow is DonutFlowV2 {
  return (flow as DonutFlowV2).schemaVersion === 2;
}

export interface AutomationNodeData extends Record<string, unknown> {
  label: string;
  nodeType: AutomationNodeType | "start";
  params: Record<string, string | number | boolean>;
  continueOnError?: boolean;
  comment?: string;
  sleepAfterFrom?: number | string;
  sleepAfterTo?: number | string;
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
  options: ToDonutFlowOptions = {},
): DonutFlow {
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

  const baseFlow: DonutFlowV1 = {
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
      if (node.data.sleepAfterFrom !== undefined)
        out.sleepAfterFrom = node.data.sleepAfterFrom;
      if (node.data.sleepAfterTo !== undefined)
        out.sleepAfterTo = node.data.sleepAfterTo;
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

  const shouldWriteV2 =
    options.schemaVersion === 2 ||
    Boolean(options.resources?.length) ||
    Boolean(options.v2Variables?.length);

  if (!shouldWriteV2) return baseFlow;

  return {
    ...baseFlow,
    schemaVersion: 2,
    variables: options.v2Variables ?? recordToVariableDefinitions(variables),
    resources: options.resources ?? [],
  };
}

export function fromDonutFlow(
  flow: DonutFlow,
  layout?: FlowLayoutSidecarV1 | null,
): FromDonutFlowResult {
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
        sleepAfterFrom: node.sleepAfterFrom,
        sleepAfterTo: node.sleepAfterTo,
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

  if (isDonutFlowV2(flow)) {
    return {
      nodes,
      edges,
      variables: variableDefinitionsToRecord(flow.variables ?? []),
      v2Variables: flow.variables ?? [],
      resources: flow.resources ?? [],
      schemaVersion: 2,
    };
  }

  return {
    nodes,
    edges,
    variables: flow.variables ?? {},
    v2Variables: recordToVariableDefinitions(flow.variables ?? {}),
    resources: [],
    schemaVersion: 1,
  };
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

function recordToVariableDefinitions(
  variables: Record<string, string>,
): VariableDefinition[] {
  return Object.entries(variables).map(([name, defaultValue]) => ({
    id: `var-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`,
    name,
    scope: "flow",
    valueType: "string",
    defaultValue,
  }));
}

function variableDefinitionsToRecord(
  variables: VariableDefinition[],
): Record<string, string> {
  return Object.fromEntries(
    variables.map((variable) => [variable.name, variable.defaultValue ?? ""]),
  );
}
