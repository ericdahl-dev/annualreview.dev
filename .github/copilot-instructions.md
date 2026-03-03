# Copilot Instructions — AnnualReview.dev

## Project overview
AnnualReview.dev turns GitHub contribution evidence into an evidence-backed annual review draft: themes, impact bullets, STAR stories, and an appendix of links.

## Tech stack
- **Frontend:** React 18, Vite, TypeScript
- **Backend:** Node.js (ESM), Express-style server routes under `server/routes/`
- **Database:** Neon Postgres via `pg`; tables `credits` and `credit_events` for the credit/payment store
- **AI:** OpenAI SDK (`openai`), pipeline defined in `lib/run-pipeline.ts`
- **Payments:** Stripe Node SDK v20.4.0, `apiVersion` pinned to `"2026-02-25.clover"`
- **Testing:** Vitest + `@testing-library/react`; test files live in `test/`
- **Build/dev:** `yarn dev` (Vite), `yarn build`, `yarn start` (production server)

## Repository layout
```
src/           React frontend components
server/        Server entry-point & route handlers
lib/           Shared business logic (pipeline, markdown generation, stores)
scripts/       CLI scripts (collect, normalize, generate, validate)
test/          Vitest test files
prompts/       LLM prompt templates
schemas/       JSON Schema definitions
```

## Development practices
- **TDD when possible:** write or update tests in `test/` first (Vitest), then implement until they pass. For bugfixes, add a failing test that reproduces the bug before fixing.
- Run `yarn test` before committing; ensure builds and tests pass before opening PRs.
- Run `yarn typecheck` (`tsc --noEmit`) to catch type errors.
- Payment/premium tests require `DATABASE_URL` (Neon or any Postgres).
- Use `yarn` (not `npm`) for all package operations.

## Hard rules for AI-generated content
- Use ONLY the evidence provided in the input JSON — never invent metrics, outcomes, or stakeholders.
- Every claim in generated review text MUST reference at least one evidence item (`id` + `url`).
- If impact is unclear, label it "Potential impact (needs confirmation)" and ask a follow-up question.

## Coding conventions
- All files use ESM (`"type": "module"` in package.json); prefer named exports.
- TypeScript throughout; avoid `any` where possible.
- Section headings in `lib/generate-markdown.ts` use title case for `###` level headings.
- Stripe client is instantiated with the `STRIPE_API_VERSION` constant — do not hard-code the version string elsewhere.
- Vite dev server loads environment variables via `loadEnv` in `vite.config.ts`; add new env vars there if needed.
