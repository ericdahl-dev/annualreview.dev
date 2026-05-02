/**
 * Snapshots API:
 *   GET    /          – list user's snapshots (requires login)
 *   POST   /          – save a new snapshot  (requires login)
 *   GET    /:id       – get a single snapshot with evidence (requires login)
 *   DELETE /:id       – delete a snapshot (requires login)
 *   POST   /merge     – merge multiple snapshots into combined evidence (requires login)
 */

import type { IncomingMessage, ServerResponse } from "http";
import type { SessionData } from "../../lib/session-store.js";
import type { Evidence } from "../../types/evidence.js";
import type {
  Snapshot,
  SnapshotWithEvidence,
  SnapshotPeriod,
} from "../../lib/snapshot-store.js";
import { readJsonBody as defaultReadJsonBody, respondJson } from "../helpers.js";

export interface SnapshotsRoutesOptions {
  /** Injected in tests; defaults to streaming JSON from the request. */
  readJsonBody?: (req: IncomingMessage) => Promise<object>;
  getSessionIdFromRequest: (req: IncomingMessage) => string | null;
  getSession: (id: string) => SessionData | undefined;
  /** Injected for tests; defaults to real snapshot-store functions when not provided. */
  saveSnapshot?: (
    userLogin: string,
    period: SnapshotPeriod,
    startDate: string,
    endDate: string,
    evidence: Evidence,
    label?: string
  ) => Promise<string>;
  listSnapshots?: (userLogin: string) => Promise<Snapshot[]>;
  getSnapshot?: (id: string, userLogin: string) => Promise<SnapshotWithEvidence | null>;
  deleteSnapshot?: (id: string, userLogin: string) => Promise<boolean>;
  mergeSnapshots?: (ids: string[], userLogin: string) => Promise<Evidence | null>;
  isSnapshotStoreConfigured?: () => boolean;
}

type Next = () => void;

