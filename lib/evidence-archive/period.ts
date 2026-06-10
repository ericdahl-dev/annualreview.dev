/**
 * Shared period and calendar helpers for dated evidence history.
 */

export const DATE_YYYY_MM_DD = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_YYYY_MM = /^\d{4}-\d{2}$/;

export const ARCHIVE_PERIOD_TYPES = ["daily", "weekly", "monthly"] as const;
export type ArchivePeriodType = (typeof ARCHIVE_PERIOD_TYPES)[number];
export type SnapshotPeriod = ArchivePeriodType | "custom";

export const SNAPSHOT_PERIODS = new Set<string>([...ARCHIVE_PERIOD_TYPES, "custom"]);
export const PERIODIC_PERIOD_TYPES = new Set<string>(ARCHIVE_PERIOD_TYPES);

const MS_PER_DAY = 86400000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

/** Derive ISO week key "YYYY-WNN" from a date string "YYYY-MM-DD". */
export function toWeekKey(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const dayOfWeek = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  const isoYear = d.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4DayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek + 1);
  const weekNum = Math.floor((d.getTime() - week1Monday.getTime()) / MS_PER_WEEK) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

/** Derive the Monday (start) of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d.toISOString().slice(0, 10);
}

/** Derive the Sunday (end) of the ISO week containing `date`. */
export function weekEnd(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + (7 - day));
  return d.toISOString().slice(0, 10);
}
