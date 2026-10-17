import {
  ReportPositionRequestSchema,
  type VerifyResponse,
  VerifyResponseSchema,
} from "@agenthabit/core";
import { z } from "zod";

/**
 * The session token lives in `sessionStorage` only: it dies with the tab, and it is never put in
 * a URL, in `localStorage` or in a log (T7a). Every access is wrapped because storage can be
 * blocked (private windows, strict settings); the app then simply asks to link again.
 */

const SESSION_KEY = "agenthabit.session";
const PENDING_KEY = "agenthabit.pendingCommit";

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

/**
 * A commit whose transaction is on the way (or confirmed) but that the API has not mirrored yet.
 * The hash is public on-chain, so it is safe to keep; it lets the next visit report it.
 */
const PendingCommitSchema = ReportPositionRequestSchema.extend({
  /** The wallet that signed it: another wallet in the same tab must not report it. */
  address: z.string(),
});
export type PendingCommit = z.infer<typeof PendingCommitSchema>;

export function loadPendingCommit(): PendingCommit | null {
  try {
    const raw = store()?.getItem(PENDING_KEY);
    if (raw === null || raw === undefined) return null;
    const parsed = PendingCommitSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function savePendingCommit(pending: PendingCommit): void {
  try {
    store()?.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // Not critical: the commit is on-chain either way.
  }
}

export function clearPendingCommit(): void {
  try {
    store()?.removeItem(PENDING_KEY);
  } catch {
    // Nothing to clear.
  }
}
