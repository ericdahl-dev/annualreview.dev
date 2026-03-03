import React, { useState } from "react";
import "./NarrativeView.css";

interface EvidenceRef {
  id?: string;
  url?: string;
  title?: string;
}

interface Bullet {
  text?: string;
  evidence?: EvidenceRef[];
}

interface BulletsByTheme {
  theme_id?: string;
  bullets?: Bullet[];
}

interface AnchorEvidence {
  id?: string;
  url?: string;
  title?: string;
  repo?: string;
}

interface ThemeEntry {
  theme_id?: string;
  theme_name?: string;
  one_liner?: string;
  why_it_matters?: string;
  confidence?: string;
  notes_or_assumptions?: string;
  anchor_evidence?: AnchorEvidence[];
}

interface ThemesPayload {
  themes?: ThemeEntry[];
}

interface BulletsPayload {
  bullets_by_theme?: BulletsByTheme[];
}

interface Story {
  title?: string;
  theme_id?: string;
  situation?: string;
  task?: string;
  actions?: string[];
  results?: string[];
  evidence?: EvidenceRef[];
  confidence?: string;
}

interface StoriesPayload {
  stories?: Story[];
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
  next_year_goals?: (Bullet & { evidence?: EvidenceRef[] })[];
  performance_dimensions?: PerformanceDimension[];
}

interface SelfEvalPayload {
  sections?: SelfEvalSections;
}

export interface NarrativeViewProps {
  themes?: ThemesPayload;
  bullets?: BulletsPayload;
  stories?: StoriesPayload;
  self_eval?: SelfEvalPayload;
}

export function shortEvidenceLabel(id?: string): string {
  if (!id) return "ref";
  const hashIdx = id.indexOf("#");
  if (hashIdx === -1) return id;
  const fragment = id.slice(hashIdx + 1);
  return /^\d+$/.test(fragment) ? `PR #${fragment}` : `#${fragment}`;
}

function JsonBlock({ data, label }: { data: unknown; label: string }) {
  const text = JSON.stringify(data, null, 2);
  return (
    <div className="narrative-json">
      <div className="narrative-json-head">
        <span className="narrative-json-label">{label} JSON</span>
        <button
          type="button"
          className="generate-copy"
          onClick={() => navigator.clipboard.writeText(text)}
        >
          Copy
        </button>
      </div>
      <pre className="generate-pre">{text}</pre>
    </div>
  );
}

function ViewToggle({
  label,
  showJson,
  onToggle,
}: {
  label: string;
  showJson: boolean;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="narrative-toggle" onClick={onToggle}>
      {label}: show {showJson ? "Narrative" : "JSON"}
    </button>
  );
}

