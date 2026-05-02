TASK: Roll up a week of daily summaries into a concise weekly summary.

INPUT:
You will receive JSON with:
- week_start: "YYYY-MM-DD" (Monday)
- week_end:   "YYYY-MM-DD" (Sunday)
- daily_summaries: array of daily summary objects, each containing:
  { date, headline, bullets: [{text, evidence_ids}], contribution_count }

OUTPUT (valid JSON only):
{
  "week_start": "YYYY-MM-DD",
  "week_end": "YYYY-MM-DD",
  "headline": "One sentence capturing the week's primary focus",
  "themes": [
    {
      "name": "Short theme name (e.g. 'Bug fixes', 'Feature work', 'Code review')",
      "summary": "1–2 sentences describing this theme's work during the week",
      "day_refs": ["YYYY-MM-DD"]
    }
  ],
  "highlights": [
    {
      "text": "A notable accomplishment or event from the week",
      "date": "YYYY-MM-DD"
    }
  ],
  "total_contributions": 0,
  "active_days": 0
}

RULES:
- 2–4 themes maximum; name them from the actual work, not generic labels.
- 2–5 highlights maximum; pick the most significant items.
- Base everything only on the provided daily summaries — do not invent work.
- If all daily summaries are empty (no activity), return a single theme named "No activity" and no highlights.
- Keep the headline under 120 characters.
