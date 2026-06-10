import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractJson,
  getDefaultModels,
  resolveModel,
  createNarrativeClient,
  runNarrativeCompletion,
  runNarrativeJsonPrompt,
  OPENROUTER_BASE,
} from "../lib/narrative-model-runner.js";

let createCallCount = 0;
let lastCreateArgs = null;
function MockOpenAI() {
  this.chat = {
    completions: {
      create: (args) => {
        createCallCount++;
        lastCreateArgs = args;
        return Promise.resolve({
          choices: [{ message: { content: '{"ok":true}' } }],
        });
      },
    },
  };
}
vi.mock("@posthog/ai/openai", () => ({ OpenAI: MockOpenAI }));
vi.mock("posthog-node", () => ({
  PostHog: function MockPostHog() {
    this.shutdown = () => Promise.resolve();
  },
}));

describe("extractJson", () => {
  it("extracts a single JSON object", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("strips leading and trailing text", () => {
    expect(extractJson("Here is the result:\n{\"themes\":[]}\nDone.")).toEqual({ themes: [] });
  });

  it("uses first { and last } for nested object", () => {
    expect(extractJson("x{\"nested\":{\"b\":2}}y")).toEqual({ nested: { b: 2 } });
  });

  it("throws when no object found", () => {
    expect(() => extractJson("no json here")).toThrow("No JSON object");
  });
});

describe("getDefaultModels", () => {
  it("returns env overrides when set", () => {
    const prevFree = process.env.LLM_MODEL;
    const prevPremium = process.env.PREMIUM_LLM_MODEL;
    try {
      process.env.LLM_MODEL = "free-model";
      process.env.PREMIUM_LLM_MODEL = "premium-model";
      expect(getDefaultModels()).toEqual({ free: "free-model", premium: "premium-model" });
    } finally {
      if (prevFree === undefined) delete process.env.LLM_MODEL;
      else process.env.LLM_MODEL = prevFree;
      if (prevPremium === undefined) delete process.env.PREMIUM_LLM_MODEL;
      else process.env.PREMIUM_LLM_MODEL = prevPremium;
    }
  });
});

describe("resolveModel", () => {
  it("uses explicit model when provided", () => {
    expect(resolveModel({ model: "custom/model" })).toBe("custom/model");
  });

  it("selects premium default when premium is true", () => {
    const { premium } = getDefaultModels();
    expect(resolveModel({ premium: true })).toBe(premium);
  });
});

describe("createNarrativeClient", () => {
  beforeEach(() => {
    createCallCount = 0;
    lastCreateArgs = null;
    process.env.POSTHOG_API_KEY = "ph_test";
  });

  it("sets posthogProviderOverride for OpenRouter base URL", async () => {
    const client = createNarrativeClient({
      apiKey: "sk-or-test",
      baseURL: OPENROUTER_BASE,
      posthogTraceId: "trace123",
      posthogDistinctId: "user456",
    });
    try {
      await client.openai.chat.completions.create({
        model: "anthropic/claude-3-haiku",
        messages: [{ role: "user", content: "hi" }],
        ...client.posthogOpts,
      });
      expect(lastCreateArgs).toMatchObject({
        posthogProviderOverride: "openrouter",
        posthogTraceId: "trace123",
        posthogDistinctId: "user456",
      });
    } finally {
      await client.shutdown();
    }
  });
});

describe("runNarrativeCompletion", () => {
  beforeEach(() => {
    createCallCount = 0;
    lastCreateArgs = null;
    process.env.POSTHOG_API_KEY = "ph_test";
  });

  it("includes system prompt and parses JSON", async () => {
    const client = createNarrativeClient({ apiKey: "sk-test", baseURL: OPENROUTER_BASE });
    try {
      const result = await runNarrativeCompletion({
        client,
        model: "anthropic/claude-3-haiku",
        promptContent: "Do the thing",
        inputJson: '{"x":1}',
        systemPrompt: "You are helpful",
        stepLabel: "themes",
      });
      expect(result.parsed).toEqual({ ok: true });
      expect(lastCreateArgs.messages[0]).toEqual({ role: "system", content: "You are helpful" });
      expect(lastCreateArgs.messages[1].content).toContain("Do the thing");
      expect(lastCreateArgs.messages[1].content).toContain('INPUT JSON:\n{"x":1}');
    } finally {
      await client.shutdown();
    }
  });

  it("wraps invalid JSON with step label by default", async () => {
    const client = createNarrativeClient({ apiKey: "sk-test", baseURL: OPENROUTER_BASE });
    client.openai.chat.completions.create = () =>
      Promise.resolve({ choices: [{ message: { content: "not json" } }] });
    try {
      await expect(
        runNarrativeCompletion({
          client,
          model: "anthropic/claude-3-haiku",
          promptContent: "Do the thing",
          inputJson: "{}",
          stepLabel: "themes",
        })
      ).rejects.toThrow(/Step themes returned invalid JSON/);
    } finally {
      await client.shutdown();
    }
  });

  it("uses custom empty content error", async () => {
    const client = createNarrativeClient({ apiKey: "sk-test", baseURL: OPENROUTER_BASE });
    client.openai.chat.completions.create = () =>
      Promise.resolve({ choices: [{ message: { content: "" } }] });
    try {
      await expect(
        runNarrativeCompletion({
          client,
          model: "anthropic/claude-3-haiku",
          promptContent: "Do the thing",
          inputJson: "{}",
          emptyContentError: "Daily summary pipeline returned no content",
        })
      ).rejects.toThrow("Daily summary pipeline returned no content");
    } finally {
      await client.shutdown();
    }
  });
});

describe("runNarrativeJsonPrompt", () => {
  beforeEach(() => {
    createCallCount = 0;
    lastCreateArgs = null;
    process.env.POSTHOG_API_KEY = "ph_test";
  });

  it("returns raw JSON string from a single-shot prompt", async () => {
    const raw = await runNarrativeJsonPrompt({
      apiKey: "sk-test",
      baseURL: OPENROUTER_BASE,
      model: "anthropic/claude-3-haiku",
      promptContent: "Summarize",
      inputJson: '{"day":"2025-01-01"}',
    });
    expect(raw).toBe('{"ok":true}');
    expect(createCallCount).toBe(1);
  });
});
