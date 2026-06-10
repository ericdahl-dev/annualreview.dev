/**
 * Snapshot adapter over the evidence archive seam.
 */
export {
  saveSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  mergeSnapshots,
  clearSnapshotStore,
  isSnapshotStoreConfigured,
  type Snapshot,
  type SnapshotWithEvidence,
  type SnapshotPeriod,
} from "../snapshot-store.js";
