import { PAYMENTS_NOT_CONFIGURED } from "../../../lib/api-error-codes.js";
import { parseJsonResponse, type pollJob } from "../../api.js";
import type {
  GenerateCommandResult,
  PaymentsConfig,
  PipelineResult,
  SaveSnapshotFn,
  SaveSnapshotResult,
  SimpleCommandResult,
  StorageAdapter,
} from "./types.js";
import {
  prepareEvidenceForGenerate,
  validateEvidenceJson,
  validateEvidenceTimeframe,
} from "./validation.js";
import type { SnapshotPeriod } from "../../hooks/useSnapshots.js";

interface PosthogLike {
  capture?: (event: string, props?: Record<string, unknown>) => void;
  get_distinct_id?: () => string | undefined;
}

export async function fetchPaymentsConfig(fetchFn: typeof fetch): Promise<PaymentsConfig> {
  try {
    const res = await fetchFn("/api/payments/config");
    const data = res.ok
      ? ((await parseJsonResponse(res)) as {
          enabled?: boolean;
          credits_per_purchase?: number;
          price_cents?: number;
          free_model?: string;
          premium_model?: string;
        })
      : { enabled: false };
    return {
      enabled: !!data.enabled,
      creditsPerPurchase: data.credits_per_purchase ?? 5,
      priceCents: data.price_cents ?? 100,
      freeModel: data.free_model ?? "",
      premiumModel: data.premium_model ?? "",
    };
  } catch {
    return {
      enabled: false,
      creditsPerPurchase: 5,
      priceCents: 100,
      freeModel: "",
      premiumModel: "",
    };
  }
}

export async function fetchPremiumCredits(fetchFn: typeof fetch): Promise<number> {
  try {
    const res = await fetchFn("/api/payments/credits", { credentials: "include" });
    const data = res.ok
      ? ((await parseJsonResponse(res)) as { credits?: number })
      : { credits: 0 };
    return data.credits ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchLatestJobEvidence(fetchFn: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchFn("/api/jobs", { credentials: "include" });
    const data = res.ok
      ? ((await parseJsonResponse(res)) as { latest?: { status?: string; result?: unknown } })
      : {};
    const job = data.latest;
    if (job?.status === "done" && job.result) {
      return JSON.stringify(job.result, null, 2);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function fetchSnapshotEvidence(
  fetchFn: typeof fetch,
  snapshotId: string
): Promise<string | null> {
  try {
    const res = await fetchFn(`/api/snapshots/${snapshotId}`, { credentials: "include" });
    const data = res.ok
      ? ((await parseJsonResponse(res)) as { evidence?: unknown })
      : null;
    if (data?.evidence) {
      return JSON.stringify(data.evidence, null, 2);
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function runGenerate(opts: {
  fetch: typeof fetch;
  parseJsonResponse: typeof parseJsonResponse;
  pollJob: typeof pollJob;
  evidenceText: string;
  goals: string;
  stripeSessionId?: string;
  onProgress?: (progress: string) => void;
  posthog?: PosthogLike;
  randomUUID?: () => string;
}): Promise<GenerateCommandResult> {
  const validation = validateEvidenceJson(opts.evidenceText);
  if (!validation.ok) return { ok: false, error: validation.error };

  const posthogDistinctId = opts.posthog?.get_distinct_id?.();
  const posthogTraceId =
    posthogDistinctId &&
    (opts.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const payload = prepareEvidenceForGenerate(validation.evidence, {
    goals: opts.goals,
    stripeSessionId: opts.stripeSessionId,
    posthogDistinctId: posthogDistinctId || undefined,
    posthogTraceId: posthogTraceId || undefined,
  });

  opts.posthog?.capture?.("review_generate_started", { premium: !!opts.stripeSessionId });

  try {
    const res = await opts.fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await opts.parseJsonResponse(res)) as {
      job_id?: string;
      premium?: boolean;
      error?: string;
      credits_remaining?: number;
      [key: string]: unknown;
    };

    if (res.status === 202 && data.job_id) {
      const out = (await opts.pollJob(data.job_id, opts.onProgress)) as PipelineResult;
      opts.posthog?.capture?.("review_generate_completed", { premium: !!data.premium });
      return {
        ok: true,
        result: out,
        isPremium: !!data.premium,
        creditsRemaining:
          typeof data.credits_remaining === "number" ? data.credits_remaining : undefined,
      };
    }

    if (!res.ok) {
      if ((data as { code?: string }).code === PAYMENTS_NOT_CONFIGURED) {
        return {
          ok: false,
          error:
            "Premium generation is not available in this environment. Please use the free tier.",
        };
      }
      return { ok: false, error: (data.error as string) || "Generate failed" };
    }

    opts.posthog?.capture?.("review_generate_completed");
    return { ok: true, result: data as PipelineResult, isPremium: false };
  } catch (e) {
    const err = e as Error;
    opts.posthog?.capture?.("review_generate_failed", { error: err.message });
    return {
      ok: false,
      error: err.message || "Pipeline failed. Is OPENROUTER_API_KEY set?",
    };
  }
}

export async function runPremiumCheckout(opts: {
  fetch: typeof fetch;
  parseJsonResponse: typeof parseJsonResponse;
  evidenceText: string;
  goals: string;
  session: StorageAdapter;
  redirect?: (url: string) => void;
  posthog?: PosthogLike;
}): Promise<SimpleCommandResult> {
  const validation = validateEvidenceJson(opts.evidenceText);
  if (!validation.ok) {
    return { ok: false, error: "Please load your evidence data first, then upgrade." };
  }

  try {
    opts.session.setItem("premium_evidence", opts.evidenceText);
    if (opts.goals.trim()) opts.session.setItem("premium_goals", opts.goals);
  } catch {
    /* sessionStorage not available */
  }

  try {
    const res = await opts.fetch("/api/payments/checkout", { method: "POST" });
    const data = (await opts.parseJsonResponse(res)) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      return { ok: false, error: data.error || "Could not start checkout" };
    }
    opts.posthog?.capture?.("premium_checkout_started");
    const redirect = opts.redirect ?? ((url: string) => {
      window.location.href = url;
    });
    redirect(data.url);
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: (e as Error).message || "Payment service unavailable. Try again later.",
    };
  }
}

export async function runSaveSnapshot(opts: {
  evidenceText: string;
  snapshotPeriod: SnapshotPeriod;
  snapshotLabel: string;
  saveSnapshot: SaveSnapshotFn;
}): Promise<SaveSnapshotResult> {
  const validation = validateEvidenceTimeframe(opts.evidenceText);
  if (!validation.ok) return { ok: false, error: validation.error };

  const tf = validation.evidence.timeframe as { start_date: string; end_date: string };
  const id = await opts.saveSnapshot({
    period: opts.snapshotPeriod,
    start_date: tf.start_date,
    end_date: tf.end_date,
    evidence: validation.evidence as object,
    label: opts.snapshotLabel.trim() || undefined,
  });

  if (!id) {
    return { ok: false, error: "Failed to save snapshot" };
  }

  return { ok: true, id };
}

export function getPremiumStripeSessionId(local: StorageAdapter): string | null {
  try {
    return local.getItem("premium_stripe_session_id");
  } catch {
    return null;
  }
}
