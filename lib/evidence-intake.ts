/**
 * Evidence intake — single seam for fetch → normalize → validate.
 * Web routes, periodic collection, and CLI adapters call this module.
 */

import type { Evidence } from "../types/evidence.js";
import { collectRawGraphQL } from "../scripts/collect-github.ts";
import { normalize, type RawGitHubInput } from "../scripts/normalize.ts";
import { validateEvidence } from "./validate-evidence.js";

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class EvidenceIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvidenceIntakeError";
  }
}

export interface Timeframe {
  start_date: string;
  end_date: string;
}

/** Validates YYYY-MM-DD dates and start <= end. */
export function parseTimeframe(start_date: unknown, end_date: unknown): Timeframe {
  if (
    typeof start_date !== "string" ||
    typeof end_date !== "string" ||
    !DATE_RE.test(start_date) ||
    !DATE_RE.test(end_date)
  ) {
    throw new EvidenceIntakeError("start_date and end_date must be YYYY-MM-DD");
  }
  if (start_date > end_date) {
    throw new EvidenceIntakeError("start_date must be on or before end_date");
  }
  return { start_date, end_date };
}

const TOKEN_REQUIRED =
  "GitHub token required (sign in with GitHub or pass token in body)";

/** Requires a non-empty GitHub token string. */
export function requireGitHubToken(token: unknown): string {
  if (typeof token !== "string" || !token.trim()) {
    throw new EvidenceIntakeError(TOKEN_REQUIRED);
  }
  return token;
}

/** Resolves token from body override, then session. */
export function resolveGitHubToken(opts: {
  body?: unknown;
  session?: unknown;
}): string {
  const bodyToken = typeof opts.body === "string" ? opts.body : undefined;
  const sessionToken = typeof opts.session === "string" ? opts.session : undefined;
  return requireGitHubToken(bodyToken ?? sessionToken);
}

function assertValidEvidence(data: unknown): Evidence {
  const result = validateEvidence(data);
  if (!result.valid) {
    throw new EvidenceIntakeError(
      `Invalid evidence: ${result.errors.map((e) => e.message).join("; ")}`
    );
  }
  return data as Evidence;
}

export interface IntakeFromRawOptions {
  start_date?: string | null;
  end_date?: string | null;
}

/** Normalize raw GitHub JSON and validate against the evidence schema. */
export function intakeFromRaw(
  raw: RawGitHubInput,
  opts: IntakeFromRawOptions = {}
): Evidence {
  const start = opts.start_date ?? null;
  const end = opts.end_date ?? null;
  if (start != null || end != null) {
    parseTimeframe(
      start ?? raw.timeframe?.start_date ?? "",
      end ?? raw.timeframe?.end_date ?? ""
    );
  }
  const normalized = normalize(raw, start, end);
  return assertValidEvidence(normalized);
}

export interface IntakeFromGitHubOptions {
  token: string;
  start_date: string;
  end_date: string;
  noReviews?: boolean;
  fetchFn?: typeof fetch;
}

export interface IntakeFromGitHubDeps {
  collectRawGraphQL?: typeof collectRawGraphQL;
}

/**
 * Fetch GitHub data for the authenticated user and return validated evidence.
 * Token is used in-memory only; never stored or logged.
 */
export async function intakeFromGitHub(
  opts: IntakeFromGitHubOptions,
  deps: IntakeFromGitHubDeps = {}
): Promise<Evidence> {
  const { start_date, end_date } = parseTimeframe(opts.start_date, opts.end_date);
  const token = requireGitHubToken(opts.token);
  const collect = deps.collectRawGraphQL ?? collectRawGraphQL;

  const raw = await collect({
    start: start_date,
    end: end_date,
    noReviews: opts.noReviews ?? false,
    token,
    fetchFn: opts.fetchFn,
  });

  return intakeFromRaw(raw, { start_date, end_date });
}
