// Resource event emitter — Phase 2 / Phase 4 bridge.
//
// ResourceManager emits structured events so the report layer (Phase 4) can
// aggregate them without reaching into ResourceManager internals.
// Events are emitted synchronously via a simple pub/sub. The engine bridges
// them to the Tauri frontend via stdout JSON-lines (Phase 4 wiring).

/**
 * @typedef {"resource-allocate"
 *   | "resource-release"
 *   | "resource-success"
 *   | "resource-fail"
 *   | "resource-cooldown"
 *   | "resource-exhausted"
 *   | "resource-disabled"
 *   | "resource-write-start"
 *   | "resource-write-success"
 *   | "resource-write-fail"
 *   | "resource-no-items-available"
 * } ResourceEventType
 *
 * @typedef {{
 *   type: ResourceEventType,
 *   resourceId: string,
 *   resourceName?: string,
 *   itemId?: string,
 *   profileId?: string,
 *   runId?: string,
 *   ts: string,
 *   extra?: Record<string, unknown>
 * }} ResourceEvent
 */

export class ResourceEventEmitter {
  constructor() {
    /** @type {Map<string, Array<(e: ResourceEvent) => void>>} */
    this._listeners = new Map();
  }

  /**
   * Subscribe to events of a given type (or "*" for all).
   *
   * @param {ResourceEventType | "*"} eventType
   * @param {(e: ResourceEvent) => void} handler
   * @returns {() => void} unsubscribe function
   */
  on(eventType, handler) {
    if (!this._listeners.has(eventType)) this._listeners.set(eventType, []);
    this._listeners.get(eventType).push(handler);
    return () => {
      const list = this._listeners.get(eventType) ?? [];
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /**
   * Emit a resource event.
   *
   * @param {ResourceEventType} type
   * @param {Omit<ResourceEvent, "type" | "ts">} payload
   */
  emit(type, payload) {
    /** @type {ResourceEvent} */
    const event = { type, ts: new Date().toISOString(), ...payload };
    const specific = this._listeners.get(type) ?? [];
    const wildcard = this._listeners.get("*") ?? [];
    for (const handler of [...specific, ...wildcard]) {
      try {
        handler(event);
      } catch {
        /* listener errors must not crash the engine */
      }
    }
  }
}
