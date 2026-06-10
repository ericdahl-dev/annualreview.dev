/**
 * Periodic summary adapter over the evidence archive seam.
 */
export {
  saveDailySummary,
  saveWeeklyRollup,
  saveMonthlyRollup,
  getPeriodicSummary,
  listPeriodicSummaries,
  getDailySummariesForWeek,
  getWeeklySummariesForMonth,
  getMonthlySummariesForYear,
  deletePeriodicSummary,
  clearPeriodicStore,
  isPeriodicStoreConfigured,
  type PeriodType,
  type PeriodicSummary,
  type PeriodicSummaryWithEvidence,
} from "../periodic-store.js";

export { toWeekKey, weekStart, weekEnd } from "./period.js";
