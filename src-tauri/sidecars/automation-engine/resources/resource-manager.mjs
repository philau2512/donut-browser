// ResourceManager — Phase 2 (resource allocation plan).
//
// Central coordinator for resource lease, quota, cooldown, write serialization
// and persistence. All allocation is synchronous within one engine process to
// guarantee atomicity (no race conditions between concurrent profile handlers).
//
// Public API:
//   manager.initialize(definitions, { flowDir, stateDir })
//   manager.allocate(profileId, runId, resourceName)  → string | null
//   manager.reportSuccess(profileId, runId)
//   manager.reportFail(profileId, runId)
//   manager.releaseAll(profileId, runId)
//   manager.writeOutput(profileId, runId, resourceName, data, mode)
//   manager.flush()   — persist all dirty state
//   manager.getReport()  — snapshot for Phase 4

import { loadResourceItems, selectCandidates } from "./resource-loader.mjs";
import {
  applyLease,
  applySuccess,
  applyFail,
  applyRelease,
  tickCooldown,
} from "./item-state-machine.mjs";
import {
  loadPersistedState,
  savePersistedState,
  mergePersistedState,
} from "./resource-persistence.mjs";
import { ResourceEventEmitter } from "./resource-event-emitter.mjs";
import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export class ResourceManager {
  constructor() {
    /**
     * Map<resourceId, ResourceDefinition>
     * @type {Map<string, object>}
     */
    this._defs = new Map();

    /**
     * Map<resourceId, Map<itemId, ResourceItemState>>
     * @type {Map<string, Map<string, object>>}
     */
    this._items = new Map();

    /**
     * Map<resourceName, resourceId> — lookup by user-facing name.
     * @type {Map<string, string>}
     */
    this._nameIndex = new Map();

    /**
     * Active leases per (profileId+runId): Map<leaseKey, resourceId[]>
     * @type {Map<string, string[]>}
     */
    this._profileLeases = new Map();

    /** Set of resourceIds with dirty state needing persist. */
    this._dirty = new Set();

    this._stateDir = null;
    this._flowDir = null;

    this.events = new ResourceEventEmitter();

    /**
     * Write queues per resourceId — serialize output writes.
     * Map<resourceId, Promise<void>>
     * @type {Map<string, Promise<void>>}
     */
    this._writeQueues = new Map();
  }

  // ─── Initialization ──────────────────────────────────────────────────────

  /**
   * Load and initialize all resource definitions for a flow run.
   *
   * @param {object[]} definitions - ResourceDefinition array from the flow.
   * @param {{ flowDir?: string, stateDir: string }} opts
   */
  async initialize(definitions, { flowDir, stateDir }) {
    this._flowDir = flowDir ?? ".";
    this._stateDir = stateDir;

    for (const def of definitions) {
      if (!def.id || !def.name) continue;

      this._defs.set(def.id, def);
      this._nameIndex.set(def.name.toLowerCase(), def.id);

      // Load items from source.
      const itemList = await loadResourceItems(def, this._flowDir);
      const itemMap = new Map(itemList.map((item) => [item.id, item]));

      // Restore persisted usage state (quota, exhausted/disabled).
      if (def.persistence?.preserveUsageAcrossRestart !== false) {
        const persisted = await loadPersistedState(stateDir, def.id);
        mergePersistedState(itemMap, persisted);
      }

      this._items.set(def.id, itemMap);
    }
  }

  // ─── Allocation ───────────────────────────────────────────────────────────

  /**
   * Allocate a resource item for a profile/run.
   * Returns the raw item value (line) on success, or null if no item is available.
   *
   * This is the critical section — synchronous filter+select+lease is atomic
   * within one engine process.
   *
   * @param {string} profileId
   * @param {string} runId
   * @param {string} resourceName
   * @returns {string | null}
   */
  allocate(profileId, runId, resourceName) {
    const def = this._getDefByName(resourceName);
    if (!def) return null;

    // output-only resources cannot be allocated as input.
    if (def.direction === "output") {
      return null;
    }

    const items = this._items.get(def.id);
    if (!items) return null;

    // Tick all cooldowns before candidate selection.
    for (const item of items.values()) {
      if (tickCooldown(item, def.limits)) this._dirty.add(def.id);
    }

    const candidates = [...items.values()];
    const selected = selectCandidates(candidates, def.mode, def.limits);
    if (selected.length === 0) {
      this.events.emit("resource-no-items-available", {
        resourceId: def.id,
        resourceName: def.name,
        profileId,
        runId,
      });
      return null;
    }

    const item = selected[0];
    applyLease(item, profileId, runId);
    this._dirty.add(def.id);

    // Track which resources this profile/run holds leases on.
    const key = _leaseKey(profileId, runId);
    if (!this._profileLeases.has(key)) this._profileLeases.set(key, []);
    this._profileLeases.get(key).push(def.id);

    this.events.emit("resource-allocate", {
      resourceId: def.id,
      resourceName: def.name,
      itemId: item.id,
      profileId,
      runId,
    });

    return item.line;
  }

  // ─── Success / Fail reporting ─────────────────────────────────────────────

  /**
   * Mark a profile/run as succeeded — updates successUsage for all active leases.
   *
   * @param {string} profileId
   * @param {string} runId
   */
  reportSuccess(profileId, runId) {
    this._forEachLeasedItem(profileId, runId, (item, def) => {
      applySuccess(item, profileId, runId, def.limits);
      this._dirty.add(def.id);

      const eventType =
        def.limits.maxSuccessUsage > 0 && item.successUsage >= def.limits.maxSuccessUsage
          ? "resource-exhausted"
          : item.status === "cooldown"
          ? "resource-cooldown"
          : "resource-success";

      this.events.emit(eventType, {
        resourceId: def.id,
        resourceName: def.name,
        itemId: item.id,
        profileId,
        runId,
      });
    });
    this._profileLeases.delete(_leaseKey(profileId, runId));
  }

  /**
   * Mark a profile/run as failed — updates failUsage for all active leases.
   *
   * @param {string} profileId
   * @param {string} runId
   */
  reportFail(profileId, runId) {
    this._forEachLeasedItem(profileId, runId, (item, def) => {
      applyFail(item, profileId, runId, def.limits);
      this._dirty.add(def.id);

      const eventType =
        def.limits.maxFailUsage > 0 && item.failUsage >= def.limits.maxFailUsage
          ? "resource-disabled"
          : item.status === "cooldown"
          ? "resource-cooldown"
          : "resource-fail";

      this.events.emit(eventType, {
        resourceId: def.id,
        resourceName: def.name,
        itemId: item.id,
        profileId,
        runId,
      });
    });
    this._profileLeases.delete(_leaseKey(profileId, runId));
  }

  /**
   * Release all active leases for a profile/run without recording success/fail.
   * Called when a run ends without hitting a Success/Fail node.
   *
   * @param {string} profileId
   * @param {string} runId
   */
  releaseAll(profileId, runId) {
    this._forEachLeasedItem(profileId, runId, (item, def) => {
      applyRelease(item, profileId, runId, def.limits.intervalBetweenUsageMs);
      this._dirty.add(def.id);
      this.events.emit("resource-release", {
        resourceId: def.id,
        resourceName: def.name,
        itemId: item.id,
        profileId,
        runId,
      });
    });
    this._profileLeases.delete(_leaseKey(profileId, runId));
  }

  // ─── Write-file output ────────────────────────────────────────────────────

  /**
   * Write data to an output/read-write resource.
   * Writes are serialized per resource to prevent concurrent corruption.
   *
   * @param {string} profileId
   * @param {string} runId
   * @param {string} resourceName
   * @param {string} data
   * @param {"append-line" | "overwrite" | "append-jsonl"} mode
   * @returns {Promise<void>}
   */
  async writeOutput(profileId, runId, resourceName, data, mode = "append-line") {
    const def = this._getDefByName(resourceName);
    if (!def) throw new Error(`ResourceManager: unknown resource '${resourceName}'`);
    if (def.direction === "input") {
      throw new Error(`ResourceManager: resource '${resourceName}' is input-only and cannot be written`);
    }
    if (!def.fileBehavior?.writeFile || !def.source?.path) {
      throw new Error(`ResourceManager: resource '${resourceName}' has no writable file path`);
    }

    this.events.emit("resource-write-start", {
      resourceId: def.id,
      resourceName: def.name,
      profileId,
      runId,
      extra: { mode },
    });

    // Serialize writes by chaining on the existing queue promise.
    const prev = this._writeQueues.get(def.id) ?? Promise.resolve();
    const next = prev.then(() => this._doWrite(def, profileId, runId, data, mode));
    this._writeQueues.set(def.id, next.catch(() => {})); // keep queue alive on error
    return next;
  }

  async _doWrite(def, profileId, runId, data, mode) {
    const filePath = def.source.path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(def.source.path)
      ? def.source.path
      : join(this._flowDir, def.source.path);

    try {
      await mkdir(filePath.replace(/[/\\][^/\\]+$/, ""), { recursive: true });

      let payload;
      if (mode === "append-jsonl") {
        payload = JSON.stringify({ ts: new Date().toISOString(), profileId, runId, data }) + "\n";
      } else if (mode === "overwrite") {
        // Overwrite handled via appendFile is intentionally not supported here;
        // caller should use writeFile directly for overwrite semantics.
        payload = data;
      } else {
        // append-line: ensure trailing newline
        payload = data.endsWith("\n") ? data : data + "\n";
      }

      await appendFile(filePath, payload, "utf-8");

      this.events.emit("resource-write-success", {
        resourceId: def.id,
        resourceName: def.name,
        profileId,
        runId,
        extra: { mode, bytes: Buffer.byteLength(payload) },
      });
    } catch (err) {
      this.events.emit("resource-write-fail", {
        resourceId: def.id,
        resourceName: def.name,
        profileId,
        runId,
        extra: { mode, error: err.message, retryable: false },
      });
      throw err;
    }
  }

  // ─── Persistence ──────────────────────────────────────────────────────────

  /**
   * Flush dirty resource state to disk.
   * Call at the end of each profile run and at flow run end.
   *
   * @returns {Promise<void>}
   */
  async flush() {
    if (!this._stateDir) return;
    const promises = [];
    for (const resourceId of this._dirty) {
      const items = this._items.get(resourceId);
      if (items) {
        promises.push(savePersistedState(this._stateDir, resourceId, items));
      }
    }
    await Promise.all(promises);
    this._dirty.clear();
  }

  // ─── Report snapshot ──────────────────────────────────────────────────────

  /**
   * Return a snapshot of resource state for Phase 4 report.
   *
   * @returns {object[]}
   */
  getReport() {
    const report = [];
    for (const [resourceId, def] of this._defs.entries()) {
      const items = [...(this._items.get(resourceId)?.values() ?? [])];
      report.push({
        resourceId,
        name: def.name,
        type: def.type,
        totalItems: items.length,
        availableItems: items.filter((i) => i.status === "available").length,
        leasedItems: items.filter((i) => i.status === "leased").length,
        cooldownItems: items.filter((i) => i.status === "cooldown").length,
        exhaustedItems: items.filter((i) => i.status === "exhausted").length,
        disabledItems: items.filter((i) => i.status === "disabled").length,
        successUsage: items.reduce((s, i) => s + i.successUsage, 0),
        failUsage: items.reduce((s, i) => s + i.failUsage, 0),
        activeLeases: items.flatMap((i) =>
          i.leases.map((l) => ({ itemId: i.id, ...l })),
        ),
      });
    }
    return report;
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────

  _getDefByName(resourceName) {
    const id = this._nameIndex.get(resourceName.toLowerCase());
    return id ? this._defs.get(id) : null;
  }

  /**
   * Iterate over all leased items for a profile/run.
   *
   * @param {string} profileId
   * @param {string} runId
   * @param {(item: object, def: object) => void} fn
   */
  _forEachLeasedItem(profileId, runId, fn) {
    const key = _leaseKey(profileId, runId);
    const resourceIds = this._profileLeases.get(key) ?? [];
    for (const resourceId of resourceIds) {
      const def = this._defs.get(resourceId);
      const items = this._items.get(resourceId);
      if (!def || !items) continue;
      for (const item of items.values()) {
        const hasLease = item.leases.some(
          (l) => l.profileId === profileId && l.runId === runId,
        );
        if (hasLease) fn(item, def);
      }
    }
  }
}

function _leaseKey(profileId, runId) {
  return `${profileId}::${runId}`;
}