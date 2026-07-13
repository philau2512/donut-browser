// Resource item state machine — Phase 2 (resource allocation plan).
//
// Implements the canonical state transitions for a single resource item:
//
//   available → leased        (allocate, lease count < maxSimultaneousUse)
//   leased    → exhausted     (success, successUsage >= maxSuccessUsage)
//   leased    → cooldown      (success, below quota)
//   leased    → disabled      (fail, failUsage >= maxFailUsage)
//   leased    → cooldown      (fail, below quota)
//   leased    → available/cooldown (run-ended-without-result — release only)
//   cooldown  → available     (timer elapsed, quota not reached)
//   cooldown  → exhausted/disabled (timer elapsed, quota reached — defensive)
//   exhausted → exhausted     (never re-allocate)
//   disabled  → disabled      (never re-allocate)
//
// Precedence: quota > active lease limit > cooldown > selection strategy.

/**
 * @typedef {"available" | "leased" | "cooldown" | "exhausted" | "disabled"} ItemStatus
 *
 * @typedef {{
 *   profileId: string,
 *   runId: string,
 *   leasedAt: string
 * }} ItemLease
 *
 * @typedef {{
 *   id: string,
 *   resourceId: string,
 *   line: string,
 *   status: ItemStatus,
 *   leases: ItemLease[],
 *   successUsage: number,
 *   failUsage: number,
 *   lastUsedAt?: string,
 *   lockUntil?: string
 * }} ResourceItemState
 */

/** @param {ResourceItemState} item */
export function canAllocate(item, maxSimultaneousUse, maxSuccessUsage, maxFailUsage) {
  if (item.status === "exhausted" || item.status === "disabled") return false;
  if (maxSuccessUsage > 0 && item.successUsage >= maxSuccessUsage) return false;
  if (maxFailUsage > 0 && item.failUsage >= maxFailUsage) return false;
  if (item.leases.length >= maxSimultaneousUse) return false;
  if (item.status === "cooldown") {
    if (item.lockUntil && Date.now() < parseInt(item.lockUntil, 10)) return false;
    // Cooldown elapsed — recheck quota before marking available.
  }
  return true;
}

/**
 * Create a lease for profileId+runId on the item (mutates item).
 * Caller must ensure canAllocate() returned true.
 *
 * @param {ResourceItemState} item
 * @param {string} profileId
 * @param {string} runId
 */
export function applyLease(item, profileId, runId) {
  item.leases.push({ profileId, runId, leasedAt: new Date().toISOString() });
  item.status = "leased";
  item.lastUsedAt = new Date().toISOString();
}

/**
 * Report a success outcome for a lease. Mutates item.
 *
 * @param {ResourceItemState} item
 * @param {string} profileId
 * @param {string} runId
 * @param {{ maxSuccessUsage: number, intervalBetweenUsageMs: number }} limits
 */
export function applySuccess(item, profileId, runId, limits) {
  removeLease(item, profileId, runId);
  item.successUsage += 1;
  item.lastUsedAt = new Date().toISOString();

  if (limits.maxSuccessUsage > 0 && item.successUsage >= limits.maxSuccessUsage) {
    // Quota reached — exhausted immediately (quota > cooldown precedence).
    item.status = "exhausted";
    item.lockUntil = undefined;
  } else if (item.leases.length === 0) {
    enterCooldownOrAvailable(item, limits.intervalBetweenUsageMs);
  }
}

/**
 * Report a fail outcome for a lease. Mutates item.
 *
 * @param {ResourceItemState} item
 * @param {string} profileId
 * @param {string} runId
 * @param {{ maxFailUsage: number, intervalBetweenUsageMs: number }} limits
 */
export function applyFail(item, profileId, runId, limits) {
  removeLease(item, profileId, runId);
  item.failUsage += 1;
  item.lastUsedAt = new Date().toISOString();

  if (limits.maxFailUsage > 0 && item.failUsage >= limits.maxFailUsage) {
    // Fail quota reached — disabled immediately.
    item.status = "disabled";
    item.lockUntil = undefined;
  } else if (item.leases.length === 0) {
    enterCooldownOrAvailable(item, limits.intervalBetweenUsageMs);
  }
}

/**
 * Release a lease without recording a success or fail result.
 * Used when a profile run ends without hitting a Success/Fail node.
 * Does NOT increment usage counters.
 *
 * @param {ResourceItemState} item
 * @param {string} profileId
 * @param {string} runId
 * @param {number} intervalBetweenUsageMs
 */
export function applyRelease(item, profileId, runId, intervalBetweenUsageMs) {
  removeLease(item, profileId, runId);
  if (item.leases.length === 0 && item.status === "leased") {
    enterCooldownOrAvailable(item, intervalBetweenUsageMs);
  }
}

/**
 * Tick cooldown timers — call periodically or before allocation.
 * Returns true if the item's status changed.
 *
 * @param {ResourceItemState} item
 * @param {{ maxSuccessUsage: number, maxFailUsage: number }} limits
 */
export function tickCooldown(item, limits) {
  if (item.status !== "cooldown") return false;
  if (!item.lockUntil || Date.now() < parseInt(item.lockUntil, 10)) return false;

  // Cooldown elapsed — defensive quota recheck.
  if (limits.maxSuccessUsage > 0 && item.successUsage >= limits.maxSuccessUsage) {
    item.status = "exhausted";
  } else if (limits.maxFailUsage > 0 && item.failUsage >= limits.maxFailUsage) {
    item.status = "disabled";
  } else {
    item.status = "available";
  }
  item.lockUntil = undefined;
  return true;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function removeLease(item, profileId, runId) {
  item.leases = item.leases.filter(
    (l) => !(l.profileId === profileId && l.runId === runId),
  );
}

function enterCooldownOrAvailable(item, intervalMs) {
  if (intervalMs > 0) {
    item.status = "cooldown";
    item.lockUntil = String(Date.now() + intervalMs);
  } else {
    item.status = "available";
    item.lockUntil = undefined;
  }
}