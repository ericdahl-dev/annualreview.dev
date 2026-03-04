import { describe, it, expect, vi } from "vitest";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "crypto";
import { runGenerateReview, parseArgs, stopStepAnimation, onStepProgress } from "../scripts/generate-review.ts";

describe("parseArgs", () => {
  it("defaults input to evidence.json and outDir to ./out", () => {
    const orig = process.argv.slice(2);
    process.argv = ["node", "generate-review.js"];
    const out = parseArgs();
    expect(out.input).toContain("evidence.json");
    expect(out.outDir).toBe(join(process.cwd(), "out"));
    process.argv = ["node", "generate-review.js", ...orig];
  });

  it("parses --out and positional input", () => {
    const orig = process.argv.slice(2);
    process.argv = ["node", "generate-review.js", "/path/to/ev.json", "--out", "/out"];
    const out = parseArgs();
    expect(out.input).toBe("/path/to/ev.json");
    expect(out.outDir).toBe("/out");
    process.argv = ["node", "generate-review.js", ...orig];
  });
});

describe("runGenerateReview", () => {
  it("writes themes, bullets, stories, self_eval to outDir", async () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const evidencePath = join(dir, "evidence.json");
    writeFileSync(
      evidencePath,
      JSON.stringify({
        timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
        contributions: [],
      })
    );
    const outDir = join(dir, "out");
    const mockPipeline = async () => ({
      themes: { themes: [{ theme_id: "t1", theme_name: "Reliability" }] },
      bullets: { bullets_by_theme: [], top_10_bullets_overall: [] },
      stories: { stories: [] },
      self_eval: { sections: { summary: { text: "Done" } } },
    });
    const result = await runGenerateReview(evidencePath, outDir, mockPipeline);
    expect(result.themes.themes).toHaveLength(1);
    expect(result.self_eval.sections.summary.text).toBe("Done");
    const files = readdirSync(outDir);
    expect(files.sort()).toEqual(["bullets.json", "report.md", "self_eval.json", "stories.json", "themes.json"]);
    const themesContent = JSON.parse(readFileSync(join(outDir, "themes.json"), "utf8"));
    expect(themesContent.themes[0].theme_name).toBe("Reliability");
    rmSync(dir, { recursive: true });
  });

  it("invokes onProgress when pipeline reports steps (covers animation/formatElapsed)", async () => {
    vi.useFakeTimers();
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const evidencePath = join(dir, "evidence.json");
    writeFileSync(
      evidencePath,
      JSON.stringify({
        timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" },
        contributions: Array.from({ length: 25 }, (_, i) => ({ id: `c${i}` })),
      })
    );
    const outDir = join(dir, "out");
    const steps = [
      { stepIndex: 1, total: 4, label: "Themes" },
      { stepIndex: 2, total: 4, label: "Impact bullets" },
      { stepIndex: 3, total: 4, label: "STAR stories" },
      { stepIndex: 4, total: 4, label: "Self-eval sections" },
    ];
    const mockPipeline = async (_evidence, opts) => {
      for (const s of steps) opts?.onProgress?.(s);
      return {
        themes: { themes: [] },
        bullets: { bullets_by_theme: [], top_10_bullets_overall: [] },
        stories: { stories: [] },
        self_eval: { sections: { summary: { text: "" } } },
      };
    };
    const contributionCount = 25;
    const onProgress = ({ stepIndex, total, label }) =>
      onStepProgress(stepIndex, total, label, contributionCount);
    const result = await runGenerateReview(evidencePath, outDir, mockPipeline, { onProgress });
    vi.advanceTimersByTime(200);
    stopStepAnimation();
    vi.useRealTimers();
    expect(result.themes.themes).toHaveLength(0);
    expect(readdirSync(outDir).sort()).toEqual(["bullets.json", "report.md", "self_eval.json", "stories.json", "themes.json"]);
    rmSync(dir, { recursive: true });
  });

  it("rejects when pipeline throws", async () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const evidencePath = join(dir, "evidence.json");
    writeFileSync(evidencePath, JSON.stringify({ timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" }, contributions: [] }));
    const outDir = join(dir, "out");
    const mockPipeline = async () => {
      throw new Error("pipeline failed");
    };
    await expect(runGenerateReview(evidencePath, outDir, mockPipeline)).rejects.toThrow("pipeline failed");
    rmSync(dir, { recursive: true });
  });

  it("rejects when input file is missing", async () => {
    const dir = join(tmpdir(), randomUUID());
    mkdirSync(dir, { recursive: true });
    const badPath = join(dir, "nonexistent.json");
    const outDir = join(dir, "out");
    await expect(runGenerateReview(badPath, outDir, async () => ({}))).rejects.toThrow();
    rmSync(dir, { recursive: true });
  });
});
