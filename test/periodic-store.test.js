import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  toWeekKey,
  weekStart,
  weekEnd,
  saveDailySummary,
  saveWeeklyRollup,
  saveMonthlyRollup,
  getPeriodicSummary,
  listPeriodicSummaries,
  getDailySummariesForWeek,
  getWeeklySummariesForMonth,
  getMonthlySummariesForYear,
  deletePeriodicSummary,
  clearPeriodicStore,
  resetPeriodicPool,
  isPeriodicStoreConfigured,
} from "../lib/periodic-store.ts";

// ── Pure helper tests (no DB required) ────────────────────────────────────────

describe("periodic-store – week key helpers", () => {
  it("toWeekKey returns ISO week for a known Monday", () => {
    expect(toWeekKey("2025-01-06")).toBe("2025-W02");
  });

  it("toWeekKey returns ISO week for a mid-week date", () => {
    // 2025-01-15 is a Wednesday in week 3
    expect(toWeekKey("2025-01-15")).toBe("2025-W03");
  });

  it("toWeekKey handles year-boundary: Dec 30 2024 belongs to 2025-W01", () => {
    // 2024-12-30 is a Monday; its Thursday is Jan 2 2025 → ISO year 2025, week 1
    expect(toWeekKey("2024-12-30")).toBe("2025-W01");
  });

  it("toWeekKey handles year-boundary: Jan 1 2021 belongs to 2020-W53", () => {
    // 2021-01-01 is a Friday; its Thursday is Dec 31 2020 → ISO year 2020, week 53
    expect(toWeekKey("2021-01-01")).toBe("2020-W53");
  });

  it("toWeekKey returns week 53 for late December when applicable", () => {
    // 2015-12-28 is a Monday in ISO week 53 of 2015
    expect(toWeekKey("2015-12-28")).toBe("2015-W53");
  });

  it("weekStart returns the Monday of the week", () => {
    expect(weekStart("2025-01-15")).toBe("2025-01-13"); // Wed → Mon
    expect(weekStart("2025-01-13")).toBe("2025-01-13"); // Mon → Mon
    expect(weekStart("2025-01-19")).toBe("2025-01-13"); // Sun → Mon
  });

  it("weekEnd returns the Sunday of the week", () => {
    expect(weekEnd("2025-01-13")).toBe("2025-01-19"); // Mon → Sun
    expect(weekEnd("2025-01-15")).toBe("2025-01-19"); // Wed → Sun
    expect(weekEnd("2025-01-19")).toBe("2025-01-19"); // Sun → Sun
  });
});

describe("periodic-store – isPeriodicStoreConfigured", () => {
  it("returns false when DATABASE_URL is not set", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(isPeriodicStoreConfigured()).toBe(false);
    if (original !== undefined) process.env.DATABASE_URL = original;
  });
});

// ── Integration tests (skipped without DATABASE_URL) ──────────────────────────

