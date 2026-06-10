import { describe, it, expect, vi } from "vitest";
import { jobsRoutes } from "../server/routes/jobs.ts";
import { mockRes } from "./helpers.js";

function makeOptions(overrides = {}) {
  const jobs = {
    getLatestJob: vi.fn().mockReturnValue(null),
    getJob: vi.fn().mockReturnValue(undefined),
    ...(overrides.jobs || {}),
  };
  return {
    session: {
      getSessionIdFromRequest: () => null,
      getSession: () => undefined,
      ...(overrides.session || {}),
    },
    jobs,
  };
}

describe("jobsRoutes – GET / (latest)", () => {
  it("returns latest:null when no session", () => {
    const handler = jobsRoutes(makeOptions());
    const req = { method: "GET", url: "/", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ latest: null });
  });

  it("returns latest job when session has one", () => {
    const latestJob = { id: "j1", type: "collect", status: "done" };
    const handler = jobsRoutes(makeOptions({
      session: { getSessionIdFromRequest: () => "sess_1" },
      jobs: { getLatestJob: vi.fn().mockReturnValue(latestJob) },
    }));
    const req = { method: "GET", url: "/", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ latest: latestJob });
  });
});

describe("jobsRoutes – GET /:id", () => {
  it("returns job by id", () => {
    const job = { type: "collect", status: "done", result: { ok: true } };
    const handler = jobsRoutes(makeOptions({
      jobs: { getJob: vi.fn().mockReturnValue(job) },
    }));
    const req = { method: "GET", url: "/j1", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(job);
  });

  it("returns 404 when job not found", () => {
    const handler = jobsRoutes(makeOptions());
    const req = { method: "GET", url: "/missing", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("decodes URL-encoded job id", () => {
    const getJob = vi.fn().mockReturnValue({ type: "collect", status: "done" });
    const handler = jobsRoutes(makeOptions({ jobs: { getJob } }));
    const req = { method: "GET", url: "/job%2Fwith%2Fslashes", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(getJob).toHaveBeenCalledWith("job/with/slashes");
  });
});

describe("jobsRoutes – next()", () => {
  it("calls next for non-GET requests", () => {
    const handler = jobsRoutes(makeOptions());
    const req = { method: "POST", url: "/", headers: {} };
    const res = mockRes();
    const next = vi.fn();
    handler(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
