import { randomBytes } from "node:crypto";

import { AgentHabitError, hasErrorCode } from "@agenthabit/core";
import {
  type Database,
  decryptToken,
  encryptToken,
  findStravaConnection,
  markStravaRevoked,
  parseTokenKey,
  saveStravaConnection,
} from "@agenthabit/db";
import { createTestDatabase } from "@agenthabit/db/testing";
import type { Tokens } from "@agenthabit/strava";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { freshAccessToken, type TokenRefresher } from "../src/strava-tokens.js";

// A simulated Strava and synthetic tokens only.
const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));
const NOW = new Date("2026-10-19T03:00:00.000Z");
const HOUR = 3_600_000;

let db: Database;
let close: () => Promise<void>;
let refreshCalls: string[];

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
  refreshCalls = [];
});

afterEach(async () => {
  await close();
});

async function connect(expiresAt: Date) {
  await saveStravaConnection(
    db,
    {
      athleteId: 777n,
      scope: "read,activity:read_all",
      accessTokenEnc: encryptToken("access-1", tokenKey),
      refreshTokenEnc: encryptToken("refresh-1", tokenKey),
      expiresAt,
    },
    NOW,
  );
}

function refresher(reply: () => Promise<Tokens>): TokenRefresher {
  return {
    refresh: async (refreshToken) => {
      refreshCalls.push(refreshToken);
      return reply();
    },
  };
}

const rotated = async (): Promise<Tokens> => ({
  accessToken: "access-2",
  refreshToken: "refresh-2",
  expiresAt: new Date(NOW.getTime() + 6 * HOUR),
});

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return "no error";
}

describe("freshAccessToken", () => {
  it("returns the stored token while it has time left, without calling Strava", async () => {
    await connect(new Date(NOW.getTime() + 2 * HOUR));
    const token = await freshAccessToken(
      { db, tokenKey, strava: refresher(rotated), now: () => NOW },
      777n,
    );

    expect(token).toBe("access-1");
    expect(refreshCalls).toEqual([]);
  });

  it("renews a token about to expire and stores the rotated refresh token, encrypted", async () => {
    await connect(new Date(NOW.getTime() + 60_000));
    const token = await freshAccessToken(
      { db, tokenKey, strava: refresher(rotated), now: () => NOW },
      777n,
    );

    expect(token).toBe("access-2");
    expect(refreshCalls).toEqual(["refresh-1"]);
    const stored = await findStravaConnection(db, 777n);
    expect(stored?.refreshTokenEnc).not.toContain("refresh-2");
    expect(decryptToken(stored?.refreshTokenEnc ?? "", tokenKey)).toBe("refresh-2");
    expect(decryptToken(stored?.accessTokenEnc ?? "", tokenKey)).toBe("access-2");
  });

  it("marks the connection revoked when Strava refuses the refresh token (A-10)", async () => {
    await connect(new Date(NOW.getTime() - HOUR));
    const strava = refresher(async () => {
      throw new AgentHabitError("StravaRevoked", "refused");
    });

    const error = await failure(freshAccessToken({ db, tokenKey, strava, now: () => NOW }, 777n));

    expect(hasErrorCode(error, "StravaRevoked")).toBe(true);
    expect(await findStravaConnection(db, 777n)).toMatchObject({
      refreshTokenEnc: null,
      revokedAt: NOW,
    });
  });

  it("keeps the tokens untouched after a passing failure, so the next run can retry", async () => {
    await connect(new Date(NOW.getTime() - HOUR));
    const strava = refresher(async () => {
      throw new AgentHabitError("NetworkError", "down");
    });

    const error = await failure(freshAccessToken({ db, tokenKey, strava, now: () => NOW }, 777n));

    expect(hasErrorCode(error, "NetworkError")).toBe(true);
    const stored = await findStravaConnection(db, 777n);
    expect(stored?.revokedAt).toBeNull();
    expect(decryptToken(stored?.refreshTokenEnc ?? "", tokenKey)).toBe("refresh-1");
  });

  it("uses the winner's token when a concurrent renewal stored its pair first", async () => {
    await connect(new Date(NOW.getTime() - HOUR));
    // While our refresh is in flight, another process renews and stores its own pair.
    const strava = refresher(async () => {
      await saveStravaConnection(
        db,
        {
          athleteId: 777n,
          scope: "read,activity:read_all",
          accessTokenEnc: encryptToken("access-winner", tokenKey),
          refreshTokenEnc: encryptToken("refresh-winner", tokenKey),
          expiresAt: new Date(NOW.getTime() + 6 * HOUR),
        },
        NOW,
      );
      return rotated();
    });

    const token = await freshAccessToken({ db, tokenKey, strava, now: () => NOW }, 777n);

    expect(token).toBe("access-winner");
    expect(
      decryptToken((await findStravaConnection(db, 777n))?.refreshTokenEnc ?? "", tokenKey),
    ).toBe("refresh-winner");
  });

  it("does not call a missing connection a revocation: it only skips the read", async () => {
    const error = await failure(
      freshAccessToken({ db, tokenKey, strava: refresher(rotated), now: () => NOW }, 1n),
    );

    expect(hasErrorCode(error, "StravaRevoked")).toBe(false);
    expect(hasErrorCode(error, "DatabaseError")).toBe(true);
  });

  it("does not revoke when it lost a race and Strava refused its stale refresh token", async () => {
    await connect(new Date(NOW.getTime() - HOUR));
    // The winner rotates and stores its pair; Strava then refuses our old refresh token.
    const strava = refresher(async () => {
      await saveStravaConnection(
        db,
        {
          athleteId: 777n,
          scope: "read,activity:read_all",
          accessTokenEnc: encryptToken("access-winner", tokenKey),
          refreshTokenEnc: encryptToken("refresh-winner", tokenKey),
          expiresAt: new Date(NOW.getTime() + 6 * HOUR),
        },
        NOW,
      );
      throw new AgentHabitError("StravaRevoked", "invalid refresh token");
    });

    const token = await freshAccessToken({ db, tokenKey, strava, now: () => NOW }, 777n);

    expect(token).toBe("access-winner");
    const stored = await findStravaConnection(db, 777n);
    expect(stored?.revokedAt).toBeNull();
    expect(decryptToken(stored?.refreshTokenEnc ?? "", tokenKey)).toBe("refresh-winner");
  });

  it("reports a revoked connection as revoked", async () => {
    await connect(new Date(NOW.getTime() + 2 * HOUR));
    await markStravaRevoked(db, 777n, NOW);

    const error = await failure(
      freshAccessToken({ db, tokenKey, strava: refresher(rotated), now: () => NOW }, 777n),
    );
    expect(hasErrorCode(error, "StravaRevoked")).toBe(true);
    expect(refreshCalls).toEqual([]);
  });
});
