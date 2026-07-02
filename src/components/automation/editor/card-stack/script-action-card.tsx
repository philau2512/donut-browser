"use client";

import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FiMoreHorizontal } from "react-icons/fi";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuPlay,
  LuTriangleAlert,
  LuX,
} from "react-icons/lu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import { cn } from "@/lib/utils";
import type { AutomationCanvasNode } from "../serialize";
import { BranchConnectorRow } from "./branch-connector-row";
import { getBranchHandles } from "./flow-card-stack-adapter";

interface ScriptActionCardProps {
  node: AutomationCanvasNode;
  selected: boolean;
  labels: Array<{ id: string; name: string }>;
  debugStatus?: "idle" | "running" | "success" | "error";
  disabled?: boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: (nodeId: string) => void;
  onToggleErrorHandling?: (nodeId: string) => void;
  onSelect: (nodeId: string, isMetaKey: boolean) => void;
  onEditNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onDuplicateNode: (nodeId: string) => void;
  onCommentNode: (nodeId: string) => void;
  onStartFromHereNode: (nodeId: string) => void;
  onMoveToLabel: (
    sourceNodeId: string,
    labelId: string,
    sourceHandle: string,
  ) => void;
  // Search props
  isSearchMatch?: boolean;
  isActiveSearchMatch?: boolean;
}

