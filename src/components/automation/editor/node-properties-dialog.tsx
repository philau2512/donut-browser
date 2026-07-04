"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { availableVariablesAtNode } from "@/lib/automation/flow-variable-availability";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import { validateNodeVariableRefs } from "@/lib/automation/validate-node-variables";
import { cn } from "@/lib/utils";
import type { BrowserProfile } from "@/types";
import { ExpressionInput } from "./expression-input";
import { CloseProfileForm } from "./nodes/forms/close-profile-form";
import { OpenProfileForm } from "./nodes/forms/open-profile-form";
import { PropertyForm } from "./property-form";
import {
  type AutomationCanvasEdge,
  type AutomationCanvasNode,
  START_NODE_ID,
} from "./serialize";

interface NodePropertiesDialogProps {
  isOpen: boolean;
  node: AutomationCanvasNode | null;
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  variables: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onConfirm?: () => void;
  onCancel?: () => void;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onContinueOnErrorChange: (value: boolean) => void;
  onSleepAfterChange: (
    key: "sleepAfterFrom" | "sleepAfterTo",
    value: string | number | undefined,
  ) => void;
  onCommentChange?: (nodeId: string, comment: string) => void;
  onCreateVariable?: (name: string) => void;
}

const COLORS = [
  { value: "red", bg: "bg-red-500" },
  { value: "yellow", bg: "bg-amber-500" },
  { value: "green", bg: "bg-emerald-500" },
  { value: "blue", bg: "bg-blue-500" },
  { value: "purple", bg: "bg-purple-500" },
  { value: "pink", bg: "bg-pink-500" },
];

