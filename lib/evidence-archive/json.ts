import type { Evidence } from "../../types/evidence.js";

export function tryParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

export function contributionCount(evidence: Evidence): number {
  return Array.isArray(evidence.contributions) ? evidence.contributions.length : 0;
}