export function ScriptActionCard({
  node,
  selected,
  labels,
  debugStatus,
  disabled = false,
  isCollapsed = false,
  onToggleCollapse,
  onToggleErrorHandling,
  onSelect,
  onEditNode,
  onDeleteNode,
  onDuplicateNode,
  onCommentNode,
  onStartFromHereNode,
  onMoveToLabel,
  isSearchMatch = false,
  isActiveSearchMatch = false,
}: ScriptActionCardProps) {
  useEffect(() => {
    if (isActiveSearchMatch) {
      const el = document.getElementById(`node-card-${node.id}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    }
  }, [isActiveSearchMatch, node.id]);
  const { t } = useTranslation();
  const isStart = node.data.nodeType === "start";
  const nodeType = node.data.nodeType as AutomationNodeType | "start";
  const catalog = isStart
    ? null
    : AUTOMATION_NODE_BY_TYPE[nodeType as AutomationNodeType];
  const Icon = catalog?.icon;
  const title = isStart
    ? t("automation.editor.start")
    : t(catalog?.labelKey ?? "");
  const _targetLabel =
    nodeType === "moveToLabel"
      ? labels.find((label) => label.id === node.data.params.targetLabelNodeId)
      : null;
  const handles = getBranchHandles(nodeType);

  const isBlockStartNode =
    nodeType === "ignoreErrorsStart" || nodeType === "ifCondition";
  const isBlockEndNode = nodeType === "ignoreErrorsEnd" || nodeType === "endIf";
  const isBlockNode = isBlockStartNode || isBlockEndNode;

  const customColor = node.data.params?.color;
  const colorClasses =
    customColor === "red"
      ? "border-red-500/40 bg-red-500/5"
      : customColor === "yellow"
        ? "border-amber-500/50 bg-amber-500/5"
        : customColor === "green"
          ? "border-emerald-500/40 bg-emerald-500/5"
          : customColor === "blue"
            ? "border-blue-500/40 bg-blue-500/5"
            : customColor === "purple"
              ? "border-purple-500/40 bg-purple-500/5"
              : customColor === "pink"
                ? "border-pink-500/40 bg-pink-500/5"
                : isStart
                  ? "border-emerald-500/40 bg-emerald-500/5"
                  : nodeType === "label"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : nodeType === "moveToLabel"
                      ? "border-blue-500/40 bg-blue-500/5"
                      : nodeType === "ignoreErrorsStart"
                        ? "border-amber-500/40 bg-amber-500/5"
                        : nodeType === "ifCondition"
                          ? "border-red-500/40 bg-red-500/5"
                          : "border-border bg-card";

  return (
    <article
      id={`node-card-${node.id}`}
      draggable={!disabled && !isStart}
      onDragStart={(event) => {
        if (disabled || isStart) return;
        event.dataTransfer.setData("text/plain", `donut-node-id:${node.id}`);
        event.dataTransfer.effectAllowed = "move";

        // Align the top-left corner of the card with the mouse cursor
        event.dataTransfer.setDragImage(event.currentTarget, 0, 0);
      }}
      className={cn(
        "group relative w-52 max-w-full rounded-lg border shadow-sm transition overflow-hidden cursor-pointer",
        colorClasses,
        selected && "border-primary ring-2 ring-primary/30 shadow-md",
        isSearchMatch &&
          (isActiveSearchMatch
            ? "border-amber-500 ring-4 ring-amber-500/35 shadow-[0_0_15px_rgba(245,158,11,0.5)] scale-[1.02] z-20"
            : "border-amber-500/60 border-dashed bg-amber-500/5"),
      )}
      onClick={(event) => onSelect(node.id, event.ctrlKey || event.metaKey)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onEditNode(node.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(node.id, event.ctrlKey || event.metaKey);
        }
      }}
    >
      {/* Opaque card background to block connection wires running underneath */}
      <div className="absolute inset-0 bg-card -z-10 pointer-events-none" />

      <DebugBadge status={debugStatus} />

      {/* Header */}
      <div
        className={cn(
          "flex items-center justify-between border-b border-border/50 bg-muted/40 px-3 py-1.5 select-none",
          !disabled && !isStart && "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          {Icon ? (
            <Icon className="size-3.5 text-muted-foreground/80" />
          ) : (
            <LuPlay className="size-3.5 text-muted-foreground/80" />
          )}
          <h3 className="truncate text-xs font-semibold text-foreground/90">
            {title}
          </h3>
        </div>

        {/* Hover Actions Menu */}
        {!isStart && (
          <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1.5">
            {/* Collapse/Expand for block starts */}
            {isBlockStartNode && (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCollapse?.(node.id);
                }}
                className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                title={isCollapsed ? "Expand block" : "Collapse block"}
              >
                {isCollapsed ? (
                  <LuChevronDown className="size-3.5" />
                ) : (
                  <LuChevronUp className="size-3.5" />
                )}
              </button>
            )}

            {/* Warning Triangle to toggle ignore-errors block wrapper */}
            {!isBlockNode && (
              <button
                type="button"
                disabled={disabled}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleErrorHandling?.(node.id);
                }}
                className="text-muted-foreground hover:text-warning transition-colors p-0.5"
                title="Ignore errors / Try-Catch"
              >
                <LuTriangleAlert className="size-3.5" />
              </button>
            )}

            {/* Dropdown Menu for Duplicate, Comment, Delete, etc. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={disabled}
                  onClick={(event) => event.stopPropagation()}
                  className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
                  title="More actions"
                >
                  <FiMoreHorizontal className="size-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onEditNode(node.id);
                  }}
                >
                  {t("common.buttons.edit")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onDuplicateNode(node.id);
                  }}
                >
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onCommentNode(node.id);
                  }}
                >
                  Comment
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(event) => {
                    event.stopPropagation();
                    onStartFromHereNode(node.id);
                  }}
                >
                  Start from here
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive focus:bg-destructive/10"
                  onClick={(event) => {
                    event.stopPropagation();
                    onDeleteNode(node.id);
                  }}
                >
                  {t("common.buttons.delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>

      {/* Body */}
      {(() => {
        const paramsPreview = renderNodeParams(node);
        const hasComment = !!node.data.comment;
        const hasBody = paramsPreview !== null || hasComment;

        if (!hasBody) return null;

        return (
          <div className="p-2.5 text-xs border-b border-border/30 last:border-b-0">
            {/* Parameters Preview */}
            {paramsPreview}

            {/* Comment (if exists) */}
            {node.data.comment && (
              <p className="mt-1 text-[11px] text-muted-foreground italic line-clamp-2">
                {node.data.comment}
              </p>
            )}
          </div>
        );
      })()}

      {/* Branch Select */}
      {(() => {
        const availableLabels = labels.filter((label) => label.id !== node.id);
        const showBranchSelect =
          !isStart && handles.length > 1 && availableLabels.length > 0;

        if (!showBranchSelect) return null;

        return (
          <div className="px-2.5 pb-2.5">
            <BranchConnectorRow
              nodeId={node.id}
              handles={handles}
              labels={availableLabels}
              disabled={disabled}
              onMoveToLabel={onMoveToLabel}
            />
          </div>
        );
      })()}
    </article>
  );
}

function renderNodeParams(node: AutomationCanvasNode) {
  const params = node.data.params || {};
  const nodeType = node.data.nodeType;

  if (nodeType === "openUrl") {
    return (
      <span className="text-blue-500 hover:underline font-mono break-all cursor-pointer">
        {String(params.url || "")}
      </span>
    );
  }
  if (nodeType === "click") {
    return (
      <span className="text-purple-500 font-mono break-all">
        {String(params.selector || "")}
      </span>
    );
  }
  if (nodeType === "typeText" || nodeType === "sendTextToSelector") {
    return (
      <span className="text-muted-foreground font-mono break-all">
        {String(params.text || "")} <span className="text-zinc-400">→</span>{" "}
        <span className="text-purple-500">{String(params.selector || "")}</span>
      </span>
    );
  }
  if (nodeType === "setVariable") {
    return (
      <span className="text-muted-foreground font-mono break-all">
        <span className="text-amber-500">
          [[{String(params.variableName || "")}]]
        </span>{" "}
        = {String(params.variableValue || "")}
      </span>
    );
  }
  if (nodeType === "ifCondition") {
    const left = String(params.leftValue || "");
    const op = String(params.operator || "");
    const right = String(params.rightValue || "");
    if (left === "[[WAS_ERROR]]" && (right === "true" || right === "")) {
      return (
        <span className="text-muted-foreground font-mono break-all font-semibold">
          [[WAS_ERROR]]
        </span>
      );
    }
    return (
      <span className="text-muted-foreground font-mono break-all">
        {left} {op} {right}
      </span>
    );
  }
  if (nodeType === "delay" || nodeType === "wait") {
    return (
      <span className="text-muted-foreground font-mono">
        {String(params.duration || params.timeout || "")} ms
      </span>
    );
  }
  if (nodeType === "label") {
    return (
      <span className="text-muted-foreground font-mono break-all">
        {String(params.labelName || "")}
      </span>
    );
  }
  if (nodeType === "moveToLabel") {
    return (
      <span className="text-muted-foreground font-mono break-all">
        {String(params.targetLabelName || "")}
      </span>
    );
  }
  // Generic fallback if we have params:
  const keys = Object.keys(params).filter(
    (k) => k !== "color" && k !== "dontRunWhenRecording",
  );
  if (keys.length > 0) {
    const firstParamKey = keys[0];
    return (
      <span className="text-muted-foreground font-mono text-[11px] truncate">
        {`${firstParamKey}: ${String(params[firstParamKey])}`}
      </span>
    );
  }
  return null;
}

function DebugBadge({
  status,
}: {
  status?: "idle" | "running" | "success" | "error";
}) {
  if (!status || status === "idle") return null;
  if (status === "running") {
    return (
      <span className="absolute -right-1 -top-1 size-4 animate-pulse rounded-full bg-blue-500 ring-2 ring-background" />
    );
  }
  if (status === "success") {
    return (
      <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-emerald-500 ring-2 ring-background">
        <LuCheck className="size-2.5 text-white" />
      </span>
    );
  }
  return (
    <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive ring-2 ring-background">
      <LuX className="size-2.5 text-white" />
    </span>
  );
}
