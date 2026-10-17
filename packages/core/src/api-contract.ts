import { z } from "zod";

/**
 * The contract between the web and the API (T7a, A-22): every request and response, as zod
 * schemas that both sides import, so they cannot drift. Money and week ids travel as decimal
 * strings (an i128 does not fit a JS number), times as ISO 8601 strings in UTC, distances as whole
 * metres. A failure is always `{ error: <AgentHabitErrorCode> }` with a 4xx or 5xx status.
 *
 * Authentication: `Authorization: Bearer <sessionToken>` from `/link/verify`. The API never
 * answers with another user's data, and no endpoint returns a Strava token.
 *
 * T7a is Stellar only; `chain` stays in the shapes so Avalanche (T7b) needs no breaking change.
 */

export const ChainSchema = z.enum(["stellar", "avalanche"]);

/** An unsigned integer as a decimal string: amounts in the token's smallest unit, week ids. */
export const DecimalStringSchema = z.string().regex(/^\d{1,40}$/);

const U64_MAX = 2n ** 64n - 1n;
const I128_MAX = 2n ** 127n - 1n;

/** A week id the contract can hold (a `u64`): bigger numbers never reach the SDK. */
export const WeekIdSchema = DecimalStringSchema.refine((value) => BigInt(value) <= U64_MAX, {
  message: "does not fit a u64",
});

/** An amount the contract can hold (an `i128`). */
export const AmountSchema = DecimalStringSchema.refine((value) => BigInt(value) <= I128_MAX, {
  message: "does not fit an i128",
});

/** `GET /health` → `{ ok: true }`. */

// --- Public configuration -----------------------------------------------------------------

/** One deployed instance, as the web needs it to build the commit form. */
export const InstanceInfoSchema = z.object({
  chain: ChainSchema,
  kind: z.enum(["production", "rehearsal"]),
  /** A Soroban contract id (`C…`) or an EVM address. */
  contract: z.string(),
  /** The USDC token: the Stellar Asset Contract id, or the EVM token address. */
  token: z.string(),
  tokenDecimals: z.number().int(),
  /** Stellar: the network passphrase the wallet signs for. */
  networkPassphrase: z.string().optional(),
  /** Where to look a transaction up, with `{hash}` to replace. */
  explorerTxUrl: z.string(),
  /** Limits, in the token's smallest unit and in metres, from the contract's `config`. */
  minAmount: DecimalStringSchema,
  maxAmount: DecimalStringSchema,
  minGoalM: z.number().int().positive(),
  maxGoalM: z.number().int().positive(),
  weekLenS: z.number().int().positive(),
  graceS: z.number().int().positive(),
  staleAfterS: z.number().int().positive(),
});
export type InstanceInfo = z.infer<typeof InstanceInfoSchema>;

/** `GET /config` (no session): the instances the web can use. */
export const ConfigResponseSchema = z.object({
  webOrigin: z.string(),
  instances: z.array(InstanceInfoSchema),
});
export type ConfigResponse = z.infer<typeof ConfigResponseSchema>;

// --- The wallet link and the session ------------------------------------------------------

/** `POST /link/challenge` */
export const ChallengeRequestSchema = z.object({
  chain: ChainSchema,
  address: z.string().min(1).max(100),
});
export const ChallengeResponseSchema = z.object({
  nonce: z.string(),
  /** The exact text the wallet signs. Sign it as is: no trimming, no line-ending changes. */
  message: z.string(),
  expiresAt: z.string(),
});

/** `POST /link/verify`. `signature` is base64 on Stellar (SEP-53) and 0x-hex on EVM (EIP-191). */
export const VerifyRequestSchema = z.object({
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().min(1).max(200),
});
export const VerifyResponseSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string(),
  chain: ChainSchema,
  address: z.string(),
});
export type VerifyResponse = z.infer<typeof VerifyResponseSchema>;

