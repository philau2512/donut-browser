import type {
  AutomationCanvasEdge,
  AutomationCanvasNode,
} from "@/components/automation/editor/serialize";
import { START_NODE_ID } from "@/components/automation/editor/serialize";
import {
  isReservedFlowVariable,
  RESERVED_FLOW_VARIABLES,
} from "@/lib/automation/flow-variables";

/** Vars injected when a flow run starts (orchestrator + runner). */
export const RUN_START_VARIABLES = [
  "PROFILE_ID",
  "PROFILE_NAME",
  "CDP_PORT",
] as const;

/** Vars set when an openProfile node executes successfully. */
export const OPEN_PROFILE_VARIABLES = [
  "PROXY_IP",
  "IP_COUNTRY",
  "BROWSER_PID",
] as const;

function normalizeVarName(name: string): string {
  return name.trim().toUpperCase();
}

function varsDefinedByNode(node: AutomationCanvasNode): string[] {
  const type = node.data.nodeType;
  if (type === "openProfile") {
    return [...OPEN_PROFILE_VARIABLES];
  }
  if (type === "setVariable") {
    const raw = node.data.params.name;
    if (typeof raw === "string" && raw.trim()) {
      return [normalizeVarName(raw)];
    }
  }
  return [];
}

function ancestorIds(
  nodeId: string,
  edges: AutomationCanvasEdge[],
): Set<string> {
  const incoming = new Map<string, string[]>();
  for (const edge of edges) {
    const list = incoming.get(edge.target) ?? [];
    list.push(edge.source);
    incoming.set(edge.target, list);
  }
  const seen = new Set<string>();
  const stack = [...(incoming.get(nodeId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) break;
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === START_NODE_ID) continue;
    for (const parent of incoming.get(id) ?? []) {
      stack.push(parent);
    }
  }
  return seen;
}

/**
 * Variable names available when the given node is about to run (editor approximation:
 * union of vars from all ancestor nodes on the canvas graph + run-start + custom flow vars).
 */
export function availableVariablesAtNode(
  targetNodeId: string,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  flowVariables: Record<string, string>,
): Set<string> {
  const available = new Set<string>();
  for (const key of RUN_START_VARIABLES) {
    available.add(key);
  }
  for (const key of Object.keys(flowVariables)) {
    const upper = normalizeVarName(key);
    if (!isReservedFlowVariable(upper)) {
      available.add(upper);
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const ancestorId of ancestorIds(targetNodeId, edges)) {
    const node = byId.get(ancestorId);
    if (!node || node.data.nodeType === "start") continue;
    for (const name of varsDefinedByNode(node)) {
      available.add(name);
    }
  }

  return available;
}

export function listReservedAndCustomKeys(
  flowVariables: Record<string, string>,
): string[] {
  const custom = Object.keys(flowVariables)
    .map(normalizeVarName)
    .filter((k) => !isReservedFlowVariable(k));
  return [...RESERVED_FLOW_VARIABLES, ...custom.sort()];
}
