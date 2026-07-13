import type { VariableDefinition } from "@/lib/automation/resource-schema";
import type { CardStackSlot } from "./automation-editor-workspace";
import {
  buildCardStackModel,
  edgeId,
} from "./card-stack/flow-card-stack-adapter";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  createAutomationNode,
} from "./serialize";

/**
 * Calculates block context (start, end, and all children inside a block).
 */
export function getBlockContext(
  startNodeId: string,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
) {
  const startNode = nodes.find((n) => n.id === startNodeId);
  if (!startNode) return null;
  const startType = startNode.data.nodeType;
  const endType =
    startType === "ignoreErrorsStart" ? "ignoreErrorsEnd" : "endIf";

  const model = buildCardStackModel(nodes, edges);
  const orderedIds = model.items.map((item) => item.node.id);
  const startIndex = orderedIds.indexOf(startNodeId);
  if (startIndex === -1) return null;

  const childIds: string[] = [];
  let endNodeId: string | null = null;
  let depth = 1;

  for (let i = startIndex + 1; i < orderedIds.length; i++) {
    const id = orderedIds[i];
    const node = nodes.find((n) => n.id === id);
    if (!node) continue;

    if (node.data.nodeType === startType) {
      depth++;
    } else if (node.data.nodeType === endType) {
      depth--;
      if (depth === 0) {
        endNodeId = id;
        break;
      }
    }
    childIds.push(id);
  }

  return { startNodeId, endNodeId, childIds };
}

/**
 * Handles deleting a block (try-catch or if block) and reconnecting appropriate edges.
 */
export function deleteBlock(
  deletingBlockId: string,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  deleteAll: boolean,
) {
  const ctx = getBlockContext(deletingBlockId, nodes, edges);
  if (!ctx) return null;

  const { startNodeId, endNodeId, childIds } = ctx;
  const nodesToDelete = [startNodeId];
  if (endNodeId) nodesToDelete.push(endNodeId);
  if (deleteAll) {
    nodesToDelete.push(...childIds);
  }

  const nextNodes = nodes.filter((n) => !nodesToDelete.includes(n.id));

  const incoming = edges.find(
    (e) =>
      e.target === startNodeId && (e.sourceHandle ?? "success") === "success",
  );

  const filteredEdges = edges.filter(
    (e) =>
      !nodesToDelete.includes(e.source) && !nodesToDelete.includes(e.target),
  );
  const additions: AutomationCanvasEdge[] = [];

  if (deleteAll) {
    const outgoing = endNodeId
      ? edges.find(
          (e) =>
            e.source === endNodeId &&
            (e.sourceHandle ?? "success") === "success",
        )
      : null;
    if (incoming && outgoing) {
      additions.push({
        id: edgeId(incoming.source, outgoing.target, "success"),
        source: incoming.source,
        target: outgoing.target,
        sourceHandle: "success",
      });
    }
  } else {
    const firstChildId = childIds[0];
    const lastChildId = childIds[childIds.length - 1];

    if (incoming && firstChildId) {
      additions.push({
        id: edgeId(incoming.source, firstChildId, "success"),
        source: incoming.source,
        target: firstChildId,
        sourceHandle: "success",
      });
    }

    const outgoing = endNodeId
      ? edges.find(
          (e) =>
            e.source === endNodeId &&
            (e.sourceHandle ?? "success") === "success",
        )
      : null;
    if (outgoing && lastChildId) {
      additions.push({
        id: edgeId(lastChildId, outgoing.target, "success"),
        source: lastChildId,
        target: outgoing.target,
        sourceHandle: "success",
      });
    }
  }

  return {
    nextNodes,
    nextEdges: [...filteredEdges, ...additions],
    nodesToDelete,
  };
}

/**
 * Handles toggling Try-Catch logic (wrapping/unwrapping nodes).
 */
