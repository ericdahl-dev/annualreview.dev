# AGENTS.md — AnnualReview

## Mission
Turn GitHub contribution evidence into an evidence-backed annual review draft: themes, impact bullets, STAR stories, and an appendix of links.

## Hard rules
- Use ONLY the evidence provided in the input JSON.
- Do NOT invent metrics, outcomes, scope, stakeholders, or timelines.
- Every bullet/claim MUST reference at least one evidence item (id + url).
- If impact is unclear, explicitly label as “Potential impact (needs confirmation)” and ask a follow-up question.

## Workflow (recommended)
1) **Normalizer Agent**
   - Input: raw GitHub API responses
   - Output: `evidence.json` with a flat `contributions[]` array matching the prompts.
   - Deduplicate: squash commits under PRs; keep commits only when not associated with PRs.

2) **Theme Agent**
   - Run `prompts/10_theme_cluster.md` → `themes.json`

3) **Bullets Agent**
   - Run `prompts/20_impact_bullets.md` → `bullets.json`

4) **Stories Agent**
   - Run `prompts/30_star_stories.md` → `stories.json`

5) **Self-Eval Agent**
   - Run `prompts/40_self_eval_sections.md` → `self_eval.json`

## Input JSON contract (minimum)
{
  "timeframe": { "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD" },
  "role_context_optional": { "level": "...", "job_family": "...", "focus_areas": ["..."] },
  "goals": "Optional annual goals, one per line. Used to frame themes, bullets, and stories.",
  "contributions": [
    {
      "id": "repo#1234",
      "type": "pull_request|review|release|issue",
      "title": "...",
      "url": "https://github.com/org/repo/pull/1234",
      "repo": "org/repo",
      "merged_at": "ISO8601 or null",
      "labels": ["..."],
      "files_changed": 0,
      "additions": 0,
      "deletions": 0,
      "summary": "...",
      "body": "...",
      "linked_issues": ["..."],
      "review_comments_count": 0,
      "approvals_count": 0
    }
  ]
}

## Development
- **TDD when possible:** For new behavior or non-trivial changes, write or update tests first (Vitest in `test/`), then implement until tests pass. For bugfixes, add a failing test that reproduces the bug, then fix.
- Run `yarn test` before committing; ensure builds and tests pass before opening PRs.
- Payment/premium tests require `DATABASE_URL` (Neon or any Postgres); credit store uses `credits` and `credit_events` tables.

## Notes
- Prefer PRs and reviews as primary evidence.
- Keep outputs copy/paste friendly; avoid long prose.

## Cursor Cloud specific instructions

### Services overview
- **Vite dev server** (frontend): `yarn dev` — serves the React SPA on port 5173.
- **Node.js API server** (backend): `yarn start` — runs `server.ts` on port 3000 (serves built frontend + API routes). For development, `yarn dev` is sufficient for frontend work; the API routes are only available via `yarn start`.

### Key commands
See `package.json` scripts and the Development section in `README.md`. Summary: `yarn test` (Vitest), `yarn typecheck` (tsc --noEmit), `yarn build` (Vite production build), `yarn dev` (Vite dev server).

### Gotchas
- Payment/premium tests (`test/payments.test.js`, `test/generate-premium.test.js`) auto-skip when `DATABASE_URL` is not set — this is expected in environments without Postgres.
- The full generation pipeline requires `OPENROUTER_API_KEY`. Without it the app loads and accepts input, but cannot generate reviews.
- `yarn dev` starts only the Vite frontend dev server (no API routes). To test API routes locally, run `yarn start` after `yarn build`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
