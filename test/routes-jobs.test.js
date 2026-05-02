import { describe, it, expect, vi } from "vitest";
import { jobsRoutes } from "../server/routes/jobs.ts";
import { mockRes } from "./helpers.js";

function makeOptions(overrides = {}) {
  return {
    getSessionIdFromRequest: () => null,
    getLatestJob: vi.fn().mockReturnValue(null),
    getJob: vi.fn().mockReturnValue(undefined),
    ...overrides,
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
      getSessionIdFromRequest: () => "sess_1",
      getLatestJob: vi.fn().mockReturnValue(latestJob),
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
      getJob: vi.fn().mockReturnValue(job),
    }));
    const req = { method: "GET", url: "/job_abc", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual(job);
  });

  it("returns 404 when job not found", () => {
    const handler = jobsRoutes(makeOptions());
    const req = { method: "GET", url: "/nonexistent", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toBe("Job not found");
  });

  it("decodes URL-encoded job id", () => {
    const getJob = vi.fn().mockReturnValue({ type: "collect", status: "done" });
    const handler = jobsRoutes(makeOptions({ getJob }));
    const req = { method: "GET", url: "/job%20with%20space", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(getJob).toHaveBeenCalledWith("job with space");
  });
});

describe("jobsRoutes – non-GET", () => {
  it("calls next for POST requests", () => {
    const handler = jobsRoutes(makeOptions());
    const req = { method: "POST", url: "/", headers: {} };
    const res = mockRes();
    const next = vi.fn();
    handler(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
