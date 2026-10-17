import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Database } from "../src/client.js";
import {
  consumeChallenge,
  createChallenge,
  createSession,
  findMirroredPosition,
  findSession,
  findStravaConnection,
  findStravaRead,
  markStravaRevoked,
  type PositionKey,
  purgeExpiredData,
  REVOKED_RETENTION_MS,
  recordSettlement,
  registerPosition,
  rotateStravaTokens,
  STRAVA_RETENTION_MS,
  saveStravaConnection,
  saveStravaRead,
} from "../src/repository.js";
import { createTestDatabase } from "../src/test-database.js";

// Synthetic data only: no real Strava ids, tokens or distances.
const NOW = new Date("2026-10-19T03:00:00Z");
const later = (ms: number) => new Date(NOW.getTime() + ms);
const MINUTE = 60_000;

let db: Database;
let close: () => Promise<void>;

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
});

afterEach(async () => {
  await close();
});

const key = (overrides: Partial<PositionKey> = {}): PositionKey => ({
  chain: "stellar",
  contract: "CSYNTHETICCONTRACT",
  user: "GSYNTHETICUSER",
  weekId: 3n,
  ...overrides,
});

describe("link challenges", () => {
  const challenge = {
    nonce: "nonce-1",
    chain: "avalanche" as const,
    address: "0x0000000000000000000000000000000000000001",
    message: "synthetic message",
    expiresAt: later(5 * MINUTE),
  };

  it("can be used once", async () => {
    await createChallenge(db, challenge);

    expect(await consumeChallenge(db, "nonce-1", NOW)).toMatchObject({
      address: challenge.address,
    });
    expect(await consumeChallenge(db, "nonce-1", later(MINUTE))).toBeNull();
  });

  it("cannot be used once it has expired", async () => {
    await createChallenge(db, challenge);

    expect(await consumeChallenge(db, "nonce-1", later(5 * MINUTE))).toBeNull();
  });

  it("does not exist for an unknown nonce", async () => {
    expect(await consumeChallenge(db, "never-issued", NOW)).toBeNull();
  });
});

describe("sessions", () => {
  it("are found by token hash until they expire", async () => {
    await createSession(db, {
      tokenHash: "hash-1",
      chain: "stellar",
      address: "GSYNTHETICUSER",
      expiresAt: later(MINUTE),
    });

    expect(await findSession(db, "hash-1", NOW)).toEqual({
      chain: "stellar",
      address: "GSYNTHETICUSER",
    });
    expect(await findSession(db, "hash-1", later(MINUTE))).toBeNull();
    expect(await findSession(db, "hash-2", NOW)).toBeNull();
  });
});

describe("Strava tokens", () => {
  const sealed = {
    accessTokenEnc: "v1.a",
    refreshTokenEnc: "v1.r1",
    expiresAt: later(360 * MINUTE),
  };

  it("rotate only from the refresh token that was refreshed", async () => {
    await saveStravaConnection(
      db,
      { athleteId: 42n, scope: "read,activity:read_all", ...sealed },
      NOW,
    );
    const next = {
      accessTokenEnc: "v1.b",
      refreshTokenEnc: "v1.r2",
      expiresAt: later(720 * MINUTE),
    };

    expect(await rotateStravaTokens(db, 42n, "v1.r1", next, NOW)).toBe(true);
    // A second refresh that started from the old token lost the race and changes nothing.
    expect(
      await rotateStravaTokens(db, 42n, "v1.r1", { ...next, refreshTokenEnc: "v1.r3" }, NOW),
    ).toBe(false);
    expect((await findStravaConnection(db, 42n))?.refreshTokenEnc).toBe("v1.r2");
  });

  it("are deleted on revocation, with the athlete's cached readings, and the date stays", async () => {
    await saveStravaConnection(
      db,
      { athleteId: 42n, scope: "read,activity:read_all", ...sealed },
      NOW,
    );
    await registerPosition(
      db,
      { ...key(), athleteId: 42n, amount: 200_000_000n, goalM: 10_000n, commitTxHash: "tx1" },
      NOW,
    );
    await registerPosition(
      db,
      {
        ...key({ user: "GOTHER" }),
        athleteId: 7n,
        amount: 200_000_000n,
        goalM: 10_000n,
        commitTxHash: "tx2",
      },
      NOW,
    );
    await saveStravaRead(db, { ...key(), totalM: 5_000n, activityIds: ["1"], readAt: NOW });
    await saveStravaRead(db, {
      ...key({ user: "GOTHER" }),
      totalM: 9_000n,
      activityIds: ["2"],
      readAt: NOW,
    });

    await markStravaRevoked(db, 42n, later(MINUTE));

    const connection = await findStravaConnection(db, 42n);
    expect(connection).toMatchObject({
      accessTokenEnc: null,
      refreshTokenEnc: null,
      revokedAt: later(MINUTE),
    });
    expect(await rotateStravaTokens(db, 42n, "v1.r1", sealed, NOW)).toBe(false);
    expect(await findStravaRead(db, key())).toBeNull();
    expect(await findStravaRead(db, key({ user: "GOTHER" }))).not.toBeNull();
  });

  it("are restored, and the revocation cleared, by a new connection", async () => {
    await saveStravaConnection(
      db,
      { athleteId: 42n, scope: "read,activity:read_all", ...sealed },
      NOW,
    );
    await markStravaRevoked(db, 42n, NOW);
    await saveStravaConnection(
      db,
      { athleteId: 42n, scope: "read,activity:read_all", ...sealed },
      later(MINUTE),
    );

    expect(await findStravaConnection(db, 42n)).toMatchObject({
      revokedAt: null,
      refreshTokenEnc: "v1.r1",
    });
  });
});

