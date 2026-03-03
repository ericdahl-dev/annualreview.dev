# AnnualReview.dev

Turn your GitHub activity into an evidence-backed annual review in minutes. **https://annualreview.dev**

Sign in with GitHub (or use a token), pick your date range, and get themes, impact bullets, STAR stories, and self-eval sections — every claim linked to a real PR.

## Screenshots

![Landing page – hero section](https://github.com/user-attachments/assets/20d9610f-3df2-4716-a2e5-849e3ba7608b)

![Generate page – connect GitHub and paste evidence](https://github.com/user-attachments/assets/c577ae0b-0e5e-4fa9-955e-e47ce21a12a8)

## What you get

| Output | Description |
|--------|-------------|
| **Theme clusters** | Your scattered PRs distilled into 4–6 strategic themes a manager actually remembers. |
| **Impact bullets** | XYZ-format bullets with scope, outcome, and a link to the PR that proves it. |
| **STAR stories** | Ready-to-paste Situation/Task/Action/Result narratives for promotion packets. |
| **Self-eval sections** | Draft self-eval sections for review forms — every claim linked to a PR. |

## Quickstart (web app)

1. Go to **https://annualreview.dev/generate**
2. Click **Connect GitHub** (public or private repos) — or paste a Personal Access Token.
3. Set your review date range and click **Fetch my data**.
4. Optionally add your annual goals so the report is tailored to what you're being measured on.
5. Click **Generate review** → copy sections or download as Markdown.

See [docs/how-to-get-evidence.md](docs/how-to-get-evidence.md) for the full walkthrough, including the CLI path.

## CLI path (local / offline)

If you prefer to keep your token on your machine, use the CLI scripts:

```bash
# 1. Collect PRs and reviews from GitHub
GITHUB_TOKEN=ghp_xxx yarn collect --start 2025-01-01 --end 2025-12-31 --output raw.json

# 2. Normalize into the evidence contract
yarn normalize --input raw.json --output evidence.json

# 3. Run the LLM pipeline locally (requires OPENROUTER_API_KEY or OPENAI_API_KEY)
yarn generate evidence.json
```

- `yarn generate` writes output to `./out` by default; use `--out <dir>` to override.
- Override the LLM model with the `LLM_MODEL` env var (e.g. `LLM_MODEL=google/gemini-2.0-flash`).

See `docs/data-collection.md` for more details.

## Self-hosting

The app requires a Node server so `/api/auth/*` and other API routes work.

**Build & run:**
```bash
yarn build
yarn start   # serves dist/ + API on PORT (default 3000)
```

The repo ships with `nixpacks.toml` for one-click Coolify deploys. See [docs/deploy-coolify.md](docs/deploy-coolify.md).

**Required environment variables:**

| Variable | Description |
|----------|-------------|
| `SESSION_SECRET` | Random string for signing session cookies (e.g. `openssl rand -hex 32`) |
| `GITHUB_CLIENT_ID` | From your [GitHub OAuth App](https://github.com/settings/developers) |
| `GITHUB_CLIENT_SECRET` | From the same OAuth App |
| `OPENROUTER_API_KEY` | **Recommended** LLM provider — premium defaults to `anthropic/claude-haiku-4.5`. Takes priority over `OPENAI_API_KEY`. |
| `OPENAI_API_KEY` | Alternative to OpenRouter — defaults to `gpt-4o-mini`. |

In your GitHub OAuth App settings, set the **Authorization callback URL** to `https://<your-domain>/api/auth/callback/github`. See [docs/oauth-scopes.md](docs/oauth-scopes.md).

**Optional environment variables:**

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Neon (or any Postgres) connection string. Required for premium credits and Stripe payments; tables `credits` and `credit_events` are created automatically. |
| `LLM_MODEL` | Override the default model (e.g. `google/gemini-2.0-flash`) |
| `VITE_POSTHOG_API_KEY` / `POSTHOG_API_KEY` | Enables client-side PostHog analytics (pageviews, autocapture) and server-side LLM tracing |
| `VITE_POSTHOG_HOST` / `POSTHOG_HOST` | PostHog host (default `https://us.i.posthog.com`; use `https://eu.i.posthog.com` for EU) |

## Development

```bash
yarn          # install dependencies
yarn dev      # start Vite dev server
yarn test     # run Vitest tests
yarn typecheck
```

Payment- and premium-related tests (`test/payments.test.js`, `test/generate-premium.test.js`) require `DATABASE_URL` to be set (e.g. a Neon branch or test database).

## Evidence grounding contract

Every generated bullet/claim cites at least one evidence item by id + URL. If impact cannot be proven from GitHub alone, the output labels it _"needs confirmation"_ and asks a follow-up question rather than guessing.
