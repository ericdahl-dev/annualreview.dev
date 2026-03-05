/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import NarrativeView, { shortEvidenceLabel } from "../src/NarrativeView.tsx";

const mockThemes = {
  themes: [
    { theme_id: "reliability", theme_name: "Platform Reliability" },
    { theme_id: "arch", theme_name: "Architecture" },
  ],
};

const mockBullets = {
  bullets_by_theme: [
    {
      theme_id: "reliability",
      bullets: [
        {
          text: "Improved webhook delivery success rate by adding retry logic.",
          evidence: [
            { id: "org/repo#412", url: "https://github.com/org/repo/pull/412" },
          ],
        },
      ],
    },
    {
      theme_id: "arch",
      bullets: [
        {
          text: "Led extraction of billing service from the monolith.",
          evidence: [
            { id: "org/repo#389", url: "https://github.com/org/repo/pull/389" },
            { id: "org/repo#401", url: "https://github.com/org/repo/pull/401" },
          ],
        },
      ],
    },
  ],
};

describe("shortEvidenceLabel", () => {
  it("extracts PR number from org/repo#123", () => {
    expect(shortEvidenceLabel("org/repo#412")).toBe("PR #412");
  });

  it("returns raw id when no # present", () => {
    expect(shortEvidenceLabel("some-id")).toBe("some-id");
  });

  it("returns hash suffix as-is for non-numeric fragments", () => {
    expect(shortEvidenceLabel("org/repo#abc")).toBe("#abc");
  });

  it("handles undefined/empty gracefully", () => {
    expect(shortEvidenceLabel(undefined)).toBe("ref");
    expect(shortEvidenceLabel("")).toBe("ref");
  });
});

