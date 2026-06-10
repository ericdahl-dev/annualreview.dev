import type { Evidence, Contribution } from "../../types/evidence.js";

export interface EvidenceHistoryRow {
  evidence: Evidence;
  start_date: string;
  end_date: string;
}

export const SNAPSHOT_ID_PATTERN = /^snap_[a-z0-9_]+$/;

export function filterSafeIds(ids: unknown[], pattern: RegExp): string[] {
  return ids.filter((id): id is string => typeof id === "string" && pattern.test(id));
}

/**
 * Merge dated evidence history rows into one combined evidence object.
 * Deduplicates contributions by id, spans earliest→latest dates, and preserves
 * role_context_optional from the first row.
 */
export function mergeEvidenceHistory(rows: EvidenceHistoryRow[]): Evidence | null {
  if (rows.length === 0) return null;

  const seen = new Set<string>();
  const merged: Contribution[] = [];
  let earliest = rows[0].start_date;
  let latest = rows[0].end_date;
  let roleContext: unknown = undefined;

  for (const row of rows) {
    const ev = row.evidence;
    if (roleContext === undefined) roleContext = ev.role_context_optional;
    if (row.start_date < earliest) earliest = row.start_date;
    if (row.end_date > latest) latest = row.end_date;
    for (const c of ev.contributions ?? []) {
      if (!seen.has(c.id)) {
        seen.add(c.id);
        merged.push(c);
      }
    }
  }

  const combined: Evidence = {
    timeframe: { start_date: earliest, end_date: latest },
    contributions: merged,
  };
  if (roleContext !== undefined) {
    combined.role_context_optional = roleContext;
  }
  return combined;
}
