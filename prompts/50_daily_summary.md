TASK: Produce a brief, factual daily summary of today's GitHub contributions.

INPUT:
You will receive JSON with:
- timeframe {start_date, end_date} — both will be the same date for a daily run
- contributions: array of items for that day with fields:
  { id, type, title, url, repo, merged_at, labels, summary, body }

OUTPUT (valid JSON only):
{
  "date": "YYYY-MM-DD",
  "headline": "One sentence summarizing the day's work",
  "bullets": [
    {
      "text": "Short fact-based bullet (what was done, which repo/PR)",
      "evidence_ids": ["id1"]
    }
  ],
  "contribution_count": 0,
  "notes": "Any missing info or uncertainty (empty string if none)"
}

RULES:
- 3–7 bullets maximum.
- Each bullet must reference exactly one evidence item by id.
- State facts only — do not invent metrics, outcomes, or scope.
- If a PR was merged, say "merged"; if it was reviewed, say "reviewed".
- If there are zero contributions, return an empty bullets array and a headline of "No GitHub activity recorded".
- Keep each bullet under 120 characters.
