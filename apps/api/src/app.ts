import { createHash } from "node:crypto";

import {
  AgentHabitError,
  type AgentHabitErrorCode,
  BuildCommitRequestSchema,
  BuildReleaseRequestSchema,
  buildLinkMessage,
  type ChainId,
  ChallengeRequestSchema,
  type ConfigResponse,
  type InstanceInfo,
  isAgentHabitError,
  type PositionState,
  ReportPositionRequestSchema,
  releaseOpensAt,
  type SignedLinkMessage,
  StravaCallbackRequestSchema,
  SubmitTxRequestSchema,
  settleWindow,
  VerifyRequestSchema,
  type WeekParams,
  type WeeksResponse,
  type WeekView,
  weekEnd,
  weekStart,
} from "@agenthabit/core";
import {
  consumeChallenge,
  consumeOAuthState,
  createChallenge,
  createOAuthState,
  createSession,
  type Database,
  decryptToken,
  deleteWalletLink,
  encryptToken,
  findMirroredPosition,
  findSession,
  findStravaConnection,
  findStravaRead,
  findWalletLink,
  listMirroredWeeks,
  markStravaRevoked,
  registerPosition,
  saveStravaConnection,
  saveStravaRead,
  type TokenKey,
  upsertWalletLink,
} from "@agenthabit/db";
import type { Connection } from "@agenthabit/strava";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { z } from "zod";

import { freshAccessToken, type TokenRefresher } from "./strava-tokens.js";

/**
 * The AgentHabit API (spec 4.4): the signed wallet ↔ athlete link and its session, the Strava
 * connection, and the position mirror. Every input crosses zod; every failure is an
 * `AgentHabitError` answered as `{ error: code }`; no token, secret or Strava datum is logged.
 */

/** What the API needs from each chain: address normalization and link-signature checks. */
export interface ChainSupport {
  readonly normalizeAddress: (address: string) => string | null;
  /** A deployed contract's address in the form the deployments file lists it, or null. */
  readonly normalizeContract: (contract: string) => string | null;
  readonly verifyLinkSignature: (signed: SignedLinkMessage) => boolean | Promise<boolean>;
}

/** The subset of the Strava client the API uses, so tests can simulate Strava. */
export interface StravaGateway extends TokenRefresher {
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectScope: string): Promise<Connection>;
  revoke(accessToken: string): Promise<void>;
  /** The week's valid runs, in whole metres, or a typed error if the reading was incomplete. */
  readWeek(
    accessToken: string,
    weekId: bigint,
    params: WeekParams,
  ): Promise<{ readonly totalM: bigint; readonly countedIds: readonly string[] }>;
}

export interface BackendPosition {
  readonly state: PositionState;
  readonly amount: bigint;
  readonly goalM: bigint;
}

export interface PreparedCall {
  readonly xdr: string;
  readonly networkPassphrase: string;
}

/**
 * Everything the API needs from one chain's deployed contract (spec 4.4 and 4.7). Stellar's is
 * `stellar-backend.ts`; tests use a simulated one. Reads and builds only: the API never holds a
 * user's key, and `submit` relays what the wallet signed.
 */
export interface ChainBackend {
  readonly instance: InstanceInfo;
  /** The instance's week arithmetic parameters. */
  readonly weekParams: WeekParams;
  currentWeek(): Promise<bigint>;
  getPosition(user: string, weekId: bigint): Promise<BackendPosition>;
  prepareCommit(input: {
    readonly user: string;
    readonly weekId: bigint;
    readonly amount: bigint;
    readonly goalM: bigint;
  }): Promise<PreparedCall>;
  prepareRelease(input: { readonly user: string; readonly weekId: bigint }): Promise<PreparedCall>;
  submit(
    signedXdr: string,
    owner: string,
  ): Promise<{ txHash: string; status: "SUCCESS" | "FAILED" | "PENDING" }>;
  transactionStatus(txHash: string): Promise<"SUCCESS" | "FAILED" | "PENDING">;
  /** The position a confirmed commit created, read on-chain (spec 4.4, step 2), or null. */
  verifyCommit(input: {
    readonly user: string;
    readonly weekId: bigint;
    readonly txHash: string;
  }): Promise<{ readonly amount: bigint; readonly goalM: bigint } | null>;
}

