"use client";

import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ResourceDefinition } from "@/lib/automation/resource-schema";
import type {
  ResourceReport,
  ScriptReport,
} from "@/types/automation-report-types";
import type { CardStackSlot } from "./card-stack/flow-card-stack-adapter";
import { NodeCommentDialog } from "./node-comment-dialog";
import { NodePropertiesDialog } from "./node-properties-dialog";
import { ResourceConfigurationDialog } from "./panels/resource-configuration-dialog";
import { ResourceReportDialog } from "./panels/resource-report-dialog";
import { ScriptReportDialog } from "./panels/script-report-dialog";
import type { AutomationCanvasEdge, AutomationCanvasNode } from "./serialize";

interface AutomationEditorDialogsProps {
  isPropertiesDialogOpen: boolean;
  selectedNode: AutomationCanvasNode | null;
  nodes: AutomationCanvasNode[];
  edges: AutomationCanvasEdge[];
  variables: Record<string, string>;
  onPropertiesOpenChange: (open: boolean) => void;
  onParamChange: (key: string, value: string | number | boolean) => void;
  onContinueOnErrorChange: (value: boolean) => void;
  onSleepAfterChange: (
    key: "sleepAfterFrom" | "sleepAfterTo",
    value: string | number | undefined,
  ) => void;
  onCommentChange?: (nodeId: string, comment: string) => void;
  onCreateVariable: (name: string) => void;
  commentingNodeId: string | null;
  commentingNode: AutomationCanvasNode | null;
  onCloseComment: (comment: string) => void;
  isSaveAsDialogOpen: boolean;
  saveAsName: string;
  isSaving: boolean;
  onSaveAsOpenChange: (open: boolean) => void;
  onSaveAsNameChange: (name: string) => void;
  onConfirmSaveAs: () => void;
  isResourceConfigOpen: boolean;
  resources: ResourceDefinition[];
  selectedResourceIdForConfig: string | null;
  onResourceConfigOpenChange: (open: boolean) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
  isScriptReportOpen: boolean;
  scriptReport: ScriptReport | null;
  onScriptReportOpenChange: (open: boolean) => void;
  isResourceReportOpen: boolean;
  resourceReport: ResourceReport;
  onResourceReportOpenChange: (open: boolean) => void;
  labelCreationSlot: CardStackSlot | null;
  newLabelName: string;
  onLabelCreationSlotChange: (slot: CardStackSlot | null) => void;
  onNewLabelNameChange: (name: string) => void;
  onConfirmCreateLabel: () => void;
}

export function AutomationEditorDialogs({
  isPropertiesDialogOpen,
  selectedNode,
  nodes,
  edges,
  variables,
  onPropertiesOpenChange,
  onParamChange,
  onContinueOnErrorChange,
  onSleepAfterChange,
  onCommentChange,
  onCreateVariable,
  commentingNodeId,
  commentingNode,
  onCloseComment,
  isSaveAsDialogOpen,
  saveAsName,
  isSaving,
  onSaveAsOpenChange,
  onSaveAsNameChange,
  onConfirmSaveAs,
  isResourceConfigOpen,
  resources,
  selectedResourceIdForConfig,
  onResourceConfigOpenChange,
  onResourcesChange,
  isScriptReportOpen,
  scriptReport,
  onScriptReportOpenChange,
  isResourceReportOpen,
  resourceReport,
  onResourceReportOpenChange,
  labelCreationSlot,
  newLabelName,
  onLabelCreationSlotChange,
  onNewLabelNameChange,
  onConfirmCreateLabel,
}: AutomationEditorDialogsProps) {
  const { t } = useTranslation();

  return (
    <>
      <NodePropertiesDialog
        isOpen={isPropertiesDialogOpen}
        node={selectedNode}
        nodes={nodes}
        edges={edges}
        variables={variables}
        onOpenChange={onPropertiesOpenChange}
        onParamChange={onParamChange}
        onContinueOnErrorChange={onContinueOnErrorChange}
        onSleepAfterChange={onSleepAfterChange}
        onCommentChange={onCommentChange}
        onCreateVariable={onCreateVariable}
      />

      <NodeCommentDialog
        key={commentingNodeId || "none"}
        node={commentingNode}
        onClose={onCloseComment}
      />

      <Dialog open={isSaveAsDialogOpen} onOpenChange={onSaveAsOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("automation.editor.saveAsTitle")}</DialogTitle>
            <DialogDescription>
              {t("automation.editor.saveAsDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label
              htmlFor="save-as-name"
              className="mb-2 block text-xs font-semibold"
            >
              {t("automation.editor.flowNameLabel")}
            </Label>
            <Input
              id="save-as-name"
              value={saveAsName}
              onChange={(event) => onSaveAsNameChange(event.target.value)}
              placeholder={t("automation.editor.namePlaceholder")}
              className="h-9 text-xs"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onSaveAsOpenChange(false)}
            >
              {t("common.buttons.cancel")}
            </Button>
            <Button
              size="sm"
              disabled={!saveAsName.trim() || isSaving}
              onClick={onConfirmSaveAs}
            >
              {t("common.buttons.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResourceConfigurationDialog
        open={isResourceConfigOpen}
        resources={resources}
        initialSelectedResourceId={selectedResourceIdForConfig}
        onOpenChange={onResourceConfigOpenChange}
        onResourcesChange={onResourcesChange}
      />

      <ScriptReportDialog
        open={isScriptReportOpen}
        onOpenChange={onScriptReportOpenChange}
        report={scriptReport}
      />

      <ResourceReportDialog
        open={isResourceReportOpen}
        onOpenChange={onResourceReportOpenChange}
        report={resourceReport}
      />

      <Dialog
        open={Boolean(labelCreationSlot)}
        onOpenChange={(open) => {
          if (!open) {
            onLabelCreationSlotChange(null);
            onNewLabelNameChange("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Label Name</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input
              value={newLabelName}
              onChange={(e) => onNewLabelNameChange(e.target.value)}
              placeholder="e.g. check_interface_constructor"
              onKeyDown={(e) => {
                if (e.key === "Enter") onConfirmCreateLabel();
              }}
              autoFocus
            />
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                onLabelCreationSlotChange(null);
                onNewLabelNameChange("");
              }}
            >
              Cancel
            </Button>
            <Button onClick={onConfirmCreateLabel}>Ok</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
