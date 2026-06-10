import type { SnapshotPeriod } from "../../hooks/useSnapshots.js";

export interface PipelineResult {
  themes?: unknown;
  bullets?: unknown;
  stories?: unknown;
  self_eval?: unknown;
}

export interface PaymentsConfig {
  enabled: boolean;
  creditsPerPurchase: number;
  priceCents: number;
  freeModel: string;
  premiumModel: string;
}

export interface StorageAdapter {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface UrlRecoveryResult {
  authError?: boolean;
  evidenceText?: string;
  snapshotId?: string;
}

export interface StripeAutoGenerateRecovery {
  sessionId: string;
  evidenceText: string;
  goals?: string;
}

export type GenerateCommandResult =
  | {
      ok: true;
      result: PipelineResult;
      isPremium: boolean;
      creditsRemaining?: number;
    }
  | { ok: false; error: string };

export type SimpleCommandResult = { ok: true } | { ok: false; error: string };

export type SaveSnapshotResult =
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface SaveSnapshotFn {
  (opts: {
    period: SnapshotPeriod;
    start_date: string;
    end_date: string;
    evidence: object;
    label?: string;
  }): Promise<string | null>;
}
