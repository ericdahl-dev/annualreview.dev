/**
 * Postgres-backed store for the hierarchical periodic summary system.
 *
 * Three levels of summaries, each building on the one below:
 *   daily   → raw evidence + brief AI bullets for a single calendar day
 *   weekly  → AI rollup synthesised from a week's daily summaries
 *   monthly → AI rollup synthesised from a month's weekly summaries
 *
 * The `period_key` for each type is:
 *   daily   → "YYYY-MM-DD"
 *   weekly  → "YYYY-WNN"  (ISO week, e.g. "2025-W03")
 *   monthly → "YYYY-MM"
 *
 * Uses DATABASE_URL (Neon or any Postgres).
 * Throws on first use if DATABASE_URL is not set.
 */

import type { Pool } from "pg";
import type { Evidence } from "../types/evidence.js";

export type PeriodType = "daily" | "weekly" | "monthly";

export interface PeriodicSummary {
  id: string;
  user_login: string;
  period_type: PeriodType;
  /** "YYYY-MM-DD" | "YYYY-WNN" | "YYYY-MM" */
  period_key: string;
  start_date: string;
  end_date: string;
  contribution_count: number;
  /** AI-generated summary (JSON string — parsed shape differs per period_type) */
  summary: string;
  /** IDs of child summaries that were rolled up into this one (null for daily) */
  child_ids: string[] | null;
  created_at: string;
}

export interface PeriodicSummaryWithEvidence extends PeriodicSummary {
  /** Only present for daily summaries */
  evidence: Evidence | null;
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the periodic store");
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS periodic_summaries (
        id                 TEXT PRIMARY KEY,
        user_login         TEXT NOT NULL,
        period_type        TEXT NOT NULL,
        period_key         TEXT NOT NULL,
        start_date         TEXT NOT NULL,
        end_date           TEXT NOT NULL,
        contribution_count INTEGER NOT NULL DEFAULT 0,
        summary            TEXT NOT NULL,
        child_ids          JSONB,
        evidence           JSONB,
        created_at         TEXT NOT NULL,
        UNIQUE(user_login, period_type, period_key)
      );
      CREATE INDEX IF NOT EXISTS idx_periodic_user_type
        ON periodic_summaries (user_login, period_type, period_key DESC);
    `);
  } finally {
    client.release();
  }
  return pool;
}

/** Derive ISO week key "YYYY-WNN" from a date string "YYYY-MM-DD". */
export function toWeekKey(date: string): string {
  const d = new Date(date + "T12:00:00Z"); // noon UTC avoids DST edge cases
  // Move to the Thursday of this week (ISO rule: week belongs to the year of its Thursday)
  const dayOfWeek = d.getUTCDay() || 7; // Sun=0 → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayOfWeek);
  // Now d is Thursday of the ISO week; its year is the ISO year
  const isoYear = d.getUTCFullYear();
  // Find the Monday of ISO week 1: the Monday of the week containing Jan 4
  const jan4 = new Date(Date.UTC(isoYear, 0, 4)); // Jan 4 is always in week 1
  const jan4DayOfWeek = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4DayOfWeek + 1);
  // Use Math.floor: d is at noon, week1Monday at midnight — floor avoids rounding across midnight
  const weekNum = Math.floor((d.getTime() - week1Monday.getTime()) / (7 * 86400000)) + 1;
  return `${isoYear}-W${String(weekNum).padStart(2, "0")}`;
}

/** Derive the Monday (start) of the ISO week containing `date`. */
export function weekStart(date: string): string {
  const d = new Date(date + "T12:00:00Z");
  const day = d.getUTCDay() || 7; // Sun=0 → 7
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

/**
 * Save or replace the daily summary for a calendar date.
 * If a summary already exists for this user+date it is overwritten (upsert).
 */
export async function saveDailySummary(
  userLogin: string,
  date: string,
  evidence: Evidence,
  summary: string
): Promise<string> {
  const db = await getPool();
  const id = `pday_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const contributionCount = Array.isArray(evidence.contributions)
    ? evidence.contributions.length
    : 0;

