import { describe, it, expect, vi } from "vitest";
import { snapshotsRoutes } from "../server/routes/snapshots.ts";
import { mockRes, mockReq, respondJson } from "./helpers.js";

const SAMPLE_EVIDENCE = {
  timeframe: { start_date: "2025-01-01", end_date: "2025-01-07" },
  contributions: [{ id: "repo#1", type: "pull_request", title: "Fix bug", url: "https://github.com/org/repo/pull/1", repo: "org/repo" }],
};

function makeOptions(overrides = {}) {
  return {
    readJsonBody: vi.fn().mockResolvedValue({}),
    respondJson,
    getSessionIdFromRequest: () => null,
    getSession: () => undefined,
    saveSnapshot: vi.fn().mockResolvedValue("snap_abc"),
    listSnapshots: vi.fn().mockResolvedValue([]),
    getSnapshot: vi.fn().mockResolvedValue(null),
    deleteSnapshot: vi.fn().mockResolvedValue(false),
    mergeSnapshots: vi.fn().mockResolvedValue(null),
    isSnapshotStoreConfigured: () => true,
    ...overrides,
  };
}

const SESSION = { login: "user1", access_token: "tok", created_at: "2025-01-01T00:00:00Z" };

describe("snapshotsRoutes – auth", () => {
  it("returns 401 when not logged in for GET /", async () => {
    const handler = snapshotsRoutes(makeOptions());
    const req = mockReq("GET", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/login required/i);
  });

  it("returns 401 when not logged in for POST /", async () => {
    const handler = snapshotsRoutes(makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({}),
    }));
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });
});

describe("snapshotsRoutes – GET /", () => {
  it("returns empty snapshots list for logged-in user", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      listSnapshots: vi.fn().mockResolvedValue([]),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("GET", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ snapshots: [] });
  });

  it("returns snapshot list for logged-in user", async () => {
    const snap = {
      id: "snap_1",
      user_login: "user1",
      period: "weekly",
      start_date: "2025-01-01",
      end_date: "2025-01-07",
      label: null,
      contribution_count: 3,
      created_at: "2025-01-08T00:00:00Z",
    };
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      listSnapshots: vi.fn().mockResolvedValue([snap]),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("GET", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.snapshots).toHaveLength(1);
    expect(res.body.snapshots[0].id).toBe("snap_1");
  });
});

describe("snapshotsRoutes – POST /", () => {
  it("returns 400 when period is missing", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({
        start_date: "2025-01-01",
        end_date: "2025-01-07",
        evidence: SAMPLE_EVIDENCE,
      }),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/period/i);
  });

  it("returns 400 when start_date is invalid", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({
        period: "weekly",
        start_date: "not-a-date",
        end_date: "2025-01-07",
        evidence: SAMPLE_EVIDENCE,
      }),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/start_date/i);
  });

  it("returns 201 with id on valid save", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({
        period: "weekly",
        start_date: "2025-01-01",
        end_date: "2025-01-07",
        evidence: SAMPLE_EVIDENCE,
        label: "Week 1",
      }),
      saveSnapshot: vi.fn().mockResolvedValue("snap_new"),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe("snap_new");
    expect(opts.saveSnapshot).toHaveBeenCalledWith(
      "user1",
      "weekly",
      "2025-01-01",
      "2025-01-07",
      SAMPLE_EVIDENCE,
      "Week 1"
    );
  });

  it("returns 400 when evidence is missing", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({
        period: "weekly",
        start_date: "2025-01-01",
        end_date: "2025-01-07",
      }),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/evidence/i);
  });
});

describe("snapshotsRoutes – GET /:id", () => {
  it("returns 404 when snapshot not found", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      getSnapshot: vi.fn().mockResolvedValue(null),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("GET", "/snap_missing");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with snapshot data when found", async () => {
    const snap = {
      id: "snap_1",
      user_login: "user1",
      period: "weekly",
      start_date: "2025-01-01",
      end_date: "2025-01-07",
      label: null,
      contribution_count: 1,
      evidence: SAMPLE_EVIDENCE,
      created_at: "2025-01-08T00:00:00Z",
    };
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      getSnapshot: vi.fn().mockResolvedValue(snap),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("GET", "/snap_1");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe("snap_1");
  });
});

describe("snapshotsRoutes – DELETE /:id", () => {
  it("returns 404 when snapshot not found", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      deleteSnapshot: vi.fn().mockResolvedValue(false),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("DELETE", "/snap_missing");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 when snapshot is deleted", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      deleteSnapshot: vi.fn().mockResolvedValue(true),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("DELETE", "/snap_1");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toBe(true);
    expect(opts.deleteSnapshot).toHaveBeenCalledWith("snap_1", "user1");
  });
});

describe("snapshotsRoutes – POST /merge", () => {
  it("returns 400 when ids is missing", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({}),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/merge");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/ids/i);
  });

  it("returns 400 when ids is empty array", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ ids: [] }),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/merge");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
  });

  it("returns 404 when no snapshots found", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ ids: ["snap_1", "snap_2"] }),
      mergeSnapshots: vi.fn().mockResolvedValue(null),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/merge");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with merged evidence", async () => {
    const merged = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-01-14" },
      contributions: [
        { id: "repo#1", type: "pull_request", title: "A", url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
        { id: "repo#2", type: "pull_request", title: "B", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
      ],
    };
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ ids: ["snap_1", "snap_2"] }),
      mergeSnapshots: vi.fn().mockResolvedValue(merged),
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("POST", "/merge");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.timeframe).toMatchObject({ start_date: "2025-01-01", end_date: "2025-01-14" });
    expect(res.body.contributions).toHaveLength(2);
    expect(opts.mergeSnapshots).toHaveBeenCalledWith(["snap_1", "snap_2"], "user1");
  });
});

describe("snapshotsRoutes – not configured", () => {
  it("returns 503 when snapshot store not configured", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      isSnapshotStoreConfigured: () => false,
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("GET", "/");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

describe("snapshotsRoutes – next()", () => {
  it("calls next() for unmatched routes", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
    });
    const handler = snapshotsRoutes(opts);
    const req = mockReq("PUT", "/unknown");
    const res = mockRes();
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
