import { useState, useCallback, useEffect } from "react";
import type { AuthUser } from "./useAuth.js";

export type PeriodType = "daily" | "weekly" | "monthly";

export interface PeriodicSummary {
  id: string;
  user_login: string;
  period_type: PeriodType;
  period_key: string;
  start_date: string;
  end_date: string;
  contribution_count: number;
  summary: unknown; // parsed JSON — shape varies by period_type
  child_ids: string[] | null;
  created_at: string;
}

interface DailySummaryResult {
  id: string;
  date: string;
  contribution_count: number;
  summary: unknown;
}

interface RollupResult {
  id: string;
  week_start?: string;
  week_end?: string;
  month?: string;
  days_covered?: number;
  weeks_covered?: number;
  total_contributions: number;
  summary: unknown;
}

interface UsePeriodicOptions {
  user: AuthUser | null;
}

export function usePeriodic({ user }: UsePeriodicOptions) {
  const [summaries, setSummaries] = useState<PeriodicSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSummaries = useCallback(
    async (periodType?: PeriodType, limit = 90) => {
      if (!user) return;
      setLoading(true);
      setError(null);
      try {
        const q = new URLSearchParams();
        if (periodType) q.set("type", periodType);
        q.set("limit", String(limit));
        const res = await fetch(`/api/periodic/summaries?${q}`, { credentials: "include" });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { summaries: PeriodicSummary[] };
        setSummaries(data.summaries ?? []);
      } catch (e) {
        setError((e as Error).message || "Failed to load summaries");
      } finally {
        setLoading(false);
      }
    },
    [user]
  );

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  const collectDay = useCallback(
    async (date?: string): Promise<DailySummaryResult | null> => {
      setError(null);
      try {
        const res = await fetch("/api/periodic/collect-day", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(date ? { date } : {}),
        });
        const data = (await res.json()) as DailySummaryResult & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await fetchSummaries();
        return data;
      } catch (e) {
        setError((e as Error).message || "Failed to collect day");
        return null;
      }
    },
    [fetchSummaries]
  );

  const rollupWeek = useCallback(
    async (weekStart?: string): Promise<RollupResult | null> => {
      setError(null);
      try {
        const res = await fetch("/api/periodic/rollup-week", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(weekStart ? { week_start: weekStart } : {}),
        });
        const data = (await res.json()) as RollupResult & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await fetchSummaries();
        return data;
      } catch (e) {
        setError((e as Error).message || "Failed to roll up week");
        return null;
      }
    },
    [fetchSummaries]
  );

  const rollupMonth = useCallback(
    async (month?: string): Promise<RollupResult | null> => {
      setError(null);
      try {
        const res = await fetch("/api/periodic/rollup-month", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(month ? { month } : {}),
        });
        const data = (await res.json()) as RollupResult & { error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await fetchSummaries();
        return data;
      } catch (e) {
        setError((e as Error).message || "Failed to roll up month");
        return null;
      }
    },
    [fetchSummaries]
  );

  const deleteSummary = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/periodic/summary/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setSummaries((prev) => prev.filter((s) => s.id !== id));
        return true;
      } catch (e) {
        setError((e as Error).message || "Failed to delete summary");
        return false;
      }
    },
    []
  );

  const dailies = summaries.filter((s) => s.period_type === "daily");
  const weeklies = summaries.filter((s) => s.period_type === "weekly");
  const monthlies = summaries.filter((s) => s.period_type === "monthly");

  return {
    summaries,
    dailies,
    weeklies,
    monthlies,
    loading,
    error,
    fetchSummaries,
    collectDay,
    rollupWeek,
    rollupMonth,
    deleteSummary,
  };
}
