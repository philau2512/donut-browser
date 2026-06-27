"use client";

import { useState } from "react";
import type { BrowserProfile } from "@/types";
import { AutomationPage } from "./automation-page";
import { FlowEditorPage } from "./editor/flow-editor-page";
import { ScriptManagementPage } from "./script-management-page";

/** Which automation view is active. `flowPath` carries the selected flow into
 * the run/editor views; undefined in the editor view means "new flow". */
type AutomationView =
  | { kind: "list" }
  | { kind: "editor"; flowPath?: string }
  | { kind: "run"; flowPath: string };

interface AutomationTabProps {
  profiles: BrowserProfile[];
}

/** Top-level switcher for the Automation tab. Replaces the old "always the run
 * page" entry point: defaults to the script-management list, opening the editor
 * or run panel on demand. */
export function AutomationTab({ profiles }: AutomationTabProps) {
  const [view, setView] = useState<AutomationView>({ kind: "list" });

  if (view.kind === "run") {
    return (
      <AutomationPage
        profiles={profiles}
        initialFlowPath={view.flowPath}
        onBack={() => setView({ kind: "list" })}
      />
    );
  }

  if (view.kind === "editor") {
    return (
      <FlowEditorPage
        flowPath={view.flowPath}
        onBack={() => setView({ kind: "list" })}
        onSaved={() => setView({ kind: "list" })}
      />
    );
  }

  return (
    <ScriptManagementPage
      onRun={(flowPath) => setView({ kind: "run", flowPath })}
      onEdit={(flowPath) => setView({ kind: "editor", flowPath })}
      onCreate={() => setView({ kind: "editor" })}
    />
  );
}