describe("the position mirror", () => {
  it("freezes the athlete of the first registration", async () => {
    const position = {
      ...key(),
      athleteId: 42n,
      amount: 500_000_000n,
      goalM: 21_097n,
      commitTxHash: "tx1",
    };
    await registerPosition(db, position, NOW);
    const second = await registerPosition(db, { ...position, athleteId: 99n }, later(MINUTE));

    expect(second).toMatchObject({
      athleteId: 42n,
      amount: "500000000",
      goalM: 21_097n,
      registeredAt: NOW,
    });
  });

  it("keeps production and rehearsal instances apart", async () => {
    const base = { athleteId: 42n, amount: 200_000_000n, goalM: 10_000n, commitTxHash: "tx" };
    await registerPosition(db, { ...key({ contract: "CPROD" }), ...base }, NOW);

    expect(await findMirroredPosition(db, key({ contract: "CREHEARSAL" }))).toBeNull();
    expect(await findMirroredPosition(db, key({ contract: "CPROD" }))).not.toBeNull();
  });
});

describe("purgeExpiredData", () => {
  it("deletes readings older than 7 days and keeps the fresh ones (POL 6.2)", async () => {
    await saveStravaRead(db, {
      ...key({ weekId: 1n }),
      totalM: 1n,
      activityIds: ["1"],
      readAt: NOW,
    });
    await saveStravaRead(db, {
      ...key({ weekId: 2n }),
      totalM: 2n,
      activityIds: ["2"],
      readAt: later(MINUTE),
    });

    const report = await purgeExpiredData(db, later(STRAVA_RETENTION_MS));

    expect(report.stravaReads).toBe(1);
    expect(await findStravaRead(db, key({ weekId: 1n }))).toBeNull();
    expect(await findStravaRead(db, key({ weekId: 2n }))).not.toBeNull();
  });

  it("deletes a reading and clears the frozen athlete once the position is settled live", async () => {
    await registerPosition(
      db,
      { ...key(), athleteId: 42n, amount: 200_000_000n, goalM: 10_000n, commitTxHash: "tx" },
      NOW,
    );
    await saveStravaRead(db, { ...key(), totalM: 12_000n, activityIds: ["1", "2"], readAt: NOW });
    const settlement = { ...key(), outcome: "met" as const, txHash: null, reason: "goal met" };

    // A dry-run first: nothing is settled yet, so nothing goes.
    await recordSettlement(db, { ...settlement, mode: "dry-run" }, later(MINUTE));
    expect((await purgeExpiredData(db, later(2 * MINUTE))).stravaReads).toBe(0);

    // Then the live settlement of the same position: a second record, not a clash.
    await recordSettlement(
      db,
      { ...settlement, mode: "live", txHash: "tx-live" },
      later(3 * MINUTE),
    );
    const report = await purgeExpiredData(db, later(4 * MINUTE));

    expect(report).toMatchObject({ stravaReads: 1, athleteIdsCleared: 1 });
    expect(await findStravaRead(db, key())).toBeNull();
    expect((await findMirroredPosition(db, key()))?.athleteId).toBeNull();
  });

  it("deletes a revoked connection after 30 days, and keeps it before (POL 7.4)", async () => {
    await saveStravaConnection(
      db,
      {
        athleteId: 42n,
        scope: "read,activity:read_all",
        accessTokenEnc: "a",
        refreshTokenEnc: "r",
        expiresAt: NOW,
      },
      NOW,
    );
    await markStravaRevoked(db, 42n, NOW);

    expect(
      (await purgeExpiredData(db, later(REVOKED_RETENTION_MS - MINUTE))).revokedConnections,
    ).toBe(0);
    expect((await purgeExpiredData(db, later(REVOKED_RETENTION_MS))).revokedConnections).toBe(1);
    expect(await findStravaConnection(db, 42n)).toBeNull();
  });

  it("deletes expired challenges, OAuth states and sessions", async () => {
    await createChallenge(db, {
      nonce: "n",
      chain: "stellar",
      address: "G",
      message: "m",
      expiresAt: later(MINUTE),
    });
    await createSession(db, {
      tokenHash: "h",
      chain: "stellar",
      address: "G",
      expiresAt: later(MINUTE),
    });

    expect(await purgeExpiredData(db, NOW)).toMatchObject({
      expiredChallenges: 0,
      expiredSessions: 0,
    });
    expect(await purgeExpiredData(db, later(MINUTE))).toMatchObject({
      expiredChallenges: 1,
      expiredSessions: 1,
    });
  });
});
