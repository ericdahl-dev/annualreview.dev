/**
 * Evidence archive — shared seam for user-scoped dated evidence history.
 *
 * Snapshots and periodic summaries are adapters over this module's config,
 * period, merge, and JSON utilities.
 */

export {
  DATE_YYYY_MM_DD,
  MONTH_YYYY_MM,
  ARCHIVE_PERIOD_TYPES,
  SNAPSHOT_PERIODS,
  PERIODIC_PERIOD_TYPES,
  toWeekKey,
  weekStart,
  weekEnd,
  type ArchivePeriodType,
  type SnapshotPeriod,
} from "./period.js";

export {
  mergeEvidenceHistory,
  filterSafeIds,
  SNAPSHOT_ID_PATTERN,
  type EvidenceHistoryRow,
} from "./merge.js";

export { tryParseJson, contributionCount } from "./json.js";

export { isEvidenceArchiveConfigured } from "./config.js";

export * as snapshots from "./snapshots-adapter.js";
export * as periodic from "./periodic-adapter.js";

export async function clearEvidenceArchiveForTests(): Promise<void> {
  const [{ clearSnapshotStore }, { clearPeriodicStore }] = await Promise.all([
    import("../snapshot-store.js"),
    import("../periodic-store.js"),
  ]);
  await clearSnapshotStore();
  await clearPeriodicStore();
}
