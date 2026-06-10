# Project Instructions for AI Agents

This file provides instructions and context for AI coding agents working on this project.

## GitHub Issue Tracking

Use GitHub issues for task tracking and follow-up work.

### Quick Reference

```bash
gh issue list
gh issue view <number>
gh issue create
gh issue comment <number>
```

### Rules

- Use GitHub issues for any follow-up work that should survive the current session.
- Do not create markdown TODO lists for repo task tracking.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is not complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create GitHub issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue or PR status** - Leave the repo state clear for the next session
4. **PUSH TO REMOTE** - This is mandatory:
   ```bash
   git pull --rebase
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is not complete until `git push` succeeds
- Never stop before pushing - that leaves work stranded locally
- Never say "ready to push when you are" - you must push
- If push fails, resolve and retry until it succeeds

## Agent skills

### Issue tracker

GitHub Issues are the issue tracker for this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

This repo uses the default triage label vocabulary: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

This repo is configured as single-context: one root `CONTEXT.md` and one `docs/adr/` directory. See `docs/agents/domain.md`.

## Build & Test

_Add your build and test commands here_

```bash
# Example:
# npm install
# npm test
```

## Architecture Overview

_Add a brief overview of your project architecture_

## Conventions & Patterns

_Add your project-specific conventions here_
