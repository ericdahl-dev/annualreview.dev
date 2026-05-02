/**
 * Periodic collection API — daily/weekly/monthly contribution tracking.
 *
 *   POST /collect-day   – collect one day's contributions + AI daily summary
 *   POST /rollup-week   – AI weekly rollup of the week's daily summaries
 *   POST /rollup-month  – AI monthly rollup of the month's weekly summaries
 *   GET  /summaries     – list summaries (optionally filtered by type/limit)
 *   GET  /summary/:id   – get a specific summary
 *   DELETE /summary/:id – delete a summary
 *
 * All routes require the user to be logged in (session cookie).
 * Collect-day additionally requires a GitHub token (from session or body).
 * Rollup endpoints require OPENROUTER_API_KEY.
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SessionData } from "../../lib/session-store.js";
import type { Evidence } from "../../types/evidence.js";
import type {
  PeriodicSummary,
  PeriodicSummaryWithEvidence,
  PeriodType,
} from "../../lib/periodic-store.js";
import { weekStart, weekEnd } from "../../lib/periodic-store.js";

export interface PeriodicRoutesOptions {
  readJsonBody: (req: IncomingMessage) => Promise<object>;
  respondJson: (res: ServerResponse, status: number, data: object) => void;
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => SessionData | undefined;
  collectAndNormalize: (opts: { token: string; start_date: string; end_date: string }) => Promise<Evidence>;
  /** Injected for tests */
  runDailySummary?: (evidence: Evidence) => Promise<string>;
  runWeeklyRollup?: (weekStart: string, weekEnd: string, dailyJsons: string[]) => Promise<string>;
  runMonthlyRollup?: (month: string, weeklyJsons: string[]) => Promise<string>;
  saveDailySummary?: (userLogin: string, date: string, evidence: Evidence, summary: string) => Promise<string>;
  saveWeeklyRollup?: (userLogin: string, weekStartDate: string, childIds: string[], summary: string, totalContributions: number) => Promise<string>;
  saveMonthlyRollup?: (userLogin: string, month: string, childIds: string[], summary: string, totalContributions: number) => Promise<string>;
  getPeriodicSummary?: (id: string, userLogin: string) => Promise<PeriodicSummaryWithEvidence | null>;
  listPeriodicSummaries?: (userLogin: string, periodType?: PeriodType, limit?: number) => Promise<PeriodicSummary[]>;
  getDailySummariesForWeek?: (userLogin: string, weekStartDate: string) => Promise<PeriodicSummaryWithEvidence[]>;
  getWeeklySummariesForMonth?: (userLogin: string, month: string) => Promise<PeriodicSummary[]>;
  deletePeriodicSummary?: (id: string, userLogin: string) => Promise<boolean>;
  isPeriodicStoreConfigured?: () => boolean;
}

type Next = () => void;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;
const VALID_PERIOD_TYPES = new Set(["daily", "weekly", "monthly"]);

