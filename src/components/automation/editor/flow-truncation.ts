import type { DonutFlowV1 } from "./serialize";

/**
 * Truncate a flow to only include nodes reachable from `startNodeId`
 * following the edge graph. The startNodeId becomes the new root.
 */
export function truncateFlowFromNode(
  flow: DonutFlowV1,
  startNodeId: string,
): DonutFlowV1 {
  // 1. Build adjacency: from → [to]
  const adj = new Map<string, string[]>();
  for (const edge of flow.edges) {
    const targets = adj.get(edge.from) ?? [];
    targets.push(edge.to);
    adj.set(edge.from, targets);
  }

  // 2. BFS from startNodeId
  const reachable = new Set<string>();
  const queue = [startNodeId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (!id || reachable.has(id)) continue;
    reachable.add(id);
    for (const next of adj.get(id) ?? []) {
      if (!reachable.has(next)) queue.push(next);
    }
  }

  // 3. Filter nodes + edges
  const nodeIdSet = new Set(flow.nodes.map((n) => n.id));
  // Only keep nodes that exist in original flow AND are reachable
  const filteredNodes = flow.nodes.filter(
    (n) => reachable.has(n.id) && nodeIdSet.has(n.id),
  );
  const filteredEdges = flow.edges.filter(
    (e) => reachable.has(e.from) && reachable.has(e.to),
  );

  return {
    ...flow,
    nodes: filteredNodes,
    edges: filteredEdges,
  };
}