export function toggleErrorHandling(
  nodeId: string,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  v2Variables: VariableDefinition[],
  variables: Record<string, string>,
) {
  const incoming = edges.find(
    (e) => e.target === nodeId && (e.sourceHandle ?? "success") === "success",
  );
  const outgoing = edges.find(
    (e) => e.source === nodeId && (e.sourceHandle ?? "success") === "success",
  );

  const prevNode = incoming
    ? nodes.find((n) => n.id === incoming.source)
    : null;
  const nextNode = outgoing
    ? nodes.find((n) => n.id === outgoing.target)
    : null;

  if (
    prevNode?.data.nodeType === "ignoreErrorsStart" &&
    nextNode?.data.nodeType === "ignoreErrorsEnd"
  ) {
    // Unwrap logic
    const ctx = getBlockContext(prevNode.id, nodes, edges);
    if (!ctx?.endNodeId) return null;

    const afterEndEdge = edges.find(
      (e) =>
        e.source === nextNode.id && (e.sourceHandle ?? "success") === "success",
    );
    const afterEndNode = afterEndEdge
      ? nodes.find((n) => n.id === afterEndEdge.target)
      : null;

    const nodesToDelete = [prevNode.id, nextNode.id];

    if (afterEndNode?.data.nodeType === "ifCondition") {
      const ifCtx = getBlockContext(afterEndNode.id, nodes, edges);
      if (ifCtx) {
        nodesToDelete.push(afterEndNode.id);
        if (ifCtx.endNodeId) nodesToDelete.push(ifCtx.endNodeId);
        nodesToDelete.push(...ifCtx.childIds);
      }
    }

    const nextNodes = nodes.filter((n) => !nodesToDelete.includes(n.id));

    const beforeStartEdge = edges.find(
      (e) =>
        e.target === prevNode.id && (e.sourceHandle ?? "success") === "success",
    );
    const lastSequenceNodeId = nodesToDelete[nodesToDelete.length - 1];
    const afterSequenceEdge = edges.find(
      (e) =>
        e.source === lastSequenceNodeId &&
        (e.sourceHandle ?? "success") === "success",
    );

    const filteredEdges = edges.filter(
      (e) =>
        !nodesToDelete.includes(e.source) && !nodesToDelete.includes(e.target),
    );
    const additions: AutomationCanvasEdge[] = [];

    if (beforeStartEdge) {
      additions.push({
        id: edgeId(beforeStartEdge.source, nodeId, "success"),
        source: beforeStartEdge.source,
        target: nodeId,
        sourceHandle: "success",
      });
    }

    if (afterSequenceEdge) {
      additions.push({
        id: edgeId(nodeId, afterSequenceEdge.target, "success"),
        source: nodeId,
        target: afterSequenceEdge.target,
        sourceHandle: "success",
      });
    }

    return {
      nextNodes,
      nextEdges: [...filteredEdges, ...additions],
    };
  } else {
    // Wrap logic
    const targetNodeObj = nodes.find((n) => n.id === nodeId);
    const p = targetNodeObj?.position || { x: 360, y: 360 };

    const startNode = createAutomationNode("ignoreErrorsStart", {
      x: p.x,
      y: p.y - 120,
    });
    startNode.data.params = { ...startNode.data.params, color: "yellow" };

    const endNode = createAutomationNode("ignoreErrorsEnd", {
      x: p.x,
      y: p.y + 120,
    });

    const ifNode = createAutomationNode("ifCondition", {
      x: p.x,
      y: p.y + 240,
    });
    ifNode.data.params = {
      ...ifNode.data.params,
      leftValue: "[[WAS_ERROR]]",
      operator: "===",
      rightValue: "true",
      color: "red",
    };

    const logNode = createAutomationNode("log", {
      x: p.x,
      y: p.y + 360,
    });
    logNode.data.params = {
      ...logNode.data.params,
      message: "Error occurred: [[LAST_ERROR]]",
      level: "error",
      color: "red",
    };

    const endIfNode = createAutomationNode("endIf", {
      x: p.x,
      y: p.y + 480,
    });

    const nextNodes = [
      ...nodes,
      startNode,
      endNode,
      ifNode,
      logNode,
      endIfNode,
    ];

    const filteredEdges = edges.filter(
      (e) =>
        !(e.target === nodeId && (e.sourceHandle ?? "success") === "success") &&
        !(e.source === nodeId && (e.sourceHandle ?? "success") === "success"),
    );

    const additions: AutomationCanvasEdge[] = [];

    if (incoming) {
      additions.push({
        id: edgeId(incoming.source, startNode.id, "success"),
        source: incoming.source,
        target: startNode.id,
        sourceHandle: "success",
      });
    }

    additions.push({
      id: edgeId(startNode.id, nodeId, "success"),
      source: startNode.id,
      target: nodeId,
      sourceHandle: "success",
    });

    additions.push({
      id: edgeId(nodeId, endNode.id, "success"),
      source: nodeId,
      target: endNode.id,
      sourceHandle: "success",
    });

    additions.push({
      id: edgeId(endNode.id, ifNode.id, "success"),
      source: endNode.id,
      target: ifNode.id,
      sourceHandle: "success",
    });

    additions.push({
      id: edgeId(ifNode.id, logNode.id, "success"),
      source: ifNode.id,
      target: logNode.id,
      sourceHandle: "success",
    });

    additions.push({
      id: edgeId(logNode.id, endIfNode.id, "success"),
      source: logNode.id,
      target: endIfNode.id,
      sourceHandle: "success",
    });

    if (outgoing) {
      additions.push({
        id: edgeId(endIfNode.id, outgoing.target, "success"),
        source: endIfNode.id,
        target: outgoing.target,
        sourceHandle: "success",
      });
    }

    // Auto-declare WAS_ERROR and LAST_ERROR in flow variables
    const nextV2Variables = [...v2Variables];
    const hasWasError = nextV2Variables.some((v) => v.name === "WAS_ERROR");
    const hasLastError = nextV2Variables.some((v) => v.name === "LAST_ERROR");
    if (!hasWasError) {
      nextV2Variables.push({
        id: "var-was-error",
        name: "WAS_ERROR",
        scope: "flow",
        valueType: "boolean",
        defaultValue: "false",
        description: "True if any error occurred in Try-Catch block",
      });
    }
    if (!hasLastError) {
      nextV2Variables.push({
        id: "var-last-error",
        name: "LAST_ERROR",
        scope: "flow",
        valueType: "string",
        defaultValue: "",
        description: "Holds the message of the last occurred error",
      });
    }

    const nextVariables = { ...variables };
    if (!("WAS_ERROR" in nextVariables)) {
      nextVariables.WAS_ERROR = "false";
    }
    if (!("LAST_ERROR" in nextVariables)) {
      nextVariables.LAST_ERROR = "";
    }

    return {
      nextNodes,
      nextEdges: [...filteredEdges, ...additions],
      nextV2Variables,
      nextVariables,
    };
  }
}

