import { describe, it, expect, vi, beforeEach } from "vitest";
import { generateRoutes } from "../server/routes/generate.ts";
import { clearCreditStore, awardCredits, getCredits } from "../lib/payment-store.ts";
import { mockRes, respondJson } from "./helpers.js";

const hasDb = !!process.env.DATABASE_URL;

const validEvidence = {
  timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
  contributions: [],
};

/** Build default options (not logged in). */
function makeOptions(overrides = {}) {
  const runPipeline = vi.fn().mockResolvedValue({ themes: {}, bullets: {}, stories: {}, self_eval: {} });
  const createJob = vi.fn().mockReturnValue("job-1");
  const runInBackground = vi.fn((jobId, fn) => fn(() => {}));
  return {
    readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence }),
    respondJson,
    validateEvidence: (ev) => ({ valid: !!ev?.timeframe?.start_date }),
    createJob,
    runInBackground,
    runPipeline,
    getStripe: () => null,
    getSessionIdFromRequest: vi.fn().mockReturnValue(null),
    getSession: vi.fn().mockReturnValue(undefined),
    ...overrides,
  };
}

/** Build options with a logged-in user. */
function makeOptionsLoggedIn(login, overrides = {}) {
  return makeOptions({
    getSessionIdFromRequest: vi.fn().mockReturnValue("sess_test"),
    getSession: vi.fn().mockReturnValue({ login, access_token: "tok", created_at: "2025-01-01" }),
    ...overrides,
  });
}

describe("generateRoutes – payments not configured", () => {
  it("returns 503 with PAYMENTS_NOT_CONFIGURED when wantsPremium but DB is absent", async () => {
    const opts = makeOptionsLoggedIn("alice", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _premium: true }),
      isPaymentsConfigured: () => false,
    });
    const handler = generateRoutes(opts);
    const res = mockRes();
    await handler({ method: "POST", url: "/" }, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "Premium is not available", code: "PAYMENTS_NOT_CONFIGURED" });
    expect(opts.runPipeline).not.toHaveBeenCalled();
  });

  it("returns 503 with PAYMENTS_NOT_CONFIGURED when _stripe_session_id sent but DB is absent", async () => {
    const opts = makeOptionsLoggedIn("alice", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _stripe_session_id: "cs_test" }),
      isPaymentsConfigured: () => false,
    });
    const handler = generateRoutes(opts);
    const res = mockRes();
    await handler({ method: "POST", url: "/" }, res, () => {});
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "Premium is not available", code: "PAYMENTS_NOT_CONFIGURED" });
    expect(opts.runPipeline).not.toHaveBeenCalled();
  });
});

