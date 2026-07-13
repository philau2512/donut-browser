import type { AutomationNodeType } from "@/lib/automation/node-catalog";
import type { AutomationCanvasEdge, AutomationCanvasNode } from "../serialize";

export interface CardStackSlot {
  previousNodeId: string | null;
  nextNodeId: string | null;
  index: number;
}

export interface CardStackItem {
  node: AutomationCanvasNode;
  index: number;
  isReachableMainPath: boolean;
}

export interface CardStackModel {
  items: CardStackItem[];
  slots: CardStackSlot[];
  labels: Array<{ id: string; name: string }>;
}

export function buildCardStackModel(
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
): CardStackModel {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const start =
    nodes.find((node) => node.data.nodeType === "start") ?? nodes[0];
  const successTarget = new Map<string, string>();

  for (const edge of edges) {
    if ((edge.sourceHandle ?? "success") === "success") {
      successTarget.set(edge.source, edge.target);
    }
  }

  const ordered: AutomationCanvasNode[] = [];
  const seen = new Set<string>();
  let current: AutomationCanvasNode | null = start ?? null;

  while (current && !seen.has(current.id)) {
    ordered.push(current);
    seen.add(current.id);
    const nextId = successTarget.get(current.id);
    current = nextId ? (byId.get(nextId) ?? null) : null;
  }

  for (const node of nodes) {
    if (!seen.has(node.id)) {
      ordered.push(node);
      seen.add(node.id);
    }
  }

  const items = ordered.map((node, index) => ({
    node,
    index,
    isReachableMainPath:
      index === 0 ||
      hasIncomingEdge(node.id, edges) ||
      node.data.nodeType === "start",
  }));

  const slots: CardStackSlot[] = [];
  for (let index = 0; index <= ordered.length; index++) {
    const previous = ordered[index - 1] ?? null;
    const next = ordered[index] ?? null;
    slots.push({
      previousNodeId: previous?.id ?? null,
      nextNodeId: next?.id ?? null,
      index,
    });
  }

  return {
    items,
    slots,
    labels: nodes
      .filter((node) => node.data.nodeType === "label")
      .map((node) => ({
        id: node.id,
        name: String(node.data.params.labelName ?? node.id),
      })),
  };
}

export function getBranchHandles(
  nodeType: AutomationNodeType | "start",
): string[] {
  if (
    nodeType === "loopFor" ||
    nodeType === "loopElements" ||
    nodeType === "while"
  ) {
    return ["loop", "done"];
  }
  return [];
}

export function edgeId(
  source: string,
  target: string,
  sourceHandle = "success",
) {
  return `edge-${source}-${sourceHandle}-${target}`;
}

function hasIncomingEdge(nodeId: string, edges: AutomationCanvasEdge[]) {
  return edges.some((edge) => edge.target === nodeId);
}
