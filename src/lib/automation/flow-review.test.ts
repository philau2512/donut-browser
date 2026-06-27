import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DonutFlowV1 } from "@/components/automation/editor/serialize";
import {
  extractFlowReviewItems,
  isFlowReviewed,
  markFlowReviewed,
  reviewedPathForFlow,
  sha256Hex,
} from "./flow-review";

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

const readTextFileMock = vi.mocked(readTextFile);
const writeTextFileMock = vi.mocked(writeTextFile);

const flowPath = "C:/flows/imported.donutflow";
const flowJson = JSON.stringify({ version: 1, name: "Imported" });

describe("automation flow review sidecars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps flow paths to reviewed sidecar paths", () => {
    expect(reviewedPathForFlow(flowPath)).toBe("C:/flows/imported.reviewed");
    expect(reviewedPathForFlow("C:/flows/imported.DONUTFLOW")).toBe(
      "C:/flows/imported.reviewed",
    );
  });

  it("computes stable lowercase sha256 hex", async () => {
    await expect(sha256Hex("abc")).resolves.toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("returns true only when the reviewed sidecar hash matches current content", async () => {
    const sha256 = await sha256Hex(flowJson);
    readTextFileMock.mockResolvedValue(JSON.stringify({ version: 1, sha256 }));

    await expect(isFlowReviewed(flowPath, flowJson)).resolves.toBe(true);
    expect(readTextFileMock).toHaveBeenCalledWith("C:/flows/imported.reviewed");
  });

  it("returns false for missing, invalid, or stale reviewed sidecars", async () => {
    readTextFileMock.mockRejectedValueOnce(new Error("missing"));
    await expect(isFlowReviewed(flowPath, flowJson)).resolves.toBe(false);

    readTextFileMock.mockResolvedValueOnce("not json");
    await expect(isFlowReviewed(flowPath, flowJson)).resolves.toBe(false);

    readTextFileMock.mockResolvedValueOnce(JSON.stringify({ sha256: "stale" }));
    await expect(isFlowReviewed(flowPath, flowJson)).resolves.toBe(false);
  });

  it("marks a flow reviewed by writing the current content hash", async () => {
    await markFlowReviewed(flowPath, flowJson);

    const [, body] = writeTextFileMock.mock.calls[0];
    expect(writeTextFileMock).toHaveBeenCalledWith(
      "C:/flows/imported.reviewed",
      expect.any(String),
    );
    expect(JSON.parse(body as string)).toEqual({
      version: 1,
      sha256: await sha256Hex(flowJson),
    });
  });

  it("extracts URLs and selectors for review", () => {
    const flow: DonutFlowV1 = {
      version: 1,
      name: "review-me",
      variables: {},
      nodes: [
        {
          id: "open",
          type: "openUrl",
          params: { url: "https://example.com/path" },
        },
        {
          id: "click",
          type: "click",
          params: { selector: "#submit" },
        },
        {
          id: "templated",
          type: "openUrl",
          params: { url: "https://{{HOST}}/login", selector: "   " },
        },
        {
          id: "bad-url",
          type: "openUrl",
          params: { url: "not a url" },
        },
      ],
      edges: [],
    };

    expect(extractFlowReviewItems(flow)).toEqual([
      {
        nodeId: "open",
        type: "url",
        value: "https://example.com/path",
        host: "example.com",
      },
      { nodeId: "click", type: "selector", value: "#submit" },
      {
        nodeId: "templated",
        type: "url",
        value: "https://{{HOST}}/login",
        host: undefined,
      },
      {
        nodeId: "bad-url",
        type: "url",
        value: "not a url",
        host: undefined,
      },
    ]);
  });
});
