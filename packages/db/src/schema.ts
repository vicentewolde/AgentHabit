import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The AgentHabit database (spec 4.4 and 4.5). Strava data lives here at most 7 days (POL 6.2):
 * only `strava_reads` holds it, and `purgeExpiredStravaData` deletes it. Tokens are stored
 * encrypted with TOKEN_ENCRYPTION_KEY; nothing in this schema holds a plaintext secret.
 */

export const chainEnum = pgEnum("chain", ["stellar", "avalanche"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** A wallet on one chain, linked to one Strava athlete by a message the wallet signed. */
export const walletLinks = pgTable(
  "wallet_links",
  {
    chain: chainEnum("chain").notNull(),
    address: text("address").notNull(),
    athleteId: bigint("athlete_id", { mode: "bigint" }).notNull(),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chain, table.address] })],
);

/** A one-time challenge for the link message: the nonce can be used once, before it expires. */
export const linkChallenges = pgTable("link_challenges", {
  nonce: text("nonce").primaryKey(),
  chain: chainEnum("chain").notNull(),
  address: text("address").notNull(),
  /** The exact text the wallet must sign. */
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/** A session opened by a valid link signature. Only the SHA-256 of the token is stored. */
export const sessions = pgTable("sessions", {
  tokenHash: text("token_hash").primaryKey(),
  chain: chainEnum("chain").notNull(),
  address: text("address").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

/**
 * The OAuth `state` for one connect attempt (CSRF): Strava's redirect arrives with no session, so
 * the state ties it back to the wallet that started it. One use, short-lived.
 */
export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  chain: chainEnum("chain").notNull(),
  address: text("address").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

/**
 * The Strava connection of one athlete. On revocation the tokens are deleted (POL 7.4) and
 * `revokedAt` stays, so the settler can tell "revoked" (0 km, A-10) from a passing error.
 */
export const stravaConnections = pgTable("strava_connections", {
  athleteId: bigint("athlete_id", { mode: "bigint" }).primaryKey(),
  accessTokenEnc: text("access_token_enc"),
  refreshTokenEnc: text("refresh_token_enc"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  scope: text("scope").notNull(),
  connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/**
 * The position mirror (A-2). Its key is (chain, contract, user, week_id), so production and
 * rehearsal instances, and the addresses after a testnet reset, never mix (spec 4.4). A row is
 * written only after the API read the position on-chain; `athleteId` is frozen at that moment.
 */
export const positions = pgTable(
  "positions",
  {
    chain: chainEnum("chain").notNull(),
    contract: text("contract").notNull(),
    user: text("user").notNull(),
    weekId: bigint("week_id", { mode: "bigint" }).notNull(),
    athleteId: bigint("athlete_id", { mode: "bigint" }).notNull(),
    /** In the token's smallest unit, as a decimal string: it is an i128 on Stellar. */
    amount: text("amount").notNull(),
    goalM: bigint("goal_m", { mode: "bigint" }).notNull(),
    commitTxHash: text("commit_tx_hash").notNull(),
    registeredAt: timestamp("registered_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.chain, table.contract, table.user, table.weekId] }),
    index("positions_week_idx").on(table.chain, table.contract, table.weekId),
  ],
);

export const settlementOutcomeEnum = pgEnum("settlement_outcome", [
  "met",
  "missed",
  "released_stale",
]);
export const settleModeEnum = pgEnum("settle_mode", ["dry-run", "live"]);

/**
 * What the settler decided for each position (T6 writes it). Keeps the outcome and the hash
 * forever, never the distance (spec 4.5).
 */
export const settlements = pgTable(
  "settlements",
  {
    chain: chainEnum("chain").notNull(),
    contract: text("contract").notNull(),
    user: text("user").notNull(),
    weekId: bigint("week_id", { mode: "bigint" }).notNull(),
    outcome: settlementOutcomeEnum("outcome").notNull(),
    mode: settleModeEnum("mode").notNull(),
    txHash: text("tx_hash"),
    /** Why, in words that carry no Strava data: "revoked", "goal met", ... */
    reason: text("reason").notNull(),
    settledAt: timestamp("settled_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.chain, table.contract, table.user, table.weekId] })],
);

/**
 * A week's Strava reading for one position: Strava data, kept at most 7 days after it was read,
 * or until the position is settled, whichever comes first (POL 6.2, spec 4.5).
 */
export const stravaReads = pgTable(
  "strava_reads",
  {
    chain: chainEnum("chain").notNull(),
    contract: text("contract").notNull(),
    user: text("user").notNull(),
    weekId: bigint("week_id", { mode: "bigint" }).notNull(),
    totalM: bigint("total_m", { mode: "bigint" }).notNull(),
    activityIds: jsonb("activity_ids").$type<string[]>().notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.chain, table.contract, table.user, table.weekId] }),
    index("strava_reads_read_at_idx").on(table.readAt),
  ],
);
