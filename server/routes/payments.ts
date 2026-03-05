/**
 * Payments API:
 *   GET  /config   – returns { enabled: boolean } so the frontend knows whether payments are configured
 *   POST /checkout  – create Stripe Checkout session for premium report ($1)
 *   POST /webhook   – handle Stripe webhook events (mark sessions as paid)
 *
 * Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET (webhook only).
 * Optional: STRIPE_PRICE_CENTS (default 100 = $1.00), STRIPE_CURRENCY (default "usd").
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SessionData } from "../../lib/session-store.js";
import Stripe from "stripe";
import { awardCredits, getCredits, getCreditsPerPurchase } from "../../lib/payment-store.js";
import { getDefaultModels } from "../../lib/run-pipeline.js";
import { STRIPE_API_VERSION } from "../config.js";

export interface PaymentsRoutesOptions {
  respondJson: (res: ServerResponse, status: number, data: object) => void;
  getStripe?: () => Stripe | null;
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => SessionData | undefined;
  /** Optional for tests; when not provided uses real payment store (requires DATABASE_URL). */
  awardCredits?: (userLogin: string, sessionId: string) => Promise<void>;
  getCredits?: (userLogin: string) => Promise<number>;
}

type Next = () => void;

/** Read raw request body as a Buffer. */
function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function getStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION });
}

export function paymentsRoutes(options: PaymentsRoutesOptions) {
  const {
    respondJson,
    getStripe = getStripeClient,
    getSessionIdFromRequest,
    getSession,
    awardCredits: awardCreditsFn = awardCredits,
    getCredits: getCreditsFn = getCredits,
  } = options;

  return async function paymentsMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    const path = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";

    if (path === "config" && req.method === "GET") {
      const enabled = getStripe() !== null;
      const { free: freeModel, premium: premiumModel } = getDefaultModels();
      respondJson(res, 200, {
        enabled,
        price_cents: Number(process.env.STRIPE_PRICE_CENTS) || 100,
        credits_per_purchase: getCreditsPerPurchase(),
        free_model: freeModel,
        premium_model: premiumModel,
      });
      return;
    }

    // GET /credits or GET /credits/:anything – returns remaining credits for the logged-in user
    if ((path === "credits" || path.startsWith("credits/")) && req.method === "GET") {
      const sessId = getSessionIdFromRequest(req);
      const userSession = sessId ? getSession(sessId) : undefined;
      if (!userSession?.login) {
        respondJson(res, 401, { error: "Login required" });
        return;
      }
      respondJson(res, 200, { credits: await getCreditsFn(userSession.login) });
      return;
    }
    if (path === "checkout" && req.method === "POST") {
      const stripe = getStripe();
      if (!stripe) {
        respondJson(res, 503, { error: "Payments not configured (STRIPE_SECRET_KEY missing)" });
        return;
      }
      // Require the user to be logged in before purchasing credits
      const sessId = getSessionIdFromRequest(req);
      const userSession = sessId ? getSession(sessId) : undefined;
      if (!userSession?.login) {
        respondJson(res, 401, { error: "Login required to purchase premium credits" });
        return;
      }
      const userLogin = userSession.login;
      try {
        const rawBody = await readRawBody(req);
        const body = JSON.parse(rawBody.toString() || "{}") as {
          success_url?: string;
          cancel_url?: string;
        };
        const host = req.headers.host || "localhost:3000";
        const proto = (req.headers["x-forwarded-proto"] as string) || "http";
        const origin = `${proto}://${host}`;
        const successUrl = body.success_url || `${origin}/generate?session_id={CHECKOUT_SESSION_ID}&premium=1`;
        const cancelUrl = body.cancel_url || `${origin}/generate`;

        const priceCents = Number(process.env.STRIPE_PRICE_CENTS) || 100;
        const currency = process.env.STRIPE_CURRENCY || "usd";

        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          metadata: { user_login: userLogin },
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency,
                unit_amount: priceCents,
                product_data: {
                  name: "Premium Annual Review Report",
                  description: `${getCreditsPerPurchase()} higher-quality AI report runs using a state-of-the-art model`,
                },
              },
            },
          ],
          success_url: successUrl,
          cancel_url: cancelUrl,
        });

        respondJson(res, 200, { url: session.url, session_id: session.id });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to create checkout session" });
      }
      return;
    }

    if (path === "webhook" && req.method === "POST") {
      console.log("[payments] webhook received");
      const stripe = getStripe();
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      if (!stripe || !webhookSecret) {
        respondJson(res, 503, { error: "Webhook not configured" });
        return;
      }
      try {
        const rawBody = await readRawBody(req);
        const sig = req.headers["stripe-signature"] as string | undefined;
        if (!sig) {
          respondJson(res, 400, { error: "Missing stripe-signature header" });
          return;
        }
        const event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
        console.log("[payments] webhook event:", event.type);
        if (event.type === "checkout.session.completed") {
          const session = event.data.object as Stripe.Checkout.Session;
          // Award credits to the GitHub user who initiated the checkout.
          // user_login is stored in metadata when creating the checkout session.
          // payment_status is checked for defense-in-depth (async payment methods
          // may complete the session before the payment is confirmed).
          const userLogin = session.metadata?.user_login;
          if (session.payment_status === "paid" && userLogin) {
            await awardCreditsFn(userLogin, session.id);
            console.log("[payments] credits awarded");
          } else {
            console.log("[payments] checkout.session.completed skipped: payment_status =", session.payment_status);
          }
        } else if (event.type === "checkout.session.expired") {
          const session = event.data.object as Stripe.Checkout.Session;
          console.log("[payments] checkout.session.expired: session_id =", session.id, "user_login =", session.metadata?.user_login);
        }
        respondJson(res, 200, { received: true });
      } catch (e) {
        const err = e as Error;
        console.error("[payments] webhook error:", err.message);
        respondJson(res, 400, { error: err.message || "Webhook error" });
      }
      return;
    }

    next();
  };
}
