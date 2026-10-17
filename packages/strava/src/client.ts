import {
  type ActivitySummary,
  AgentHabitError,
  type WeekParams,
  weekEnd,
  weekStart,
  weekTotal,
} from "@agenthabit/core";
import type { z } from "zod";

import { isExhausted, parseReadLimit, type ReadLimit } from "./rate-limit.js";
import {
  ActivityPageSchema,
  FaultSchema,
  REQUIRED_SCOPE,
  type SummaryActivity,
  scopeList,
  TokenExchangeSchema,
  type TokenRefresh,
  TokenRefreshSchema,
} from "./schemas.js";

/**
 * The Strava client (docs/integraciones/strava.md). Tokens only ever travel in the
 * `Authorization` header or a form body, never in a URL, and no error message or detail carries
 * one. Every response goes through zod before anything reads it.
 */
export interface StravaClientOptions {
  readonly clientId: string;
  readonly clientSecret: string;
  /** `https://www.strava.com/api/v3` today; `https://api-v3.strava.com` from 2027-01-04. */
  readonly apiBaseUrl: string;
  readonly oauthBaseUrl: string;
  readonly fetch?: typeof fetch;
}

export const DEFAULT_API_BASE_URL = "https://www.strava.com/api/v3";
export const DEFAULT_OAUTH_BASE_URL = "https://www.strava.com/oauth";

/** Small pages, read until an empty one: the real `per_page` maximum is not measured yet. */
const PER_PAGE = 30;
/** A week of a single runner never fills this; reaching it means something is wrong. */
const MAX_PAGES = 20;

export interface Tokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface Connection extends Tokens {
  readonly athleteId: bigint;
  readonly scope: string;
}

export interface WeekReading {
  readonly totalM: bigint;
  readonly countedIds: readonly string[];
  /** The read limit after the last page, when Strava reported it. */
  readonly readLimit: ReadLimit | null;
}

function toTokens(body: TokenRefresh): Tokens {
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: new Date(body.expires_at * 1000),
  };
}

function toActivity(raw: SummaryActivity): ActivitySummary {
  return {
    id: String(raw.id),
    sportType: raw.sport_type,
    distanceM: raw.distance,
    movingTimeS: raw.moving_time,
    startDate: raw.start_date === undefined ? undefined : new Date(raw.start_date),
    trainer: raw.trainer,
    manual: raw.manual,
    deviceName: raw.device_name,
    uploadId: raw.upload_id === undefined || raw.upload_id === null ? null : String(raw.upload_id),
  };
}

export class StravaClient {
  readonly #options: StravaClientOptions;
  readonly #fetch: typeof fetch;

  constructor(options: StravaClientOptions) {
    this.#options = options;
    this.#fetch = options.fetch ?? fetch;
  }

  /** Where the web sends the athlete to authorize AgentHabit, with `activity:read_all`. */
  authorizeUrl(redirectUri: string, state: string): string {
    const url = new URL(`${this.#options.oauthBaseUrl}/authorize`);
    url.search = new URLSearchParams({
      client_id: this.#options.clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      approval_prompt: "auto",
      scope: `read,${REQUIRED_SCOPE}`,
      state,
    }).toString();
    return url.toString();
  }

  /**
   * Exchanges the redirect's code for tokens. The scope the athlete accepted must include
   * `activity:read_all`, both in the redirect and in the token response (spec 4.5, D2).
   */
  async exchangeCode(code: string, redirectScope: string): Promise<Connection> {
    if (!scopeList(redirectScope).includes(REQUIRED_SCOPE)) {
      throw new AgentHabitError(
        "StravaScopeMissing",
        "The athlete did not grant activity:read_all",
        {
          details: { scope: redirectScope },
        },
      );
    }
    const response = await this.#token({ grant_type: "authorization_code", code });
    if (!response.ok) throw await this.#failure(response, "token exchange");
    const body = await this.#parse(response, TokenExchangeSchema, "token exchange");
    if (!scopeList(body.scope).includes(REQUIRED_SCOPE)) {
      throw new AgentHabitError(
        "StravaScopeMissing",
        "The token does not carry activity:read_all",
        {
          details: { scope: body.scope },
        },
      );
    }
    return {
      ...toTokens(body),
      athleteId: BigInt(body.athlete.id),
      scope: body.scope,
    };
  }