describe("NarrativeView", () => {
  it("renders theme names as headings", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    expect(screen.getAllByText("Platform Reliability").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Architecture").length).toBeGreaterThanOrEqual(1);
  });

  it("renders bullet text", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    expect(screen.getByText(/Improved webhook delivery/)).toBeInTheDocument();
    expect(screen.getByText(/Led extraction of billing/)).toBeInTheDocument();
  });

  it("renders evidence tags as links with short labels", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    const link412 = screen.getByRole("link", { name: "PR #412" });
    expect(link412).toHaveAttribute("href", "https://github.com/org/repo/pull/412");

    const link389 = screen.getByRole("link", { name: "PR #389" });
    expect(link389).toHaveAttribute("href", "https://github.com/org/repo/pull/389");
  });

  it("falls back to theme_id when theme name not found", () => {
    const bullets = {
      bullets_by_theme: [
        {
          theme_id: "unknown-theme",
          bullets: [{ text: "Some bullet.", evidence: [] }],
        },
      ],
    };
    render(<NarrativeView themes={mockThemes} bullets={bullets} />);
    expect(screen.getAllByText("unknown-theme").length).toBeGreaterThanOrEqual(1);
  });

  it("shows empty state when bullets_by_theme is empty", () => {
    render(<NarrativeView themes={mockThemes} bullets={{ bullets_by_theme: [] }} />);
    expect(screen.getByText(/no impact bullets/i)).toBeInTheDocument();
  });

  it("shows empty state when bullets prop is undefined", () => {
    render(<NarrativeView themes={mockThemes} bullets={undefined} />);
    expect(screen.getByText(/no impact bullets/i)).toBeInTheDocument();
  });

  it("shows empty state when themes and bullets are both undefined", () => {
    render(<NarrativeView themes={undefined} bullets={undefined} />);
    expect(screen.getByText(/no impact bullets/i)).toBeInTheDocument();
  });

  // ── Toggle behavior ──

  it("defaults to narrative view, not JSON", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    expect(screen.getAllByText("Platform Reliability").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/"theme_id"/)).not.toBeInTheDocument();
  });

  it("toggles Themes to JSON view and back", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    const themesToggle = screen.getByRole("button", { name: /themes.*json/i });
    fireEvent.click(themesToggle);
    expect(screen.getByText(/"theme_id"/)).toBeInTheDocument();
    expect(screen.getByText(/"Platform Reliability"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /themes.*narrative/i }));
    expect(screen.queryByText(/"theme_id"/)).not.toBeInTheDocument();
    expect(screen.getAllByText("Platform Reliability").length).toBeGreaterThanOrEqual(1);
  });

  it("toggles Bullets to JSON view and back", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    const bulletsToggle = screen.getByRole("button", { name: /bullets.*json/i });
    fireEvent.click(bulletsToggle);
    expect(screen.getByText(/"bullets_by_theme"/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /bullets.*narrative/i }));
    expect(screen.queryByText(/"bullets_by_theme"/)).not.toBeInTheDocument();
  });

  it("shows copy button in JSON view for Themes", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} />);
    fireEvent.click(screen.getByRole("button", { name: /themes.*json/i }));
    const copyButtons = screen.getAllByRole("button", { name: /copy/i });
    expect(copyButtons.length).toBeGreaterThanOrEqual(1);
  });

  // ── Themes with optional fields ──

  it("renders theme one-liner, why_it_matters, confidence, and notes", () => {
    const themes = {
      themes: [
        {
          theme_id: "t1",
          theme_name: "Theme One",
          one_liner: "A brief desc",
          why_it_matters: "Because reasons",
          confidence: "high",
          notes_or_assumptions: "Some assumptions",
          anchor_evidence: [{ id: "org/repo#99", url: "https://github.com/org/repo/pull/99" }],
        },
      ],
    };
    render(<NarrativeView themes={themes} bullets={{ bullets_by_theme: [] }} />);
    expect(screen.getByText("A brief desc")).toBeInTheDocument();
    expect(screen.getByText(/Because reasons/)).toBeInTheDocument();
    expect(screen.getByText(/high/)).toBeInTheDocument();
    expect(screen.getByText("Some assumptions")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #99" })).toBeInTheDocument();
  });

  it("renders theme with confidence only (no notes)", () => {
    const themes = { themes: [{ theme_id: "t2", theme_name: "T2", confidence: "medium" }] };
    render(<NarrativeView themes={themes} bullets={{ bullets_by_theme: [] }} />);
    expect(screen.getByText(/medium/)).toBeInTheDocument();
  });

  it("renders anchor evidence with title override", () => {
    const themes = {
      themes: [
        { theme_id: "t3", theme_name: "T3", anchor_evidence: [{ id: "x", url: "http://x", title: "My PR" }] },
      ],
    };
    render(<NarrativeView themes={themes} bullets={{ bullets_by_theme: [] }} />);
    expect(screen.getByRole("link", { name: "My PR" })).toBeInTheDocument();
  });

  // ── STAR stories ──

  it("renders stories with situation, task, actions, results, evidence, confidence", () => {
    const stories = {
      stories: [
        {
          title: "Incident Response",
          situation: "System was down",
          task: "Restore service",
          actions: ["Restarted pods", "Rolled back deploy"],
          results: ["99.9% uptime restored"],
          evidence: [{ id: "org/repo#50", url: "https://github.com/org/repo/pull/50" }],
          confidence: "high",
        },
      ],
    };
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} stories={stories} />);
    expect(screen.getByText("Incident Response")).toBeInTheDocument();
    expect(screen.getByText(/System was down/)).toBeInTheDocument();
    expect(screen.getByText(/Restore service/)).toBeInTheDocument();
    expect(screen.getByText("Restarted pods")).toBeInTheDocument();
    expect(screen.getByText("Rolled back deploy")).toBeInTheDocument();
    expect(screen.getByText("99.9% uptime restored")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "PR #50" })).toBeInTheDocument();
    expect(screen.getByText(/Confidence: high/)).toBeInTheDocument();
  });

  it("shows empty STAR stories state", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} stories={{ stories: [] }} />);
    expect(screen.getByText(/no star stories/i)).toBeInTheDocument();
  });

  it("toggles STAR stories to JSON view", () => {
    const stories = { stories: [{ title: "S1", situation: "sit" }] };
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} stories={stories} />);
    fireEvent.click(screen.getByRole("button", { name: /star stories.*json/i }));
    expect(screen.getByText(/"title"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /star stories.*narrative/i }));
    expect(screen.queryByText(/"title"/)).not.toBeInTheDocument();
  });

  // ── Self-eval ──

  it("renders self-eval with summary, accomplishments, how_i_worked, growth, dimensions, next_year_goals", () => {
    const selfEval = {
      sections: {
        summary: { text: "Great year", evidence: [{ id: "org/repo#1", url: "http://x" }] },
        key_accomplishments: [{ text: "Shipped feature X", evidence: [] }],
        how_i_worked: { text: "Collaboratively", evidence: [] },
        growth: { text: "Learned Rust", evidence: [] },
        performance_dimensions: [
          { id: "d1", name: "Technical Excellence", text: "Strong", evidence: [{ id: "org/repo#2", url: "http://y" }] },
        ],
        next_year_goals: [{ text: "Learn Go", evidence: [] }],
      },
    };
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} self_eval={selfEval} />);
    expect(screen.getByText("Great year")).toBeInTheDocument();
    expect(screen.getByText("Shipped feature X")).toBeInTheDocument();
    expect(screen.getByText("Collaboratively")).toBeInTheDocument();
    expect(screen.getByText("Learned Rust")).toBeInTheDocument();
    expect(screen.getByText("Technical Excellence")).toBeInTheDocument();
    expect(screen.getByText(/Strong/)).toBeInTheDocument();
    expect(screen.getByText("Learn Go")).toBeInTheDocument();
  });

  it("shows empty self-eval when sections is undefined", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} self_eval={undefined} />);
    expect(screen.getByText(/no self-eval sections/i)).toBeInTheDocument();
  });

  it("shows empty self-eval when sections has no content", () => {
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} self_eval={{ sections: {} }} />);
    expect(screen.getByText(/no self-eval sections/i)).toBeInTheDocument();
  });

  it("toggles self-eval to JSON view", () => {
    const selfEval = { sections: { summary: { text: "Good" } } };
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} self_eval={selfEval} />);
    fireEvent.click(screen.getByRole("button", { name: /self-eval.*json/i }));
    expect(screen.getByText(/"summary"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /self-eval.*narrative/i }));
    expect(screen.queryByText(/"summary"/)).not.toBeInTheDocument();
  });

  it("renders performance dimension with id fallback (no name)", () => {
    const selfEval = {
      sections: {
        performance_dimensions: [{ id: "tech", text: "Good" }],
      },
    };
    render(<NarrativeView themes={mockThemes} bullets={mockBullets} self_eval={selfEval} />);
    expect(screen.getByText("tech")).toBeInTheDocument();
  });
});
