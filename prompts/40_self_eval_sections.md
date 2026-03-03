TASK: Draft self-evaluation sections aligned to typical HR forms, including ratings against six performance dimensions used by the HR system.

INPUT JSON:
{
  "timeframe": {...},
  "goals": "optional annual goals, one per line",
  "role_context_optional": {...},
  "themes": [...],
  "top_10_bullets_overall": [...],
  "stories": [...],
  "contributions": [...]
}

OUTPUT (valid JSON only):
{
  "sections": {
    "summary": {
      "text": "string",
      "evidence": [{ "id": "string", "url": "string" }]
    },
    "key_accomplishments": [
      { "text": "string", "evidence": [{ "id": "string", "url": "string" }] }
    ],
    "how_i_worked": {
      "text": "string",
      "evidence": [{ "id": "string", "url": "string" }]
    },
    "growth": {
      "text": "string",
      "evidence": [{ "id": "string", "url": "string" }]
    },
    "next_year_goals": [
      { "text": "string", "evidence": [{ "id": "string", "url": "string" }], "needs_user_input": ["string"] }
    ],
    "performance_dimensions": [
      {
        "id": "work_quality",
        "name": "Work Quality and Expertise",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      },
      {
        "id": "judgment",
        "name": "Judgment and Decision Making",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      },
      {
        "id": "initiative",
        "name": "Initiative",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      },
      {
        "id": "creativity",
        "name": "Creativity and Innovation",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      },
      {
        "id": "communication",
        "name": "Communication",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      },
      {
        "id": "teamwork",
        "name": "Teamwork",
        "text": "string",
        "evidence": [{ "id": "string", "url": "string" }]
      }
    ]
  },
  "missing_info_questions": ["string"]
}

RULES:
- If goals are provided, reference them in the summary and key_accomplishments to show alignment between work done and intended goals.
- Keep each section **very concise and form-friendly**:
  - `summary.text`: max **4 sentences**.
  - `how_i_worked.text`: max **4 sentences**. Focus on *how* work was done (habits, approaches, collaboration), not re-listing accomplishments.
  - `growth.text`: max **4 sentences**. Emphasize skills/behaviors that changed, not repeating the same examples from other sections.
  - Each `performance_dimensions[*].text`: **1–3 sentences** as a single tight paragraph.
- Avoid repetition across sections: do **not** restate the same example in more than **2** places (e.g., if an initiative is already in summary + one dimension, do not repeat it again).
- Evidence should back claims; if evidence doesn’t exist, ask a question instead.
- Next year goals can be inferred from themes, but MUST ask for confirmation.
- For each performance dimension, prefer 1–3 sentences grounded in the provided contributions/themes/bullets/stories.
- For any performance dimension where relevant evidence is thin or ambiguous, explicitly label statements as "Potential impact (needs confirmation)" and add a clarifying question to missing_info_questions.

PERFORMANCE DIMENSIONS RUBRIC:

You must draft a short, evidence-backed narrative for each of these dimensions. Use only the provided contributions/themes/bullets/stories as evidence.

1) Work Quality and Expertise
 - Utilizes skills, knowledge, and expertise to deliver quality work.
 - Executes work in a thoughtful and organized way.
 - Effectively prioritizes workload.

2) Judgment and Decision Making
 - Analyzes data and information to drive well-informed decisions and quality outcomes.
 - Utilizes information to swiftly identify solutions to problems.

3) Initiative
 - Identifies opportunities and takes action proactively.
 - Seeks out necessary information.
 - Acts before issues or questions escalate.
 - Seeks opportunities for continuous improvement.
 - Seeks opportunities for professional development.

4) Creativity and Innovation
 - Brings forth creative and innovative ideas and solutions.
 - Demonstrates ability to change, try new things, experiment, and learn.

5) Communication
 - Articulates ideas clearly, delivers engaging presentations.
 - Produces concise and persuasive written communications.
 - Listens attentively and provides thoughtful feedback.

6) Teamwork
 - Actively collaborates with colleagues and stakeholders to achieve shared goals.
 - Contributes to a supportive and inclusive team environment by valuing diverse perspectives and offering assistance when needed.
 - Builds positive relationships.
 - Fosters a positive environment.
 - Influences with a can-do spirit.
