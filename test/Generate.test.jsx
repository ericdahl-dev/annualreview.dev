/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Generate from "../src/Generate.tsx";
import { pollJob } from "../src/api.js";

/** Response-like mock: component uses res.text() or res.json() depending on route. */
function mockRes(body, ok = true, status = ok ? 200 : 400) {
  const str = typeof body === "string" ? body : JSON.stringify(body);
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  return {
    ok,
    status,
    text: () => Promise.resolve(str),
    json: () => Promise.resolve(parsed),
  };
}

describe("Generate", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      return Promise.reject(new Error("Unmocked: " + url));
    });
  });

  it("renders title and evidence textarea", async () => {
    render(<Generate />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.any(Object)));
    expect(screen.getByRole("heading", { name: /generate review/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/timeframe.*contributions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate review/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /sign in with github/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /paste a personal access token/i })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /use the terminal/i })).toBeInTheDocument();
  });

  it("Try sample loads sample JSON into textarea", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({}, false, 401))           // /api/auth/me
      .mockResolvedValueOnce(mockRes({ enabled: false }))       // /api/payments/config
      .mockResolvedValueOnce(
        mockRes({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] })
      );
    render(<Generate />);
    fireEvent.click(screen.getByRole("button", { name: /try sample/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue(/"start_date": "2025-01-01"/)).toBeInTheDocument();
    });
  });

  it("shows error on invalid JSON when clicking Generate", async () => {
    render(<Generate />);
    const textarea = screen.getByPlaceholderText(/timeframe.*contributions/);
    fireEvent.change(textarea, { target: { value: "not json" } });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid json/i)).toBeInTheDocument();
    });
  });

  it("shows error when evidence missing timeframe or contributions", async () => {
    render(<Generate />);
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
      target: { value: "{}" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByText(/timeframe.*contributions/i)).toBeInTheDocument();
    });
  });

  it("Fetch my data: prompts for token when empty", async () => {
    render(<Generate />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.any(Object)));
    fireEvent.click(screen.getByRole("tab", { name: /paste a personal access token/i }));
    fireEvent.click(screen.getByRole("button", { name: /fetch my data/i }));
    await waitFor(() => {
      expect(screen.getByText(/paste your github token above/i)).toBeInTheDocument();
    });
    // Only the two mount-time fetches (auth/me + payments/config) — no collect call.
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalledWith("/api/collect", expect.anything());
  });

  it("Fetch my data: on success fills evidence textarea (background job)", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [{ id: "org/repo#1", type: "pull_request", title: "Fix", url: "https://github.com/org/repo/pull/1", repo: "org/repo" }],
    };
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({}, false, 401))           // /api/auth/me
      .mockResolvedValueOnce(mockRes({ enabled: false }))       // /api/payments/config
      .mockResolvedValueOnce(mockRes({ job_id: "j1" }, true, 202))  // /api/collect
      .mockResolvedValueOnce(mockRes({ status: "done", result: evidence })); // /api/jobs/j1
    render(<Generate />);
    fireEvent.click(screen.getByRole("tab", { name: /paste a personal access token/i }));
    const tokenInput = screen.getByPlaceholderText(/paste your github token/i);
    fireEvent.change(tokenInput, { target: { value: "ghp_test" } });
    fireEvent.click(screen.getByRole("button", { name: /fetch my data/i }));
    await waitFor(() => {
      expect(screen.getByDisplayValue(/"start_date": "2025-01-01"/)).toBeInTheDocument();
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/collect",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: expect.stringContaining("ghp_test"),
      })
    );
    expect(fetch).toHaveBeenCalledWith("/api/jobs/j1");
  });

  it("Fetch my data: on API error shows message", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({}, false, 401))           // /api/auth/me
      .mockResolvedValueOnce(mockRes({ enabled: false }))       // /api/payments/config
      .mockResolvedValueOnce(mockRes({ error: "Invalid token" }, false)); // /api/collect
    render(<Generate />);
    fireEvent.click(screen.getByRole("tab", { name: /paste a personal access token/i }));
    fireEvent.change(screen.getByPlaceholderText(/paste your github token/i), { target: { value: "ghp_bad" } });
    fireEvent.click(screen.getByRole("button", { name: /fetch my data/i }));
    await waitFor(() => {
      expect(screen.getByText(/invalid token/i)).toBeInTheDocument();
    });
  });

  it("when signed in shows Signed in as login and Fetch my data on first tab", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({ login: "alice", scope: "read:user" })) // /api/auth/me
      .mockResolvedValueOnce(mockRes({ enabled: false }))                      // /api/payments/config
      .mockResolvedValueOnce(mockRes({ latest: null }));                        // /api/jobs
    render(<Generate />);
    await waitFor(() => {
      expect(screen.getByText("alice")).toBeInTheDocument();
    });
    expect(screen.getByText(/signed in as/i)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /fetch your data/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /fetch my data/i })).toBeInTheDocument();
  });

  it("premium button hidden when payments not enabled", async () => {
    render(<Generate />);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/payments/config"));
    expect(screen.queryByRole("button", { name: /premium/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate review/i })).toBeInTheDocument();
  });

  it("premium button shown when payments are enabled", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: true, credits_per_purchase: 1, price_cents: 100 }));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /premium/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /1 run \(/i })).toBeInTheDocument();
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

  it("uses adaptive backoff: first wait 500ms, then 750ms, then resolves when job done", async () => {
    const result = { themes: [], bullets: {}, stories: {}, self_eval: {} };
    vi.mocked(fetch)
      .mockResolvedValueOnce(mockRes({ status: "running", progress: "1/4 Themes" }))
      .mockResolvedValueOnce(mockRes({ status: "running", progress: "2/4 Bullets" }))
      .mockResolvedValueOnce(mockRes({ status: "done", result }));
    const p = pollJob("j1", vi.fn());
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(750);
    expect(fetch).toHaveBeenCalledTimes(3);
    const out = await p;
    expect(out).toEqual(result);
  });
});