export function NodePropertiesDialog({
  isOpen,
  node,
  nodes,
  edges,
  variables,
  onOpenChange,
  onConfirm,
  onCancel,
  onParamChange,
  onContinueOnErrorChange,
  onSleepAfterChange,
  onCommentChange,
  onCreateVariable,
}: NodePropertiesDialogProps) {
  const { t } = useTranslation();
  const editableNode =
    node && node.id !== START_NODE_ID && node.data.nodeType !== "start"
      ? node
      : null;
  const open = isOpen && Boolean(editableNode);
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);

  // Load profiles for profile node forms
  useEffect(() => {
    if (!open || !editableNode) return;
    const nodeType = editableNode.data.nodeType;
    if (nodeType === "openProfile" || nodeType === "closeProfile") {
      invoke<BrowserProfile[]>("list_browser_profiles")
        .then(setProfiles)
        .catch(() => setProfiles([]));
    }
  }, [open, editableNode]);

  const type = editableNode?.data.nodeType as AutomationNodeType | undefined;
  const catalog = type ? AUTOMATION_NODE_BY_TYPE[type] : null;

  const availableVars = useMemo(() => {
    if (!editableNode) return {};
    const set = availableVariablesAtNode(
      editableNode.id,
      nodes,
      edges,
      variables,
    );
    const obj: Record<string, string> = {};
    for (const v of set) {
      obj[v] = variables[v] ?? "";
    }
    return obj;
  }, [editableNode, nodes, edges, variables]);

  const variableWarnings = useMemo(() => {
    if (!editableNode) return [];
    return validateNodeVariableRefs(editableNode, nodes, edges, variables);
  }, [editableNode, nodes, edges, variables]);

  if (!open || !editableNode || !catalog) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  // Special form rendering for profile nodes
  const renderOptionsContent = () => {
    if (type === "openProfile") {
      return (
        <OpenProfileForm
          value={{
            profileId: String(editableNode.data.params.profileId ?? ""),
            automation: String(editableNode.data.params.automation ?? ""),
          }}
          onChange={(val) => {
            if (val.profileId !== editableNode.data.params.profileId) {
              onParamChange("profileId", val.profileId);
            }
            if (val.automation !== editableNode.data.params.automation) {
              onParamChange("automation", val.automation ?? "");
            }
          }}
          profiles={profiles}
          variables={availableVars}
          variableWarnings={variableWarnings}
        />
      );
    }

    if (type === "closeProfile") {
      return (
        <CloseProfileForm
          value={{
            profileId: String(editableNode.data.params.profileId ?? ""),
            cleanupMode:
              (editableNode.data.params.cleanupMode as "cookies" | "full") ??
              "cookies",
          }}
          onChange={(val) => {
            if (val.profileId !== editableNode.data.params.profileId) {
              onParamChange("profileId", val.profileId);
            }
            if (val.cleanupMode !== editableNode.data.params.cleanupMode) {
              onParamChange("cleanupMode", val.cleanupMode);
            }
          }}
          profiles={profiles}
          variableWarnings={variableWarnings}
        />
      );
    }

    // Default: use generic PropertyForm
    return (
      <PropertyForm
        catalog={catalog}
        node={editableNode}
        variables={availableVars}
        variableWarnings={variableWarnings}
        onParamChange={onParamChange}
        onCreateVariable={onCreateVariable}
      />
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-5xl h-[560px] p-0 flex flex-row overflow-hidden"
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        {/* Left Column: Edit Task (Sidebar) */}
        <div className="w-80 shrink-0 border-r border-border p-4 bg-muted/10 flex flex-col justify-between select-none">
          <div className="space-y-4">
            <h2 className="text-base font-semibold">Edit Task</h2>

            {/* Task Description (Comment) */}
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Task Description
              </Label>
              <textarea
                value={editableNode.data.comment || ""}
                onChange={(e) => {
                  onCommentChange?.(editableNode.id, e.target.value);
                }}
                placeholder="Enter description..."
                className="w-full h-28 rounded-md border border-border bg-background px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring resize-none font-normal"
              />
            </div>

            {/* Node ID */}
            <div className="text-xs text-muted-foreground">
              Id: <span className="font-mono">{editableNode.id}</span>
            </div>

            {/* Node Color Selection */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Color:</Label>
              <div className="flex gap-2">
                {COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => {
                      onParamChange("color", c.value);
                    }}
                    className={cn(
                      "size-5 rounded-full border border-zinc-600 transition-transform hover:scale-110",
                      c.bg,
                      editableNode.data.params?.color === c.value &&
                        "ring-2 ring-primary ring-offset-2",
                    )}
                  />
                ))}
                {editableNode.data.params?.color && (
                  <button
                    type="button"
                    onClick={() => {
                      onParamChange("color", "");
                    }}
                    className="text-[10px] text-muted-foreground hover:text-foreground transition-colors ml-1 underline"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Don't run when recording */}
            <div className="flex items-center gap-2 pt-2">
              <Checkbox
                id="dont-run-recording"
                checked={
                  editableNode.data.params?.dontRunWhenRecording === true
                }
                onCheckedChange={(checked) => {
                  onParamChange("dontRunWhenRecording", checked === true);
                }}
              />
              <Label
                htmlFor="dont-run-recording"
                className="text-xs font-normal cursor-pointer select-none"
              >
                Don't run when recording
              </Label>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-4 border-t border-border/50">
            <Button
              className="flex-1 h-8 text-xs"
              onClick={() => {
                onConfirm?.();
                onOpenChange(false);
              }}
            >
              Ok
            </Button>
            <Button
              variant="outline"
              className="flex-1 h-8 text-xs"
              onClick={() => {
                onCancel?.();
                onOpenChange(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>

        {/* Right Column: Node Form Parameters */}
        <div className="flex-1 flex flex-col min-h-0 bg-background">
          {/* Header (Breadcrumb) */}
          <div className="shrink-0 border-b border-border bg-muted/20 px-4 py-3">
            <div className="text-xs text-muted-foreground font-mono">
              Main / {t(`automation.editor.groups.${catalog.group}`)} /{" "}
              {t(catalog.labelKey)}
            </div>
          </div>

          {/* Form Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {renderOptionsContent()}

            {/* Additional Settings (Continue on error, Sleep after) */}
            <div className="border-t border-border pt-4 mt-6">
              <h3 className="text-xs font-semibold mb-3">
                Additional settings
              </h3>

              <div className="space-y-4">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="continue-on-error"
                    checked={editableNode.data.continueOnError === true}
                    onCheckedChange={(checked) =>
                      onContinueOnErrorChange(checked === true)
                    }
                  />
                  <Label
                    htmlFor="continue-on-error"
                    className="text-xs font-normal cursor-pointer select-none"
                  >
                    Continue on error
                  </Label>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">
                      Sleep From (ms)
                    </Label>
                    <ExpressionInput
                      value={String(editableNode.data.sleepAfterFrom ?? "")}
                      onChange={(val) => {
                        let parsed: string | number | undefined = val;
                        if (val === "") parsed = undefined;
                        else if (
                          !val.includes("{{") &&
                          !Number.isNaN(Number(val))
                        )
                          parsed = Math.max(0, Number(val));
                        onSleepAfterChange("sleepAfterFrom", parsed);
                      }}
                      placeholder="0"
                      variables={variables}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px] text-muted-foreground">
                      Sleep To (ms)
                    </Label>
                    <ExpressionInput
                      value={String(editableNode.data.sleepAfterTo ?? "")}
                      onChange={(val) => {
                        let parsed: string | number | undefined = val;
                        if (val === "") parsed = undefined;
                        else if (
                          !val.includes("{{") &&
                          !Number.isNaN(Number(val))
                        )
                          parsed = Math.max(0, Number(val));
                        onSleepAfterChange("sleepAfterTo", parsed);
                      }}
                      placeholder="0"
                      variables={variables}
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
