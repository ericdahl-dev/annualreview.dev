/**
 * Collect API: POST / - validate dates, get token from session or body, create job, run collect in background.
 * Returns Connect-style middleware (req, res, next).
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Evidence } from "../../types/evidence.js";
import {
  EvidenceIntakeError,
  intakeFromGitHub,
  parseTimeframe,
  resolveGitHubToken,
  type IntakeFromGitHubOptions,
} from "../../lib/evidence-intake.js";
import { readJsonBody, respondJson } from "../helpers.js";
import type { JobRunnerService, SessionService } from "../route-services.js";

export interface CollectService {
  intakeFromGitHub?: (opts: IntakeFromGitHubOptions) => Promise<Evidence>;
}

export interface CollectRoutesOptions {
  session: SessionService;
  jobs: JobRunnerService;
  collect?: CollectService;
}

type Next = () => void;

export function collectRoutes(options: CollectRoutesOptions) {
  const { session, jobs, collect = {} } = options;
  const { createJob, runInBackground } = jobs;
  const runIntake = collect.intakeFromGitHub ?? intakeFromGitHub;

  return async function collectMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    if (req.method !== "POST") {
      next();
      return;
    }
    try {
      const body = (await readJsonBody(req)) as {
        start_date?: string;
        end_date?: string;
        token?: string;
      };
      const sessionId = session.getSessionIdFromRequest(req);
      const userSession = sessionId ? session.getSession(sessionId) : undefined;
      let start_date: string;
      let end_date: string;
      let token: string;
      try {
        ({ start_date, end_date } = parseTimeframe(body.start_date, body.end_date));
        token = resolveGitHubToken({
          body: body.token,
          session: userSession?.access_token,
        });
      } catch (e) {
        if (e instanceof EvidenceIntakeError) {
          const status = e.message.includes("token") ? 401 : 400;
          respondJson(res, status, { error: e.message });
          return;
        }
        throw e;
      }
      const jobId = createJob("collect", sessionId ?? undefined);
      runInBackground(jobId, () =>
        runIntake({ token, start_date, end_date })
      );
      respondJson(res, 202, { job_id: jobId });
    } catch (e) {
      const err = e as Error;
      const msg = err.message || "";
      const status = msg.includes("401") || msg.includes("403") ? 401 : 500;
      respondJson(res, status, { error: msg || "Fetch failed" });
    }
  };
}
