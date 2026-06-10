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
import type { Evidence } from "../../types/evidence.js";
import {
  EvidenceIntakeError,
  intakeFromGitHub,
  parseTimeframe,
  resolveGitHubToken,
  type IntakeFromGitHubOptions,
} from "../../lib/evidence-intake.js";
import type {
  PeriodicSummary,
  PeriodicSummaryWithEvidence,
  PeriodType,
} from "../../lib/periodic-store.js";
import {
  DATE_YYYY_MM_DD,
  MONTH_YYYY_MM,
  PERIODIC_PERIOD_TYPES,
  weekStart,
  weekEnd,
} from "../../lib/evidence-archive/period.js";
import { tryParseJson } from "../../lib/evidence-archive/json.js";
import { readJsonBody, respondJson } from "../helpers.js";
import type { SessionService } from "../route-services.js";
import {
  createRequireLogin,
  readJsonBodyOrRespond400,
  requireEvidenceArchiveConfigured,
} from "./evidence-archive-helpers.js";

export interface PeriodicService {
  intakeFromGitHub: (opts: IntakeFromGitHubOptions) => Promise<Evidence>;
  runDailySummary: (evidence: Evidence) => Promise<string>;
  runWeeklyRollup: (weekStart: string, weekEnd: string, dailyJsons: string[]) => Promise<string>;
  runMonthlyRollup: (month: string, weeklyJsons: string[]) => Promise<string>;
  saveDailySummary: (userLogin: string, date: string, evidence: Evidence, summary: string) => Promise<string>;
  saveWeeklyRollup: (userLogin: string, weekStartDate: string, childIds: string[], summary: string, totalContributions: number) => Promise<string>;
  saveMonthlyRollup: (userLogin: string, month: string, childIds: string[], summary: string, totalContributions: number) => Promise<string>;
  getPeriodicSummary: (id: string, userLogin: string) => Promise<PeriodicSummaryWithEvidence | null>;
  listPeriodicSummaries: (userLogin: string, periodType?: PeriodType, limit?: number) => Promise<PeriodicSummary[]>;
  getDailySummariesForWeek: (userLogin: string, weekStartDate: string) => Promise<PeriodicSummaryWithEvidence[]>;
  getWeeklySummariesForMonth: (userLogin: string, month: string) => Promise<PeriodicSummary[]>;
  deletePeriodicSummary: (id: string, userLogin: string) => Promise<boolean>;
  isPeriodicStoreConfigured: () => boolean;
}

export interface PeriodicRoutesOptions {
  session: SessionService;
  /** Injected in tests; production uses periodic-store and pipeline adapters. */
  periodic?: PeriodicService;
}

type Next = () => void;

const DEFAULT_SUMMARIES_LIMIT = 90;
const MAX_SUMMARIES_LIMIT = 365;

export function periodicRoutes(options: PeriodicRoutesOptions) {
  const { session } = options;

  async function getStore(): Promise<PeriodicService> {
    if (options.periodic) return options.periodic;

    const [store, pipeline] = await Promise.all([
      import("../../lib/evidence-archive/periodic-adapter.js"),
      import("../../lib/run-periodic-pipeline.js"),
    ]);
    return {
      intakeFromGitHub,
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

  return async function periodicMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    const requireLogin = createRequireLogin(req, res, session);
    const rawPath = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";
    const queryString = req.url?.split("?")[1] ?? "";
    const params = new URLSearchParams(queryString);

    function ensureConfigured(isConfigured: () => boolean): boolean {
      return requireEvidenceArchiveConfigured(
        res,
        isConfigured(),
        "Periodic store"
      );
    }

    // ── POST /collect-day ──────────────────────────────────────────────────
    if (rawPath === "collect-day" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

      const body = await readJsonBodyOrRespond400(req, res, readJsonBody);
      if (!body) return;

      const date = (body.date as string | undefined) ??
        new Date().toISOString().slice(0, 10);

      const sessId = session.getSessionIdFromRequest(req);
      const userSession = sessId ? session.getSession(sessId) : undefined;
      let start_date: string;
      let end_date: string;
      let token: string;
      try {
        ({ start_date, end_date } = parseTimeframe(date, date));
        token = resolveGitHubToken({
          body: body.token,
          session: userSession?.access_token,
        });
      } catch (e) {
        if (e instanceof EvidenceIntakeError) {
          const status = e.message.includes("token") ? 401 : 400;
          respondJson(res, status, { error: e.message });
          return;
        }
        throw e;
      }

      try {
        const evidence = await store.intakeFromGitHub({ token, start_date, end_date });
        const summaryJson = await store.runDailySummary(evidence);
        const id = await store.saveDailySummary(userLogin, date, evidence, summaryJson);
        respondJson(res, 201, {
          id,
          date,
          contribution_count: evidence.contributions.length,
          summary: tryParseJson(summaryJson),
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
      if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

      const body = await readJsonBodyOrRespond400(req, res, readJsonBody);
      if (!body) return;

      const rawDate = (body.week_start as string | undefined) ??
        new Date().toISOString().slice(0, 10);
      const ws = weekStart(rawDate);

      if (!DATE_YYYY_MM_DD.test(ws)) {
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

        respondJson(res, 201, {
          id,
          week_start: ws,
          week_end: we,
          days_covered: dailies.length,
          total_contributions: totalContributions,
          summary: tryParseJson(rollupJson),
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
      if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

      const body = await readJsonBodyOrRespond400(req, res, readJsonBody);
      if (!body) return;

      const month = (body.month as string | undefined) ??
        new Date().toISOString().slice(0, 7);

      if (!MONTH_YYYY_MM.test(month)) {
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

        respondJson(res, 201, {
          id,
          month,
          weeks_covered: weeklies.length,
          total_contributions: totalContributions,
          summary: tryParseJson(rollupJson),
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
      if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

      const typeParam = params.get("type");
      const limitParam = params.get("limit");
      const periodType = typeParam && PERIODIC_PERIOD_TYPES.has(typeParam)
        ? (typeParam as PeriodType)
        : undefined;
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam), 1), MAX_SUMMARIES_LIMIT) : DEFAULT_SUMMARIES_LIMIT;

      try {
        const summaries = await store.listPeriodicSummaries(userLogin, periodType, limit);
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
        if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

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
        if (!ensureConfigured(store.isPeriodicStoreConfigured)) return;

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
