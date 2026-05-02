import { describe, it, expect, vi } from "vitest";
import { periodicRoutes } from "../server/routes/periodic.ts";
import { mockRes, mockReq, respondJson } from "./helpers.js";

const SAMPLE_EVIDENCE = {
  timeframe: { start_date: "2025-01-15", end_date: "2025-01-15" },
  contributions: [
    { id: "repo#1", type: "pull_request", title: "Fix bug", url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
  ],
};

const SAMPLE_DAILY_JSON = JSON.stringify({
  date: "2025-01-15",
  headline: "Fixed a bug in the auth flow",
  bullets: [{ text: "Merged PR fixing auth redirect", evidence_ids: ["repo#1"] }],
  contribution_count: 1,
  notes: "",
});

const SESSION = { login: "alice", access_token: "gh_tok", created_at: "2025-01-01T00:00:00Z" };

function makeOptions(overrides = {}) {
  return {
    readJsonBody: vi.fn().mockResolvedValue({}),
    respondJson,
    getSessionIdFromRequest: () => null,
    getSession: () => undefined,
    collectAndNormalize: vi.fn().mockResolvedValue(SAMPLE_EVIDENCE),
    runDailySummary: vi.fn().mockResolvedValue(SAMPLE_DAILY_JSON),
    runWeeklyRollup: vi.fn().mockResolvedValue(JSON.stringify({
      week_start: "2025-01-13",
      week_end: "2025-01-19",
      headline: "Productive bug-fix week",
      themes: [{ name: "Bug fixes", summary: "Fixed auth issues", day_refs: ["2025-01-15"] }],
      highlights: [{ text: "Merged auth fix", date: "2025-01-15" }],
      total_contributions: 1,
      active_days: 1,
    })),
    runMonthlyRollup: vi.fn().mockResolvedValue(JSON.stringify({
      month: "2025-01",
      headline: "Solid January",
      themes: [{ name: "Bug fixes", summary: "Stabilised auth", week_refs: ["2025-01-13"] }],
      top_accomplishments: [{ text: "Merged auth fix", week: "2025-01-13" }],
      total_contributions: 1,
      active_weeks: 1,
      momentum: "steady",
      notes: "",
    })),
    saveDailySummary: vi.fn().mockResolvedValue("pday_1"),
    saveWeeklyRollup: vi.fn().mockResolvedValue("pwk_1"),
    saveMonthlyRollup: vi.fn().mockResolvedValue("pmo_1"),
    getPeriodicSummary: vi.fn().mockResolvedValue(null),
    listPeriodicSummaries: vi.fn().mockResolvedValue([]),
    getDailySummariesForWeek: vi.fn().mockResolvedValue([]),
    getWeeklySummariesForMonth: vi.fn().mockResolvedValue([]),
    deletePeriodicSummary: vi.fn().mockResolvedValue(false),
    isPeriodicStoreConfigured: () => true,
    ...overrides,
  };
}

// ── Auth ─────────────────────────────────────────────────────────────────────

describe("periodicRoutes – auth", () => {
  it("returns 401 on collect-day when not logged in", async () => {
    const handler = periodicRoutes(makeOptions());
    const req = mockReq("POST", "/collect-day");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on rollup-week when not logged in", async () => {
    const handler = periodicRoutes(makeOptions());
    const req = mockReq("POST", "/rollup-week");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on rollup-month when not logged in", async () => {
    const handler = periodicRoutes(makeOptions());
    const req = mockReq("POST", "/rollup-month");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 on GET /summaries when not logged in", async () => {
    const handler = periodicRoutes(makeOptions());
    const req = mockReq("GET", "/summaries");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
  });
});

// ── Not configured ────────────────────────────────────────────────────────────

describe("periodicRoutes – not configured", () => {
  it("returns 503 when store not configured", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      isPeriodicStoreConfigured: () => false,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summaries");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });
});

// ── POST /collect-day ─────────────────────────────────────────────────────────

describe("periodicRoutes – POST /collect-day", () => {
  it("returns 401 when no GitHub token is available", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => ({ login: "alice", created_at: "2025-01-01T00:00:00Z" }), // no access_token
      readJsonBody: vi.fn().mockResolvedValue({}),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/collect-day");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/token required/i);
  });

  it("returns 400 for invalid date format", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ date: "15/01/2025" }),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/collect-day");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/date/i);
  });

  it("collects, summarises, and returns 201 with summary", async () => {
    const mockCollect = vi.fn().mockResolvedValue(SAMPLE_EVIDENCE);
    const mockSummary = vi.fn().mockResolvedValue(SAMPLE_DAILY_JSON);
    const mockSave = vi.fn().mockResolvedValue("pday_new");

    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ date: "2025-01-15" }),
      collectAndNormalize: mockCollect,
      runDailySummary: mockSummary,
      saveDailySummary: mockSave,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/collect-day");
    const res = mockRes();
    await handler(req, res, () => {});

    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe("pday_new");
    expect(res.body.date).toBe("2025-01-15");
    expect(res.body.contribution_count).toBe(1);
    expect(mockCollect).toHaveBeenCalledWith({
      token: "gh_tok",
      start_date: "2025-01-15",
      end_date: "2025-01-15",
    });
    expect(mockSave).toHaveBeenCalledWith("alice", "2025-01-15", SAMPLE_EVIDENCE, SAMPLE_DAILY_JSON);
  });

  it("uses session token when no token in body", async () => {
    const mockCollect = vi.fn().mockResolvedValue(SAMPLE_EVIDENCE);
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION, // has access_token: "gh_tok"
      readJsonBody: vi.fn().mockResolvedValue({ date: "2025-01-15" }),
      collectAndNormalize: mockCollect,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/collect-day");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(mockCollect).toHaveBeenCalledWith(
      expect.objectContaining({ token: "gh_tok" })
    );
  });
});

