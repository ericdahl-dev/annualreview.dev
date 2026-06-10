import type { StorageAdapter, StripeAutoGenerateRecovery, UrlRecoveryResult } from "./types.js";

interface ParseUrlRecoveryOptions {
  search: string;
  replaceState: (data: unknown, title: string, url: string) => void;
  storage?: {
    local: StorageAdapter;
    session: StorageAdapter;
  };
}

function clearQuery(
  replaceState: ParseUrlRecoveryOptions["replaceState"],
  pathname = typeof window !== "undefined" ? window.location.pathname : "/"
) {
  replaceState({}, "", pathname);
}

export function parseUrlRecovery({
  search,
  replaceState,
  storage,
}: ParseUrlRecoveryOptions): UrlRecoveryResult {
  const params = new URLSearchParams(search);
  const result: UrlRecoveryResult = {};

  if (params.get("error") === "auth_failed") {
    result.authError = true;
    clearQuery(replaceState);
    return result;
  }

  const sessionId = params.get("session_id");
  const isPremium = params.get("premium") === "1";
  if (sessionId && isPremium) {
    clearQuery(replaceState);
    if (storage) {
      try {
        storage.local.setItem("premium_stripe_session_id", sessionId);
      } catch {
        /* ignore */
      }
      try {
        storage.session.setItem("stripe_session_id", sessionId);
      } catch {
        /* ignore */
      }
    }
  }

  if (params.get("from_snapshot_merge") === "1") {
    clearQuery(replaceState);
    if (storage) {
      let merged: string | null = null;
      try {
        merged = storage.session.getItem("merged_evidence");
      } catch {
        /* ignore */
      }
      if (merged) {
        try {
          storage.session.removeItem("merged_evidence");
        } catch {
          /* ignore */
        }
        result.evidenceText = merged;
      }
    }
    return result;
  }

  const snapshotId = params.get("snapshot_id");
  if (snapshotId) {
    clearQuery(replaceState);
    result.snapshotId = snapshotId;
  }

  return result;
}

export function recoverStripeReturnFromUrl(
  options: ParseUrlRecoveryOptions
): UrlRecoveryResult | null {
  const params = new URLSearchParams(options.search);
  if (!params.get("session_id") || params.get("premium") !== "1") return null;
  return parseUrlRecovery(options);
}

export function recoverStripeAutoGenerate({
  session,
}: {
  session: StorageAdapter;
}): StripeAutoGenerateRecovery | null {
  let sessionId: string | null = null;
  try {
    sessionId = session.getItem("stripe_session_id");
  } catch {
    /* ignore */
  }
  if (!sessionId) return null;

  try {
    session.removeItem("stripe_session_id");
  } catch {
    /* ignore */
  }

  let evidenceText: string | null = null;
  let goals: string | null = null;
  try {
    evidenceText = session.getItem("premium_evidence");
  } catch {
    /* ignore */
  }
  try {
    goals = session.getItem("premium_goals");
  } catch {
    /* ignore */
  }

  if (evidenceText) {
    try {
      session.removeItem("premium_evidence");
    } catch {
      /* ignore */
    }
  }
  if (goals) {
    try {
      session.removeItem("premium_goals");
    } catch {
      /* ignore */
    }
  }

  if (!evidenceText) return null;

  return {
    sessionId,
    evidenceText,
    goals: goals ?? undefined,
  };
}
