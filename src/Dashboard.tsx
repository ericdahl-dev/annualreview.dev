// Dashboard: shows the periodic contribution tracking hierarchy (daily → weekly → monthly).
import React, { useState, useCallback } from "react";
import "./Dashboard.css";
import { posthog } from "./posthog";
import { useAuth } from "./hooks/useAuth";
import { usePeriodic } from "./hooks/usePeriodic";
import type { PeriodicSummary } from "./hooks/usePeriodic";

function formatDate(iso: string): string {
  try {
    return new Date(iso + "T12:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatMonth(yyyyMM: string): string {
  try {
    return new Date(yyyyMM + "-01T12:00:00Z").toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
    });
  } catch {
    return yyyyMM;
  }
}

type SummaryJson = {
  headline?: string;
  bullets?: Array<{ text: string }>;
  themes?: Array<{ name: string; summary: string }>;
  top_accomplishments?: Array<{ text: string }>;
  highlights?: Array<{ text: string }>;
  momentum?: string;
};

function getHeadline(s: PeriodicSummary): string {
  const j = s.summary as SummaryJson | undefined;
  return j?.headline ?? `${s.period_key}`;
}

function getLabel(s: PeriodicSummary): string {
  if (s.period_type === "daily") return formatDate(s.period_key);
  if (s.period_type === "weekly") return `Week of ${formatDate(s.start_date)}`;
  if (s.period_type === "monthly") return formatMonth(s.period_key);
  return s.period_key;
}

const PERIOD_COLORS: Record<string, string> = {
  daily: "var(--accent)",
  weekly: "#7c9ef0",
  monthly: "#c97ef5",
};

interface SummaryCardProps {
  summary: PeriodicSummary;
  onDelete: (id: string) => void;
  deleting: boolean;
}