// ── POST /rollup-week ─────────────────────────────────────────────────────────

describe("periodicRoutes – POST /rollup-week", () => {
  it("returns 404 when no daily summaries found for the week", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ week_start: "2025-01-13" }),
      getDailySummariesForWeek: vi.fn().mockResolvedValue([]),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/rollup-week");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/no daily summaries/i);
  });

  it("creates a weekly rollup and returns 201", async () => {
    const daily = {
      id: "pday_1",
      user_login: "alice",
      period_type: "daily",
      period_key: "2025-01-15",
      start_date: "2025-01-15",
      end_date: "2025-01-15",
      contribution_count: 1,
      summary: SAMPLE_DAILY_JSON,
      child_ids: null,
      created_at: "2025-01-15T23:00:00Z",
      evidence: SAMPLE_EVIDENCE,
    };
    const mockRollup = vi.fn().mockResolvedValue(JSON.stringify({
      week_start: "2025-01-13",
      headline: "Good week",
      themes: [],
      highlights: [],
      total_contributions: 1,
      active_days: 1,
    }));
    const mockSave = vi.fn().mockResolvedValue("pwk_new");
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ week_start: "2025-01-13" }),
      getDailySummariesForWeek: vi.fn().mockResolvedValue([daily]),
      runWeeklyRollup: mockRollup,
      saveWeeklyRollup: mockSave,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/rollup-week");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe("pwk_new");
    expect(res.body.days_covered).toBe(1);
    expect(res.body.total_contributions).toBe(1);
    expect(mockSave).toHaveBeenCalledWith("alice", "2025-01-13", ["pday_1"], expect.any(String), 1);
  });
});

// ── POST /rollup-month ────────────────────────────────────────────────────────

