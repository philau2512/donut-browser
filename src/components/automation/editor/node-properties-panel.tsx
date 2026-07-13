"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { availableVariablesAtNode } from "@/lib/automation/flow-variable-availability";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import { validateNodeVariableRefs } from "@/lib/automation/validate-node-variables";
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

interface NodePropertiesPanelProps {
  node: AutomationCanvasNode | null;
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  variables: Record<string, string>;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onContinueOnErrorChange: (value: boolean) => void;
  onSleepAfterChange: (
    key: "sleepAfterFrom" | "sleepAfterTo",
    value: string | number | undefined,
  ) => void;
}

export function NodePropertiesPanel({
  node,
  nodes,
  edges,
  variables,
  onParamChange,
  onContinueOnErrorChange,
  onSleepAfterChange,
}: NodePropertiesPanelProps) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);

  const editableNode =
    node && node.id !== START_NODE_ID && node.data.nodeType !== "start"
      ? node
      : null;

  // Load profiles for profile node forms
  useEffect(() => {
    if (!editableNode) return;
    const nodeType = editableNode.data.nodeType;
    if (nodeType === "openProfile" || nodeType === "closeProfile") {
      invoke<BrowserProfile[]>("list_browser_profiles")
        .then(setProfiles)
        .catch(() => setProfiles([]));
    }
  }, [editableNode]);

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

  if (!editableNode) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-xs p-4 text-center">
        {t("automation.editor.properties.selectNodeHint") ||
          "Select a node to configure its properties"}
      </div>
    );
  }

  if (!catalog) return null;

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

    return (
      <PropertyForm
        catalog={catalog}
        node={editableNode}
        variables={availableVars}
        variableWarnings={variableWarnings}
        onParamChange={onParamChange}
      />
    );
  };

  return (
    <div className="flex h-full flex-col min-h-0 bg-card rounded-md">
      <div className="shrink-0 border-b border-border p-3">
        <h3 className="text-sm font-semibold">{t(catalog.labelKey)}</h3>
        <p className="text-xs text-muted-foreground mt-1">
          {t(catalog.descriptionKey)}
        </p>
      </div>

      <Tabs defaultValue="options" className="flex-1 flex flex-col min-h-0 p-3">
        <TabsList className="shrink-0 justify-start w-full bg-transparent p-0 h-auto rounded-none border-b border-border gap-4">
          <TabsTrigger
            value="options"
            className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-1.5 h-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("automation.editor.properties.options") || "Options"}
          </TabsTrigger>
          <TabsTrigger
            value="setting"
            className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-1.5 h-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("automation.editor.properties.setting") || "Settings"}
          </TabsTrigger>
          <TabsTrigger
            value="document"
            className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-1.5 h-auto text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            {t("automation.editor.properties.document") || "Docs"}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="options"
          className="flex-1 overflow-y-auto pr-1 mt-3 min-h-0"
        >
          {renderOptionsContent()}
        </TabsContent>
        <TabsContent
          value="setting"
          className="flex-1 overflow-y-auto pr-1 mt-3 min-h-0 space-y-4"
        >
          <div className="flex items-center gap-3 rounded-md border border-border p-3 bg-background/50">
            <Checkbox
              id="node-continue-on-error"
              checked={editableNode.data.continueOnError === true}
              onCheckedChange={(checked) =>
                onContinueOnErrorChange(checked === true)
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="node-continue-on-error"
                className="text-xs font-medium cursor-pointer"
              >
                {t("automation.editor.properties.continueOnError")}
              </Label>
              <p className="text-[10px] text-muted-foreground leading-normal">
                {t("automation.editor.properties.continueOnErrorHint")}
              </p>
            </div>
          </div>

          <div className="space-y-3 pt-3 border-t border-border">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">
                {t("automation.editor.properties.sleepAfter") ||
                  "Sleep time (milliseconds) before running the next node."}
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">
                  {t("automation.editor.properties.sleepAfterFrom") ||
                    "From (milliseconds)"}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  1 s = 1000 ms
                </p>
                <ExpressionInput
                  value={String(editableNode.data.sleepAfterFrom ?? "")}
                  onChange={(val) => {
                    let parsed: string | number | undefined = val;
                    if (val === "") {
                      parsed = undefined;
                    } else if (
                      !val.includes("{{") &&
                      !Number.isNaN(Number(val))
                    ) {
                      parsed = Math.max(0, Number(val));
                    }
                    onSleepAfterChange("sleepAfterFrom", parsed);
                  }}
                  placeholder="0"
                  variables={variables}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] font-medium">
                  {t("automation.editor.properties.sleepAfterTo") ||
                    "To (milliseconds)"}
                </Label>
                <p className="text-[10px] text-muted-foreground">
                  1 s = 1000 ms
                </p>
                <ExpressionInput
                  value={String(editableNode.data.sleepAfterTo ?? "")}
                  onChange={(val) => {
                    let parsed: string | number | undefined = val;
                    if (val === "") {
                      parsed = undefined;
                    } else if (
                      !val.includes("{{") &&
                      !Number.isNaN(Number(val))
                    ) {
                      parsed = Math.max(0, Number(val));
                    }
                    onSleepAfterChange("sleepAfterTo", parsed);
                  }}
                  placeholder="0"
                  variables={variables}
                />
              </div>
            </div>
          </div>
        </TabsContent>
        <TabsContent
          value="document"
          className="flex-1 overflow-y-auto pr-1 mt-3 min-h-0"
        >
          <p className="whitespace-pre-line text-xs text-muted-foreground leading-relaxed">
            {t(catalog.documentKey)}
          </p>
        </TabsContent>
      </Tabs>
    </div>
  );
}