export default function NarrativeView({
  themes,
  bullets,
  stories,
  self_eval,
}: NarrativeViewProps) {
  const [themesJson, setThemesJson] = useState(false);
  const [bulletsJson, setBulletsJson] = useState(false);
  const [storiesJson, setStoriesJson] = useState(false);
  const [selfEvalJson, setSelfEvalJson] = useState(false);

  const byTheme = bullets?.bullets_by_theme ?? [];
  const themeMap = Object.fromEntries(
    (themes?.themes ?? []).map((t) => [t.theme_id, t.theme_name]),
  );

  return (
    <section className="narrative-section">
      {/* ── Themes ── */}
      <div className="narrative-block">
        <div className="narrative-block-head">
          <h3 className="narrative-heading">Themes</h3>
          {themes && (
            <ViewToggle
              label="Themes"
              showJson={themesJson}
              onToggle={() => setThemesJson((v) => !v)}
            />
          )}
        </div>
        {themesJson ? (
          <JsonBlock data={themes} label="Themes" />
        ) : (
          <ThemesNarrative themeList={themes?.themes ?? []} />
        )}
      </div>

      {/* ── Bullets ── */}
      <div className="narrative-block">
        <div className="narrative-block-head">
          <h3 className="narrative-heading">Bullets</h3>
          {bullets && (
            <ViewToggle
              label="Bullets"
              showJson={bulletsJson}
              onToggle={() => setBulletsJson((v) => !v)}
            />
          )}
        </div>
        {bulletsJson ? (
          <JsonBlock data={bullets} label="Bullets" />
        ) : (
          <BulletsNarrative themeMap={themeMap} byTheme={byTheme} />
        )}
      </div>

      {/* ── STAR stories ── */}
      <div className="narrative-block">
        <div className="narrative-block-head">
          <h3 className="narrative-heading">STAR stories</h3>
          {stories && (
            <ViewToggle
              label="STAR stories"
              showJson={storiesJson}
              onToggle={() => setStoriesJson((v) => !v)}
            />
          )}
        </div>
        {storiesJson ? (
          <JsonBlock data={stories} label="STAR stories" />
        ) : (
          <StoriesNarrative storyList={stories?.stories ?? []} />
        )}
      </div>

      {/* ── Self-eval ── */}
      <div className="narrative-block">
        <div className="narrative-block-head">
          <h3 className="narrative-heading">Self-eval sections</h3>
          {self_eval && (
            <ViewToggle
              label="Self-eval"
              showJson={selfEvalJson}
              onToggle={() => setSelfEvalJson((v) => !v)}
            />
          )}
        </div>
        {selfEvalJson ? (
          <JsonBlock data={self_eval} label="Self-eval" />
        ) : (
          <SelfEvalNarrative sections={self_eval?.sections} />
        )}
      </div>
    </section>
  );
}

