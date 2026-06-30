"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AUTOMATION_NODE_BY_TYPE,
  type AutomationNodeType,
} from "@/lib/automation/node-catalog";
import { validateNodeVariableRefs } from "@/lib/automation/validate-node-variables";
import type { BrowserProfile } from "@/types";
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
}

export function NodePropertiesPanel({
  node,
  nodes,
  edges,
  variables,
  onParamChange,
  onContinueOnErrorChange,
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

  if (!editableNode) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground text-xs p-4 text-center">
        {t("automation.editor.properties.selectNodeHint") ||
          "Select a node to configure its properties"}
      </div>
    );
  }

  const type = editableNode.data.nodeType as AutomationNodeType;
  const catalog = AUTOMATION_NODE_BY_TYPE[type];
  if (!catalog) return null;

  const variableWarnings = validateNodeVariableRefs(
    editableNode,
    nodes,
    edges,
    variables,
  );

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
          variables={variables}
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
        variables={variables}
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
          className="flex-1 overflow-y-auto pr-1 mt-3 min-h-0"
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