export interface ApiDeps {
  readonly db: Database;
  readonly tokenKey: TokenKey;
  readonly strava: StravaGateway;
  readonly chains: Readonly<Record<ChainId, ChainSupport>>;
  /** One backend per chain the web supports. T7a: Stellar only. */
  readonly backends: Readonly<Partial<Record<ChainId, ChainBackend>>>;
  readonly webOrigin: string;
  /** The web page Strava returns to (A-19); the web forwards the result to `/strava/callback`. */
  readonly stravaRedirectUri: string;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Buffer;
  readonly log: (line: string) => void;
}

/** How many earlier weeks `/weeks/me` looks at: the oracle settles or the release opens within two. */
const UNSETTLED_LOOKBACK = 8;

/** A Strava reading is reused for this long, so refreshing the page does not spend the limit. */
const KM_CACHE_MS = 10 * 60_000;
const CHALLENGE_TTL_MS = 5 * 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** T7 may tune it; a day keeps a stolen token short-lived. */
const SESSION_TTL_MS = 24 * 60 * 60_000;

const STATUS: Partial<Record<AgentHabitErrorCode, 400 | 401 | 422 | 429 | 502 | 503>> = {
  InvalidRequest: 400,
  StravaScopeMissing: 400,
  TransactionNotAllowed: 400,
  Unauthenticated: 401,
  LinkRejected: 401,
  PositionUnverified: 422,
  ContractRejected: 422,
  AccountNotFunded: 422,
  StravaRateLimited: 429,
  NetworkError: 502,
  StravaResponseInvalid: 502,
  DeploymentDrift: 502,
  ConfigError: 503,
};

const TX_HASH = /^[0-9a-fA-F]{64}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function body<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
  if (!parsed.success) {
    throw new AgentHabitError("InvalidRequest", "The request body does not match its shape", {
      details: { fields: parsed.error.issues.map((issue) => issue.path.join(".")) },
    });
  }
  return parsed.data;
}

