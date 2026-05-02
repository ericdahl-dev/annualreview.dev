/**
 * In-memory session store. Session id in cookie; token and identity stored server-side.
 */

export interface SessionData {
  access_token: string;
  login: string;
  scope?: string;
  created_at: string;
}

import { generateId } from "./id.js";

const sessions = new Map<string, SessionData>();

export function createSession(data: Omit<SessionData, "created_at">): string {
  const id = generateId("sess");
  sessions.set(id, {
    ...data,
    created_at: new Date().toISOString(),
  });
  return id;
}

export function getSession(id: string): SessionData | undefined {
  return sessions.get(id);
}

export function destroySession(id: string): void {
  sessions.delete(id);
}

const oauthStates = new Map<string, string>();

/** Store OAuth state by short id (id goes in cookie; state is sent to GitHub). */
export function setOAuthState(id: string, state: string): void {
  oauthStates.set(id, state);
}

/** Retrieve and consume OAuth state. */
export function getAndRemoveOAuthState(id: string): string | null {
  const state = oauthStates.get(id);
  if (state) oauthStates.delete(id);
  return state ?? null;
}
