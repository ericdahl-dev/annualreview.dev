// Marketing landing: hero, features, how-it-works, CTA. Sticky "Generate" bar after scrolling past hero.
import React, { useState, useEffect } from "react";
import "./Landing.css";
import { posthog } from "./posthog";

const SCROLL_Y_SHOW_STICKY_CTA = 400;

const FEATURES = [
  {
    icon: "◈",
    title: "Theme Clusters",
    desc: "Your scattered PRs distilled into 4–6 strategic themes a manager actually remembers.",
  },
  {
    icon: "▹",
    title: "Impact Bullets",
    desc: "XYZ-format bullets with scope, outcome, and a link to the PR that proves it.",
  },
  {
    icon: "☆",
    title: "STAR Stories",
    desc: "Ready-to-paste Situation/Task/Action/Result narratives for promotion packets.",
  },
  {
    icon: "⎋",
    title: "Self-eval Sections",
    desc: "Draft summary and self-eval sections for review forms. Every claim linked to a PR.",
  },
];

const SIGNALS = [
  "PR-linked output",
  "Markdown export",
  "CLI-friendly",
];

const TRUST_POINTS = [
  {
    title: "No hallucinated metrics",
    desc: "If we can't link it to a PR, it doesn't appear in your review.",
  },
  {
    title: "Flagged uncertainty",
    desc: 'Unproven impact is labeled "needs confirmation" so you stay credible.',
  },
  {
    title: "Your data, your machine",
    desc: "Runs locally or on your infra. Nothing stored, nothing shared.",
  },
];

const STEPS = [
  {
    verb: "Connect",
    detail:
      "Sign in with GitHub (public or private), or paste a token. CLI option keeps your token on your machine.",
  },
  {
    verb: "Fetch",
    detail:
      "Set your review date range and fetch your PRs and reviews in one click.",
  },
  {
    verb: "Generate",
    detail:
      "One click: themes, bullets, STAR stories, and self-eval sections—all evidence-linked. Optionally add your goals so the report is tailored to what you're being measured on.",
  },
  {
    verb: "Ship it",
    detail:
      "Copy sections or download the full report as Markdown. Done before lunch.",
  },
];

