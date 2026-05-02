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
- **Endpoint URL (production):** `https://annualreview.dev/api/payments/webhook`
- Register every event type listed under **[Webhook events to register](#webhook-events-to-register)** (below) on your Stripe webhook endpoint.
- Value starts with `whsec_`. Set it in env/secrets (e.g. Coolify) for production; do not commit.
- **Detailed steps (including local testing):** [stripe-webhooks.md](stripe-webhooks.md).

## Webhook events to register

**Canonical list** for the Stripe Dashboard — other docs (e.g. [stripe-webhooks.md](stripe-webhooks.md)) link here instead of duplicating.

| Event | App behavior |
|-------|----------------|
| `checkout.session.completed` | **Required.** Verifies signature, then awards premium credits when `payment_status` is `paid` and session `metadata.user_login` matches the GitHub login stored at checkout. |
| `checkout.session.expired` | **Recommended.** Logged server-side; returns `200` with no credit mutation. |

**Settlement policy:** Production should use **instant-settlement** payment methods only (see [CONTEXT.md](../CONTEXT.md)). This app does **not** handle `checkout.session.async_payment_succeeded`; delayed-settlement methods can leave buyers without credits until that is implemented.

## Optional

- `STRIPE_PRICE_CENTS` – default `100` ($1.00).
- `STRIPE_CURRENCY` – default `usd`.
- `CREDITS_PER_PURCHASE` – credits per successful payment (default 5; see `server.ts`).

## Quick links (from Stripe MCP – your account)

- API keys: <https://dashboard.stripe.com/acct_1SNmB9IoMF0fqmmJ/apikeys>
- Webhooks: <https://dashboard.stripe.com/webhooks>

Payments are enabled when `STRIPE_SECRET_KEY` is set.

## Stripe best practices (this app)

- **Checkout Sessions only** – One-time payments use [Checkout Sessions](https://docs.stripe.com/api/checkout/sessions); no Charges API or legacy Tokens/Sources.
- **Dynamic payment methods** – The checkout session is created without `payment_method_types`, so Stripe Dashboard controls which methods are offered (cards, wallets, regional methods). See [dynamic payment methods](https://docs.stripe.com/payments/payment-methods/integration-options).
- **Stripe-hosted Checkout** – Client redirects to `session.url`; no raw card data on your server.
- **Webhook verification** – `constructEvent(rawBody, signature, webhookSecret)` validates every webhook.
- **API version** – Server uses Stripe Node SDK 20.x with API version `2026-02-25.clover` set explicitly in code (see [SDK versioning](https://docs.stripe.com/sdks/set-version)).
- **Before go-live** – See **Go-live checklist** below.

## Go-live checklist

1. **Switch to live keys** – Set `STRIPE_SECRET_KEY` to your live key (`sk_live_...`) and `STRIPE_WEBHOOK_SECRET` to the signing secret for your **live** webhook endpoint. Do not use test keys in production.
2. **Webhook endpoint** – In [Stripe Dashboard → Webhooks](https://dashboard.stripe.com/webhooks), ensure the endpoint URL is your production URL (e.g. `https://annualreview.dev/api/payments/webhook`). Create a separate endpoint for live if you were using test before.
3. **Webhook signing secret** – Confirm `STRIPE_WEBHOOK_SECRET` is the one from the **live** endpoint (value starts with `whsec_`). Test and live endpoints have different secrets.
4. **Dynamic payment methods** – In Dashboard, consider enabling [dynamic payment methods](https://docs.stripe.com/payments/payment-methods/integration-options) so Stripe can offer the best options per user.
5. **App-specific** – This app uses **Checkout Sessions only** (no Charges API, Sources, or Card Element). Webhooks are verified with `stripe.webhooks.constructEvent`; no raw card data is handled. Confirm `STRIPE_PRICE_CENTS`, `STRIPE_CURRENCY`, and `CREDITS_PER_PURCHASE` are set as intended for production.

## Upgrading Stripe SDK

Follow these steps when bumping the `stripe` npm package to a new major version:

1. **Update `stripe` in `package.json`** – Run `yarn add stripe@<new-version>` and check the [Stripe Node.js SDK changelog](https://github.com/stripe/stripe-node/blob/master/CHANGELOG.md) for breaking changes.
2. **Update `STRIPE_API_VERSION`** – In `server/config.ts`, update the `STRIPE_API_VERSION` constant to the API version string required by the new SDK (e.g. `"2026-02-25.clover"`). The SDK changelog and TypeScript types will indicate the required value.
3. **Run tests** – Execute `yarn test` and resolve any failures caused by the upgrade.
4. **Optional: test Checkout and webhook end-to-end** – Start the server locally with test keys (`STRIPE_SECRET_KEY=sk_test_...`), use the [Stripe CLI](https://stripe.com/docs/stripe-cli) (`stripe listen --forward-to localhost:3000/api/payments/webhook`) to forward webhook events, and perform a test purchase to confirm credits are awarded correctly.
