import { describe, it, expect, vi } from "vitest";
import { collectRoutes } from "../server/routes/collect.ts";
import { mockRes, mockReq } from "./helpers.js";

function makeOptions(overrides = {}) {
  return {
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
    const handler = collectRoutes(makeOptions());
    const req = mockReq("POST", "/", {});
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD/);
  });

  it("returns 400 when dates are invalid format", async () => {
    const handler = collectRoutes(makeOptions());
    const req = mockReq("POST", "/", { start_date: "jan", end_date: "feb" });
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("returns 401 when no token is available", async () => {
    const handler = collectRoutes(makeOptions());
    const req = mockReq("POST", "/", { start_date: "2025-01-01", end_date: "2025-12-31" });
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/token required/);
  });

  it("accepts token from body and creates job with 202", async () => {
    const opts = makeOptions();
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/", { start_date: "2025-01-01", end_date: "2025-12-31", token: "ghp_abc" });
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(202);
    expect(res.body).toMatchObject({ job_id: "job_1" });
    expect(opts.createJob).toHaveBeenCalledWith("collect", undefined);
    expect(opts.runInBackground).toHaveBeenCalledWith("job_1", expect.any(Function));
  });

  it("uses session access_token when available", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess_1",
      getSession: () => ({ access_token: "ghp_session", login: "user1" }),
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/", { start_date: "2025-01-01", end_date: "2025-12-31" });
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(202);
    expect(opts.createJob).toHaveBeenCalledWith("collect", "sess_1");
  });

  it("prefers body token over session token when both are provided", async () => {
    const collectAndNormalize = vi.fn().mockResolvedValue({ contributions: [] });
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess_1",
      getSession: () => ({ access_token: "ghp_session_token", login: "user1" }),
      collectAndNormalize,
    });
    const handler = collectRoutes(opts);
    const req = mockReq("POST", "/", { start_date: "2025-01-01", end_date: "2025-12-31", token: "ghp_pat_token" });
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(202);
    const bgFn = opts.runInBackground.mock.calls[0][1];
    await bgFn();
    expect(collectAndNormalize).toHaveBeenCalledWith(expect.objectContaining({ token: "ghp_pat_token" }));
  });

  it("returns 500 on unexpected errors", async () => {
    const handler = collectRoutes(makeOptions());
    // Send invalid JSON to trigger parse error
    const badReq = {
      method: "POST",
      url: "/",
      headers: { "content-type": "application/json", host: "localhost:3000" },
      on(event, handler) {
        if (event === "data") setTimeout(() => handler(Buffer.from("NOT_JSON")), 0);
        if (event === "end") setTimeout(() => handler(), 0);
        return this;
      },
    };
    const res = mockRes();
    await handler(badReq, res, () => {});
    expect(res.statusCode).toBe(500);
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