export function periodicRoutes(options: PeriodicRoutesOptions) {
  const { readJsonBody, respondJson, getSessionIdFromRequest, getSession, collectAndNormalize } = options;

  async function getStore() {
    const allProvided =
      options.runDailySummary &&
      options.runWeeklyRollup &&
      options.runMonthlyRollup &&
      options.saveDailySummary &&
      options.saveWeeklyRollup &&
      options.saveMonthlyRollup &&
      options.getPeriodicSummary &&
      options.listPeriodicSummaries &&
      options.getDailySummariesForWeek &&
      options.getWeeklySummariesForMonth &&
      options.deletePeriodicSummary &&
      options.isPeriodicStoreConfigured;

    if (allProvided) {
      return {
        runDailySummary: options.runDailySummary!,
        runWeeklyRollup: options.runWeeklyRollup!,
        runMonthlyRollup: options.runMonthlyRollup!,
        saveDailySummary: options.saveDailySummary!,
        saveWeeklyRollup: options.saveWeeklyRollup!,
        saveMonthlyRollup: options.saveMonthlyRollup!,
        getPeriodicSummary: options.getPeriodicSummary!,
        listPeriodicSummaries: options.listPeriodicSummaries!,
        getDailySummariesForWeek: options.getDailySummariesForWeek!,
        getWeeklySummariesForMonth: options.getWeeklySummariesForMonth!,
        deletePeriodicSummary: options.deletePeriodicSummary!,
        isPeriodicStoreConfigured: options.isPeriodicStoreConfigured!,
      };
    }

    const [store, pipeline] = await Promise.all([
      import("../../lib/periodic-store.js"),
      import("../../lib/run-periodic-pipeline.js"),
    ]);
    return {
      runDailySummary: pipeline.runDailySummary,
      runWeeklyRollup: pipeline.runWeeklyRollup,
      runMonthlyRollup: pipeline.runMonthlyRollup,
      saveDailySummary: store.saveDailySummary,
      saveWeeklyRollup: store.saveWeeklyRollup,
      saveMonthlyRollup: store.saveMonthlyRollup,
      getPeriodicSummary: store.getPeriodicSummary,
      listPeriodicSummaries: store.listPeriodicSummaries,
      getDailySummariesForWeek: store.getDailySummariesForWeek,
      getWeeklySummariesForMonth: store.getWeeklySummariesForMonth,
      deletePeriodicSummary: store.deletePeriodicSummary,
      isPeriodicStoreConfigured: store.isPeriodicStoreConfigured,
    };
  }

  function makeRequireLogin(req: IncomingMessage, res: ServerResponse): () => string | null {
    return () => {
      const sessId = getSessionIdFromRequest(req);
      const session = sessId ? getSession(sessId) : undefined;
      if (!session?.login) {
        respondJson(res, 401, { error: "Login required" });
        return null;
      }
      return session.login;
    };
  }

  return async function periodicMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    const requireLogin = makeRequireLogin(req, res);
    const rawPath = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";
    const queryString = req.url?.split("?")[1] ?? "";
    const params = new URLSearchParams(queryString);

    // ── POST /collect-day ──────────────────────────────────────────────────
    if (rawPath === "collect-day" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isPeriodicStoreConfigured()) {
        respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        respondJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      // Default to today (UTC)
      const date = (body.date as string | undefined) ??
        new Date().toISOString().slice(0, 10);

      if (!DATE_RE.test(date)) {
        respondJson(res, 400, { error: "date must be YYYY-MM-DD" });
        return;
      }

      // Resolve token: body > session
      const sessId = getSessionIdFromRequest(req);
      const session = sessId ? getSession(sessId) : undefined;
      const token = (body.token as string | undefined) ?? session?.access_token;
      if (!token) {
        respondJson(res, 401, { error: "GitHub token required (login with GitHub or pass token in body)" });
        return;
      }

      try {
        const evidence = await collectAndNormalize({ token, start_date: date, end_date: date });
        const summaryJson = await store.runDailySummary(evidence);
        const id = await store.saveDailySummary(userLogin, date, evidence, summaryJson);
        let parsedSummary: unknown = summaryJson;
        try { parsedSummary = JSON.parse(summaryJson); } catch { /* return raw */ }
        respondJson(res, 201, {
          id,
          date,
          contribution_count: evidence.contributions.length,
          summary: parsedSummary,
        });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to collect day" });
      }
      return;
    }

    // ── POST /rollup-week ──────────────────────────────────────────────────
    if (rawPath === "rollup-week" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isPeriodicStoreConfigured()) {
        respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        respondJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      // Default to the current week's Monday
      const rawDate = (body.week_start as string | undefined) ??
        new Date().toISOString().slice(0, 10);
      const ws = weekStart(rawDate);

      if (!DATE_RE.test(ws)) {
        respondJson(res, 400, { error: "week_start must be YYYY-MM-DD" });
        return;
      }

      try {
        const dailies = await store.getDailySummariesForWeek(userLogin, ws);
        if (dailies.length === 0) {
          respondJson(res, 404, { error: `No daily summaries found for week starting ${ws}` });
          return;
        }

        const we = weekEnd(ws);
        const dailyJsons = dailies.map((d) => d.summary);
        const rollupJson = await store.runWeeklyRollup(ws, we, dailyJsons);
        const totalContributions = dailies.reduce((s, d) => s + d.contribution_count, 0);
        const childIds = dailies.map((d) => d.id);
        const id = await store.saveWeeklyRollup(userLogin, ws, childIds, rollupJson, totalContributions);

        let parsedSummary: unknown = rollupJson;
        try { parsedSummary = JSON.parse(rollupJson); } catch { /* return raw */ }
        respondJson(res, 201, {
          id,
          week_start: ws,
          week_end: we,
          days_covered: dailies.length,
          total_contributions: totalContributions,
          summary: parsedSummary,
        });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to rollup week" });
      }
      return;
    }

    // ── POST /rollup-month ─────────────────────────────────────────────────
    if (rawPath === "rollup-month" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isPeriodicStoreConfigured()) {
        respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        respondJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      // Default to current month
      const month = (body.month as string | undefined) ??
        new Date().toISOString().slice(0, 7);

      if (!MONTH_RE.test(month)) {
        respondJson(res, 400, { error: "month must be YYYY-MM" });
        return;
      }

      try {
        const weeklies = await store.getWeeklySummariesForMonth(userLogin, month);
        if (weeklies.length === 0) {
          respondJson(res, 404, { error: `No weekly summaries found for month ${month}` });
          return;
        }

        const weeklyJsons = weeklies.map((w) => w.summary);
        const rollupJson = await store.runMonthlyRollup(month, weeklyJsons);
        const totalContributions = weeklies.reduce((s, w) => s + w.contribution_count, 0);
        const childIds = weeklies.map((w) => w.id);
        const id = await store.saveMonthlyRollup(userLogin, month, childIds, rollupJson, totalContributions);

        let parsedSummary: unknown = rollupJson;
        try { parsedSummary = JSON.parse(rollupJson); } catch { /* return raw */ }
        respondJson(res, 201, {
          id,
          month,
          weeks_covered: weeklies.length,
          total_contributions: totalContributions,
          summary: parsedSummary,
        });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to rollup month" });
      }
      return;
    }

    // ── GET /summaries ─────────────────────────────────────────────────────
    if (rawPath === "summaries" && req.method === "GET") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isPeriodicStoreConfigured()) {
        respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
        return;
      }

      const typeParam = params.get("type");
      const limitParam = params.get("limit");
      const periodType = typeParam && VALID_PERIOD_TYPES.has(typeParam)
        ? (typeParam as PeriodType)
        : undefined;
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), 365) : 90;

      try {
        const summaries = await store.listPeriodicSummaries(userLogin, periodType, limit);
        // Parse the JSON summary string for easier frontend consumption
        const parsed = summaries.map((s) => ({
          ...s,
          summary: tryParseJson(s.summary),
        }));
        respondJson(res, 200, { summaries: parsed });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to list summaries" });
      }
      return;
    }

    // ── Routes with /summary/:id ───────────────────────────────────────────
    const parts = rawPath.split("/");
    if (parts[0] === "summary" && parts.length === 2) {
      const id = parts[1];

      // GET /summary/:id
      if (req.method === "GET") {
        const userLogin = requireLogin();
        if (!userLogin) return;

        const store = await getStore();
        if (!store.isPeriodicStoreConfigured()) {
          respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
          return;
        }

        try {
          const summary = await store.getPeriodicSummary(id, userLogin);
          if (!summary) {
            respondJson(res, 404, { error: "Summary not found" });
            return;
          }
          respondJson(res, 200, {
            ...summary,
            summary: tryParseJson(summary.summary),
          } as unknown as object);
        } catch (e) {
          const err = e as Error;
          respondJson(res, 500, { error: err.message || "Failed to get summary" });
        }
        return;
      }

      // DELETE /summary/:id
      if (req.method === "DELETE") {
        const userLogin = requireLogin();
        if (!userLogin) return;

        const store = await getStore();
        if (!store.isPeriodicStoreConfigured()) {
          respondJson(res, 503, { error: "Periodic store not configured (DATABASE_URL missing)" });
          return;
        }

        try {
          const deleted = await store.deletePeriodicSummary(id, userLogin);
          if (!deleted) {
            respondJson(res, 404, { error: "Summary not found" });
            return;
          }
          respondJson(res, 200, { deleted: true });
        } catch (e) {
          const err = e as Error;
          respondJson(res, 500, { error: err.message || "Failed to delete summary" });
        }
        return;
      }
    }

    next();
  };
}

function tryParseJson(s: string): unknown {
  try { return JSON.parse(s); } catch { return s; }
}
