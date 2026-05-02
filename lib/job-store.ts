/**
 * In-memory job store for long-running collect/generate. Single-instance only.
 * POST /api/collect or /api/generate starts a job and returns job_id; client polls GET /api/jobs/:id.
 */

export interface Job {
  type: string;
  status: string;
  created_at: string;
  created_by?: string;
  progress?: string | null;
  result?: unknown;
  error?: string | null;
}

import { generateId } from "./id.js";

const jobs = new Map<string, Job>();

const STATUS = { PENDING: "pending", RUNNING: "running", DONE: "done", FAILED: "failed" } as const;

export function createJob(type: string, sessionId?: string): string {
  const id = generateId("job");
  const record: Job = {
    type,
    status: STATUS.PENDING,
    created_at: new Date().toISOString(),
    progress: null,
    result: null,
    error: null,
  };
  if (sessionId != null) record.created_by = sessionId;
  jobs.set(id, record);
  return id;
}

export function getJob(id: string): Job | undefined {
  return jobs.get(id);
}

export function getLatestJob(sessionId: string): (Job & { id: string }) | null {
  const candidates: (Job & { id: string })[] = [];
  for (const [id, job] of jobs) {
    if (job.created_by !== sessionId) continue;
    candidates.push({ id, ...job });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const c = (b.created_at || "").localeCompare(a.created_at || "");
    return c !== 0 ? c : (b.id || "").localeCompare(a.id || "");
  });
  return candidates[0];
}

export function updateJob(id: string, update: Partial<Job>): void {
  const job = jobs.get(id);
  if (job) Object.assign(job, update);
}

/**
 * Run fn in the background; update job to running, then done/result or failed/error.
 */
export function runInBackground(
  id: string,
  fn: (report: (p: Partial<Job>) => void) => Promise<unknown>
): void {
  updateJob(id, { status: STATUS.RUNNING });
  const report = (update: Partial<Job>) => updateJob(id, update);
  fn(report)
    .then((result) => updateJob(id, { status: STATUS.DONE, result, progress: null }))
    .catch((err: Error) =>
      updateJob(id, {
        status: STATUS.FAILED,
        error: err.message || "Job failed",
        progress: null,
      })
    );
}
