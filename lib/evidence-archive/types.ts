export type {
  SnapshotPeriod,
  Snapshot,
  SnapshotWithEvidence,
} from "../snapshot-store.js";

export type {
  PeriodType,
  PeriodicSummary as PeriodicSummaryRecord,
  PeriodicSummaryWithEvidence,
} from "../periodic-store.js";

/** API/list shape after summary JSON is parsed for the client. */
export type PeriodicSummary = Omit<
  import("../periodic-store.js").PeriodicSummary,
  "summary"
> & { summary: unknown };

export type { ArchivePeriodType } from "./period.js";
