/**
 * Jobs API: GET / (list latest), GET /:id (job by id).
 * Returns Connect-style middleware (req, res, next).
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { Job } from "../../lib/job-store.js";
import { respondJson } from "../helpers.js";

export interface JobsRoutesOptions {
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getLatestJob: (sessionId: string) => (Job & { id: string }) | null;
  getJob: (id: string) => Job | undefined;
}

type Next = () => void;

export function jobsRoutes(options: JobsRoutesOptions) {
  const { getSessionIdFromRequest, getLatestJob, getJob } = options;

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
      const sessionId = getSessionIdFromRequest(req);
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