  await db.query(
    `INSERT INTO periodic_summaries
       (id, user_login, period_type, period_key, start_date, end_date,
        contribution_count, summary, child_ids, evidence, created_at)
     VALUES ($1,$2,'daily',$3,$4,$5,$6,$7,NULL,$8,$9)
     ON CONFLICT (user_login, period_type, period_key)
     DO UPDATE SET
       id                 = EXCLUDED.id,
       contribution_count = EXCLUDED.contribution_count,
       summary            = EXCLUDED.summary,
       evidence           = EXCLUDED.evidence,
       created_at         = EXCLUDED.created_at`,
    [
      id,
      userLogin,
      date,            // period_key
      date,            // start_date
      date,            // end_date
      contributionCount,
      summary,
      JSON.stringify(evidence),
      createdAt,
    ]
  );
  return id;
}

/**
 * Save or replace the weekly rollup for the ISO week containing `weekStartDate`.
 */
export async function saveWeeklyRollup(
  userLogin: string,
  weekStartDate: string,
  childIds: string[],
  summary: string,
  totalContributions: number
): Promise<string> {
  const db = await getPool();
  const id = `pwk_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const key = toWeekKey(weekStartDate);
  const end = weekEnd(weekStartDate);

  await db.query(
    `INSERT INTO periodic_summaries
       (id, user_login, period_type, period_key, start_date, end_date,
        contribution_count, summary, child_ids, evidence, created_at)
     VALUES ($1,$2,'weekly',$3,$4,$5,$6,$7,$8,NULL,$9)
     ON CONFLICT (user_login, period_type, period_key)
     DO UPDATE SET
       id                 = EXCLUDED.id,
       contribution_count = EXCLUDED.contribution_count,
       summary            = EXCLUDED.summary,
       child_ids          = EXCLUDED.child_ids,
       created_at         = EXCLUDED.created_at`,
    [
      id,
      userLogin,
      key,
      weekStartDate,
      end,
      totalContributions,
      summary,
      JSON.stringify(childIds),
      createdAt,
    ]
  );
  return id;
}

/**
 * Save or replace the monthly rollup for a calendar month (e.g. "2025-01").
 */
export async function saveMonthlyRollup(
  userLogin: string,
  month: string, // "YYYY-MM"
  childIds: string[],
  summary: string,
  totalContributions: number
): Promise<string> {
  const db = await getPool();
  const id = `pmo_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const startDate = `${month}-01`;
  // Last day of the month
  const lastDay = new Date(
    parseInt(month.slice(0, 4)),
    parseInt(month.slice(5, 7)),
    0
  );
  const endDate = `${month}-${String(lastDay.getDate()).padStart(2, "0")}`;

  await db.query(
    `INSERT INTO periodic_summaries
       (id, user_login, period_type, period_key, start_date, end_date,
        contribution_count, summary, child_ids, evidence, created_at)
     VALUES ($1,$2,'monthly',$3,$4,$5,$6,$7,$8,NULL,$9)
     ON CONFLICT (user_login, period_type, period_key)
     DO UPDATE SET
       id                 = EXCLUDED.id,
       contribution_count = EXCLUDED.contribution_count,
       summary            = EXCLUDED.summary,
       child_ids          = EXCLUDED.child_ids,
       created_at         = EXCLUDED.created_at`,
    [
      id,
      userLogin,
      month,
      startDate,
      endDate,
      totalContributions,
      summary,
      JSON.stringify(childIds),
      createdAt,
    ]
  );
  return id;
}

/**
 * Get a periodic summary by id.
 * Returns null if not found or if it belongs to a different user.
 * Includes evidence only for daily summaries.
 */
export async function getPeriodicSummary(
  id: string,
  userLogin: string
): Promise<PeriodicSummaryWithEvidence | null> {
  const db = await getPool();
  const result = await db.query<PeriodicSummaryWithEvidence>(
    `SELECT id, user_login, period_type, period_key, start_date, end_date,
            contribution_count, summary, child_ids, evidence, created_at
     FROM periodic_summaries
     WHERE id = $1 AND user_login = $2`,
    [id, userLogin]
  );
  const row = result.rows[0] ?? null;
  if (!row) return null;
  // Only expose evidence for daily entries
  if (row.period_type !== "daily") {
    row.evidence = null;
  }
  return row;
}

