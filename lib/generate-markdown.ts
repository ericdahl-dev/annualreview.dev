/**
 * Pure function: {themes, bullets, stories, self_eval} → markdown string.
 * No LLM calls; pure templating.
 */

import type { Timeframe } from "../types/evidence.js";

export interface EvidenceRef {
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

/** Return value from each section renderer: rendered lines + evidence refs collected in this section. */
interface SectionOutput {
  lines: string[];
  evidence: EvidenceRef[];
}

function evidenceLinks(evidence: EvidenceRef[] = []): string {
  if (!evidence.length) return "";
  return evidence.map((ref) => `[${ref.id || ref.title || "ref"}](${ref.url})`).join(", ");
}

function collectRefs(refs: EvidenceRef[] | undefined, into: EvidenceRef[]): void {
  for (const ref of refs ?? []) into.push(ref);
}

function renderSummary(summary: SelfEvalSection | undefined): SectionOutput {
  const lines: string[] = [];
  const evidence: EvidenceRef[] = [];
  if (!summary?.text) return { lines, evidence };
  lines.push("---", "", "## Summary", "", summary.text);
  if (summary.evidence?.length) lines.push("", `*Sources: ${evidenceLinks(summary.evidence)}*`);
  lines.push("");
  collectRefs(summary.evidence, evidence);
  return { lines, evidence };
}

function renderThemes(themeList: ThemeEntry[]): SectionOutput {
  const lines: string[] = [];
  const evidence: EvidenceRef[] = [];
  if (!themeList.length) return { lines, evidence };
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
    collectRefs(theme.anchor_evidence, evidence);
  });
  return { lines, evidence };
}

function renderBullets(
  top10: Bullet[],
  byTheme: BulletsByTheme[],
  themeList: ThemeEntry[]
): SectionOutput {
  const lines: string[] = [];
  const evidence: EvidenceRef[] = [];
  if (!top10.length && !byTheme.length) return { lines, evidence };
  lines.push("---", "", "## Impact Bullets", "");
  if (top10.length) {
    lines.push("### Top 10 Bullets", "");
    top10.forEach((bullet) => {
      const refs = bullet.evidence?.length ? ` (${evidenceLinks(bullet.evidence)})` : "";
      lines.push(`- ${bullet.text}${refs}`);
      collectRefs(bullet.evidence, evidence);
    });
    lines.push("");
  }
  if (byTheme.length) {
    const themeNameMap = Object.fromEntries(themeList.map((t) => [t.theme_id, t.theme_name]));
    byTheme.forEach((bulletGroup) => {
      const name = themeNameMap[bulletGroup.theme_id ?? ""] || bulletGroup.theme_id;
      lines.push(`### ${name}`, "");
      (bulletGroup.bullets ?? []).forEach((bullet) => {
        const refs = bullet.evidence?.length ? ` (${evidenceLinks(bullet.evidence)})` : "";
        lines.push(`- ${bullet.text}${refs}`);
        collectRefs(bullet.evidence, evidence);
      });
      lines.push("");
    });
  }
  return { lines, evidence };
}

function renderStories(storyList: Story[]): SectionOutput {
  const lines: string[] = [];
  const evidence: EvidenceRef[] = [];
  if (!storyList.length) return { lines, evidence };
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
    collectRefs(story.evidence, evidence);
  });
  return { lines, evidence };
}