const VALID_PERIODS = new Set<string>(["daily", "weekly", "monthly", "custom"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function snapshotsRoutes(options: SnapshotsRoutesOptions) {
  const {
    getSessionIdFromRequest,
    getSession,
  } = options;
  const readJsonBody = options.readJsonBody ?? defaultReadJsonBody;

  return async function snapshotsMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: Next
  ): Promise<void> {
    const rawPath = (req.url?.split("?")[0] || "").replace(/^\/+/, "") || "";

    // Resolve the real store functions lazily (so tests can inject mocks without
    // importing the real module at test time).
    async function getStore() {
      if (
        options.saveSnapshot &&
        options.listSnapshots &&
        options.getSnapshot &&
        options.deleteSnapshot &&
        options.mergeSnapshots &&
        options.isSnapshotStoreConfigured
      ) {
        return {
          saveSnapshot: options.saveSnapshot,
          listSnapshots: options.listSnapshots,
          getSnapshot: options.getSnapshot,
          deleteSnapshot: options.deleteSnapshot,
          mergeSnapshots: options.mergeSnapshots,
          isSnapshotStoreConfigured: options.isSnapshotStoreConfigured,
        };
      }
      const store = await import("../../lib/snapshot-store.js");
      return {
        saveSnapshot: store.saveSnapshot,
        listSnapshots: store.listSnapshots,
        getSnapshot: store.getSnapshot,
        deleteSnapshot: store.deleteSnapshot,
        mergeSnapshots: store.mergeSnapshots,
        isSnapshotStoreConfigured: store.isSnapshotStoreConfigured,
      };
    }

    // Helper: authenticate and return the user's login, or respond 401.
    function requireLogin(): string | null {
      const sessId = getSessionIdFromRequest(req);
      const session = sessId ? getSession(sessId) : undefined;
      if (!session?.login) {
        respondJson(res, 401, { error: "Login required" });
        return null;
      }
      return session.login;
    }

    // POST /merge — merge multiple snapshots into combined evidence
    if (rawPath === "merge" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isSnapshotStoreConfigured()) {
        respondJson(res, 503, { error: "Snapshot store not configured (DATABASE_URL missing)" });
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        respondJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const ids = body.ids;
      if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
        respondJson(res, 400, { error: "ids must be a non-empty array of strings" });
        return;
      }

      try {
        const merged = await store.mergeSnapshots(ids as string[], userLogin);
        if (!merged) {
          respondJson(res, 404, { error: "No snapshots found for the given ids" });
          return;
        }
        respondJson(res, 200, merged as unknown as object);
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to merge snapshots" });
      }
      return;
    }

    // GET / — list snapshots
    if (rawPath === "" && req.method === "GET") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isSnapshotStoreConfigured()) {
        respondJson(res, 503, { error: "Snapshot store not configured (DATABASE_URL missing)" });
        return;
      }

      try {
        const snapshots = await store.listSnapshots(userLogin);
        respondJson(res, 200, { snapshots });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to list snapshots" });
      }
      return;
    }

    // POST / — save a new snapshot
    if (rawPath === "" && req.method === "POST") {
      const userLogin = requireLogin();
      if (!userLogin) return;

      const store = await getStore();
      if (!store.isSnapshotStoreConfigured()) {
        respondJson(res, 503, { error: "Snapshot store not configured (DATABASE_URL missing)" });
        return;
      }

      let body: Record<string, unknown>;
      try {
        body = (await readJsonBody(req)) as Record<string, unknown>;
      } catch {
        respondJson(res, 400, { error: "Invalid JSON body" });
        return;
      }

      const { period, start_date, end_date, evidence, label } = body as {
        period?: string;
        start_date?: string;
        end_date?: string;
        evidence?: unknown;
        label?: string;
      };

      if (!period || !VALID_PERIODS.has(period)) {
        respondJson(res, 400, { error: "period must be one of: daily, weekly, monthly, custom" });
        return;
      }
      if (!start_date || !DATE_RE.test(start_date)) {
        respondJson(res, 400, { error: "start_date must be YYYY-MM-DD" });
        return;
      }
      if (!end_date || !DATE_RE.test(end_date)) {
        respondJson(res, 400, { error: "end_date must be YYYY-MM-DD" });
        return;
      }
      if (!evidence || typeof evidence !== "object") {
        respondJson(res, 400, { error: "evidence is required" });
        return;
      }

      const ev = evidence as Evidence;
      if (!Array.isArray(ev.contributions)) {
        respondJson(res, 400, { error: "evidence.contributions must be an array" });
        return;
      }

      try {
        const id = await store.saveSnapshot(
          userLogin,
          period as SnapshotPeriod,
          start_date,
          end_date,
          ev,
          label
        );
        respondJson(res, 201, { id });
      } catch (e) {
        const err = e as Error;
        respondJson(res, 500, { error: err.message || "Failed to save snapshot" });
      }
      return;
    }

    // Routes with /:id
    const parts = rawPath.split("/");
    const snapshotId = parts[0];

    if (snapshotId && parts.length === 1) {
      // GET /:id
      if (req.method === "GET") {
        const userLogin = requireLogin();
        if (!userLogin) return;

        const store = await getStore();
        if (!store.isSnapshotStoreConfigured()) {
          respondJson(res, 503, { error: "Snapshot store not configured (DATABASE_URL missing)" });
          return;
        }

        try {
          const snapshot = await store.getSnapshot(snapshotId, userLogin);
          if (!snapshot) {
            respondJson(res, 404, { error: "Snapshot not found" });
            return;
          }
          respondJson(res, 200, snapshot as unknown as object);
        } catch (e) {
          const err = e as Error;
          respondJson(res, 500, { error: err.message || "Failed to get snapshot" });
        }
        return;
      }

      // DELETE /:id
      if (req.method === "DELETE") {
        const userLogin = requireLogin();
        if (!userLogin) return;

        const store = await getStore();
        if (!store.isSnapshotStoreConfigured()) {
          respondJson(res, 503, { error: "Snapshot store not configured (DATABASE_URL missing)" });
          return;
        }

        try {
          const deleted = await store.deleteSnapshot(snapshotId, userLogin);
          if (!deleted) {
            respondJson(res, 404, { error: "Snapshot not found" });
            return;
          }
          respondJson(res, 200, { deleted: true });
        } catch (e) {
          const err = e as Error;
          respondJson(res, 500, { error: err.message || "Failed to delete snapshot" });
        }
        return;
      }
    }

    next();
  };
}
