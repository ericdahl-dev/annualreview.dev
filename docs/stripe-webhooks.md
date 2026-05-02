## Stripe webhooks

This page is **procedural**: endpoint URL, CLI forwarding, and signing secret. The **canonical list of event types** to subscribe to in the Dashboard is in [STRIPE_KEYS.md — Webhook events to register](STRIPE_KEYS.md#webhook-events-to-register).

1. **Add endpoint**  
   Stripe Dashboard → [Webhooks](https://dashboard.stripe.com/webhooks) → **Add endpoint** (or edit an existing one).

2. **Endpoint URL**  
   - **Production:** `https://annualreview.dev/api/payments/webhook`  
   - **Local:** Use [Stripe CLI](https://docs.stripe.com/stripe-cli) to forward events, e.g. `stripe listen --forward-to localhost:3000/api/payments/webhook`, and use the CLI’s printed signing secret for local env.

3. **Events**  
   In the Dashboard, subscribe to the event types listed in [STRIPE_KEYS.md](STRIPE_KEYS.md#webhook-events-to-register). Do not rely on a duplicate list in this file.

4. **Signing secret**  
   After creating the endpoint: **Reveal** and copy the **Signing secret** (`whsec_...`). Set as env var **`STRIPE_WEBHOOK_SECRET`**. Never commit this value.

5. **How the server verifies**  
   The handler in `server/routes/payments.ts` reads the raw request body (no JSON parsing before verification), uses the **`stripe-signature`** header, and calls `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`. Invalid or missing signature returns `400`. Valid events return `200` with `{ received: true }`. For `checkout.session.completed`, credits are awarded only when `payment_status` is `paid`. For `checkout.session.expired`, the server logs and returns `200`. Other subscribed event types also return `200` without side effects.
