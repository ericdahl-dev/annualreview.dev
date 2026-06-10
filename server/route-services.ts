/**
 * Shared route-layer service objects injected into route modules.
 */

import type { IncomingMessage } from "http";
import type { SessionData } from "../lib/session-store.js";

export interface SessionService {
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => SessionData | undefined;
}

export interface JobRunnerService {
  createJob: (type: string, sessionId?: string) => string;
  runInBackground: (
    jobId: string,
    fn: (report?: (data: { progress?: string }) => void) => void | Promise<unknown>
  ) => void;
}
