# AnnualReview.dev

Turn GitHub contributions into an evidence-backed annual review. **https://annualreview.dev**

This repo contains:
- `PRD.md` — one-page product requirements doc
- `prompts/` — Cursor-ready prompt templates for a GitHub→story pipeline
- `AGENTS.md` — suggested agent workflow and guardrails

## Suggested pipeline
1) Import GitHub evidence (PRs, reviews, releases) into a structured JSON payload.
2) Run prompts in order:
   - `prompts/00_system.md` (as system)
   - `prompts/10_theme_cluster.md`
   - `prompts/20_impact_bullets.md`
   - `prompts/30_star_stories.md`
   - `prompts/40_self_eval_sections.md`

## How to get the data to paste

**Quick path:** [docs/how-to-get-evidence.md](docs/how-to-get-evidence.md) — create a GitHub token, run collect + normalize, then paste or upload **evidence.json** on the Generate page.

## Production (Coolify / Node)

The app needs a Node server in production so `/api/auth/*` and other API routes work. Use the included server:

- **Build:** `yarn build`
- **Run:** `yarn start` (or `node --import tsx/esm server.ts`) — serves `dist/` and API on `PORT` (default 3000).

**Required env in production:** `SESSION_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, and `OPENROUTER_API_KEY`. In GitHub OAuth App settings, set **Authorization callback URL** to `https://<your-domain>/api/auth/callback/github`. See [docs/oauth-scopes.md](docs/oauth-scopes.md).

**LLM (OpenRouter + Claude):** Set `OPENROUTER_API_KEY` to your [OpenRouter](https://openrouter.ai) key. The pipeline uses OpenRouter with Claude: free tier `anthropic/claude-3-haiku`, premium `anthropic/claude-3.5-sonnet`. Override with `LLM_MODEL` or `PREMIUM_LLM_MODEL`.

**Optional (analytics):** `VITE_POSTHOG_API_KEY` (or `POSTHOG_API_KEY`) — enables client-side PostHog (pageviews and autocapture). For EU host use `VITE_POSTHOG_HOST=https://eu.i.posthog.com`. For server-side LLM analytics (Traces/Generations in PostHog) and Node logs (OTLP), set `POSTHOG_API_KEY` and optionally `POSTHOG_HOST` (default `https://us.i.posthog.com`). Same project token as frontend is fine. In PostHog: **Product → LLM analytics** (or filter Events by `$ai_generation`) for pipeline generations; **Logs** for server logs.

## Scripts

- **Collect (on-demand):** `GITHUB_TOKEN=xxx yarn collect --start YYYY-MM-DD --end YYYY-MM-DD --output raw.json` — fetches your PRs and reviews from GitHub for the date range. No cron required; run when you want fresh data.
- **Normalize:** `yarn normalize --input raw.json --output evidence.json` — turns raw API output into the evidence contract.
- **Generate:** `yarn generate evidence.json` — runs the LLM pipeline (themes → bullets → STAR → self-eval). Writes to `./out` by default; use `--out dir` to override. Requires `OPENROUTER_API_KEY`. Override with `LLM_MODEL` or `PREMIUM_LLM_MODEL`.

See `docs/data-collection.md` for on-demand vs optional periodic (cron) refresh. For future Slack/Jira and other sources, see `docs/multi-source-plan.md`.

## Evidence grounding contract
Every generated bullet/claim must cite evidence items by id+url. If impact is not proven, output must ask for confirmation instead of guessing.
