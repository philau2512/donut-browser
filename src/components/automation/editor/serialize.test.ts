import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  type AutomationCanvasNode,
  createAutomationNode,
  createStartNode,
  fromDonutFlow,
  layoutPathForFlow,
  START_NODE_ID,
  toDonutFlow,
  toLayoutSidecar,
} from "./serialize";

function node(
  id: string,
  nodeType: AutomationCanvasNode["data"]["nodeType"],
  params = {},
) {
  return {
    id,
    type: "automation",
    position: { x: 10, y: 20 },
    data: { label: String(nodeType), nodeType, params },
  } as AutomationCanvasNode;
}

describe("automation editor serialization", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
  });

  it("creates a fixed UI-only start node", () => {
    const start = createStartNode();

    expect(start).toMatchObject({
      id: START_NODE_ID,
      type: "automation",
      position: { x: 120, y: 120 },
      deletable: false,
      draggable: true,
      data: { label: "Start", nodeType: "start", params: {} },
    });
  });

  it("creates catalog nodes with defaults and deterministic ids", () => {
    const openUrl = createAutomationNode("openUrl", { x: 50, y: 70 });

    expect(openUrl).toMatchObject({
      id: "openUrl-uuid-1",
      type: "automation",
      position: { x: 50, y: 70 },
      data: {
        label: "openUrl",
        nodeType: "openUrl",
        params: { url: "https://example.com" },
      },
    });
  });

  it("serializes only real nodes and edges while preserving variables", () => {
    const start = createStartNode();
    const open = node("n1", "openUrl", {
      url: "https://example.com",
      timeout: 0,
      empty: "",
    });
    const click = node("n2", "click", {
      selector: "#go",
      optional: "",
      disabled: false,
    });
    click.data.continueOnError = true;

    const flow = toDonutFlow(
      "demo",
      [click, start, open],
      [
        { id: "edge-start-n1", source: START_NODE_ID, target: "n1" },
        { id: "edge-n1-n2", source: "n1", target: "n2" },
        { id: "edge-unknown", source: "n2", target: "missing" },
      ],
      { EMAIL: "user@example.com" },
    );

    expect(flow).toEqual({
      version: 1,
      name: "demo",
      variables: { EMAIL: "user@example.com" },
      nodes: [
        {
          id: "n1",
          type: "openUrl",
          params: { url: "https://example.com", timeout: 0 },
        },
        {
          id: "n2",
          type: "click",
          params: { selector: "#go", disabled: false },
          continueOnError: true,
        },
      ],
      edges: [{ from: "n1", to: "n2", sourceHandle: "success" }],
    });
  });

  it("throws when a canvas node has an unknown node type", () => {
    expect(() =>
      toDonutFlow("bad", [node("bad", "missing" as never)], [], {}),
    ).toThrow("Unknown automation node type: missing");
  });

  it("deserializes flow nodes, layout, and synthetic start edge", () => {
    const canvas = fromDonutFlow(
      {
        version: 1,
        name: "demo",
        variables: {},
        nodes: [
          { id: "n1", type: "openUrl", params: { url: "https://a.test" } },
          {
            id: "n2",
            type: "click",
            params: { selector: "#go" },
            continueOnError: true,
          },
        ],
        edges: [{ from: "n1", to: "n2", sourceHandle: "success" }],
      },
      { version: 1, positions: { n1: { x: 1, y: 2 } } },
    );

    expect(canvas.nodes.map((item) => item.id)).toEqual([
      START_NODE_ID,
      "n1",
      "n2",
    ]);
    expect(canvas.nodes[1].position).toEqual({ x: 1, y: 2 });
    expect(canvas.nodes[2].position).toEqual({ x: 360, y: 240 });
    expect(canvas.nodes[2].data.continueOnError).toBe(true);
    expect(canvas.edges).toEqual([
      {
        id: `edge-${START_NODE_ID}-n1`,
        source: START_NODE_ID,
        target: "n1",
        sourceHandle: "success",
      },
      { id: "edge-n1-n2", source: "n1", target: "n2", sourceHandle: "success" },
    ]);
  });

  it("writes layout sidecars without the start node", () => {
    expect(
      toLayoutSidecar([
        createStartNode(),
        { ...node("n1", "log", { message: "hi" }), position: { x: 3, y: 4 } },
      ]),
    ).toEqual({ version: 1, positions: { n1: { x: 3, y: 4 } } });
  });

  it("maps flow paths to layout sidecar paths case-insensitively", () => {
    expect(layoutPathForFlow("C:/flows/demo.donutflow")).toBe(
      "C:/flows/demo.layout.json",
    );
    expect(layoutPathForFlow("C:/flows/demo.DONUTFLOW")).toBe(
      "C:/flows/demo.layout.json",
    );
  });

  it("serializes and deserializes custom sourceHandles for branching and looping", () => {
    const start = createStartNode();
    const ifNode = node("n1", "ifCondition", {
      leftValue: "1",
      operator: "===",
      rightValue: "1",
    });
    const logTrue = node("n2", "log", { message: "is true" });
    const logFalse = node("n3", "log", { message: "is false" });

    const flow = toDonutFlow(
      "branching-demo",
      [logTrue, start, ifNode, logFalse],
      [
        { id: "edge-start-n1", source: START_NODE_ID, target: "n1" },
        { id: "edge-n1-n2", source: "n1", target: "n2", sourceHandle: "true" },
        { id: "edge-n1-n3", source: "n1", target: "n3", sourceHandle: "false" },
      ],
      {},
    );

    expect(flow.edges).toEqual([
      { from: "n1", to: "n2", sourceHandle: "true" },
      { from: "n1", to: "n3", sourceHandle: "false" },
    ]);

    const canvas = fromDonutFlow(flow);
    expect(canvas.edges).toEqual([
      {
        id: `edge-${START_NODE_ID}-n1`,
        source: START_NODE_ID,
        target: "n1",
        sourceHandle: "success",
      },
      { id: "edge-n1-n2", source: "n1", target: "n2", sourceHandle: "true" },
      { id: "edge-n1-n3", source: "n1", target: "n3", sourceHandle: "false" },
    ]);
  });
});