describe.skipIf(!hasDb)("generateRoutes – premium flag", () => {
  beforeEach(async () => {
    await clearCreditStore();
  });

  it("runs free pipeline when no stripe_session_id and no _premium flag", async () => {
    const opts = makeOptions();
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(opts.createJob).toHaveBeenCalledWith("generate");
    expect(opts.runPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ premium: false })
    );
    expect(res.body).toMatchObject({ job_id: "job-1", premium: false });
    expect(res.body).not.toHaveProperty("credits_remaining");
  });

  it("returns 401 when requesting premium but not logged in", async () => {
    const opts = makeOptions({
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _stripe_session_id: "cs_test" }),
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/login required/i);
    expect(opts.runPipeline).not.toHaveBeenCalled();
  });

  it("returns 402 when stripe_session_id provided but session not paid", async () => {
    const opts = makeOptionsLoggedIn("alice", {
      readJsonBody: vi.fn().mockResolvedValue({
        ...validEvidence,
        _stripe_session_id: "cs_unpaid",
      }),
      getStripe: () => ({
        checkout: {
          sessions: {
            retrieve: vi.fn().mockResolvedValue({
              payment_status: "unpaid",
              id: "cs_unpaid",
              metadata: { user_login: "alice" },
            }),
          },
        },
      }),
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toMatch(/payment required/i);
    expect(opts.runPipeline).not.toHaveBeenCalled();
  });

  it("runs premium pipeline and deducts one credit when user has credits", async () => {
    await awardCredits("alice", "cs_prev_purchase"); // award 1 credit to alice
    const opts = makeOptionsLoggedIn("alice", {
      readJsonBody: vi.fn().mockResolvedValue({
        ...validEvidence,
        _stripe_session_id: "cs_prev_purchase", // already in credit_events — fast path
      }),
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(opts.createJob).toHaveBeenCalledWith("generate-premium");
    expect(opts.runPipeline).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ premium: true })
    );
    expect(res.body).toMatchObject({ job_id: "job-1", premium: true });
    // 1 awarded, 1 deducted → 0 remaining
    expect(res.body.credits_remaining).toBe(0);
    expect(await getCredits("alice")).toBe(0);
  });

  it("runs premium pipeline via _premium flag (no session ID needed for repeat use)", async () => {
    await awardCredits("bob", "cs_bob_purchase");
    const opts = makeOptionsLoggedIn("bob", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _premium: true }),
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(opts.createJob).toHaveBeenCalledWith("generate-premium");
    expect(res.body.credits_remaining).toBe(0);
  });

  it("verifies Stripe inline (webhook not yet fired) and awards credits to correct user", async () => {
    const mockStripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            payment_status: "paid",
            id: "cs_new",
            metadata: { user_login: "carol" },
          }),
        },
      },
    };
    const opts = makeOptionsLoggedIn("carol", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _stripe_session_id: "cs_new" }),
      getStripe: () => mockStripe,
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(opts.createJob).toHaveBeenCalledWith("generate-premium");
    // 1 awarded, 1 deducted → 0 remaining
    expect(res.body.credits_remaining).toBe(0);
  });

  it("rejects inline Stripe verify when metadata user_login does not match logged-in user", async () => {
    const mockStripe = {
      checkout: {
        sessions: {
          retrieve: vi.fn().mockResolvedValue({
            payment_status: "paid",
            id: "cs_other_user",
            metadata: { user_login: "eve" }, // different user!
          }),
        },
      },
    };
    const opts = makeOptionsLoggedIn("dave", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _stripe_session_id: "cs_other_user" }),
      getStripe: () => mockStripe,
    });
    const handler = generateRoutes(opts);
    const req = { method: "POST", url: "/" };
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(402);
    expect(opts.runPipeline).not.toHaveBeenCalled();
  });

  it("returns 402 when all credits are exhausted", async () => {
    await awardCredits("fiona", "cs_fiona");
    // Use all 1 credit
    for (let i = 0; i < 1; i++) {
      const res = mockRes();
      await generateRoutes(makeOptionsLoggedIn("fiona", {
        readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _premium: true }),
      }))({ method: "POST", url: "/" }, res, () => {});
      expect(res.statusCode).toBe(202);
    }
    // Now out of credits; getStripe returns null so inline verify fails → 402
    const res = mockRes();
    await generateRoutes(makeOptionsLoggedIn("fiona", {
      readJsonBody: vi.fn().mockResolvedValue({ ...validEvidence, _premium: true }),
    }))({ method: "POST", url: "/" }, res, () => {});
    expect(res.statusCode).toBe(402);
    expect(res.body.error).toMatch(/no premium credits/i);
  });

  it("strips _stripe_session_id and _premium from evidence before pipeline", async () => {
    await awardCredits("grace", "cs_grace");
    let capturedEvidence = null;
    const opts = makeOptionsLoggedIn("grace", {
      readJsonBody: vi.fn().mockResolvedValue({
        ...validEvidence,
        _stripe_session_id: "cs_grace",
        _premium: true,
      }),
      runPipeline: vi.fn((ev) => {
        capturedEvidence = ev;
        return Promise.resolve({ themes: {}, bullets: {}, stories: {}, self_eval: {} });
      }),
    });
    await generateRoutes(opts)({ method: "POST", url: "/" }, mockRes(), () => {});
    expect(capturedEvidence).not.toHaveProperty("_stripe_session_id");
    expect(capturedEvidence).not.toHaveProperty("_premium");
  });
});
