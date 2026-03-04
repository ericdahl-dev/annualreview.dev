/**
 * Postgres-backed credit store for Stripe-backed premium generations.
 *
 * Uses DATABASE_URL (Neon or any Postgres). Credits and idempotency for
 * Stripe webhooks are stored in two tables: credits, credit_events.
 *
 * Two tables:
 *   credits       – user_login → remaining credits
 *   credit_events – stripe_session_id → (user_login, awarded_at) for idempotency
 *                   (Stripe webhooks can fire more than once for the same event)
 *
 * Throws on first use if DATABASE_URL is not set.
 */

import type { Pool } from "pg";

/** Read at runtime so Vite dev (which copies .env after modules load) sees the correct value. */
export function getCreditsPerPurchase(): number {
  const envValue = process.env.CREDITS_PER_PURCHASE;
  if (envValue === undefined) return 5;
  const parsed = Number(envValue);
  if (!Number.isInteger(parsed) || parsed <= 0) return 5;
  return parsed;
}

let pool: Pool | null = null;

async function getPool(): Promise<Pool> {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the credit store");
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
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
    `);
  } finally {
    client.release();
  }
  return pool;
}

/**
 * Award CREDITS_PER_PURCHASE credits to a user.
 *
 * @param userLogin        GitHub login of the user receiving credits.
 * @param stripeSessionId  Stripe Checkout Session ID used as an idempotency key.
 *                         Prevents double-crediting if the Stripe webhook fires twice.
 */
export async function awardCredits(
  userLogin: string,
  stripeSessionId: string,
  count = getCreditsPerPurchase()
): Promise<void> {
  const db = await getPool();
  const awardedAt = new Date().toISOString();
  const insertEvent = await db.query(
    `INSERT INTO credit_events (stripe_session_id, user_login, awarded_at) VALUES ($1, $2, $3)
     ON CONFLICT (stripe_session_id) DO NOTHING`,
    [stripeSessionId, userLogin, awardedAt]
  );
  if (insertEvent.rowCount === 0) return; // already processed — idempotent

  const currentRow = await db.query<{ remaining: number }>(
    "SELECT remaining FROM credits WHERE user_login = $1",
    [userLogin]
  );
  const current = currentRow.rows[0]?.remaining ?? 0;
  await db.query(
    `INSERT INTO credits (user_login, remaining) VALUES ($1, $2)
     ON CONFLICT (user_login) DO UPDATE SET remaining = EXCLUDED.remaining`,
    [userLogin, current + count]
  );
}

/** Return how many credits remain for a user (0 if unknown). */
export async function getCredits(userLogin: string): Promise<number> {
  const db = await getPool();
  const row = await db.query<{ remaining: number }>(
    "SELECT remaining FROM credits WHERE user_login = $1",
    [userLogin]
  );
  return row.rows[0]?.remaining ?? 0;
}

/**
 * Attempt to consume one credit atomically. Returns true if a credit was deducted,
 * false if the user has no credits remaining.
 */
export async function deductCredit(userLogin: string): Promise<boolean> {
  const db = await getPool();
  const result = await db.query<{ remaining: number }>(
    `UPDATE credits SET remaining = remaining - 1
     WHERE user_login = $1 AND remaining > 0
     RETURNING remaining`,
    [userLogin]
  );
  return (result.rowCount ?? 0) > 0;
}

/** Reset the store (for tests). Clears all rows. */
export async function clearCreditStore(): Promise<void> {
  const db = await getPool();
  await db.query("DELETE FROM credits");
  await db.query("DELETE FROM credit_events");
}
