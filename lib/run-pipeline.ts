/**
 * Four-step pipeline: evidence JSON → themes → bullets → STAR stories → self_eval.
 * Uses OpenRouter with Claude models (free: Haiku, premium: Sonnet). Requires OPENROUTER_API_KEY.
 */

import { createHash } from "crypto";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { OpenAI as PostHogOpenAI } from "@posthog/ai/openai";
import { PostHog } from "posthog-node";
import { fitEvidenceToBudget, estimateTokens, slimContributions } from "./context-budget.js";
import type { Evidence } from "../types/evidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

const SYSTEM_PROMPT = loadPrompt("00_system.md");

const RESULT_CACHE_MAX = 50;
const resultCache = new Map<string, PipelineResult>();

/** Clear result cache (for tests). */
export function clearPipelineCache(): void {
  resultCache.clear();
}

function cacheKey(evidence: unknown, model: string): string {
  const str = JSON.stringify({ evidence, model });
  return createHash("sha256").update(str).digest("hex");
}

/** Pull first {...} from LLM response text and parse as JSON. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}") + 1;
  if (start === -1 || end === 0) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end));
}

/** Collect all evidence ids referenced in themes and bullets (and optional stories). */
function collectEvidenceIds(
  themes: Record<string, unknown> | null,
  bullets: Record<string, unknown> | null,
  stories: Record<string, unknown> | null = null
): Set<string> {
  const ids = new Set<string>();
  for (const t of (themes as { themes?: Array<{ evidence_ids?: string[]; anchor_evidence?: Array<{ id?: string }> }> })?.themes ?? []) {
    for (const id of t.evidence_ids ?? []) ids.add(id);
    for (const a of t.anchor_evidence ?? []) if (a?.id) ids.add(a.id);
  }
  for (const g of (bullets as { bullets_by_theme?: Array<{ bullets?: Array<{ evidence?: Array<{ id?: string }> }> }> })?.bullets_by_theme ?? []) {
    for (const b of g.bullets ?? []) {
      for (const e of b.evidence ?? []) if (e?.id) ids.add(e.id);
    }
  }
  for (const s of (stories as { stories?: Array<{ evidence?: Array<{ id?: string }> }> })?.stories ?? []) {
    for (const e of s.evidence ?? []) if (e?.id) ids.add(e.id);
  }
  return ids;
}

/** Filter contributions to those whose id is in the set; return slimmed for payload. */
function contributionsForPayload(
  contributions: Evidence["contributions"],
  idSet: Set<string>,
  opts: Record<string, unknown> = {}
): Record<string, unknown>[] {
  const byId = new Map(contributions.map((c) => [c.id, c]));
  const subset = idSet.size > 0
    ? [...idSet].map((id) => byId.get(id)).filter((c): c is Evidence["contributions"][0] => c !== undefined)
    : contributions;
  return slimContributions(subset, opts);
}

interface PipelineStep {
  key: string;
  label: string;
  promptFile: string;
  buildInput: (evidence: Evidence, prev: Record<string, unknown>) => string;
}

/** Declarative pipeline steps: key, label, prompt file, and buildInput(evidence, previousResults). */
const STEPS: PipelineStep[] = [
  {
    key: "themes",
    label: "Themes",
    promptFile: "10_theme_cluster.md",
    buildInput(evidence) {
      return JSON.stringify(
        { timeframe: evidence.timeframe, role_context_optional: evidence.role_context_optional, goals: evidence.goals, contributions: evidence.contributions },
        null,
        2
      );
    },
  },
  {
    key: "bullets",
    label: "Impact bullets",
    promptFile: "20_impact_bullets.md",
    buildInput(evidence, prev) {
      const slimmed = slimContributions(evidence.contributions, { bodyChars: 400, summaryChars: 500 });
      return JSON.stringify(
        { timeframe: evidence.timeframe, goals: evidence.goals, themes: prev.themes, contributions: slimmed },
        null,
        2
      );
    },
  },
  {
    key: "stories",
    label: "STAR stories",
    promptFile: "30_star_stories.md",
    buildInput(evidence, prev) {
      const ids = collectEvidenceIds(
        prev.themes as Record<string, unknown>,
        prev.bullets as Record<string, unknown>
      );
      const contribs = contributionsForPayload(evidence.contributions, ids, { bodyChars: 300, summaryChars: 400 });
      return JSON.stringify(
        {
          timeframe: evidence.timeframe,
          goals: evidence.goals,
          themes: prev.themes,
          bullets_by_theme: (prev.bullets as { bullets_by_theme?: unknown })?.bullets_by_theme,
          contributions: contribs,
        },
        null,
        2
      );
    },
  },
  {
    key: "self_eval",
    label: "Self-eval sections",
    promptFile: "40_self_eval_sections.md",
    buildInput(evidence, prev) {
      const ids = collectEvidenceIds(
        prev.themes as Record<string, unknown>,
        prev.bullets as Record<string, unknown>,
        prev.stories as Record<string, unknown>
      );
      const contribs = contributionsForPayload(evidence.contributions, ids, { minimal: true });
      return JSON.stringify(
        {
          timeframe: evidence.timeframe,
          goals: evidence.goals,
          role_context_optional: evidence.role_context_optional,
          themes: prev.themes,
          top_10_bullets_overall: (prev.bullets as { top_10_bullets_overall?: unknown[] })?.top_10_bullets_overall ?? [],
          stories: (prev.stories as { stories?: unknown[] })?.stories ?? [],
          contributions: contribs,
        },
        null,
        2
      );
    },
  },
];

