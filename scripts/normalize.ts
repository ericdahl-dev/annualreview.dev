/**
 * Raw GitHub JSON → evidence JSON (AGENTS.md contract). Dedupes: commits under PRs are dropped; orphan commits kept.
 * CLI: node --import tsx/esm scripts/normalize.ts [--input raw.json] [--output evidence.json] [--start/--end YYYY-MM-DD]
 */

import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { parseArgs as parseArgsBase } from "../lib/parse-args.ts";
import type { Contribution } from "../types/evidence.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NORMALIZE_SCHEMA = {
  flags: [
    { name: "input", option: "--input", type: "string" as const },
    { name: "output", option: "--output", type: "string" as const },
    { name: "start", option: "--start", type: "string" as const },
    { name: "end", option: "--end", type: "string" as const },
  ],
};

function parseArgs(argv: string[] = process.argv.slice(2)): Record<string, unknown> {
  return parseArgsBase(NORMALIZE_SCHEMA, argv);
}

function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const parsedDate = new Date(dateStr);
  return isNaN(parsedDate.getTime()) ? null : parsedDate;
}

function inRange(
  dateStr: string | null | undefined,
  start: string | null | undefined,
  end: string | null | undefined
): boolean {
  const d = parseDate(dateStr);
  if (!d) return false;
  if (start && parseDate(start) && d < parseDate(start)!) return false;
  if (end && parseDate(end) && d > parseDate(end)!) return false;
  return true;
}

function contributionId(
  repo: string,
  _type: string,
  numberOrSha: string | number
): string {
  const slug = (repo || "").replace(/\/$/, "");
  return slug ? `${slug}#${numberOrSha}` : `#${numberOrSha}`;
}

function createContribution(overrides: Partial<Contribution> = {}): Contribution {
  return {
    id: "",
    type: "pull_request",
    title: "",
    url: "",
    repo: "",
    merged_at: null,
    labels: [],
    files_changed: 0,
    additions: 0,
    deletions: 0,
    summary: "",
    body: "",
    linked_issues: [],
    review_comments_count: 0,
    approvals_count: 0,
    ...overrides,
  };
}

interface RawPr {
  number: number;
  title?: string;
  body?: string | null;
  url?: string;
  html_url?: string;
  merged_at?: string | null;
  created_at?: string;
  updated_at?: string;
  base?: { repo?: { full_name?: string } };
  head?: { repo?: { full_name?: string } };
  labels?: { name?: string }[] | string[];
  changed_files?: number;
  additions?: number;
  deletions?: number;
  review_comments?: number;
  commits?: { sha?: string; commit?: { sha?: string } }[] | string[];
}

function normalizePr(pr: RawPr, repo: string): Contribution {
  const mergedAt = pr.merged_at ?? null;
  const labels = (pr.labels || []).map((l) =>
    typeof l === "string" ? l : (l as { name?: string }).name ?? ""
  );
  return createContribution({
    id: contributionId(repo, "pull_request", pr.number),
    type: "pull_request",
    title: pr.title || "",
    url: pr.html_url || pr.url || "",
    repo: repo || pr.base?.repo?.full_name || "",
    merged_at: mergedAt,
    labels,
    files_changed: pr.changed_files ?? 0,
    additions: pr.additions ?? 0,
    deletions: pr.deletions ?? 0,
    summary: (pr.body || "").slice(0, 500),
    body: pr.body || "",
    review_comments_count: pr.review_comments ?? 0,
  });
}

interface RawReview {
  id: string;
  body?: string | null;
  state?: string;
  submitted_at?: string | null;
  created_at?: string;
  url?: string;
  html_url?: string;
  repository?: { full_name?: string };
  repo?: string;
  pull_number?: number;
  pull_request_url?: string;
}

function normalizeReview(
  review: RawReview,
  repo: string,
  pullNumber: string | number
): Contribution {
  return createContribution({
    id: contributionId(repo, "review", `${pullNumber}-${review.id}`),
    type: "review",
    title:
      `Review: ${(review.body || "").slice(0, 60)}` || `Review #${review.id}`,
    url: review.html_url || review.url || "",
    repo: repo || "",
    summary: (review.body || "").slice(0, 500),
    body: review.body || "",
    approvals_count: review.state === "APPROVED" ? 1 : 0,
  });
}

interface RawRelease {
  id?: string;
  tag_name?: string;
  name?: string;
  body?: string;
  html_url?: string;
  url?: string;
  published_at?: string;
  created_at?: string;
  target_commitish?: string;
  repository?: { full_name?: string };
}

function normalizeRelease(release: RawRelease, repo: string): Contribution {
  const publishedAt =
    release.published_at || release.created_at || null;
  return createContribution({
    id: contributionId(
      repo,
      "release",
      release.id ?? release.tag_name ?? ""
    ),
    type: "release",
    title: release.name || release.tag_name || "Release",
    url: release.html_url || release.url || "",
    repo: repo || release.target_commitish || "",
    merged_at: publishedAt,
    summary: (release.body || "").slice(0, 500),
    body: release.body || "",
  });
}

interface RawCommit {
  sha?: string;
  commit?: {
    sha?: string;
    author?: { date?: string };
    committer?: { date?: string };
    message?: string;
  };
  author?: { date?: string };
  committer?: { date?: string };
  html_url?: string;
  message?: string;
}

