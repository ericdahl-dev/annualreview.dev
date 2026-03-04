/**
 * Generate API: POST / - validate evidence, create job, run pipeline in background.
 *
 * Premium generation ($1 for 5 credits, stored in Postgres via DATABASE_URL):
 *   - The user must be logged in (GitHub OAuth) to use premium.
 *   - On the post-Stripe-redirect call, the client passes _stripe_session_id so
 *     the server can verify payment and award credits if the webhook hasn't fired yet.
 *   - Subsequent premium calls just send { _premium: true } — no Stripe call needed.
 *   - Each premium generation deducts one credit from the user's account.
 *
 * Returns Connect-style middleware (req, res, next).
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { ValidationResult } from "../../lib/validate-evidence.js";
import type { Evidence } from "../../types/evidence.js";
import type { PipelineResult } from "../../lib/run-pipeline.js";
import type { SessionData } from "../../lib/session-store.js";
import { awardCredits, deductCredit, getCredits } from "../../lib/payment-store.js";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "../config.js";

export interface GenerateRoutesOptions {
  readJsonBody: (req: IncomingMessage) => Promise<object>;
  respondJson: (res: ServerResponse, status: number, data: object) => void;
  validateEvidence: (evidence: unknown) => ValidationResult;
  createJob: (type: string) => string;
  runInBackground: (
    jobId: string,
    fn: (report: (data: { progress?: string }) => void) => void | Promise<void>
  ) => void;
  runPipeline: (
    evidence: Evidence,
    opts: { onProgress: (data: { stepIndex: number; total: number; label: string }) => void; premium?: boolean }
  ) => Promise<PipelineResult>;
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => SessionData | undefined;
  /** Optional injected Stripe client (for tests). */
  getStripe?: () => Stripe | null;
}

type Next = () => void;

function defaultGetStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key, { apiVersion: STRIPE_API_VERSION }) : null;
}

/**
 * Verify a Stripe Checkout session is paid and belongs to the expected user.
 * Awards credits to the user if not already credited (idempotent via DB).
 */
async function verifyAndAwardFromStripe(
  stripeSessionId: string,
  expectedUserLogin: string,
  getStripe: () => Stripe | null
): Promise<boolean> {
  const stripe = getStripe();
  if (!stripe) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(stripeSessionId);
    if (
      session.payment_status === "paid" &&
      session.metadata?.user_login === expectedUserLogin
    ) {
      await awardCredits(expectedUserLogin, stripeSessionId);
      return true;
    }
  } catch {
    // session not found or API error → not paid
  }
  return false;
}

export function generateRoutes(options: GenerateRoutesOptions) {
  const {
    readJsonBody,
    respondJson,
    validateEvidence,
    createJob,
    runInBackground,
    runPipeline,
    getSessionIdFromRequest,
    getSession,
    getStripe = defaultGetStripe,
  } = options;

  return async function generateMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    if (req.method !== "POST") {
      next();
      return;
    }
    try {
      const body = await readJsonBody(req);

      // Strip internal payment fields before evidence validation
      const {
        _stripe_session_id: rawSessionId,
        _premium: rawPremium,
        ...evidence
      } = body as Record<string, unknown>;
      const stripeSessionId = typeof rawSessionId === "string" ? rawSessionId : undefined;
      const wantsPremium = !!rawPremium || !!stripeSessionId;

      const validation = validateEvidence(evidence);
      if (!validation.valid) {
        const msg =
          validation.errors?.length
            ? validation.errors
                .map((e) => `${e.instancePath ?? "evidence"} ${e.message}`)
                .join("; ")
            : "Evidence must have timeframe (start_date, end_date) and contributions array.";
        respondJson(res, 400, { error: "Invalid evidence", details: msg });
        return;
      }

      // --- Premium credit check ---
      let premium = false;
      let creditsRemaining: number | undefined;

      if (wantsPremium) {
        // Must be logged in — credits are tied to a GitHub account
        const sessId = getSessionIdFromRequest(req);
        const userSession = sessId ? getSession(sessId) : undefined;
        if (!userSession?.login) {
          respondJson(res, 401, { error: "Login required for premium generation" });
          return;
        }
        const userLogin = userSession.login;

        // Fast path: user already has credits in the DB
        let debited = await deductCredit(userLogin);

        if (!debited && stripeSessionId) {
          // Slow path: webhook may not have fired yet — verify directly with Stripe
          const awarded = await verifyAndAwardFromStripe(stripeSessionId, userLogin, getStripe);
          if (!awarded) {
            respondJson(res, 402, { error: "Payment required or session not found" });
            return;
          }
          debited = await deductCredit(userLogin);
        }

        if (!debited) {
          respondJson(res, 402, { error: "No premium credits remaining" });
          return;
        }
        premium = true;
        creditsRemaining = await getCredits(userLogin);
      }

      const jobId = createJob(premium ? "generate-premium" : "generate");
      runInBackground(jobId, async (report) => {
        return await runPipeline(evidence as unknown as Evidence, {
          premium,
          onProgress: ({ stepIndex, total, label }) =>
            report({ progress: `${stepIndex}/${total} ${label}` }),
        });
      });
      respondJson(res, 202, {
        job_id: jobId,
        premium,
        ...(creditsRemaining !== undefined ? { credits_remaining: creditsRemaining } : {}),
      });
    } catch (e) {
      const err = e as Error;
      respondJson(res, 500, { error: err.message || "Pipeline failed" });
    }
  };
}
