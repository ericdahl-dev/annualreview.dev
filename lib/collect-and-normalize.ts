import type { Evidence } from "../types/evidence.js";
import { collectRawGraphQL } from "../scripts/collect-github.ts";
import { normalize } from "../scripts/normalize.ts";
import { validateEvidence } from "./validate-evidence.js";

export interface CollectOptions {
  token: string;
  start_date: string;
  end_date: string;
}

/**
 * Fetch GitHub data for the authenticated user and return validated evidence JSON.
 * Token is used in-memory only; never stored or logged.
 */
export async function collectAndNormalize({ token, start_date, end_date }: CollectOptions): Promise<Evidence> {
  const raw = await collectRawGraphQL({
    start: start_date,
    end: end_date,
    noReviews: false,
    token,
  });

  const normalized = normalize(raw, start_date, end_date);
  const result = validateEvidence(normalized);
  if (!result.valid) {
    throw new Error(
      `Invalid evidence from normalize: ${result.errors.map((e) => e.message).join("; ")}`
    );
  }
  return normalized as Evidence;
}