const EVIDENCE_A = {
  timeframe: { start_date: "2025-01-15", end_date: "2025-01-15" },
  contributions: [
    { id: "repo#1", type: "pull_request", title: "Fix auth", url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
    { id: "repo#2", type: "review", title: "Review #2", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
  ],
};

const EVIDENCE_B = {
  timeframe: { start_date: "2025-01-16", end_date: "2025-01-16" },
  contributions: [
    { id: "repo#3", type: "pull_request", title: "Add feature", url: "https://github.com/org/repo/pull/3", repo: "org/repo" },
  ],
};

const DAILY_SUMMARY_JSON = JSON.stringify({
  date: "2025-01-15",
  headline: "Fixed auth redirect",
  bullets: [{ text: "Merged auth fix", evidence_ids: ["repo#1"] }],
  contribution_count: 2,
  notes: "",
});

const WEEKLY_ROLLUP_JSON = JSON.stringify({
  week_start: "2025-01-13",
  headline: "Productive week",
  themes: [{ name: "Bug fixes", summary: "Auth fixes", day_refs: ["2025-01-15"] }],
  highlights: [{ text: "Auth fix merged", date: "2025-01-15" }],
  total_contributions: 2,
  active_days: 1,
});

const describeWithDb = process.env.DATABASE_URL ? describe : describe.skip;

describeWithDb("periodic-store (integration)", () => {
  beforeEach(async () => {
    await clearPeriodicStore();
  });

  afterAll(async () => {
    await clearPeriodicStore();
    resetPeriodicPool();
  });

  it("isPeriodicStoreConfigured returns true when DATABASE_URL is set", () => {
    expect(isPeriodicStoreConfigured()).toBe(true);
  });

  it("saveDailySummary returns a string id starting with pday_", async () => {
    const id = await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^pday_/);
  });

  it("saveDailySummary upserts on conflict", async () => {
    await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    // Call again with same date — should not throw
    const id2 = await saveDailySummary("alice", "2025-01-15", EVIDENCE_B, '"updated"');
    expect(id2).toMatch(/^pday_/);
    const snap = await getPeriodicSummary(id2, "alice");
    expect(snap?.summary).toBe('"updated"');
  });

  it("getPeriodicSummary returns the saved summary with evidence for daily", async () => {
    const id = await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    const snap = await getPeriodicSummary(id, "alice");
    expect(snap).not.toBeNull();
    expect(snap?.period_type).toBe("daily");
    expect(snap?.period_key).toBe("2025-01-15");
    expect(snap?.contribution_count).toBe(2);
    expect(snap?.evidence?.contributions).toHaveLength(2);
  });

  it("getPeriodicSummary returns null for wrong user", async () => {
    const id = await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    const snap = await getPeriodicSummary(id, "bob");
    expect(snap).toBeNull();
  });

  it("listPeriodicSummaries returns summaries without evidence", async () => {
    await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    await saveDailySummary("alice", "2025-01-16", EVIDENCE_B, '"day2"');
    const list = await listPeriodicSummaries("alice");
    expect(list).toHaveLength(2);
    expect(list[0].evidence).toBeUndefined();
    // Most recent first
    expect(list[0].period_key).toBe("2025-01-16");
  });

  it("listPeriodicSummaries filters by period_type", async () => {
    await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    const idWk = await saveWeeklyRollup("alice", "2025-01-13", [], WEEKLY_ROLLUP_JSON, 2);
    expect(idWk).toMatch(/^pwk_/);

    const dailies = await listPeriodicSummaries("alice", "daily");
    expect(dailies).toHaveLength(1);
    expect(dailies[0].period_type).toBe("daily");

    const weeklies = await listPeriodicSummaries("alice", "weekly");
    expect(weeklies).toHaveLength(1);
    expect(weeklies[0].period_type).toBe("weekly");
  });

  it("getDailySummariesForWeek returns dailies in the week", async () => {
    await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON); // Wed in W03
    await saveDailySummary("alice", "2025-01-16", EVIDENCE_B, '"day2"');            // Thu in W03
    await saveDailySummary("alice", "2025-01-20", EVIDENCE_B, '"day3"');            // Mon in W04 — excluded

    const w3 = await getDailySummariesForWeek("alice", "2025-01-13"); // W03 starts Mon 2025-01-13
    expect(w3).toHaveLength(2);
    expect(w3.map((d) => d.period_key)).toContain("2025-01-15");
    expect(w3.map((d) => d.period_key)).toContain("2025-01-16");
  });

  it("getWeeklySummariesForMonth returns weeklies for the month", async () => {
    await saveWeeklyRollup("alice", "2025-01-13", [], WEEKLY_ROLLUP_JSON, 2);
    await saveWeeklyRollup("alice", "2025-01-20", [], WEEKLY_ROLLUP_JSON, 1);
    await saveWeeklyRollup("alice", "2025-02-03", [], WEEKLY_ROLLUP_JSON, 0); // Feb — excluded

    const jan = await getWeeklySummariesForMonth("alice", "2025-01");
    expect(jan).toHaveLength(2);
    expect(jan.every((w) => w.start_date.startsWith("2025-01"))).toBe(true);
  });

  it("getMonthlySummariesForYear returns months for the year", async () => {
    await saveMonthlyRollup("alice", "2025-01", [], '"jan"', 5);
    await saveMonthlyRollup("alice", "2025-02", [], '"feb"', 3);
    await saveMonthlyRollup("alice", "2024-12", [], '"dec"', 2); // different year

    const y2025 = await getMonthlySummariesForYear("alice", "2025");
    expect(y2025).toHaveLength(2);
    expect(y2025.map((m) => m.period_key)).toEqual(["2025-01", "2025-02"]);
  });

  it("deletePeriodicSummary removes the row and returns true", async () => {
    const id = await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    const result = await deletePeriodicSummary(id, "alice");
    expect(result).toBe(true);
    expect(await getPeriodicSummary(id, "alice")).toBeNull();
  });

  it("deletePeriodicSummary returns false when wrong user", async () => {
    const id = await saveDailySummary("alice", "2025-01-15", EVIDENCE_A, DAILY_SUMMARY_JSON);
    const result = await deletePeriodicSummary(id, "bob");
    expect(result).toBe(false);
  });

  it("weekly rollup stores correct period_key and dates", async () => {
    const id = await saveWeeklyRollup("alice", "2025-01-13", ["pday_1"], WEEKLY_ROLLUP_JSON, 2);
    const snap = await getPeriodicSummary(id, "alice");
    expect(snap?.period_key).toBe("2025-W03");
    expect(snap?.start_date).toBe("2025-01-13");
    expect(snap?.end_date).toBe("2025-01-19");
    expect(snap?.child_ids).toEqual(["pday_1"]);
    expect(snap?.evidence).toBeNull(); // no evidence for weekly
  });

  it("monthly rollup stores correct period_key and dates", async () => {
    const id = await saveMonthlyRollup("alice", "2025-01", ["pwk_1", "pwk_2"], '"monthly"', 10);
    const snap = await getPeriodicSummary(id, "alice");
    expect(snap?.period_key).toBe("2025-01");
    expect(snap?.start_date).toBe("2025-01-01");
    expect(snap?.end_date).toBe("2025-01-31");
    expect(snap?.child_ids).toEqual(["pwk_1", "pwk_2"]);
  });
});
