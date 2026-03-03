# Stripe keys for AnnualReview

The app uses Stripe for premium report purchases. You need two keys from your Stripe account.

## 1. Secret key (required)

- **Env var:** `STRIPE_SECRET_KEY`
- **Where:** [API keys in Dashboard](https://dashboard.stripe.com/acct_1SNmB9IoMF0fqmmJ/apikeys)
- Use **Secret key** (starts with `sk_test_` for test, `sk_live_` for production).  
  Click “Reveal test key” or “Reveal live key” and copy the value.  
  Never commit this; set it in your environment or secrets (e.g. Coolify).

## 2. Webhook signing secret (required for webhooks)

- **Env var:** `STRIPE_WEBHOOK_SECRET`
- **Where:** [Webhooks](https://dashboard.stripe.com/webhooks) → Add endpoint (or open existing) → “Reveal” signing secret.
- **Endpoint URL:** `https://<your-domain>/api/payments/webhook`  
  The server uses this to verify `checkout.session.completed` and award credits.
  Register **`checkout.session.completed`** in your Stripe webhook endpoint configuration.
- Value starts with `whsec_`. Set it in env/secrets; do not commit.

## Optional

- `STRIPE_PRICE_CENTS` – default `100` ($1.00).
- `STRIPE_CURRENCY` – default `usd`.
- `CREDITS_PER_PURCHASE` – credits per successful payment (see `server.ts`).

## Quick links (from Stripe MCP – your account)

- API keys: <https://dashboard.stripe.com/acct_1SNmB9IoMF0fqmmJ/apikeys>
- Webhooks: <https://dashboard.stripe.com/webhooks>

Payments are only enabled when `STRIPE_SECRET_KEY` is set and the PostHog feature flag `enable-stripe-payments` is on for the user.

## Stripe best practices (this app)

- **Checkout Sessions only** – One-time payments use [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions); no Charges API or legacy Tokens/Sources.
- **Card payments only** – The checkout session is created with `payment_method_types: ['card']`, so only synchronous card payments are accepted. Async methods (bank transfer, ACH, SEPA debit) are intentionally excluded.
- **Stripe-hosted Checkout** – Client redirects to `session.url`; no raw card data on your server.
- **Webhook verification** – `constructEvent(rawBody, signature, webhookSecret)` validates every webhook.
- **API version** – Server uses Stripe Node SDK 20.x with API version `2026-02-25.clover` set explicitly in code (see [SDK versioning](https://docs.stripe.com/sdks/set-version)).
- **Before go-live** – Use [Stripe’s Go Live Checklist](https://docs.stripe.com/get-started/checklist/go-live.md). In Dashboard, consider enabling [dynamic payment methods](https://docs.stripe.com/payments/payment-methods/integration-options) so Stripe can offer the best options per user.
