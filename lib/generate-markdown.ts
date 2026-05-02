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
  evidence_ids?: string[];
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

export interface ThemesOutput {
  themes?: ThemeEntry[];
}

export interface BulletsOutput {
  top_10_bullets_overall?: Bullet[];
  bullets_by_theme?: BulletsByTheme[];
}

export interface StoriesOutput {
  stories?: Story[];
}

export interface SelfEvalOutput {
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
  return evidence.map((ref) => `[${ref.id || ref.title || "ref"}](${ref.url})`).join(", ");
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
    themeList.forEach((theme, i) => {
      lines.push(`### ${i + 1}. ${theme.theme_name}`);
      if (theme.one_liner) lines.push("", `> ${theme.one_liner}`);
      if (theme.why_it_matters) lines.push("", `**Why it matters:** ${theme.why_it_matters}`);
      if (theme.confidence) lines.push("", `*Confidence: ${theme.confidence}*`);
      if (theme.notes_or_assumptions) lines.push("", `*Notes: ${theme.notes_or_assumptions}*`);
      if (theme.anchor_evidence?.length) {
        lines.push("", `*Evidence: ${theme.anchor_evidence.map((ref) => `[${ref.title || ref.id}](${ref.url})`).join(", ")}*`);
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
      top10.forEach((bullet) => {
        const refs = bullet.evidence?.length ? ` (${evidenceLinks(bullet.evidence)})` : "";
        lines.push(`- ${bullet.text}${refs}`);
      });
      lines.push("");
    }
    if (byTheme.length) {
      const themeNameMap = Object.fromEntries(themeList.map((theme) => [theme.theme_id, theme.theme_name]));
      byTheme.forEach((bulletGroup) => {
        const name = themeNameMap[bulletGroup.theme_id ?? ""] || bulletGroup.theme_id;
        lines.push(`### ${name}`, "");
        (bulletGroup.bullets ?? []).forEach((bullet) => {
          const refs = bullet.evidence?.length ? ` (${evidenceLinks(bullet.evidence)})` : "";
          lines.push(`- ${bullet.text}${refs}`);
        });
        lines.push("");
      });
    }
  }

  // ── STAR Stories ────────────────────────────────────────────────────────────
  const storyList = stories?.stories ?? [];
  if (storyList.length) {
    lines.push("---", "", "## STAR Stories", "");
    storyList.forEach((story) => {
      lines.push(`### ${story.title}`);
      if (story.situation) lines.push("", `**Situation:** ${story.situation}`);
      if (story.task) lines.push("", `**Task:** ${story.task}`);
      if (story.actions?.length) {
        lines.push("", "**Actions:**");
        story.actions.forEach((action) => lines.push(`- ${action}`));
      }
      if (story.results?.length) {
        lines.push("", "**Results:**");
        story.results.forEach((result) => lines.push(`- ${result}`));
      }
      if (story.evidence?.length) {
        lines.push("", `*Evidence: ${story.evidence.map((ref) => `[${ref.title || ref.id}](${ref.url})`).join(", ")}*`);
      }
      if (story.confidence) lines.push("", `*Confidence: ${story.confidence}*`);
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
      lines.push("### Performance Dimensions", "");
      sections.performance_dimensions.forEach((dimension) => {
        const heading = dimension.name || dimension.id;
        if (heading) {
          lines.push(`#### ${heading}`, "");
        }
        if (dimension.text) {
          lines.push(dimension.text);
        }
        if (dimension.evidence?.length) {
          lines.push("", `*Sources: ${evidenceLinks(dimension.evidence)}*`);
        }
        lines.push("");
      });
    }

    if (sections.next_year_goals?.length) {
      lines.push("### Next Year Goals", "");
      sections.next_year_goals.forEach((goal) => {
        const refs = goal.evidence?.length ? ` (${evidenceLinks(goal.evidence)})` : "";
        lines.push(`- ${goal.text}${refs}`);
      });
      lines.push("");
    }
  }

  // ── Evidence Appendix ───────────────────────────────────────────────────────
  // Collect all unique evidence items referenced across all sections
  const seen = new Set<string>();
  const allEvidence: EvidenceRef[] = [];

  function addEvidence(ev: EvidenceRef[] | undefined = []) {
    for (const ref of ev) {
      const key = ref.url || ref.id;
      if (key && !seen.has(key)) {
        seen.add(key);
        allEvidence.push(ref);
      }
    }
  }

  if (summary?.evidence) addEvidence(summary.evidence);
  themeList.forEach((theme) => addEvidence(theme.anchor_evidence));
  top10.forEach((bullet) => addEvidence(bullet.evidence));
  byTheme.forEach((bulletGroup) => (bulletGroup.bullets ?? []).forEach((bullet) => addEvidence(bullet.evidence)));
  storyList.forEach((story) => addEvidence(story.evidence));
  if (sections.key_accomplishments) sections.key_accomplishments.forEach((item) => addEvidence(item.evidence));
  if (sections.how_i_worked) addEvidence(sections.how_i_worked.evidence);
  if (sections.growth) addEvidence(sections.growth.evidence);
  if (sections.next_year_goals) sections.next_year_goals.forEach((goal) => addEvidence(goal.evidence));
  if (sections.performance_dimensions) {
    sections.performance_dimensions.forEach((dimension) => addEvidence(dimension.evidence));
  }

  if (allEvidence.length) {
    lines.push("---", "", "## Evidence Appendix", "");
    lines.push("| ID | Title | URL |");
    lines.push("|----|-------|-----|");
    allEvidence.forEach((ref) => {
      const id = ref.id || "";
      const title = (ref.title || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
      const url = ref.url || "";
      lines.push(`| ${id} | ${title} | ${url} |`);
    });
    lines.push("");
  }

  return lines.join("\n");
}
