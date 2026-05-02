import { useState, useCallback, useEffect } from "react";
import type { AuthUser } from "./useAuth.js";

export type SnapshotPeriod = "daily" | "weekly" | "monthly" | "custom";

export interface Snapshot {
  id: string;
  user_login: string;
  period: SnapshotPeriod;
  start_date: string;
  end_date: string;
  label: string | null;
  contribution_count: number;
  created_at: string;
}

interface UseSnapshotsOptions {
  user: AuthUser | null;
}

export function useSnapshots({ user }: UseSnapshotsOptions) {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchSnapshots = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/snapshots", { credentials: "include" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { snapshots: Snapshot[] };
      setSnapshots(data.snapshots ?? []);
    } catch (e) {
      setError((e as Error).message || "Failed to load snapshots");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const saveSnapshot = useCallback(
    async (opts: {
      period: SnapshotPeriod;
      start_date: string;
      end_date: string;
      evidence: object;
      label?: string;
    }): Promise<string | null> => {
      try {
        const res = await fetch("/api/snapshots", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify(opts),
        });
        const data = (await res.json()) as { id?: string; error?: string };
        if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
        await fetchSnapshots();
        return data.id ?? null;
      } catch (e) {
        setError((e as Error).message || "Failed to save snapshot");
        return null;
      }
    },
    [fetchSnapshots]
  );

  const deleteSnapshot = useCallback(
    async (id: string): Promise<boolean> => {
      try {
        const res = await fetch(`/api/snapshots/${id}`, {
          method: "DELETE",
          credentials: "include",
        });
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        setSnapshots((prev) => prev.filter((s) => s.id !== id));
        return true;
      } catch (e) {
        setError((e as Error).message || "Failed to delete snapshot");
        return false;
      }
    },
    []
  );

  const mergeSnapshots = useCallback(
    async (ids: string[]): Promise<object | null> => {
      try {
        const res = await fetch("/api/snapshots/merge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ ids }),
        });
        const data = (await res.json()) as { error?: string } & object;
        if (!res.ok) throw new Error((data as { error?: string }).error || `HTTP ${res.status}`);
        return data;
      } catch (e) {
        setError((e as Error).message || "Failed to merge snapshots");
        return null;
      }
    },
    []
  );

  return {
    snapshots,
    loading,
    error,
    fetchSnapshots,
    saveSnapshot,
    deleteSnapshot,
    mergeSnapshots,
  };
}
