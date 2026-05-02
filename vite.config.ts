// Dev server: serves the React app and API routes.
// Auth: GET /api/auth/github, GET /api/auth/callback/github, GET /api/auth/me, POST /api/auth/logout.
// POST /api/collect → 202 { job_id }; POST /api/generate → 202 { job_id }. Poll GET /api/jobs/:id for status/result.
import { defineConfig, loadEnv, type ConfigEnv, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { codecovVitePlugin } from "@codecov/vite-plugin";
import { runPipeline } from "./lib/run-pipeline.js";
import { collectAndNormalize } from "./lib/collect-and-normalize.js";
import { validateEvidence } from "./lib/validate-evidence.js";
import {
  createJob,
  getJob,
  getLatestJob,
  runInBackground,
} from "./lib/job-store.js";
import {
  createSession,
  getSession,
  destroySession,
  setOAuthState,
  getAndRemoveOAuthState,
} from "./lib/session-store.js";
import {
  getAuthRedirectUrl,
  exchangeCodeForToken,
  getGitHubUser,
  handleCallback,
  handleMe,
  handleLogout,
} from "./lib/auth.js";
import {
  getSessionIdFromRequest,
  setSessionCookie,
  clearSessionCookie,
  setStateCookie,
  getStateFromRequest,
  clearStateCookie,
} from "./lib/cookies.js";
import {
  readJsonBody,
  respondJson,
  randomState,
  DATE_YYYY_MM_DD,
} from "./server/helpers.js";
import { authRoutes } from "./server/routes/auth.ts";
import { jobsRoutes } from "./server/routes/jobs.ts";
import { generateRoutes } from "./server/routes/generate.ts";
import { collectRoutes } from "./server/routes/collect.ts";
import { paymentsRoutes } from "./server/routes/payments.ts";
import { snapshotsRoutes } from "./server/routes/snapshots.ts";
import { periodicRoutes } from "./server/routes/periodic.ts";

function apiRoutesPlugin() {
  return {
    name: "api-routes",
    configureServer(server: ViteDevServer, config?: ConfigEnv) {
      const mode = config?.mode ?? "development";
      const env = loadEnv(mode, process.cwd(), "");
      const copyIfSet = (key: string) => {
        if (env[key] !== undefined) process.env[key] = env[key];
      };
      [
        "POSTHOG_API_KEY",
        "POSTHOG_HOST",
        "STRIPE_SECRET_KEY",
        "STRIPE_WEBHOOK_SECRET",
        "STRIPE_PRICE_CENTS",
        "STRIPE_CURRENCY",
        "CREDITS_PER_PURCHASE",
        "OPENROUTER_API_KEY",
        "OPENAI_API_KEY",
        "DATABASE_URL",
        "SESSION_SECRET",
        "GITHUB_CLIENT_ID",
        "GITHUB_CLIENT_SECRET",
        "LLM_MODEL",
        "PREMIUM_LLM_MODEL",
        "MAX_USER_TOKENS_FREE",
        "MAX_USER_TOKENS_PREMIUM",
      ].forEach(copyIfSet);
      const sessionSecret =
        env.SESSION_SECRET || process.env.SESSION_SECRET || "dev-secret";
      const clientId = env.GITHUB_CLIENT_ID || process.env.GITHUB_CLIENT_ID;
      const clientSecret =
        env.GITHUB_CLIENT_SECRET || process.env.GITHUB_CLIENT_SECRET;
      const getSessionId = (r: { headers?: { cookie?: string } }) =>
        getSessionIdFromRequest(r, sessionSecret);

      function getRequestContext(req: { headers: Record<string, string | string[] | undefined> }) {
        const isSecure = req.headers["x-forwarded-proto"] === "https";
        const host = req.headers.host || "localhost:5173";
        const origin = `${isSecure ? "https" : "http"}://${host}`;
        const redirectUri = `${origin}/api/auth/callback/github`;
        return {
          origin,
          redirectUri,
          cookieOpts: { secure: isSecure },
          basePath: "",
        };
      }

      server.middlewares.use(
        "/api/auth",
        authRoutes({
          sessionSecret,
          clientId,
          clientSecret,
          getRequestContext,
          getSessionIdFromRequest: getSessionId,
          getSession,
          destroySession,
          setSessionCookie,
          clearSessionCookie,
          setStateCookie,
          getStateFromRequest: (r) =>
            getStateFromRequest(r, sessionSecret),
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
          log: (event, detail) =>
            console.error("[auth]", event, detail ? String(detail) : ""),
        })
      );

      server.middlewares.use(
        "/api/jobs",
        jobsRoutes({
          getSessionIdFromRequest: getSessionId,
          getLatestJob,
          getJob,
          respondJson,
        })
      );

      server.middlewares.use(
        "/api/generate",
        generateRoutes({
          readJsonBody,
          respondJson,
          validateEvidence,
          createJob,
          runInBackground,
          runPipeline,
          getSessionIdFromRequest: getSessionId,
          getSession,
        })
      );

      server.middlewares.use(
        "/api/collect",
        collectRoutes({
          readJsonBody,
          respondJson,
          DATE_YYYY_MM_DD,
          getSessionIdFromRequest: getSessionId,
          getSession,
          createJob,
          runInBackground,
          collectAndNormalize,
        })
      );

      server.middlewares.use(
        "/api/payments",
        paymentsRoutes({
          respondJson,
          getSessionIdFromRequest: getSessionId,
          getSession,
        })
      );
      server.middlewares.use(
        "/api/snapshots",
        snapshotsRoutes({
          readJsonBody,
          respondJson,
          getSessionIdFromRequest: getSessionId,
          getSession,
        })
      );

      server.middlewares.use(
        "/api/periodic",
        periodicRoutes({
          readJsonBody,
          respondJson,
          getSessionIdFromRequest: getSessionId,
          getSession,
          collectAndNormalize,
        })
      );
    },
  };
}


export default defineConfig({
  plugins: [
    react(),
    apiRoutesPlugin(),
    codecovVitePlugin({
      enableBundleAnalysis: process.env.CODECOV_TOKEN !== undefined,
      bundleName: "annualreview-dev",
      uploadToken: process.env.CODECOV_TOKEN,
    }),
  ],
  envPrefix: ["VITE_", "POSTHOG"],
});
