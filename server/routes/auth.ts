/**
 * Auth API routes: GET /github, GET /callback/github, GET /me, POST /logout.
 * Export a function that returns a Connect-style middleware (req, res, next).
 * All dependencies are passed in options so Vite and server can share this.
 */

import type { IncomingMessage, ServerResponse } from "http";
import { respondJson, randomState } from "../helpers.js";

export interface RequestContext {
  origin: string;
  redirectUri: string;
  cookieOpts?: { secure?: boolean };
  basePath?: string;
}

/** All auth domain collaborators grouped as a single service object. */
export interface AuthService {
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => { login: string; scope?: string } | undefined;
  destroySession: (id: string) => void;
  setSessionCookie: (
    res: ServerResponse,
    id: string,
    secret: string,
    opts?: object
  ) => void;
  clearSessionCookie: (res: ServerResponse) => void;
  setStateCookie: (
    res: ServerResponse,
    state: string,
    secret: string,
    opts?: object
  ) => void;
  getStateFromRequest: (req: IncomingMessage) => string | null;
  clearStateCookie: (res: ServerResponse) => void;
  getAndRemoveOAuthState?: (state: string) => string | null;
  setOAuthState: (id: string, state: string) => void;
  createSession: (data: object) => string;
  exchangeCodeForToken: (code: string, redirectUri: string) => Promise<string>;
  getGitHubUser: (token: string) => Promise<{ login: string }>;
  handleCallback: (
    req: { url?: string; headers?: object },
    res: ServerResponse,
    deps: object
  ) => Promise<void>;
  handleMe: (
    req: IncomingMessage,
    res: ServerResponse,
    deps: object
  ) => void;
  handleLogout: (
    req: IncomingMessage,
    res: ServerResponse,
    deps: object
  ) => void;
  getAuthRedirectUrl: (
    scope: string,
    state: string,
    redirectUri: string,
    clientId: string
  ) => string;
  buildCallbackRequest?: (
    req: IncomingMessage,
    fullUrl: string
  ) => { url: string; headers?: object };
}

export interface AuthRoutesOptions {
  sessionSecret: string;
  clientId: string | undefined;
  getRequestContext: (req: IncomingMessage) => RequestContext;
  auth: AuthService;
  log?: (event: string, detail?: string) => void;
}

type Next = () => void;

export function authRoutes(options: AuthRoutesOptions) {
  const {
    sessionSecret,
    clientId,
    getRequestContext,
    auth,
    log = () => {},
  } = options;

  const {
    getSessionIdFromRequest,
    getSession,
    destroySession,
    setSessionCookie,
    clearSessionCookie,
    setStateCookie,
    getStateFromRequest,
    clearStateCookie,
    getAndRemoveOAuthState,
    setOAuthState,
    createSession,
    exchangeCodeForToken,
    getGitHubUser,
    handleCallback,
    handleMe,
    handleLogout,
    getAuthRedirectUrl,
    buildCallbackRequest,
  } = auth;

  return function authMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): void {
    const path = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";
    const { origin, redirectUri, cookieOpts, basePath = "" } = getRequestContext(req);
    const isSecure =
      cookieOpts?.secure ?? req.headers["x-forwarded-proto"] === "https";

    if (req.method === "GET" && path === "github") {
      if (!clientId) {
        respondJson(res, 500, {
          error:
            "GITHUB_CLIENT_ID not set. Add it to .env and restart the dev server.",
        });
        return;
      }
      const scope =
        new URL(req.url || "", "http://x").searchParams.get("scope") || "public";
      const state = `${scope}_${randomState()}`;
      setStateCookie(res, state, sessionSecret, { secure: isSecure });
      setOAuthState(state, state);
      const url = getAuthRedirectUrl(scope, state, redirectUri, clientId);
      res.writeHead(302, { Location: url });
      res.end();
      return;
    }

    if (req.method === "GET" && path === "callback/github") {
      const pathPart = req.url?.startsWith("/") ? req.url : "/" + (req.url || "");
      const fullUrl = `${origin}${basePath}${pathPart}`;
      const callbackReq: { url: string; headers?: object } = buildCallbackRequest
        ? buildCallbackRequest(req, fullUrl)
        : { url: fullUrl, headers: req.headers };
      handleCallback(callbackReq, res, {
        getStateFromRequest,
        getAndRemoveOAuthState,
        clearStateCookie,
        setSessionCookie,
        createSession,
        exchangeCodeForToken,
        getGitHubUser,
        redirectUri,
        sessionSecret,
        cookieOpts,
        log,
      }).catch((e: Error) => {
        log("callback_error", e.message || "unknown");
        res.writeHead(500);
        res.end(e.message || "Callback failed");
      });
      return;
    }

    if (req.method === "GET" && path === "me") {
      handleMe(req, res, {
        getSessionIdFromRequest,
        getSession,
      });
      return;
    }

    if (req.method === "POST" && path === "logout") {
      handleLogout(req, res, {
        getSessionIdFromRequest,
        destroySession,
        clearSessionCookie,
      });
      return;
    }

    next();
  };
}
