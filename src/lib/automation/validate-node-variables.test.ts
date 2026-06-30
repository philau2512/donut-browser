import { describe, expect, it } from "vitest";
import type {
  AutomationCanvasEdge,
  AutomationCanvasNode,
} from "@/components/automation/editor/serialize";
import { START_NODE_ID } from "@/components/automation/editor/serialize";
import { availableVariablesAtNode } from "@/lib/automation/flow-variable-availability";
import { validateNodeVariableRefs } from "@/lib/automation/validate-node-variables";

function node(
  id: string,
  nodeType: AutomationCanvasNode["data"]["nodeType"],
  params: Record<string, string | number | boolean> = {},
): AutomationCanvasNode {
  return {
    id,
    type: "automation",
    position: { x: 0, y: 0 },
    data: { label: id, nodeType, params },
  };
}

describe("flow variable availability", () => {
  const edges: AutomationCanvasEdge[] = [
    { id: "e1", source: START_NODE_ID, target: "a" },
    { id: "e2", source: "a", target: "b" },
  ];

  it("includes run-start vars and custom flow variables", () => {
    const nodes = [node("a", "openUrl", { url: "https://x.com" })];
    const avail = availableVariablesAtNode("a", nodes, edges, { API_KEY: "x" });
    expect(avail.has("PROFILE_ID")).toBe(true);
    expect(avail.has("CDP_PORT")).toBe(true);
    expect(avail.has("API_KEY")).toBe(true);
    expect(avail.has("PROXY_IP")).toBe(false);
  });

  it("adds openProfile vars only for downstream nodes", () => {
    const nodes = [
      node("a", "openProfile", { profileId: "p1" }),
      node("b", "http", { url: "https://x/{{PROXY_IP}}" }),
    ];
    const beforeOpen = availableVariablesAtNode("a", nodes, edges, {});
    const afterOpen = availableVariablesAtNode("b", nodes, edges, {});
    expect(beforeOpen.has("PROXY_IP")).toBe(false);
    expect(afterOpen.has("PROXY_IP")).toBe(true);
  });
});

describe("validateNodeVariableRefs", () => {
  it("errors when PROXY_IP used before openProfile", () => {
    const nodes = [
      node("a", "http", { url: "https://x/{{PROXY_IP}}" }),
      node("b", "openProfile", { profileId: "{{PROFILE_ID}}" }),
    ];
    const edges: AutomationCanvasEdge[] = [
      { id: "e1", source: START_NODE_ID, target: "a" },
      { id: "e2", source: "a", target: "b" },
    ];
    const warnings = validateNodeVariableRefs(nodes[0], nodes, edges, {});
    expect(warnings.some((w) => w.message.includes("PROXY_IP"))).toBe(true);
  });

  it("allows PROFILE_ID on any node", () => {
    const nodes = [node("a", "http", { url: "https://x/{{PROFILE_ID}}" })];
    const edges: AutomationCanvasEdge[] = [
      { id: "e1", source: START_NODE_ID, target: "a" },
    ];
    const warnings = validateNodeVariableRefs(nodes[0], nodes, edges, {});
    expect(warnings).toHaveLength(0);
  });
});
