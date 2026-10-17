import {
  type AgentHabitErrorCode,
  hasErrorCode,
  type WeekParams,
  weekEnd,
  weekStart,
} from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { DEFAULT_API_BASE_URL, DEFAULT_OAUTH_BASE_URL, StravaClient } from "../src/client.js";

// A simulated Strava. Synthetic tokens, ids and runs only (CLAUDE.md, rule 5).
const ACCESS = "synthetic-access-token-AAAA";
const REFRESH = "synthetic-refresh-token-RRRR";
const SECRET = "synthetic-client-secret-SSSS";

interface Call {
  readonly url: string;
  readonly init: RequestInit;
}

type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

function fakeStrava(replies: Reply[]) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init: init ?? {} });
    const reply = replies.shift();
    if (reply === undefined) throw new Error("the test did not expect another request");
    if (reply instanceof Error) throw reply;
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { "content-type": "application/json", ...reply.headers },
    });
  };
  const client = new StravaClient({
    clientId: "12345",
    clientSecret: SECRET,
    apiBaseUrl: DEFAULT_API_BASE_URL,
    oauthBaseUrl: DEFAULT_OAUTH_BASE_URL,
    fetch: fetchImpl,
  });
  return { client, calls };
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return "no error";
}

/** Nothing secret may reach a URL, an error message or its details. */
function expectNoSecrets(value: unknown) {
  const text = JSON.stringify(value, Object.getOwnPropertyNames(value ?? {})) + String(value);
  for (const secret of [ACCESS, REFRESH, SECRET]) expect(text).not.toContain(secret);
}

const tokenBody = {
  token_type: "Bearer",
  access_token: ACCESS,
  refresh_token: REFRESH,
  expires_at: 1_800_000_000,
  expires_in: 21_600,
  scope: "read,activity:read_all",
  athlete: { id: 777, firstname: "Synthetic", city: "Nowhere" },
};

describe("authorizeUrl", () => {
  it("asks for activity:read_all and carries no secret", () => {
    const { client } = fakeStrava([]);
    const url = new URL(client.authorizeUrl("http://localhost:5173/strava/callback", "state-1"));

    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("read,activity:read_all");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("response_type")).toBe("code");
    expectNoSecrets(url.toString());
  });
});

