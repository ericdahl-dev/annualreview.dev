/**
 * Shared narrative model runner: OpenRouter client setup, prompt execution,
 * JSON extraction, model defaults, and PostHog tracing for LLM calls.
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import OpenAI from "openai";
import { OpenAI as PostHogOpenAI } from "@posthog/ai/openai";
import { PostHog } from "posthog-node";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "prompts");

export const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

export function loadPrompt(name: string): string {
  return readFileSync(join(PROMPTS_DIR, name), "utf8").trim();
}

/** Default model ids for free and premium (OpenRouter). */
export function getDefaultModels(): { free: string; premium: string } {
  return {
    free: process.env.LLM_MODEL ?? "anthropic/claude-3-haiku",
    premium: process.env.PREMIUM_LLM_MODEL ?? "anthropic/claude-haiku-4.5",
  };
}

export function resolveModel(options: { model?: string; premium?: boolean } = {}): string {
  const { model, premium = false } = options;
  return model ?? getDefaultModels()[premium ? "premium" : "free"];
}

/** Pull first {...} from LLM response text and parse as JSON. */
export function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}") + 1;
  if (start === -1 || end === 0) throw new Error("No JSON object in response");
  return JSON.parse(text.slice(start, end));
}

export interface NarrativeClient {
  openai: OpenAI;
  posthogOpts: Record<string, string | boolean>;
  shutdown: () => Promise<void>;
}

export interface CreateNarrativeClientOptions {
  apiKey: string;
  baseURL?: string;
  posthogTraceId?: string;
  posthogDistinctId?: string;
}

export function createNarrativeClient({
  apiKey,
  baseURL,
  posthogTraceId,
  posthogDistinctId,
}: CreateNarrativeClientOptions): NarrativeClient {
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

export interface NarrativeCompletionOptions {
  client: NarrativeClient;
  model: string;
  promptContent: string;
  inputJson: string;
  systemPrompt?: string;
  stepLabel?: string;
  emptyContentError?: string;
  /** When false, rethrow extractJson errors without step wrapping. Default true. */
  wrapJsonErrors?: boolean;
}

export async function runNarrativeCompletion({
  client,
  model,
  promptContent,
  inputJson,
  systemPrompt,
  stepLabel = "narrative prompt",
  emptyContentError,
  wrapJsonErrors = true,
}: NarrativeCompletionOptions): Promise<{ raw: string; parsed: unknown }> {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: `${promptContent}\n\nINPUT JSON:\n${inputJson}` });

  const completion = await client.openai.chat.completions.create({
    model,
    messages,
    ...client.posthogOpts,
  });

  const rawContent = completion.choices[0]?.message?.content;
  if (rawContent == null || (typeof rawContent === "string" && rawContent.trim() === "")) {
    throw new Error(emptyContentError ?? `Pipeline step "${stepLabel}" returned no content`);
  }

  try {
    return { raw: rawContent, parsed: extractJson(rawContent) };
  } catch (err) {
    if (!wrapJsonErrors) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Step ${stepLabel} returned invalid JSON: ${msg}`);
  }
}

export interface RunNarrativeJsonPromptOptions extends CreateNarrativeClientOptions {
  model: string;
  promptContent: string;
  inputJson: string;
  systemPrompt?: string;
  stepLabel?: string;
  emptyContentError?: string;
  wrapJsonErrors?: boolean;
}

/** Single-shot prompt helper: creates client, runs one completion, shuts down. */
export async function runNarrativeJsonPrompt(options: RunNarrativeJsonPromptOptions): Promise<string> {
  const client = createNarrativeClient(options);
  try {
    const { raw } = await runNarrativeCompletion({ ...options, client });
    return raw;
  } finally {
    await client.shutdown();
  }
}
