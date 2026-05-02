/**
 * Postgres-backed store for periodic contribution snapshots.
 *
 * Allows users to save dated snapshots of their normalized evidence (daily/weekly/monthly),
 * list and delete them, and merge multiple snapshots into a combined evidence object for
 * generating a rolled-up annual review.
 *
 * Uses DATABASE_URL (Neon or any Postgres). Snapshot data is stored in the
 * `contribution_snapshots` table.
 *
 * Throws on first use if DATABASE_URL is not set.
 */

import type { Pool } from "pg";
import type { Evidence, Contribution } from "../types/evidence.js";

export type SnapshotPeriod = "daily" | "weekly" | "monthly" | "custom";

export interface Snapshot {
  id: string;
  user_login: string;
  period: SnapshotPeriod;
  start_date: string;
  end_date: string;
  label: string | null;
  contribution_count: number;
  created_at: string;
}

export interface SnapshotWithEvidence extends Snapshot {
  evidence: Evidence;
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the snapshot store");
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS contribution_snapshots (
        id                 TEXT PRIMARY KEY,
        user_login         TEXT NOT NULL,
        period             TEXT NOT NULL,
        start_date         TEXT NOT NULL,
        end_date           TEXT NOT NULL,
        label              TEXT,
        contribution_count INTEGER NOT NULL DEFAULT 0,
        evidence           JSONB NOT NULL,
        created_at         TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_snapshots_user_login
        ON contribution_snapshots (user_login, created_at DESC);
    `);
  } finally {
    client.release();
  }
  return pool;
}

/**
 * Save a new contribution snapshot for a user.
 * Returns the generated snapshot id.
 */
export async function saveSnapshot(
  userLogin: string,
  period: SnapshotPeriod,
  startDate: string,
  endDate: string,
  evidence: Evidence,
  label?: string
): Promise<string> {
  const db = await getPool();
  const id = `snap_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const createdAt = new Date().toISOString();
  const contributionCount = Array.isArray(evidence.contributions)
    ? evidence.contributions.length
    : 0;

  await db.query(
    `INSERT INTO contribution_snapshots
       (id, user_login, period, start_date, end_date, label, contribution_count, evidence, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      id,
      userLogin,
      period,
      startDate,
      endDate,
      label ?? null,
      contributionCount,
      JSON.stringify(evidence),
      createdAt,
    ]
  );

  return id;
}

/**
 * List all snapshots for a user, ordered newest first.
 * Does not include the full evidence payload — use getSnapshot for that.
 */
export async function listSnapshots(userLogin: string): Promise<Snapshot[]> {
  const db = await getPool();
  const result = await db.query<Snapshot>(
    `SELECT id, user_login, period, start_date, end_date, label, contribution_count, created_at
     FROM contribution_snapshots
     WHERE user_login = $1
     ORDER BY created_at DESC`,
    [userLogin]
  );
  return result.rows;
}

/**
 * Get a single snapshot including its evidence payload.
 * Returns null if not found or if it belongs to a different user.
 */
export async function getSnapshot(
  id: string,
  userLogin: string
): Promise<SnapshotWithEvidence | null> {
  const db = await getPool();
  const result = await db.query<SnapshotWithEvidence>(
    `SELECT id, user_login, period, start_date, end_date, label, contribution_count, evidence, created_at
     FROM contribution_snapshots
     WHERE id = $1 AND user_login = $2`,
    [id, userLogin]
  );
  return result.rows[0] ?? null;
}

/**
 * Delete a snapshot by id. Only deletes if it belongs to the given user.
 * Returns true if a row was deleted, false otherwise.
 */
export async function deleteSnapshot(
  id: string,
  userLogin: string
): Promise<boolean> {
  const db = await getPool();
  const result = await db.query(
    `DELETE FROM contribution_snapshots WHERE id = $1 AND user_login = $2`,
    [id, userLogin]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Merge multiple snapshots into a single combined evidence object.
 * Deduplicates contributions by id, uses the earliest start_date and latest end_date,
 * and preserves role_context_optional from the first snapshot.
 *
 * Returns null if no snapshots were found for this user.
 */
export async function mergeSnapshots(
  ids: string[],
  userLogin: string
): Promise<Evidence | null> {
  if (ids.length === 0) return null;
  const db = await getPool();

  // Use a parameterized ANY query to fetch in one round-trip
  const placeholders = ids.map((_, i) => `$${i + 2}`).join(", ");
  const result = await db.query<{ evidence: Evidence; start_date: string; end_date: string }>(
    `SELECT evidence, start_date, end_date
     FROM contribution_snapshots
     WHERE user_login = $1 AND id = ANY(ARRAY[${placeholders}]::text[])
     ORDER BY start_date ASC`,
    [userLogin, ...ids]
  );

  if (result.rows.length === 0) return null;

  const seen = new Set<string>();
  const merged: Contribution[] = [];
  let earliest = result.rows[0].start_date;
  let latest = result.rows[0].end_date;
  let roleContext: unknown = undefined;

  for (const row of result.rows) {
    const ev = row.evidence;
    if (roleContext === undefined) roleContext = ev.role_context_optional;
    if (row.start_date < earliest) earliest = row.start_date;
    if (row.end_date > latest) latest = row.end_date;
    for (const c of ev.contributions ?? []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
  }

  const combined: Evidence = {
    timeframe: { start_date: earliest, end_date: latest },
    contributions: merged,
  };
  if (roleContext !== undefined) {
    combined.role_context_optional = roleContext;
  }
  return combined;
}

/** Returns true when DATABASE_URL is configured so the snapshot store can be used. */
export function isSnapshotStoreConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Reset the store (for tests). Removes all rows. */
export async function clearSnapshotStore(): Promise<void> {
  const db = await getPool();
  await db.query("DELETE FROM contribution_snapshots");
}

/** Reset the pool (for tests). Forces a fresh connection on next use. */
export function resetPool(): void {
  pool = null;
}