  /**
   * Renews the tokens. Strava may rotate the refresh token, invalidating the old one at once:
   * the caller must store the result atomically before using it.
   *
   * A refused refresh is a revocation (A-10) only when Strava says so in its documented error
   * shape: a 400 or 401 whose `Fault` names the refresh token as invalid. A 429, a 5xx, a network
   * failure or any other body is a passing error that only skips the position (spec 4.6). The
   * exact body is still to be measured with the user's account (strava.md, test 8.5).
   */
  async refresh(refreshToken: string): Promise<Tokens> {
    const response = await this.#token({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (response.ok) {
      return toTokens(await this.#parse(response, TokenRefreshSchema, "token refresh"));
    }
    if (response.status === 400 || response.status === 401) {
      const fault = FaultSchema.safeParse(await response.json().catch(() => null));
      const namesRefreshToken =
        fault.success &&
        (fault.data.errors ?? []).some(
          (error) =>
            error.field === "refresh_token" &&
            (error.code === "invalid" || error.code === "revoked"),
        );
      if (namesRefreshToken) {
        throw new AgentHabitError("StravaRevoked", "Strava refused the refresh token", {
          details: { status: response.status },
        });
      }
      throw new AgentHabitError("StravaResponseInvalid", "Strava refused the refresh unclearly", {
        details: { status: response.status },
      });
    }
    throw await this.#failure(response, "token refresh");
  }

  /** Revokes AgentHabit's access (POST /oauth/revoke, HTTP Basic). The web's "disconnect". */
  async revoke(accessToken: string): Promise<void> {
    const basic = Buffer.from(`${this.#options.clientId}:${this.#options.clientSecret}`).toString(
      "base64",
    );
    const response = await this.#request(`${this.#options.oauthBaseUrl}/revoke`, {
      method: "POST",
      headers: {
        authorization: `Basic ${basic}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ token: accessToken, token_type_hint: "access_token" }),
    });
    if (!response.ok) throw await this.#failure(response, "revoke");
  }

  /**
   * Reads the athlete's activities for week `weekId` and adds up the valid runs (spec 4.5). Pages
   * until an empty one. Any gap (an error, a used-up limit, a malformed page, an activity the
   * filters cannot judge) throws, so a partial week is never used to settle (spec 4.6).
   */
  async readWeek(accessToken: string, weekId: bigint, params: WeekParams): Promise<WeekReading> {
    // A second of margin on each side: Strava does not document whether `after` and `before`
    // are inclusive. The exact half-open window is applied locally on `start_date`.
    const after = weekStart(weekId, params) - 1n;
    const before = weekEnd(weekId, params) + 1n;
    const activities: ActivitySummary[] = [];
    let readLimit: ReadLimit | null = null;

    for (let page = 1; page <= MAX_PAGES; page++) {
      if (readLimit !== null && isExhausted(readLimit)) {
        throw new AgentHabitError("StravaRateLimited", "Strava's read limit is used up", {
          details: { ...readLimit },
        });
      }
      const url = new URL(`${this.#options.apiBaseUrl}/athlete/activities`);
      url.search = new URLSearchParams({
        after: after.toString(),
        before: before.toString(),
        page: String(page),
        per_page: String(PER_PAGE),
      }).toString();
      const response = await this.#request(url.toString(), {
        headers: { authorization: `Bearer ${accessToken}` },
      });
      readLimit = parseReadLimit(response.headers) ?? readLimit;
      if (!response.ok) throw await this.#failure(response, "activities");
      const items = await this.#parse(response, ActivityPageSchema, "activities");
      if (items.length === 0) {
        const total = weekTotal(activities, weekId, params);
        if (total.incomplete.length > 0) {
          throw new AgentHabitError(
            "StravaIncompleteRead",
            "An activity lacks a field the filters need",
            {
              details: { missing: [...new Set(total.incomplete.map((entry) => entry.missing))] },
            },
          );
        }
        return { totalM: total.totalM, countedIds: total.countedIds, readLimit };
      }
      activities.push(...items.map(toActivity));
    }
    throw new AgentHabitError("StravaIncompleteRead", "Too many pages for one week", {
      details: { pages: MAX_PAGES },
    });
  }

  async #token(grant: Record<string, string>): Promise<Response> {
    return this.#request(`${this.#options.oauthBaseUrl}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#options.clientId,
        client_secret: this.#options.clientSecret,
        ...grant,
      }),
    });
  }

  async #request(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.#fetch(url, init);
    } catch (cause) {
      throw new AgentHabitError("NetworkError", "Strava could not be reached", { cause });
    }
  }

  async #parse<T extends z.ZodType>(
    response: Response,
    schema: T,
    what: string,
  ): Promise<z.infer<T>> {
    const parsed = schema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
      // Only the paths of the issues: never the values, which are Strava data or tokens.
      throw new AgentHabitError(
        "StravaResponseInvalid",
        `Strava ${what} does not match its shape`,
        {
          details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
        },
      );
    }
    return parsed.data;
  }

  async #failure(response: Response, what: string): Promise<AgentHabitError> {
    if (response.status === 429) {
      return new AgentHabitError("StravaRateLimited", `Strava rate-limited the ${what}`, {
        details: { status: 429 },
      });
    }
    if (response.status >= 500) {
      return new AgentHabitError("NetworkError", `Strava failed the ${what}`, {
        details: { status: response.status },
      });
    }
    return new AgentHabitError("StravaResponseInvalid", `Strava refused the ${what}`, {
      details: { status: response.status },
    });
  }
}
