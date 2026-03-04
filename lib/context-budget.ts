/**
 * Keep pipeline payloads under the model context limit (e.g. 128k) by slimming
 * contributions when the serialized input would exceed maxTokens.
 */

import type { Evidence, Contribution } from "../types/evidence.js";

/** Rough token estimate: ~4 chars per token for JSON/English. */
export function estimateTokens(str: unknown): number {
  if (typeof str !== "string") return 0;
  return Math.ceil(str.length / 4);
}

/** Fields we always keep; arrays are capped separately. */
const SLIM_KEYS: (keyof Contribution)[] = [
  "id",
  "type",
  "title",
  "url",
  "repo",
  "merged_at",
  "labels",
  "files_changed",
  "additions",
  "deletions",
  "linked_issues",
  "review_comments_count",
  "approvals_count",
];

/** Smallest set needed for clustering + citations. */
const MINIMAL_KEYS: (keyof Contribution)[] = ["id", "type", "title", "url", "repo", "merged_at"];

const MAX_LABELS = 8;
const MAX_LINKED_ISSUES = 5;

function capArray<T>(arr: T[] | undefined, max: number): T[] | undefined {
  if (!Array.isArray(arr) || arr.length <= max) return arr;
  return arr.slice(0, max);
}

export interface SlimOptions {
  bodyChars?: number;
  summaryChars?: number;
  minimal?: boolean;
}

export function slimContributions(
  contributions: Contribution[],
  opts: SlimOptions = {}
): Record<string, unknown>[] {
  const { bodyChars = 400, summaryChars = 500, minimal = false } = opts;
  const keys = minimal ? MINIMAL_KEYS : SLIM_KEYS;
  return contributions.map((contribution) => {
    const slimmed: Record<string, unknown> = {};
    for (const fieldKey of keys) {
      if (contribution[fieldKey] === undefined) continue;
      if (fieldKey === "labels") slimmed[fieldKey] = capArray(contribution[fieldKey] as string[], MAX_LABELS);
      else if (fieldKey === "linked_issues") slimmed[fieldKey] = capArray(contribution[fieldKey] as string[], MAX_LINKED_ISSUES);
      else slimmed[fieldKey] = contribution[fieldKey];
    }
    const sumLen = minimal ? 200 : summaryChars;
    if (contribution.summary != null) {
      slimmed.summary =
        typeof contribution.summary === "string" && contribution.summary.length > sumLen
          ? contribution.summary.slice(0, sumLen) + "..."
          : contribution.summary;
    }
    if (!minimal && contribution.body != null && typeof contribution.body === "string" && bodyChars > 0) {
      slimmed.body_preview =
        contribution.body.length > bodyChars ? contribution.body.slice(0, bodyChars) + "..." : contribution.body;
    }
    return slimmed;
  });
}

/** Default max user-message tokens (leaves room for system + response under 128k). */
export const DEFAULT_MAX_USER_TOKENS = 100_000;

/** Max iterations for body/summary shrink loop to avoid pathological serialization. */
const MAX_SHRINK_ITERATIONS = 20;

/**
 * Returns evidence with contributions slimmer so that getPayload(evidence) fits in maxTokens.
 * Tries reducing body/summary length (bounded iterations, larger steps), then minimal view,
 * then binary search on contribution count by recency.
 */
export function fitEvidenceToBudget(
  evidence: Evidence,
  getPayload: (ev: Evidence) => string,
  maxTokens = DEFAULT_MAX_USER_TOKENS
): Evidence {
  let contributions: Contribution[] = evidence.contributions;
  let bodyChars = 600;
  let summaryChars = 500;

  let payload = getPayload({ ...evidence, contributions });
  let iterations = 0;
  while (
    estimateTokens(payload) > maxTokens &&
    (bodyChars > 0 || summaryChars > 0) &&
    iterations < MAX_SHRINK_ITERATIONS
  ) {
    iterations++;
    bodyChars = Math.max(0, bodyChars - 200);
    summaryChars = Math.max(0, summaryChars - 150);
    contributions = slimContributions(evidence.contributions, { bodyChars, summaryChars }) as unknown as Contribution[];
    payload = getPayload({ ...evidence, contributions });
  }

  if (estimateTokens(payload) <= maxTokens) {
    return { ...evidence, contributions };
  }

  // Aggressive: minimal view (id, type, title, url, repo, merged_at, short summary only)
  contributions = slimContributions(evidence.contributions, { minimal: true }) as unknown as Contribution[];
  payload = getPayload({ ...evidence, contributions });
  if (estimateTokens(payload) <= maxTokens) {
    return { ...evidence, contributions };
  }

  // Last resort: binary search on contribution count by recency
  const original = evidence.contributions;
  const byDate = [...original].sort((a, b) =>
    (b.merged_at || "").localeCompare(a.merged_at || "")
  );
  let low = 1;
  let high = byDate.length;
  let best: Contribution[] = [];
  while (low <= high) {
    const mid = (low + high) >> 1;
    const candidate = slimContributions(byDate.slice(0, mid), { minimal: true }) as unknown as Contribution[];
    const candidatePayload = getPayload({ ...evidence, contributions: candidate });
    if (estimateTokens(candidatePayload) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  if (best.length > 0) {
    return { ...evidence, contributions: best };
  }

  return { ...evidence, contributions };
}
