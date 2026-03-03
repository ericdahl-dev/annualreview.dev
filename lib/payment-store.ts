/**
 * SQLite-backed credit store for Stripe-backed premium generations.
 *
 * Why a database? Credits are purchased with real money — losing them on a
 * server restart would be unacceptable. SQLite is zero-ops (just a file) and
 * perfect for a single-server deployment.
 *
 * Two tables:
 *   credits       – user_login → remaining credits
 *   credit_events – stripe_session_id → (user_login, awarded_at) for idempotency
 *                   (Stripe webhooks can fire more than once for the same event)
 *
 * CREDITS_DB_PATH env var controls where the file lives. Defaults to ./credits.db
 * in production and :memory: in test (NODE_ENV=test).
 *
 * ⚠️  Docker / Coolify: the default ./credits.db path is inside the container and
 * will be wiped on redeployment. Mount a persistent volume and set CREDITS_DB_PATH
 * to a path inside it — e.g. CREDITS_DB_PATH=/data/credits.db with the volume
 * mounted at /data. See the server.ts header for a full Coolify example.
 */

import Database from "better-sqlite3";
import { join } from "path";

export const CREDITS_PER_PURCHASE = Number(process.env.CREDITS_PER_PURCHASE) || 5;

const DB_PATH =
  process.env.CREDITS_DB_PATH ??
  (process.env.NODE_ENV === "test" ? ":memory:" : join(process.cwd(), "credits.db"));

let db = openDb(DB_PATH);

function openDb(path: string): Database.Database {
  const instance = new Database(path);
  instance.exec(`
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
  return instance;
}

const stmtGetCredits = () =>
  db.prepare<[string], { remaining: number }>(
    "SELECT remaining FROM credits WHERE user_login = ?"
  );

const stmtUpsertCredits = () =>
  db.prepare<[string, number]>(
    `INSERT INTO credits (user_login, remaining) VALUES (?, ?)
     ON CONFLICT(user_login) DO UPDATE SET remaining = excluded.remaining`
  );

const stmtInsertEvent = () =>
  db.prepare<[string, string, string]>(
    "INSERT OR IGNORE INTO credit_events (stripe_session_id, user_login, awarded_at) VALUES (?, ?, ?)"
  );

/**
 * Award CREDITS_PER_PURCHASE credits to a user.
 *
 * @param userLogin        GitHub login of the user receiving credits.
 * @param stripeSessionId  Stripe Checkout Session ID used as an idempotency key.
 *                         Prevents double-crediting if the Stripe webhook fires twice.
 */
export function awardCredits(
  userLogin: string,
  stripeSessionId: string,
  count = CREDITS_PER_PURCHASE
): void {
  const awardedAt = new Date().toISOString();
  const result = stmtInsertEvent().run(stripeSessionId, userLogin, awardedAt);
  if (result.changes === 0) return; // already processed — idempotent

  const current = stmtGetCredits().get(userLogin)?.remaining ?? 0;
  stmtUpsertCredits().run(userLogin, current + count);
}

/** Return how many credits remain for a user (0 if unknown). */
export function getCredits(userLogin: string): number {
  return stmtGetCredits().get(userLogin)?.remaining ?? 0;
}

/**
 * Attempt to consume one credit. Returns true if a credit was deducted,
 * false if the user has no credits remaining.
 */
export function deductCredit(userLogin: string): boolean {
  const remaining = getCredits(userLogin);
  if (remaining <= 0) return false;
  stmtUpsertCredits().run(userLogin, remaining - 1);
  return true;
}

/** Reset the store (for tests). Clears all rows without closing the DB. */
export function clearCreditStore(): void {
  db.exec("DELETE FROM credits; DELETE FROM credit_events;");
}

// ---------------------------------------------------------------------------
// Legacy aliases kept while callers migrate to user-login-based API.
// ---------------------------------------------------------------------------
/** @deprecated Use awardCredits(userLogin, stripeSessionId) */
export function markSessionPaid(sessionId: string): void {
  awardCredits(sessionId, `legacy_${sessionId}`);
}
/** @deprecated Use getCredits(userLogin) > 0 */
export function isSessionPaid(sessionId: string): boolean {
  return getCredits(sessionId) > 0;
}
/** @deprecated Use clearCreditStore() */
export const clearPaymentStore = clearCreditStore;
