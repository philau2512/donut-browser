import { useRef } from "react";
import type { AutomationNodeType } from "@/lib/automation/node-catalog";
import type { AutomationCanvasEdge, AutomationCanvasNode } from "../serialize";
import {
  buildCardStackModel,
  type CardStackSlot,
} from "./flow-card-stack-adapter";
import { ScriptActionCard } from "./script-action-card";
import { ScriptConnectionWires } from "./script-connection-wires";
import { ScriptConnectorSlot } from "./script-connector-slot";

interface ScriptCardStackProps {
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  selectedNodeId: string | null;
  draggedNodeType: string | null;
  debugNodeStatuses: Record<string, "idle" | "running" | "success" | "error">;
  disabled?: boolean;
  collapsedBlockIds?: Set<string>;
  onToggleCollapseBlock?: (nodeId: string) => void;
  onToggleErrorHandling?: (nodeId: string) => void;
  onSelectNode: (nodeId: string | null) => void;
  onInsertNode: (type: AutomationNodeType, slot: CardStackSlot) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onEditNode: (nodeId: string) => void;
  onCommentNode: (nodeId: string) => void;
  onStartFromHereNode: (nodeId: string) => void;
  onCreateLabel: (slot: CardStackSlot) => void;
  onMoveToLabel: (
    sourceNodeId: string,
    labelId: string,
    sourceHandle: string,
  ) => void;
  activeInsertSlot: CardStackSlot | null;
  onSelectSlot: (slot: CardStackSlot) => void;
  onMoveNode?: (nodeId: string, slot: CardStackSlot) => void;
  onConnectSlots?: (source: CardStackSlot, target: CardStackSlot) => void;
}

import { useState } from "react";

