// Resource item loader — Phase 2 (resource allocation plan).
//
// Expands a ResourceDefinition into a list of ResourceItemState objects.
// Supports two source kinds:
//   "static"  — inlineItems array from the definition.
//   "file"    — reads line-by-line from disk (one item per non-empty line).
//
// Each item gets a stable itemId derived from resourceId + sourcePath + lineValue.
// This itemId is the key for persistence and quota tracking across restarts.

import { readFile } from "node:fs/promises";
import { canAllocate } from "./item-state-machine.mjs";
import { deriveItemId } from "./resource-persistence.mjs";

/**
 * Load resource items from a definition.
 *
 * @param {import("../lib/token-parser.mjs") & object} _unused
 * @param {{ id: string, source: { kind: string, path?: string, inlineItems?: string[] } }} definition
 * @param {string} [flowDir] - Base directory for resolving relative file paths.
 * @returns {Promise<import("./item-state-machine.mjs").ResourceItemState[]>}
 */
export async function loadResourceItems(definition, flowDir) {
  const { id: resourceId, source } = definition;
  let lines = [];
  let sourcePath = "";

  if (source.kind === "file") {
    if (!source.path || source.path.trim() === "") {
      throw new Error(
        `ResourceLoader: file path is missing or empty for resource '${resourceId}'`,
      );
    }
    if (definition.fileBehavior && definition.fileBehavior.readFile === false) {
      return [];
    }
    const absPath =
      source.path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(source.path)
        ? source.path
        : `${flowDir ?? "."}/${source.path}`;
    sourcePath = absPath;
    try {
      const raw = await readFile(absPath, "utf-8");
      lines = raw
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
    } catch (err) {
      throw new Error(
        `ResourceLoader: cannot read resource file '${absPath}': ${err.message}`,
      );
    }
  } else if (source.kind === "static") {
    lines = (source.inlineItems ?? [])
      .map((l) => String(l).trim())
      .filter(Boolean);
    sourcePath = `static:${resourceId}`;
  } else {
    throw new Error(
      `ResourceLoader: unsupported source kind '${source.kind}' for resource '${resourceId}'`,
    );
  }

  return lines.map((line) => {
    const itemId = deriveItemId(resourceId, sourcePath, line);
    return {
      id: itemId,
      resourceId,
      line,
      status: "available",
      leases: [],
      successUsage: 0,
      failUsage: 0,
      lastUsedAt: undefined,
      lockUntil: undefined,
    };
  });
}

/**
 * Apply a selection strategy to filter and order candidate items.
 *
 * @param {import("./item-state-machine.mjs").ResourceItemState[]} candidates
 * @param {{ selection: string, greedy: boolean }} mode
 * @param {{ maxSimultaneousUse: number, maxSuccessUsage: number, maxFailUsage: number }} limits
 * @returns {import("./item-state-machine.mjs").ResourceItemState[]}
 */
export function selectCandidates(candidates, mode, limits) {
  const eligible = candidates.filter((item) =>
    canAllocate(
      item,
      limits.maxSimultaneousUse,
      limits.maxSuccessUsage,
      limits.maxFailUsage,
    ),
  );

  if (eligible.length === 0) return [];

  if (mode.greedy) {
    // Greedy: first usable item in declaration order.
    return [eligible[0]];
  }

  switch (mode.selection) {
    case "random":
    case "mix": {
      // Shuffle and return all eligible (caller takes first).
      const shuffled = [...eligible];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }
    case "rotate":
    case "sequential":
    default:
      // Return in declaration order; caller picks first.
      return eligible;
  }
}
