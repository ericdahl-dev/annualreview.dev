// Page: 1) Get GitHub data (OAuth or token or CLI), 2) Paste/upload evidence JSON, 3) Generate → themes, bullets, stories, self-eval.
import React, { useState, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import "./Generate.css";
import { generateMarkdown } from "../lib/generate-markdown.js";
import type { Timeframe } from "../types/evidence.js";
import { posthog } from "./posthog";
import { parseJsonResponse, pollJob } from "./api.js";
import { useAuth } from "./hooks/useAuth";
import { useGitHubCollect } from "./hooks/useGitHubCollect";
import CollectForm from "./CollectForm";
import NarrativeView, { type NarrativeViewProps } from "./NarrativeView";
import { PAYMENTS_NOT_CONFIGURED } from "../lib/api-error-codes.js";

/** Milliseconds to wait for React state to settle before auto-generating after Stripe redirect. */
const STRIPE_RETURN_DELAY_MS = 100;

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
  const [evidenceText, setEvidenceText] = useState("");
  const [goals, setGoals] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<PipelineResultLike | null>(null);
  const [isPremiumResult, setIsPremiumResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentsEnabled, setPaymentsEnabled] = useState(false);
  const [creditsPerPurchase, setCreditsPerPurchase] = useState(5);
  const [priceCents, setPriceCents] = useState(100);
  const [freeModel, setFreeModel] = useState<string>("");
  const [premiumModel, setPremiumModel] = useState<string>("");
  /** Credits remaining for the stored Stripe session ID, or null if unknown. */
  const [premiumCredits, setPremiumCredits] = useState<number | null>(null);

  const onEvidenceReceived = useCallback((text: string) => {
    setEvidenceText(text);
    setError(null);
  }, []);

  const [dataTab, setDataTab] = useState<"app" | "token" | "terminal">("app");
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth_failed") {
      setAuthError(true);
      window.history.replaceState({}, "", window.location.pathname);
    }
    // After returning from Stripe, persist session ID to localStorage for reuse across sessions.
    const sessionId = params.get("session_id");
    const isPremium = params.get("premium") === "1";
    if (sessionId && isPremium) {
      window.history.replaceState({}, "", window.location.pathname);
      try { localStorage.setItem("premium_stripe_session_id", sessionId); } catch { /* ignore */ }
      // Also store in sessionStorage so the post-redirect auto-generate effect picks it up.
      try { sessionStorage.setItem("stripe_session_id", sessionId); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    fetch("/api/payments/config")
      .then((res) => (res.ok ? res.json() : { enabled: false }))
      .then((data: {
        enabled?: boolean;
        credits_per_purchase?: number;
        price_cents?: number;
        free_model?: string;
        premium_model?: string;
      }) => {
        setPaymentsEnabled(!!data.enabled);
        if (data.credits_per_purchase != null) setCreditsPerPurchase(data.credits_per_purchase);
        if (data.price_cents != null) setPriceCents(data.price_cents);
        if (data.free_model) setFreeModel(data.free_model);
        if (data.premium_model) setPremiumModel(data.premium_model);
      })
      .catch(() => setPaymentsEnabled(false));
  }, []);

  // Fetch remaining credits when payments are enabled and user is logged in (session cookie identifies user)
  useEffect(() => {
    if (!paymentsEnabled || !user) return;
    fetch("/api/payments/credits", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : { credits: 0 }))
      .then((data: { credits?: number }) => setPremiumCredits(data.credits ?? 0))
      .catch(() => setPremiumCredits(0));
  }, [paymentsEnabled, user]);

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

  useEffect(() => {
    if (!user) return;
    fetch("/api/jobs", { credentials: "include" })
      .then((res) => (res.ok ? res.json() : {}))
      .then((data: { latest?: { status?: string; result?: unknown } }) => {
        const job = data.latest;
        if (job?.status === "done" && job.result) {
          setEvidenceText(JSON.stringify(job.result, null, 2));
          setError(null);
        }
      })
      .catch(() => {});
  }, [user]);

  const handleGenerate = async (
    stripeSessionId?: string,
    evidenceOverride?: string,
    goalsOverride?: string
  ) => {
    const textToUse = evidenceOverride ?? evidenceText;
    const goalsToUse = goalsOverride ?? goals;
    let evidence: Record<string, unknown>;
    try {
      evidence = JSON.parse(textToUse) as Record<string, unknown>;
    } catch {
      const looksTruncated =
        /[\{\[,]\s*$/.test(textToUse.trim()) ||
        !textToUse.includes('"contributions"');
      setError(
        looksTruncated
          ? 'Invalid JSON—looks truncated (e.g. missing contributions or closing brackets). Try "Upload evidence.json" instead of pasting, or paste the full file again.'
          : "Invalid JSON. Paste or upload a valid evidence.json."
      );
      return;
    }
    const tf = evidence.timeframe as { start_date?: string; end_date?: string } | undefined;
    if (
      !tf?.start_date ||
      !tf?.end_date ||
      !Array.isArray(evidence.contributions)
    ) {
      setError(
        "Evidence must have timeframe.start_date, timeframe.end_date, and contributions array."
      );
      return;
    }
    if (
      (goalsToUse as string).trim() &&
      !(evidence as { goals?: string }).goals
    ) {
      evidence = { ...evidence, goals: (goalsToUse as string).trim() };
    }
    if (stripeSessionId) {
      evidence = { ...evidence, _stripe_session_id: stripeSessionId };
    }
    setError(null);
    setLoading(true);
    setResult(null);
    setIsPremiumResult(false);
    setProgress("");
    posthog?.capture("review_generate_started", { premium: !!stripeSessionId });
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(evidence),
      });
      const data = (await parseJsonResponse(res)) as {
        job_id?: string;
        premium?: boolean;
        error?: string;
        [key: string]: unknown;
      };
      if (res.status === 202 && data.job_id) {
        const out = await pollJob(data.job_id, setProgress);
        setResult(out as PipelineResultLike);
        setIsPremiumResult(!!data.premium);
        // Update displayed credit count if the server returned updated remaining credits
        if (typeof data.credits_remaining === "number") {
          setPremiumCredits(data.credits_remaining);
        }
        posthog?.capture("review_generate_completed", { premium: !!data.premium });
      } else if (!res.ok) {
        if ((data as { code?: string }).code === PAYMENTS_NOT_CONFIGURED) {
          throw new Error("Premium generation is not available in this environment. Please use the free tier.");
        }
        throw new Error((data.error as string) || "Generate failed");
      } else {
        setResult(data as PipelineResultLike);
        posthog?.capture("review_generate_completed");
      }
    } catch (e) {
      const err = e as Error;
      posthog?.capture("review_generate_failed", { error: err.message });
      setError(err.message || "Pipeline failed. Is OPENROUTER_API_KEY set?");
    } finally {
      setLoading(false);
      setProgress("");
    }
  };

  const handleUsePremiumCredit = () => {
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem("premium_stripe_session_id"); } catch { /* ignore */ }
    if (!sessionId) return;
    handleGenerate(sessionId);
  };

  const handleUpgradeToPremium = async () => {
    // Check we have valid evidence before redirecting to payment
    try {
      const ev = JSON.parse(evidenceText) as Record<string, unknown>;
      const tf = ev.timeframe as { start_date?: string; end_date?: string } | undefined;
      if (!tf?.start_date || !tf?.end_date || !Array.isArray(ev.contributions)) {
        setError("Please load your evidence data first, then upgrade.");
        return;
      }
    } catch {
      setError("Please load your evidence data first, then upgrade.");
      return;
    }
    setError(null);
    // Save evidence so it survives the Stripe redirect
    try {
      sessionStorage.setItem("premium_evidence", evidenceText);
      if (goals.trim()) sessionStorage.setItem("premium_goals", goals);
    } catch {
      // sessionStorage not available (unlikely in browser, ignore)
    }
    try {
      const res = await fetch("/api/payments/checkout", { method: "POST" });
      const data = (await parseJsonResponse(res)) as { url?: string; error?: string };
      if (!res.ok || !data.url) {
        throw new Error(data.error || "Could not start checkout");
      }
      posthog?.capture("premium_checkout_started");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message || "Payment service unavailable. Try again later.");
    }
  };

  // After returning from Stripe, restore evidence and auto-generate premium report
  useEffect(() => {
    let savedSessionId: string | null = null;
    try { savedSessionId = sessionStorage.getItem("stripe_session_id"); } catch { /* ignore */ }
    if (!savedSessionId) return;
    try { sessionStorage.removeItem("stripe_session_id"); } catch { /* ignore */ }
    let savedEvidence: string | null = null;
    let savedGoals: string | null = null;
    try { savedEvidence = sessionStorage.getItem("premium_evidence"); } catch { /* ignore */ }
    try { savedGoals = sessionStorage.getItem("premium_goals"); } catch { /* ignore */ }
    if (savedEvidence) {
      try { sessionStorage.removeItem("premium_evidence"); } catch { /* ignore */ }
      setEvidenceText(savedEvidence);
    }
    if (savedGoals) {
      try { sessionStorage.removeItem("premium_goals"); } catch { /* ignore */ }
      setGoals(savedGoals);
    }
    if (savedEvidence) {
      // Use saved evidence/goals directly; state updates are async and may not be visible yet
      const timer = setTimeout(
        () => handleGenerate(savedSessionId!, savedEvidence!, savedGoals ?? undefined),
        STRIPE_RETURN_DELAY_MS
      );
      return () => clearTimeout(timer);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setEvidenceText(r.result as string);
      setError(null);
    };
    r.readAsText(file);
  };

  const loadSample = async () => {
    try {
      const base = (import.meta.env.BASE_URL || "/").replace(/\/?$/, "/");
      const res = await fetch(`${base}sample-evidence.json`);
      if (!res.ok) throw new Error(`Sample not found (${res.status})`);
      const data = await parseJsonResponse(res);
      setEvidenceText(JSON.stringify(data, null, 2));
      setError(null);
    } catch (e) {
      setError((e as Error).message || "Could not load sample.");
    }
  };

  const handleLogout = () => {
    posthog?.capture("logout");
    logout();
  };

  const handleDownloadReport = () => {
    let timeframe: Timeframe | undefined;
    try {
      const ev = JSON.parse(evidenceText) as { timeframe?: Timeframe };
      timeframe = ev.timeframe;
    } catch {
      // no timeframe available
    }
    const md = generateMarkdown(
      result as Parameters<typeof generateMarkdown>[0],
      { timeframe }
    );
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "annual-review-report.md";
    a.click();
    URL.revokeObjectURL(url);
  };

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
          <a href="/" className="generate-back">
            ← Back
          </a>
        </div>
      </header>

      <main className="generate-main">
        <h1 className="generate-title">Generate review</h1>

        {authError && (
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
              onChange={handleFile}
              className="generate-file-input"
            />
          </label>
          <button
            type="button"
            className="generate-sample-btn"
            onClick={loadSample}
          >
            Try sample
          </button>
        </div>
        <textarea
          className="generate-textarea"
          placeholder='{"timeframe": {"start_date": "2025-01-01", "end_date": "2025-12-31"}, "contributions": [...]}'
          value={evidenceText}
          onChange={(e) => {
            setEvidenceText(e.target.value);
            setError(null);
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
            value={goals}
            onChange={(e) => setGoals(e.target.value)}
            rows={4}
            spellCheck={false}
          />
          <p className="generate-hint">
            Enter one goal per line. Goals are used as context to align themes,
            bullets, and stories to what matters most to you.
          </p>
        </div>

        {error && <p className="generate-error">{error}</p>}

        <div className="generate-actions" aria-busy={loading}>
          {loading ? (
            <div className="generate-actions-progress">
              <div
                className="generate-progress-bar"
                role="progressbar"
                aria-label="Generating review"
                aria-valuetext={progress || undefined}
              />
              {progress && <p className="generate-progress">{progress}</p>}
            </div>
          ) : (
            <div className="generate-actions-buttons">
              <button
                type="button"
                className="generate-btn"
                onClick={() => handleGenerate()}
              >
                <span className="generate-btn-inner">
                  <span>{paymentsEnabled ? "3. Generate review (free)" : "3. Generate review"}</span>
                  {freeModel && <span className="generate-btn-model">{formatModelName(freeModel)}</span>}
                </span>
              </button>
              {paymentsEnabled && (
                premiumCredits !== null && premiumCredits > 0 ? (
                  <button
                    type="button"
                    className="generate-btn generate-btn-premium"
                    onClick={handleUsePremiumCredit}
                    title={`Uses ${premiumModel ? formatModelName(premiumModel) : "premium"} model`}
                  >
                    <span className="generate-btn-inner">
                      <span>✦ Generate premium report</span>
                      {premiumModel && <span className="generate-btn-model">{formatModelName(premiumModel)}</span>}
                      <span className="generate-btn-credits">{premiumCredits} credit{premiumCredits !== 1 ? "s" : ""} left</span>
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    className="generate-btn generate-btn-premium"
                    onClick={handleUpgradeToPremium}
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

        {result && (
          <div className="generate-result">
            <h2>
              Your review
              {isPremiumResult && (
                <span className="generate-premium-badge">✦ Premium</span>
              )}
            </h2>
            <NarrativeView {...(result as NarrativeViewProps)} />
            <ReportSection
              result={result}
              evidenceText={evidenceText}
              onDownload={handleDownloadReport}
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
