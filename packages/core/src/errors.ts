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
  | "SecretLeak";

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