/** `GET /me`: who the session is and what is connected. */
export const MeResponseSchema = z.object({
  chain: ChainSchema,
  address: z.string(),
  /** The wallet is linked to a Strava athlete, and that connection is not revoked. */
  stravaConnected: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponseSchema>;

// --- Strava ---------------------------------------------------------------------------------

/** `GET /strava/connect` → where to send the browser to authorize AgentHabit. */
export const StravaConnectResponseSchema = z.object({ url: z.string().url() });

/**
 * `POST /strava/callback`: the web's `/strava/callback` page forwards what Strava put in the URL
 * (A-19), with the session. The state must belong to this session's wallet.
 */
export const StravaCallbackRequestSchema = z.object({
  code: z.string().min(1).max(200),
  scope: z.string().max(200),
  state: z.string().regex(/^[0-9a-f]{32}$/),
});
export const StravaCallbackResponseSchema = z.object({ connected: z.literal(true) });

/** `POST /strava/disconnect` */
export const StravaDisconnectResponseSchema = z.object({ disconnected: z.boolean() });

// --- Positions and the week -----------------------------------------------------------------

export const PositionStateSchema = z.enum(["Active", "Returned", "Forfeited", "ReleasedStale"]);

/** A position the session's wallet holds, as the API mirrored it. */
export const PositionViewSchema = z.object({
  state: PositionStateSchema,
  amount: DecimalStringSchema,
  goalM: z.number().int(),
  /**
   * The hash the web reported for this commit, or `null` when the position exists on-chain but the
   * web never reported it (so the oracle cannot find it). The web keeps a commit's hash until
   * `POST /positions` succeeds and shows a warning while this is `null`.
   */
  commitTxHash: z.string().nullable(),
});

/** One week, as the session's own user sees it. Never another user's. */
export const WeekViewSchema = z.object({
  weekId: DecimalStringSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  /** From here the oracle may settle the week. */
  settleOpensAt: z.string(),
  /** From here anyone may return an unsettled deposit to its owner ("recuperar"). */
  releaseOpensAt: z.string(),
  /** `null` when the wallet has no position this week. */
  position: PositionViewSchema.nullable(),
  /**
   * Whole metres run so far, read from Strava with this user's own token when the week is the
   * current one and Strava is connected; otherwise `null`. Strava data: never kept more than 7
   * days, never shown to anyone else.
   */
  totalM: z.number().int().nonnegative().nullable(),
  /** When `totalM` was read. */
  readAt: z.string().nullable(),
});
export type WeekView = z.infer<typeof WeekViewSchema>;

/**
 * `GET /weeks/me`: the current week and the next one (the only one a user can commit to, A-8).
 * `instance` says which contract the weeks belong to.
 *
 * `unsettledWeeks` are the earlier weeks whose position is still `Active`, newest first: waiting
 * for the oracle, or, once `releaseOpensAt` has passed, ready for "recuperar". The release window
 * opens about nine days after a week starts, when that week is no longer the current or the next
 * one, so without this list the button could never appear.
 */
export const WeeksResponseSchema = z.object({
  now: z.string(),
  instance: InstanceInfoSchema,
  currentWeek: WeekViewSchema,
  nextWeek: WeekViewSchema,
  unsettledWeeks: z.array(WeekViewSchema),
});
export type WeeksResponse = z.infer<typeof WeeksResponseSchema>;

/** `POST /positions`: the web reports a confirmed commit; the API reads it on-chain first. */
export const ReportPositionRequestSchema = z.object({
  chain: ChainSchema,
  contract: z.string().min(1).max(100),
  weekId: WeekIdSchema,
  txHash: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
});
export const ReportPositionResponseSchema = z.object({
  chain: ChainSchema,
  contract: z.string(),
  weekId: DecimalStringSchema,
  amount: DecimalStringSchema,
  goalM: z.string(),
});

// --- Transactions the wallet signs ------------------------------------------------------------

/**
 * `POST /tx/commit`: the API builds the unsigned `commit` for the session's wallet and the next
 * week. On Stellar the transaction's source is the wallet, so signing the transaction also
 * authorizes the token transfer inside it. The web has the wallet sign `xdr` for
 * `networkPassphrase` and then calls `/tx/submit`.
 */
export const BuildCommitRequestSchema = z.object({
  amount: AmountSchema,
  goalM: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export const PreparedTxResponseSchema = z.object({
  /** The unsigned transaction envelope, base64 XDR. */
  xdr: z.string(),
  networkPassphrase: z.string(),
  weekId: DecimalStringSchema,
});
export type PreparedTxResponse = z.infer<typeof PreparedTxResponseSchema>;

/** `POST /tx/release`: the same for `release_if_stale` ("recuperar") on a week that expired. */
export const BuildReleaseRequestSchema = z.object({ weekId: WeekIdSchema });

/**
 * `POST /tx/submit`: sends a signed transaction and waits for the ledger (up to about 30 s).
 * `status` is `SUCCESS` or `FAILED`; a transaction still pending after the wait is `PENDING`, and
 * the web may ask again with the same hash through `GET /tx/{hash}`.
 */
// A signed commit is a few KB of base64; the API refuses any body over 8 KiB.
export const SubmitTxRequestSchema = z.object({ xdr: z.string().min(1).max(6_000) });
export const SubmitTxResponseSchema = z.object({
  txHash: z.string(),
  status: z.enum(["SUCCESS", "FAILED", "PENDING"]),
});
export type SubmitTxResponse = z.infer<typeof SubmitTxResponseSchema>;

/**
 * The error body of every failing response. `reason` is set when the contract or the token refused
 * a call (`ContractRejected`): one of the contract's own error names (`AmountOutOfRange`,
 * `GoalOutOfRange`, `WrongWeek`, `AlreadyCommitted`, `NotStaleYet`, `PositionNotFound`, ...) or a
 * token reason (`InsufficientBalance`: not enough USDC, `NoUsdcTrustline`: the wallet cannot hold
 * USDC yet, `TokenBlocked`). The web turns it into plain language.
 */
export const ErrorResponseSchema = z.object({
  error: z.string(),
  reason: z.string().optional(),
});
