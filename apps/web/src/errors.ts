/**
 * Failures that belong to the web itself, not to an API error code or to the wallet: something
 * the user should be told in plain words and, for most, simply retry.
 */
export type WebErrorCode =
  /** The API prepared a commit for another week than the one the user confirmed. */
  | "WeekChanged"
  /** The API prepared a release for another week than the one the user chose. */
  | "ReleaseWeekMismatch"
  /** A signed commit of this wallet is still waiting to be confirmed or recorded. */
  | "CommitPending"
  /** The API answered, but with something the contract rules out (5xx, unreadable body). */
  | "ServerResponse"
  /** `VITE_API_URL` or the instance's own data is unusable. */
  | "WebConfig";

export class WebError extends Error {
  override readonly name = "WebError";
  readonly code: WebErrorCode;
  /** The HTTP status, when the error comes from an answer of the API. */
  readonly status: number | undefined;

  constructor(code: WebErrorCode, message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    this.status = options?.status;
  }
}

export function isWebError(value: unknown): value is WebError {
  return value instanceof WebError;
}