function SummaryCard({ summary, onDelete, deleting }: SummaryCardProps) {
  const [expanded, setExpanded] = useState(false);
  const j = summary.summary as SummaryJson | undefined;

  const bulletItems = j?.bullets?.slice(0, 5) ?? [];
  const themeItems = j?.themes?.slice(0, 3) ?? [];
  const accomplishments = j?.top_accomplishments?.slice(0, 3) ?? [];
  const highlights = j?.highlights?.slice(0, 3) ?? [];

  const previewItems =
    summary.period_type === "daily" ? bulletItems :
    summary.period_type === "weekly" ? highlights :
    accomplishments;

  return (
    <div className="dashboard-snapshot-card">
      <div className="dashboard-snapshot-info">
        <div className="dashboard-snapshot-top">
          <span
            className="dashboard-snapshot-period"
            style={{ background: `${PERIOD_COLORS[summary.period_type]}20`, color: PERIOD_COLORS[summary.period_type], borderColor: `${PERIOD_COLORS[summary.period_type]}40` }}
          >
            {summary.period_type}
          </span>
          <span className="dashboard-snapshot-label">{getLabel(summary)}</span>
        </div>
        <div className="dashboard-snapshot-meta">
          <span>{summary.contribution_count} contribution{summary.contribution_count !== 1 ? "s" : ""}</span>
          {j?.momentum && (
            <span title="Activity trend">
              {j.momentum === "increasing" ? "↑" : j.momentum === "decreasing" ? "↓" : "→"} {j.momentum}
            </span>
          )}
        </div>
        {getHeadline(summary) && (
          <p className="dashboard-summary-headline">{getHeadline(summary)}</p>
        )}
        {expanded && previewItems.length > 0 && (
          <ul className="dashboard-summary-bullets">
            {previewItems.map((item, i) => (
              <li key={i}>{item.text}</li>
            ))}
          </ul>
        )}
        {expanded && themeItems.length > 0 && summary.period_type !== "daily" && (
          <ul className="dashboard-summary-bullets">
            {themeItems.map((t, i) => (
              <li key={i}><strong>{t.name}</strong> — {t.summary}</li>
            ))}
          </ul>
        )}
        {(previewItems.length > 0 || themeItems.length > 0) && (
          <button
            type="button"
            className="dashboard-btn dashboard-btn-ghost dashboard-expand-btn"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? "▲ Hide details" : "▼ Show details"}
          </button>
        )}
      </div>
      <div className="dashboard-snapshot-actions">
        <button
          type="button"
          className="dashboard-btn dashboard-btn-danger"
          onClick={() => onDelete(summary.id)}
          disabled={deleting}
          title="Delete"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

interface SectionProps {
  title: string;
  count: number;
  action?: React.ReactNode;
  children: React.ReactNode;
  color?: string;
}

function Section({ title, count, action, children, color }: SectionProps) {
  return (
    <div className="dashboard-section">
      <div className="dashboard-section-header">
        <h2 className="dashboard-section-title" style={color ? { color } : undefined}>
          {title}
          <span className="dashboard-section-count">{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </div>
  );
}

export default function Dashboard() {
  const { user, authChecked, logout } = useAuth();
  const {
    dailies,
    weeklies,
    monthlies,
    loading,
    error,
    collectDay,
    rollupWeek,
    rollupMonth,
    deleteSummary,
  } = usePeriodic({ user });

  const [collecting, setCollecting] = useState(false);
  const [rollingWeek, setRollingWeek] = useState(false);
  const [rollingMonth, setRollingMonth] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const handleLogout = () => {
    posthog?.capture("logout");
    logout();
  };

  const flash = (msg: string) => {
    setActionMsg(msg);
    setTimeout(() => setActionMsg(null), 4000);
  };

  const flashErr = (msg: string) => {
    setActionErr(msg);
    setTimeout(() => setActionErr(null), 8000);
  };

  const handleCollectToday = async () => {
    setCollecting(true);
    setActionErr(null);
    const result = await collectDay();
    setCollecting(false);
    if (result) {
      posthog?.capture("periodic_collect_day");
      flash(`✓ Collected ${result.contribution_count} contribution${result.contribution_count !== 1 ? "s" : ""} for today`);
    } else {
      flashErr(error ?? "Failed to collect today's data");
    }
  };

  const handleRollupWeek = async () => {
    setRollingWeek(true);
    setActionErr(null);
    const result = await rollupWeek();
    setRollingWeek(false);
    if (result) {
      posthog?.capture("periodic_rollup_week");
      flash(`✓ Weekly rollup created from ${result.days_covered ?? 0} day${(result.days_covered ?? 0) !== 1 ? "s" : ""}`);
    } else {
      flashErr(error ?? "Failed to roll up week — make sure you have daily summaries for this week");
    }
  };

  const handleRollupMonth = async () => {
    setRollingMonth(true);
    setActionErr(null);
    const result = await rollupMonth();
    setRollingMonth(false);
    if (result) {
      posthog?.capture("periodic_rollup_month");
      flash(`✓ Monthly rollup created from ${result.weeks_covered ?? 0} week${(result.weeks_covered ?? 0) !== 1 ? "s" : ""}`);
    } else {
      flashErr(error ?? "Failed to roll up month — make sure you have weekly summaries for this month");
    }
  };

  const handleDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this summary?")) return;
      setDeleting(id);
      await deleteSummary(id);
      setDeleting(null);
      posthog?.capture("periodic_summary_deleted");
    },
    [deleteSummary]
  );

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <a href="/" className="dashboard-logo">
          <span className="dashboard-logo-icon">⟡</span>
          AnnualReview.dev
        </a>
        <div className="dashboard-header-actions">
          {authChecked && user && (
            <span className="dashboard-signed-in">
              Signed in as <strong>{user.login}</strong>
              <button
                type="button"
                className="dashboard-logout"
                onClick={handleLogout}
              >
                Log out
              </button>
            </span>
          )}
          <a href="/generate" className="dashboard-btn dashboard-btn-ghost">
            ← Generate
          </a>
        </div>
      </header>

      <main className="dashboard-content">
        <h1 className="dashboard-title">Contribution Tracking</h1>
        <p className="dashboard-subtitle">
          Each day's contributions are collected and summarised by AI. Those daily
          summaries roll up into weekly rollups, and weeklies roll up into monthly
          summaries — giving you an always-current picture of your work to feed into
          an annual review.
        </p>

        {!authChecked ? null : !user ? (
          <div className="dashboard-auth-gate">
            <p>Sign in with GitHub to start tracking your contributions.</p>
            <a href="/generate" className="dashboard-btn dashboard-btn-primary">
              Go to Generate
            </a>
          </div>
        ) : (
          <>
            {/* Action bar */}
            <div className="dashboard-action-bar">
              <button
                type="button"
                className="dashboard-btn dashboard-btn-primary"
                onClick={handleCollectToday}
                disabled={collecting}
                title="Fetch today's contributions and generate an AI daily summary"
              >
                {collecting ? "Collecting…" : "⬇ Collect today"}
              </button>
              <button
                type="button"
                className="dashboard-btn dashboard-btn-ghost"
                onClick={handleRollupWeek}
                disabled={rollingWeek}
                title="Roll up this week's daily summaries into a weekly AI summary"
              >
                {rollingWeek ? "Rolling up…" : "⤴ Roll up this week"}
              </button>
              <button
                type="button"
                className="dashboard-btn dashboard-btn-ghost"
                onClick={handleRollupMonth}
                disabled={rollingMonth}
                title="Roll up this month's weekly summaries into a monthly AI summary"
              >
                {rollingMonth ? "Rolling up…" : "⤴ Roll up this month"}
              </button>
              <a
                href="/generate"
                className="dashboard-btn dashboard-btn-ghost"
                title="Use collected snapshots to generate a full annual review"
              >
                ✦ Generate review
              </a>
            </div>

            {actionMsg && <div className="dashboard-action-success">{actionMsg}</div>}
            {actionErr && <div className="dashboard-error">{actionErr}</div>}
            {error && !actionErr && <div className="dashboard-error">{error}</div>}

            {loading ? (
              <div className="dashboard-loading">Loading summaries…</div>
            ) : (
              <>
                {/* Monthly */}
                <Section
                  title="Monthly summaries"
                  count={monthlies.length}
                  color={PERIOD_COLORS.monthly}
                  action={
                    <span className="dashboard-section-hint">
                      Roll up weeklies → monthly AI summary
                    </span>
                  }
                >
                  {monthlies.length === 0 ? (
                    <div className="dashboard-empty">
                      No monthly summaries yet. Roll up a month's worth of weekly summaries to create one.
                    </div>
                  ) : (
                    <div className="dashboard-snapshot-list">
                      {monthlies.map((s) => (
                        <SummaryCard
                          key={s.id}
                          summary={s}
                          onDelete={handleDelete}
                          deleting={deleting === s.id}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                {/* Weekly */}
                <Section
                  title="Weekly summaries"
                  count={weeklies.length}
                  color={PERIOD_COLORS.weekly}
                  action={
                    <span className="dashboard-section-hint">
                      Roll up dailies → weekly AI summary
                    </span>
                  }
                >
                  {weeklies.length === 0 ? (
                    <div className="dashboard-empty">
                      No weekly summaries yet. Once you have daily summaries for a week, roll them up.
                    </div>
                  ) : (
                    <div className="dashboard-snapshot-list">
                      {weeklies.map((s) => (
                        <SummaryCard
                          key={s.id}
                          summary={s}
                          onDelete={handleDelete}
                          deleting={deleting === s.id}
                        />
                      ))}
                    </div>
                  )}
                </Section>

                {/* Daily */}
                <Section
                  title="Daily summaries"
                  count={dailies.length}
                  color={PERIOD_COLORS.daily}
                  action={
                    <span className="dashboard-section-hint">
                      Collect today → AI daily summary
                    </span>
                  }
                >
                  {dailies.length === 0 ? (
                    <div className="dashboard-empty">
                      No daily summaries yet.{" "}
                      Click <strong>Collect today</strong> to fetch today's GitHub contributions
                      and generate a brief AI summary.
                    </div>
                  ) : (
                    <div className="dashboard-snapshot-list">
                      {dailies.map((s) => (
                        <SummaryCard
                          key={s.id}
                          summary={s}
                          onDelete={handleDelete}
                          deleting={deleting === s.id}
                        />
                      ))}
                    </div>
                  )}
                </Section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
