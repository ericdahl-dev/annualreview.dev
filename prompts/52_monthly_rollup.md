TASK: Roll up a month of weekly summaries into a concise monthly summary.

INPUT:
You will receive JSON with:
- month: "YYYY-MM"
- weekly_summaries: array of weekly rollup objects, each containing:
  { week_start, week_end, headline, themes: [{name, summary, day_refs}],
    highlights: [{text, date}], total_contributions, active_days }

OUTPUT (valid JSON only):
{
  "month": "YYYY-MM",
  "headline": "One sentence capturing the month's primary impact",
  "themes": [
    {
      "name": "Theme name",
      "summary": "2–3 sentences describing this theme's arc across the month",
      "week_refs": ["YYYY-WNN or week_start dates"]
    }
  ],
  "top_accomplishments": [
    {
      "text": "A significant accomplishment from the month",
      "week": "week_start date"
    }
  ],
  "total_contributions": 0,
  "active_weeks": 0,
  "momentum": "increasing|steady|decreasing",
  "notes": "Anything uncertain or worth flagging for the annual review (empty string if none)"
}

RULES:
- 2–5 themes maximum; synthesize across weeks rather than repeating each week.
- 3–6 top accomplishments; pick the highest-impact items from across all weeks.
- "momentum" is your judgment of activity trend across the weeks.
- Base everything only on the provided weekly summaries — do not invent work.
- If there are no weekly summaries with activity, return a single theme "No activity", empty accomplishments, and momentum "steady".
- Keep the headline under 120 characters.
