/**
 * Production server: serves dist/ and the same API routes as the Vite dev server.
 * For Coolify (or any Node host): run `yarn build && yarn start` (or `node --import tsx/esm server.ts`).
 * Set PORT (default 3000), SESSION_SECRET, GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, and OPENROUTER_API_KEY.
 * Optional: LLM_MODEL, PREMIUM_LLM_MODEL (defaults: Claude 3 Haiku free, Claude Haiku 4.5 premium). MAX_USER_TOKENS_FREE, MAX_USER_TOKENS_PREMIUM (context caps per tier; defaults 500k free, 184k premium).
 * Optional: POSTHOG_API_KEY (and POSTHOG_HOST) for LLM analytics and Node logs in PostHog.
 *
 * --- Premium credits (Postgres) ---
 * Optional: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_CENTS (default 100), STRIPE_CURRENCY (default "usd"), CREDITS_PER_PURCHASE (default 5).
 * DATABASE_URL – Neon (or any Postgres) connection string for credits and credit_events tables. Required when using premium/payments.
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
import { authRoutes } from "./server/routes/auth.ts";
import { jobsRoutes } from "./server/routes/jobs.ts";
import { generateRoutes } from "./server/routes/generate.ts";
import { collectRoutes } from "./server/routes/collect.ts";
import { logger } from "./lib/posthog-logs.ts";
import { paymentsRoutes } from "./server/routes/payments.ts";
import { snapshotsRoutes } from "./server/routes/snapshots.ts";
import { periodicRoutes } from "./server/routes/periodic.ts";
import { getSessionSecret } from "./server/session-secret.ts";

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
  const [pathname, queryString] = url.split("?");
  const path = pathname.replace(/^\/+/, "");

  const sessionSecret = getSessionSecret();
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const isSecure = req.headers["x-forwarded-proto"] === "https";
  const host = req.headers.host || "localhost:3000";
  const origin = `${isSecure ? "https" : "http"}://${host}`;
  const redirectUri = `${origin}/api/auth/callback/github`;
  const cookieOpts = { secure: isSecure };
  const log = (event: string, detail?: string): void =>
    console.error("[auth] " + event + (detail ? " " + detail : ""));
  const getSessionId = (r: IncomingMessage) => getSessionIdFromRequest(r, sessionSecret);

  if (path.startsWith("api/")) {
    const apiPath = path.slice(4);
    const [routeArea, ...remainingSegments] = apiPath.split("/");
    const subroutePath = remainingSegments.join("/");
    const pathAndQs = subroutePath + (queryString ? "?" + queryString : "");
    const wrappedReq = Object.assign(Object.create(req), {
      url: pathAndQs ? "/" + pathAndQs : "/",
    });

    const next: Next = () => {
      serveStatic(res, pathname);
    };

    if (routeArea === "auth") {
      authRoutes({
        sessionSecret,
        clientId,
        getRequestContext: () => ({
          origin,
          redirectUri,
          cookieOpts,
          basePath: "/api/auth",
        }),
        auth: {
          getSessionIdFromRequest: getSessionId,
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
          buildCallbackRequest,
        },
        log,
      })(wrappedReq, res, next);
      return;
    }

    if (routeArea === "jobs") {
      jobsRoutes({
        getSessionIdFromRequest: getSessionId,
        getLatestJob,
        getJob,
      })(wrappedReq, res, next);
      return;
    }

    if (routeArea === "generate") {
      generateRoutes({
        validateEvidence,
        createJob,
        runInBackground,
        runPipeline,
        getSessionIdFromRequest: getSessionId,
        getSession,
      })(wrappedReq, res, next);
      return;
    }

    if (routeArea === "payments") {
      paymentsRoutes({
        getSessionIdFromRequest: getSessionId,
        getSession,
      })(wrappedReq, res, next);
      return;
    }

    if (routeArea === "collect") {
      collectRoutes({
        getSessionIdFromRequest: getSessionId,
        getSession,
        createJob,
        runInBackground,
        collectAndNormalize,
      })(wrappedReq, res, next);
      return;
    }
    if (routeArea === "snapshots") {
      snapshotsRoutes({
        getSessionIdFromRequest: getSessionId,
        getSession,
      })(wrappedReq, res, next);
      return;
    }
    if (routeArea === "periodic") {
      periodicRoutes({
        getSessionIdFromRequest: getSessionId,
        getSession,
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
