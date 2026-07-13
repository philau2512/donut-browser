// Resources module barrel — Phase 2.
export { ResourceManager } from "./resource-manager.mjs";
export { ResourceEventEmitter } from "./resource-event-emitter.mjs";
export { deriveItemId } from "./resource-persistence.mjs";
export { loadResourceItems, selectCandidates } from "./resource-loader.mjs";
export {
  canAllocate,
  applyLease,
  applySuccess,
  applyFail,
  applyRelease,
  tickCooldown,
} from "./item-state-machine.mjs";