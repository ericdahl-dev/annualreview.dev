import { describe, it, expect } from "vitest";
import { validateEvidence } from "../lib/validate-evidence.js";

describe("validateEvidence", () => {
  it("accepts valid evidence with timeframe and contributions", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        { id: "r#1", type: "pull_request", title: "Fix", url: "https://github.com/a/b/pull/1", repo: "a/b" },
      ],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts evidence with optional role_context_optional", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      role_context_optional: { level: "Senior", focus_areas: ["Backend"] },
      contributions: [],
    });
    expect(result.valid).toBe(true);
  });

  it("accepts evidence with optional goals", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      goals: "Improve system reliability\nGrow as a technical leader",
      contributions: [],
    });
    expect(result.valid).toBe(true);
  });

  it("rejects evidence with non-string goals", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      goals: ["goal 1", "goal 2"],
      contributions: [],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects missing timeframe", () => {
    const result = validateEvidence({ contributions: [] });
    expect(result.valid).toBe(false);
    expect("errors" in result && result.errors.length).toBeGreaterThan(0);
  });

  it("rejects missing contributions", () => {
    const result = validateEvidence({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" } });
    expect(result.valid).toBe(false);
  });

  it("rejects contribution with invalid type", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        { id: "r#1", type: "invalid", title: "x", url: "https://x", repo: "a/b" },
      ],
    });
    expect(result.valid).toBe(false);
  });

  it("rejects invalid timeframe.start_date format", () => {
    const result = validateEvidence({
      timeframe: { start_date: "not-a-date", end_date: "2025-12-31" },
      contributions: [],
    });
    expect(result.valid).toBe(false);
    expect("errors" in result && result.errors.some((e) => e.instancePath.includes("start_date"))).toBe(true);
  });

  it("rejects invalid timeframe.end_date format", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025/12/31" },
      contributions: [],
    });
    expect(result.valid).toBe(false);
    expect("errors" in result && result.errors.some((e) => e.instancePath.includes("end_date"))).toBe(true);
  });

  it("rejects invalid url format", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        { id: "r#1", type: "pull_request", title: "x", url: "not-a-uri", repo: "a/b" },
      ],
    });
    expect(result.valid).toBe(false);
    expect("errors" in result && result.errors.some((e) => e.instancePath.includes("url"))).toBe(true);
  });

  it("rejects invalid merged_at format", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        {
          id: "r#1",
          type: "pull_request",
          title: "x",
          url: "https://github.com/a/b/pull/1",
          repo: "a/b",
          merged_at: "not-a-datetime",
        },
      ],
    });
    expect(result.valid).toBe(false);
    expect("errors" in result && result.errors.some((e) => e.instancePath.includes("merged_at"))).toBe(true);
  });

  it("accepts valid merged_at with timezone", () => {
    const result = validateEvidence({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        {
          id: "r#1",
          type: "pull_request",
          title: "x",
          url: "https://github.com/a/b/pull/1",
          repo: "a/b",
          merged_at: "2025-01-15T14:30:00Z",
        },
      ],
    });
    expect(result.valid).toBe(true);
  });
});
