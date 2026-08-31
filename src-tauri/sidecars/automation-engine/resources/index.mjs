// Resources module barrel — Phase 2.

export {
  applyFail,
  applyLease,
  applyRelease,
  applySuccess,
  canAllocate,
  tickCooldown,
} from "./item-state-machine.mjs";
export { ResourceEventEmitter } from "./resource-event-emitter.mjs";
export { loadResourceItems, selectCandidates } from "./resource-loader.mjs";
export { ResourceManager } from "./resource-manager.mjs";
export { deriveItemId } from "./resource-persistence.mjs";
