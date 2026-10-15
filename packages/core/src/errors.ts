/**
 * Every failure AgentHabit raises is an {@link AgentHabitError} carrying a
 * machine-readable `code`. Callers branch on `code`, never on message text.
 *
 * New codes are added here as the tasks that need them land; the union is the
 * single source of truth for what can go wrong across packages and apps.
 */
export type AgentHabitErrorCode =
  /** Local configuration is missing, malformed or internally inconsistent. */
  "ConfigError";

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
    typeof value.details === "object"
  );
}

/** True when `value` is an AgentHabitError carrying exactly `code`. */
export function hasErrorCode<C extends AgentHabitErrorCode>(
  value: unknown,
  code: C,
): value is AgentHabitError & { readonly code: C } {
  return isAgentHabitError(value) && value.code === code;
}
