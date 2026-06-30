import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { DonutFlowV1 } from "@/components/automation/editor/serialize";

export interface FlowReviewItem {
  nodeId: string;
  type: "url" | "selector";
  value: string;
  host?: string;
}

export function reviewedPathForFlow(flowPath: string): string {
  return flowPath.replace(/\.donutflow$/i, ".reviewed");
}

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function isFlowReviewed(
  flowPath: string,
  flowJson: string,
): Promise<boolean> {
  try {
    const expected = await sha256Hex(flowJson);
    const raw = await readTextFile(reviewedPathForFlow(flowPath));
    const parsed = JSON.parse(raw) as { sha256?: string };
    return parsed.sha256 === expected;
  } catch {
    return false;
  }
}

export async function markFlowReviewed(
  flowPath: string,
  flowJson: string,
): Promise<void> {
  const sha256 = await sha256Hex(flowJson);
  await invoke("mark_automation_flow_reviewed", { path: flowPath, sha256 });
}

export function extractFlowReviewItems(flow: DonutFlowV1): FlowReviewItem[] {
  const items: FlowReviewItem[] = [];
  for (const node of flow.nodes) {
    const params = node.params ?? {};
    if (node.type === "openUrl" && typeof params.url === "string") {
      items.push({
        nodeId: node.id,
        type: "url",
        value: params.url,
        host: safeHost(params.url),
      });
    }
    for (const [key, value] of Object.entries(params)) {
      if (key === "selector" && typeof value === "string" && value.trim()) {
        items.push({ nodeId: node.id, type: "selector", value });
      }
    }
  }
  return items;
}

function safeHost(url: string): string | undefined {
  if (url.includes("{{")) return undefined;
  try {
    return new URL(url).host;
  } catch {
    return undefined;
  }
}