function ThemesNarrative({ themeList }: { themeList: ThemeEntry[] }) {
  if (themeList.length === 0) {
    return <p className="narrative-empty">No themes yet.</p>;
  }
  return (
    <div className="narrative-card">
      {themeList.map((t) => (
        <div key={t.theme_id ?? t.theme_name ?? "unknown"} className="narrative-theme">
          <p className="narrative-theme-name">{t.theme_name ?? t.theme_id}</p>
          {t.one_liner && (
            <p className="narrative-theme-oneliner">{t.one_liner}</p>
          )}
          {t.why_it_matters && (
            <p className="narrative-theme-why">
              <strong>Why it matters:</strong> {t.why_it_matters}
            </p>
          )}
          {(t.confidence || t.notes_or_assumptions) && (
            <p className="narrative-theme-meta">
              {t.confidence && <span>Confidence: {t.confidence}</span>}
              {t.confidence && t.notes_or_assumptions && " · "}
              {t.notes_or_assumptions && (
                <span className="narrative-meta-notes">{t.notes_or_assumptions}</span>
              )}
            </p>
          )}
          {(t.anchor_evidence?.length ?? 0) > 0 && (
            <p className="narrative-theme-evidence">
              {(t.anchor_evidence ?? []).map((e) => (
                <a
                  key={e.id ?? e.url}
                  href={e.url}
                  className="evidence-tag"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {e.title ?? shortEvidenceLabel(e.id)}
                </a>
              ))}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function BulletsNarrative({
  themeMap,
  byTheme,
}: {
  themeMap: Record<string, string | undefined>;
  byTheme: BulletsByTheme[];
}) {
  if (byTheme.length === 0) {
    return <p className="narrative-empty">No impact bullets by theme yet.</p>;
  }
  return (
    <div className="narrative-card">
      {byTheme.map((group) => (
        <div key={group.theme_id ?? "unknown"} className="narrative-theme">
          <p className="narrative-theme-name">
            {themeMap[group.theme_id ?? ""] ?? group.theme_id}
          </p>
          {(group.bullets ?? []).map((b, i) => (
            <p key={i} className="narrative-bullet">
              {b.text}
              {(b.evidence ?? []).map((e) => (
                <a
                  key={e.id ?? e.url}
                  href={e.url}
                  className="evidence-tag"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {shortEvidenceLabel(e.id)}
                </a>
              ))}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

function EvidenceTags({ evidence }: { evidence?: EvidenceRef[] }) {
  if (!evidence?.length) return null;
  return (
    <span className="narrative-theme-evidence">
      {(evidence ?? []).map((e) => (
        <a
          key={e.id ?? e.url}
          href={e.url}
          className="evidence-tag"
          target="_blank"
          rel="noopener noreferrer"
        >
          {e.title ?? shortEvidenceLabel(e.id)}
        </a>
      ))}
    </span>
  );
}

function StoriesNarrative({ storyList }: { storyList: Story[] }) {
  if (storyList.length === 0) {
    return <p className="narrative-empty">No STAR stories yet.</p>;
  }
  return (
    <div className="narrative-card">
      {storyList.map((s, idx) => (
        <div key={s.title ?? idx} className="narrative-story">
          <p className="narrative-story-title">{s.title}</p>
          {s.situation && (
            <p className="narrative-story-field">
              <strong>Situation:</strong> {s.situation}
            </p>
          )}
          {s.task && (
            <p className="narrative-story-field">
              <strong>Task:</strong> {s.task}
            </p>
          )}
          {(s.actions?.length ?? 0) > 0 && (
            <div className="narrative-story-list">
              <strong>Actions:</strong>
              <ul>
                {(s.actions ?? []).map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </div>
          )}
          {(s.results?.length ?? 0) > 0 && (
            <div className="narrative-story-list">
              <strong>Results:</strong>
              <ul>
                {(s.results ?? []).map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          {(s.evidence?.length ?? 0) > 0 && (
            <p className="narrative-story-evidence">
              <EvidenceTags evidence={s.evidence} />
            </p>
          )}
          {s.confidence && (
            <p className="narrative-theme-meta">Confidence: {s.confidence}</p>
          )}
        </div>
      ))}
    </div>
  );
}

function SelfEvalNarrative({
  sections,
}: {
  sections?: SelfEvalSections;
}) {
  if (!sections) {
    return <p className="narrative-empty">No self-eval sections yet.</p>;
  }
  const hasAny =
    sections.summary?.text ||
    (sections.key_accomplishments?.length ?? 0) > 0 ||
    sections.how_i_worked?.text ||
    sections.growth?.text ||
    (sections.next_year_goals?.length ?? 0) > 0 ||
    (sections.performance_dimensions?.length ?? 0) > 0;
  if (!hasAny) {
    return <p className="narrative-empty">No self-eval sections yet.</p>;
  }

  return (
    <div className="narrative-card narrative-selfeval">
      {sections.summary?.text && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">Summary</p>
          <p className="narrative-selfeval-text">{sections.summary.text}</p>
          <EvidenceTags evidence={sections.summary.evidence} />
        </div>
      )}
      {(sections.key_accomplishments?.length ?? 0) > 0 && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">Key accomplishments</p>
          <ul className="narrative-selfeval-list">
            {(sections.key_accomplishments ?? []).map((item, i) => (
              <li key={i} className="narrative-bullet">
                {item.text}
                <EvidenceTags evidence={item.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {sections.how_i_worked?.text && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">How I worked</p>
          <p className="narrative-selfeval-text">{sections.how_i_worked.text}</p>
          <EvidenceTags evidence={sections.how_i_worked.evidence} />
        </div>
      )}
      {sections.growth?.text && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">Growth</p>
          <p className="narrative-selfeval-text">{sections.growth.text}</p>
          <EvidenceTags evidence={sections.growth.evidence} />
        </div>
      )}
      {(sections.performance_dimensions?.length ?? 0) > 0 && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">Performance dimensions</p>
          <ul className="narrative-selfeval-list">
            {(sections.performance_dimensions ?? []).map((dim, i) => (
              <li key={dim.id ?? i} className="narrative-bullet">
                <strong>{dim.name ?? dim.id}</strong>
                {dim.text && <> — {dim.text}</>}
                <EvidenceTags evidence={dim.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {(sections.next_year_goals?.length ?? 0) > 0 && (
        <div className="narrative-selfeval-section">
          <p className="narrative-selfeval-heading">Next year goals</p>
          <ul className="narrative-selfeval-list">
            {(sections.next_year_goals ?? []).map((g, i) => (
              <li key={i} className="narrative-bullet">
                {g.text}
                <EvidenceTags evidence={g.evidence} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
