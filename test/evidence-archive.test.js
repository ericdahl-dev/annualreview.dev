import { describe, it, expect } from "vitest";
import {
  DATE_YYYY_MM_DD,
  MONTH_YYYY_MM,
  SNAPSHOT_PERIODS,
  PERIODIC_PERIOD_TYPES,
  toWeekKey,
  weekStart,
  weekEnd,
  isEvidenceArchiveConfigured,
  mergeEvidenceHistory,
  filterSafeIds,
  SNAPSHOT_ID_PATTERN,
  tryParseJson,
  contributionCount,
} from "../lib/evidence-archive/index.ts";

const EVIDENCE_A = {
  timeframe: { start_date: "2025-01-01", end_date: "2025-01-07" },
  contributions: [
    { id: "repo#1", type: "pull_request", title: "PR one", url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
    { id: "repo#2", type: "review", title: "Review one", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
  ],
};

const EVIDENCE_B = {
  timeframe: { start_date: "2025-01-08", end_date: "2025-01-14" },
  contributions: [
    { id: "repo#3", type: "pull_request", title: "PR two", url: "https://github.com/org/repo/pull/3", repo: "org/repo" },
    { id: "repo#2", type: "review", title: "Review one (dup)", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
  ],
};

describe("evidence-archive – period", () => {
  it("validates calendar dates", () => {
    expect(DATE_YYYY_MM_DD.test("2025-01-15")).toBe(true);
    expect(DATE_YYYY_MM_DD.test("2025-1-15")).toBe(false);
  });

  it("validates month keys", () => {
    expect(MONTH_YYYY_MM.test("2025-01")).toBe(true);
    expect(MONTH_YYYY_MM.test("2025-1")).toBe(false);
  });

  it("includes custom in snapshot periods but not periodic periods", () => {
    expect(SNAPSHOT_PERIODS.has("custom")).toBe(true);
    expect(PERIODIC_PERIOD_TYPES.has("custom")).toBe(false);
  });

  it("toWeekKey returns ISO week for known dates", () => {
    expect(toWeekKey("2025-01-06")).toBe("2025-W02");
    expect(toWeekKey("2024-12-30")).toBe("2025-W01");
  });

  it("weekStart and weekEnd bound the ISO week", () => {
    expect(weekStart("2025-01-15")).toBe("2025-01-13");
    expect(weekEnd("2025-01-15")).toBe("2025-01-19");
  });
});

describe("evidence-archive – merge", () => {
  it("mergeEvidenceHistory combines rows and deduplicates contributions", () => {
    const merged = mergeEvidenceHistory([
      { evidence: EVIDENCE_A, start_date: "2025-01-01", end_date: "2025-01-07" },
      { evidence: EVIDENCE_B, start_date: "2025-01-08", end_date: "2025-01-14" },
    ]);
    expect(merged.timeframe.start_date).toBe("2025-01-01");
    expect(merged.timeframe.end_date).toBe("2025-01-14");
    expect(merged.contributions).toHaveLength(3);
  });

  it("mergeEvidenceHistory returns null for empty input", () => {
    expect(mergeEvidenceHistory([])).toBeNull();
  });

  it("mergeEvidenceHistory preserves role_context_optional from first row", () => {
    const merged = mergeEvidenceHistory([
      {
        evidence: { ...EVIDENCE_A, role_context_optional: { title: "Engineer" } },
        start_date: "2025-01-01",
        end_date: "2025-01-07",
      },
      { evidence: EVIDENCE_B, start_date: "2025-01-08", end_date: "2025-01-14" },
    ]);
    expect(merged.role_context_optional).toEqual({ title: "Engineer" });
  });

  it("filterSafeIds rejects invalid snapshot ids", () => {
    expect(filterSafeIds(["snap_ok", "bad id", 1], SNAPSHOT_ID_PATTERN)).toEqual(["snap_ok"]);
  });
});

describe("evidence-archive – json", () => {
  it("tryParseJson parses valid JSON and returns raw string on failure", () => {
    expect(tryParseJson('{"a":1}')).toEqual({ a: 1 });
    expect(tryParseJson("not json")).toBe("not json");
  });

  it("contributionCount counts evidence contributions safely", () => {
    expect(contributionCount(EVIDENCE_A)).toBe(2);
    expect(contributionCount({ timeframe: EVIDENCE_A.timeframe, contributions: null })).toBe(0);
  });
});

describe("evidence-archive – config", () => {
  it("isEvidenceArchiveConfigured mirrors DATABASE_URL", () => {
    const original = process.env.DATABASE_URL;
    if (original) {
      expect(isEvidenceArchiveConfigured()).toBe(true);
    } else {
      expect(isEvidenceArchiveConfigured()).toBe(false);
    }
  });
});