/**
 * List periodic summaries for a user.
 * Optionally filtered by period_type. Ordered by period_key DESC.
 * Does not include evidence payload.
 */
export async function listPeriodicSummaries(
  userLogin: string,
  periodType?: PeriodType,
  limit = 90
): Promise<PeriodicSummary[]> {
  const db = await getPool();
  const params: (string | number)[] = [userLogin, limit];
  const typeFilter = periodType ? `AND period_type = $3` : "";
  if (periodType) params.push(periodType);

  const result = await db.query<PeriodicSummary>(
    `SELECT id, user_login, period_type, period_key, start_date, end_date,
            contribution_count, summary, child_ids, created_at
     FROM periodic_summaries
     WHERE user_login = $1 ${typeFilter}
     ORDER BY period_key DESC
     LIMIT $2`,
    params
  );
  return result.rows;
}

/**
 * Retrieve all daily summaries for a specific week (by week start date).
 * Used to build the weekly rollup.
 */
export async function getDailySummariesForWeek(
  userLogin: string,
  weekStartDate: string
): Promise<PeriodicSummaryWithEvidence[]> {
  const db = await getPool();
  const end = weekEnd(weekStartDate);
  const result = await db.query<PeriodicSummaryWithEvidence>(
    `SELECT id, user_login, period_type, period_key, start_date, end_date,
            contribution_count, summary, child_ids, evidence, created_at
     FROM periodic_summaries
     WHERE user_login = $1 AND period_type = 'daily'
       AND period_key >= $2 AND period_key <= $3
     ORDER BY period_key ASC`,
    [userLogin, weekStartDate, end]
  );
  return result.rows;
}

/**
 * Retrieve all weekly summaries for a specific month (e.g. "2025-01").
 * A weekly summary is included if its week_start falls within the month.
 * Used to build the monthly rollup.
 */
export async function getWeeklySummariesForMonth(
  userLogin: string,
  month: string // "YYYY-MM"
): Promise<PeriodicSummary[]> {
  const db = await getPool();
  const startDate = `${month}-01`;
  const lastDay = new Date(
    parseInt(month.slice(0, 4)),
    parseInt(month.slice(5, 7)),
    0
  );
  const endDate = `${month}-${String(lastDay.getDate()).padStart(2, "0")}`;

  const result = await db.query<PeriodicSummary>(
    `SELECT id, user_login, period_type, period_key, start_date, end_date,
            contribution_count, summary, child_ids, created_at
     FROM periodic_summaries
     WHERE user_login = $1 AND period_type = 'weekly'
       AND start_date >= $2 AND start_date <= $3
     ORDER BY start_date ASC`,
    [userLogin, startDate, endDate]
  );
  return result.rows;
}

/**
 * Retrieve all monthly summaries for a specific year.
 * Used to build the annual review input.
 */
export async function getMonthlySummariesForYear(
  userLogin: string,
  year: string // "YYYY"
): Promise<PeriodicSummary[]> {
  const db = await getPool();
  const result = await db.query<PeriodicSummary>(
    `SELECT id, user_login, period_type, period_key, start_date, end_date,
            contribution_count, summary, child_ids, created_at
     FROM periodic_summaries
     WHERE user_login = $1 AND period_type = 'monthly'
       AND period_key LIKE $2
     ORDER BY period_key ASC`,
    [userLogin, `${year}-%`]
  );
  return result.rows;
}

/**
 * Delete a periodic summary by id.
 * Returns true if deleted, false if not found or not owned by user.
 */
export async function deletePeriodicSummary(
  id: string,
  userLogin: string
): Promise<boolean> {
  const db = await getPool();
  const result = await db.query(
    `DELETE FROM periodic_summaries WHERE id = $1 AND user_login = $2`,
    [id, userLogin]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Returns true when DATABASE_URL is configured. */
export function isPeriodicStoreConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Clear all rows (for tests). */
export async function clearPeriodicStore(): Promise<void> {
  const db = await getPool();
  await db.query("DELETE FROM periodic_summaries");
}

/** Reset pool (for tests). Forces fresh connection on next use. */
export function resetPeriodicPool(): void {
  pool = null;
}
