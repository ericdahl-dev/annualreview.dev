/**
 * GitHub OAuth: redirect URL, token exchange, user fetch, callback/me/logout handlers.
 */

const GITHUB_AUTH = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN = "https://github.com/login/oauth/access_token";
const GITHUB_USER = "https://api.github.com/user";

const SCOPES: Record<string, string> = {
  public: "read:user public_repo read:org",
  private: "read:user repo read:org",
};

export function getAuthRedirectUrl(
  scope: string,
  state: string,
  redirectUri: string,
  clientId: string
): string {
  const githubScope = SCOPES[scope] || SCOPES.public;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: githubScope,
    state,
  });
  return `${GITHUB_AUTH}?${params.toString()}`;
}

export async function exchangeCodeForToken(
  code: string,
  redirectUri: string,
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch
): Promise<string> {
  const res = await fetchFn(GITHUB_TOKEN, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status}`);
  const data = await res.json() as { error?: string; error_description?: string; access_token?: string };
  if (data.error) throw new Error(data.error_description || data.error);
  if (!data.access_token) throw new Error("No access_token in response");
  return data.access_token;
}

export async function getGitHubUser(
  accessToken: string,
  fetchFn: typeof fetch
): Promise<{ login: string }> {
  const res = await fetchFn(GITHUB_USER, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`User fetch failed: ${res.status}`);
  const user = await res.json() as { login: string };
  return { login: user.login };
}

interface CallbackRequest {
  url?: string;
  headers?: Record<string, string | undefined>;
}

/**
 * Build a lightweight callback request object while preserving headers.
 * Avoids object spread on IncomingMessage, which can drop non-enumerable fields.
 */
export function buildCallbackRequest(
  req: { headers?: object },
  fullUrl: string
): { url: string; headers?: object } {
  return {
    url: fullUrl,
    headers: req?.headers,
  };
}

interface CallbackResponse {
  writeHead: (code: number, headers?: object) => void;
  end: (body?: string) => void;
  setHeader: (k: string, v: string) => void;
}

interface CallbackDeps {
  getStateFromRequest: (req: CallbackRequest) => string | null;
  getAndRemoveOAuthState?: (state: string) => string | null;
  clearStateCookie: (res: CallbackResponse) => void;
  setSessionCookie: (res: CallbackResponse, id: string, secret: string, opts?: object) => void;
  createSession: (data: object) => string;
  exchangeCodeForToken: (code: string, redirectUri: string) => Promise<string>;
  getGitHubUser: (token: string) => Promise<{ login: string }>;
  redirectUri: string;
  sessionSecret: string;
  cookieOpts?: { secure?: boolean };
  scope?: string;
  log?: (event: string, detail?: string) => void;
}

export async function handleCallback(
  req: CallbackRequest,
  res: CallbackResponse,
  deps: CallbackDeps
): Promise<void> {
  const log = deps.log || (() => {});
  const url = req.url || "";
  const search = url.includes("?") ? url.slice(url.indexOf("?")) : "";
  const params = new URLSearchParams(search);
  const code = params.get("code");
  const stateParam = params.get("state");
  const storedState =
    deps.getStateFromRequest(req) ??
    (stateParam && deps.getAndRemoveOAuthState ? deps.getAndRemoveOAuthState(stateParam) : null);

  const fail = (reason: string) => {
    log("auth_callback_fail", reason);
    deps.clearStateCookie(res);
    res.writeHead(302, { Location: "/generate?error=auth_failed" });
    res.end();
  };

  if (!code) {
    fail("missing_code");
    return;
  }
  if (!stateParam) {
    fail("missing_state_param");
    return;
  }
  if (!storedState) {
    fail("missing_stored_state");
    return;
  }
  if (stateParam !== storedState) {
    fail("state_mismatch");
    return;
  }

  const scope = stateParam.includes("_") ? stateParam.slice(0, stateParam.indexOf("_")) : (deps.scope || "public");
  const redirectUri = deps.redirectUri;
  let access_token: string;
  try {
    access_token = await deps.exchangeCodeForToken(code, redirectUri);
  } catch (e) {
    fail(`token_exchange: ${(e as Error).message || "unknown"}`);
    return;
  }
  const user = await deps.getGitHubUser(access_token);
  const sessionId = deps.createSession({
    access_token,
    login: user.login,
    scope,
  });
  deps.clearStateCookie(res);
  deps.setSessionCookie(res, sessionId, deps.sessionSecret, deps.cookieOpts || {});
  res.writeHead(302, { Location: "/generate" });
  res.end();
}

interface MeResponse {
  writeHead: (code: number, headers?: object) => void;
  end: (body?: string) => void;
  setHeader: (k: string, v: string) => void;
}

interface MeDeps {
  getSessionIdFromRequest: (req: unknown) => string | null;
  getSession: (id: string) => { login: string; scope?: string } | undefined;
}

export function handleMe(req: unknown, res: MeResponse, deps: MeDeps): void {
  const sessionId = deps.getSessionIdFromRequest(req);
  const session = sessionId ? deps.getSession(sessionId) : undefined;
  if (!session) {
    res.writeHead(401);
    res.end();
    return;
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ login: session.login, scope: session.scope }));
}

interface LogoutResponse {
  writeHead: (code: number) => void;
  end: () => void;
}

interface LogoutDeps {
  getSessionIdFromRequest: (req: unknown) => string | null;
  destroySession: (id: string) => void;
  clearSessionCookie: (res: LogoutResponse) => void;
}

export function handleLogout(req: unknown, res: LogoutResponse, deps: LogoutDeps): void {
  const sessionId = deps.getSessionIdFromRequest(req);
  if (sessionId) deps.destroySession(sessionId);
  deps.clearSessionCookie(res);
  res.writeHead(204);
  res.end();
}
