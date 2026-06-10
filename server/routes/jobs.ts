/**
 * Jobs API: GET / (list latest), GET /:id (job by id).
 * Returns Connect-style middleware (req, res, next).
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Job } from "../../lib/job-store.js";
import { respondJson } from "../helpers.js";
import type { SessionService } from "../route-services.js";

export interface JobsService {
  getLatestJob: (sessionId: string) => (Job & { id: string }) | null;
  getJob: (id: string) => Job | undefined;
}

export interface JobsRoutesOptions {
  session: SessionService;
  jobs: JobsService;
}

type Next = () => void;

export function jobsRoutes(options: JobsRoutesOptions) {
  const { session, jobs } = options;
  const { getLatestJob, getJob } = jobs;

  return function jobsMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): void {
    if (req.method !== "GET") {
      next();
      return;
    }
    const path = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";
    if (!path) {
      const sessionId = session.getSessionIdFromRequest(req);
      const latest = sessionId ? getLatestJob(sessionId) : null;
      respondJson(res, 200, latest ? { latest } : { latest: null });
      return;
    }
    const id = decodeURIComponent(path);
    const job = getJob(id);
    if (!job) {
      respondJson(res, 404, { error: "Job not found" });
      return;
    }
    respondJson(res, 200, job);
  };
}
