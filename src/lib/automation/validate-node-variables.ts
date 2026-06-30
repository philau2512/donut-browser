import type { ValidationWarning } from "@/components/automation/editor/nodes/forms/validation-badge";
import type {
  AutomationCanvasEdge,
  AutomationCanvasNode,
} from "@/components/automation/editor/serialize";
import { availableVariablesAtNode } from "@/lib/automation/flow-variable-availability";
import { extractVariableRefsFromParams } from "@/lib/automation/flow-variables";

export function validateNodeVariableRefs(
  node: AutomationCanvasNode,
  nodes: AutomationCanvasNode[],
  edges: AutomationCanvasEdge[],
  flowVariables: Record<string, string>,
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  if (node.data.nodeType === "start") return warnings;

  const available = availableVariablesAtNode(
    node.id,
    nodes,
    edges,
    flowVariables,
  );
  const used = extractVariableRefsFromParams(node.data.params);

  if (node.data.nodeType === "openProfile") {
    const automation = node.data.params.automation;
    if (typeof automation === "string" && automation.trim()) {
      try {
        const parsed = JSON.parse(automation) as unknown;
        for (const name of extractVariableRefsFromParams(parsed)) {
          if (!used.includes(name)) used.push(name);
        }
      } catch {
        // JSON parse errors handled elsewhere in open-profile form
      }
    }
  }

  const seen = new Set<string>();
  for (const raw of used) {
    const name = raw.toUpperCase();
    if (seen.has(name)) continue;
    seen.add(name);
    if (!available.has(name)) {
      warnings.push({
        type: "error",
        message: `Variable {{${name}}} is not available before this step in the flow`,
      });
    }
  }

  return warnings;
}
