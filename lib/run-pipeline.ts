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
import type { ThemesOutput, BulletsOutput, StoriesOutput, SelfEvalOutput } from "./generate-markdown.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

const SYSTEM_PROMPT = loadPrompt("00_system.md");

// ── PipelineCache ──────────────────────────────────────────────────────────────

const RESULT_CACHE_MAX = 50;

function makeCacheKey(evidence: unknown, model: string): string {
  const str = JSON.stringify({ evidence, model });
  return createHash("sha256").update(str).digest("hex");
}

/** LRU result cache. Injectable so tests can use isolated instances. */
export class PipelineCache {
  private readonly store = new Map<string, PipelineResult>();

  get(evidence: unknown, model: string): PipelineResult | undefined {
    return this.store.get(makeCacheKey(evidence, model));
  }

  set(evidence: unknown, model: string, result: PipelineResult): void {
    const key = makeCacheKey(evidence, model);
    if (this.store.size >= RESULT_CACHE_MAX) {
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) this.store.delete(firstKey);
    }
    this.store.set(key, result);
  }

  clear(): void {
    this.store.clear();
  }
}

/** Module-level default cache (shared across all calls that don't inject their own). */
const defaultCache = new PipelineCache();

/** Clear the default result cache. Prefer injecting a fresh PipelineCache in tests. */
export function clearPipelineCache(): void {
  defaultCache.clear();
}

// ── PostHog client factory ─────────────────────────────────────────────────────

interface PostHogClientResult {
  openai: OpenAI;
  posthogOpts: Record<string, string | boolean>;
  shutdown: () => Promise<void>;
}

function createOpenAiClient(
  apiKey: string,
  baseURL: string | undefined,
  posthogTraceId: string | undefined,
  posthogDistinctId: string | undefined
): PostHogClientResult {
  const posthogApiKey = process.env.POSTHOG_API_KEY;
  const posthogClient = posthogApiKey
    ? new PostHog(posthogApiKey, { host: process.env.POSTHOG_HOST || "https://us.i.posthog.com" })
    : null;

  const clientOpts: ConstructorParameters<typeof OpenAI>[0] = { apiKey };
  if (baseURL) {
    clientOpts.baseURL = baseURL;
    clientOpts.defaultHeaders = {
      "HTTP-Referer": "https://annualreview.dev",
      "X-Title": "AnnualReview.dev",
    };
  }

  const openai: OpenAI = posthogClient
    ? new PostHogOpenAI({
        ...clientOpts,
        apiKey,
        posthog: posthogClient,
      } as ConstructorParameters<typeof PostHogOpenAI>[0]) as unknown as OpenAI
    : new OpenAI(clientOpts);

  const posthogOpts: Record<string, string | boolean> = {};
  if (posthogTraceId != null) posthogOpts.posthogTraceId = posthogTraceId;
  if (posthogDistinctId != null) posthogOpts.posthogDistinctId = posthogDistinctId;
  if (posthogClient) posthogOpts.posthogCaptureImmediate = true;
  if (posthogClient && baseURL?.includes("openrouter.ai")) posthogOpts.posthogProviderOverride = "openrouter";

  return {
    openai,
    posthogOpts,
    shutdown: () => (posthogClient ? posthogClient.shutdown() : Promise.resolve()),
  };
}

// ── extractJson ────────────────────────────────────────────────────────────────

/** Pull first {...} from LLM response text and parse as JSON. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}") + 1;
  if (start === -1 || end === 0) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end));
}

// ── Pipeline step definitions ──────────────────────────────────────────────────

/** Collect all evidence ids referenced in themes and bullets (and optional stories). */
function collectEvidenceIds(
  themes: ThemesOutput | null,
  bullets: BulletsOutput | null,
  stories: StoriesOutput | null = null
): Set<string> {
  const ids = new Set<string>();
  for (const theme of themes?.themes ?? []) {
    for (const id of theme.evidence_ids ?? []) ids.add(id);
    for (const anchor of theme.anchor_evidence ?? []) if (anchor?.id) ids.add(anchor.id);
  }
  for (const bulletGroup of bullets?.bullets_by_theme ?? []) {
    for (const bullet of bulletGroup.bullets ?? []) {
      for (const evidenceItem of bullet.evidence ?? []) if (evidenceItem?.id) ids.add(evidenceItem.id);
    }
  }
  for (const story of stories?.stories ?? []) {
    for (const evidenceItem of story.evidence ?? []) if (evidenceItem?.id) ids.add(evidenceItem.id);
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

type PartialPipelineResult = {
  themes?: ThemesOutput;
  bullets?: BulletsOutput;
  stories?: StoriesOutput;
  self_eval?: SelfEvalOutput;
};

interface PipelineStep {
  key: string;
  label: string;
  promptFile: string;
  buildInput: (evidence: Evidence, prev: PartialPipelineResult) => string;
}

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
        prev.themes ?? null,
        prev.bullets ?? null
      );
      const contribs = contributionsForPayload(evidence.contributions, ids, { bodyChars: 300, summaryChars: 400 });
      return JSON.stringify(
        {
          timeframe: evidence.timeframe,
          goals: evidence.goals,
          themes: prev.themes,
          bullets_by_theme: prev.bullets?.bullets_by_theme,
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
        prev.themes ?? null,
        prev.bullets ?? null,
        prev.stories ?? null
      );
      const contribs = contributionsForPayload(evidence.contributions, ids, { minimal: true });
      return JSON.stringify(
        {
          timeframe: evidence.timeframe,
          goals: evidence.goals,
          role_context_optional: evidence.role_context_optional,
          themes: prev.themes,
          top_10_bullets_overall: prev.bullets?.top_10_bullets_overall ?? [],
          stories: prev.stories?.stories ?? [],
          contributions: contribs,
        },
        null,
        2
      );
    },
  },
];

