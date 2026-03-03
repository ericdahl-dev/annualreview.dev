import { describe, it, expect, vi, beforeEach } from "vitest";
import { paymentsRoutes } from "../server/routes/payments.ts";

function mockRes(status = 200) {
  const chunks = [];
  return {
    statusCode: status,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(data) { this._body = data; },
    _body: null,
    get body() { return JSON.parse(this._body || "{}"); },
  };
}

function mockReq(method, url, body = {}, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  const r = {
    method,
    url,
    headers: { "content-type": "application/json", "host": "localhost:3000", ...headers },
    _buf: buf,
    _pos: 0,
    on(event, handler) {
      if (event === "data") setTimeout(() => handler(buf), 0);
      if (event === "end") setTimeout(() => handler(), 0);
      return this;
    },
  };
  return r;
}

function respondJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

function makeRouteOptions(overrides = {}) {
  return {
    respondJson,
    getStripe: () => null,
    getPostHog: () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(true) }),
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
    expect(res.body).toMatchObject({ enabled: false, price_cents: 100, credits_per_purchase: 5 });
  });

  it("returns enabled:false when feature flag is off", async () => {
    const mockStripe = { checkout: { sessions: {} } };
    const handler = paymentsRoutes(
      makeRouteOptions({
        getStripe: () => /** @type {any} */ (mockStripe),
        getPostHog: () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }),
      })
    );
    const req = mockReq("GET", "/config");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ enabled: false });
  });

  it("returns enabled:true when Stripe is configured and flag is on", async () => {
    const mockStripe = { checkout: { sessions: {} } };
    const handler = paymentsRoutes(
      makeRouteOptions({ getStripe: () => /** @type {any} */ (mockStripe) })
    );
    const req = mockReq("GET", "/config");
    const res = mockRes();
    await handler(req, res, () => {});
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ enabled: true, price_cents: 100, credits_per_purchase: 5 });
  });
});

describe("paymentsRoutes – checkout", () => {
  it("returns 503 when feature flag is disabled", async () => {
    const handler = paymentsRoutes(
      makeRouteOptions({
        getPostHog: () => ({ isFeatureEnabled: vi.fn().mockResolvedValue(false) }),
      })
    );
    const req = mockReq("POST", "/checkout");
    const res = mockRes();
    await new Promise((resolve) => {
      setTimeout(resolve, 50);
      handler(req, res, resolve);
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(res.statusCode).toBe(503);
    expect(res.body.error).toMatch(/disabled/i);
  });

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
      setTimeout(() => reject(new Error("timeout")), 2000);
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
});
