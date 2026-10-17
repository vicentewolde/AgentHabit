import { AgentHabitError, type ChainId } from "@agenthabit/core";
import { and, eq, exists, gt, isNotNull, isNull, lte, or, sql } from "drizzle-orm";

import type { Database } from "./client.js";
import {
  linkChallenges,
  oauthStates,
  positions,
  sessions,
  settlements,
  stravaConnections,
  stravaReads,
  walletLinks,
} from "./schema.js";

/** How long Strava data may be kept (POL 6.2, spec 4.5). */
export const STRAVA_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** A revoked athlete's data goes within 30 days (POL 7.4). */
export const REVOKED_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

/** The key of the mirror, the settlement log and the Strava cache (spec 4.4). */
export interface PositionKey {
  readonly chain: ChainId;
  readonly contract: string;
  readonly user: string;
  readonly weekId: bigint;
}

function keyMatches(table: typeof positions | typeof stravaReads, key: PositionKey) {
  return and(
    eq(table.chain, key.chain),
    eq(table.contract, key.contract),
    eq(table.user, key.user),
    eq(table.weekId, key.weekId),
  );
}

// --- Wallet link: challenges, links and sessions -------------------------------------------

export interface NewChallenge {
  readonly nonce: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly message: string;
  readonly expiresAt: Date;
}

export async function createChallenge(db: Database, challenge: NewChallenge): Promise<void> {
  await db.insert(linkChallenges).values(challenge);
}

export type Challenge = typeof linkChallenges.$inferSelect;

/**
 * Marks a challenge used, in one statement, only if it is unused and unexpired. Two requests
 * racing with the same nonce cannot both succeed. Returns null when it cannot be used.
 */
export async function consumeChallenge(
  db: Database,
  nonce: string,
  now: Date,
): Promise<Challenge | null> {
  const [used] = await db
    .update(linkChallenges)
    .set({ usedAt: now })
    .where(
      and(
        eq(linkChallenges.nonce, nonce),
        isNull(linkChallenges.usedAt),
        gt(linkChallenges.expiresAt, now),
      ),
    )
    .returning();
  return used ?? null;
}

export async function findChallenge(db: Database, nonce: string): Promise<Challenge | null> {
  const [found] = await db.select().from(linkChallenges).where(eq(linkChallenges.nonce, nonce));
  return found ?? null;
}

export async function upsertWalletLink(
  db: Database,
  link: { readonly chain: ChainId; readonly address: string; readonly athleteId: bigint },
  now: Date,
): Promise<void> {
  await db
    .insert(walletLinks)
    .values({ ...link, linkedAt: now })
    .onConflictDoUpdate({
      target: [walletLinks.chain, walletLinks.address],
      set: { athleteId: link.athleteId, linkedAt: now },
    });
}

export async function findWalletLink(
  db: Database,
  chain: ChainId,
  address: string,
): Promise<{ athleteId: bigint } | null> {
  const [link] = await db
    .select({ athleteId: walletLinks.athleteId })
    .from(walletLinks)
    .where(and(eq(walletLinks.chain, chain), eq(walletLinks.address, address)));
  return link ?? null;
}

/**
 * Removes one wallet's link to `athleteId` and returns how many wallets still link to it, in one
 * transaction, so two disconnects cannot both see the other's link.
 */
export async function deleteWalletLink(
  db: Database,
  chain: ChainId,
  address: string,
  athleteId: bigint,
): Promise<number> {
  return db.transaction(async (tx) => {
    await tx
      .delete(walletLinks)
      .where(and(eq(walletLinks.chain, chain), eq(walletLinks.address, address)));
    const others = await tx
      .select({ address: walletLinks.address })
      .from(walletLinks)
      .where(eq(walletLinks.athleteId, athleteId));
    return others.length;
  });
}

export interface NewSession {
  readonly tokenHash: string;
  readonly chain: ChainId;
  readonly address: string;
  readonly expiresAt: Date;
}

export async function createSession(db: Database, session: NewSession): Promise<void> {
  await db.insert(sessions).values(session);
}

export async function findSession(
  db: Database,
  tokenHash: string,
  now: Date,
): Promise<{ chain: ChainId; address: string } | null> {
  const [session] = await db
    .select({ chain: sessions.chain, address: sessions.address })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, now)));
  return session ?? null;
}

export async function createOAuthState(
  db: Database,
  oauthState: {
    readonly state: string;
    readonly chain: ChainId;
    readonly address: string;
    readonly expiresAt: Date;
  },
): Promise<void> {
  await db.insert(oauthStates).values(oauthState);
}

