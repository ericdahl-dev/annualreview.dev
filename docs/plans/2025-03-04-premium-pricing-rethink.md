# Premium pricing and output rethink

**Date:** 2025-03-04  
**Status:** Proposal  
**Problem:** Premium is too slow and too wordy.

## Current state

- **Free:** `anthropic/claude-3-haiku`, 500k context cap. Same 4-step pipeline (themes → bullets → stories → self_eval).
- **Premium:** `anthropic/claude-haiku-4.5`, 184k context cap. Same pipeline and **same prompts**; only model and context cap differ.
- **Pricing:** $1 → 5 credits; 1 run = 1 credit.

**Why premium feels slow:** Haiku 4.5 is a larger model than 3 Haiku, so each of the 4 steps takes longer. Same number of steps and no streaming of the final report.

**Why premium feels wordy:** Prompts already say "concise" and "copy/paste ready," but the premium model tends to produce longer prose. No tier-specific length constraints (e.g. word limits, "one line per bullet" for premium).

## Options

### A. Same model, concise premium only (prompt/UX)

- Keep free and premium on the **same** model (e.g. both Haiku 3 or both Haiku 4.5).
- Differentiate premium by **stricter brevity**: premium-only system line or step-level instructions ("Maximum 1–2 sentences per STAR section; bullets ≤ 15 words") and/or premium-specific prompt variants (e.g. `20_impact_bullets_premium.md` with `word_limit_per_bullet: 18`).
- **Pros:** Faster premium (no heavier model), clearly "premium = concise, paste-ready." Simple story: pay for output shape, not raw model tier.
- **Cons:** No "smarter" model for premium; quality might rely more on prompt tuning.

### B. Faster premium model + concise instructions

- Switch premium to a **faster** model (e.g. stay with Claude 3 Haiku or a smaller/faster OpenRouter model) so premium is at least as fast as free or faster.
- Add premium-only brevity instructions (as in A) so output is shorter and feels higher signal.
- **Pros:** Premium is faster and less wordy; positioning can be "premium = concise, fast, paste-ready" rather than "premium = bigger model."
- **Cons:** Marketing may have implied "better model"; need to reframe as "better output format."

### C. Two output tiers (free = full, premium = summary only)

- Free: full pipeline (themes, bullets, stories, self_eval) as today.
- Premium: **reduced pipeline** — e.g. themes + bullets + top 5 only, or themes + "executive summary" bullets only (no STAR stories, shorter self_eval). Fewer steps ⇒ faster; less content ⇒ less wordy.
- **Pros:** Clear product difference; premium is literally a shorter artifact. Fewer LLM calls ⇒ faster and cheaper per run.
- **Cons:** Premium might feel like "less" rather than "better"; need clear copy (e.g. "Premium: concise summary for managers").

## Recommendation

**B** (faster model + concise instructions) or **A** (same model, concise premium only) are the most straightforward: keep one pipeline, fix speed and wordiness by model choice and prompt, then adjust pricing/credits if needed. **C** is a bigger product change and worth considering if you want "premium = different product" rather than "premium = same product, better shape."

## Implementation notes (for B or A)

- **Model:** In `lib/run-pipeline.ts`, `getDefaultModels()` — set premium to a faster model (e.g. `anthropic/claude-3-haiku` to match free, or another OpenRouter model with good speed).
- **Brevity:** Pass `premium: true` into pipeline and either:
  - Append a line to the system prompt when `premium` (e.g. "For this run use maximum brevity: one-line bullets, 1–2 sentence STAR sections, copy-paste ready only."), or
  - Load premium-specific prompt files (e.g. `20_impact_bullets_premium.md`) or add a `premium` field to the step input JSON so prompts can branch.
- **Pricing:** If premium gets cheaper (fewer/smaller tokens), consider keeping $1 but more credits per purchase, or leave as-is and bank the margin.

## Open decisions

- Which model(s) for free vs premium after the rethink?
- Strict word/sentence limits for premium (numbers to put in prompts)?
- Whether to add a "Premium = concise" line in the UI so users expect shorter output.
