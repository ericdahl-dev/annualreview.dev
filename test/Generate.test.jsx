/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Generate from "../src/Generate.tsx";
import { pollJob } from "../src/api.js";
import { PAYMENTS_NOT_CONFIGURED } from "../lib/api-error-codes.ts";

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

  it("shows specific message when API returns 503 PAYMENTS_NOT_CONFIGURED", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      if (String(url) === "/api/generate")
        return Promise.resolve(
          mockRes({ error: "Premium is not available", code: PAYMENTS_NOT_CONFIGURED }, false, 503)
        );
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/payments/config"));
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
      target: {
        value: JSON.stringify({
          timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
          contributions: [],
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByText(/premium generation is not available/i)).toBeInTheDocument();
    });
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
    expect(screen.getByRole("button", { name: /1 credits for \$1\.00/i })).toBeInTheDocument();
  });

  it("shows truncated JSON message when paste ends with bracket/comma and no contributions", async () => {
    render(<Generate />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.any(Object)));
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
      target: { value: '{"timeframe":{"start_date":"2025-01-01","end_date":"2025-12-31"},' },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByText(/truncated/i)).toBeInTheDocument();
    });
  });

  it("on 200 response without job_id sets result directly", async () => {
    const directResult = { themes: { themes: [] }, bullets: {}, stories: {}, self_eval: { sections: {} } };
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      if (String(url) === "/api/generate") return Promise.resolve(mockRes(directResult, true, 200));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    const evidence = JSON.stringify({
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    });
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), { target: { value: evidence } });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /your review/i })).toBeInTheDocument();
    });
  });

  it("updates premium credits when 202 response includes credits_remaining", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: true, credits_per_purchase: 1, price_cents: 100 }));
      if (String(url) === "/api/generate")
        return Promise.resolve(mockRes({ job_id: "j1", premium: true, credits_remaining: 2 }, true, 202));
      if (String(url).includes("/api/jobs/")) return Promise.resolve(mockRes({ status: "done", result: { themes: { themes: [] }, bullets: {}, stories: {}, self_eval: {} } }));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
      target: { value: JSON.stringify({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] }) },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /your review/i })).toBeInTheDocument();
    });
    expect(screen.getByText(/2 credits left/i)).toBeInTheDocument();
  });

  it("Upgrade to premium with invalid evidence shows load evidence message", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: true, credits_per_purchase: 1, price_cents: 100 }));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    await waitFor(() => expect(screen.getByRole("button", { name: /upgrade to premium/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /upgrade to premium/i }));
    await waitFor(() => {
      expect(screen.getByText(/load your evidence data first/i)).toBeInTheDocument();
    });
  });

  it("file upload sets evidence text", async () => {
    const content = JSON.stringify({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] });
    const file = new File([content], "evidence.json", { type: "application/json" });
    class MockFileReader {
      result = null;
      onload = null;
      readAsText(blob) {
        const text = blob instanceof File ? content : "";
        queueMicrotask(() => {
          this.result = text;
          this.onload?.();
        });
      }
    }
    vi.stubGlobal("FileReader", MockFileReader);
    try {
      render(<Generate />);
      await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.any(Object)));
      const input = document.querySelector('input[type="file"]');
      fireEvent.change(input, { target: { files: [file] } });
      await waitFor(() => {
        const textarea = screen.getByPlaceholderText(/timeframe.*contributions/);
        expect(textarea.value).toContain("2025-01-01");
        expect(textarea.value).toContain("contributions");
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Try sample shows error when fetch fails", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      const s = String(url);
      if (s.includes("/api/auth/me")) return Promise.resolve(mockRes({}, false, 401));
      if (s.includes("/api/payments/config")) return Promise.resolve(mockRes({ enabled: false }));
      // Any other URL → 404 (don't use mockRes with "" as it does JSON.parse)
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(""), json: () => Promise.resolve({}) });
    });
    render(<Generate />);
    fireEvent.click(screen.getByRole("button", { name: /try sample/i }));
    await waitFor(() => {
      expect(screen.getByText(/Sample not found \(404\)/)).toBeInTheDocument();
    });
  });

  it("Download .md after generate creates download link", async () => {
    const result = { themes: { themes: [] }, bullets: { bullets_by_theme: [], top_10_bullets_overall: [] }, stories: { stories: [] }, self_eval: { sections: { summary: { text: "Done" } } } };
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      if (String(url) === "/api/generate") return Promise.resolve(mockRes(result, true, 200));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    const createObjectURL = vi.fn(() => "blob:mock");
    const revokeObjectURL = vi.fn();
    const origCreate = URL.createObjectURL;
    const origRevoke = URL.revokeObjectURL;
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    try {
      render(<Generate />);
      fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
        target: { value: JSON.stringify({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] }) },
      });
      fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
      await waitFor(() => expect(screen.getByRole("button", { name: /download \.md/i })).toBeInTheDocument());
      fireEvent.click(screen.getByRole("button", { name: /download \.md/i }));
      expect(createObjectURL).toHaveBeenCalled();
      expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock");
    } finally {
      URL.createObjectURL = origCreate;
      URL.revokeObjectURL = origRevoke;
    }
  });

  it("Log out calls logout and clears signed-in state", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({ login: "bob" }));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      if (String(url) === "/api/auth/logout") return Promise.resolve(mockRes({}));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    await waitFor(() => expect(screen.getByText("bob")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /log out/i }));
    await waitFor(() => {
      expect(screen.queryByText("bob")).not.toBeInTheDocument();
    });
  });

  it("shows auth error when URL has error=auth_failed", async () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(window, "location");
    const loc = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        search: "?error=auth_failed",
        pathname: "/generate",
        origin: loc.origin,
        replaceState: vi.fn(),
        href: loc.href,
        assign: loc.assign,
        reload: loc.reload,
      },
    });
    try {
      render(<Generate />);
      await waitFor(() => {
        expect(screen.getByRole("alert")).toHaveTextContent(/sign-in.*complete|callback URL/i);
      });
    } finally {
      if (origDescriptor) {
        Object.defineProperty(window, "location", origDescriptor);
      }
    }
  });

  it("Use the terminal tab shows terminal instructions", async () => {
    render(<Generate />);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith("/api/auth/me", expect.any(Object)));
    fireEvent.click(screen.getByRole("tab", { name: /use the terminal/i }));
    expect(screen.getByRole("heading", { name: /use the terminal/i })).toBeInTheDocument();
    expect(screen.getByText(/GITHUB_TOKEN=ghp_your_token/)).toBeInTheDocument();
  });

  it("displays formatted model names when payments config includes free_model and premium_model", async () => {
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config")
        return Promise.resolve(mockRes({ enabled: true, free_model: "anthropic/claude-3.5-sonnet", premium_model: "openai/gpt-4o-mini", credits_per_purchase: 1, price_cents: 100 }));
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    await waitFor(() => {
      expect(screen.getByText(/Claude 3\.5 Sonnet/i)).toBeInTheDocument();
      expect(screen.getByText(/GPT 4o Mini/i)).toBeInTheDocument();
    });
  });

  it("when generating, shows progress UI and hides both generate buttons", async () => {
    let jobResolve;
    const jobHang = new Promise((r) => { jobResolve = r; });
    let jobCalls = 0;
    vi.mocked(fetch).mockImplementation((url) => {
      if (String(url) === "/api/auth/me") return Promise.resolve(mockRes({}, false, 401));
      if (String(url) === "/api/payments/config") return Promise.resolve(mockRes({ enabled: false }));
      if (String(url) === "/api/generate") return Promise.resolve(mockRes({ job_id: "j1" }, true, 202));
      if (String(url).includes("/api/jobs/")) {
        jobCalls++;
        return jobCalls === 1
          ? Promise.resolve(mockRes({ status: "running", progress: "1/5 Themes" }))
          : jobHang;
      }
      return Promise.reject(new Error("Unmocked: " + url));
    });
    render(<Generate />);
    fireEvent.change(screen.getByPlaceholderText(/timeframe.*contributions/), {
      target: {
        value: JSON.stringify({
          timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
          contributions: [],
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate review/i }));
    await waitFor(() => {
      expect(screen.getByText(/1\/5/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("progressbar", { name: /generating review/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /generate review/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /premium/i })).not.toBeInTheDocument();
    jobResolve({ status: "done", result: { themes: { themes: [] }, bullets: {}, stories: {}, self_eval: {} } });
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
