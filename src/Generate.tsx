// Page: 1) Get GitHub data (OAuth or token or CLI), 2) Paste/upload evidence JSON, 3) Generate → themes, bullets, stories, self-eval.
import React, { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import "./Generate.css";
import { generateMarkdown } from "../lib/generate-markdown.js";
import type { Timeframe } from "../types/evidence.js";
import { posthog } from "./posthog";
import { useAuth } from "./hooks/useAuth";
import { useGitHubCollect } from "./hooks/useGitHubCollect";
import { useSnapshots } from "./hooks/useSnapshots";
import { useGenerateWorkspace } from "./workspaces/generate";
import CollectForm from "./CollectForm";
import NarrativeView, { type NarrativeViewProps } from "./NarrativeView";

const GITHUB_TOKEN_URL =
  "https://github.com/settings/tokens/new?scopes=repo&description=AnnualReview.dev";
const REPO_URL = "https://github.com/Skeyelab/annualreview.com";

/** e.g. "anthropic/claude-3.5-sonnet" → "Claude 3.5 Sonnet", "gpt-4o-mini" → "GPT 4o Mini" */
function formatModelName(id: string): string {
  const name = id.includes("/") ? id.split("/")[1] : id;
  const words = name.replace(/-/g, " ").split(/\s+/);
  return words
    .map((w) =>
      w.toLowerCase() === "gpt" ? "GPT" : w.toLowerCase() === "claude" ? "Claude" : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
    )
    .join(" ");
}

interface PipelineResultLike {
  themes?: unknown;
  bullets?: unknown;
  stories?: unknown;
  self_eval?: unknown;
}

export default function Generate() {
  const { user, authChecked, logout } = useAuth();
  const { saveSnapshot } = useSnapshots({ user });
  const ws = useGenerateWorkspace({ user, saveSnapshot });

  const onEvidenceReceived = useCallback(
    (text: string) => ws.setEvidenceTextClearingError(text),
    [ws]
  );

  const [dataTab, setDataTab] = useState<"app" | "token" | "terminal">("app");

  const {
    collectStart,
    setCollectStart,
    collectEnd,
    setCollectEnd,
    collectToken,
    setCollectToken,
    collectLoading,
    collectError,
    setCollectError,
    collectProgress,
    handleFetchGitHub,
  } = useGitHubCollect({ onEvidenceReceived });

  const handleLogout = () => {
    posthog?.capture("logout");
    logout();
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    ws.handleFile(e.target.files?.[0]);
  };

  const {
    payments: {
      enabled: paymentsEnabled,
      creditsPerPurchase,
      priceCents,
      freeModel,
      premiumModel,
    },
  } = ws;

  return (
    <div className="generate">
      <header className="generate-header">
        <a href="/" className="generate-logo">
          <span className="generate-logo-icon">⟡</span>
          AnnualReview.dev
        </a>
        <div className="generate-header-actions">
          {authChecked && user && (
            <span className="generate-signed-in">
              Signed in as <strong>{user.login}</strong>
              <button
                type="button"
                className="generate-logout"
                onClick={handleLogout}
              >
                Log out
              </button>
            </span>
          )}
          {authChecked && user && (
            <a href="/dashboard" className="generate-back" title="View saved snapshots">
              Snapshots
            </a>
          )}
          <a href="/" className="generate-back">
            ← Back
          </a>
        </div>
      </header>

      <main className="generate-main">
        <h1 className="generate-title">Generate review</h1>

        {ws.authError && (
          <div className="generate-error" role="alert">
            GitHub sign-in didn’t complete. For local dev, add this callback URL
            to your GitHub OAuth app:{" "}
            <code>
              {typeof window !== "undefined"
                ? `${window.location.origin}/api/auth/callback/github`
                : "http://localhost:5173/api/auth/callback/github"}
            </code>{" "}
            Then try again. Check the terminal for the failure reason.
          </div>
        )}

        <section
          className="generate-get-data"
          aria-labelledby="get-data-heading"
        >
          <h2 id="get-data-heading" className="generate-get-data-title">
            1. Get your GitHub data
          </h2>

          <div
            className="generate-get-data-tabs"
            role="tablist"
            aria-label="How to get data"
          >
            <button
              type="button"
              role="tab"
              aria-selected={dataTab === "app"}
              aria-controls="get-data-app-panel"
              id="get-data-app-tab"
              className={`generate-get-data-tab ${dataTab === "app" ? "generate-get-data-tab-active" : ""}`}
              onClick={() => setDataTab("app")}
            >
              {authChecked && user ? "Fetch your data" : "Sign in with GitHub"}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dataTab === "token"}
              aria-controls="get-data-token-panel"
              id="get-data-token-tab"
              className={`generate-get-data-tab ${dataTab === "token" ? "generate-get-data-tab-active" : ""}`}
              onClick={() => setDataTab("token")}
            >
              Paste a Personal Access Token
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={dataTab === "terminal"}
              aria-controls="get-data-terminal-panel"
              id="get-data-terminal-tab"
              className={`generate-get-data-tab ${dataTab === "terminal" ? "generate-get-data-tab-active" : ""}`}
              onClick={() => setDataTab("terminal")}
            >
              Use the terminal
            </button>
          </div>

          <div className="generate-get-data-panels">
            <div
              id="get-data-app-panel"
              role="tabpanel"
              aria-labelledby="get-data-app-tab"
              hidden={dataTab !== "app"}
              className="generate-option-card"
            >
              {authChecked && user ? (
                <>
                  <h3 className="generate-option-heading">Fetch your data</h3>
                  <p className="generate-option-desc">
                    Fetch your PRs and reviews for the date range.
                  </p>
                  <CollectForm
                    startDate={collectStart}
                    endDate={collectEnd}
                    onStartChange={setCollectStart}
                    onEndChange={setCollectEnd}
                    error={collectError}
                    progress={collectProgress}
                    loading={collectLoading}
                    onSubmit={() => handleFetchGitHub(user)}
                    submitLabel="Fetch my data"
                  />
                </>
              ) : (
                <>
                  <h3 className="generate-option-heading">
                    Sign in with GitHub
                  </h3>
                  <p className="generate-option-desc">
                    We fetch your PRs and reviews for the date range. We never
                    store your code.
                  </p>
                  <div className="generate-oauth-buttons">
                    <a
                      href="/api/auth/github?scope=public"
                      className="generate-oauth-btn"
                      onClick={() =>
                        posthog?.capture("login_started", { scope: "public" })
                      }
                    >
                      Connect (public repos only)
                    </a>
                    <a
                      href="/api/auth/github?scope=private"
                      className="generate-oauth-btn generate-oauth-btn-private"
                      onClick={() =>
                        posthog?.capture("login_started", {
                          scope: "private",
                        })
                      }
                    >
                      Connect (include private repos)
                    </a>
                  </div>
                </>
              )}
            </div>

            <div
              id="get-data-token-panel"
              role="tabpanel"
              aria-labelledby="get-data-token-tab"
              hidden={dataTab !== "token"}
              className="generate-option-card"
            >
              <h3 className="generate-option-heading">
                Paste a Personal Access Token
              </h3>
              <p className="generate-option-desc">
                Fetch your PRs and reviews for the date range. Your token is not
                stored.
              </p>
              <CollectForm
                startDate={collectStart}
                endDate={collectEnd}
                onStartChange={setCollectStart}
                onEndChange={setCollectEnd}
                error={collectError}
                progress={collectProgress}
                loading={collectLoading}
                onSubmit={() => handleFetchGitHub(null)}
                submitLabel="Fetch my data"
              >
                <input
                  type="password"
                  placeholder="Paste your GitHub token (ghp_... or gho_...)"
                  value={collectToken}
                  onChange={(e) => {
                    setCollectToken(e.target.value);
                    setCollectError(null);
                  }}
                  className="generate-collect-input"
                  autoComplete="off"
                />
              </CollectForm>
            </div>

            <div
              id="get-data-terminal-panel"
              role="tabpanel"
              aria-labelledby="get-data-terminal-tab"
              hidden={dataTab !== "terminal"}
              className="generate-option-card"
            >
              <h3 className="generate-option-heading">Use the terminal</h3>
              <p className="generate-option-desc">
                Run two commands. Your token stays on your machine.
              </p>
              <ol className="generate-steps-list">
                <li>
                  Create a token at{" "}
                  <a
                    href={GITHUB_TOKEN_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    github.com/settings/tokens
                  </a>{" "}
                  with <strong>repo</strong> scope.
                </li>
                <li>
                  From this repo (
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    clone it
                  </a>
                  ), run:
                  <pre className="generate-cmd">
                    {`GITHUB_TOKEN=ghp_your_token yarn collect --start ${collectStart} --end ${collectEnd} --output raw.json
yarn normalize --input raw.json --output evidence.json`}
                  </pre>
                </li>
                <li>
                  Upload <code>evidence.json</code> below or paste its
                  contents.
                </li>
              </ol>
            </div>
          </div>
        </section>

        <h2 className="generate-step-title">
          2. Paste or upload evidence
        </h2>
        <p className="generate-lead">
          Evidence JSON must include <code>timeframe</code> and{" "}
          <code>contributions</code>. After fetching above or from the CLI, paste
          or upload it here.
        </p>

        <div className="generate-input-row">
          <label className="generate-file-label">
            Upload evidence.json
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFileInput}
              className="generate-file-input"
            />
          </label>
          <button
            type="button"
            className="generate-sample-btn"
            onClick={() => void ws.loadSample()}
          >
            Try sample
          </button>
        </div>
        <textarea
          className="generate-textarea"
          placeholder='{"timeframe": {"start_date": "2025-01-01", "end_date": "2025-12-31"}, "contributions": [...]}'
          value={ws.evidenceText}
          onChange={(e) => {
            ws.setEvidenceText(e.target.value);
            ws.setError(null);
          }}
          rows={8}
          spellCheck={false}
        />
        <p className="generate-hint">
          On mobile, pasting long JSON can be cut off—use &quot;Upload
          evidence.json&quot; for large data.
        </p>

        <div className="generate-goals-section">
          <label
            htmlFor="generate-goals"
            className="generate-goals-label"
          >
            Annual goals{" "}
            <span className="generate-goals-optional">(optional)</span>
          </label>
          <textarea
            id="generate-goals"
            className="generate-textarea generate-goals-textarea"
            placeholder={
              "One goal per line, e.g.:\nImprove system reliability\nGrow as a technical leader\nShip the new onboarding flow"
            }
            value={ws.goals}
            onChange={(e) => ws.setGoals(e.target.value)}
            rows={4}
            spellCheck={false}
          />
          <p className="generate-hint">
            Enter one goal per line. Goals are used as context to align themes,
            bullets, and stories to what matters most to you.
          </p>
        </div>

        {authChecked && user && ws.evidenceText.trim() && (
          <div className="generate-snapshot-section">
            <h2 className="generate-step-title generate-snapshot-title">
              Save as snapshot{" "}
              <span className="generate-goals-optional">(optional)</span>
            </h2>
            <p className="generate-lead">
              Save this date range as a periodic snapshot to track contributions over time.
              Merge snapshots on the{" "}
              <a href="/dashboard">Dashboard</a> to generate a rolled-up annual review.
            </p>
            <div className="generate-snapshot-row">
              <select
                className="generate-collect-input generate-snapshot-period"
                value={ws.snapshotPeriod}
                onChange={(e) => ws.setSnapshotPeriod(e.target.value as typeof ws.snapshotPeriod)}
                aria-label="Snapshot period"
              >
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom</option>
              </select>
              <input
                type="text"
                className="generate-collect-input generate-snapshot-label-input"
                placeholder="Label (optional, e.g. Q1 2025)"
                value={ws.snapshotLabel}
                onChange={(e) => ws.setSnapshotLabel(e.target.value)}
                aria-label="Snapshot label"
              />
              <button
                type="button"
                className="generate-collect-btn generate-snapshot-btn"
                onClick={() => void ws.saveSnapshot()}
                disabled={ws.snapshotSaving}
              >
                {ws.snapshotSaving ? "Saving…" : "Save snapshot"}
              </button>
            </div>
            {ws.snapshotError && <p className="generate-error">{ws.snapshotError}</p>}
            {ws.snapshotSaved && (
              <p className="generate-snapshot-saved">
                ✓ Snapshot saved.{" "}
                <a href="/dashboard">View all snapshots →</a>
              </p>
            )}
          </div>
        )}

        {ws.error && <p className="generate-error">{ws.error}</p>}

        <div className="generate-actions" aria-busy={ws.loading}>
          {ws.loading ? (
            <div className="generate-actions-progress">
              <div
                className="generate-progress-bar"
                role="progressbar"
                aria-label="Generating review"
                aria-valuetext={ws.progress || undefined}
              />
              {ws.progress && <p className="generate-progress">{ws.progress}</p>}
            </div>
          ) : (
            <div className="generate-actions-buttons">
              <button
                type="button"
                className="generate-btn"
                onClick={() => void ws.generate()}
              >
                <span className="generate-btn-inner">
                  <span>{paymentsEnabled ? "3. Generate review (free)" : "3. Generate review"}</span>
                  {freeModel && <span className="generate-btn-model">{formatModelName(freeModel)}</span>}
                </span>
              </button>
              {paymentsEnabled && (
                ws.premiumCredits !== null && ws.premiumCredits > 0 ? (
                  <button
                    type="button"
                    className="generate-btn generate-btn-premium"
                    onClick={ws.usePremiumCredit}
                    title={`Uses ${premiumModel ? formatModelName(premiumModel) : "premium"} model`}
                  >
                    <span className="generate-btn-inner">
                      <span>✦ Generate premium report</span>
                      {premiumModel && <span className="generate-btn-model">{formatModelName(premiumModel)}</span>}
                      <span className="generate-btn-credits">{ws.premiumCredits} credit{ws.premiumCredits !== 1 ? "s" : ""} left</span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="generate-btn generate-btn-premium"
                    onClick={() => void ws.upgradeToPremium()}
                    title={`${creditsPerPurchase} credits for $${(priceCents / 100).toFixed(2)} (1 run = 1 credit). Uses ${premiumModel ? formatModelName(premiumModel) : "premium"} model.`}
                  >
                    <span className="generate-btn-inner">
                      <span>✦ Upgrade to premium — {creditsPerPurchase} credits for ${(priceCents / 100).toFixed(2)}</span>
                      {premiumModel && <span className="generate-btn-model">{formatModelName(premiumModel)}</span>}
                    </span>
                  </button>
                )
              )}
            </div>
          )}
        </div>

        {ws.result && (
          <div className="generate-result">
            <h2>
              Your review
              {ws.isPremiumResult && (
                <span className="generate-premium-badge">✦ Premium</span>
              )}
            </h2>
            <NarrativeView {...(ws.result as NarrativeViewProps)} />
            <ReportSection
              result={ws.result}
              evidenceText={ws.evidenceText}
              onDownload={ws.downloadReport}
            />
          </div>
        )}
      </main>
    </div>
  );
}

interface ReportSectionProps {
  result: PipelineResultLike;
  evidenceText: string;
  onDownload: () => void;
}

/** Markdown report section: preview + download. */
function ReportSection({
  result,
  evidenceText,
  onDownload,
}: ReportSectionProps) {
  let timeframe: Timeframe | undefined;
  try {
    const ev = JSON.parse(evidenceText) as { timeframe?: Timeframe };
    timeframe = ev.timeframe;
  } catch {
    // no timeframe
  }
  const md = generateMarkdown(
    result as Parameters<typeof generateMarkdown>[0],
    { timeframe }
  );
  return (
    <section className="generate-section generate-report-section">
      <div className="generate-section-head">
        <h3>Markdown report</h3>
        <div className="generate-report-actions">
          <button
            type="button"
            className="generate-copy"
            onClick={() => navigator.clipboard.writeText(md)}
          >
            Copy
          </button>
          <button
            type="button"
            className="generate-download-btn"
            onClick={onDownload}
          >
            Download .md
          </button>
        </div>
      </div>
      <div className="generate-report-rendered">
        <ReactMarkdown>{md}</ReactMarkdown>
      </div>
    </section>
  );
}
