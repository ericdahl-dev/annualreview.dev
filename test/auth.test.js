import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAuthRedirectUrl,
  exchangeCodeForToken,
  getGitHubUser,
  buildCallbackRequest,
  handleCallback,
  handleMe,
  handleLogout,
} from "../lib/auth.js";
import { createSession, getSession, destroySession } from "../lib/session-store.js";

describe("auth", () => {
  const clientId = "cid";
  const clientSecret = "csec";
  const secret = "sess-secret";

  describe("getAuthRedirectUrl", () => {
    it("builds GitHub OAuth URL with scope and state", () => {
      const url = getAuthRedirectUrl("public", "state123", "https://app/cb", clientId);
      expect(url).toContain("https://github.com/login/oauth/authorize");
      expect(url).toContain("client_id=cid");
      expect(url).toContain("redirect_uri=");
      expect(url).toContain("state=state123");
      expect(url).toContain("scope=");
      expect(url).toContain("read%3Auser");
      expect(url).toContain("public_repo");
    });

    it("uses repo scope for private", () => {
      const url = getAuthRedirectUrl("private", "s", "https://x/cb", clientId);
      expect(url).toContain("scope=");
      expect(url).toContain("read%3Auser");
      expect(url).toContain("repo");
    });

    it("falls back to public scope for unknown scope value", () => {
      const url = getAuthRedirectUrl("unknown_scope", "s", "https://x/cb", clientId);
      expect(url).toContain("public_repo");
    });
  });

  describe("exchangeCodeForToken", () => {
    it("returns access_token when GitHub responds ok", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ access_token: "gho_xyz" }),
      });
      const token = await exchangeCodeForToken("code1", "https://app/cb", clientId, clientSecret, fetchFn);
      expect(token).toBe("gho_xyz");
      expect(fetchFn).toHaveBeenCalledWith(
        "https://github.com/login/oauth/access_token",
        expect.objectContaining({ method: "POST" })
      );
    });

    it("throws when response not ok", async () => {
      const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 401 });
      await expect(
        exchangeCodeForToken("bad", "https://app/cb", clientId, clientSecret, fetchFn)
      ).rejects.toThrow();
    });

    it("throws when GitHub returns error in body", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: "bad_verification_code", error_description: "The code passed is incorrect" }),
      });
      await expect(
        exchangeCodeForToken("bad", "https://app/cb", clientId, clientSecret, fetchFn)
      ).rejects.toThrow("The code passed is incorrect");
    });

    it("throws when no access_token in response", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });
      await expect(
        exchangeCodeForToken("bad", "https://app/cb", clientId, clientSecret, fetchFn)
      ).rejects.toThrow("No access_token");
    });
  });

  describe("getGitHubUser", () => {
    it("returns user login", async () => {
      const fetchFn = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ login: "alice" }),
      });
      const user = await getGitHubUser("token", fetchFn);
      expect(user.login).toBe("alice");
      expect(fetchFn).toHaveBeenCalledWith("https://api.github.com/user", expect.any(Object));
    });
  });

  describe("handleCallback", () => {
    it("buildCallbackRequest preserves non-enumerable headers", () => {
      const originalReq = {};
      Object.defineProperty(originalReq, "headers", {
        value: { cookie: "ar_oauth_state=signed" },
        enumerable: false,
      });

      const callbackReq = buildCallbackRequest(
        originalReq,
        "https://annualreview.dev/api/auth/callback/github?code=abc&state=st1"
      );

      expect(callbackReq.url).toContain("/api/auth/callback/github");
      expect(callbackReq.headers?.cookie).toBe("ar_oauth_state=signed");
    });

    it("with valid code creates session and redirects", async () => {
      const sessionId = createSession({ access_token: "old", login: "old", scope: "x" });
      destroySession(sessionId);
      const createSessionSpy = vi.fn((data) => {
        return createSession(data);
      });
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = {
        url: "/api/auth/callback/github?code=abc&state=st1",
        headers: { cookie: "ar_oauth_state=st1" },
      };
      const fetchFn = vi.fn()
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ access_token: "gho_new" }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ login: "bob" }) });
      const deps = {
        getStateFromRequest: () => "st1",
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: createSessionSpy,
        exchangeCodeForToken: (code, redirectUri) =>
          exchangeCodeForToken(code, redirectUri, clientId, clientSecret, fetchFn),
        getGitHubUser: (token) => getGitHubUser(token, fetchFn),
        redirectUri: "https://app/api/auth/callback/github",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(createSessionSpy).toHaveBeenCalledWith(
        expect.objectContaining({ access_token: "gho_new", login: "bob" })
      );
      expect(res.writeHead).toHaveBeenCalledWith(302, expect.objectContaining({ Location: expect.stringContaining("/generate") }));
      expect(res.end).toHaveBeenCalled();
    });

    it("with invalid state redirects to home with error", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc&state=st1", headers: { cookie: "ar_oauth_state=wrong" } };
      const deps = {
        getStateFromRequest: () => "wrong",
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn(),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate?error=auth_failed" });
      expect(deps.createSession).not.toHaveBeenCalled();
    });

    it("with missing state redirects to home with error", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc", headers: {} };
      const deps = {
        getStateFromRequest: () => null,
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn(),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate?error=auth_failed" });
    });

    it("fails when code is missing", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?state=st1", headers: {} };
      const deps = {
        getStateFromRequest: () => "st1",
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn(),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate?error=auth_failed" });
    });

    it("fails when stored state is null (no stored state)", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc&state=st1", headers: {} };
      const deps = {
        getStateFromRequest: () => null,
        getAndRemoveOAuthState: () => null,
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn(),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate?error=auth_failed" });
    });

    it("fails when token exchange throws", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc&state=st1", headers: {} };
      const deps = {
        getStateFromRequest: () => "st1",
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn(),
        exchangeCodeForToken: vi.fn().mockRejectedValue(new Error("exchange failed")),
        getGitHubUser: vi.fn(),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate?error=auth_failed" });
    });

    it("uses getAndRemoveOAuthState fallback when getStateFromRequest returns null", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc&state=st1", headers: {} };
      const deps = {
        getStateFromRequest: () => null,
        getAndRemoveOAuthState: (state) => state === "st1" ? "st1" : null,
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn().mockReturnValue("sess_1"),
        exchangeCodeForToken: vi.fn().mockResolvedValue("tok_abc"),
        getGitHubUser: vi.fn().mockResolvedValue({ login: "u" }),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(deps.createSession).toHaveBeenCalled();
      expect(res.writeHead).toHaveBeenCalledWith(302, { Location: "/generate" });
    });

    it("extracts scope from state param", async () => {
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const req = { url: "/api/auth/callback/github?code=abc&state=private_rand1", headers: {} };
      const deps = {
        getStateFromRequest: () => "private_rand1",
        clearStateCookie: vi.fn(),
        setSessionCookie: vi.fn(),
        createSession: vi.fn().mockReturnValue("sess_1"),
        exchangeCodeForToken: vi.fn().mockResolvedValue("tok"),
        getGitHubUser: vi.fn().mockResolvedValue({ login: "u" }),
        redirectUri: "https://app/cb",
        sessionSecret: secret,
      };
      await handleCallback(req, res, deps);
      expect(deps.createSession).toHaveBeenCalledWith(expect.objectContaining({ scope: "private" }));
    });
  });

  describe("handleMe", () => {
    it("returns login and scope when session valid", () => {
      const id = createSession({ access_token: "t", login: "user1", scope: "read:user" });
      const req = { headers: {} };
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      handleMe(req, res, {
        getSessionIdFromRequest: () => id,
        getSession: (sid) => (sid === id ? { login: "user1", scope: "read:user" } : undefined),
      });
      expect(res.writeHead).toHaveBeenCalledWith(200, { "Content-Type": "application/json" });
      expect(res.end).toHaveBeenCalledWith(JSON.stringify({ login: "user1", scope: "read:user" }));
    });

    it("returns 401 when no session", () => {
      const req = { headers: {} };
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      handleMe(req, res, {
        getSessionIdFromRequest: () => null,
        getSession: () => undefined,
      });
      expect(res.writeHead).toHaveBeenCalledWith(401);
    });
  });

  describe("handleLogout", () => {
    it("clears session and cookie", () => {
      const id = createSession({ access_token: "t", login: "u", scope: "s" });
      const req = { headers: {} };
      const res = { writeHead: vi.fn(), end: vi.fn(), setHeader: vi.fn() };
      const destroySessionFn = vi.fn();
      const clearSessionCookie = vi.fn();
      handleLogout(req, res, {
        getSessionIdFromRequest: () => id,
        destroySession: destroySessionFn,
        clearSessionCookie,
      });
      expect(destroySessionFn).toHaveBeenCalledWith(id);
      expect(clearSessionCookie).toHaveBeenCalledWith(res);
      expect(res.writeHead).toHaveBeenCalledWith(204);
    });
  });
});
