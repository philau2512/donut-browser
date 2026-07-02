"use client";

import { useEffect, useMemo, useState } from "react";
import { LuFile, LuSettings } from "react-icons/lu";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  makeDefaultResourceDefinition,
  type ResourceDefinition,
} from "@/lib/automation/resource-schema";
import { ResourceDetailForm } from "./resource-detail-form";
import { ResourceDialogSidebar } from "./resource-dialog-sidebar";

interface ResourceConfigurationDialogProps {
  open: boolean;
  resources: ResourceDefinition[];
  initialSelectedResourceId?: string | null;
  onOpenChange: (open: boolean) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
}

export function ResourceConfigurationDialog({
  open,
  resources,
  initialSelectedResourceId = null,
  onOpenChange,
  onResourcesChange,
}: ResourceConfigurationDialogProps) {
  const [draftResources, setDraftResources] = useState<ResourceDefinition[]>(
    [],
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (!open) return;
    const cloned = structuredClone(resources) as ResourceDefinition[];
    setDraftResources(cloned);
    setSelectedResourceId(
      initialSelectedResourceId &&
        cloned.some((r) => r.id === initialSelectedResourceId)
        ? initialSelectedResourceId
        : (cloned[0]?.id ?? null),
    );
  }, [open, resources, initialSelectedResourceId]);

  const selectedResource = useMemo(
    () =>
      draftResources.find((resource) => resource.id === selectedResourceId) ??
      null,
    [draftResources, selectedResourceId],
  );

  const addResource = () => {
    const nextNumber = draftResources.length + 1;
    const id = `res-${Date.now()}`;
    const resource = makeDefaultResourceDefinition({
      id,
      name: `data_input_${nextNumber}`,
    });
    setDraftResources((current) => [...current, resource]);
    setSelectedResourceId(id);
  };

  const duplicateResource = (resourceId: string) => {
    const source = draftResources.find(
      (resource) => resource.id === resourceId,
    );
    if (!source) return;
    const id = `res-${Date.now()}`;
    const cloned: ResourceDefinition = {
      ...structuredClone(source),
      id,
      name: `${source.name || "resource"}_copy`,
    };
    setDraftResources((current) => [...current, cloned]);
    setSelectedResourceId(id);
  };

  const deleteResource = (resourceId: string) => {
    setDraftResources((current) => {
      const next = current.filter((resource) => resource.id !== resourceId);
      if (selectedResourceId === resourceId) {
        setSelectedResourceId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const updateResource = (updated: ResourceDefinition) => {
    setDraftResources((current) =>
      current.map((resource) =>
        resource.id === updated.id ? normalizeResource(updated) : resource,
      ),
    );
  };

  const handleCancel = () => {
    onOpenChange(false);
  };

  const handleOk = () => {
    onResourcesChange(draftResources.map(normalizeResource));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[78vh] max-w-5xl overflow-hidden border-zinc-700 bg-zinc-900 p-0 text-zinc-100">
        <DialogHeader className="border-b border-zinc-700 px-3 py-2">
          <DialogTitle className="text-sm font-medium text-zinc-100">
            Please define resources
          </DialogTitle>
        </DialogHeader>

        <div className="flex border-b border-zinc-700 bg-zinc-950/70 px-3 py-1 text-xs text-zinc-300">
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-800"
          >
            <LuFile className="size-3.5" />
            File
          </button>
          <button
            type="button"
            className="flex items-center gap-1 rounded px-2 py-1 hover:bg-zinc-800"
          >
            <LuSettings className="size-3.5" />
            Settings
          </button>
        </div>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <ResourceDialogSidebar
            resources={draftResources}
            selectedResourceId={selectedResourceId}
            onSelectResource={setSelectedResourceId}
            onAddResource={addResource}
            onDuplicateResource={duplicateResource}
            onDeleteResource={deleteResource}
          />
          <ResourceDetailForm
            resource={selectedResource}
            onChange={updateResource}
          />
        </div>

        <DialogFooter className="border-t border-zinc-700 bg-zinc-800 px-3 py-2">
          <Button type="button" variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={handleOk}>
            OK
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function normalizeResource(resource: ResourceDefinition): ResourceDefinition {
  const name = resource.name.trim();
  return {
    ...resource,
    name,
    limits: {
      maxSuccessUsage: Math.max(
        0,
        Number(resource.limits.maxSuccessUsage) || 0,
      ),
      maxFailUsage: Math.max(0, Number(resource.limits.maxFailUsage) || 0),
      maxSimultaneousUse: Math.max(
        1,
        Number(resource.limits.maxSimultaneousUse) || 1,
      ),
      intervalBetweenUsageMs: Math.max(
        0,
        Number(resource.limits.intervalBetweenUsageMs) || 0,
      ),
    },
  };
}
