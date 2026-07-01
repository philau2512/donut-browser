"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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

interface NodePropertiesDialogProps {
  isOpen: boolean;
  node: AutomationCanvasNode | null;
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  variables: Record<string, string>;
  onOpenChange: (open: boolean) => void;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onContinueOnErrorChange: (value: boolean) => void;
}

export function NodePropertiesDialog({
  isOpen,
  node,
  nodes,
  edges,
  variables,
  onOpenChange,
  onParamChange,
  onContinueOnErrorChange,
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

  if (!open || !editableNode) {
    return <Dialog open={false} onOpenChange={onOpenChange} />;
  }

  const type = editableNode.data.nodeType as AutomationNodeType;
  const catalog = AUTOMATION_NODE_BY_TYPE[type];
  const variableWarnings = validateNodeVariableRefs(
    editableNode,
    nodes,
    edges,
    variables,
  );

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

    // Default: use generic PropertyForm
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-2xl h-[480px] flex flex-col"
        onPointerDownOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>{t(catalog.labelKey)}</DialogTitle>
          <DialogDescription>{t(catalog.descriptionKey)}</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="options" className="flex-1 flex flex-col min-h-0">
          <TabsList className="shrink-0 justify-start w-full bg-transparent p-0 h-auto rounded-none border-b border-border gap-6">
            <TabsTrigger
              value="options"
              className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-2 h-auto text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {t("automation.editor.properties.options")}
            </TabsTrigger>
            <TabsTrigger
              value="setting"
              className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-2 h-auto text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {t("automation.editor.properties.setting")}
            </TabsTrigger>
            <TabsTrigger
              value="document"
              className="rounded-none bg-transparent shadow-none data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary border-b-2 border-transparent px-1 pb-2 h-auto text-sm font-semibold text-muted-foreground hover:text-foreground"
            >
              {t("automation.editor.properties.document")}
            </TabsTrigger>
          </TabsList>
          <TabsContent
            value="options"
            className="flex-1 overflow-y-auto pr-1 mt-4 min-h-0"
          >
            {renderOptionsContent()}
          </TabsContent>
          <TabsContent
            value="setting"
            className="flex-1 overflow-y-auto pr-1 mt-4 min-h-0"
          >
            <div className="flex items-center gap-3 rounded-md border border-border p-3">
              <Checkbox
                checked={editableNode.data.continueOnError === true}
                onCheckedChange={(checked) =>
                  onContinueOnErrorChange(checked === true)
                }
              />
              <div className="space-y-1">
                <Label>
                  {t("automation.editor.properties.continueOnError")}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {t("automation.editor.properties.continueOnErrorHint")}
                </p>
              </div>
            </div>
          </TabsContent>
          <TabsContent
            value="document"
            className="flex-1 overflow-y-auto pr-1 mt-4 min-h-0"
          >
            <p className="whitespace-pre-line text-sm text-muted-foreground">
              {t(catalog.documentKey)}
            </p>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
