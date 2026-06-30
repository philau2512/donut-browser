import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractFlowReviewItems,
  isFlowReviewed,
  markFlowReviewed,
} from "@/lib/automation/flow-review";
import { showErrorToast } from "@/lib/toast-utils";
import { useAutomationRun } from "./use-automation-run";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
}));
vi.mock("@/lib/automation/flow-review", () => ({
  isFlowReviewed: vi.fn(),
  markFlowReviewed: vi.fn(),
  extractFlowReviewItems: vi.fn().mockReturnValue([]),
}));
vi.mock("@/lib/toast-utils", () => ({ showErrorToast: vi.fn() }));
vi.mock("@/i18n", () => ({ default: { t: (key: string) => key } }));

const invokeMock = vi.mocked(invoke);
const isFlowReviewedMock = vi.mocked(isFlowReviewed);
const markFlowReviewedMock = vi.mocked(markFlowReviewed);
const extractFlowReviewItemsMock = vi.mocked(extractFlowReviewItems);

const flowPath = "C:/flows/demo.donutflow";
const flowJson = JSON.stringify({
  version: 1,
  name: "demo",
  variables: {},
  nodes: [],
  edges: [],
});
const profile = {
  id: "p1",
  name: "Profile 1",
} as import("@/types").BrowserProfile;
const settings = {} as import("@/types/automation-types").RunSettings;

describe("useAutomationRun — review gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    markFlowReviewedMock.mockResolvedValue(undefined);
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_automation_flow") return Promise.resolve(flowJson);
      if (cmd === "start_automation_run") return Promise.resolve("run-1");
      if (cmd === "list_automation_flows") return Promise.resolve([]);
      if (cmd === "list_automation_runs") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("sets pendingReview without starting run when flow is unreviewed", async () => {
    isFlowReviewedMock.mockResolvedValue(false);
    extractFlowReviewItemsMock.mockReturnValue([]);

    const { result } = renderHook(() => useAutomationRun());

    let runId: string | null = null;
    await act(async () => {
      runId = await result.current.start(flowPath, [profile], settings);
    });

    expect(runId).toBeNull();
    expect(result.current.pendingReview).toMatchObject({
      flowPath,
      flowName: "demo",
      flowJson,
    });
    expect(invokeMock).not.toHaveBeenCalledWith(
      "start_automation_run",
      expect.anything(),
    );
  });

  it("starts immediately when flow is already reviewed", async () => {
    isFlowReviewedMock.mockResolvedValue(true);

    const { result } = renderHook(() => useAutomationRun());

    let runId: string | null = null;
    await act(async () => {
      runId = await result.current.start(flowPath, [profile], settings);
    });

    expect(runId).toBe("run-1");
    expect(result.current.pendingReview).toBeNull();
    expect(invokeMock).toHaveBeenCalledWith(
      "start_automation_run",
      expect.anything(),
    );
  });

  it("confirmPendingReview marks flow reviewed then starts run", async () => {
    isFlowReviewedMock.mockResolvedValue(false);

    const { result } = renderHook(() => useAutomationRun());

    await act(async () => {
      await result.current.start(flowPath, [profile], settings);
    });

    let runId: string | null = null;
    await act(async () => {
      runId = await result.current.confirmPendingReview();
    });

    expect(markFlowReviewedMock).toHaveBeenCalledWith(flowPath, flowJson);
    expect(invokeMock).toHaveBeenCalledWith(
      "start_automation_run",
      expect.anything(),
    );
    expect(runId).toBe("run-1");
    expect(result.current.pendingReview).toBeNull();
  });

  it("cancelPendingReview clears pending without starting run", async () => {
    isFlowReviewedMock.mockResolvedValue(false);

    const { result } = renderHook(() => useAutomationRun());

    await act(async () => {
      await result.current.start(flowPath, [profile], settings);
    });

    expect(result.current.pendingReview).not.toBeNull();

    act(() => {
      result.current.cancelPendingReview();
    });

    expect(result.current.pendingReview).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "start_automation_run",
      expect.anything(),
    );
  });

  it("returns null and shows error toast when start fails", async () => {
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === "read_automation_flow")
        return Promise.reject(new Error("not found"));
      if (cmd === "list_automation_flows") return Promise.resolve([]);
      if (cmd === "list_automation_runs") return Promise.resolve([]);
      return Promise.resolve(null);
    });

    const { result } = renderHook(() => useAutomationRun());

    let runId: string | null = "initial";
    await act(async () => {
      runId = await result.current.start(flowPath, [profile], settings);
    });

    expect(runId).toBeNull();
    expect(showErrorToast).toHaveBeenCalled();
    expect(result.current.pendingReview).toBeNull();
  });

  it("returns null immediately when no profiles provided", async () => {
    const { result } = renderHook(() => useAutomationRun());

    let runId: string | null = "initial";
    await act(async () => {
      runId = await result.current.start(flowPath, [], settings);
    });

    expect(runId).toBeNull();
    expect(invokeMock).not.toHaveBeenCalledWith(
      "read_automation_flow",
      expect.anything(),
    );
  });
});