describe("periodicRoutes – POST /rollup-month", () => {
  it("returns 400 for invalid month format", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ month: "January 2025" }),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/rollup-month");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toMatch(/month/i);
  });

  it("returns 404 when no weekly summaries for month", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ month: "2025-01" }),
      getWeeklySummariesForMonth: vi.fn().mockResolvedValue([]),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/rollup-month");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
    expect(res.body.error).toMatch(/no weekly summaries/i);
  });

  it("creates a monthly rollup and returns 201", async () => {
    const weekly = {
      id: "pwk_1",
      user_login: "alice",
      period_type: "weekly",
      period_key: "2025-W03",
      start_date: "2025-01-13",
      end_date: "2025-01-19",
      contribution_count: 3,
      summary: "{}",
      child_ids: ["pday_1"],
      created_at: "2025-01-19T23:00:00Z",
    };
    const mockSave = vi.fn().mockResolvedValue("pmo_new");
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      readJsonBody: vi.fn().mockResolvedValue({ month: "2025-01" }),
      getWeeklySummariesForMonth: vi.fn().mockResolvedValue([weekly]),
      saveMonthlyRollup: mockSave,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("POST", "/rollup-month");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(201);
    expect(res.body.id).toBe("pmo_new");
    expect(res.body.month).toBe("2025-01");
    expect(res.body.weeks_covered).toBe(1);
    expect(mockSave).toHaveBeenCalledWith("alice", "2025-01", ["pwk_1"], expect.any(String), 3);
  });
});

// ── GET /summaries ────────────────────────────────────────────────────────────

describe("periodicRoutes – GET /summaries", () => {
  it("returns empty list when no summaries", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summaries");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ summaries: [] });
  });

  it("passes type filter to store", async () => {
    const mockList = vi.fn().mockResolvedValue([]);
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      listPeriodicSummaries: mockList,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summaries?type=daily");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(mockList).toHaveBeenCalledWith("alice", "daily", expect.any(Number));
  });

  it("returns parsed JSON summaries", async () => {
    const mockList = vi.fn().mockResolvedValue([{
      id: "pday_1",
      user_login: "alice",
      period_type: "daily",
      period_key: "2025-01-15",
      start_date: "2025-01-15",
      end_date: "2025-01-15",
      contribution_count: 1,
      summary: SAMPLE_DAILY_JSON,
      child_ids: null,
      created_at: "2025-01-15T23:00:00Z",
    }]);
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      listPeriodicSummaries: mockList,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summaries");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    const s = res.body.summaries[0];
    expect(typeof s.summary).toBe("object");
    expect(s.summary.headline).toBe("Fixed a bug in the auth flow");
  });
});

// ── GET /summary/:id ──────────────────────────────────────────────────────────

describe("periodicRoutes – GET /summary/:id", () => {
  it("returns 404 when not found", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      getPeriodicSummary: vi.fn().mockResolvedValue(null),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summary/missing");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 with parsed summary when found", async () => {
    const snap = {
      id: "pday_1",
      user_login: "alice",
      period_type: "daily",
      period_key: "2025-01-15",
      start_date: "2025-01-15",
      end_date: "2025-01-15",
      contribution_count: 1,
      summary: SAMPLE_DAILY_JSON,
      child_ids: null,
      evidence: SAMPLE_EVIDENCE,
      created_at: "2025-01-15T23:00:00Z",
    };
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      getPeriodicSummary: vi.fn().mockResolvedValue(snap),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("GET", "/summary/pday_1");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.id).toBe("pday_1");
    expect(typeof res.body.summary).toBe("object");
  });
});

// ── DELETE /summary/:id ───────────────────────────────────────────────────────

describe("periodicRoutes – DELETE /summary/:id", () => {
  it("returns 404 when not found", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      deletePeriodicSummary: vi.fn().mockResolvedValue(false),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("DELETE", "/summary/missing");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(404);
  });

  it("returns 200 when deleted", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
      deletePeriodicSummary: vi.fn().mockResolvedValue(true),
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("DELETE", "/summary/pday_1");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

// ── next() ────────────────────────────────────────────────────────────────────

describe("periodicRoutes – next()", () => {
  it("calls next for unmatched routes", async () => {
    const opts = makeOptions({
      getSessionIdFromRequest: () => "sess1",
      getSession: () => SESSION,
    });
    const handler = periodicRoutes(opts);
    const req = mockReq("PUT", "/unknown");
    const res = mockRes();
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});
