import { describe, it, expect } from "vitest";
import {
  signSessionId,
  verifySessionId,
  getSessionIdFromRequest,
  setSessionCookie,
  clearSessionCookie,
  setStateCookie,
  getStateFromRequest,
  clearStateCookie,
} from "../lib/cookies.js";

const SECRET = "test-secret";

describe("cookies", () => {
  it("signSessionId and verifySessionId round-trip", () => {
    const id = "sess_123";
    const signed = signSessionId(id, SECRET);
    expect(signed).not.toBe(id);
    expect(verifySessionId(signed, SECRET)).toBe(id);
  });

  it("verifySessionId returns null for tampered value", () => {
    const signed = signSessionId("sess_123", SECRET);
    expect(verifySessionId(signed + "x", SECRET)).toBeNull();
    expect(verifySessionId("invalid", SECRET)).toBeNull();
  });

  it("getSessionIdFromRequest returns id when cookie present and valid", () => {
    const signed = signSessionId("sess_abc", SECRET);
    const req = { headers: { cookie: `ar_session=${encodeURIComponent(signed)}` } };
    expect(getSessionIdFromRequest(req, SECRET)).toBe("sess_abc");
  });

  it("getSessionIdFromRequest returns null when no cookie", () => {
    const req = { headers: {} };
    expect(getSessionIdFromRequest(req, SECRET)).toBeNull();
  });

  it("setSessionCookie sets Set-Cookie header", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    setSessionCookie(res, "sess_xyz", SECRET, {});
    expect(res._headers["Set-Cookie"]).toBeDefined();
    expect(res._headers["Set-Cookie"]).toContain("ar_session=");
    expect(res._headers["Set-Cookie"]).toContain("HttpOnly");
  });

  it("clearSessionCookie sets Set-Cookie with Max-Age=0", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    clearSessionCookie(res);
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("setStateCookie and getStateFromRequest round-trip with signature", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    setStateCookie(res, "public_st_123", SECRET);
    expect(res._headers["Set-Cookie"]).toContain("ar_oauth_state=");
    const encoded = res._headers["Set-Cookie"].split(";")[0].replace("ar_oauth_state=", "").trim();
    const req = { headers: { cookie: `ar_oauth_state=${encoded}` } };
    expect(getStateFromRequest(req, SECRET)).toBe("public_st_123");
  });

  it("getStateFromRequest returns null for tampered state cookie", () => {
    const req = { headers: { cookie: "ar_oauth_state=public_st_123.badsig" } };
    expect(getStateFromRequest(req, SECRET)).toBeNull();
  });

  it("clearStateCookie sets Set-Cookie with Max-Age=0", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    clearStateCookie(res);
    expect(res._headers["Set-Cookie"]).toContain("ar_oauth_state=;");
    expect(res._headers["Set-Cookie"]).toContain("Max-Age=0");
  });

  it("getStateFromRequest returns null when secret is falsy", () => {
    const log = { calls: [], fn(msg, detail) { log.calls.push([msg, detail]); } };
    const req = { headers: { cookie: "ar_oauth_state=x" } };
    expect(getStateFromRequest(req, "", { log: log.fn })).toBeNull();
    expect(log.calls[0]).toEqual(["state_cookie", "no_secret"]);
  });

  it("getStateFromRequest returns null when state cookie is missing from header", () => {
    const log = { calls: [], fn(msg, detail) { log.calls.push([msg, detail]); } };
    const req = { headers: { cookie: "other=1" } };
    expect(getStateFromRequest(req, SECRET, { log: log.fn })).toBeNull();
    expect(log.calls[0]).toEqual(["state_cookie", "no_match"]);
  });

  it("getStateFromRequest returns null when cookie has no dot separator", () => {
    const log = { calls: [], fn(msg, detail) { log.calls.push([msg, detail]); } };
    const req = { headers: { cookie: "ar_oauth_state=nodot" } };
    expect(getStateFromRequest(req, SECRET, { log: log.fn })).toBeNull();
    expect(log.calls[0]).toEqual(["state_cookie", "bad_format"]);
  });

  it("verifySessionId returns null for empty/non-string input", () => {
    expect(verifySessionId("", SECRET)).toBeNull();
    expect(verifySessionId(null, SECRET)).toBeNull();
  });

  it("getSessionIdFromRequest returns null when cookie has no ar_session", () => {
    expect(getSessionIdFromRequest({ headers: { cookie: "other=x" } }, SECRET)).toBeNull();
  });

  it("setSessionCookie includes Secure when opts.secure is true", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    setSessionCookie(res, "sess_1", SECRET, { secure: true });
    expect(res._headers["Set-Cookie"]).toContain("Secure");
  });

  it("setStateCookie includes Secure when opts.secure is true", () => {
    const res = { setHeader: (k, v) => { res._headers = res._headers || {}; res._headers[k] = v; }, _headers: {} };
    setStateCookie(res, "state1", SECRET, { secure: true });
    expect(res._headers["Set-Cookie"]).toContain("Secure");
  });
});
