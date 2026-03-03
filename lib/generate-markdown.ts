/**
 * Pure function: {themes, bullets, stories, self_eval} → markdown string.
 * No LLM calls; pure templating.
 */

import type { Timeframe } from "../types/evidence.js";

interface EvidenceRef {
  id?: string;
  title?: string;
  url?: string;
}

interface ThemeEntry {
  theme_id?: string;
  theme_name?: string;
  one_liner?: string;
  why_it_matters?: string;
  confidence?: string;
  notes_or_assumptions?: string;
  anchor_evidence?: EvidenceRef[];
}

interface Bullet {
  text?: string;
  evidence?: EvidenceRef[];
}

interface BulletsByTheme {
  theme_id?: string;
  bullets?: Bullet[];
}

interface Story {
  title?: string;
  situation?: string;
  task?: string;
  actions?: string[];
  results?: string[];
  evidence?: EvidenceRef[];
  confidence?: string;
}

interface SelfEvalSection {
  text?: string;
  evidence?: EvidenceRef[];
}

interface PerformanceDimension {
  id?: string;
  name?: string;
  text?: string;
  evidence?: EvidenceRef[];
}

interface SelfEvalSections {
  summary?: SelfEvalSection;
  key_accomplishments?: (Bullet & { evidence?: EvidenceRef[] })[];
  how_i_worked?: SelfEvalSection;
  growth?: SelfEvalSection;
  next_year_goals?: Bullet[];
  performance_dimensions?: PerformanceDimension[];
}

interface ThemesOutput {
  themes?: ThemeEntry[];
}

interface BulletsOutput {
  top_10_bullets_overall?: Bullet[];
  bullets_by_theme?: BulletsByTheme[];
}

interface StoriesOutput {
  stories?: Story[];
}

interface SelfEvalOutput {
  sections?: SelfEvalSections;
}

interface GenerateMarkdownInput {
  themes?: ThemesOutput;
  bullets?: BulletsOutput;
  stories?: StoriesOutput;
  self_eval?: SelfEvalOutput;
}

interface GenerateMarkdownOptions {
  timeframe?: Timeframe;
}

function evidenceLinks(evidence: EvidenceRef[] = []): string {
  if (!evidence.length) return "";
  return evidence.map((e) => `[${e.id || e.title || "ref"}](${e.url})`).join(", ");
}

