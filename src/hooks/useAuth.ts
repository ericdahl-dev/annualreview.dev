import { useState, useEffect, useCallback } from "react";
import { posthog } from "../posthog";

export interface AuthUser {
  login: string;
  scope?: string;
}

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me", { credentials: "include" })
      .then((res) =>
        res.ok ? res.json() : Promise.reject(new Error("not authenticated"))
      )
      .then((data: { login: string; scope?: string }) => {
        setUser({ login: data.login, scope: data.scope });
        try { posthog?.identify(data.login); } catch { /* non-critical */ }
      })
      .catch(() => setUser(null))
      .finally(() => setAuthChecked(true));
  }, []);

  const logout = useCallback(() => {
    fetch("/api/auth/logout", { method: "POST", credentials: "include" }).then(
      () => {
        setUser(null);
        try { posthog?.reset(); } catch { /* non-critical */ }
      }
    );
  }, []);

  return { user, authChecked, logout };
}
