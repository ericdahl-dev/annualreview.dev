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

import type { Evidence } from "../types/evidence.js";
import { getPool } from "./db.js";
import {
  filterSafeIds,
  mergeEvidenceHistory,
  SNAPSHOT_ID_PATTERN,
} from "./evidence-archive/merge.js";
import { isEvidenceArchiveConfigured } from "./evidence-archive/config.js";
import { contributionCount } from "./evidence-archive/json.js";
import type { SnapshotPeriod } from "./evidence-archive/period.js";
import { generateId } from "./id.js";

export type { SnapshotPeriod } from "./evidence-archive/period.js";

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
  const id = generateId("snap");
  const createdAt = new Date().toISOString();
  const count = contributionCount(evidence);

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
      count,
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
  const safeIds = filterSafeIds(ids, SNAPSHOT_ID_PATTERN);
  if (safeIds.length === 0) return null;
  const db = await getPool();

  const result = await db.query<{ evidence: Evidence; start_date: string; end_date: string }>(
    `SELECT evidence, start_date, end_date
     FROM contribution_snapshots
     WHERE user_login = $1 AND id = ANY($2::text[])
     ORDER BY start_date ASC`,
    [userLogin, safeIds]
  );

  return mergeEvidenceHistory(result.rows);
}

/** @deprecated Use isEvidenceArchiveConfigured from lib/evidence-archive. */
export function isSnapshotStoreConfigured(): boolean {
  return isEvidenceArchiveConfigured();
}

/** Reset the store (for tests). Removes all rows. */
export async function clearSnapshotStore(): Promise<void> {
  const db = await getPool();
  await db.query("DELETE FROM contribution_snapshots");
}

/** @deprecated Use resetPool from lib/db.ts instead. No-op; pool is managed centrally. */
export function resetPool(): void {
  // no-op: pool is now managed by lib/db.ts
}
