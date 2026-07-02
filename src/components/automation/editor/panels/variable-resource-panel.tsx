"use client";

// VariableResourcePanel — Phase 5 (resource allocation plan).
//
// Right-column coordinator: tabbed container for VariableManagerPanel and
// ResourceManagerPanel. Owns tab state only — does not own variable/resource
// CRUD state (delegated to props callbacks).

import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  ResourceDefinition,
  VariableDefinition,
} from "@/lib/automation/resource-schema";
import { cn } from "@/lib/utils";
import { ResourceManagerPanel } from "./resource-manager-panel";
import { VariableManagerPanel } from "./variable-manager-panel";

type Tab = "variables" | "resources";

interface VariableResourcePanelProps {
  variables: VariableDefinition[];
  resources: ResourceDefinition[];
  onVariablesChange: (variables: VariableDefinition[]) => void;
  onResourcesChange: (resources: ResourceDefinition[]) => void;
  disabled?: boolean;
}

export function VariableResourcePanel({
  variables,
  resources,
  onVariablesChange,
  onResourcesChange,
  disabled = false,
}: VariableResourcePanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>("variables");

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar */}
      <div className="flex shrink-0 border-b border-border">
        <TabButton
          active={activeTab === "variables"}
          onClick={() => setActiveTab("variables")}
          badge={variables.length}
        >
          {t("automation.editor.tabs.variables", "Variables")}
        </TabButton>
        <TabButton
          active={activeTab === "resources"}
          onClick={() => setActiveTab("resources")}
          badge={resources.length}
        >
          {t("automation.editor.tabs.resources", "Resources")}
        </TabButton>
      </div>

      {/* Panel body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {activeTab === "variables" && (
          <VariableManagerPanel
            variables={variables}
            onChange={onVariablesChange}
            disabled={disabled}
          />
        )}
        {activeTab === "resources" && (
          <ResourceManagerPanel
            resources={resources}
            onChange={onResourcesChange}
            disabled={disabled}
          />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  badge,
  children,
}: {
  active: boolean;
  onClick: () => void;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors",
        active
          ? "border-b-2 border-primary text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] font-bold tabular-nums",
            active
              ? "bg-primary/20 text-primary"
              : "bg-muted text-muted-foreground",
          )}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