export function ScriptCardStack({
  nodes,
  edges,
  selectedNodeId,
  draggedNodeType,
  debugNodeStatuses,
  disabled = false,
  collapsedBlockIds,
  onToggleCollapseBlock,
  onToggleErrorHandling,
  onSelectNode,
  onInsertNode,
  onDeleteNode,
  onDuplicateNode,
  onEditNode,
  onCommentNode,
  onStartFromHereNode,
  onCreateLabel,
  onMoveToLabel,
  activeInsertSlot,
  onSelectSlot,
  onMoveNode,
  onConnectSlots,
}: ScriptCardStackProps) {
  const model = buildCardStackModel(nodes, edges);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // States to track the active connection wire drag
  const [activeConnectionSource, setActiveConnectionSource] =
    useState<CardStackSlot | null>(null);
  const [dragMousePos, setDragMousePos] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const handleDragOver = (event: React.DragEvent) => {
    // If drawing a connection wire, update coordinates
    if (activeConnectionSource) {
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      const container = event.currentTarget;
      setDragMousePos({
        x: event.clientX - rect.left + container.scrollLeft,
        y: event.clientY - rect.top + container.scrollTop,
      });
    }
  };

  const handleDragEnd = () => {
    setActiveConnectionSource(null);
    setDragMousePos(null);
  };

  // Filter out items that are inside collapsed blocks
  const visibleItems: typeof model.items = [];
  let skipUntilEndType: string | null = null;
  let skipDepth = 0;

  for (let i = 0; i < model.items.length; i++) {
    const item = model.items[i];
    const nodeType = item.node.data.nodeType;

    if (skipUntilEndType) {
      if (nodeType === skipUntilEndType) {
        skipDepth--;
        if (skipDepth === 0) {
          skipUntilEndType = null;
        }
      }
      continue;
    }

    visibleItems.push(item);

    const isCollapsed = collapsedBlockIds?.has(item.node.id);
    if (isCollapsed) {
      if (nodeType === "ignoreErrorsStart") {
        skipUntilEndType = "ignoreErrorsEnd";
        skipDepth = 1;
      } else if (nodeType === "ifCondition") {
        skipUntilEndType = "endIf";
        skipDepth = 1;
      }
    }
  }

  // Pre-calculate indentation depths on the full structured sequence
  const allDepths = new Map<string, number>();
  let currentDepth = 0;
  for (let i = 0; i < model.items.length; i++) {
    const item = model.items[i];
    const nodeType = item.node.data.nodeType;

    if (nodeType === "ignoreErrorsEnd" || nodeType === "endIf") {
      currentDepth = Math.max(0, currentDepth - 1);
    }

    allDepths.set(item.node.id, currentDepth);

    if (nodeType === "ignoreErrorsStart" || nodeType === "ifCondition") {
      currentDepth++;
    }
  }

  // Reconstruct slots for only the visible items
  const slots: CardStackSlot[] = [];
  for (let index = 0; index <= visibleItems.length; index++) {
    const previous = visibleItems[index - 1]?.node ?? null;
    const next = visibleItems[index]?.node ?? null;
    slots.push({
      previousNodeId: previous?.id ?? null,
      nextNodeId: next?.id ?? null,
      index,
    });
  }

  return (
    <section
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      aria-label="Script card stack"
      className="relative min-h-0 flex-1 overflow-y-auto border-0 bg-transparent p-1 pr-2"
    >
      <div className="flex w-full flex-col items-start gap-0.5">
        {visibleItems.map((item, index) => {
          const isEndMarker =
            item.node.data.nodeType === "ignoreErrorsEnd" ||
            item.node.data.nodeType === "endIf";
          const depth = allDepths.get(item.node.id) ?? 0;

          return (
            <div
              key={item.node.id}
              className="flex w-full flex-col items-start relative z-10"
              style={{ paddingLeft: `${depth * 16}px` }}
            >
              {isEndMarker ? (
                <div className="w-52 flex flex-col gap-0.5 py-1.5 pl-4 select-none">
                  <div className="w-full h-[1px] bg-border/40" />
                  <div className="w-full h-[1px] bg-border/40" />
                </div>
              ) : (
                <ScriptActionCard
                  node={item.node}
                  selected={selectedNodeId === item.node.id}
                  labels={model.labels}
                  debugStatus={debugNodeStatuses[item.node.id] ?? "idle"}
                  disabled={disabled}
                  isCollapsed={collapsedBlockIds?.has(item.node.id)}
                  onToggleCollapse={onToggleCollapseBlock}
                  onToggleErrorHandling={onToggleErrorHandling}
                  onSelect={onSelectNode}
                  onEditNode={onEditNode}
                  onDeleteNode={onDeleteNode}
                  onDuplicateNode={onDuplicateNode}
                  onCommentNode={onCommentNode}
                  onStartFromHereNode={onStartFromHereNode}
                  onMoveToLabel={onMoveToLabel}
                />
              )}
              <ScriptConnectorSlot
                slot={slots[index + 1]}
                draggedNodeType={draggedNodeType}
                disabled={disabled}
                isActive={isSameSlot(activeInsertSlot, slots[index + 1])}
                onInsertNode={onInsertNode}
                onCreateLabel={onCreateLabel}
                onSelectSlot={onSelectSlot}
                onMoveNode={onMoveNode}
                onStartConnectionDrag={setActiveConnectionSource}
                onEndConnectionDrag={handleDragEnd}
                onConnectSlots={onConnectSlots}
              />
            </div>
          );
        })}
      </div>

      <ScriptConnectionWires
        nodes={nodes}
        containerRef={containerRef}
        activeConnectionSource={activeConnectionSource}
        dragMousePos={dragMousePos}
      />
    </section>
  );
}

function isSameSlot(a: CardStackSlot | null, b: CardStackSlot | null) {
  if (!a || !b) return false;
  return (
    a.previousNodeId === b.previousNodeId &&
    a.nextNodeId === b.nextNodeId &&
    a.index === b.index
  );
}

export type { CardStackSlot } from "./flow-card-stack-adapter";
