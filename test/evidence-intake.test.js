import { describe, it, expect, vi, afterEach } from "vitest";
import * as normalizeModule from "../scripts/normalize.ts";
import {
  DATE_RE,
  EvidenceIntakeError,
  parseTimeframe,
  requireGitHubToken,
  resolveGitHubToken,
  intakeFromGitHub,
  intakeFromRaw,
} from "../lib/evidence-intake.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("evidence-intake – invariants", () => {
  it("DATE_RE accepts YYYY-MM-DD and rejects other formats", () => {
    expect(DATE_RE.test("2025-01-01")).toBe(true);
    expect(DATE_RE.test("2025-1-01")).toBe(false);
    expect(DATE_RE.test("01/01/2025")).toBe(false);
  });

  it("parseTimeframe rejects missing or invalid dates", () => {
    expect(() => parseTimeframe(undefined, "2025-01-01")).toThrow(EvidenceIntakeError);
    expect(() => parseTimeframe("2025-01-01", "bad")).toThrow(/YYYY-MM-DD/);
  });

  it("parseTimeframe rejects start_date after end_date", () => {
    expect(() => parseTimeframe("2025-12-31", "2025-01-01")).toThrow(/on or before/);
  });

  it("parseTimeframe accepts a single-day range", () => {
    expect(parseTimeframe("2025-01-15", "2025-01-15")).toEqual({
      start_date: "2025-01-15",
      end_date: "2025-01-15",
    });
  });

  it("requireGitHubToken rejects missing or empty tokens", () => {
    expect(() => requireGitHubToken(undefined)).toThrow(/token required/i);
    expect(() => requireGitHubToken("   ")).toThrow(/token required/i);
  });

  it("resolveGitHubToken prefers body token over session token", () => {
    expect(resolveGitHubToken({ body: "body_tok", session: "sess_tok" })).toBe("body_tok");
    expect(resolveGitHubToken({ session: "sess_tok" })).toBe("sess_tok");
  });
});

describe("intakeFromRaw", () => {
  it("returns validated evidence from raw GitHub JSON", () => {
    const raw = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-01-31" },
      pull_requests: [
        {
          number: 1,
          title: "Fix",
          url: "https://github.com/a/b/pull/1",
          base: { repo: { full_name: "a/b" } },
          merged_at: "2025-01-15T00:00:00Z",
        },
      ],
    };
    const evidence = intakeFromRaw(raw, { start_date: "2025-01-01", end_date: "2025-01-31" });
    expect(evidence.contributions).toHaveLength(1);
    expect(evidence.timeframe).toEqual({ start_date: "2025-01-01", end_date: "2025-01-31" });
  });

  it("throws when normalize output fails schema validation", () => {
    vi.spyOn(normalizeModule, "normalize").mockReturnValue({ not_evidence: true });
    expect(() => intakeFromRaw({})).toThrow(/invalid evidence/i);
  });
});

describe("intakeFromGitHub", () => {
  it("fetches, normalizes, and validates in order", async () => {
    const collectRawGraphQL = vi.fn().mockResolvedValue({
      timeframe: { start_date: "2025-01-01", end_date: "2025-01-31" },
      pull_requests: [
        {
          number: 2,
          title: "Feature",
          url: "https://github.com/a/b/pull/2",
          base: { repo: { full_name: "a/b" } },
          merged_at: "2025-01-10T00:00:00Z",
        },
      ],
    });

    const evidence = await intakeFromGitHub(
      { token: "tok", start_date: "2025-01-01", end_date: "2025-01-31" },
      { collectRawGraphQL }
    );

    expect(collectRawGraphQL).toHaveBeenCalledWith({
      start: "2025-01-01",
      end: "2025-01-31",
      noReviews: false,
      token: "tok",
      fetchFn: undefined,
    });
    expect(evidence.contributions).toHaveLength(1);
  });

  it("rejects invalid timeframe before fetching", async () => {
    const collectRawGraphQL = vi.fn();
    await expect(
      intakeFromGitHub({ token: "tok", start_date: "bad", end_date: "2025-01-01" }, { collectRawGraphQL })
    ).rejects.toThrow(EvidenceIntakeError);
    expect(collectRawGraphQL).not.toHaveBeenCalled();
  });
});
