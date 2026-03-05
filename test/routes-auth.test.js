import { describe, it, expect, vi } from "vitest";
import { authRoutes } from "../server/routes/auth.ts";
import { mockRes, respondJson } from "./helpers.js";

function makeOptions(overrides = {}) {
  return {
    sessionSecret: "test-secret",
    clientId: "cid",
    clientSecret: "csec",
    getRequestContext: () => ({
      origin: "http://localhost:3000",
      redirectUri: "http://localhost:3000/api/auth/callback/github",
      cookieOpts: {},
      basePath: "/api/auth",
    }),
    getSessionIdFromRequest: () => null,
    getSession: () => undefined,
    destroySession: vi.fn(),
    setSessionCookie: vi.fn(),
    clearSessionCookie: vi.fn(),
    setStateCookie: vi.fn(),
    getStateFromRequest: () => null,
    clearStateCookie: vi.fn(),
    getAndRemoveOAuthState: vi.fn(),
    setOAuthState: vi.fn(),
    createSession: vi.fn().mockReturnValue("sess_1"),
    exchangeCodeForToken: vi.fn().mockResolvedValue("tok_abc"),
    getGitHubUser: vi.fn().mockResolvedValue({ login: "octocat" }),
    handleCallback: vi.fn().mockResolvedValue(undefined),
    handleMe: vi.fn(),
    handleLogout: vi.fn(),
    getAuthRedirectUrl: vi.fn().mockReturnValue("https://github.com/login/oauth/authorize?x=1"),
    respondJson,
    randomState: () => "rand123",
    buildCallbackRequest: undefined,
    log: vi.fn(),
    ...overrides,
  };
}

describe("authRoutes – GET /github", () => {
  it("redirects to GitHub OAuth URL", () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/github?scope=public", headers: {} };
    const res = mockRes();
    res.writeHead = vi.fn();
    res.end = vi.fn();
    handler(req, res, () => {});
    expect(opts.setStateCookie).toHaveBeenCalled();
    expect(opts.setOAuthState).toHaveBeenCalled();
    expect(opts.getAuthRedirectUrl).toHaveBeenCalledWith("public", "public_rand123", expect.any(String), "cid");
    expect(res.writeHead).toHaveBeenCalledWith(302, { Location: expect.any(String) });
  });

  it("returns 500 when clientId is not set", () => {
    const handler = authRoutes(makeOptions({ clientId: undefined }));
    const req = { method: "GET", url: "/github", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/GITHUB_CLIENT_ID/);
  });

  it("extracts scope from query string", () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/github?scope=repo", headers: {} };
    const res = mockRes();
    res.writeHead = vi.fn();
    res.end = vi.fn();
    handler(req, res, () => {});
    expect(opts.getAuthRedirectUrl).toHaveBeenCalledWith("repo", "repo_rand123", expect.any(String), "cid");
  });
});

describe("authRoutes – GET /callback/github", () => {
  it("delegates to handleCallback", async () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/callback/github?code=abc&state=s1", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    await vi.waitFor(() => expect(opts.handleCallback).toHaveBeenCalled());
  });

  it("uses buildCallbackRequest when provided", async () => {
    const buildCallbackRequest = vi.fn((req, fullUrl) => ({ url: fullUrl, headers: req.headers }));
    const opts = makeOptions({ buildCallbackRequest });
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/callback/github?code=abc", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    await vi.waitFor(() => expect(buildCallbackRequest).toHaveBeenCalled());
  });

  it("catches handleCallback errors and returns 500", async () => {
    const opts = makeOptions({
      handleCallback: vi.fn().mockRejectedValue(new Error("boom")),
    });
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/callback/github?code=abc", headers: {} };
    const res = mockRes();
    res.writeHead = vi.fn();
    handler(req, res, () => {});
    await vi.waitFor(() => expect(res.writeHead).toHaveBeenCalledWith(500));
  });
});

describe("authRoutes – GET /me", () => {
  it("delegates to handleMe", () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/me", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(opts.handleMe).toHaveBeenCalled();
  });
});

describe("authRoutes – POST /logout", () => {
  it("delegates to handleLogout", () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "POST", url: "/logout", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(opts.handleLogout).toHaveBeenCalled();
  });
});

describe("authRoutes – unknown route", () => {
  it("calls next for unmatched paths", () => {
    const handler = authRoutes(makeOptions());
    const req = { method: "GET", url: "/unknown", headers: {} };
    const res = mockRes();
    const next = vi.fn();
    handler(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