export function generateMarkdown(
  { themes, bullets, stories, self_eval }: GenerateMarkdownInput,
  { timeframe }: GenerateMarkdownOptions = {}
): string {
  const lines = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push("# Annual Review Report");
  if (timeframe?.start_date && timeframe?.end_date) {
    lines.push(`*${timeframe.start_date} – ${timeframe.end_date}*`);
  }
  lines.push("");

  // ── Summary ─────────────────────────────────────────────────────────────────
  const summary = self_eval?.sections?.summary;
  if (summary?.text) {
    lines.push("---", "", "## Summary", "", summary.text);
    if (summary.evidence?.length) lines.push("", `*Sources: ${evidenceLinks(summary.evidence)}*`);
    lines.push("");
  }

  // ── Themes ──────────────────────────────────────────────────────────────────
  const themeList = themes?.themes ?? [];
  if (themeList.length) {
    lines.push("---", "", "## Themes", "");
    themeList.forEach((t, i) => {
      lines.push(`### ${i + 1}. ${t.theme_name}`);
      if (t.one_liner) lines.push("", `> ${t.one_liner}`);
      if (t.why_it_matters) lines.push("", `**Why it matters:** ${t.why_it_matters}`);
      if (t.confidence) lines.push("", `*Confidence: ${t.confidence}*`);
      if (t.notes_or_assumptions) lines.push("", `*Notes: ${t.notes_or_assumptions}*`);
      if (t.anchor_evidence?.length) {
        lines.push("", `*Evidence: ${t.anchor_evidence.map((e) => `[${e.title || e.id}](${e.url})`).join(", ")}*`);
      }
      lines.push("");
    });
  }

  // ── Impact Bullets ──────────────────────────────────────────────────────────
  const top10 = bullets?.top_10_bullets_overall ?? [];
  const byTheme = bullets?.bullets_by_theme ?? [];
  if (top10.length || byTheme.length) {
    lines.push("---", "", "## Impact Bullets", "");
    if (top10.length) {
      lines.push("### Top 10 Bullets", "");
      top10.forEach((b) => {
        const refs = b.evidence?.length ? ` (${evidenceLinks(b.evidence)})` : "";
        lines.push(`- ${b.text}${refs}`);
      });
      lines.push("");
    }
    if (byTheme.length) {
      const themeNameMap = Object.fromEntries(themeList.map((t) => [t.theme_id, t.theme_name]));
      byTheme.forEach((bt) => {
        const name = themeNameMap[bt.theme_id ?? ""] || bt.theme_id;
        lines.push(`### ${name}`, "");
        (bt.bullets ?? []).forEach((b) => {
          const refs = b.evidence?.length ? ` (${evidenceLinks(b.evidence)})` : "";
          lines.push(`- ${b.text}${refs}`);
        });
        lines.push("");
      });
    }
  }

  // ── STAR Stories ────────────────────────────────────────────────────────────
  const storyList = stories?.stories ?? [];
  if (storyList.length) {
    lines.push("---", "", "## STAR Stories", "");
    storyList.forEach((s) => {
      lines.push(`### ${s.title}`);
      if (s.situation) lines.push("", `**Situation:** ${s.situation}`);
      if (s.task) lines.push("", `**Task:** ${s.task}`);
      if (s.actions?.length) {
        lines.push("", "**Actions:**");
        s.actions.forEach((a) => lines.push(`- ${a}`));
      }
      if (s.results?.length) {
        lines.push("", "**Results:**");
        s.results.forEach((r) => lines.push(`- ${r}`));
      }
      if (s.evidence?.length) {
        lines.push("", `*Evidence: ${s.evidence.map((e) => `[${e.title || e.id}](${e.url})`).join(", ")}*`);
      }
      if (s.confidence) lines.push("", `*Confidence: ${s.confidence}*`);
      lines.push("");
    });
  }

  // ── Self-Evaluation ─────────────────────────────────────────────────────────
  const sections = self_eval?.sections ?? {};
  const hasAnySection =
    sections.summary ||
    sections.key_accomplishments?.length ||
    sections.how_i_worked ||
    sections.growth ||
    sections.next_year_goals?.length ||
    sections.performance_dimensions?.length;

  if (hasAnySection) {
    lines.push("---", "", "## Self-Evaluation", "");

    if (sections.key_accomplishments?.length) {
      lines.push("### Key Accomplishments", "");
      sections.key_accomplishments.forEach((item) => {
        const refs = item.evidence?.length ? ` (${evidenceLinks(item.evidence)})` : "";
        lines.push(`- ${item.text}${refs}`);
      });
      lines.push("");
    }

    if (sections.how_i_worked?.text) {
      lines.push("### How I Worked", "", sections.how_i_worked.text);
      if (sections.how_i_worked.evidence?.length) {
        lines.push("", `*Sources: ${evidenceLinks(sections.how_i_worked.evidence)}*`);
      }
      lines.push("");
    }

    if (sections.growth?.text) {
      lines.push("### Growth", "", sections.growth.text);
      if (sections.growth.evidence?.length) {
        lines.push("", `*Sources: ${evidenceLinks(sections.growth.evidence)}*`);
      }
      lines.push("");
    }

    if (sections.performance_dimensions?.length) {
      lines.push("### Performance dimensions", "");
      sections.performance_dimensions.forEach((dim) => {
        const heading = dim.name || dim.id;
        if (heading) {
          lines.push(`#### ${heading}`, "");
        }
        if (dim.text) {
          lines.push(dim.text);
        }
        if (dim.evidence?.length) {
          lines.push("", `*Sources: ${evidenceLinks(dim.evidence)}*`);
        }
        lines.push("");
      });
    }

    if (sections.next_year_goals?.length) {
      lines.push("### Next Year Goals", "");
      sections.next_year_goals.forEach((g) => {
        const refs = g.evidence?.length ? ` (${evidenceLinks(g.evidence)})` : "";
        lines.push(`- ${g.text}${refs}`);
      });
      lines.push("");
    }
  }

  // ── Evidence Appendix ───────────────────────────────────────────────────────
  // Collect all unique evidence items referenced across all sections
  const seen = new Set<string>();
  const allEvidence: EvidenceRef[] = [];

  function addEvidence(ev: EvidenceRef[] | undefined = []) {
    for (const e of ev) {
      const key = e.url || e.id;
      if (key && !seen.has(key)) {
        seen.add(key);
        allEvidence.push(e);
      }
    }
  }

  if (summary?.evidence) addEvidence(summary.evidence);
  themeList.forEach((t) => addEvidence(t.anchor_evidence));
  top10.forEach((b) => addEvidence(b.evidence));
  byTheme.forEach((bt) => (bt.bullets ?? []).forEach((b) => addEvidence(b.evidence)));
  storyList.forEach((s) => addEvidence(s.evidence));
  if (sections.key_accomplishments) sections.key_accomplishments.forEach((i) => addEvidence(i.evidence));
  if (sections.how_i_worked) addEvidence(sections.how_i_worked.evidence);
  if (sections.growth) addEvidence(sections.growth.evidence);
  if (sections.next_year_goals) sections.next_year_goals.forEach((i) => addEvidence(i.evidence));
  if (sections.performance_dimensions) {
    sections.performance_dimensions.forEach((d) => addEvidence(d.evidence));
  }

  if (allEvidence.length) {
    lines.push("---", "", "## Evidence Appendix", "");
    lines.push("| ID | Title | URL |");
    lines.push("|----|-------|-----|");
    allEvidence.forEach((e) => {
      const id = e.id || "";
      const title = (e.title || "").replace(/\|/g, "\\|");
      const url = e.url || "";
      lines.push(`| ${id} | ${title} | ${url} |`);
    });
    lines.push("");
  }

  return lines.join("\n");
}
