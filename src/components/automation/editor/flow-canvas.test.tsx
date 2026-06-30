import {
  createEvent,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FlowCanvas } from "./flow-canvas";
import { type AutomationCanvasNode, START_NODE_ID } from "./serialize";

const flowMock = vi.hoisted(() => ({
  latestProps: null as Record<string, unknown> | null,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@xyflow/react", async () => {
  const React = await import("react");
  return {
    ReactFlowProvider: ({ children }: { children: ReactNode }) => (
      <>{children}</>
    ),
    ReactFlow: (props: Record<string, unknown> & { children?: ReactNode }) => {
      flowMock.latestProps = props;
      React.useEffect(() => {
        const onInit = props.onInit as
          | ((instance: unknown) => void)
          | undefined;
        onInit?.({
          screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({
            x: x - 100,
            y: y - 200,
          }),
        });
      }, [props.onInit]);
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: mock test harness
        <div
          data-testid="flow-canvas"
          onDrop={props.onDrop as React.DragEventHandler<HTMLDivElement>}
          onDragOver={
            props.onDragOver as React.DragEventHandler<HTMLDivElement>
          }
        >
          {props.children}
        </div>
      );
    },
    Background: () => <div data-testid="background" />,
    Controls: () => <div data-testid="controls" />,
    Handle: () => <div />,
    Position: { Top: "top", Bottom: "bottom" },
    addEdge: (
      connection: Record<string, unknown>,
      current: Record<string, unknown>[],
    ) => [...current, connection],
  };
});

function dataTransfer(values: Record<string, string>) {
  return {
    dropEffect: "none",
    getData: vi.fn((key: string) => values[key] ?? ""),
  };
}

function renderCanvas(options?: {
  edges?: Array<{ source: string; target: string }>;
  draggedNodeType?: string | null;
}) {
  const nodes: AutomationCanvasNode[] = [
    {
      id: START_NODE_ID,
      type: "automation",
      position: { x: 0, y: 0 },
      data: { label: "Start", nodeType: "start", params: {} },
    },
  ];
  const setNodes = vi.fn();
  const setEdges = vi.fn();

  render(
    <FlowCanvas
      nodes={nodes}
      edges={(options?.edges ?? []).map((edge, index) => ({
        id: `edge-${index}`,
        source: edge.source,
        target: edge.target,
      }))}
      onNodesChange={vi.fn()}
      onEdgesChange={vi.fn()}
      setNodes={setNodes}
      setEdges={setEdges}
      onSelectNode={vi.fn()}
      draggedNodeType={options?.draggedNodeType ?? null}
    />,
  );

  return { setNodes, setEdges };
}

describe("FlowCanvas", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", { randomUUID: () => "uuid-1" });
    flowMock.latestProps = null;
  });

  it("adds a node from the custom drag payload", async () => {
    const { setNodes } = renderCanvas();
    await waitFor(() => expect(flowMock.latestProps).toBeTruthy());

    const dt = dataTransfer({ "application/donut-node-type": "openUrl" });
    const dropEvent = createEvent.drop(screen.getByTestId("flow-canvas"));
    Object.defineProperty(dropEvent, "dataTransfer", { value: dt });
    Object.defineProperty(dropEvent, "clientX", { value: 150 });
    Object.defineProperty(dropEvent, "clientY", { value: 260 });
    fireEvent(screen.getByTestId("flow-canvas"), dropEvent);

    const updater = setNodes.mock.calls[0][0] as (
      current: AutomationCanvasNode[],
    ) => AutomationCanvasNode[];
    const next = updater([]);
    expect(next[0]).toMatchObject({
      id: "openUrl-uuid-1",
      position: { x: 50, y: 60 },
      data: { nodeType: "openUrl" },
    });
  });

  it("falls back to text/plain and rejects invalid payloads", async () => {
    const { setNodes } = renderCanvas();
    await waitFor(() => expect(flowMock.latestProps).toBeTruthy());

    fireEvent.drop(screen.getByTestId("flow-canvas"), {
      clientX: 120,
      clientY: 240,
      dataTransfer: dataTransfer({ "text/plain": "click" }),
    });
    expect(setNodes).toHaveBeenCalledTimes(1);

    fireEvent.drop(screen.getByTestId("flow-canvas"), {
      clientX: 120,
      clientY: 240,
      dataTransfer: dataTransfer({ "text/plain": "not-a-node" }),
    });
    expect(setNodes).toHaveBeenCalledTimes(1);
  });

  it("marks drag over as copy", async () => {
    renderCanvas();
    await waitFor(() => expect(flowMock.latestProps).toBeTruthy());
    const transfer = dataTransfer({});

    fireEvent.dragOver(screen.getByTestId("flow-canvas"), {
      dataTransfer: transfer,
    });

    expect(transfer.dropEffect).toBe("copy");
  });

  it("enforces one outgoing edge per source", async () => {
    const { setEdges } = renderCanvas({
      edges: [{ source: "a", target: "b" }],
    });
    await waitFor(() => expect(flowMock.latestProps).toBeTruthy());
    const props = flowMock.latestProps as {
      onConnect: (connection: { source: string; target: string }) => void;
    };

    props.onConnect({ source: "a", target: "c" });
    expect(setEdges).not.toHaveBeenCalled();

    props.onConnect({ source: "a", target: "b" });
    expect(setEdges).toHaveBeenCalledTimes(1);
  });
});