describe("exchangeCode", () => {
  it("returns the tokens and keeps only the athlete id", async () => {
    const { client, calls } = fakeStrava([{ status: 200, body: tokenBody }]);
    const connection = await client.exchangeCode("code-1", "read,activity:read_all");

    expect(connection).toEqual({
      accessToken: ACCESS,
      refreshToken: REFRESH,
      expiresAt: new Date(1_800_000_000_000),
      athleteId: 777n,
      scope: "read,activity:read_all",
    });
    expect(calls[0]?.url).toBe("https://www.strava.com/oauth/token");
    expect(String(calls[0]?.init.body)).toContain("grant_type=authorization_code");
  });

  it("refuses a redirect without activity:read_all, before calling Strava", async () => {
    const { client, calls } = fakeStrava([]);

    const error = await failure(client.exchangeCode("code-1", "read,activity:read"));
    expect(hasErrorCode(error, "StravaScopeMissing")).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it("accepts a space-separated scope", async () => {
    const { client } = fakeStrava([
      { status: 200, body: { ...tokenBody, scope: "read activity:read_all" } },
    ]);

    await expect(client.exchangeCode("code-1", "read activity:read_all")).resolves.toMatchObject({
      athleteId: 777n,
    });
  });

  it("refuses a token whose scope lacks activity:read_all", async () => {
    const { client } = fakeStrava([
      { status: 200, body: { ...tokenBody, scope: "read,activity:read" } },
    ]);

    const error = await failure(client.exchangeCode("code-1", "read,activity:read_all"));
    expect(hasErrorCode(error, "StravaScopeMissing")).toBe(true);
    expectNoSecrets(error);
  });

  it("refuses a token response with no scope at all (D2)", async () => {
    const { scope: _scope, ...withoutScope } = tokenBody;
    const { client } = fakeStrava([{ status: 200, body: withoutScope }]);

    const error = await failure(client.exchangeCode("code-1", "read,activity:read_all"));
    expect(hasErrorCode(error, "StravaResponseInvalid")).toBe(true);
    expectNoSecrets(error);
  });
});

describe("refresh", () => {
  const rotated = { ...tokenBody, refresh_token: "synthetic-refresh-token-NEXT" };

  it("returns the rotated refresh token", async () => {
    const { client, calls } = fakeStrava([{ status: 200, body: rotated }]);

    await expect(client.refresh(REFRESH)).resolves.toMatchObject({
      refreshToken: "synthetic-refresh-token-NEXT",
    });
    expect(String(calls[0]?.init.body)).toContain("grant_type=refresh_token");
    expect(calls[0]?.url).not.toContain(REFRESH);
  });

  it("treats a refresh token Strava names as invalid as a revocation (A-10)", async () => {
    const body = {
      message: "Bad Request",
      errors: [{ resource: "RefreshToken", field: "refresh_token", code: "invalid" }],
    };
    const { client } = fakeStrava([{ status: 400, body }]);

    const error = await failure(client.refresh(REFRESH));
    expect(hasErrorCode(error, "StravaRevoked")).toBe(true);
    expectNoSecrets(error);
  });

  it("does not treat an unclear refusal as a revocation: it only skips the position", async () => {
    const cases: Reply[] = [
      { status: 400, body: { message: "Bad Request" } },
      { status: 401, body: "not a fault" },
      { status: 400, body: { errors: [{ field: "client_id", code: "invalid" }] } },
    ];
    for (const reply of cases) {
      const { client } = fakeStrava([reply]);
      const error = await failure(client.refresh(REFRESH));
      expect(hasErrorCode(error, "StravaRevoked")).toBe(false);
      expect(hasErrorCode(error, "StravaResponseInvalid")).toBe(true);
    }
  });

  it("reports a 429, a 5xx and a network failure as passing errors", async () => {
    const limited = await failure(fakeStrava([{ status: 429, body: {} }]).client.refresh(REFRESH));
    const down = await failure(fakeStrava([{ status: 503, body: {} }]).client.refresh(REFRESH));
    const offline = await failure(
      fakeStrava([new TypeError("fetch failed")]).client.refresh(REFRESH),
    );

    expect(hasErrorCode(limited, "StravaRateLimited")).toBe(true);
    expect(hasErrorCode(down, "NetworkError")).toBe(true);
    expect(hasErrorCode(offline, "NetworkError")).toBe(true);
  });
});

describe("revoke", () => {
  it("uses /oauth/revoke with HTTP Basic, and the token travels in the body", async () => {
    const { client, calls } = fakeStrava([{ status: 200 }]);
    await client.revoke(ACCESS);

    const call = calls[0];
    expect(call?.url).toBe("https://www.strava.com/oauth/revoke");
    expect(call?.url).not.toContain(ACCESS);
    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toBe(
      `Basic ${Buffer.from(`12345:${SECRET}`).toString("base64")}`,
    );
    expect(String(call?.init.body)).toContain(`token=${ACCESS}`);
  });
});

describe("readWeek", () => {
  const params: WeekParams = {
    weekAnchor: 1_000_000n,
    weekLen: 604_800n,
    grace: 172_800n,
    staleAfter: 604_800n,
  };
  const startS = Number(weekStart(2n, params));
  const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
  const activity = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    sport_type: "Run",
    distance: 5_000.9,
    moving_time: 1_800,
    start_date: iso(startS + 60 * id),
    trainer: false,
    manual: false,
    device_name: "Synthetic Watch",
    upload_id: 9_000 + id,
    name: "fields we do not read are stripped",
    ...overrides,
  });
  const limits = (usage: string) => ({
    "X-ReadRateLimit-Limit": "100,1000",
    "X-ReadRateLimit-Usage": usage,
  });

  it("pages until an empty page and adds up the valid runs in whole metres", async () => {
    const { client, calls } = fakeStrava([
      {
        status: 200,
        body: [activity(1), activity(2), activity(3, { sport_type: "Ride" })],
        headers: limits("1,1"),
      },
      { status: 200, body: [activity(4)], headers: limits("2,2") },
      { status: 200, body: [], headers: limits("3,3") },
    ]);
    const reading = await client.readWeek(ACCESS, 2n, params);

    expect(reading.totalM).toBe(15_000n);
    expect(reading.countedIds).toEqual(["1", "2", "4"]);
    expect(reading.readLimit).toEqual({
      shortLimit: 100,
      dailyLimit: 1000,
      shortUsage: 3,
      dailyUsage: 3,
    });
    expect(calls).toHaveLength(3);
  });

  it("asks for the week with a second of margin and sends the token only in the header", async () => {
    const { client, calls } = fakeStrava([{ status: 200, body: [] }]);
    await client.readWeek(ACCESS, 2n, params);

    const url = new URL(calls[0]?.url ?? "");
    expect(url.pathname).toBe("/api/v3/athlete/activities");
    expect(url.searchParams.get("after")).toBe(String(weekStart(2n, params) - 1n));
    expect(url.searchParams.get("before")).toBe(String(weekEnd(2n, params) + 1n));
    expect(url.searchParams.get("page")).toBe("1");
    expect(calls[0]?.url).not.toContain(ACCESS);
    expect(new Headers(calls[0]?.init.headers).get("authorization")).toBe(`Bearer ${ACCESS}`);
  });

  it("stops before the next page when the read limit is used up", async () => {
    const { client, calls } = fakeStrava([
      { status: 200, body: [activity(1)], headers: limits("100,500") },
    ]);

    const error = await failure(client.readWeek(ACCESS, 2n, params));
    expect(hasErrorCode(error, "StravaRateLimited")).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it("never returns a partial week: a 429, a 5xx or a malformed page midway throws", async () => {
    const cases: [Reply, AgentHabitErrorCode][] = [
      [{ status: 429, body: {} }, "StravaRateLimited"],
      [{ status: 502, body: {} }, "NetworkError"],
      [{ status: 200, body: [{ id: "not-a-number" }] }, "StravaResponseInvalid"],
      [{ status: 401, body: { message: "Authorization Error" } }, "StravaResponseInvalid"],
    ];
    for (const [reply, code] of cases) {
      const { client } = fakeStrava([{ status: 200, body: [activity(1)] }, reply]);
      const error = await failure(client.readWeek(ACCESS, 2n, params));
      expect(hasErrorCode(error, code), code).toBe(true);
      expectNoSecrets(error);
    }
  });

  it("throws when a run lacks a field the filters need (D3)", async () => {
    const { manual: _manual, ...withoutManual } = activity(1);
    const { client } = fakeStrava([
      { status: 200, body: [withoutManual] },
      { status: 200, body: [] },
    ]);

    const error = await failure(client.readWeek(ACCESS, 2n, params));
    expect(hasErrorCode(error, "StravaIncompleteRead")).toBe(true);
  });

  it("accepts a start_date with an offset, and reads it in UTC", async () => {
    const shifted = new Date((startS + 3_600) * 1000);
    const withOffset = `${new Date(shifted.getTime() - 3 * 3_600_000).toISOString().slice(0, 19)}-03:00`;
    const { client } = fakeStrava([
      { status: 200, body: [activity(1, { start_date: withOffset })] },
      { status: 200, body: [] },
    ]);

    await expect(client.readWeek(ACCESS, 2n, params)).resolves.toMatchObject({ countedIds: ["1"] });
  });

  it("gives up after too many pages instead of reading forever", async () => {
    const full = Array.from({ length: 20 }, () => ({ status: 200, body: [activity(1)] }));
    const { client } = fakeStrava(full);

    const error = await failure(client.readWeek(ACCESS, 2n, params));
    expect(hasErrorCode(error, "StravaIncompleteRead")).toBe(true);
  });
});
