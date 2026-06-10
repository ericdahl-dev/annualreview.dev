export type EvidenceValidationResult =
  | { ok: true; evidence: Record<string, unknown> }
  | { ok: false; error: string };

export function validateEvidenceJson(text: string): EvidenceValidationResult {
  let evidence: Record<string, unknown>;
  try {
    evidence = JSON.parse(text) as Record<string, unknown>;
  } catch {
    const looksTruncated =
      /[\{\[,]\s*$/.test(text.trim()) || !text.includes('"contributions"');
    return {
      ok: false,
      error: looksTruncated
        ? 'Invalid JSON—looks truncated (e.g. missing contributions or closing brackets). Try "Upload evidence.json" instead of pasting, or paste the full file again.'
        : "Invalid JSON. Paste or upload a valid evidence.json.",
    };
  }

  const tf = evidence.timeframe as { start_date?: string; end_date?: string } | undefined;
  if (!tf?.start_date || !tf?.end_date || !Array.isArray(evidence.contributions)) {
    return {
      ok: false,
      error:
        "Evidence must have timeframe.start_date, timeframe.end_date, and contributions array.",
    };
  }

  return { ok: true, evidence };
}

export function validateEvidenceTimeframe(text: string): EvidenceValidationResult {
  let evidence: Record<string, unknown>;
  try {
    evidence = JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { ok: false, error: "Invalid JSON — load or paste evidence first." };
  }

  const tf = evidence.timeframe as { start_date?: string; end_date?: string } | undefined;
  if (!tf?.start_date || !tf?.end_date) {
    return {
      ok: false,
      error: "Evidence must have timeframe.start_date and timeframe.end_date.",
    };
  }

  return { ok: true, evidence };
}

export function prepareEvidenceForGenerate(
  evidence: Record<string, unknown>,
  opts: {
    goals?: string;
    stripeSessionId?: string;
    posthogDistinctId?: string;
    posthogTraceId?: string;
  } = {}
): Record<string, unknown> {
  let out = { ...evidence };

  if (opts.goals?.trim() && !(out as { goals?: string }).goals) {
    out = { ...out, goals: opts.goals.trim() };
  }
  if (opts.stripeSessionId) {
    out = { ...out, _stripe_session_id: opts.stripeSessionId };
  }
  if (opts.posthogDistinctId) {
    out = {
      ...out,
      posthog_distinct_id: opts.posthogDistinctId,
      posthog_trace_id: opts.posthogTraceId,
    };
  }

  return out;
}
