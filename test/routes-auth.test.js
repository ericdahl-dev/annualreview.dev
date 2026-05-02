import { describe, it, expect, vi } from "vitest";
import { authRoutes } from "../server/routes/auth.ts";
import { mockRes } from "./helpers.js";

function makeAuth(overrides = {}) {
  return {
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
    buildCallbackRequest: undefined,
    ...overrides,
  };
}

function makeOptions(overrides = {}) {
  const { auth: authOverrides, ...rest } = overrides;
  return {
    sessionSecret: "test-secret",
    clientId: "cid",
    getRequestContext: () => ({
      origin: "http://localhost:3000",
      redirectUri: "http://localhost:3000/api/auth/callback/github",
      cookieOpts: {},
      basePath: "/api/auth",
    }),
    auth: makeAuth(authOverrides),
    log: vi.fn(),
    ...rest,
  };
}

describe("authRoutes – GET /github", () => {
  it("redirects to GitHub OAuth URL", () => {
    const opts = makeOptions();
    // Inject deterministic randomState for test assertions
    const origRandom = Math.random;
    Math.random = () => 0;
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/github?scope=public", headers: {} };
    const res = mockRes();
    res.writeHead = vi.fn();
    res.end = vi.fn();
    handler(req, res, () => {});
    Math.random = origRandom;
    expect(opts.auth.setStateCookie).toHaveBeenCalled();
    expect(opts.auth.setOAuthState).toHaveBeenCalled();
    expect(opts.auth.getAuthRedirectUrl).toHaveBeenCalledWith("public", expect.any(String), expect.any(String), "cid");
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
    expect(opts.auth.getAuthRedirectUrl).toHaveBeenCalledWith("repo", expect.stringMatching(/^repo_/), expect.any(String), "cid");
  });
});

describe("authRoutes – GET /callback/github", () => {
  it("delegates to handleCallback", async () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/callback/github?code=abc&state=s1", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    await vi.waitFor(() => expect(opts.auth.handleCallback).toHaveBeenCalled());
  });

  it("uses buildCallbackRequest when provided", async () => {
    const buildCallbackRequest = vi.fn((req, fullUrl) => ({ url: fullUrl, headers: req.headers }));
    const opts = makeOptions({ auth: { buildCallbackRequest } });
    const handler = authRoutes(opts);
    const req = { method: "GET", url: "/callback/github?code=abc", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    await vi.waitFor(() => expect(buildCallbackRequest).toHaveBeenCalled());
  });

  it("catches handleCallback errors and returns 500", async () => {
    const opts = makeOptions({ auth: { handleCallback: vi.fn().mockRejectedValue(new Error("boom")) } });
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
    expect(opts.auth.handleMe).toHaveBeenCalled();
  });
});

describe("authRoutes – POST /logout", () => {
  it("delegates to handleLogout", () => {
    const opts = makeOptions();
    const handler = authRoutes(opts);
    const req = { method: "POST", url: "/logout", headers: {} };
    const res = mockRes();
    handler(req, res, () => {});
    expect(opts.auth.handleLogout).toHaveBeenCalled();
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
