import {
  AgentHabitError,
  type AgentHabitErrorCode,
  ChallengeResponseSchema,
  ConfigResponseSchema,
  ErrorResponseSchema,
  MeResponseSchema,
  PreparedTxResponseSchema,
  type ReportPositionRequestSchema,
  ReportPositionResponseSchema,
  StravaCallbackResponseSchema,
  StravaConnectResponseSchema,
  StravaDisconnectResponseSchema,
  SubmitTxResponseSchema,
  VerifyResponseSchema,
  WeeksResponseSchema,
} from "@agenthabit/core";
import type { z } from "zod";
import { KNOWN_ERROR_CODES } from "./messages.js";

/**
 * The web's side of `packages/core/src/api-contract.ts`. Every response is parsed with the same
 * zod schema the API answers with; a body that does not match is an error, never a guess.
 *
 * The session token goes in the `Authorization` header and nowhere else: not in a URL, not in a
 * log, not in an error. A 401 on a request that carried a token means the session is gone.
 */

export interface ApiClientOptions {
  readonly baseUrl: string;
  /** Injected for tests; defaults to the browser's `fetch`. */
  readonly fetch?: typeof fetch;
  readonly getToken: () => string | null;
  /** Called once per 401 on an authenticated request, after which the caller drops the session. */
  readonly onUnauthorized: () => void;
}

interface RequestOptions<S extends z.ZodType> {
  readonly method: "GET" | "POST";
  readonly path: string;
  readonly schema: S;
  readonly body?: unknown;
  /** Sends the session token. Public endpoints leave it out. */
  readonly auth: boolean;
}

function isKnownCode(value: string): value is AgentHabitErrorCode {
  return (KNOWN_ERROR_CODES as readonly string[]).includes(value);
}

export function createApiClient(options: ApiClientOptions) {
  const doFetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function request<S extends z.ZodType>(req: RequestOptions<S>): Promise<z.infer<S>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (req.auth) {
      const token = options.getToken();
      if (token === null) {
        options.onUnauthorized();
        throw new AgentHabitError("Unauthenticated", "There is no session", {
          details: { path: req.path },
        });
      }
      headers.Authorization = `Bearer ${token}`;
    }
    if (req.body !== undefined) headers["Content-Type"] = "application/json";

    let response: Response;
    try {
      response = await doFetch(`${options.baseUrl}${req.path}`, {
        method: req.method,
        headers,
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
      });
    } catch (cause) {
      throw new AgentHabitError("NetworkError", "The API did not answer", {
        cause,
        details: { path: req.path },
      });
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = undefined;
    }

    if (!response.ok) {
      const failure = ErrorResponseSchema.safeParse(payload);
      const apiCode = failure.success ? failure.data.error : undefined;
      if (response.status === 401 && req.auth) options.onUnauthorized();
      const code: AgentHabitErrorCode =
        apiCode !== undefined && isKnownCode(apiCode)
          ? apiCode
          : response.status === 401
            ? "Unauthenticated"
            : "NetworkError";
      throw new AgentHabitError(code, `The API answered ${response.status}`, {
        details: { path: req.path, status: response.status },
      });
    }

    const parsed = req.schema.safeParse(payload);
    if (!parsed.success) {
      throw new AgentHabitError("NetworkError", "The API answered a shape the contract rules out", {
        details: { path: req.path, status: response.status },
      });
    }
    return parsed.data;
  }

  return {
    config: () =>
      request({ method: "GET", path: "/config", schema: ConfigResponseSchema, auth: false }),

    challenge: (address: string) =>
      request({
        method: "POST",
        path: "/link/challenge",
        schema: ChallengeResponseSchema,
        body: { chain: "stellar", address },
        auth: false,
      }),

    verify: (nonce: string, signature: string) =>
      request({
        method: "POST",
        path: "/link/verify",
        schema: VerifyResponseSchema,
        body: { nonce, signature },
        auth: false,
      }),

    me: () => request({ method: "GET", path: "/me", schema: MeResponseSchema, auth: true }),

    stravaConnect: () =>
      request({
        method: "GET",
        path: "/strava/connect",
        schema: StravaConnectResponseSchema,
        auth: true,
      }),

    stravaCallback: (body: { code: string; scope: string; state: string }) =>
      request({
        method: "POST",
        path: "/strava/callback",
        schema: StravaCallbackResponseSchema,
        body,
        auth: true,
      }),

    stravaDisconnect: () =>
      request({
        method: "POST",
        path: "/strava/disconnect",
        schema: StravaDisconnectResponseSchema,
        auth: true,
      }),

    weeks: () =>
      request({ method: "GET", path: "/weeks/me", schema: WeeksResponseSchema, auth: true }),

    buildCommit: (body: { amount: string; goalM: number }) =>
      request({
        method: "POST",
        path: "/tx/commit",
        schema: PreparedTxResponseSchema,
        body,
        auth: true,
      }),

    buildRelease: (weekId: string) =>
      request({
        method: "POST",
        path: "/tx/release",
        schema: PreparedTxResponseSchema,
        body: { weekId },
        auth: true,
      }),

    /** `GET /tx/{hash}`: where a submitted transaction stands (same shape as the submit answer). */
    txStatus: (hash: string) =>
      request({
        method: "GET",
        path: `/tx/${encodeURIComponent(hash)}`,
        schema: SubmitTxResponseSchema,
        auth: true,
      }),

    submit: (xdr: string) =>
      request({
        method: "POST",
        path: "/tx/submit",
        schema: SubmitTxResponseSchema,
        body: { xdr },
        auth: true,
      }),

    reportPosition: (body: z.infer<typeof ReportPositionRequestSchema>) =>
      request({
        method: "POST",
        path: "/positions",
        schema: ReportPositionResponseSchema,
        body,
        auth: true,
      }),
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
