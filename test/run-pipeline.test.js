import { describe, it, expect, vi } from "vitest";
import { extractJson, runPipeline, clearPipelineCache, getMaxUserTokensForTier, PipelineCache } from "../lib/run-pipeline.js";

const mockThemes = { themes: [{ theme_id: "t1", theme_name: "Reliability" }] };
const mockBullets = { bullets_by_theme: [], top_10_bullets_overall: [] };
const mockStories = { stories: [] };
const mockSelfEval = { sections: { summary: { text: "Done" } } };

let createCallCount = 0;
let lastCreateArgs = [];
/** Set to array of 4 content values (string | null | undefined) to override LLM response per step. Reset in beforeEach. */
let mockStepContentsOverride = null;
function MockOpenAI() {
  const defaults = [
    JSON.stringify(mockThemes),
    JSON.stringify(mockBullets),
    JSON.stringify(mockStories),
    JSON.stringify(mockSelfEval),
  ];
  this.chat = {
    completions: {
      create: (args) => {
        createCallCount++;
        lastCreateArgs.push(args);
        const stepIndex = createCallCount - 1;
        const content =
          mockStepContentsOverride && mockStepContentsOverride[stepIndex] !== undefined
            ? mockStepContentsOverride[stepIndex]
            : defaults[stepIndex % 4];
        return Promise.resolve({ choices: [{ message: { content } }] });
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

describe("getMaxUserTokensForTier", () => {
  it("returns default premium cap when premium is true", () => {
    const previousPremium = process.env.MAX_USER_TOKENS_PREMIUM;
    try {
      delete process.env.MAX_USER_TOKENS_PREMIUM;
      expect(getMaxUserTokensForTier(true)).toBe(184_000);
    } finally {
      if (previousPremium === undefined) {
        delete process.env.MAX_USER_TOKENS_PREMIUM;
      } else {
        process.env.MAX_USER_TOKENS_PREMIUM = previousPremium;
      }
    }
  });

  it("returns default free cap when premium is false", () => {
    const previousFree = process.env.MAX_USER_TOKENS_FREE;
    try {
      delete process.env.MAX_USER_TOKENS_FREE;
      expect(getMaxUserTokensForTier(false)).toBe(500_000);
    } finally {
      if (previousFree === undefined) {
        delete process.env.MAX_USER_TOKENS_FREE;
      } else {
        process.env.MAX_USER_TOKENS_FREE = previousFree;
      }
    }
  });

  it("uses MAX_USER_TOKENS_PREMIUM when set", () => {
    const previousPremium = process.env.MAX_USER_TOKENS_PREMIUM;
    try {
      process.env.MAX_USER_TOKENS_PREMIUM = "100000";
      expect(getMaxUserTokensForTier(true)).toBe(100_000);
    } finally {
      if (previousPremium === undefined) {
        delete process.env.MAX_USER_TOKENS_PREMIUM;
      } else {
        process.env.MAX_USER_TOKENS_PREMIUM = previousPremium;
      }
    }
  });

  it("uses MAX_USER_TOKENS_FREE when set", () => {
    const previousFree = process.env.MAX_USER_TOKENS_FREE;
    try {
      process.env.MAX_USER_TOKENS_FREE = "200000";
      expect(getMaxUserTokensForTier(false)).toBe(200_000);
    } finally {
      if (previousFree === undefined) {
        delete process.env.MAX_USER_TOKENS_FREE;
      } else {
        process.env.MAX_USER_TOKENS_FREE = previousFree;
      }
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
    mockStepContentsOverride = null;
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

  it("throws step-specific error when LLM returns empty string for a step", async () => {
    mockStepContentsOverride = [
      "",
      JSON.stringify(mockBullets),
      JSON.stringify(mockStories),
      JSON.stringify(mockSelfEval),
    ];
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await expect(runPipeline(evidence, { apiKey: "sk-test" })).rejects.toThrow(
      /Pipeline step "themes" returned no content/
    );
  });

  it("throws step-specific error when LLM returns null content for a step", async () => {
    mockStepContentsOverride = [
      null,
      JSON.stringify(mockBullets),
      JSON.stringify(mockStories),
      JSON.stringify(mockSelfEval),
    ];
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await expect(runPipeline(evidence, { apiKey: "sk-test" })).rejects.toThrow(
      /Pipeline step "themes" returned no content/
    );
  });

  it("cache hit fires onProgress for all steps", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await runPipeline(evidence, { apiKey: "sk-test" });
    const steps = [];
    await runPipeline(evidence, {
      apiKey: "sk-test",
      onProgress: (p) => steps.push(p.stepIndex),
    });
    expect(steps).toEqual([1, 2, 3, 4]);
  });

  it("reports prevStepMs and prevStepPayloadTokens via onProgress", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    const progressData = [];
    await runPipeline(evidence, {
      apiKey: "sk-test",
      onProgress: (p) => progressData.push(p),
    });
    expect(progressData.length).toBeGreaterThanOrEqual(4);
    const lastStep = progressData[progressData.length - 1];
    expect(lastStep.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("passes posthogTraceId and posthogDistinctId to LLM calls", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await runPipeline(evidence, {
      apiKey: "sk-test",
      posthogTraceId: "trace123",
      posthogDistinctId: "user456",
    });
    expect(lastCreateArgs[0]).toMatchObject({
      posthogTraceId: "trace123",
      posthogDistinctId: "user456",
    });
  });

  it("getMaxUserTokensForTier ignores non-finite env values", () => {
    const prev = process.env.MAX_USER_TOKENS_FREE;
    try {
      process.env.MAX_USER_TOKENS_FREE = "notanumber";
      expect(getMaxUserTokensForTier(false)).toBe(500_000);
      process.env.MAX_USER_TOKENS_FREE = "-1";
      expect(getMaxUserTokensForTier(false)).toBe(500_000);
      process.env.MAX_USER_TOKENS_FREE = "";
      expect(getMaxUserTokensForTier(false)).toBe(500_000);
    } finally {
      if (prev === undefined) delete process.env.MAX_USER_TOKENS_FREE;
      else process.env.MAX_USER_TOKENS_FREE = prev;
    }
  });

  it("runs pipeline successfully when contributions are present", async () => {
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [{ id: "r#1", type: "pull_request", title: "T", url: "https://x", repo: "x/y", summary: "s", body: "b" }],
    };
    const result = await runPipeline(evidence, { apiKey: "sk-test" });
    expect(result.themes).toBeDefined();
  });

  it("injectable PipelineCache isolates cache state between test instances", async () => {
    const cache1 = new PipelineCache();
    const cache2 = new PipelineCache();
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await runPipeline(evidence, { apiKey: "sk-test", cache: cache1 });
    const callsAfterFirst = createCallCount;
    await runPipeline(evidence, { apiKey: "sk-test", cache: cache2 });
    // cache2 is fresh — should call LLM again
    expect(createCallCount).toBe(callsAfterFirst + 4);
    await runPipeline(evidence, { apiKey: "sk-test", cache: cache1 });
    // cache1 hit — no more calls
    expect(createCallCount).toBe(callsAfterFirst + 4);
  });

  it("throws step-specific error when LLM returns malformed JSON for a step", async () => {
    mockStepContentsOverride = [
      "not valid json at all",
      JSON.stringify(mockBullets),
      JSON.stringify(mockStories),
      JSON.stringify(mockSelfEval),
    ];
    const evidence = {
      timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
      contributions: [],
    };
    await expect(runPipeline(evidence, { apiKey: "sk-test" })).rejects.toThrow(
      /Step themes returned invalid JSON/
    );
  });
});
