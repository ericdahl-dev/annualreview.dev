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
