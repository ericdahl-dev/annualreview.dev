import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  validateEvidenceJson,
  prepareEvidenceForGenerate,
} from "../src/workspaces/generate/validation.js";
import {
  parseUrlRecovery,
  recoverStripeReturnFromUrl,
  recoverStripeAutoGenerate,
} from "../src/workspaces/generate/recovery.js";
import {
  runGenerate,
  runPremiumCheckout,
  runSaveSnapshot,
  fetchPaymentsConfig,
  fetchPremiumCredits,
  fetchLatestJobEvidence,
  fetchSnapshotEvidence,
} from "../src/workspaces/generate/commands.js";
import { PAYMENTS_NOT_CONFIGURED } from "../lib/api-error-codes.js";

const validEvidence = {
  timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
  contributions: [{ id: 1 }],
};

describe("validateEvidenceJson", () => {
  it("accepts valid evidence JSON", () => {
    const text = JSON.stringify(validEvidence);
    expect(validateEvidenceJson(text)).toEqual({ ok: true, evidence: validEvidence });
  });

  it("rejects invalid JSON", () => {
    const result = validateEvidenceJson("{not json");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/invalid json/i);
  });

  it("detects truncated JSON missing contributions", () => {
    const result = validateEvidenceJson('{"timeframe": {');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/truncated/i);
  });

  it("requires timeframe and contributions", () => {
    const result = validateEvidenceJson(JSON.stringify({ timeframe: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/timeframe/i);
  });
});

describe("prepareEvidenceForGenerate", () => {
  it("merges goals when provided", () => {
    const out = prepareEvidenceForGenerate(validEvidence, {
      goals: "Ship faster",
    });
    expect(out.goals).toBe("Ship faster");
  });

  it("attaches stripe session and posthog ids", () => {
    const out = prepareEvidenceForGenerate(validEvidence, {
      stripeSessionId: "sess_123",
      posthogDistinctId: "user-1",
      posthogTraceId: "trace-1",
    });
    expect(out._stripe_session_id).toBe("sess_123");
    expect(out.posthog_distinct_id).toBe("user-1");
    expect(out.posthog_trace_id).toBe("trace-1");
  });
});

describe("parseUrlRecovery", () => {
  it("flags auth_failed and clears query", () => {
    const replaceState = vi.fn();
    const result = parseUrlRecovery({
      search: "?error=auth_failed",
      replaceState,
    });
    expect(result.authError).toBe(true);
    expect(replaceState).toHaveBeenCalled();
  });

  it("persists premium stripe session from URL", () => {
    const local = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    const session = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    parseUrlRecovery({
      search: "?session_id=sess_abc&premium=1",
      replaceState: vi.fn(),
      storage: { local, session },
    });
    expect(local.setItem).toHaveBeenCalledWith("premium_stripe_session_id", "sess_abc");
    expect(session.setItem).toHaveBeenCalledWith("stripe_session_id", "sess_abc");
  });

  it("loads merged evidence from session storage", () => {
    const session = {
      getItem: vi.fn(() => '{"merged":true}'),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const result = parseUrlRecovery({
      search: "?from_snapshot_merge=1",
      replaceState: vi.fn(),
      storage: { local: session, session },
    });
    expect(result.evidenceText).toBe('{"merged":true}');
    expect(session.removeItem).toHaveBeenCalledWith("merged_evidence");
  });
});

describe("recoverStripeReturnFromUrl", () => {
  it("is a no-op when search has no stripe params", () => {
    expect(
      recoverStripeReturnFromUrl({
        search: "",
        replaceState: vi.fn(),
        storage: {
          local: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
          session: { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() },
        },
      })
    ).toBeNull();
  });
});

describe("recoverStripeAutoGenerate", () => {
  it("returns saved session, evidence, and goals", () => {
    const session = {
      getItem: vi.fn((key: string) => {
        if (key === "stripe_session_id") return "sess_1";
        if (key === "premium_evidence") return JSON.stringify(validEvidence);
        if (key === "premium_goals") return "Goal A";
        return null;
      }),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const result = recoverStripeAutoGenerate({ session });
    expect(result).toEqual({
      sessionId: "sess_1",
      evidenceText: JSON.stringify(validEvidence),
      goals: "Goal A",
    });
    expect(session.removeItem).toHaveBeenCalledWith("stripe_session_id");
    expect(session.removeItem).toHaveBeenCalledWith("premium_evidence");
    expect(session.removeItem).toHaveBeenCalledWith("premium_goals");
  });

  it("returns null when stripe session is missing", () => {
    const session = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    expect(recoverStripeAutoGenerate({ session })).toBeNull();
  });
});

describe("runGenerate", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("polls async jobs and returns premium result metadata", async () => {
    const pollJob = vi.fn().mockResolvedValue({ themes: [] });
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        text: () =>
          Promise.resolve(
            JSON.stringify({ job_id: "j1", premium: true, credits_remaining: 2 })
          ),
      } as Response);

    const onProgress = vi.fn();
    const capture = vi.fn();
    const result = await runGenerate({
      fetch,
      parseJsonResponse: async (res: Response) => JSON.parse(await res.text()),
      pollJob,
      evidenceText: JSON.stringify(validEvidence),
      goals: "",
      onProgress,
      posthog: { capture },
    });

    expect(pollJob).toHaveBeenCalledWith("j1", onProgress);
    expect(result).toEqual({
      ok: true,
      result: { themes: [] },
      isPremium: true,
      creditsRemaining: 2,
    });
    expect(capture).toHaveBeenCalledWith("review_generate_completed", { premium: true });
  });

  it("returns validation error without calling fetch", async () => {
    const result = await runGenerate({
      fetch,
      parseJsonResponse: async (res: Response) => JSON.parse(await res.text()),
      pollJob: vi.fn(),
      evidenceText: "bad",
      goals: "",
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/invalid json/i) });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps PAYMENTS_NOT_CONFIGURED to friendly error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: () =>
        Promise.resolve(JSON.stringify({ code: PAYMENTS_NOT_CONFIGURED, error: "nope" })),
    } as Response);

    const result = await runGenerate({
      fetch,
      parseJsonResponse: async (res: Response) => JSON.parse(await res.text()),
      pollJob: vi.fn(),
      evidenceText: JSON.stringify(validEvidence),
      goals: "",
      stripeSessionId: "sess_1",
      posthog: { capture: vi.fn() },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not available in this environment/i);
    }
  });
});

