import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  saveSnapshot,
  listSnapshots,
  getSnapshot,
  deleteSnapshot,
  mergeSnapshots,
  clearSnapshotStore,
  resetPool,
  isSnapshotStoreConfigured,
} from "../lib/snapshot-store.ts";

const SAMPLE_EVIDENCE_A = {
  timeframe: { start_date: "2025-01-01", end_date: "2025-01-07" },
  contributions: [
    { id: "repo#1", type: "pull_request", title: "PR one", url: "https://github.com/org/repo/pull/1", repo: "org/repo" },
    { id: "repo#2", type: "review", title: "Review one", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
  ],
};

const SAMPLE_EVIDENCE_B = {
  timeframe: { start_date: "2025-01-08", end_date: "2025-01-14" },
  contributions: [
    { id: "repo#3", type: "pull_request", title: "PR two", url: "https://github.com/org/repo/pull/3", repo: "org/repo" },
    // deliberate duplicate — should be deduplicated during merge
    { id: "repo#2", type: "review", title: "Review one (dup)", url: "https://github.com/org/repo/pull/2", repo: "org/repo" },
  ],
};

// Skip the entire suite when no Postgres is available
const describeWithDb = process.env.DATABASE_URL
  ? describe
  : describe.skip;

describeWithDb("snapshot-store (integration)", () => {
  beforeEach(async () => {
    await clearSnapshotStore();
  });

  afterAll(async () => {
    await clearSnapshotStore();
    resetPool();
  });

  it("isSnapshotStoreConfigured returns true when DATABASE_URL is set", () => {
    expect(isSnapshotStoreConfigured()).toBe(true);
  });

  it("saveSnapshot returns a string id", async () => {
    const id = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    expect(typeof id).toBe("string");
    expect(id).toMatch(/^snap_/);
  });

  it("listSnapshots returns snapshots ordered newest first", async () => {
    await saveSnapshot("alice", "daily", "2025-01-01", "2025-01-01", SAMPLE_EVIDENCE_A, "Day 1");
    await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A, "Week 1");
    const list = await listSnapshots("alice");
    expect(list).toHaveLength(2);
    expect(list[0].label).toBe("Week 1"); // most recent first
    expect(list[0].contribution_count).toBe(2);
  });

  it("listSnapshots only returns snapshots for the given user", async () => {
    await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    await saveSnapshot("bob", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const list = await listSnapshots("alice");
    expect(list).toHaveLength(1);
    expect(list[0].user_login).toBe("alice");
  });

  it("listSnapshots does not include evidence payload", async () => {
    await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const list = await listSnapshots("alice");
    expect(list[0].evidence).toBeUndefined();
  });

  it("getSnapshot returns full snapshot including evidence", async () => {
    const id = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A, "Week 1");
    const snap = await getSnapshot(id, "alice");
    expect(snap).not.toBeNull();
    expect(snap.id).toBe(id);
    expect(snap.label).toBe("Week 1");
    expect(snap.evidence.contributions).toHaveLength(2);
  });

  it("getSnapshot returns null for wrong user", async () => {
    const id = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const snap = await getSnapshot(id, "bob");
    expect(snap).toBeNull();
  });

  it("deleteSnapshot removes the snapshot and returns true", async () => {
    const id = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const result = await deleteSnapshot(id, "alice");
    expect(result).toBe(true);
    expect(await getSnapshot(id, "alice")).toBeNull();
  });

  it("deleteSnapshot returns false when snapshot does not exist", async () => {
    const result = await deleteSnapshot("snap_nonexistent", "alice");
    expect(result).toBe(false);
  });

  it("deleteSnapshot returns false when user does not own snapshot", async () => {
    const id = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const result = await deleteSnapshot(id, "bob");
    expect(result).toBe(false);
    // snapshot still there
    expect(await getSnapshot(id, "alice")).not.toBeNull();
  });

  it("mergeSnapshots combines contributions and deduplicates by id", async () => {
    const idA = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const idB = await saveSnapshot("alice", "weekly", "2025-01-08", "2025-01-14", SAMPLE_EVIDENCE_B);
    const merged = await mergeSnapshots([idA, idB], "alice");
    expect(merged).not.toBeNull();
    expect(merged.timeframe.start_date).toBe("2025-01-01");
    expect(merged.timeframe.end_date).toBe("2025-01-14");
    // repo#1, repo#2, repo#3 — repo#2 appears in both but should be deduplicated
    expect(merged.contributions).toHaveLength(3);
    const ids = merged.contributions.map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("mergeSnapshots returns null when no matching snapshots found", async () => {
    const result = await mergeSnapshots(["snap_nonexistent"], "alice");
    expect(result).toBeNull();
  });

  it("mergeSnapshots ignores snapshots belonging to another user", async () => {
    const idAlice = await saveSnapshot("alice", "weekly", "2025-01-01", "2025-01-07", SAMPLE_EVIDENCE_A);
    const idBob = await saveSnapshot("bob", "weekly", "2025-01-08", "2025-01-14", SAMPLE_EVIDENCE_B);
    // alice tries to merge one of her snapshots with one of bob's
    const merged = await mergeSnapshots([idAlice, idBob], "alice");
    // only alice's snapshot should be included
    expect(merged).not.toBeNull();
    expect(merged.contributions).toHaveLength(2); // only SAMPLE_EVIDENCE_A
  });
});

describe("snapshot-store (no DATABASE_URL)", () => {
  it("isSnapshotStoreConfigured returns false when DATABASE_URL is not set", () => {
    const original = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(isSnapshotStoreConfigured()).toBe(false);
    if (original !== undefined) process.env.DATABASE_URL = original;
  });
});
