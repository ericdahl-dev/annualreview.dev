import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseJsonResponse, pollJob } from "../src/api.js";

describe("parseJsonResponse", () => {
  it("parses valid JSON from ok response", async () => {
    const res = { ok: true, status: 200, text: () => Promise.resolve('{"a":1}') };
    expect(await parseJsonResponse(res)).toEqual({ a: 1 });
  });

  it("throws on empty body with ok=true", async () => {
    const res = { ok: true, status: 200, text: () => Promise.resolve("   ") };
    await expect(parseJsonResponse(res)).rejects.toThrow(/empty response/i);
  });

  it("throws with status on empty body with ok=false", async () => {
    const res = { ok: false, status: 500, text: () => Promise.resolve("") };
    await expect(parseJsonResponse(res)).rejects.toThrow(/500/);
  });

  it("throws on invalid JSON", async () => {
    const res = { ok: true, status: 200, text: () => Promise.resolve("not json") };
    await expect(parseJsonResponse(res)).rejects.toThrow(/invalid response/i);
  });
});

describe("pollJob", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throws when job status is failed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: "failed", error: "kaboom" })),
    });
    await expect(pollJob("j1")).rejects.toThrow("kaboom");
  });

  it("throws when response is not ok", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false, status: 404, text: () => Promise.resolve(JSON.stringify({ error: "Job not found" })),
    });
    await expect(pollJob("j1")).rejects.toThrow("Job not found");
  });

  it("calls onProgress when progress field is present", async () => {
    const onProgress = vi.fn();
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: "running", progress: "step1" })),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: "done", result: {} })),
      });
    const p = pollJob("j1", onProgress);
    await vi.advanceTimersByTimeAsync(0);
    expect(onProgress).toHaveBeenCalledWith("step1");
    await vi.advanceTimersByTimeAsync(500);
    await p;
  });

  it("does not crash when onProgress is omitted", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: "running", progress: "x" })),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ status: "done", result: 42 })),
      });
    const p = pollJob("j1");
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(500);
    expect(await p).toBe(42);
  });
});
