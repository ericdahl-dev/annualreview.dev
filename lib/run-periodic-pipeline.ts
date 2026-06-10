/**
 * AI pipeline for the periodic summary hierarchy.
 *
 * Three functions:
 *   runDailySummary(evidence)           → JSON string (daily summary)
 *   runWeeklyRollup(dailySummaries[])   → JSON string (weekly rollup)
 *   runMonthlyRollup(weeklySummaries[]) → JSON string (monthly rollup)
 *
 * Adapters over narrative-model-runner. Requires OPENROUTER_API_KEY
 * (falls back to OPENAI_API_KEY).
 */

import type { Evidence } from "../types/evidence.js";
import {
  extractJson,
  loadPrompt,
  OPENROUTER_BASE,
  resolveModel,
  runNarrativeJsonPrompt,
} from "./narrative-model-runner.js";

export interface PeriodicPipelineOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

function resolvePeriodicApiKey(apiKey?: string): string {
  const resolved = apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!resolved) throw new Error("OPENROUTER_API_KEY required for periodic pipeline");
  return resolved;
}

/**
 * Generate a brief daily summary from a single day's evidence.
 * Returns the raw JSON string from the LLM.
 */
export async function runDailySummary(
  evidence: Evidence,
  {
    apiKey,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  const resolvedApiKey = resolvePeriodicApiKey(apiKey);
  const resolvedModel = resolveModel({ model, premium: false });
  const promptContent = loadPrompt("50_daily_summary.md");

  const inputJson = JSON.stringify({
    timeframe: evidence.timeframe,
    contributions: evidence.contributions.map((c) => ({
      id: c.id,
      type: c.type,
      title: c.title,
      url: c.url,
      repo: c.repo,
      merged_at: c.merged_at ?? null,
      labels: c.labels ?? [],
      summary: c.summary ?? "",
    })),
  });

  return runNarrativeJsonPrompt({
    apiKey: resolvedApiKey,
    baseURL,
    model: resolvedModel,
    promptContent,
    inputJson,
    emptyContentError: "Daily summary pipeline returned no content",
    wrapJsonErrors: false,
  });
}

/**
 * Generate a weekly rollup from an array of daily summary JSON strings.
 * Returns the raw JSON string from the LLM.
 */
export async function runWeeklyRollup(
  weekStart: string,
  weekEndDate: string,
  dailySummaryJsons: string[],
  {
    apiKey,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  const resolvedApiKey = resolvePeriodicApiKey(apiKey);
  const resolvedModel = resolveModel({ model, premium: false });
  const promptContent = loadPrompt("51_weekly_rollup.md");

  const parsedDailies = dailySummaryJsons.map((s) => {
    try { return extractJson(s); } catch { return { headline: "No data", bullets: [] }; }
  });

  const inputJson = JSON.stringify({
    week_start: weekStart,
    week_end: weekEndDate,
    daily_summaries: parsedDailies,
  });

  return runNarrativeJsonPrompt({
    apiKey: resolvedApiKey,
    baseURL,
    model: resolvedModel,
    promptContent,
    inputJson,
    emptyContentError: "Weekly rollup pipeline returned no content",
    wrapJsonErrors: false,
  });
}

/**
 * Generate a monthly rollup from an array of weekly rollup JSON strings.
 * Returns the raw JSON string from the LLM.
 */
export async function runMonthlyRollup(
  month: string,
  weeklySummaryJsons: string[],
  {
    apiKey,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  const resolvedApiKey = resolvePeriodicApiKey(apiKey);
  const resolvedModel = resolveModel({ model, premium: false });
  const promptContent = loadPrompt("52_monthly_rollup.md");

  const parsedWeeklies = weeklySummaryJsons.map((s) => {
    try { return extractJson(s); } catch { return { headline: "No data", themes: [] }; }
  });

  const inputJson = JSON.stringify({
    month,
    weekly_summaries: parsedWeeklies,
  });

  return runNarrativeJsonPrompt({
    apiKey: resolvedApiKey,
    baseURL,
    model: resolvedModel,
    promptContent,
    inputJson,
    emptyContentError: "Monthly rollup pipeline returned no content",
    wrapJsonErrors: false,
  });
}
