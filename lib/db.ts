/**
 * Shared Postgres pool and migrations for all stores.
 *
 * All stores import getPool() from here rather than creating their own Pool.
 * Call runMigrations() once at server startup to create tables.
 *
 * Uses DATABASE_URL (Neon or any Postgres).
 */

import type { Pool } from "pg";

let pool: Pool | null = null;

/** Returns true when DATABASE_URL is configured. */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/**
 * Returns the shared Pool, creating it on first call.
 * Throws if DATABASE_URL is not set.
 */
export async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: url });
  return pool;
}

/**
 * Create all tables if they do not exist.
 * Call once at server startup — not in the request hot-path.
 */
export async function runMigrations(): Promise<void> {
  const db = await getPool();
  const client = await db.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS credits (
        user_login TEXT PRIMARY KEY,
        remaining  INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS credit_events (
        stripe_session_id TEXT PRIMARY KEY,
        user_login        TEXT NOT NULL,
        awarded_at        TEXT NOT NULL
      );
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
}

/** Reset the pool (for tests). Forces a fresh connection on next use. */
export function resetPool(): void {
  pool = null;
}
