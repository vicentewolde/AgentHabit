import { AgentHabitError, hasErrorCode } from "@agenthabit/core";
import {
  type Database,
  decryptToken,
  encryptToken,
  findStravaConnection,
  markStravaRevoked,
  rotateStravaTokens,
  type TokenKey,
} from "@agenthabit/db";
import type { Tokens } from "@agenthabit/strava";

/** Renew a little before Strava's own expiry, so a read never starts with a dying token. */
const REFRESH_MARGIN_MS = 5 * 60_000;

export interface TokenRefresher {
  refresh(refreshToken: string): Promise<Tokens>;
}

/**
 * A usable access token for `athleteId`, renewing it when needed (spec 4.5). Strava may rotate
 * the refresh token and invalidates the old one at once, so the new pair is stored before the
 * access token is used, with a compare-and-swap that keeps two concurrent renewals from losing
 * one (`rotateStravaTokens`). A refresh Strava refuses as revoked marks the connection revoked
 * (A-10); any other failure leaves the tokens as they were and only skips this read.
 */
export async function freshAccessToken(
  deps: {
    readonly db: Database;
    readonly tokenKey: TokenKey;
    readonly strava: TokenRefresher;
    readonly now: () => Date;
  },
  athleteId: bigint,
): Promise<string> {
  const connection = await findStravaConnection(deps.db, athleteId);
  if (connection === null) {
    // Not a revocation: an unknown athlete only skips the position (spec 4.6).
    throw new AgentHabitError("DatabaseError", "No Strava connection for this athlete");
  }
  if (connection.revokedAt !== null) {
    throw new AgentHabitError("StravaRevoked", "The athlete revoked AgentHabit's access");
  }
  if (
    connection.accessTokenEnc === null ||
    connection.refreshTokenEnc === null ||
    connection.expiresAt === null
  ) {
    throw new AgentHabitError("DatabaseError", "A live Strava connection has no tokens");
  }
  if (connection.expiresAt.getTime() - REFRESH_MARGIN_MS > deps.now().getTime()) {
    return decryptToken(connection.accessTokenEnc, deps.tokenKey);
  }

  const previousRefreshTokenEnc = connection.refreshTokenEnc;
  let next: Tokens;
  try {
    next = await deps.strava.refresh(decryptToken(previousRefreshTokenEnc, deps.tokenKey));
  } catch (error) {
    if (!hasErrorCode(error, "StravaRevoked")) throw error;
    // Revoke only if our refresh token is still the stored one. Otherwise a concurrent renewal
    // rotated it, Strava refused ours as stale, and the winner's token is the one to use.
    const revoked = await markStravaRevoked(
      deps.db,
      athleteId,
      deps.now(),
      previousRefreshTokenEnc,
    );
    if (revoked) throw error;
    return currentAccessToken(deps, athleteId);
  }
  const stored = await rotateStravaTokens(
    deps.db,
    athleteId,
    previousRefreshTokenEnc,
    {
      accessTokenEnc: encryptToken(next.accessToken, deps.tokenKey),
      refreshTokenEnc: encryptToken(next.refreshToken, deps.tokenKey),
      expiresAt: next.expiresAt,
    },
    deps.now(),
  );
  // Another renewal won the race and stored its own pair: use that one.
  return stored ? next.accessToken : currentAccessToken(deps, athleteId);
}

async function currentAccessToken(
  deps: { readonly db: Database; readonly tokenKey: TokenKey },
  athleteId: bigint,
): Promise<string> {
  const winner = await findStravaConnection(deps.db, athleteId);
  if (winner === null || winner.accessTokenEnc === null) {
    if (winner?.revokedAt != null) {
      throw new AgentHabitError("StravaRevoked", "The connection was revoked during the renewal");
    }
    throw new AgentHabitError("DatabaseError", "The connection vanished during the renewal");
  }
  return decryptToken(winner.accessTokenEnc, deps.tokenKey);
}
