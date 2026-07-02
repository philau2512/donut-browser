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

  return (
    <section
      ref={containerRef}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      aria-label="Script card stack"
      className="relative min-h-0 flex-1 overflow-y-auto border-0 bg-transparent p-1 pr-2"
    >
      <div className="flex w-full flex-col items-start gap-0.5">
        {model.items.map((item, index) => (
          <div key={item.node.id} className="flex w-full flex-col items-start">
            <ScriptActionCard
              node={item.node}
              selected={selectedNodeId === item.node.id}
              labels={model.labels}
              debugStatus={debugNodeStatuses[item.node.id] ?? "idle"}
              disabled={disabled}
              onSelect={onSelectNode}
              onEditNode={onEditNode}
              onDeleteNode={onDeleteNode}
              onDuplicateNode={onDuplicateNode}
              onCommentNode={onCommentNode}
              onStartFromHereNode={onStartFromHereNode}
              onMoveToLabel={onMoveToLabel}
            />
            <ScriptConnectorSlot
              slot={model.slots[index + 1]}
              draggedNodeType={draggedNodeType}
              disabled={disabled}
              isActive={isSameSlot(activeInsertSlot, model.slots[index + 1])}
              onInsertNode={onInsertNode}
              onCreateLabel={onCreateLabel}
              onSelectSlot={onSelectSlot}
              onMoveNode={onMoveNode}
              onStartConnectionDrag={setActiveConnectionSource}
              onEndConnectionDrag={handleDragEnd}
              onConnectSlots={onConnectSlots}
            />
          </div>
        ))}
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