/** Uses an OAuth state once, before it expires, in one statement. Null when it cannot be used. */
export async function consumeOAuthState(
  db: Database,
  state: string,
  now: Date,
): Promise<{ chain: ChainId; address: string } | null> {
  const [used] = await db
    .update(oauthStates)
    .set({ usedAt: now })
    .where(
      and(eq(oauthStates.state, state), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, now)),
    )
    .returning({ chain: oauthStates.chain, address: oauthStates.address });
  return used ?? null;
}

// --- Strava connection ----------------------------------------------------------------------

export type StravaConnection = typeof stravaConnections.$inferSelect;

export interface SealedTokens {
  readonly accessTokenEnc: string;
  readonly refreshTokenEnc: string;
  readonly expiresAt: Date;
}

/** A new or renewed connection after OAuth. It clears an earlier revocation. */
export async function saveStravaConnection(
  db: Database,
  connection: SealedTokens & { readonly athleteId: bigint; readonly scope: string },
  now: Date,
): Promise<void> {
  await db
    .insert(stravaConnections)
    .values({ ...connection, connectedAt: now, updatedAt: now, revokedAt: null })
    .onConflictDoUpdate({
      target: stravaConnections.athleteId,
      set: {
        accessTokenEnc: connection.accessTokenEnc,
        refreshTokenEnc: connection.refreshTokenEnc,
        expiresAt: connection.expiresAt,
        scope: connection.scope,
        connectedAt: now,
        updatedAt: now,
        revokedAt: null,
      },
    });
}

export async function findStravaConnection(
  db: Database,
  athleteId: bigint,
): Promise<StravaConnection | null> {
  const [connection] = await db
    .select()
    .from(stravaConnections)
    .where(eq(stravaConnections.athleteId, athleteId));
  return connection ?? null;
}

/**
 * Stores a rotated token pair in one statement, only if the stored refresh token is still the
 * one that was refreshed (compare-and-swap). Strava invalidates the old refresh token when it
 * issues a new one, so losing the new one would look like a revocation (spec 4.6): this write
 * either lands whole or not at all. Returns false when another refresh won the race.
 */
export async function rotateStravaTokens(
  db: Database,
  athleteId: bigint,
  previousRefreshTokenEnc: string,
  next: SealedTokens,
  now: Date,
): Promise<boolean> {
  const updated = await db
    .update(stravaConnections)
    .set({ ...next, updatedAt: now })
    .where(
      and(
        eq(stravaConnections.athleteId, athleteId),
        eq(stravaConnections.refreshTokenEnc, previousRefreshTokenEnc),
        isNull(stravaConnections.revokedAt),
      ),
    )
    .returning({ athleteId: stravaConnections.athleteId });
  return updated.length === 1;
}

/**
 * The athlete revoked access, or Strava refused the refresh token (A-10). Deletes the tokens,
 * every wallet link to the athlete and every cached Strava reading of the athlete's positions
 * (POL 7.4), and keeps the date.
 *
 * With `onlyIfRefreshTokenEnc`, the revocation happens only if the stored refresh token is still
 * that one. A refresh that lost a race to a concurrent renewal is refused by Strava as invalid
 * (the winner rotated the token), and must not revoke the pair the winner just stored. Returns
 * whether the connection was marked.
 */
export async function markStravaRevoked(
  db: Database,
  athleteId: bigint,
  now: Date,
  onlyIfRefreshTokenEnc?: string,
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const marked = await tx
      .update(stravaConnections)
      .set({
        accessTokenEnc: null,
        refreshTokenEnc: null,
        expiresAt: null,
        revokedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(stravaConnections.athleteId, athleteId),
          onlyIfRefreshTokenEnc === undefined
            ? undefined
            : eq(stravaConnections.refreshTokenEnc, onlyIfRefreshTokenEnc),
        ),
      )
      .returning({ athleteId: stravaConnections.athleteId });
    if (marked.length === 0) return false;
    await tx.delete(walletLinks).where(eq(walletLinks.athleteId, athleteId));
    await tx.delete(stravaReads).where(
      exists(
        tx
          .select()
          .from(positions)
          .where(
            and(
              eq(positions.athleteId, athleteId),
              eq(positions.chain, stravaReads.chain),
              eq(positions.contract, stravaReads.contract),
              eq(positions.user, stravaReads.user),
              eq(positions.weekId, stravaReads.weekId),
            ),
          ),
      ),
    );
    return true;
  });
}

// --- Position mirror (A-2) ------------------------------------------------------------------

export type MirroredPosition = typeof positions.$inferSelect;

export interface NewMirroredPosition extends PositionKey {
  readonly athleteId: bigint;
  readonly amount: bigint;
  readonly goalM: bigint;
  readonly commitTxHash: string;
}

/**
 * Records a position the API already read on-chain. A second report of the same key changes
 * nothing: the athlete frozen the first time stays (spec 4.4). Returns the stored row.
 */