function normalizeCommit(
  commit: RawCommit,
  repo: string,
  sha: string | undefined
): Contribution {
  const inner = commit.commit ?? commit;
  const date =
    commit.author?.date ||
    inner?.committer?.date ||
    inner?.author?.date ||
    null;
  const msg = inner?.message || commit.message || "";
  return createContribution({
    id: contributionId(repo, "issue", (sha || "").slice(0, 7)),
    type: "issue",
    title: msg.split("\n")[0].slice(0, 200) || sha?.slice(0, 7) || "",
    url:
      commit.html_url ||
      `https://github.com/${repo}/commit/${sha}`,
    repo: repo || "",
    merged_at: date,
    summary: msg.slice(0, 500),
    body: msg,
  });
}

export interface RawGitHubInput {
  timeframe?: { start_date?: string; end_date?: string };
  role_context_optional?: unknown;
  pull_requests?: RawPr[];
  pulls?: RawPr[];
  pull_requests_list?: RawPr[];
  reviews?: RawReview[];
  releases?: RawRelease[];
  commits?: RawCommit[];
  repo?: string;
}

export interface NormalizeResult {
  timeframe: { start_date: string; end_date: string };
  role_context_optional: unknown;
  contributions: Contribution[];
}

export function normalize(
  raw: RawGitHubInput,
  start?: string | null,
  end?: string | null
): NormalizeResult {
  const contributions: Contribution[] = [];
  const prNumbersByRepo = new Set<string>();

  const rawPrs = raw.pull_requests || raw.pulls || raw.pull_requests_list || [];
  for (const pr of rawPrs) {
    const repo =
      pr.base?.repo?.full_name ||
      pr.head?.repo?.full_name ||
      raw.repo ||
      "";
    const mergedAt = pr.merged_at ?? null;
    if (start || end) {
      const useDate = mergedAt || pr.created_at || pr.updated_at;
      if (!inRange(useDate, start, end)) continue;
    }
    prNumbersByRepo.add(`${repo}#${pr.number}`);
    contributions.push(normalizePr(pr, repo));
  }

  const rawReviews = raw.reviews || [];
  for (const review of rawReviews) {
    const repo =
      review.repository?.full_name || review.repo || raw.repo || "";
    const pullNumber =
      review.pull_request_url?.split("/").pop() || review.pull_number;
    const date = review.submitted_at || review.created_at;
    if (start || end) {
      if (!inRange(date, start, end)) continue;
    }
    contributions.push(normalizeReview(review, repo, pullNumber ?? ""));
  }

  const rawReleases = raw.releases || [];
  for (const release of rawReleases) {
    const repo = release.target_commitish
      ? raw.repo || ""
      : release.repository?.full_name || raw.repo || "";
    const date = release.published_at || release.created_at;
    if (start || end) {
      if (!inRange(date, start, end)) continue;
    }
    contributions.push(normalizeRelease(release, repo));
  }

  const rawCommits = raw.commits || [];
  const commitShaToPr = new Map<string, boolean>();
  for (const pr of rawPrs) {
    const shas = Array.isArray(pr.commits) ? pr.commits : [];
    for (const commitRef of shas) {
      const sha =
        typeof commitRef === "string" ? commitRef : (commitRef as { sha?: string }).sha ?? (commitRef as { commit?: { sha?: string } }).commit?.sha;
      if (sha) commitShaToPr.set(sha, true);
    }
  }
  for (const commit of rawCommits) {
    const sha = commit.sha || commit.commit?.sha;
    const repo =
      (commit as RawCommit & { repository?: { full_name?: string } }).repository
        ?.full_name || raw.repo || "";
    const date =
      commit.commit?.author?.date ||
      commit.commit?.committer?.date ||
      (commit as RawCommit).author?.date;
    if (start || end) {
      if (!inRange(date, start, end)) continue;
    }
    if (sha && commitShaToPr.has(sha)) continue;
    contributions.push(normalizeCommit(commit, repo, sha));
  }

  const startDate =
    start || raw.timeframe?.start_date || "2020-01-01";
  const endDate =
    end || raw.timeframe?.end_date || new Date().toISOString().slice(0, 10);
  return {
    timeframe: { start_date: startDate, end_date: endDate },
    role_context_optional: raw.role_context_optional || null,
    contributions,
  };
}

function main(): void {
  const parsed = parseArgs();
  const input = parsed.input as string | undefined;
  const output = parsed.output as string | undefined;
  const start = parsed.start as string | undefined;
  const end = parsed.end as string | undefined;
  const inputPath = input || join(process.cwd(), "raw-github.json");
  const outputPath = output || join(process.cwd(), "evidence.json");

  let raw: RawGitHubInput;
  try {
    raw = JSON.parse(readFileSync(inputPath, "utf8")) as RawGitHubInput;
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      console.error("Input file not found:", inputPath);
      console.error(
        "Create raw-github.json with keys: pull_requests, reviews, releases, commits (see AGENTS.md)."
      );
      process.exit(1);
    }
    throw e;
  }

  const evidence = normalize(raw, start ?? null, end ?? null);
  writeFileSync(outputPath, JSON.stringify(evidence, null, 2), "utf8");
  console.log(
    "Wrote",
    evidence.contributions.length,
    "contributions to",
    outputPath
  );
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
