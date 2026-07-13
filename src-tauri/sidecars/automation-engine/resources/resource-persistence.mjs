// Resource usage state persistence — Phase 2 (resource allocation plan).
//
// Persisted per: resourceId + source fingerprint + item identity hash.
// Rules:
//   - Persisted fields: successUsage, failUsage, status (exhausted/disabled), lastUsedAt.
//   - NOT persisted: active leases (cleared on restart).
//   - Transient cooldown is NOT persisted by default.
//
// Storage format: a single JSON file per resource definition, keyed by itemId.
// File path: <artifactsDir>/resource-state/<resourceId>.json

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";

/** Derive a stable item identity hash from resourceId + sourcePath + lineValue. */
export function deriveItemId(resourceId, sourcePath, lineValue) {
  const input = `${resourceId}::${sourcePath ?? ""}::${lineValue}`;
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

/**
 * Compute the persistence file path for a resource.
 *
 * @param {string} stateDir - Base directory for resource state files.
 * @param {string} resourceId
 * @returns {string}
 */
function statePath(stateDir, resourceId) {
  // Sanitise resourceId to a safe filename segment.
  const safe = resourceId.replace(/[^A-Za-z0-9_-]/g, "_");
  return join(stateDir, `${safe}.json`);
}

/**
 * Load persisted usage state for a resource.
 * Returns an empty map if the file does not exist or is malformed.
 *
 * @param {string} stateDir
 * @param {string} resourceId
 * @returns {Promise<Map<string, { successUsage: number, failUsage: number, status: string, lastUsedAt?: string }>>}
 */
export async function loadPersistedState(stateDir, resourceId) {
  const map = new Map();
  try {
    const raw = await readFile(statePath(stateDir, resourceId), "utf-8");
    const obj = JSON.parse(raw);
    for (const [itemId, data] of Object.entries(obj)) {
      if (data && typeof data === "object") {
        map.set(itemId, {
          successUsage: Number(data.successUsage) || 0,
          failUsage: Number(data.failUsage) || 0,
          // Only restore terminal/quota states; available/leased/cooldown reset to available.
          status: data.status === "exhausted" || data.status === "disabled" ? data.status : "available",
          lastUsedAt: typeof data.lastUsedAt === "string" ? data.lastUsedAt : undefined,
        });
      }
    }
  } catch {
    // File missing or malformed — start fresh.
  }
  return map;
}

/**
 * Persist usage state for all items in a resource.
 * Only writes fields relevant to quota; active leases are excluded.
 *
 * @param {string} stateDir
 * @param {string} resourceId
 * @param {Map<string, import("./item-state-machine.mjs").ResourceItemState>} items
 */
export async function savePersistedState(stateDir, resourceId, items) {
  await mkdir(stateDir, { recursive: true });
  const obj = {};
  for (const [itemId, item] of items.entries()) {
    obj[itemId] = {
      successUsage: item.successUsage,
      failUsage: item.failUsage,
      // Only persist terminal/quota-relevant statuses.
      status: item.status === "exhausted" || item.status === "disabled" ? item.status : "available",
      lastUsedAt: item.lastUsedAt,
    };
  }
  await writeFile(statePath(stateDir, resourceId), JSON.stringify(obj, null, 2), "utf-8");
}

/**
 * Merge persisted state into a freshly-loaded item map.
 * Active leases from the persisted state are intentionally dropped (restart recovery).
 *
 * @param {Map<string, import("./item-state-machine.mjs").ResourceItemState>} items
 * @param {Map<string, { successUsage: number, failUsage: number, status: string, lastUsedAt?: string }>} persisted
 */
export function mergePersistedState(items, persisted) {
  for (const [itemId, item] of items.entries()) {
    const saved = persisted.get(itemId);
    if (!saved) continue;
    item.successUsage = saved.successUsage;
    item.failUsage = saved.failUsage;
    if (saved.status === "exhausted" || saved.status === "disabled") {
      item.status = saved.status;
    }
    if (saved.lastUsedAt) item.lastUsedAt = saved.lastUsedAt;
    // Always clear leases on restore.
    item.leases = [];
    item.lockUntil = undefined;
  }
}