export async function registerPosition(
  db: Database,
  position: NewMirroredPosition,
  now: Date,
): Promise<MirroredPosition> {
  // On conflict, a no-op update so `returning` hands back the row that was already there.
  const [stored] = await db
    .insert(positions)
    .values({ ...position, amount: position.amount.toString(), registeredAt: now })
    .onConflictDoUpdate({
      target: [positions.chain, positions.contract, positions.user, positions.weekId],
      set: { registeredAt: sql`${positions.registeredAt}` },
    })
    .returning();
  if (stored === undefined) {
    throw new AgentHabitError("DatabaseError", "An upsert returned no row");
  }
  return stored;
}

export async function findMirroredPosition(
  db: Database,
  key: PositionKey,
): Promise<MirroredPosition | null> {
  const [found] = await db.select().from(positions).where(keyMatches(positions, key));
  return found ?? null;
}

// --- Settlement log (written by the settler in T6) --------------------------------------

export async function recordSettlement(
  db: Database,
  settlement: PositionKey & {
    readonly outcome: "met" | "missed" | "released_stale";
    readonly mode: "dry-run" | "live";
    readonly txHash: string | null;
    readonly reason: string;
  },
  now: Date,
): Promise<void> {
  await db.insert(settlements).values({ ...settlement, settledAt: now });
}

// --- Strava cache and its purge (POL 6.2) --------------------------------------------------

export async function saveStravaRead(
  db: Database,
  read: PositionKey & {
    readonly totalM: bigint;
    readonly activityIds: readonly string[];
    readonly readAt: Date;
  },
): Promise<void> {
  const values = { ...read, activityIds: [...read.activityIds] };
  await db
    .insert(stravaReads)
    .values(values)
    .onConflictDoUpdate({
      target: [stravaReads.chain, stravaReads.contract, stravaReads.user, stravaReads.weekId],
      set: { totalM: values.totalM, activityIds: values.activityIds, readAt: values.readAt },
    });
}

export async function findStravaRead(db: Database, key: PositionKey) {
  const [found] = await db.select().from(stravaReads).where(keyMatches(stravaReads, key));
  return found ?? null;
}

export interface PurgeReport {
  readonly stravaReads: number;
  readonly athleteIdsCleared: number;
  readonly revokedConnections: number;
  readonly expiredChallenges: number;
  readonly expiredOAuthStates: number;
  readonly expiredSessions: number;
}

/**
 * The daily purge (T6's Cron runs it), in one transaction:
 * - Strava readings older than 7 days, or whose position is settled live (spec 4.5, POL 6.2);
 * - the frozen athlete of every position settled live, which nothing needs any more (A-20);
 * - connections revoked 30 days ago or more, with their athlete id (POL 7.4);
 * - expired link challenges, OAuth states and sessions.
 * A `dry-run` settlement purges nothing: the live one has not happened yet.
 */
export async function purgeExpiredData(db: Database, now: Date): Promise<PurgeReport> {
  const readCutoff = new Date(now.getTime() - STRAVA_RETENTION_MS);
  const revokedCutoff = new Date(now.getTime() - REVOKED_RETENTION_MS);
  const settledLive = (table: typeof stravaReads | typeof positions) =>
    exists(
      db
        .select()
        .from(settlements)
        .where(
          and(
            eq(settlements.mode, "live"),
            eq(settlements.chain, table.chain),
            eq(settlements.contract, table.contract),
            eq(settlements.user, table.user),
            eq(settlements.weekId, table.weekId),
          ),
        ),
    );

  return db.transaction(async (tx) => {
    const reads = await tx
      .delete(stravaReads)
      .where(or(lte(stravaReads.readAt, readCutoff), settledLive(stravaReads)))
      .returning({ weekId: stravaReads.weekId });
    const cleared = await tx
      .update(positions)
      .set({ athleteId: null })
      .where(and(isNotNull(positions.athleteId), settledLive(positions)))
      .returning({ weekId: positions.weekId });
    const revoked = await tx
      .delete(stravaConnections)
      .where(lte(stravaConnections.revokedAt, revokedCutoff))
      .returning({ athleteId: stravaConnections.athleteId });
    const challenges = await tx
      .delete(linkChallenges)
      .where(lte(linkChallenges.expiresAt, now))
      .returning({ nonce: linkChallenges.nonce });
    const states = await tx
      .delete(oauthStates)
      .where(lte(oauthStates.expiresAt, now))
      .returning({ state: oauthStates.state });
    const expiredSessions = await tx
      .delete(sessions)
      .where(lte(sessions.expiresAt, now))
      .returning({ tokenHash: sessions.tokenHash });
    return {
      stravaReads: reads.length,
      athleteIdsCleared: cleared.length,
      revokedConnections: revoked.length,
      expiredChallenges: challenges.length,
      expiredOAuthStates: states.length,
      expiredSessions: expiredSessions.length,
    };
  });
}
