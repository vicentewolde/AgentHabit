import { type VerifyResponse, VerifyResponseSchema } from "@agenthabit/core";

/**
 * The session token lives in `sessionStorage` only: it dies with the tab, and it is never put in
 * a URL, in `localStorage` or in a log (T7a). Every access is wrapped because storage can be
 * blocked (private windows, strict settings); the app then simply asks to link again.
 */

const SESSION_KEY = "agenthabit.session";

function store(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function loadSession(nowMs: number = Date.now()): VerifyResponse | null {
  try {
    const raw = store()?.getItem(SESSION_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = VerifyResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || Date.parse(parsed.data.expiresAt) <= nowMs) {
      clearSession();
      return null;
    }
    return parsed.data;
  } catch {
    clearSession();
    return null;
  }
}

export function saveSession(session: VerifyResponse): void {
  try {
    store()?.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    // Storage is full or blocked: the session lasts until the page is closed.
  }
}

export function clearSession(): void {
  try {
    store()?.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clear.
  }
}
