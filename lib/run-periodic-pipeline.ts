/**
 * AI pipeline for the periodic summary hierarchy.
 *
 * Three functions:
 *   runDailySummary(evidence)           → JSON string (daily summary)
 *   runWeeklyRollup(dailySummaries[])   → JSON string (weekly rollup)
 *   runMonthlyRollup(weeklySummaries[]) → JSON string (monthly rollup)
 *
 * Uses the same OpenRouter/OpenAI setup as run-pipeline.ts.
 * Requires OPENROUTER_API_KEY (falls back to OPENAI_API_KEY).
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import type { Evidence } from "../types/evidence.js";
import { extractJson, getDefaultModels } from "./run-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

function makeClient(apiKey: string, baseURL?: string): OpenAI {
  const opts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) {
    opts.baseURL = baseURL;
    opts.defaultHeaders = {
      "HTTP-Referer": "https://annualreview.dev",
      "X-Title": "AnnualReview.dev",
    };
  }
  return new OpenAI(opts);
}

export interface PeriodicPipelineOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

/**
 * Generate a brief daily summary from a single day's evidence.
 * Returns the raw JSON string from the LLM.
 */
export async function runDailySummary(
  evidence: Evidence,
  {
    apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required for periodic pipeline");
  const resolvedModel = model ?? getDefaultModels().free;
  const openai = makeClient(apiKey, baseURL);
  const prompt = loadPrompt("50_daily_summary.md");

  // Slim the evidence down — daily runs are small by definition
  const input = JSON.stringify({
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

  const completion = await openai.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "user", content: `${prompt}\n\nINPUT JSON:\n${input}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw?.trim()) throw new Error("Daily summary pipeline returned no content");
  extractJson(raw); // validate JSON
  return raw;
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
    apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required for periodic pipeline");
  const resolvedModel = model ?? getDefaultModels().free;
  const openai = makeClient(apiKey, baseURL);
  const prompt = loadPrompt("51_weekly_rollup.md");

  const parsedDailies = dailySummaryJsons.map((s) => {
    try { return extractJson(s); } catch { return { headline: "No data", bullets: [] }; }
  });

  const input = JSON.stringify({
    week_start: weekStart,
    week_end: weekEndDate,
    daily_summaries: parsedDailies,
  });

  const completion = await openai.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "user", content: `${prompt}\n\nINPUT JSON:\n${input}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw?.trim()) throw new Error("Weekly rollup pipeline returned no content");
  extractJson(raw); // validate JSON
  return raw;
}

/**
 * Generate a monthly rollup from an array of weekly rollup JSON strings.
 * Returns the raw JSON string from the LLM.
 */
export async function runMonthlyRollup(
  month: string,
  weeklySummaryJsons: string[],
  {
    apiKey = process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY,
    model,
    baseURL = OPENROUTER_BASE,
  }: PeriodicPipelineOptions = {}
): Promise<string> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required for periodic pipeline");
  const resolvedModel = model ?? getDefaultModels().free;
  const openai = makeClient(apiKey, baseURL);
  const prompt = loadPrompt("52_monthly_rollup.md");

  const parsedWeeklies = weeklySummaryJsons.map((s) => {
    try { return extractJson(s); } catch { return { headline: "No data", themes: [] }; }
  });

  const input = JSON.stringify({
    month,
    weekly_summaries: parsedWeeklies,
  });

  const completion = await openai.chat.completions.create({
    model: resolvedModel,
    messages: [
      { role: "user", content: `${prompt}\n\nINPUT JSON:\n${input}` },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw?.trim()) throw new Error("Monthly rollup pipeline returned no content");
  extractJson(raw); // validate JSON
  return raw;
}
