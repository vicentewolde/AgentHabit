import { createHash } from "node:crypto";

import {
  AgentHabitError,
  type AgentHabitErrorCode,
  buildLinkMessage,
  type ChainId,
  isAgentHabitError,
  type SignedLinkMessage,
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
  findSession,
  findStravaConnection,
  findWalletLink,
  markStravaRevoked,
  registerPosition,
  saveStravaConnection,
  type TokenKey,
  upsertWalletLink,
} from "@agenthabit/db";
import type { Connection } from "@agenthabit/strava";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";

/**
 * The AgentHabit API (spec 4.4): the signed wallet ↔ athlete link and its session, the Strava
 * connection, and the position mirror. Every input crosses zod; every failure is an
 * `AgentHabitError` answered as `{ error: code }`; no token, secret or Strava datum is logged.
 */

/** What the API needs from each chain: address normalization and link-signature checks. */
export interface ChainSupport {
  readonly normalizeAddress: (address: string) => string | null;
  /** A deployed contract's address in the form `knownContracts` lists it, or null. */
  readonly normalizeContract: (contract: string) => string | null;
  readonly verifyLinkSignature: (signed: SignedLinkMessage) => boolean | Promise<boolean>;
}

/** The subset of the Strava client the API uses, so tests can simulate Strava. */
export interface StravaGateway {
  authorizeUrl(redirectUri: string, state: string): string;
  exchangeCode(code: string, redirectScope: string): Promise<Connection>;
  revoke(accessToken: string): Promise<void>;
}

/**
 * Reads a commit on-chain (spec 4.4, step 2): the position as the contract stores it, if the
 * transaction `txHash` created it. Null when the chain does not confirm it. T6 implements it
 * over the chain adapters; until then tests use a simulated one.
 */
export interface CommitReader {
  readCommit(input: {
    readonly chain: ChainId;
    readonly contract: string;
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
  readonly commits: CommitReader;
  /** `chain:contract` of every deployed instance the mirror accepts (deployments/*.json, T6). */
  readonly knownContracts: ReadonlySet<string>;
  readonly webOrigin: string;
  /** The web page Strava returns to (A-19); the web forwards the result to `/strava/callback`. */
  readonly stravaRedirectUri: string;
  readonly now: () => Date;
  readonly randomBytes: (size: number) => Buffer;
  readonly log: (line: string) => void;
}

const CHALLENGE_TTL_MS = 5 * 60_000;
const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** T7 may tune it; a day keeps a stolen token short-lived. */
const SESSION_TTL_MS = 24 * 60 * 60_000;

const STATUS: Partial<Record<AgentHabitErrorCode, 400 | 401 | 404 | 409 | 422 | 429 | 502>> = {
  InvalidRequest: 400,
  StravaScopeMissing: 400,
  Unauthenticated: 401,
  LinkRejected: 401,
  PositionUnverified: 422,
  StravaRateLimited: 429,
  NetworkError: 502,
  StravaResponseInvalid: 502,
};

const ChainSchema = z.enum(["stellar", "avalanche"]);
const ChallengeBody = z.object({ chain: ChainSchema, address: z.string().min(1).max(100) });
const VerifyBody = z.object({
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  signature: z.string().min(1).max(200),
});
const PositionBody = z.object({
  chain: ChainSchema,
  contract: z.string().min(1).max(100),
  weekId: z.string().regex(/^\d{1,20}$/),
  txHash: z.string().regex(/^(0x)?[0-9a-fA-F]{64}$/),
});
const CallbackBody = z.object({
  code: z.string().min(1).max(200),
  scope: z.string().max(200),
  state: z.string().regex(/^[0-9a-f]{32}$/),
});

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

  app.onError((error, c) => {
    const code: AgentHabitErrorCode = isAgentHabitError(error) ? error.code : "DatabaseError";
    const status = STATUS[code] ?? 500;
    // Method, path and code only: no query string, body, header or message that could carry a
    // token or Strava data.
    deps.log(`${c.req.method} ${c.req.path} ${status} ${code}`);
    return c.json({ error: code }, status);
  });

  app.get("/health", (c) => c.json({ ok: true }));

  /** Step 1 of the link: the API writes the exact message the wallet must sign. */
  app.post("/link/challenge", async (c) => {
    const { chain, address: raw } = await body(c, ChallengeBody);
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
    const { nonce, signature } = await body(c, VerifyBody);
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
    const input = await body(c, CallbackBody);
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
    const input = await body(c, PositionBody);
    if (input.chain !== owner.chain) {
      throw new AgentHabitError("InvalidRequest", "The session belongs to another chain", {
        details: { fields: ["chain"] },
      });
    }
    const contract = deps.chains[input.chain].normalizeContract(input.contract);
    if (contract === null || !deps.knownContracts.has(`${input.chain}:${contract}`)) {
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
    const onChain = await deps.commits.readCommit({
      chain: input.chain,
      contract,
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
