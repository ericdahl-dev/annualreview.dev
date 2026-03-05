import { describe, it, expect, vi, beforeEach } from "vitest";
import { getCreditsPerPurchase } from "../lib/payment-store.ts";
import { paymentsRoutes } from "../server/routes/payments.ts";
import { mockRes, mockReq, respondJson } from "./helpers.js";

function makeRouteOptions(overrides = {}) {
  return {
    respondJson,
    getStripe: () => null,
    getSessionIdFromRequest: () => null,
    getSession: () => undefined,
    ...overrides,
  };
}

describe("paymentsRoutes – config", () => {
  it("returns enabled:false when Stripe is not configured", async () => {
    const handler = paymentsRoutes(makeRouteOptions({ getStripe: () => null }));
    const req = mockReq("GET", "/config");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ enabled: false, price_cents: 100, credits_per_purchase: getCreditsPerPurchase() });
  });

  it("returns enabled:true when Stripe is configured", async () => {
    const mockStripe = { checkout: { sessions: {} } };
    const handler = paymentsRoutes(
      makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
    );
    const req = mockReq("GET", "/config");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, price_cents: 100, credits_per_purchase: getCreditsPerPurchase() });
  });
});

describe("paymentsRoutes – checkout", () => {
  it("returns 503 when STRIPE_SECRET_KEY is not set", async () => {
    const handler = paymentsRoutes(makeRouteOptions({ getStripe: () => null }));
    const req = mockReq("POST", "/checkout");
    const res = mockRes();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
      handler(req, res, resolve);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
  });

  it("returns 200 with url and session_id on successful checkout", async () => {
    const mockSession = { id: "cs_test_123", url: "https://checkout.stripe.com/pay/cs_test_123" };
    const mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockResolvedValue(mockSession),
        },
      },
    };
    const handler = paymentsRoutes(
      makeRouteOptions({
        getStripe: () => /** @type {any} */ (mockStripe),
        getSessionIdFromRequest: () => "session_1",
        getSession: () => ({ login: "edahl" }),
      })
    );
    const req = mockReq("POST", "/checkout");
    const res = mockRes();
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("timeout")), 500);
      const p = handler(req, res, resolve);
      p.catch(reject);
    }).catch(() => {});
    // Give async handlers time to complete
    await new Promise((r) => setTimeout(r, 100));
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ url: mockSession.url, session_id: mockSession.id });
    expect(mockStripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "payment",
        payment_method_types: ["card"],
        metadata: { user_login: "edahl" },
        line_items: expect.arrayContaining([
          expect.objectContaining({ quantity: 1 }),
        ]),
      })
    );
  });

  it("passes non-POST to next", async () => {
    const handler = paymentsRoutes(makeRouteOptions({ getStripe: () => null }));
    const req = mockReq("GET", "/checkout");
    const res = mockRes();
    let nextCalled = false;
    await handler(req, res, () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it("returns 401 when user is not logged in", async () => {
    const mockStripe = { checkout: { sessions: { create: vi.fn() } } };
    const handler = paymentsRoutes(
      makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
    );
    const req = mockReq("POST", "/checkout");
    const res = mockRes();
    await new Promise((resolve) => {
      const p = handler(req, res, resolve);
      p.then(resolve).catch(resolve);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/login required/i);
    expect(mockStripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  it("returns 500 when Stripe throws during session create", async () => {
    const mockStripe = {
      checkout: {
        sessions: {
          create: vi.fn().mockRejectedValue(new Error("stripe error")),
        },
      },
    };
    const handler = paymentsRoutes(
      makeRouteOptions({
        getStripe: () => /** @type {any} */ (mockStripe),
        getSessionIdFromRequest: () => "session_1",
        getSession: () => ({ login: "testuser" }),
      })
    );
    const req = mockReq("POST", "/checkout");
    const res = mockRes();
    await new Promise((resolve, reject) => {
      setTimeout(() => reject(new Error("timeout")), 500);
      const p = handler(req, res, resolve);
      p.catch(reject);
    }).catch(() => {});
    await new Promise((r) => setTimeout(r, 100));
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/stripe error/i);
  });
});

describe("paymentsRoutes – credits", () => {
  it("returns 401 for GET /credits when not logged in", async () => {
    const handler = paymentsRoutes(makeRouteOptions());
    const req = mockReq("GET", "/credits");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(401);
    expect(res.body.error).toMatch(/login required/i);
  });

  it("returns 200 with credits from getCredits when logged in", async () => {
    const mockGetCredits = vi.fn().mockResolvedValue(3);
    const handler = paymentsRoutes(
      makeRouteOptions({
        getSessionIdFromRequest: () => "sess_1",
        getSession: () => ({ login: "alice" }),
        getCredits: mockGetCredits,
      })
    );
    const req = mockReq("GET", "/credits");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ credits: 3 });
    expect(mockGetCredits).toHaveBeenCalledWith("alice");
  });
});

describe("paymentsRoutes – webhook", () => {
  it("returns 503 when not configured", async () => {
    const handler = paymentsRoutes(makeRouteOptions({ getStripe: () => null }));
    const req = mockReq("POST", "/webhook", {}, { "stripe-signature": "t=1,v1=abc" });
    const res = mockRes();
    await new Promise((resolve) => {
      const p = handler(req, res, resolve);
      p.then(resolve).catch(resolve);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(res.statusCode).toBe(503);
  });

  it("returns 400 when stripe-signature header is missing", async () => {
    const mockStripe = {
      webhooks: {
        constructEvent: vi.fn(),
      },
    };
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const handler = paymentsRoutes(
        makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
      );
      const req = mockReq("POST", "/webhook");
      const res = mockRes();
      await new Promise((resolve) => {
        const p = handler(req, res, resolve);
        p.then(resolve).catch(resolve);
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/stripe-signature/i);
    } finally {
      if (origSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("awards credits on checkout.session.completed when payment_status is paid", async () => {
    const stripeEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_sync_paid",
          payment_status: "paid",
          metadata: { user_login: "alice" },
        },
      },
    };
    const mockStripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(stripeEvent) },
    };
    const mockAwardCredits = vi.fn().mockResolvedValue(undefined);
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const handler = paymentsRoutes(
        makeRouteOptions({
          getStripe: () => /** @type {any} */ (mockStripe),
          awardCredits: mockAwardCredits,
        })
      );
      const req = mockReq("POST", "/webhook", {}, { "stripe-signature": "t=1,v1=abc" });
      const res = mockRes();
      await handler(req, res, () => {});
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ received: true });
      expect(mockAwardCredits).toHaveBeenCalledWith("alice", "cs_sync_paid");
    } finally {
      if (origSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("does NOT award credits on checkout.session.completed when payment_status is unpaid (async payment method)", async () => {
    const stripeEvent = {
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_async_pending",
          payment_status: "unpaid",
          metadata: { user_login: "bob" },
        },
      },
    };
    const mockStripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(stripeEvent) },
    };
    const mockAwardCredits = vi.fn().mockResolvedValue(undefined);
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const handler = paymentsRoutes(
        makeRouteOptions({
          getStripe: () => /** @type {any} */ (mockStripe),
          awardCredits: mockAwardCredits,
        })
      );
      const req = mockReq("POST", "/webhook", {}, { "stripe-signature": "t=1,v1=abc" });
      const res = mockRes();
      await handler(req, res, () => {});
      expect(res.statusCode).toBe(200);
      expect(mockAwardCredits).not.toHaveBeenCalled();
    } finally {
      if (origSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("returns 200 and does not crash on unrecognised event types", async () => {
    const stripeEvent = {
      type: "customer.subscription.updated",
      data: { object: {} },
    };
    const mockStripe = {
      webhooks: { constructEvent: vi.fn().mockReturnValue(stripeEvent) },
    };
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const handler = paymentsRoutes(
        makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
      );
      const req = mockReq("POST", "/webhook", {}, { "stripe-signature": "t=1,v1=abc" });
      const res = mockRes();
      await new Promise((resolve) => {
        const p = handler(req, res, resolve);
        p.then(resolve).catch(resolve);
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(res.statusCode).toBe(200);
      expect(res.body).toMatchObject({ received: true });
    } finally {
      if (origSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });

  it("returns 400 when constructEvent throws (invalid signature)", async () => {
    const mockStripe = {
      webhooks: {
        constructEvent: vi.fn().mockImplementation(() => {
          throw new Error("No signatures found matching the expected signature for payload");
        }),
      },
    };
    const origSecret = process.env.STRIPE_WEBHOOK_SECRET;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
    try {
      const handler = paymentsRoutes(
        makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
      );
      const req = mockReq("POST", "/webhook", {}, { "stripe-signature": "t=1,v1=bad" });
      const res = mockRes();
      await new Promise((resolve) => {
        const p = handler(req, res, resolve);
        p.then(resolve).catch(resolve);
      });
      await new Promise((r) => setTimeout(r, 100));
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/No signatures found/i);
    } finally {
      if (origSecret !== undefined) process.env.STRIPE_WEBHOOK_SECRET = origSecret;
      else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
  });
});
