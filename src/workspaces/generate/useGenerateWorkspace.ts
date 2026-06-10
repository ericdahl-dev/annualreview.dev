import { useState, useEffect, useCallback } from "react";
import { generateMarkdown } from "../../../lib/generate-markdown.js";
import type { Timeframe } from "../../../types/evidence.js";
import { parseJsonResponse, pollJob } from "../../api.js";
import type { AuthUser } from "../../hooks/useAuth.js";
import type { SnapshotPeriod } from "../../hooks/useSnapshots.js";
import { posthog } from "../../posthog";
import {
  fetchLatestJobEvidence,
  fetchPaymentsConfig,
  fetchPremiumCredits,
  fetchSnapshotEvidence,
  getPremiumStripeSessionId,
  runGenerate,
  runPremiumCheckout,
  runSaveSnapshot,
} from "./commands.js";
import { parseUrlRecovery, recoverStripeAutoGenerate } from "./recovery.js";
import type { PaymentsConfig, PipelineResult } from "./types.js";

/** Milliseconds to wait for React state to settle before auto-generating after Stripe redirect. */
export const STRIPE_RETURN_DELAY_MS = 100;

interface UseGenerateWorkspaceOptions {
  user: AuthUser | null;
  saveSnapshot: (opts: {
    period: SnapshotPeriod;
    start_date: string;
    end_date: string;
    evidence: object;
    label?: string;
  }) => Promise<string | null>;
}

function browserStorage() {
  return {
    local: localStorage,
    session: sessionStorage,
  };
}

export function useGenerateWorkspace({ user, saveSnapshot }: UseGenerateWorkspaceOptions) {
  const [evidenceText, setEvidenceText] = useState("");
  const [goals, setGoals] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [isPremiumResult, setIsPremiumResult] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payments, setPayments] = useState<PaymentsConfig>({
    enabled: false,
    creditsPerPurchase: 5,
    priceCents: 100,
    freeModel: "",
    premiumModel: "",
  });
  const [premiumCredits, setPremiumCredits] = useState<number | null>(null);
  const [authError, setAuthError] = useState(false);

  const [snapshotPeriod, setSnapshotPeriod] = useState<SnapshotPeriod>("weekly");
  const [snapshotLabel, setSnapshotLabel] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  const generate = useCallback(
    async (
      stripeSessionId?: string,
      evidenceOverride?: string,
      goalsOverride?: string
    ) => {
      setError(null);
      setLoading(true);
      setResult(null);
      setIsPremiumResult(false);
      setProgress("");

      const outcome = await runGenerate({
        fetch,
        parseJsonResponse,
        pollJob,
        evidenceText: evidenceOverride ?? evidenceText,
        goals: goalsOverride ?? goals,
        stripeSessionId,
        onProgress: setProgress,
        posthog: posthog ?? undefined,
        randomUUID: globalThis.crypto?.randomUUID?.bind(globalThis.crypto),
      });

      if (outcome.ok) {
        setResult(outcome.result);
        setIsPremiumResult(outcome.isPremium);
        if (typeof outcome.creditsRemaining === "number") {
          setPremiumCredits(outcome.creditsRemaining);
        }
      } else {
        setError(outcome.error);
      }

      setLoading(false);
      setProgress("");
    },
    [evidenceText, goals]
  );

  const usePremiumCredit = useCallback(() => {
    const sessionId = getPremiumStripeSessionId(localStorage);
    if (!sessionId) return;
    void generate(sessionId);
  }, [generate]);

  const upgradeToPremium = useCallback(async () => {
    setError(null);
    const outcome = await runPremiumCheckout({
      fetch,
      parseJsonResponse,
      evidenceText,
      goals,
      session: sessionStorage,
      posthog: posthog ?? undefined,
    });
    if (!outcome.ok) setError(outcome.error);
  }, [evidenceText, goals]);

  const saveSnapshotCommand = useCallback(async () => {
    setSnapshotError(null);
    setSnapshotSaved(false);
    setSnapshotSaving(true);
    const outcome = await runSaveSnapshot({
      evidenceText,
      snapshotPeriod,
      snapshotLabel,
      saveSnapshot,
    });
    setSnapshotSaving(false);
    if (outcome.ok) {
      setSnapshotSaved(true);
      setSnapshotLabel("");
      posthog?.capture("snapshot_saved", { period: snapshotPeriod });
    } else {
      setSnapshotError(outcome.error);
    }
  }, [evidenceText, snapshotPeriod, snapshotLabel, saveSnapshot]);

  const downloadReport = useCallback(() => {
    let timeframe: Timeframe | undefined;
    try {
      const ev = JSON.parse(evidenceText) as { timeframe?: Timeframe };
      timeframe = ev.timeframe;
    } catch {
      /* no timeframe */
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
  }, [evidenceText, result]);

  const loadSample = useCallback(async () => {
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
  }, []);

  const handleFile = useCallback((file: File | undefined) => {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      setEvidenceText(r.result as string);
      setError(null);
    };
    r.readAsText(file);
  }, []);

  const setEvidenceTextClearingError = useCallback((text: string) => {
    setEvidenceText(text);
    setError(null);
  }, []);

  useEffect(() => {
    const recovery = parseUrlRecovery({
      search: window.location.search,
      replaceState: window.history.replaceState.bind(window.history),
      storage: browserStorage(),
    });
    if (recovery.authError) setAuthError(true);
    if (recovery.evidenceText) {
      setEvidenceText(recovery.evidenceText);
      setError(null);
    }
    if (recovery.snapshotId) {
      void fetchSnapshotEvidence(fetch, recovery.snapshotId).then((text) => {
        if (text) {
          setEvidenceText(text);
          setError(null);
        }
      });
    }
  }, []);

  useEffect(() => {
    void fetchPaymentsConfig(fetch).then(setPayments);
  }, []);

  useEffect(() => {
    if (!payments.enabled || !user) return;
    void fetchPremiumCredits(fetch).then(setPremiumCredits);
  }, [payments.enabled, user]);

  useEffect(() => {
    if (!user) return;
    void fetchLatestJobEvidence(fetch).then((text) => {
      if (text) {
        setEvidenceText(text);
        setError(null);
      }
    });
  }, [user]);

  useEffect(() => {
    const recovery = recoverStripeAutoGenerate({ session: sessionStorage });
    if (!recovery) return;
    setEvidenceText(recovery.evidenceText);
    if (recovery.goals) setGoals(recovery.goals);
    const timer = setTimeout(
      () =>
        void generate(recovery.sessionId, recovery.evidenceText, recovery.goals),
      STRIPE_RETURN_DELAY_MS
    );
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    evidenceText,
    setEvidenceText,
    setEvidenceTextClearingError,
    goals,
    setGoals,
    loading,
    progress,
    result,
    isPremiumResult,
    error,
    setError,
    payments,
    premiumCredits,
    authError,
    snapshotPeriod,
    setSnapshotPeriod,
    snapshotLabel,
    setSnapshotLabel,
    snapshotSaving,
    snapshotSaved,
    snapshotError,
    generate,
    usePremiumCredit,
    upgradeToPremium,
    saveSnapshot: saveSnapshotCommand,
    downloadReport,
    loadSample,
    handleFile,
  };
}
