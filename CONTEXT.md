# AnnualReview — domain context

Short glossary for payments and premium generation. Implementation details live in code; this file names concepts and product boundaries.

## Premium credits

Credits stored per GitHub login (Postgres). One premium generation consumes one credit. Credits are **awarded** after a successful Stripe Checkout payment, keyed by Stripe Checkout Session id for **idempotency** (same session cannot award twice).

## Stripe Checkout session

A Stripe Checkout Session starts when an authenticated user hits `/api/payments/checkout`. Session **metadata** carries `user_login` so webhooks can tie payment to the right GitHub account.

## Webhook award path

The server trusts **`checkout.session.completed`** only when:

- Signature verification succeeds (`STRIPE_WEBHOOK_SECRET`).
- `payment_status === "paid"`.
- `metadata.user_login` is present.

Credits are written via `awardCredits` (idempotent by `stripe_session_id` in `credit_events`). **`checkout.session.expired`** is logged only; no credits.

## Instant settlement (operations policy)

**Production:** Configure Stripe so customers pay with **instant-settlement** methods (cards, wallets, and other methods that reach `paid` on `checkout.session.completed` under your Dashboard settings).

**Out of scope today:** The app does **not** listen for `checkout.session.async_payment_succeeded`. Delayed-settlement methods can complete Checkout without ever satisfying the webhook award path above; supporting them would require explicit design (see beads backlog).

## Related docs

- [docs/STRIPE_KEYS.md](docs/STRIPE_KEYS.md) — keys, webhook events checklist, go-live.
- [docs/stripe-webhooks.md](docs/stripe-webhooks.md) — CLI and verification mechanics.
