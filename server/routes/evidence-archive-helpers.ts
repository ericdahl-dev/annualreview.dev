/**
 * Shared route helpers for evidence archive endpoints (snapshots + periodic).
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SessionData } from "../../lib/session-store.js";
import { respondJson } from "../helpers.js";

export function createRequireLogin(
  req: IncomingMessage,
  res: ServerResponse,
  getSessionIdFromRequest: (req: IncomingMessage) => string | null,
  getSession: (id: string) => SessionData | undefined
): () => string | null {
  return () => {
    const sessId = getSessionIdFromRequest(req);
    const session = sessId ? getSession(sessId) : undefined;
    if (!session?.login) {
      respondJson(res, 401, { error: "Login required" });
      return null;
    }
    return session.login;
  };
}

export function requireEvidenceArchiveConfigured(
  res: ServerResponse,
  configured: boolean,
  featureLabel: "Snapshot store" | "Periodic store"
): boolean {
  if (configured) return true;
  respondJson(res, 503, {
    error: `${featureLabel} not configured (DATABASE_URL missing)`,
  });
  return false;
}

export async function readJsonBodyOrRespond400(
  req: IncomingMessage,
  res: ServerResponse,
  readJsonBody: (req: IncomingMessage) => Promise<object>
): Promise<Record<string, unknown> | null> {
  try {
    return (await readJsonBody(req)) as Record<string, unknown>;
  } catch {
    respondJson(res, 400, { error: "Invalid JSON body" });
    return null;
  }
}