export interface PipelineResult {
  themes: unknown;
  bullets: unknown;
  stories: unknown;
  self_eval: unknown;
}

export interface PipelineOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
  /** When true, uses the premium (higher-quality) model. */
  premium?: boolean;
  onProgress?: (progress: {
    stepIndex: number;
    total: number;
    step: string;
    label: string;
    prevStepMs?: number;
    prevStepPayloadTokens?: number;
    totalMs?: number;
  }) => void;
  posthogTraceId?: string;
  posthogDistinctId?: string;
}

/** Default model ids for free and premium (OpenRouter + Claude). */
export function getDefaultModels(): { free: string; premium: string } {
  return {
    free: process.env.LLM_MODEL ?? "anthropic/claude-3-haiku",
    premium: process.env.PREMIUM_LLM_MODEL ?? "anthropic/claude-3.5-sonnet",
  };
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export async function runPipeline(
  evidence: Evidence,
  {
    apiKey = process.env.OPENROUTER_API_KEY,
    model,
    baseURL = OPENROUTER_BASE,
    premium = false,
    onProgress,
    posthogTraceId,
    posthogDistinctId,
  }: PipelineOptions = {}
): Promise<PipelineResult> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required");

  const resolvedModel = model ?? getDefaultModels()[premium ? "premium" : "free"];

  const key = cacheKey(evidence, resolvedModel);
  const cached = resultCache.get(key);
  if (cached) {
    if (typeof onProgress === "function") {
      for (let i = 1; i <= STEPS.length; i++) {
        onProgress({
          stepIndex: i,
          total: STEPS.length,
          step: STEPS[i - 1].key,
          label: STEPS[i - 1].label,
        });
      }
    }
    return cached;
  }

  const phKey = process.env.POSTHOG_API_KEY;
  const phClient = phKey
    ? new PostHog(phKey, { host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" })
    : null;
  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) {
    clientOpts.baseURL = baseURL;
    clientOpts.defaultHeaders = {
      "HTTP-Referer": "https://annualreview.dev",
      "X-Title": "AnnualReview.dev",
    };
  }
  const openai: OpenAI = phClient
    ? new PostHogOpenAI({ ...clientOpts, posthog: phClient }) as unknown as OpenAI
    : new OpenAI(clientOpts);

  const total = STEPS.length;
  const posthogOpts: Record<string, string | boolean> = {};
  if (posthogTraceId != null) posthogOpts.posthogTraceId = posthogTraceId;
  if (posthogDistinctId != null) posthogOpts.posthogDistinctId = posthogDistinctId;
  if (phClient) posthogOpts.posthogCaptureImmediate = true; // send each generation immediately so we don't rely on shutdown flush
  if (phClient && baseURL?.includes("openrouter.ai")) posthogOpts.posthogProviderOverride = "openrouter"; // correct $ai_provider in PostHog LLM analytics

  try {
  const totalStart = Date.now();
  function progress(
    stepIndex: number,
    label: string | undefined,
    extra: Record<string, unknown> = {}
  ) {
    if (typeof onProgress === "function") {
      onProgress({
        stepIndex,
        total,
        step: STEPS[stepIndex - 1].key,
        label: label || STEPS[stepIndex - 1].label,
        ...extra,
      } as Parameters<NonNullable<typeof onProgress>>[0]);
    }
  }

  evidence = fitEvidenceToBudget(evidence, (ev) => STEPS[0].buildInput(ev, {}));

  const previousResults: Record<string, unknown> = {};
  let prevStepMs: number | undefined;
  let prevStepPayloadTokens: number | undefined;

  for (let stepIndex = 1; stepIndex <= total; stepIndex++) {
    const step = STEPS[stepIndex - 1];
    progress(stepIndex, undefined, stepIndex === 1 ? {} : { prevStepMs, prevStepPayloadTokens });

    const stepStart = Date.now();
    const input = step.buildInput(evidence, previousResults);
    const promptContent = loadPrompt(step.promptFile);
    const res = await openai.chat.completions.create({
      model: resolvedModel,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${promptContent}\n\nINPUT JSON:\n${input}` },
      ],
      ...posthogOpts,
    });
    const stepResult = extractJson(res.choices[0]?.message?.content ?? "{}");
    previousResults[step.key] = stepResult;
    prevStepMs = Date.now() - stepStart;
    prevStepPayloadTokens = estimateTokens(input);
  }

  progress(total, undefined, { prevStepMs, prevStepPayloadTokens, totalMs: Date.now() - totalStart });

  const result: PipelineResult = {
    themes: previousResults.themes,
    bullets: previousResults.bullets,
    stories: previousResults.stories,
    self_eval: previousResults.self_eval,
  };
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const firstKey = resultCache.keys().next().value;
    if (firstKey !== undefined) resultCache.delete(firstKey);
  }
  resultCache.set(key, result);
  return result;
  } finally {
    if (phClient) await phClient.shutdown();
  }
}
