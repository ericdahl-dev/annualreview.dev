/**
 * Production server: serves dist/ and the same API routes as the Vite dev server.
 * For Coolify (or any Node host): run `yarn build && yarn start` (or `node --import tsx/esm server.ts`).
 * Set PORT (default 3000), SESSION_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and OPENROUTER_API_KEY.
 * Optional: LLM_MODEL, PREMIUM_LLM_MODEL (defaults: Claude 3 Haiku free, Claude 3.5 Sonnet premium).
 * Optional: POSTHOG_API_KEY (and POSTHOG_HOST) for LLM analytics and Node logs in PostHog.
 *
 * --- Premium credits (SQLite) ---
 * Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_CENTS (default 100), STRIPE_CURRENCY (default "usd"), CREDITS_PER_PURCHASE (default 5).
 * Optional: CREDITS_DB_PATH – absolute path for the SQLite credits database (default: <cwd>/credits.db).
 *
 * Coolify / Docker deployment note:
 *   SQLite survives container *restarts* but is wiped on *redeployments* (the old
 *   container is replaced). To persist credits across deploys you MUST mount a
 *   persistent volume in Coolify and point CREDITS_DB_PATH at a file inside it.
 *
 *   Example Coolify "Persistent Storage" entry:
 *     Host path : /opt/annualreview-data
 *     Mount path: /data
 *   Then set env var: CREDITS_DB_PATH=/data/credits.db
 */
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { readFile } from "fs/promises";
import { join, extname } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const DIST = join(__dirname, "dist");

import { runPipeline } from "./lib/run-pipeline.ts";
import { collectAndNormalize } from "./lib/collect-and-normalize.ts";
import { validateEvidence } from "./lib/validate-evidence.ts";
import {
  createJob,
  getJob,
  getLatestJob,
  runInBackground,
} from "./lib/job-store.ts";
import {
  createSession,
  getSession,
  destroySession,
  setOAuthState,
  getAndRemoveOAuthState,
} from "./lib/session-store.ts";
import {
  getAuthRedirectUrl,
  buildCallbackRequest,
  exchangeCodeForToken,
  getGitHubUser,
  handleCallback,
  handleMe,
  handleLogout,
} from "./lib/auth.ts";
import {
  getSessionIdFromRequest,
  setSessionCookie,
  clearSessionCookie,
  setStateCookie,
  getStateFromRequest,
  clearStateCookie,
} from "./lib/cookies.ts";
import {
  readJsonBody,
  respondJson,
  randomState,
  DATE_YYYY_MM_DD,
} from "./server/helpers.ts";
import { authRoutes } from "./server/routes/auth.ts";
import { jobsRoutes } from "./server/routes/jobs.ts";
import { generateRoutes } from "./server/routes/generate.ts";
import { collectRoutes } from "./server/routes/collect.ts";
import { logger } from "./lib/posthog-logs.ts";
import { paymentsRoutes } from "./server/routes/payments.ts";

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function serveStatic(
  res: ServerResponse,
  pathname: string
): Promise<void> {
  const rel =
    pathname === "/" || pathname === ""
      ? "index.html"
      : pathname.replace(/^\//, "");
  const filePath = join(DIST, rel);
  try {
    const data = await readFile(filePath);
    res.setHeader(
      "Content-Type",
      MIME[extname(filePath)] || "application/octet-stream"
    );
    res.end(data);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      const index = await readFile(join(DIST, "index.html"));
      res.setHeader("Content-Type", "text/html");
      res.end(index);
    } else {
      res.statusCode = 500;
      res.end();
    }
  }
}

type Next = () => void;

function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
): void {
  const url = req.url || "/";
  const [pathname, qs] = url.split("?");
  const path = pathname.replace(/^\/+/, "");

  const sessionSecret = process.env.SESSION_SECRET || "dev-secret";
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const isSecure = req.headers["x-forwarded-proto"] === "https";
  const host = req.headers.host || "localhost:3000";
  const origin = `${isSecure ? "https" : "http"}://${host}`;
  const redirectUri = `${origin}/api/auth/callback/github`;
  const cookieOpts = { secure: isSecure };
  const log = (event: string, detail?: string): void =>
    console.error("[auth] " + event + (detail ? " " + detail : ""));

  if (path.startsWith("api/")) {
    const sub = path.slice(4);
    const [area, ...rest] = sub.split("/");
    const restPath = rest.join("/");
    const pathAndQs = restPath + (qs ? "?" + qs : "");
    const wrappedReq = Object.assign(Object.create(req), {
      url: pathAndQs ? "/" + pathAndQs : "/",
    });

    const next: Next = () => {
      serveStatic(res, pathname);
    };

    if (area === "auth") {
      authRoutes({
        sessionSecret,
        clientId,
        clientSecret,
        getRequestContext: () => ({
          origin,
          redirectUri,
          cookieOpts,
          basePath: "/api/auth",
        }),
        getSessionIdFromRequest: (r) => getSessionIdFromRequest(r, sessionSecret),
        getSession,
        destroySession,
        setSessionCookie,
        clearSessionCookie,
        setStateCookie,
        getStateFromRequest: (r) => getStateFromRequest(r, sessionSecret, { log }),
        clearStateCookie,
        getAndRemoveOAuthState,
        setOAuthState,
        createSession,
        exchangeCodeForToken: (code, uri) =>
          exchangeCodeForToken(code, uri, clientId!, clientSecret!, fetch),
        getGitHubUser: (token) => getGitHubUser(token, fetch),
        handleCallback,
        handleMe,
        handleLogout,
        getAuthRedirectUrl,
        respondJson,
        randomState,
        buildCallbackRequest,
        log,
      })(wrappedReq, res, next);
      return;
    }

    if (area === "jobs") {
      jobsRoutes({
        getSessionIdFromRequest: (r) =>
          getSessionIdFromRequest(r, sessionSecret),
        getLatestJob,
        getJob,
        respondJson,
      })(wrappedReq, res, next);
      return;
    }

    if (area === "generate") {
      generateRoutes({
        readJsonBody,
        respondJson,
        validateEvidence,
        createJob,
        runInBackground,
        runPipeline,
        getSessionIdFromRequest: (r) =>
          getSessionIdFromRequest(r, sessionSecret),
        getSession,
      })(wrappedReq, res, next);
      return;
    }

    if (area === "payments") {
      paymentsRoutes({
        respondJson,
        getSessionIdFromRequest: (r) =>
          getSessionIdFromRequest(r, sessionSecret),
        getSession,
      })(wrappedReq, res, next);
      return;
    }

    if (area === "collect") {
      collectRoutes({
        readJsonBody,
        respondJson,
        DATE_YYYY_MM_DD,
        getSessionIdFromRequest: (r) =>
          getSessionIdFromRequest(r, sessionSecret),
        getSession,
        createJob,
        runInBackground,
        collectAndNormalize,
      })(wrappedReq, res, next);
      return;
    }
  }

  serveStatic(res, pathname);
}

const port = Number(process.env.PORT) || 3000;
createServer(handleRequest).listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  logger.emit({
    severityText: "INFO",
    body: `Server listening on port ${port}`,
    attributes: { port },
  });
});