/**
 * Handles reordering nodes by slot position and updating edges.
 */
export function moveNode(
  nodeId: string,
  slot: CardStackSlot,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
) {
  const model = buildCardStackModel(nodes, edges);
  const orderedIds = model.items.map((item) => item.node.id);

  const oldIndex = orderedIds.indexOf(nodeId);
  if (oldIndex === -1) return null;

  const targetIndex = slot.index;
  if (oldIndex === targetIndex || oldIndex === targetIndex - 1) return null;

  const reorderedIds = [...orderedIds];
  reorderedIds.splice(oldIndex, 1);

  let newIndex = targetIndex;
  if (oldIndex < targetIndex) {
    newIndex = targetIndex - 1;
  }
  reorderedIds.splice(newIndex, 0, nodeId);

  const nonSuccessEdges = edges.filter(
    (edge) => (edge.sourceHandle ?? "success") !== "success",
  );

  const successEdges: AutomationCanvasEdge[] = [];
  for (let i = 0; i < reorderedIds.length - 1; i++) {
    const sourceId = reorderedIds[i];
    const targetId = reorderedIds[i + 1];
    successEdges.push({
      id: edgeId(sourceId, targetId, "success"),
      source: sourceId,
      target: targetId,
      sourceHandle: "success",
    });
  }

  return {
    nextEdges: [...nonSuccessEdges, ...successEdges],
  };
}

/**
 * Throws a node into the canvas slot and re-binds edges.
 */
export function insertNodeAtSlot(
  newNode: AutomationCanvasNode,
  slot: CardStackSlot,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  sourceHandle = "success",
) {
  if (nodes.some((node) => node.id === newNode.id)) {
    return { nextNodes: nodes, nextEdges: edges };
  }

  const nextNodes = [...nodes, newNode];

  const filteredEdges = edges.filter((edge) => {
    if (edge.source === newNode.id || edge.target === newNode.id) return false;
    if (!slot.previousNodeId) return true;
    return !(
      edge.source === slot.previousNodeId &&
      (edge.sourceHandle ?? "success") === sourceHandle
    );
  });

  const additions: AutomationCanvasEdge[] = [];
  if (slot.previousNodeId) {
    additions.push({
      id: edgeId(slot.previousNodeId, newNode.id, sourceHandle),
      source: slot.previousNodeId,
      target: newNode.id,
      sourceHandle,
    });
  }
  if (slot.nextNodeId && sourceHandle === "success") {
    additions.push({
      id: edgeId(newNode.id, slot.nextNodeId, "success"),
      source: newNode.id,
      target: slot.nextNodeId,
      sourceHandle: "success",
    });
  }

  return {
    nextNodes,
    nextEdges: [...filteredEdges, ...additions],
  };
}
