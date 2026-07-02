"use client";

import { useEffect, useState } from "react";
import type { AutomationCanvasNode } from "../serialize";

interface WirePath {
  path: string;
  label: string;
  labelX: number;
  labelY: number;
  targetLabelNodeId?: string;
}

interface ScriptConnectionWiresProps {
  nodes: AutomationCanvasNode[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  activeConnectionSource?: any;
  dragMousePos?: { x: number; y: number } | null;
}

export function ScriptConnectionWires({
  nodes,
  containerRef,
  activeConnectionSource,
  dragMousePos,
}: ScriptConnectionWiresProps) {
  const [paths, setPaths] = useState<WirePath[]>([]);
  const [dragPath, setDragPath] = useState<string | null>(null);

  const handleLabelClick = (targetLabelId?: string) => {
    if (!targetLabelId) return;
    const tgtEl = document.getElementById(`node-card-${targetLabelId}`);
    if (tgtEl) {
      tgtEl.scrollIntoView({ behavior: "smooth", block: "center" });

      // Visual feedback: highlight border and scale up slightly
      tgtEl.classList.add("ring-4", "ring-success", "scale-[1.02]", "z-50");
      setTimeout(() => {
        tgtEl.classList.remove(
          "ring-4",
          "ring-success",
          "scale-[1.02]",
          "z-50",
        );
      }, 1500);
    }
  };

  useEffect(() => {
    if (!activeConnectionSource || !dragMousePos) {
      setDragPath(null);
      return;
    }

    const container = containerRef.current;
    if (!container) return;

    const containerRect = container.getBoundingClientRect();
    const arrowEl = document.getElementById(
      `slot-arrow-${activeConnectionSource.index}`,
    );
    if (!arrowEl) return;

    const arrowRect = arrowEl.getBoundingClientRect();
    const srcX =
      arrowRect.left +
      arrowRect.width / 2 -
      containerRect.left +
      container.scrollLeft;
    const srcY =
      arrowRect.top +
      arrowRect.height / 2 -
      containerRect.top +
      container.scrollTop;

    const tgtX = dragMousePos.x;
    const tgtY = dragMousePos.y;

    // Draw a Bezier curve from arrow to mouse cursor
    const path = `M ${srcX} ${srcY} C ${srcX + 50} ${srcY}, ${tgtX - 50} ${tgtY}, ${tgtX} ${tgtY}`;
    setDragPath(path);
  }, [activeConnectionSource, dragMousePos, containerRef]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updatePaths = () => {
      const containerRect = container.getBoundingClientRect();
      const newPaths: WirePath[] = [];

      // Find all moveToLabel nodes
      const moveToLabelNodes = nodes.filter(
        (n) => n.data.nodeType === "moveToLabel",
      );

      for (const node of moveToLabelNodes) {
        const targetLabelId = node.data.params?.targetLabelNodeId;
        if (!targetLabelId) continue;

        const srcEl = document.getElementById(`node-card-${node.id}`);
        const tgtEl = document.getElementById(`node-card-${targetLabelId}`);

        if (srcEl && tgtEl) {
          const srcRect = srcEl.getBoundingClientRect();
          const tgtRect = tgtEl.getBoundingClientRect();

          const srcX =
            srcRect.right - containerRect.left + container.scrollLeft;
          const srcY =
            srcRect.top -
            containerRect.top +
            container.scrollTop +
            srcRect.height / 2;

          const tgtX =
            tgtRect.right - containerRect.left + container.scrollLeft;
          const tgtY =
            tgtRect.top -
            containerRect.top +
            container.scrollTop +
            tgtRect.height / 2;

          // Compute C-shaped loop path around the cards on the right side
          const rightOffset = 28;
          const isDownward = tgtY > srcY;
          const wireX = Math.max(srcX, tgtX) + rightOffset;

          let path = "";
          if (isDownward) {
            path = `M ${srcX} ${srcY}
              C ${wireX} ${srcY}, ${wireX} ${srcY + 8}, ${wireX} ${srcY + 16}
              L ${wireX} ${tgtY - 16}
              C ${wireX} ${tgtY}, ${tgtX + 8} ${tgtY}, ${tgtX} ${tgtY}`;
          } else {
            path = `M ${srcX} ${srcY}
              C ${wireX} ${srcY}, ${wireX} ${srcY - 8}, ${wireX} ${srcY - 16}
              L ${wireX} ${tgtY + 16}
              C ${wireX} ${tgtY}, ${tgtX + 8} ${tgtY}, ${tgtX} ${tgtY}`;
          }

          newPaths.push({
            path,
            label: String(node.data.params?.targetLabelName || "label"),
            labelX: wireX,
            labelY: srcY,
            targetLabelNodeId: String(targetLabelId),
          });
        }
      }

      setPaths(newPaths);
    };

    // Run initially
    updatePaths();

    // Watch resizing and scrolling to redraw dynamically
    const observer = new ResizeObserver(updatePaths);
    observer.observe(container);
    for (const node of nodes) {
      const el = document.getElementById(`node-card-${node.id}`);
      if (el) observer.observe(el);
    }

    container.addEventListener("scroll", updatePaths);

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", updatePaths);
    };
  }, [nodes, containerRef]);

  if (paths.length === 0 && !dragPath) return null;

  return (
    <svg
      role="img"
      aria-label="Connection wires"
      className="absolute inset-0 pointer-events-none w-full h-full z-20 overflow-visible"
    >
      <title>Connection wires</title>
      <defs>
        <marker
          id="arrow-green"
          viewBox="0 0 10 10"
          refX="6"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M 0 1.5 L 7 5 L 0 8.5 Z" fill="var(--success)" />
        </marker>
      </defs>
      {paths.map((wp, idx) => {
        const H = 18;
        const textPadding = 12; // 8px for left arrow + 4px space
        const charWidth = 5.2;
        const textLength = wp.label.length;
        const W = Math.max(65, textLength * charWidth + textPadding + 8);
        const tagX = wp.labelX + 2; // Offset slightly from the vertical wire
        const tagY = wp.labelY - H / 2;

        return (
          <g
            key={idx}
            role="button"
            tabIndex={0}
            className="cursor-pointer select-none group/tag pointer-events-auto outline-none"
            onClick={() => handleLabelClick(wp.targetLabelNodeId)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleLabelClick(wp.targetLabelNodeId);
              }
            }}
          >
            <path
              d={wp.path}
              stroke="var(--success)"
              strokeWidth="1.5"
              fill="none"
              markerEnd="url(#arrow-green)"
              className="transition-colors duration-200 group-hover/tag:stroke-success/80"
            />
            {/* Tag shape with a left-pointing arrow */}
            <path
              d={`M 8,0 L ${W - 4},0 A 4,4 0 0,1 ${W},4 L ${W},${H - 4} A 4,4 0 0,1 ${W - 4},${H} L 8,${H} L 0,${H / 2} Z`}
              transform={`translate(${tagX}, ${tagY})`}
              fill="var(--card)"
              stroke="var(--success)"
              strokeWidth="1"
              className="transition-all duration-200 group-hover/tag:fill-success/10 group-hover/tag:stroke-success/80"
            />
            <text
              x={tagX + textPadding}
              y={tagY + H / 2 + 3}
              fill="var(--success)"
              fontSize="8"
              fontWeight="bold"
              fontFamily="monospace"
              className="transition-colors duration-200 group-hover/tag:fill-success/80"
            >
              {wp.label}
            </text>
            {/* Small decorative circle on the right end */}
            <circle
              cx={tagX + W + 6}
              cy={tagY + H / 2}
              r="2"
              fill="none"
              stroke="var(--success)"
              strokeWidth="1"
              className="opacity-60 transition-colors duration-200 group-hover/tag:stroke-success/80 group-hover/tag:opacity-100"
            />
          </g>
        );
      })}
      {dragPath && (
        <path
          d={dragPath}
          stroke="var(--success)"
          strokeWidth="1.5"
          strokeDasharray="4 3"
          fill="none"
          markerEnd="url(#arrow-green)"
        />
      )}
    </svg>
  );
}
