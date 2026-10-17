/**
 * Every failure AgentHabit raises is an {@link AgentHabitError} carrying a
 * machine-readable `code`. Callers branch on `code`, never on message text.
 *
 * New codes are added here as the tasks that need them land; the union is the
 * single source of truth for what can go wrong across packages and apps.
 */
export type AgentHabitErrorCode =
  /** A chain timestamp falls before the deployment's week anchor: there is no week yet. */
  | "BeforeAnchor"
  /** Local configuration is missing, malformed or internally inconsistent. */
  | "ConfigError"
  /** Contract parameters break the constructor rules of spec 4.2. */
  | "InvalidConfig"
  /** A weekly distance total is negative. */
  | "InvalidDistance"
  /** A network service (RPC, Friendbot) failed or answered something unexpected. */
  | "NetworkError"
  /** An output line was about to carry a secret; it is never written. */
  | "SecretLeak"
  /** A wallet link was refused: bad or foreign signature, expired or reused nonce. */
  | "LinkRejected"
  /** An HTTP request carries no valid session. */
  | "Unauthenticated"
  /** A request body or query failed validation. */
  | "InvalidRequest"
  /** A position the web reported does not exist on-chain as reported. */
  | "PositionUnverified"
  /** The athlete revoked AgentHabit's access, or Strava refused the refresh token (A-10). */
  | "StravaRevoked"
  /** The athlete did not grant `activity:read_all`. */
  | "StravaScopeMissing"
  /** Strava's read limit is used up, or it answered 429. */
  | "StravaRateLimited"
  /** Strava answered something that does not match its documented shape. */
  | "StravaResponseInvalid"
  /** A week's reading could not be completed, so it must not be used to settle (spec 4.6). */
  | "StravaIncompleteRead"
  /** The database answered something its schema rules out. */
  | "DatabaseError"
  /** A stored token does not decrypt with TOKEN_ENCRYPTION_KEY. */
  | "TokenDecryptFailed";

/** Structured, non-secret context attached to an error for logs and tests. */
export type AgentHabitErrorDetails = Readonly<Record<string, unknown>>;

export interface AgentHabitErrorOptions {
  readonly cause?: unknown;
  readonly details?: AgentHabitErrorDetails;
}

export class AgentHabitError extends Error {
  override readonly name = "AgentHabitError";
  readonly code: AgentHabitErrorCode;
  readonly details: AgentHabitErrorDetails;

  constructor(code: AgentHabitErrorCode, message: string, options: AgentHabitErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.details = options.details ?? {};
  }
}

/**
 * Narrowing guard. Not `instanceof` alone: a runner started without the
 * `@agenthabit/source` condition can load two copies of the class (src and dist).
 */
export function isAgentHabitError(value: unknown): value is AgentHabitError {
  if (value instanceof AgentHabitError) {
    return true;
  }
  return (
    value instanceof Error &&
    value.name === "AgentHabitError" &&
    "code" in value &&
    typeof value.code === "string" &&
    "details" in value &&
    typeof value.details === "object" &&
    value.details !== null
  );
}

/** True when `value` is an AgentHabitError carrying exactly `code`. */
export function hasErrorCode<C extends AgentHabitErrorCode>(
  value: unknown,
  code: C,
): value is AgentHabitError & { readonly code: C } {
  return isAgentHabitError(value) && value.code === code;
}
