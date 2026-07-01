import { describe, expect, it } from "vitest";
import { truncateFlowFromNode } from "./flow-truncation";
import type { DonutFlowV1 } from "./serialize";

describe("truncateFlowFromNode", () => {
  const sampleFlow: DonutFlowV1 = {
    version: 1,
    name: "Test Flow",
    variables: { FOO: "bar" },
    nodes: [
      { id: "A", type: "openUrl", params: { url: "http://a.com" } },
      { id: "B", type: "click", params: { selector: "button" } },
      { id: "C", type: "type", params: { text: "hello" } },
      { id: "D", type: "openUrl", params: { url: "http://d.com" } },
    ],
    edges: [
      { from: "A", to: "B", sourceHandle: "success" },
      { from: "B", to: "C", sourceHandle: "success" },
      { from: "C", to: "D", sourceHandle: "success" },
    ],
  };

  it("should truncate linear chain correctly", () => {
    const result = truncateFlowFromNode(sampleFlow, "B");
    expect(result.nodes.map((n) => n.id)).toEqual(["B", "C", "D"]);
    expect(result.edges).toEqual([
      { from: "B", to: "C", sourceHandle: "success" },
      { from: "C", to: "D", sourceHandle: "success" },
    ]);
    expect(result.variables).toEqual({ FOO: "bar" });
    expect(result.name).toBe("Test Flow");
  });

  it("should handle branching flows", () => {
    const branchingFlow: DonutFlowV1 = {
      version: 1,
      name: "Branching Flow",
      variables: {},
      nodes: [
        { id: "A", type: "ifCondition" },
        { id: "B", type: "click" },
        { id: "C", type: "click" },
        { id: "D", type: "openUrl" },
      ],
      edges: [
        { from: "A", to: "B", sourceHandle: "true" },
        { from: "A", to: "C", sourceHandle: "false" },
        { from: "B", to: "D", sourceHandle: "success" },
        { from: "C", to: "D", sourceHandle: "success" },
      ],
    };

    const fromB = truncateFlowFromNode(branchingFlow, "B");
    expect(fromB.nodes.map((n) => n.id)).toEqual(["B", "D"]);
    expect(fromB.edges).toEqual([
      { from: "B", to: "D", sourceHandle: "success" },
    ]);

    const fromA = truncateFlowFromNode(branchingFlow, "A");
    expect(fromA.nodes.map((n) => n.id)).toEqual(["A", "B", "C", "D"]);
    expect(fromA.edges).toHaveLength(4);
  });

  it("should be cycle-safe", () => {
    const cyclicFlow: DonutFlowV1 = {
      version: 1,
      name: "Cyclic Flow",
      variables: {},
      nodes: [
        { id: "A", type: "openUrl" },
        { id: "B", type: "click" },
        { id: "C", type: "click" },
      ],
      edges: [
        { from: "A", to: "B", sourceHandle: "success" },
        { from: "B", to: "C", sourceHandle: "success" },
        { from: "C", to: "A", sourceHandle: "success" },
      ],
    };

    const result = truncateFlowFromNode(cyclicFlow, "B");
    expect(result.nodes.map((n) => n.id).sort()).toEqual(["A", "B", "C"]);
    expect(result.edges).toHaveLength(3);
  });

  it("should handle isolated node", () => {
    const isolatedFlow: DonutFlowV1 = {
      version: 1,
      name: "Isolated Flow",
      variables: {},
      nodes: [
        { id: "A", type: "openUrl" },
        { id: "B", type: "click" },
      ],
      edges: [],
    };

    const result = truncateFlowFromNode(isolatedFlow, "A");
    expect(result.nodes.map((n) => n.id)).toEqual(["A"]);
    expect(result.edges).toHaveLength(0);
  });

  it("should return empty if start node not found", () => {
    const result = truncateFlowFromNode(sampleFlow, "NON_EXISTENT");
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });
});