// ── Public types ───────────────────────────────────────────────────────────────

export interface PipelineResult {
  themes: ThemesOutput;
  bullets: BulletsOutput;
  stories: StoriesOutput;
  self_eval: SelfEvalOutput;
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
  /** Injectable cache instance. When omitted, uses the module-level default cache. */
  cache?: PipelineCache;
}

/** Default model ids for free and premium (OpenRouter). */
export function getDefaultModels(): { free: string; premium: string } {
  return {
    free: process.env.LLM_MODEL ?? "anthropic/claude-3-haiku",
    premium: process.env.PREMIUM_LLM_MODEL ?? "anthropic/claude-haiku-4.5",
  };
}

/** Max user-message tokens by tier. Env override: MAX_USER_TOKENS_FREE, MAX_USER_TOKENS_PREMIUM. */
export function getMaxUserTokensForTier(premium: boolean): number {
  const envKey = premium ? "MAX_USER_TOKENS_PREMIUM" : "MAX_USER_TOKENS_FREE";
  const val = process.env[envKey];
  if (val != null && val !== "") {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return premium ? 184_000 : 500_000;
}

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// ── Prompt loop ────────────────────────────────────────────────────────────────

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
    cache = defaultCache,
  }: PipelineOptions = {}
): Promise<PipelineResult> {
  if (!apiKey) throw new Error("OPENROUTER_API_KEY required");

  const resolvedModel = model ?? getDefaultModels()[premium ? "premium" : "free"];

  const cached = cache.get(evidence, resolvedModel);
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

  const { openai, posthogOpts, shutdown } = createOpenAiClient(
    apiKey,
    baseURL,
    posthogTraceId,
    posthogDistinctId
  );

  const total = STEPS.length;

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

    const maxUserTokens = getMaxUserTokensForTier(premium);
    evidence = fitEvidenceToBudget(evidence, (ev) => STEPS[0].buildInput(ev, {}), maxUserTokens);

    const previousResults: PartialPipelineResult = {};
    let prevStepMs: number | undefined;
    let prevStepPayloadTokens: number | undefined;

    for (let stepIndex = 1; stepIndex <= total; stepIndex++) {
      const step = STEPS[stepIndex - 1];
      progress(stepIndex, undefined, stepIndex === 1 ? {} : { prevStepMs, prevStepPayloadTokens });

      const stepStart = Date.now();
      const input = step.buildInput(evidence, previousResults);
      const promptContent = loadPrompt(step.promptFile);
      const completion = await openai.chat.completions.create({
        model: resolvedModel,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `${promptContent}\n\nINPUT JSON:\n${input}` },
        ],
        ...posthogOpts,
      });
      const rawContent = completion.choices[0]?.message?.content;
      if (rawContent == null || (typeof rawContent === "string" && rawContent.trim() === "")) {
        throw new Error(`Pipeline step "${step.key}" returned no content`);
      }
      let stepResult: unknown;
      try {
        stepResult = extractJson(rawContent);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Step ${step.key} returned invalid JSON: ${msg}`);
      }
      (previousResults as Record<string, unknown>)[step.key] = stepResult;
      prevStepMs = Date.now() - stepStart;
      prevStepPayloadTokens = estimateTokens(input);
    }

    progress(total, undefined, { prevStepMs, prevStepPayloadTokens, totalMs: Date.now() - totalStart });

    const result: PipelineResult = {
      themes: previousResults.themes as ThemesOutput,
      bullets: previousResults.bullets as BulletsOutput,
      stories: previousResults.stories as StoriesOutput,
      self_eval: previousResults.self_eval as SelfEvalOutput,
    };
    cache.set(evidence, resolvedModel, result);
    return result;
  } finally {
    await shutdown();
  }
}