function renderSelfEval(sections: SelfEvalSections): SectionOutput {
  const lines: string[] = [];
  const evidence: EvidenceRef[] = [];
  const hasAnySection =
    sections.summary ||
    sections.key_accomplishments?.length ||
    sections.how_i_worked ||
    sections.growth ||
    sections.next_year_goals?.length ||
    sections.performance_dimensions?.length;

  if (!hasAnySection) return { lines, evidence };
  lines.push("---", "", "## Self-Evaluation", "");

  if (sections.key_accomplishments?.length) {
    lines.push("### Key Accomplishments", "");
    sections.key_accomplishments.forEach((item) => {
      const refs = item.evidence?.length ? ` (${evidenceLinks(item.evidence)})` : "";
      lines.push(`- ${item.text}${refs}`);
      collectRefs(item.evidence, evidence);
    });
    lines.push("");
  }

  if (sections.how_i_worked?.text) {
    lines.push("### How I Worked", "", sections.how_i_worked.text);
    if (sections.how_i_worked.evidence?.length) {
      lines.push("", `*Sources: ${evidenceLinks(sections.how_i_worked.evidence)}*`);
    }
    lines.push("");
    collectRefs(sections.how_i_worked.evidence, evidence);
  }

  if (sections.growth?.text) {
    lines.push("### Growth", "", sections.growth.text);
    if (sections.growth.evidence?.length) {
      lines.push("", `*Sources: ${evidenceLinks(sections.growth.evidence)}*`);
    }
    lines.push("");
    collectRefs(sections.growth.evidence, evidence);
  }

  if (sections.performance_dimensions?.length) {
    lines.push("### Performance Dimensions", "");
    sections.performance_dimensions.forEach((dimension) => {
      const heading = dimension.name || dimension.id;
      if (heading) lines.push(`#### ${heading}`, "");
      if (dimension.text) lines.push(dimension.text);
      if (dimension.evidence?.length) {
        lines.push("", `*Sources: ${evidenceLinks(dimension.evidence)}*`);
      }
      lines.push("");
      collectRefs(dimension.evidence, evidence);
    });
  }

  if (sections.next_year_goals?.length) {
    lines.push("### Next Year Goals", "");
    sections.next_year_goals.forEach((goal) => {
      const refs = goal.evidence?.length ? ` (${evidenceLinks(goal.evidence)})` : "";
      lines.push(`- ${goal.text}${refs}`);
      collectRefs(goal.evidence, evidence);
    });
    lines.push("");
  }

  return { lines, evidence };
}

function renderAppendix(allRefs: EvidenceRef[]): string[] {
  const seen = new Set<string>();
  const unique: EvidenceRef[] = [];
  for (const ref of allRefs) {
    const key = ref.url || ref.id;
    if (key && !seen.has(key)) {
      seen.add(key);
      unique.push(ref);
    }
  }
  if (!unique.length) return [];
  const lines: string[] = ["---", "", "## Evidence Appendix", ""];
  lines.push("| ID | Title | URL |");
  lines.push("|----|-------|-----|");
  unique.forEach((ref) => {
    const id = ref.id || "";
    const title = (ref.title || "").replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
    const url = ref.url || "";
    lines.push(`| ${id} | ${title} | ${url} |`);
  });
  lines.push("");
  return lines;
}

export function generateMarkdown(
  { themes, bullets, stories, self_eval }: GenerateMarkdownInput,
  { timeframe }: GenerateMarkdownOptions = {}
): string {
  const lines: string[] = [];
  const allEvidence: EvidenceRef[] = [];

  // ── Header ──────────────────────────────────────────────────────────────────
  lines.push("# Annual Review Report");
  if (timeframe?.start_date && timeframe?.end_date) {
    lines.push(`*${timeframe.start_date} – ${timeframe.end_date}*`);
  }
  lines.push("");

  const sections = self_eval?.sections ?? {};
  const themeList = themes?.themes ?? [];
  const top10 = bullets?.top_10_bullets_overall ?? [];
  const byTheme = bullets?.bullets_by_theme ?? [];
  const storyList = stories?.stories ?? [];

  const sectionOutputs: SectionOutput[] = [
    renderSummary(sections.summary),
    renderThemes(themeList),
    renderBullets(top10, byTheme, themeList),
    renderStories(storyList),
    renderSelfEval(sections),
  ];

  for (const { lines: sectionLines, evidence } of sectionOutputs) {
    lines.push(...sectionLines);
    allEvidence.push(...evidence);
  }

  lines.push(...renderAppendix(allEvidence));

  return lines.join("\n");
}