export function createApp(deps: ApiDeps): Hono {
  const app = new Hono();

  const webHost = new URL(deps.webOrigin).host;

  // The web is another origin: it may call with the session in a header, and nothing else.
  app.use(
    cors({
      origin: deps.webOrigin,
      allowHeaders: ["authorization", "content-type"],
      allowMethods: ["GET", "POST", "OPTIONS"],
      maxAge: 600,
    }),
  );

  // Every body here is a few hundred bytes; anything bigger is refused before it is parsed.
  app.use(
    bodyLimit({
      maxSize: 8 * 1024,
      onError: () => {
        throw new AgentHabitError("InvalidRequest", "The request body is too large");
      },
    }),
  );

  async function session(c: Context): Promise<{ chain: ChainId; address: string }> {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    const found = token === "" ? null : await findSession(deps.db, sha256(token), deps.now());
    if (found === null) throw new AgentHabitError("Unauthenticated", "A valid session is required");
    return found;
  }

  function backendFor(chain: ChainId): ChainBackend {
    const backend = deps.backends[chain];
    if (backend === undefined) {
      throw new AgentHabitError("InvalidRequest", "That chain is not available yet", {
        details: { fields: ["chain"] },
      });
    }
    return backend;
  }

  /** A wallet that commits must already be linked to a live Strava connection (spec 4.4). */
  async function stravaLinkOf(owner: { chain: ChainId; address: string }) {
    const link = await findWalletLink(deps.db, owner.chain, owner.address);
    const connection = link === null ? null : await findStravaConnection(deps.db, link.athleteId);
    const live =
      connection !== null && connection.revokedAt === null && connection.accessTokenEnc !== null;
    return { athleteId: link?.athleteId ?? null, live };
  }

  const iso = (seconds: bigint) => new Date(Number(seconds) * 1000).toISOString();

  /** The whole metres run so far this week, from Strava with the user's own token, cached briefly. */
  async function kmSoFar(
    backend: ChainBackend,
    owner: { chain: ChainId; address: string },
    athleteId: bigint,
    weekId: bigint,
  ): Promise<{ totalM: number; readAt: Date } | null> {
    const key = {
      chain: owner.chain,
      contract: backend.instance.contract,
      user: owner.address,
      weekId,
    };
    const now = deps.now();
    const cached = await findStravaRead(deps.db, key);
    const fromCache =
      cached === null ? null : { totalM: Number(cached.totalM), readAt: cached.readAt };
    if (cached !== null && now.getTime() - cached.readAt.getTime() < KM_CACHE_MS) return fromCache;
    try {
      const token = await freshAccessToken(
        { db: deps.db, tokenKey: deps.tokenKey, strava: deps.strava, now: deps.now },
        athleteId,
      );
      const reading = await deps.strava.readWeek(token, weekId, backend.weekParams);
      await saveStravaRead(deps.db, {
        ...key,
        totalM: reading.totalM,
        activityIds: reading.countedIds,
        readAt: now,
      });
      return { totalM: Number(reading.totalM), readAt: now };
    } catch (error) {
      // A failed reading never breaks the page: show the last one, or none.
      const code = isAgentHabitError(error) ? error.code : "Unexpected";
      deps.log(`km-read-failed ${code}`);
      return fromCache;
    }
  }

  async function weekView(
    backend: ChainBackend,
    owner: { chain: ChainId; address: string },
    weekId: bigint,
    withKm: boolean,
  ): Promise<WeekView> {
    const params = backend.weekParams;
    const window = settleWindow(weekId, params);
    const onChain = await backend.getPosition(owner.address, weekId);
    const key = {
      chain: owner.chain,
      contract: backend.instance.contract,
      user: owner.address,
      weekId,
    };
    const mirrored = onChain.state === "None" ? null : await findMirroredPosition(deps.db, key);
    let km: { totalM: number; readAt: Date } | null = null;
    if (withKm && onChain.state === "Active") {
      const athleteId = mirrored?.athleteId ?? (await stravaLinkOf(owner)).athleteId;
      if (athleteId !== null) km = await kmSoFar(backend, owner, athleteId, weekId);
    }
    return {
      weekId: weekId.toString(),
      startsAt: iso(weekStart(weekId, params)),
      endsAt: iso(weekEnd(weekId, params)),
      settleOpensAt: iso(window.opens),
      releaseOpensAt: iso(releaseOpensAt(weekId, params)),
      position:
        onChain.state === "None"
          ? null
          : {
              state: onChain.state,
              amount: onChain.amount.toString(),
              goalM: Number(onChain.goalM),
              commitTxHash: mirrored?.commitTxHash ?? null,
            },
      totalM: km?.totalM ?? null,
      readAt: km?.readAt.toISOString() ?? null,
    };
  }

  app.onError((error, c) => {
    const code: AgentHabitErrorCode = isAgentHabitError(error) ? error.code : "DatabaseError";
    const status = STATUS[code] ?? 500;
    // Method, path and code only: no query string, body, header or message that could carry a
    // token or Strava data.
    deps.log(`${c.req.method} ${c.req.path} ${status} ${code}`);
    return c.json({ error: code }, status);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  /** The instances the web can use: public, no session. */
  app.get("/config", (c) => {
    const response: ConfigResponse = {
      webOrigin: deps.webOrigin,
      instances: Object.values(deps.backends).map((backend) => backend.instance),
    };
    return c.json(response);
  });

  /** Who this session is and whether Strava is connected. */
  app.get("/me", async (c) => {
    const owner = await session(c);
    const { live } = await stravaLinkOf(owner);
    return c.json({ chain: owner.chain, address: owner.address, stravaConnected: live });
  });

  /**
   * The current week and the next one for this wallet, read from the chain. The kilometres come
   * from Strava with this user's own token and only for an active position of the current week.
   */
  app.get("/weeks/me", async (c) => {
    const owner = await session(c);
    const backend = backendFor(owner.chain);
    const current = await backend.currentWeek();

    // Earlier weeks that may still hold money: the two before this one, and any the wallet
    // reported. The chain says which are still `Active`.
    const candidates = new Set<bigint>();
    for (const back of [1n, 2n]) if (current >= back) candidates.add(current - back);
    const reported = await listMirroredWeeks(deps.db, {
      chain: owner.chain,
      contract: backend.instance.contract,
      user: owner.address,
    });
    for (const weekId of reported) if (weekId < current) candidates.add(weekId);
    const unsettledWeeks: WeekView[] = [];
    for (const weekId of [...candidates]
      .sort((a, b) => (a < b ? 1 : -1))
      .slice(0, UNSETTLED_LOOKBACK)) {
      const view = await weekView(backend, owner, weekId, false);
      if (view.position?.state === "Active") unsettledWeeks.push(view);
    }

    const response: WeeksResponse = {
      now: deps.now().toISOString(),
      instance: backend.instance,
      currentWeek: await weekView(backend, owner, current, true),
      nextWeek: await weekView(backend, owner, current + 1n, false),
      unsettledWeeks,
    };
    return c.json(response);
  });

  /**
   * The unsigned `commit` for next week. Strava must be connected first: a commit the oracle
   * cannot match to an athlete would lock the money with no way to count it.
   */
  app.post("/tx/commit", async (c) => {
    const owner = await session(c);
    const backend = backendFor(owner.chain);
    const input = await body(c, BuildCommitRequestSchema);
    if (!(await stravaLinkOf(owner)).live) {
      throw new AgentHabitError("InvalidRequest", "Connect Strava before committing", {
        details: { fields: ["link"] },
      });
    }
    const weekId = (await backend.currentWeek()) + 1n;
    const prepared = await backend.prepareCommit({
      user: owner.address,
      weekId,
      amount: BigInt(input.amount),
      goalM: BigInt(input.goalM),
    });
    return c.json({ ...prepared, weekId: weekId.toString() });
  });

  /** The unsigned `release_if_stale` ("recuperar") for this wallet's own position. */
  app.post("/tx/release", async (c) => {
    const owner = await session(c);
    const backend = backendFor(owner.chain);
    const input = await body(c, BuildReleaseRequestSchema);
    const prepared = await backend.prepareRelease({
      user: owner.address,
      weekId: BigInt(input.weekId),
    });
    return c.json({ ...prepared, weekId: input.weekId });
  });

  /** Relays a transaction the wallet signed, if it is one of the two calls the web makes. */
  app.post("/tx/submit", async (c) => {
    const owner = await session(c);
    const backend = backendFor(owner.chain);
    const input = await body(c, SubmitTxRequestSchema);
    return c.json(await backend.submit(input.xdr, owner.address));
  });

  /** The outcome of a transaction that was still pending when `/tx/submit` stopped waiting. */
  app.get("/tx/:hash", async (c) => {
    const owner = await session(c);
    const backend = backendFor(owner.chain);
    const hash = c.req.param("hash");
    if (!TX_HASH.test(hash)) {
      throw new AgentHabitError("InvalidRequest", "Not a transaction hash", {
        details: { fields: ["hash"] },
      });
    }
    return c.json({ txHash: hash, status: await backend.transactionStatus(hash) });
  });

  /** Step 1 of the link: the API writes the exact message the wallet must sign. */
  app.post("/link/challenge", async (c) => {
    const { chain, address: raw } = await body(c, ChallengeRequestSchema);
    const address = deps.chains[chain].normalizeAddress(raw);
    if (address === null) {
      throw new AgentHabitError("InvalidRequest", "Not an address of that chain", {
        details: { fields: ["address"] },
      });
    }
    const now = deps.now();
    const nonce = deps.randomBytes(16).toString("hex");
    const expiresAt = new Date(now.getTime() + CHALLENGE_TTL_MS);
    const message = buildLinkMessage({
      chain,
      domain: webHost,
      uri: deps.webOrigin,
      address,
      nonce,
      issuedAt: now,
      expiresAt,
    });
    await createChallenge(deps.db, { nonce, chain, address, message, expiresAt });
    return c.json({ nonce, message, expiresAt: expiresAt.toISOString() });
  });

  /**
   * Step 2: the signature over the stored message opens a session. The nonce is burnt first, in
   * one statement, so a challenge can be tried once: a reused, expired or unknown nonce, or a
   * signature by another key, is refused the same way.
   */
  app.post("/link/verify", async (c) => {
    const { nonce, signature } = await body(c, VerifyRequestSchema);
    const now = deps.now();
    const challenge = await consumeChallenge(deps.db, nonce, now);
    if (challenge === null) {
      throw new AgentHabitError("LinkRejected", "The challenge is unknown, used or expired");
    }
    const valid = await deps.chains[challenge.chain].verifyLinkSignature({
      address: challenge.address,
      message: challenge.message,
      signature,
    });
    if (!valid)
      throw new AgentHabitError("LinkRejected", "The signature does not match the wallet");

    const token = deps.randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await createSession(deps.db, {
      tokenHash: sha256(token),
      chain: challenge.chain,
      address: challenge.address,
      expiresAt,
    });
    return c.json({
      sessionToken: token,
      expiresAt: expiresAt.toISOString(),
      chain: challenge.chain,
      address: challenge.address,
    });
  });

  /** Where the web sends the athlete to authorize AgentHabit on Strava. */
  app.get("/strava/connect", async (c) => {
    const { chain, address } = await session(c);
    const state = deps.randomBytes(16).toString("hex");
    await createOAuthState(deps.db, {
      state,
      chain,
      address,
      expiresAt: new Date(deps.now().getTime() + OAUTH_STATE_TTL_MS),
    });
    return c.json({ url: deps.strava.authorizeUrl(deps.stravaRedirectUri, state) });
  });

  /**
   * Strava's redirect lands on the web, which hands `code`, `scope` and `state` over with its
   * session (A-19). The state must have been issued to this very session's wallet: a link a third
   * party started, completed in the victim's browser, is refused, so nobody can tie their wallet to
   * someone else's Strava account (RFC 6749 §10.12). The scope must include `activity:read_all`.
   * On success the tokens are stored encrypted and the wallet is linked to the athlete.
   */
  app.post("/strava/callback", async (c) => {
    const owner = await session(c);
    const input = await body(c, StravaCallbackRequestSchema);
    const issuedTo = await consumeOAuthState(deps.db, input.state, deps.now());
    if (issuedTo === null) {
      throw new AgentHabitError("LinkRejected", "The Strava state is unknown, used or expired");
    }
    if (issuedTo.chain !== owner.chain || issuedTo.address !== owner.address) {
      throw new AgentHabitError("LinkRejected", "The Strava state belongs to another wallet");
    }
    const connection = await deps.strava.exchangeCode(input.code, input.scope);
    const now = deps.now();
    await saveStravaConnection(
      deps.db,
      {
        athleteId: connection.athleteId,
        scope: connection.scope,
        accessTokenEnc: encryptToken(connection.accessToken, deps.tokenKey),
        refreshTokenEnc: encryptToken(connection.refreshToken, deps.tokenKey),
        expiresAt: connection.expiresAt,
      },
      now,
    );
    await upsertWalletLink(deps.db, { ...owner, athleteId: connection.athleteId }, now);
    return c.json({ connected: true });
  });

  /**
   * The web's "disconnect Strava" for this wallet. Only this wallet's link goes. When no other
   * wallet still uses the athlete, the access is revoked at Strava and locally (A-10): the tokens
   * and the cached readings are deleted even if Strava cannot be reached. A wallet can never
   * revoke an athlete another wallet still relies on.
   */
  app.post("/strava/disconnect", async (c) => {
    const { chain, address } = await session(c);
    const link = await findWalletLink(deps.db, chain, address);
    if (link === null) return c.json({ disconnected: false });
    const remaining = await deleteWalletLink(deps.db, chain, address, link.athleteId);
    if (remaining > 0) return c.json({ disconnected: true });

    const connection = await findStravaConnection(deps.db, link.athleteId);
    if (connection?.accessTokenEnc) {
      try {
        await deps.strava.revoke(decryptToken(connection.accessTokenEnc, deps.tokenKey));
      } catch (error) {
        const code = isAgentHabitError(error) ? error.code : "NetworkError";
        deps.log(`POST ${c.req.path} revoke-failed ${code}`);
      }
    }
    await markStravaRevoked(deps.db, link.athleteId, deps.now());
    return c.json({ disconnected: true });
  });

  /**
   * The web reports a confirmed commit (spec 4.4). The API reads it on-chain before storing it,
   * never trusting the web, and freezes the athlete linked at this moment.
   */
  app.post("/positions", async (c) => {
    const owner = await session(c);
    const input = await body(c, ReportPositionRequestSchema);
    if (input.chain !== owner.chain) {
      throw new AgentHabitError("InvalidRequest", "The session belongs to another chain", {
        details: { fields: ["chain"] },
      });
    }
    const backend = backendFor(input.chain);
    const contract = deps.chains[input.chain].normalizeContract(input.contract);
    if (contract === null || contract !== backend.instance.contract) {
      throw new AgentHabitError("InvalidRequest", "Not a deployed AgentHabit contract", {
        details: { fields: ["contract"] },
      });
    }
    const link = await findWalletLink(deps.db, owner.chain, owner.address);
    if (link === null) {
      throw new AgentHabitError("InvalidRequest", "Connect Strava before committing", {
        details: { fields: ["link"] },
      });
    }
    const weekId = BigInt(input.weekId);
    const onChain = await backend.verifyCommit({
      user: owner.address,
      weekId,
      txHash: input.txHash,
    });
    if (onChain === null) {
      throw new AgentHabitError("PositionUnverified", "The chain does not confirm this commit");
    }
    const stored = await registerPosition(
      deps.db,
      {
        chain: input.chain,
        contract,
        user: owner.address,
        weekId,
        athleteId: link.athleteId,
        amount: onChain.amount,
        goalM: onChain.goalM,
        commitTxHash: input.txHash,
      },
      deps.now(),
    );
    return c.json({
      chain: stored.chain,
      contract: stored.contract,
      weekId: stored.weekId.toString(),
      amount: stored.amount,
      goalM: stored.goalM.toString(),
    });
  });

  return app;
}
