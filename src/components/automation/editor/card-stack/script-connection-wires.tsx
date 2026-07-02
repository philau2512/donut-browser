"use client";

import { useEffect, useState } from "react";
import type { AutomationCanvasNode } from "../serialize";

interface WirePath {
  path: string;
  label: string;
  labelX: number;
  labelY: number;
}

interface ScriptConnectionWiresProps {
  nodes: AutomationCanvasNode[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export function ScriptConnectionWires({
  nodes,
  containerRef,
}: ScriptConnectionWiresProps) {
  const [paths, setPaths] = useState<WirePath[]>([]);

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

          const tgtX = tgtRect.left - containerRect.left + container.scrollLeft;
          const tgtY =
            tgtRect.top -
            containerRect.top +
            container.scrollTop +
            tgtRect.height / 2;

          // Compute C-shaped loop path around the cards
          const rightOffset = 28;
          const leftOffset = 18;

          const path = `M ${srcX} ${srcY}
            C ${srcX + rightOffset} ${srcY}, ${srcX + rightOffset} ${srcY + 8}, ${srcX + rightOffset} ${srcY + 16}
            L ${srcX + rightOffset} ${tgtY > srcY ? tgtY - 16 : tgtY + 16}
            C ${srcX + rightOffset} ${tgtY}, ${tgtX - leftOffset} ${tgtY}, ${tgtX - leftOffset} ${tgtY}
            L ${tgtX} ${tgtY}`;

          const labelX = srcX + rightOffset;
          const labelY = (srcY + tgtY) / 2;

          newPaths.push({
            path,
            label: String(node.data.params?.targetLabelName || "label"),
            labelX,
            labelY,
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

  if (paths.length === 0) return null;

  return (
    <svg
      role="img"
      aria-label="Connection wires"
      className="absolute inset-0 pointer-events-none w-full h-full z-10 overflow-visible"
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
      {paths.map((wp, idx) => (
        <g key={idx}>
          <path
            d={wp.path}
            stroke="var(--success)"
            strokeWidth="1.5"
            fill="none"
            markerEnd="url(#arrow-green)"
          />
          <foreignObject
            x={wp.labelX - 45}
            y={wp.labelY - 9}
            width="90"
            height="18"
            className="overflow-visible"
          >
            <div className="flex items-center justify-center bg-card border border-success/40 rounded px-1 py-0.5 text-[8px] font-bold font-mono text-success truncate shadow-sm select-none">
              {wp.label}
            </div>
          </foreignObject>
        </g>
      ))}
    </svg>
  );
}