describe("runPremiumCheckout", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects when evidence is missing", async () => {
    const result = await runPremiumCheckout({
      fetch,
      parseJsonResponse: async (res: Response) => JSON.parse(await res.text()),
      evidenceText: "bad",
      goals: "",
      session: { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() },
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/load your evidence/i) });
  });

  it("saves evidence and redirects to checkout url", async () => {
    const session = { setItem: vi.fn(), getItem: vi.fn(), removeItem: vi.fn() };
    const assign = vi.fn();
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ url: "https://stripe.test/checkout" })),
    } as Response);

    const result = await runPremiumCheckout({
      fetch,
      parseJsonResponse: async (res: Response) => JSON.parse(await res.text()),
      evidenceText: JSON.stringify(validEvidence),
      goals: "Ship",
      session,
      redirect: assign,
      posthog: { capture: vi.fn() },
    });

    expect(result).toEqual({ ok: true });
    expect(session.setItem).toHaveBeenCalledWith("premium_evidence", JSON.stringify(validEvidence));
    expect(session.setItem).toHaveBeenCalledWith("premium_goals", "Ship");
    expect(assign).toHaveBeenCalledWith("https://stripe.test/checkout");
  });
});

describe("runSaveSnapshot", () => {
  it("validates evidence before saving", async () => {
    const saveSnapshot = vi.fn();
    const result = await runSaveSnapshot({
      evidenceText: "bad",
      snapshotPeriod: "weekly",
      snapshotLabel: "",
      saveSnapshot,
    });
    expect(result).toEqual({ ok: false, error: expect.stringMatching(/invalid json/i) });
    expect(saveSnapshot).not.toHaveBeenCalled();
  });

  it("saves snapshot with parsed timeframe", async () => {
    const saveSnapshot = vi.fn().mockResolvedValue("snap-1");
    const result = await runSaveSnapshot({
      evidenceText: JSON.stringify(validEvidence),
      snapshotPeriod: "monthly",
      snapshotLabel: "Q1",
      saveSnapshot,
    });
    expect(result).toEqual({ ok: true, id: "snap-1" });
    expect(saveSnapshot).toHaveBeenCalledWith({
      period: "monthly",
      start_date: "2025-01-01",
      end_date: "2025-12-31",
      evidence: validEvidence,
      label: "Q1",
    });
  });
});

describe("fetch helpers", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetchPaymentsConfig returns defaults on failure", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new Error("network"));
    const config = await fetchPaymentsConfig(fetch);
    expect(config.enabled).toBe(false);
  });

  it("fetchPremiumCredits returns account credits", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ credits: 3 })),
    } as Response);
    expect(await fetchPremiumCredits(fetch)).toBe(3);
  });

  it("fetchLatestJobEvidence returns stringified result", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({ latest: { status: "done", result: validEvidence } })),
    } as Response);
    const text = await fetchLatestJobEvidence(fetch);
    expect(text).toBe(JSON.stringify(validEvidence, null, 2));
  });

  it("fetchSnapshotEvidence returns stringified evidence", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ evidence: validEvidence })),
    } as Response);
    const text = await fetchSnapshotEvidence(fetch, "snap-1");
    expect(text).toBe(JSON.stringify(validEvidence, null, 2));
  });
});
