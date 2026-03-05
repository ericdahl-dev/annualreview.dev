import { describe, it, expect, vi } from "vitest";
import { collectRoutes } from "../server/routes/collect.ts";
import { mockRes, mockReq, respondJson } from "./helpers.js";

function makeOptions(overrides = {}) {
  return {
    readJsonBody: vi.fn().mockResolvedValue({}),
    respondJson,
    DATE_YYYY_MM_DD: /^\d{4}-\d{2}-\d{2}$/,
    getSessionIdFromRequest: () => null,
    getSession: () => undefined,
    createJob: vi.fn().mockReturnValue("job_1"),
    runInBackground: vi.fn(),
    collectAndNormalize: vi.fn().mockResolvedValue({ contributions: [] }),
    ...overrides,
  };
}

describe("collectRoutes – POST /", () => {
  it("returns 400 when dates are missing", async () => {
    const handler = collectRoutes(makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({}),
    }));
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it("returns 400 when dates are invalid format", async () => {
    const handler = collectRoutes(makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({ start_date: "jan", end_date: "feb" }),
    }));
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when no token is available", async () => {
    const handler = collectRoutes(makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({ start_date: "2025-01-01", end_date: "2025-12-31" }),
    }));
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/token required/);
  });

  it("accepts token from body and creates job with 202", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({ start_date: "2025-01-01", end_date: "2025-12-31", token: "ghp_abc" }),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ job_id: "job_1" });
    expect(opts.createJob).toHaveBeenCalledWith("collect", undefined);
    expect(opts.runInBackground).toHaveBeenCalledWith("job_1", expect.any(Function));
  });

  it("uses session access_token when available", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({ start_date: "2025-01-01", end_date: "2025-12-31" }),
      getSessionIdFromRequest: () => "sess_1",
      getSession: () => ({ access_token: "ghp_session", login: "user1" }),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(202);
    expect(opts.createJob).toHaveBeenCalledWith("collect", "sess_1");
  });

  it("returns 401 when readJsonBody throws a 401 error message", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockRejectedValue(new Error("GitHub 401: Bad credentials")),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it("returns 500 on unexpected errors", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("ECONNRESET");
  });

  it("returns 500 with fallback message when error has no message", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockRejectedValue(new Error("")),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toBe("Fetch failed");
  });
});

describe("collectRoutes – non-POST", () => {
  it("calls next for GET requests", async () => {
    const handler = collectRoutes(makeOptions());
    const req = mockReq("GET", "/");
    const res = mockRes();
    const next = vi.fn();
    await handler(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
