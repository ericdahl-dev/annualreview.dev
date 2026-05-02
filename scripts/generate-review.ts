#!/usr/bin/env node
/**
 * evidence.json → run pipeline → write themes.json, bullets.json, stories.json, self_eval.json to --out (default: ./out).
 * Usage: node --import tsx/esm scripts/generate-review.ts [path/to/evidence.json] [--out dir]
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseArgs as parseArgsBase } from "../lib/parse-args.ts";
import { runPipeline } from "../lib/run-pipeline.ts";
import { generateMarkdown } from "../lib/generate-markdown.ts";
import type { Evidence } from "../types/evidence.js";
import type { PipelineResult } from "../lib/run-pipeline.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const GENERATE_REVIEW_SCHEMA = {
  flags: [{ name: "outDir", option: "--out", type: "string" as const }],
  positionals: [{ name: "input" }],
  defaults: {
    input: () => join(process.cwd(), "evidence.json"),
    outDir: () => join(process.cwd(), "out"),
  },
};

const STEP_LABELS = [
  "Themes",
  "Impact bullets",
  "STAR stories",
  "Self-eval sections",
];
const BAR_WIDTH = 16;
const BLOCK = 4;

let stepAnimationId: ReturnType<typeof setInterval> | null = null;
let stepStartTime = 0;

export function stopStepAnimation(): void {
  if (stepAnimationId != null) {
    clearInterval(stepAnimationId);
    stepAnimationId = null;
  }
}

function formatElapsed(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function startStepAnimation(
  stepIndex: number,
  total: number,
  label: string,
  estText = ""
): void {
  let pos = 0;
  stepStartTime = Date.now();
  stepAnimationId = setInterval(() => {
    const before = " ".repeat(pos);
    const block = "▓".repeat(BLOCK);
    const after = " ".repeat(BAR_WIDTH - BLOCK - pos);
    const bar = `[${before}${block}${after}]`;
    const elapsed = formatElapsed(Date.now() - stepStartTime);
    const suffix = estText ? ` ${elapsed} (est. ${estText})` : ` ${elapsed}`;
    process.stdout.write(
      `\r  ${bar} ${stepIndex}/${total} ${label}...${suffix}  `
    );
    pos = (pos + 1) % (BAR_WIDTH - BLOCK + 1);
  }, 80);
}

/** Exported for tests that exercise progress animation. */
export function onStepProgress(
  stepIndex: number,
  total: number,
  label: string,
  contributionCount = 0
): void {
  stopStepAnimation();
  if (stepIndex > 1 && stepStartTime) {
    const prevLabel = STEP_LABELS[stepIndex - 2];
    const durationStr = ` (${formatElapsed(Date.now() - stepStartTime)})`;
    process.stdout.write(
      `\r  ✓ [${stepIndex - 1}/${total}] ${prevLabel}${durationStr}${" ".repeat(20)}\n`
    );
  }
  if (stepIndex <= total) {
    const est =
      stepIndex === 1 && contributionCount > 20
        ? "1–2 min"
        : stepIndex === 1 && contributionCount > 0
          ? "~30s"
          : stepIndex > 1
            ? "~30s"
            : "";
    startStepAnimation(stepIndex, total, label, est);
  }
}

function parseArgs(
  argv: string[] = process.argv.slice(2)
): Record<string, unknown> {
  return parseArgsBase(GENERATE_REVIEW_SCHEMA, argv);
}

export { parseArgs };

type PipelineFn = (
  evidence: Evidence,
  opts: { onProgress?: (data: { stepIndex: number; total: number; label: string }) => void }
) => Promise<PipelineResult>;

export async function runGenerateReview(
  inputPath: string,
  outDir: string,
  pipelineFn: PipelineFn = runPipeline,
  opts: { onProgress?: (data: { stepIndex: number; total: number; label: string }) => void } = {}
): Promise<PipelineResult> {
  const evidence = JSON.parse(
    readFileSync(inputPath, "utf8")
  ) as Evidence;
  const { themes, bullets, stories, self_eval } = await pipelineFn(
    evidence,
    opts
  );
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "themes.json"),
    JSON.stringify(themes, null, 2)
  );
  writeFileSync(
    join(outDir, "bullets.json"),
    JSON.stringify(bullets, null, 2)
  );
  writeFileSync(
    join(outDir, "stories.json"),
    JSON.stringify(stories, null, 2)
  );
  writeFileSync(
    join(outDir, "self_eval.json"),
    JSON.stringify(self_eval, null, 2)
  );
  const markdown = generateMarkdown(
    { themes, bullets, stories, self_eval },
    { timeframe: evidence.timeframe }
  );
  writeFileSync(join(outDir, "report.md"), markdown);
  return { themes, bullets, stories, self_eval };
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  const input = (parsed.input ?? join(process.cwd(), "evidence.json")) as string;
  const outDir = (parsed.outDir ?? join(process.cwd(), "out")) as string;
  let contributionCount = 0;
  try {
    const evidence = JSON.parse(
      readFileSync(input, "utf8")
    ) as { contributions?: unknown[] };
    contributionCount = evidence.contributions?.length ?? 0;
  } catch {
    // use 0 if we can't read yet
  }
  console.log(
    "Running pipeline... (first step may take 1–2 min for large evidence)\n"
  );
  const onProgress = ({
    stepIndex,
    total,
    label,
  }: {
    stepIndex: number;
    total: number;
    label: string;
  }) => {
    onStepProgress(stepIndex, total, label, contributionCount);
  };
  await runGenerateReview(input, outDir, runPipeline, { onProgress });
  stopStepAnimation();
  if (stepStartTime) {
    process.stdout.write(
      `\r  ✓ [4/4] ${STEP_LABELS[3]} (${formatElapsed(Date.now() - stepStartTime)})${" ".repeat(12)}\n`
    );
  } else {
    process.stdout.write(`\r  ✓ [4/4] ${STEP_LABELS[3]}${" ".repeat(24)}\n`);
  }
  console.log(
    "Wrote themes.json, bullets.json, stories.json, self_eval.json, report.md to",
    outDir
  );
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain)
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
