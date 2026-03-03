import { describe, it, expect } from "vitest";
import { generateMarkdown } from "../lib/generate-markdown.js";

const sampleData = {
  themes: {
    themes: [
      {
        theme_id: "t1",
        theme_name: "Reliability & incident response",
        one_liner: "Kept systems stable under load.",
        why_it_matters: "Reduced on-call burden for the whole team.",
        confidence: "high",
        notes_or_assumptions: null,
        anchor_evidence: [
          { id: "org/repo#10", url: "https://github.com/org/repo/pull/10", title: "Fix flaky test", repo: "org/repo" },
        ],
      },
    ],
    missing_info_questions: [],
  },
  bullets: {
    bullets_by_theme: [
      {
        theme_id: "t1",
        bullets: [
          {
            text: "Reduced alert noise by 40% so on-call load dropped.",
            evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10" }],
            impact_level: "high",
            confidence: "high",
          },
        ],
      },
    ],
    top_10_bullets_overall: [
      {
        text: "Reduced alert noise by 40% so on-call load dropped.",
        evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10" }],
        theme_id: "t1",
      },
    ],
    missing_info_questions: [],
  },
  stories: {
    stories: [
      {
        title: "Taming alert fatigue",
        theme_id: "t1",
        situation: "The team received 200+ alerts per week.",
        task: "Own the alert deduplication project.",
        actions: ["Audited existing alerts", "Consolidated duplicates"],
        results: ["Alert volume dropped 40%"],
        evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10", title: "Fix flaky test" }],
        confidence: "high",
        missing_info_questions: [],
      },
    ],
  },
  self_eval: {
    sections: {
      summary: {
        text: "Delivered reliability improvements and feature work across two teams.",
        evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10" }],
      },
      key_accomplishments: [
        {
          text: "Reduced alert noise by 40%.",
          evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10" }],
        },
      ],
      how_i_worked: { text: "Collaborated cross-functionally.", evidence: [] },
      growth: { text: "Grew in technical leadership.", evidence: [] },
      next_year_goals: [
        { text: "Lead a major infrastructure project.", evidence: [], needs_user_input: ["confirm scope"] },
      ],
      performance_dimensions: [
        {
          id: "work_quality",
          name: "Work Quality and Expertise",
          text: "Consistently delivered high-quality, well-tested changes.",
          evidence: [{ id: "org/repo#10", url: "https://github.com/org/repo/pull/10" }],
        },
      ],
    },
    missing_info_questions: [],
  },
};

describe("generateMarkdown", () => {
  it("returns a non-empty string", () => {
    const md = generateMarkdown(sampleData);
    expect(typeof md).toBe("string");
    expect(md.length).toBeGreaterThan(0);
  });

  it("includes the report title", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("# Annual Review Report");
  });

  it("includes timeframe when provided", () => {
    const md = generateMarkdown(sampleData, { timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" } });
    expect(md).toContain("2025-01-01");
    expect(md).toContain("2025-12-31");
  });

  it("omits timeframe line when not provided", () => {
    const md = generateMarkdown(sampleData);
    expect(md).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("includes Themes section with theme name and confidence", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("## Themes");
    expect(md).toContain("Reliability & incident response");
    expect(md).toContain("Confidence: high");
  });

  it("includes Impact Bullets section with top-10 bullets", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("## Impact Bullets");
    expect(md).toContain("Reduced alert noise by 40%");
  });

  it("includes evidence links in bullets", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("[org/repo#10](https://github.com/org/repo/pull/10)");
  });

  it("includes STAR Stories section", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("## STAR Stories");
    expect(md).toContain("Taming alert fatigue");
    expect(md).toContain("**Situation:**");
    expect(md).toContain("**Actions:**");
    expect(md).toContain("**Results:**");
  });

  it("includes Self-Evaluation section", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("## Self-Evaluation");
    expect(md).toContain("Key Accomplishments");
    expect(md).toContain("How I Worked");
    expect(md).toContain("Growth");
    expect(md).toContain("Next Year Goals");
  });

  it("includes performance dimensions in the Self-Evaluation section", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("Performance dimensions");
    expect(md).toContain("Work Quality and Expertise");
    expect(md).toContain("Consistently delivered high-quality, well-tested changes.");
  });

  it("includes Evidence Appendix table", () => {
    const md = generateMarkdown(sampleData);
    expect(md).toContain("## Evidence Appendix");
    expect(md).toContain("| ID | Title | URL |");
    expect(md).toContain("org/repo#10");
    expect(md).toContain("https://github.com/org/repo/pull/10");
  });

  it("deduplicates evidence in appendix", () => {
    const md = generateMarkdown(sampleData);
    const matches = md.match(/org\/repo#10/g) ?? [];
    // Should appear in bullets/stories/appendix but only once in the appendix table body
    const appendixSection = md.split("## Evidence Appendix")[1] ?? "";
    const tableRows = appendixSection.split("\n").filter((l) => l.startsWith("| org/repo#10"));
    expect(tableRows).toHaveLength(1);
  });

  it("handles empty pipeline output gracefully (no throw)", () => {
    const md = generateMarkdown(
      { themes: {}, bullets: {}, stories: {}, self_eval: {} },
      { timeframe: { start_date: "2025-01-01", end_date: "2025-12-31" } }
    );
    expect(md).toContain("# Annual Review Report");
    expect(md).not.toContain("## Themes");
    expect(md).not.toContain("## Impact Bullets");
    expect(md).not.toContain("## STAR Stories");
    expect(md).not.toContain("## Evidence Appendix");
  });

  it("escapes pipe characters in titles for the appendix table", () => {
    const data = {
      ...sampleData,
      stories: {
        stories: [
          {
            ...sampleData.stories.stories[0],
            evidence: [{ id: "org/repo#99", url: "https://github.com/org/repo/pull/99", title: "Fix A | B" }],
          },
        ],
      },
    };
    const md = generateMarkdown(data);
    expect(md).toContain("Fix A \\| B");
  });
});
