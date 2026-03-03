import { describe, it, expect, vi } from "vitest";
import { extractJson, runPipeline, clearPipelineCache, getMaxUserTokensForModel } from "../lib/run-pipeline.js";

const mockThemes = { themes: [{ theme_id: "t1", theme_name: "Reliability" }] };
const mockBullets = { bullets_by_theme: [], top_10_bullets_overall: [] };
const mockStories = { stories: [] };
const mockSelfEval = { sections: { summary: { text: "Done" } } };

let createCallCount = 0;
let lastCreateArgs = [];
function MockOpenAI() {
  const contents = [
    JSON.stringify(mockThemes),
    JSON.stringify(mockBullets),
    JSON.stringify(mockStories),
    JSON.stringify(mockSelfEval),
  ];
  let i = 0;
  this.chat = {
    completions: {
      create: (args) => {
        createCallCount++;
        lastCreateArgs.push(args);
        return Promise.resolve({ choices: [{ message: { content: contents[i++ % 4] } }] });
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

describe("getMaxUserTokensForModel", () => {
  it("returns default premium cap when premium is true", () => {
    delete process.env.MAX_USER_TOKENS_PREMIUM;
    expect(getMaxUserTokensForModel(true)).toBe(184_000);
  });

  it("returns default free cap when premium is false", () => {
    delete process.env.MAX_USER_TOKENS_FREE;
    expect(getMaxUserTokensForModel(false)).toBe(500_000);
  });

  it("uses MAX_USER_TOKENS_PREMIUM when set", () => {
    process.env.MAX_USER_TOKENS_PREMIUM = "100000";
    try {
      expect(getMaxUserTokensForModel(true)).toBe(100_000);
    } finally {
      delete process.env.MAX_USER_TOKENS_PREMIUM;
    }
  });

  it("uses MAX_USER_TOKENS_FREE when set", () => {
    process.env.MAX_USER_TOKENS_FREE = "200000";
    try {
      expect(getMaxUserTokensForModel(false)).toBe(200_000);
    } finally {
      delete process.env.MAX_USER_TOKENS_FREE;
    }
  });
});

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

describe("runPipeline", () => {
  beforeEach(() => {
    createCallCount = 0;
    lastCreateArgs = [];
    clearPipelineCache();
    process.env.POSTHOG_API_KEY = "ph_test";
  });

  it("throws when OPENROUTER_API_KEY is missing", async () => {
    const origOR = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await expect(runPipeline({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] })).rejects.toThrow("OPENROUTER_API_KEY required");
    } finally {
      if (origOR !== undefined) process.env.OPENROUTER_API_KEY = origOR;
    }
  });

  it("uses OPENROUTER_API_KEY with OpenRouter base URL", async () => {
    const origOR = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    try {
      const evidence = {
        timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
        contributions: [],
      };
      const result = await runPipeline(evidence);
      expect(result).toEqual({ themes: mockThemes, bullets: mockBullets, stories: mockStories, self_eval: mockSelfEval });
    } finally {
      if (origOR !== undefined) process.env.OPENROUTER_API_KEY = origOR;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("sets posthogProviderOverride=openrouter when PostHog is active", async () => {
    const origOR = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    try {
      await runPipeline({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] });
      expect(lastCreateArgs.length).toBe(4);
      for (const args of lastCreateArgs) {
        expect(args).toMatchObject({ posthogProviderOverride: "openrouter" });
      }
    } finally {
      if (origOR !== undefined) process.env.OPENROUTER_API_KEY = origOR;
      else delete process.env.OPENROUTER_API_KEY;
    }
  });

  it("returns themes, bullets, stories, self_eval with mocked client", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    const result = await runPipeline(evidence, { apiKey: "sk-test" });
    expect(result).toEqual({ themes: mockThemes, bullets: mockBullets, stories: mockStories, self_eval: mockSelfEval });
    expect(createCallCount).toBe(4);
  });

  it("cache hit returns same output shape without calling OpenAI again", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    const result1 = await runPipeline(evidence, { apiKey: "sk-test" });
    const result2 = await runPipeline(evidence, { apiKey: "sk-test" });
    expect(result1).toEqual(result2);
    expect(result2).toEqual({ themes: mockThemes, bullets: mockBullets, stories: mockStories, self_eval: mockSelfEval });
    expect(createCallCount).toBe(4);
  });

  it("passes goals through to pipeline when provided", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      goals: "Improve reliability\nGrow as a technical leader",
      contributions: [],
    };
    const result = await runPipeline(evidence, { apiKey: "sk-test" });
    expect(result).toEqual({ themes: mockThemes, bullets: mockBullets, stories: mockStories, self_eval: mockSelfEval });
    expect(createCallCount).toBe(4);
  });

  it("step 2 payload uses slimmed contributions", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [
        { id: "r#1", type: "pull_request", title: "T", url: "https://x/y", repo: "x/y", body: "long body", summary: "s" },
      ],
    };
    await runPipeline(evidence, { apiKey: "sk-test" });
    expect(createCallCount).toBe(4);
  });

  it("premium flag uses a different model than free tier", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await runPipeline(evidence, { apiKey: "sk-test", premium: false });
    const freeModel = lastCreateArgs[0]?.model;
    createCallCount = 0;
    lastCreateArgs = [];
    clearPipelineCache();
    await runPipeline(evidence, { apiKey: "sk-test", premium: true });
    const premiumModel = lastCreateArgs[0]?.model;
    expect(premiumModel).not.toBe(freeModel);
  });
});
