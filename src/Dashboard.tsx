// Dashboard: shows the user's saved contribution snapshots and lets them merge for annual review.
import React, { useState, useCallback } from "react";
import "./Dashboard.css";
import { posthog } from "./posthog";
import { useAuth } from "./hooks/useAuth";
import { useSnapshots } from "./hooks/useSnapshots";
import type { Snapshot } from "./hooks/useSnapshots";

const PERIOD_LABELS: Record<string, string> = {
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
  custom: "Custom",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function formatCreatedAt(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface SnapshotCardProps {
  snapshot: Snapshot;
  selected: boolean;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onLoad: (id: string) => void;
  deleting: boolean;
}

function SnapshotCard({
  snapshot,
  selected,
  onToggle,
  onDelete,
  onLoad,
  deleting,
}: SnapshotCardProps) {
  return (
    <div className={`dashboard-snapshot-card${selected ? " is-selected" : ""}`}>
      <input
        type="checkbox"
        className="dashboard-snapshot-checkbox"
        checked={selected}
        onChange={() => onToggle(snapshot.id)}
        aria-label={`Select snapshot ${snapshot.label || snapshot.id}`}
      />
      <div className="dashboard-snapshot-info">
        <div className="dashboard-snapshot-top">
          <span className="dashboard-snapshot-period">
            {PERIOD_LABELS[snapshot.period] ?? snapshot.period}
          </span>
          <span className="dashboard-snapshot-label">
            {snapshot.label || `${formatDate(snapshot.start_date)} – ${formatDate(snapshot.end_date)}`}
          </span>
        </div>
        <div className="dashboard-snapshot-meta">
          <span>{formatDate(snapshot.start_date)} – {formatDate(snapshot.end_date)}</span>
          <span>{snapshot.contribution_count} contribution{snapshot.contribution_count !== 1 ? "s" : ""}</span>
          <span>Saved {formatCreatedAt(snapshot.created_at)}</span>
        </div>
      </div>
      <div className="dashboard-snapshot-actions">
        <button
          type="button"
          className="dashboard-btn dashboard-btn-ghost"
          onClick={() => onLoad(snapshot.id)}
          title="Load this snapshot into the generator"
        >
          Load
        </button>
        <button
          type="button"
          className="dashboard-btn dashboard-btn-danger"
          onClick={() => onDelete(snapshot.id)}
          disabled={deleting}
          title="Delete snapshot"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, authChecked, logout } = useAuth();
  const {
    snapshots,
    loading,
    error,
    deleteSnapshot,
    mergeSnapshots,
  } = useSnapshots({ user });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  const handleLogout = () => {
    posthog?.capture("logout");
    logout();
  };

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this snapshot?")) return;
    setDeleting(id);
    await deleteSnapshot(id);
    setSelected((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setDeleting(null);
    posthog?.capture("snapshot_deleted");
  };

  const handleLoad = (id: string) => {
    // Navigate to generate page and pass snapshot id via URL param
    posthog?.capture("snapshot_loaded");
    window.location.href = `/generate?snapshot_id=${id}`;
  };

  const handleMerge = async () => {
    if (selected.size < 2) {
      setMergeError("Select at least 2 snapshots to merge.");
      return;
    }
    setMerging(true);
    setMergeError(null);
    try {
      const merged = await mergeSnapshots(Array.from(selected));
      if (!merged) {
        setMergeError("Merge returned no data.");
        return;
      }
      posthog?.capture("snapshots_merged", { count: selected.size });
      // Pass the merged evidence to the generate page via sessionStorage
      try {
        sessionStorage.setItem("merged_evidence", JSON.stringify(merged));
      } catch {
        // ignore storage errors
      }
      window.location.href = "/generate?from_snapshot_merge=1";
    } catch (e) {
      setMergeError((e as Error).message || "Merge failed");
    } finally {
      setMerging(false);
    }
  };

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
        <h1 className="dashboard-title">Contribution Snapshots</h1>
        <p className="dashboard-subtitle">
          Snapshots capture your GitHub contributions for a date range. Save daily, weekly, or
          monthly snapshots and merge them later into a full annual review.
        </p>

        {!authChecked ? null : !user ? (
          <div className="dashboard-auth-gate">
            <p>Sign in with GitHub to view and manage your contribution snapshots.</p>
            <a href="/generate" className="dashboard-btn dashboard-btn-primary">
              Go to Generate
            </a>
          </div>
        ) : (
          <>
            <div className="dashboard-topbar">
              <span style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>
                {snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""}
              </span>
              <div className="dashboard-topbar-actions">
                <a href="/generate" className="dashboard-btn dashboard-btn-primary">
                  + New Snapshot
                </a>
              </div>
            </div>

            {error && <div className="dashboard-error">{error}</div>}
            {mergeError && <div className="dashboard-error">{mergeError}</div>}

            {loading ? (
              <div className="dashboard-loading">Loading snapshots…</div>
            ) : snapshots.length === 0 ? (
              <div className="dashboard-empty">
                No snapshots yet.{" "}
                <a href="/generate">Fetch your GitHub data</a> and save it as a snapshot to start
                tracking your contributions over time.
              </div>
            ) : (
              <div className="dashboard-snapshot-list">
                {snapshots.map((snap) => (
                  <SnapshotCard
                    key={snap.id}
                    snapshot={snap}
                    selected={selected.has(snap.id)}
                    onToggle={toggleSelect}
                    onDelete={handleDelete}
                    onLoad={handleLoad}
                    deleting={deleting === snap.id}
                  />
                ))}
              </div>
            )}

            {selected.size > 0 && (
              <div className="dashboard-merge-bar">
                <span className="dashboard-merge-bar-text">
                  <strong>{selected.size}</strong> snapshot{selected.size !== 1 ? "s" : ""} selected
                </span>
                <div className="dashboard-merge-bar-actions">
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn-ghost"
                    onClick={() => setSelected(new Set())}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    className="dashboard-btn dashboard-btn-primary"
                    onClick={handleMerge}
                    disabled={merging || selected.size < 2}
                  >
                    {merging ? "Merging…" : "Merge & Generate"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
