import { createHmac } from "crypto";

const COOKIE_NAME = "ar_session";

export function signSessionId(id: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(id).digest("hex");
  return `${id}.${sig}`;
}

export function verifySessionId(value: string, secret: string): string | null {
  if (!value || typeof value !== "string") return null;
  const lastDotIndex = value.lastIndexOf(".");
  if (lastDotIndex <= 0) return null;
  const id = value.slice(0, lastDotIndex);
  const signature = value.slice(lastDotIndex + 1);
  const expected = createHmac("sha256", secret).update(id).digest("hex");
  return signature === expected ? id : null;
}

export function getSessionIdFromRequest(
  req: { headers?: { cookie?: string } },
  secret: string
): string | null {
  const cookie = req?.headers?.cookie;
  if (!cookie) return null;
  const match = cookie.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;
  const value = decodeURIComponent(match[1].trim());
  return verifySessionId(value, secret);
}

export interface CookieOpts {
  secure?: boolean;
  maxAge?: number;
}

export function setSessionCookie(
  res: { setHeader: (k: string, v: string) => void },
  sessionId: string,
  secret: string,
  opts: CookieOpts = {}
): void {
  const value = signSessionId(sessionId, secret);
  const secure = opts.secure ?? false;
  const maxAge = opts.maxAge ?? 60 * 60 * 24 * 7; // 7 days
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

const STATE_COOKIE = "ar_oauth_state";

export function setStateCookie(
  res: { setHeader: (k: string, v: string) => void },
  state: string,
  secret: string,
  opts: { secure?: boolean } = {}
): void {
  const secretTrimmed = String(secret).trim();
  const sig = createHmac("sha256", secretTrimmed).update(state).digest("hex");
  const value = `${state}.${sig}`;
  const parts = [
    `${STATE_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=600",
  ];
  if (opts.secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function getStateFromRequest(
  req: { headers?: { cookie?: string } },
  secret: string,
  opts: { log?: (msg: string, detail?: string) => void } = {}
): string | null {
  const log = opts.log || (() => {});
  const cookie = req?.headers?.cookie;
  if (!cookie || !secret) {
    if (!secret) log("state_cookie", "no_secret");
    return null;
  }
  const match = cookie.match(new RegExp(`${STATE_COOKIE}=([^;]+)`));
  if (!match) {
    log("state_cookie", "no_match");
    return null;
  }
  const raw = decodeURIComponent(match[1].trim());
  const lastDotIndex = raw.lastIndexOf(".");
  if (lastDotIndex <= 0) {
    log("state_cookie", "bad_format");
    return null;
  }
  const state = raw.slice(0, lastDotIndex);
  const signature = raw.slice(lastDotIndex + 1);
  const secretTrimmed = String(secret).trim();
  const expected = createHmac("sha256", secretTrimmed).update(state).digest("hex");
  if (signature !== expected) {
    log("state_cookie", "verify_failed");
    return null;
  }
  return state;
}

export function clearStateCookie(res: { setHeader: (k: string, v: string) => void }): void {
  res.setHeader(
    "Set-Cookie",
    `${STATE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}
