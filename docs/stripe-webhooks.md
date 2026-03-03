## Stripe webhooks

1. **Add endpoint**  
   Stripe Dashboard → [Webhooks](https://dashboard.stripe.com/webhooks) → **Add endpoint** (or edit an existing one).

2. **Endpoint URL**  
   - **Production:** `https://annualreview.dev/api/payments/webhook`  
   - **Local:** Use [Stripe CLI](https://docs.stripe.com/stripe-cli) to forward events, e.g. `stripe listen --forward-to localhost:3000/api/payments/webhook`, and use the CLI’s printed signing secret for local env.

3. **Events**  
   Subscribe to **`checkout.session.completed`** (required for awarding credits). You can subscribe to other events too; the server returns `200` and ignores them (see `server/routes/payments.ts`).

4. **Signing secret**  
   After creating the endpoint: **Reveal** and copy the **Signing secret** (`whsec_...`). Set as env var **`STRIPE_WEBHOOK_SECRET`**. Never commit this value.

5. **How the server verifies**  
   The handler in `server/routes/payments.ts` reads the raw request body (no JSON parsing before verification), uses the **`stripe-signature`** header, and calls `stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)`. Invalid or missing signature returns `400`; only `checkout.session.completed` is processed; other event types get `200` with `{ received: true }`.