export default function Landing() {
  const [showStickyCta, setShowStickyCta] = useState(false);
  const authError =
    typeof window !== "undefined" &&
    new URLSearchParams(window.location.search).get("error") === "auth_failed";

  useEffect(() => {
    const onScroll = () =>
      setShowStickyCta(window.scrollY > SCROLL_Y_SHOW_STICKY_CTA);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="landing">
      <a href="#main-content" className="skip-link">
        Skip to content
      </a>
      {showStickyCta && (
        <div className="sticky-cta" role="banner">
          <div className="sticky-cta-inner">
            <span className="sticky-cta-text">
              Turn your GitHub activity into a review in 5 minutes.
            </span>
            <a
              href="/generate"
              className="btn btn-primary"
              onClick={() =>
                posthog?.capture("cta_clicked", { location: "sticky" })
              }
            >
              Generate my review <span className="btn-arrow">→</span>
            </a>
          </div>
        </div>
      )}
      {authError && (
        <div className="auth-error-banner" role="alert">
          <p>
            GitHub sign-in didn't complete. Try again from the Generate page, or
            check that your production URL is set as the callback URL in your
            GitHub OAuth app.
          </p>
          <a href="/">Dismiss</a>
        </div>
      )}
      <nav className="nav">
        <div className="nav-inner">
          <a href="/" className="nav-brand">
            <span className="nav-icon">⟡</span>
            <span>AnnualReview.dev</span>
          </a>
          <div className="nav-links">
            <a href="#features">Features</a>
            <a href="#how">How it works</a>
            <span className="nav-note">For developers</span>
            <a
              href="/generate"
              className="nav-cta"
              onClick={() =>
                posthog?.capture("cta_clicked", { location: "nav" })
              }
            >
              Get started
            </a>
          </div>
        </div>
      </nav>

      <main id="main-content">
        <section className="hero">
          <div className="hero-bg" aria-hidden="true" />
          <div className="container hero-grid">
            <div className="hero-copy">
              <p className="hero-kicker">GitHub → evidence → narrative</p>
              <h1 className="hero-title">
                Stop putting off
                <br />
                your self-review.
              </h1>
              <p className="hero-sub">
                You shipped all year. You shouldn't have to spend a week proving
                it. <strong>Free, no signup.</strong> Sign in with GitHub, use a
                token, or run the CLI. Get themes, bullets, STAR stories, and
                self-eval sections, with every claim linked to a real PR.
                Optionally add your annual goals so the report matches what
                you're being measured on.
              </p>
              <div className="hero-actions">
                <a
                  href="/generate"
                  className="btn btn-primary btn-lg"
                  onClick={() =>
                    posthog?.capture("cta_clicked", { location: "hero" })
                  }
                >
                  Generate my review
                  <span className="btn-arrow">→</span>
                </a>
                <a href="#how" className="hero-secondary-link">
                  See how it works
                </a>
              </div>
              <div className="hero-signals" aria-label="Key product traits">
                {SIGNALS.map((signal) => (
                  <span key={signal} className="hero-signal">
                    {signal}
                  </span>
                ))}
              </div>
            </div>
            <aside className="hero-panel" aria-label="Review output preview">
              <div className="hero-panel-top">
                <span className="hero-panel-label">Sample output</span>
                <span className="hero-panel-state">Evidence linked</span>
              </div>
              <div className="hero-panel-summary">
                <p className="hero-panel-kicker">What the app does</p>
                <h2 className="hero-panel-title">
                  Turns GitHub activity into review-ready output you can defend.
                </h2>
                <p className="hero-panel-desc">
                  Group related pull requests, shape them into clear bullets,
                  and keep uncertain impact explicitly labeled.
                </p>
              </div>
              <div className="hero-panel-stack">
                <div className="hero-panel-item">
                  <span className="hero-panel-item-label">Theme</span>
                  <p>Reliability work grouped into one readable theme.</p>
                </div>
                <div className="hero-panel-item">
                  <span className="hero-panel-item-label">Bullet</span>
                  <p>
                    Added retry logic to webhook delivery and linked the claim
                    to the PR that shipped it.
                  </p>
                </div>
                <div className="hero-panel-item hero-panel-item-warning">
                  <span className="hero-panel-item-label">Guardrail</span>
                  <p>Potential impact (needs confirmation)</p>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section className="proof-bar">
          <div className="container proof-bar-inner">
            <p className="proof-text">
              Free · No signup · Your data stays yours. Built for ICs, tech
              leads, and contractors who'd rather ship code than write about it.
            </p>
            <div className="proof-tags" aria-hidden="true">
              <span>PR links</span>
              <span>STAR stories</span>
              <span>Markdown export</span>
            </div>
          </div>
        </section>

        <section id="features" className="section">
          <div className="container">
            <p className="section-kicker">What you get</p>
            <h2 className="section-title">Four outputs. Zero guesswork.</h2>
            <div className="feature-layout">
              <div className="feature-intro">
                <p className="feature-intro-title">
                  Built for the awkward part of engineering work.
                </p>
                <p className="feature-intro-copy">
                  Annual reviews usually fail because the evidence is scattered
                  and the narrative gets written too late. This product keeps
                  the raw proof attached while making the final output usable.
                </p>
              </div>
              <div className="feature-grid">
                {FEATURES.map((f) => (
                  <div key={f.title} className="feature-card">
                    <span className="feature-icon">{f.icon}</span>
                    <h3 className="feature-name">{f.title}</h3>
                    <p className="feature-desc">{f.desc}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="section section-alt">
          <div className="container">
            <p className="section-kicker">The transformation</p>
            <h2 className="section-title">
              From commit log to career narrative
            </h2>
            <div className="compare-grid">
              <div className="compare-card compare-before">
                <span className="compare-label">Before</span>
                <div className="compare-body mono">
                  <p>fix: handle null user in auth middleware</p>
                  <p>feat: add retry logic to webhook dispatcher</p>
                  <p>chore: bump deps, fix lint warnings</p>
                  <p>refactor: extract billing service from monolith</p>
                  <p className="text-muted">…47 more commits</p>
                </div>
              </div>
              <div className="compare-card compare-after">
                <span className="compare-label">After</span>
                <div className="compare-body">
                  <p>
                    <strong>Platform Reliability</strong>
                  </p>
                  <p>
                    Hardened webhook delivery by adding retry logic with
                    exponential backoff and linked the claim to the PR that
                    shipped it.
                    <span className="evidence-tag">PR #412</span>
                  </p>
                  <p>
                    <strong>Architecture</strong>
                  </p>
                  <p>
                    Extracted billing service boundaries into a cleaner story a
                    manager can skim without reading a commit log.
                    <span className="evidence-tag">PR #389</span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="how" className="section">
          <div className="container process-layout">
            <div className="process-intro">
              <p className="section-kicker">4 steps, 5 minutes</p>
              <h2 className="section-title">How it works</h2>
              <p className="process-copy">
                The workflow stays simple on purpose: collect evidence once,
                then turn it into reusable review material instead of retyping
                the same story for every form.
              </p>
            </div>
            <ol className="steps">
              {STEPS.map((s, i) => (
                <li key={s.verb} className="step">
                  <span className="step-num">{i + 1}</span>
                  <div>
                    <strong className="step-verb">{s.verb}</strong>
                    <p className="step-detail">{s.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="section section-alt">
          <div className="container trust-layout">
            <div className="trust-lead">
              <p className="section-kicker">Why trust this</p>
              <h2 className="section-title">Evidence-only. Always.</h2>
              <p className="trust-copy">
                The app is opinionated about one thing: your annual review
                should be more credible after using it, not less.
              </p>
            </div>
            <div className="trust-grid">
              {TRUST_POINTS.map((item) => (
                <div key={item.title} className="trust-item">
                  <strong>{item.title}</strong>
                  <p>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="final-cta">
          <div className="container">
            <h2 className="final-cta-title">
              Review season is coming.
              <br />
              Be ready in 5 minutes.
            </h2>
            <a
              href="/generate"
              className="btn btn-primary btn-lg"
              onClick={() =>
                posthog?.capture("cta_clicked", { location: "final" })
              }
            >
              Generate my review
              <span className="btn-arrow">→</span>
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="container footer-inner">
          <a href="/" className="footer-brand">
            <span className="nav-icon">⟡</span> AnnualReview.dev
          </a>
          <p className="footer-sub">
            For engineers who ship more than they self-promote.{" "}
            <a href="/privacy.html">Privacy</a>
            {" · "}
            <a href="/terms.html">Terms</a>
            {" · "}
            <a
              href="https://github.com/Skeyelab/annualreview.com"
              target="_blank"
              rel="noopener noreferrer"
            >
              Open source
            </a>
            .
          </p>
        </div>
      </footer>
    </div>
  );
}
