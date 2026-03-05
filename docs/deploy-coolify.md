# Deploying to Coolify (Nixpacks)

The repo includes `nixpacks.toml` so Nixpacks runs `yarn build` and then `yarn start` (the Node server). That way the API routes exist in production; without it, Nixpacks might only serve static files and Connect would 404.

1. **Build & start** (handled by Nixpacks via `nixpacks.toml`)
   - Build: `yarn build`
   - Start: `yarn start` (Node server serves `dist/` + `/api/*`)
   - Server listens on `PORT` (Coolify sets this automatically).

2. **Environment variables** (set in Coolify → your service → Environment)
   - `SESSION_SECRET` — **required in production**; random string for signing session cookies (e.g. `openssl rand -hex 32`)
   - `GITHUB_CLIENT_ID` — from [GitHub OAuth App](https://github.com/settings/developers)
   - `GITHUB_CLIENT_SECRET` — from the same OAuth App
   - `OPENROUTER_API_KEY` — **required** for the generate pipeline. Uses OpenRouter with Claude (free: Haiku, premium: Sonnet).
   - `LLM_MODEL`, `PREMIUM_LLM_MODEL` — (optional) override free/premium models.
   - `MAX_USER_TOKENS_FREE`, `MAX_USER_TOKENS_PREMIUM` — (optional) context caps per tier; defaults 500k free, 184k premium.
   - `POSTHOG_API_KEY` — (optional) same project token as frontend; enables LLM analytics (Traces/Generations) and Node OTLP logs in PostHog. If missing, pipeline runs but no LLM events or logs are sent.
   - `POSTHOG_HOST` — (optional) default `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for EU.

3. **GitHub OAuth App**
   - Create an OAuth App (or use existing). Set **Authorization callback URL** to:
     `https://<your-coolify-domain>/api/auth/callback/github`
   - No trailing slash; must match the public URL Coolify gives the app.

4. **Proxy**
   - Coolify’s reverse proxy should send `X-Forwarded-Proto: https` and `Host` so the server can build the correct callback URL and set `Secure` cookies.

## Stripe env vars & deployment

- **Required:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (for the webhook handler; see `server/routes/payments.ts`).
- **Optional:** `STRIPE_PRICE_CENTS` (default `100`), `STRIPE_CURRENCY` (default `usd`), `CREDITS_PER_PURCHASE` (default `5`) — see `server.ts` and `server/routes/payments.ts`.
- **Where to set:** Local: `.env` (do not commit). Production: Coolify (or similar) → Environment / secrets.
- **When payments are active:** When `STRIPE_SECRET_KEY` is set (see `server/routes/payments.ts`, `docs/STRIPE_KEYS.md`).
- **Verify:** `GET /api/payments/config` returns `enabled: true` when Stripe is configured.
