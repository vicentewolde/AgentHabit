import { randomBytes } from "node:crypto";

import { normalizeEvmAddress, verifyEvmLinkSignature } from "@agenthabit/chain-avalanche";
import {
  normalizeStellarAddress,
  normalizeStellarContract,
  verifyStellarLinkSignature,
} from "@agenthabit/chain-stellar";
import {
  AgentHabitError,
  ConfigResponseSchema,
  type InstanceInfo,
  MeResponseSchema,
  type PositionState,
  PreparedTxResponseSchema,
  SubmitTxResponseSchema,
  WeeksResponseSchema,
} from "@agenthabit/core";
import {
  type Database,
  findMirroredPosition,
  findStravaConnection,
  findWalletLink,
  parseTokenKey,
  registerPosition,
  upsertWalletLink,
} from "@agenthabit/db";
import { createTestDatabase } from "@agenthabit/db/testing";
import type { Connection } from "@agenthabit/strava";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import type { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type ChainBackend, createApp, type StravaGateway } from "../src/app.js";

// Synthetic wallets, tokens and athletes only (CLAUDE.md, rule 5).
const ACCESS = "synthetic-access-token-AAAA";
const REFRESH = "synthetic-refresh-token-RRRR";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const TX = "ab".repeat(32);
const PASSPHRASE = "Test SDF Network ; September 2015";
// Monday 12 Oct 2026, 00:00 in UTC-3: week 0 starts here, so at the test clock (19 Oct) it is week 1.
const ANCHOR = BigInt(Date.parse("2026-10-12T03:00:00Z") / 1000);
const WEB = "http://localhost:5173";
const REDIRECT = "http://localhost:5173/strava/callback";

let db: Database;
let close: () => Promise<void>;
let clock: Date;
let logs: string[];
let revoked: string[];
let revokeFails: boolean;
/** Every session token, signature and OAuth state the tests handled: none may reach a log. */
let secrets: string[];
/** A simulated chain: the current week, the positions on it and what each call did. */
const chain = {
  week: 1n,
  positions: new Map<string, { state: PositionState; amount: bigint; goalM: bigint }>(),
  verified: new Map<string, { amount: bigint; goalM: bigint }>(),
  calls: [] as string[],
  reject: null as AgentHabitError | null,
};
/** What Strava would answer, and how often it was asked. */
const strava_ = { totalM: 7_500n, reads: 0, refreshes: 0, fails: false };
let exchange: (code: string, scope: string) => Promise<Connection>;
let app: Hono;
const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));

const strava: StravaGateway = {
  authorizeUrl: (redirectUri, state) =>
    `https://www.strava.com/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
  exchangeCode: (code, scope) => exchange(code, scope),
  revoke: async (accessToken) => {
    if (revokeFails) throw new AgentHabitError("NetworkError", "down");
    revoked.push(accessToken);
  },
  refresh: async () => {
    strava_.refreshes++;
    return {
      accessToken: "synthetic-access-token-BBBB",
      refreshToken: "synthetic-refresh-token-SSSS",
      expiresAt: new Date(clock.getTime() + 6 * 3_600_000),
    };
  },
  readWeek: async () => {
    strava_.reads++;
    if (strava_.fails) throw new AgentHabitError("StravaRateLimited", "limit");
    return { totalM: strava_.totalM, countedIds: ["1", "2"] };
  },
};

const instance: InstanceInfo = {
  chain: "stellar",
  kind: "production",
  contract: CONTRACT,
  token: StrKey.encodeContract(Buffer.alloc(32, 1)),
  tokenDecimals: 7,
  networkPassphrase: PASSPHRASE,
  explorerTxUrl: "https://stellar.expert/explorer/testnet/tx/{hash}",
  minAmount: "200000000",
  maxAmount: "500000000",
  minGoalM: 10_000,
  maxGoalM: 300_000,
  weekLenS: 604_800,
  graceS: 172_800,
  staleAfterS: 604_800,
};

const backend: ChainBackend = {
  instance,
  weekParams: { weekAnchor: ANCHOR, weekLen: 604_800n, grace: 172_800n, staleAfter: 604_800n },
  currentWeek: async () => chain.week,
  getPosition: async (user, weekId) =>
    chain.positions.get(`${user}:${weekId}`) ?? { state: "None", amount: 0n, goalM: 0n },
  prepareCommit: async (call) => {
    chain.calls.push(`commit:${call.user}:${call.weekId}:${call.amount}:${call.goalM}`);
    if (chain.reject !== null) throw chain.reject;
    return { xdr: "AAAA-unsigned-commit", networkPassphrase: PASSPHRASE };
  },
  prepareRelease: async (call) => {
    chain.calls.push(`release:${call.user}:${call.weekId}`);
    if (chain.reject !== null) throw chain.reject;
    return { xdr: "AAAA-unsigned-release", networkPassphrase: PASSPHRASE };
  },
  submit: async (signedXdr, owner) => {
    chain.calls.push(`submit:${owner}:${signedXdr}`);
    if (chain.reject !== null) throw chain.reject;
    return { txHash: TX, status: "SUCCESS" };
  },
  transactionStatus: async () => "PENDING",
  verifyCommit: async ({ user, weekId, txHash }) =>
    chain.verified.get(`${user}:${weekId}:${txHash}`) ?? null,
};

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
  clock = new Date("2026-10-19T03:00:00.000Z");
  logs = [];
  revoked = [];
  revokeFails = false;
  secrets = [ACCESS, REFRESH, "code-1"];
  chain.week = 1n;
  chain.positions.clear();
  chain.verified.clear();
  chain.calls.length = 0;
  chain.reject = null;
  Object.assign(strava_, { totalM: 7_500n, reads: 0, refreshes: 0, fails: false });
  exchange = async (_code, scope) => ({
    accessToken: ACCESS,
    refreshToken: REFRESH,
    expiresAt: new Date(clock.getTime() + 6 * 3_600_000),
    athleteId: 777n,
    scope,
  });
  app = createApp({
    db,
    tokenKey,
    strava,
    chains: {
      stellar: {
        normalizeAddress: normalizeStellarAddress,
        normalizeContract: normalizeStellarContract,
        verifyLinkSignature: verifyStellarLinkSignature,
      },
      avalanche: {
        normalizeAddress: normalizeEvmAddress,
        normalizeContract: normalizeEvmAddress,
        verifyLinkSignature: verifyEvmLinkSignature,
      },
    },
    backends: { stellar: backend },
    webOrigin: WEB,
    stravaRedirectUri: REDIRECT,
    now: () => clock,
    randomBytes,
    log: (line) => logs.push(line),
  });
});

afterEach(async () => {
  // Nothing secret ever reaches a log line (CLAUDE.md, cross-cutting criteria).
  for (const line of logs) {
    for (const secret of secrets) expect(line).not.toContain(secret);
  }
  await close();
});

const json = (value: unknown, headers: Record<string, string> = {}) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(value),
});
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A Stellar wallet that signs the way Freighter does (SEP-53, base64). */
function stellarWallet() {
  const keypair = Keypair.random();
  return {
    chain: "stellar" as const,
    address: keypair.publicKey(),
    sign: async (message: string) => Buffer.from(keypair.signMessage(message)).toString("base64"),
  };
}

/** An Avalanche wallet that signs the way Core and MetaMask do (EIP-191). */
function evmWallet() {
  const account = privateKeyToAccount(generatePrivateKey());
  return {
    chain: "avalanche" as const,
    address: account.address,
    sign: (message: string) => account.signMessage({ message }),
  };
}

type Wallet = ReturnType<typeof stellarWallet> | ReturnType<typeof evmWallet>;

async function challenge(wallet: Wallet) {
  const response = await app.request(
    "/link/challenge",
    json({ chain: wallet.chain, address: wallet.address }),
  );
  expect(response.status).toBe(200);
  return (await response.json()) as { nonce: string; message: string };
}

async function signIn(wallet: Wallet): Promise<string> {
  const { nonce, message } = await challenge(wallet);
  const signature = await wallet.sign(message);
  const response = await app.request("/link/verify", json({ nonce, signature }));
  expect(response.status).toBe(200);
  const { sessionToken } = (await response.json()) as { sessionToken: string };
  secrets.push(sessionToken, signature);
  return sessionToken;
}

/** Starts a Strava connection for `session` and returns the state Strava would echo back. */
async function startConnect(session: string): Promise<string> {
  const connect = await app.request("/strava/connect", { headers: bearer(session) });
  expect(connect.status).toBe(200);
  const { url } = (await connect.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  secrets.push(state);
  return state;
}

/** Strava's redirect lands on the web, which forwards it with its session (A-19). */
function finishConnect(session: string, state: string, scope = "read,activity:read_all") {
  return app.request("/strava/callback", json({ code: "code-1", scope, state }, bearer(session)));
}

async function connectStrava(session: string, scope?: string): Promise<Response> {
  return finishConnect(session, await startConnect(session), scope);
}

describe("the signed wallet link", () => {
  for (const make of [stellarWallet, evmWallet]) {
    it(`opens a session for a valid signature (${make().chain})`, async () => {
      const wallet = make();
      const session = await signIn(wallet);

      const connect = await app.request("/strava/connect", { headers: bearer(session) });
      expect(connect.status).toBe(200);
    });
  }

  it("writes a message that names the web, the wallet and the nonce", async () => {
    const wallet = evmWallet();
    const { nonce, message } = await challenge(wallet);

    expect(message.split("\n")[0]).toBe(
      "localhost:5173 wants you to sign in with your Ethereum account:",
    );
    expect(message).toContain(`\n${wallet.address}\n`);
    expect(message).toContain(`\nNonce: ${nonce}\n`);
  });

  it("refuses a signature by another wallet", async () => {
    const wallet = stellarWallet();
    const intruder = stellarWallet();
    const { nonce, message } = await challenge(wallet);

    const response = await app.request(
      "/link/verify",
      json({ nonce, signature: await intruder.sign(message) }),
    );
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "LinkRejected" });
  });

  it("refuses a signature over another message", async () => {
    const wallet = evmWallet();
    const { nonce, message } = await challenge(wallet);

    const response = await app.request(
      "/link/verify",
      json({
        nonce,
        signature: await wallet.sign(message.replace("localhost:5173", "evil.example")),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses an expired challenge", async () => {
    const wallet = evmWallet();
    const { nonce, message } = await challenge(wallet);
    clock = new Date(clock.getTime() + 5 * 60_000);

    const response = await app.request(
      "/link/verify",
      json({ nonce, signature: await wallet.sign(message) }),
    );
    expect(response.status).toBe(401);
  });

  it("refuses a challenge used twice, even with a valid signature", async () => {
    const wallet = stellarWallet();
    const { nonce, message } = await challenge(wallet);
    const signature = await wallet.sign(message);

    expect((await app.request("/link/verify", json({ nonce, signature }))).status).toBe(200);
    expect((await app.request("/link/verify", json({ nonce, signature }))).status).toBe(401);
  });

  it("burns the nonce on a failed attempt, so it cannot be retried", async () => {
    const wallet = evmWallet();
    const { nonce, message } = await challenge(wallet);
    await app.request("/link/verify", json({ nonce, signature: await evmWallet().sign(message) }));

    const response = await app.request(
      "/link/verify",
      json({ nonce, signature: await wallet.sign(message) }),
    );
    expect(response.status).toBe(401);
  });

  it("validates every body with zod", async () => {
    const cases = [
      ["/link/challenge", { chain: "solana", address: "x" }],
      ["/link/challenge", { chain: "stellar", address: "not-a-key" }],
      ["/link/verify", { nonce: "short", signature: "x" }],
      ["/link/verify", "not an object"],
    ] as const;
    for (const [path, value] of cases) {
      const response = await app.request(path, json(value));
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: "InvalidRequest" });
    }
  });
});

describe("the Strava connection", () => {
  it("needs a session", async () => {
    expect((await app.request("/strava/connect")).status).toBe(401);
    expect((await app.request("/strava/connect", { headers: bearer("forged") })).status).toBe(401);
    const callback = json({ code: "c", scope: "s", state: "0".repeat(32) });
    expect((await app.request("/strava/callback", callback)).status).toBe(401);
  });

  it("stores the tokens encrypted and links the wallet to the athlete", async () => {
    const wallet = stellarWallet();
    const response = await connectStrava(await signIn(wallet));

    expect(response.status).toBe(200);
    expect(await findWalletLink(db, "stellar", wallet.address)).toEqual({ athleteId: 777n });
    const stored = await findStravaConnection(db, 777n);
    expect(stored?.accessTokenEnc).not.toContain(ACCESS);
    expect(stored?.refreshTokenEnc).not.toContain(REFRESH);
    expect(stored?.scope).toBe("read,activity:read_all");
  });

  it("refuses an athlete who did not grant activity:read_all", async () => {
    exchange = async () => {
      throw new AgentHabitError("StravaScopeMissing", "no read_all");
    };
    const wallet = evmWallet();
    const response = await connectStrava(await signIn(wallet), "read,activity:read");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "StravaScopeMissing" });
    expect(await findWalletLink(db, "avalanche", wallet.address)).toBeNull();
  });

  it("refuses an unknown or reused state", async () => {
    const session = await signIn(stellarWallet());
    const state = await startConnect(session);

    expect((await finishConnect(session, state)).status).toBe(200);
    expect((await finishConnect(session, state)).status).toBe(401);
    expect((await finishConnect(session, "f".repeat(32))).status).toBe(401);
  });

  it("refuses a connection a third party started, finished in the victim's session (CSRF)", async () => {
    const attacker = await signIn(evmWallet());
    const victimWallet = stellarWallet();
    const victim = await signIn(victimWallet);
    // The attacker starts a connection and sends Strava's link to the victim, who authorizes it.
    const attackerState = await startConnect(attacker);

    const response = await finishConnect(victim, attackerState);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "LinkRejected" });
    expect(await findStravaConnection(db, 777n)).toBeNull();
    expect(await findWalletLink(db, "stellar", victimWallet.address)).toBeNull();
  });

  it("disconnecting the only wallet revokes at Strava and deletes tokens and links (A-10)", async () => {
    const wallet = stellarWallet();
    const session = await signIn(wallet);
    await connectStrava(session);

    const response = await app.request("/strava/disconnect", {
      method: "POST",
      headers: bearer(session),
    });

    expect(await response.json()).toEqual({ disconnected: true });
    expect(revoked).toEqual([ACCESS]);
    expect(await findStravaConnection(db, 777n)).toMatchObject({
      accessTokenEnc: null,
      refreshTokenEnc: null,
    });
    expect(await findWalletLink(db, "stellar", wallet.address)).toBeNull();
  });

  it("a wallet cannot revoke an athlete another wallet still relies on", async () => {
    const first = await signIn(stellarWallet());
    const secondWallet = evmWallet();
    const second = await signIn(secondWallet);
    await connectStrava(first);
    await connectStrava(second);

    await app.request("/strava/disconnect", { method: "POST", headers: bearer(first) });

    expect(revoked).toEqual([]);
    expect((await findStravaConnection(db, 777n))?.revokedAt).toBeNull();
    expect(await findWalletLink(db, "avalanche", secondWallet.address)).toEqual({
      athleteId: 777n,
    });
  });

  it("disconnecting still deletes the tokens when Strava cannot be reached", async () => {
    revokeFails = true;
    const session = await signIn(evmWallet());
    await connectStrava(session);

    await app.request("/strava/disconnect", { method: "POST", headers: bearer(session) });

    expect((await findStravaConnection(db, 777n))?.revokedAt).toEqual(clock);
  });
});

describe("the position mirror", () => {
  async function linkedWallet() {
    const wallet = stellarWallet();
    const session = await signIn(wallet);
    await connectStrava(session);
    return { wallet, session };
  }
  const report = (overrides: Record<string, string> = {}) => ({
    chain: "stellar",
    contract: CONTRACT,
    weekId: "3",
    txHash: TX,
    ...overrides,
  });

  it("stores a position only after reading it on-chain", async () => {
    const { wallet, session } = await linkedWallet();
    chain.verified.set(`${wallet.address}:3:${TX}`, {
      amount: 200_000_000n,
      goalM: 10_000n,
    });

    const response = await app.request("/positions", json(report(), bearer(session)));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      chain: "stellar",
      contract: CONTRACT,
      weekId: "3",
      amount: "200000000",
      goalM: "10000",
    });
    const stored = await findMirroredPosition(db, {
      chain: "stellar",
      contract: CONTRACT,
      user: wallet.address,
      weekId: 3n,
    });
    expect(stored).toMatchObject({ athleteId: 777n, commitTxHash: TX });
  });

  it("refuses what the chain does not confirm, and stores nothing", async () => {
    const { wallet, session } = await linkedWallet();

    const response = await app.request("/positions", json(report(), bearer(session)));

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "PositionUnverified" });
    expect(
      await findMirroredPosition(db, {
        chain: "stellar",
        contract: CONTRACT,
        user: wallet.address,
        weekId: 3n,
      }),
    ).toBeNull();
  });

  it("freezes the athlete: relinking the wallet later does not move an existing position", async () => {
    const { wallet, session } = await linkedWallet();
    chain.verified.set(`${wallet.address}:3:${TX}`, {
      amount: 200_000_000n,
      goalM: 10_000n,
    });
    await app.request("/positions", json(report(), bearer(session)));

    await upsertWalletLink(
      db,
      { chain: "stellar", address: wallet.address, athleteId: 999n },
      clock,
    );
    await app.request("/positions", json(report(), bearer(session)));

    const stored = await findMirroredPosition(db, {
      chain: "stellar",
      contract: CONTRACT,
      user: wallet.address,
      weekId: 3n,
    });
    expect(stored?.athleteId).toBe(777n);
  });

  it("refuses the Avalanche chain until it has a backend", async () => {
    const wallet = evmWallet();
    const session = await signIn(wallet);

    const response = await app.request(
      "/positions",
      json(
        report({ chain: "avalanche", contract: "0x5425890298aed601595a70AB815c96711a31Bc65" }),
        bearer(session),
      ),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a body over the size limit", async () => {
    const session = await signIn(stellarWallet());
    const response = await app.request(
      "/positions",
      json({ ...report(), padding: "x".repeat(10_000) }, bearer(session)),
    );
    expect(response.status).toBe(400);
  });

  it("refuses unknown contracts, another chain, a missing link, no session and bad bodies", async () => {
    const { session } = await linkedWallet();
    const unlinked = await signIn(stellarWallet());

    expect(
      (await app.request("/positions", json(report({ contract: "COTHER" }), bearer(session))))
        .status,
    ).toBe(400);
    expect(
      (await app.request("/positions", json(report({ chain: "avalanche" }), bearer(session))))
        .status,
    ).toBe(400);
    expect((await app.request("/positions", json(report(), bearer(unlinked)))).status).toBe(400);
    expect((await app.request("/positions", json(report()))).status).toBe(401);
    expect(
      (await app.request("/positions", json(report({ weekId: "-1" }), bearer(session)))).status,
    ).toBe(400);
    expect(
      (await app.request("/positions", json(report({ txHash: "nope" }), bearer(session)))).status,
    ).toBe(400);
  });
});

/** A wallet with a session and a live Strava connection: what the web has after connecting. */
async function connectedWallet() {
  const wallet = stellarWallet();
  const session = await signIn(wallet);
  expect((await connectStrava(session)).status).toBe(200);
  return { wallet, session };
}

const get = (path: string, session?: string, headers: Record<string, string> = {}) =>
  app.request(path, { headers: { ...(session === undefined ? {} : bearer(session)), ...headers } });

describe("the public configuration and /me", () => {
  it("lists the instances the web can use, without a session", async () => {
    const response = await get("/config");

    const config = ConfigResponseSchema.parse(await response.json());
    expect(config.webOrigin).toBe(WEB);
    expect(config.instances).toEqual([instance]);
  });

  it("says who the session is and whether Strava is connected", async () => {
    const wallet = stellarWallet();
    const session = await signIn(wallet);

    const before = MeResponseSchema.parse(await (await get("/me", session)).json());
    expect(before).toEqual({ chain: "stellar", address: wallet.address, stravaConnected: false });

    await connectStrava(session);
    const after = MeResponseSchema.parse(await (await get("/me", session)).json());
    expect(after.stravaConnected).toBe(true);
  });

  it("needs a session for /me", async () => {
    expect((await get("/me")).status).toBe(401);
  });
});

describe("the week status", () => {
  it("shows the current and the next week with their dates and no position", async () => {
    const { session } = await connectedWallet();

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.currentWeek).toMatchObject({
      weekId: "1",
      startsAt: "2026-10-19T03:00:00.000Z",
      endsAt: "2026-10-26T03:00:00.000Z",
      position: null,
      totalM: null,
    });
    // The partner's first week: it ends on 2 Nov and settles two days later (A-22).
    expect(weeks.nextWeek).toMatchObject({
      weekId: "2",
      startsAt: "2026-10-26T03:00:00.000Z",
      endsAt: "2026-11-02T03:00:00.000Z",
      settleOpensAt: "2026-11-04T03:00:00.000Z",
      releaseOpensAt: "2026-11-09T03:00:00.000Z",
      position: null,
    });
  });

  it("shows an active position with the km run so far, and the hash the web reported", async () => {
    const { wallet, session } = await connectedWallet();
    chain.positions.set(`${wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    await registerPosition(
      db,
      {
        chain: "stellar",
        contract: CONTRACT,
        user: wallet.address,
        weekId: 1n,
        athleteId: 777n,
        amount: 200_000_000n,
        goalM: 12_000n,
        commitTxHash: TX,
      },
      clock,
    );

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.currentWeek.position).toEqual({
      state: "Active",
      amount: "200000000",
      goalM: 12_000,
      commitTxHash: TX,
    });
    expect(weeks.currentWeek.totalM).toBe(7_500);
    expect(weeks.currentWeek.readAt).toBe(clock.toISOString());
    // The next week is never read from Strava: it has not started.
    expect(strava_.reads).toBe(1);
  });

  it("reads Strava once per ten minutes, however often the page is opened", async () => {
    const { wallet, session } = await connectedWallet();
    chain.positions.set(`${wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });

    await get("/weeks/me", session);
    await get("/weeks/me", session);
    expect(strava_.reads).toBe(1);

    clock = new Date(clock.getTime() + 11 * 60_000);
    await get("/weeks/me", session);
    expect(strava_.reads).toBe(2);
  });

  it("warns that a position is unreported: the chain has it, the mirror does not", async () => {
    const { wallet, session } = await connectedWallet();
    chain.positions.set(`${wallet.address}:2`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.nextWeek.position).toMatchObject({ state: "Active", commitTxHash: null });
  });

  it("still answers when Strava fails, with no kilometres instead of an error", async () => {
    const { wallet, session } = await connectedWallet();
    chain.positions.set(`${wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    strava_.fails = true;

    const response = await get("/weeks/me", session);

    expect(response.status).toBe(200);
    const weeks = WeeksResponseSchema.parse(await response.json());
    expect(weeks.currentWeek.totalM).toBeNull();
    expect(weeks.currentWeek.position?.state).toBe("Active");
  });

  it("does not read Strava for a week that is already settled", async () => {
    const { wallet, session } = await connectedWallet();
    chain.positions.set(`${wallet.address}:1`, {
      state: "Returned",
      amount: 200_000_000n,
      goalM: 12_000n,
    });

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.currentWeek.position?.state).toBe("Returned");
    expect(weeks.currentWeek.totalM).toBeNull();
    expect(strava_.reads).toBe(0);
  });

  it("never shows another wallet's position or kilometres", async () => {
    const owner = await connectedWallet();
    chain.positions.set(`${owner.wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    const other = await signIn(stellarWallet());

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", other)).json());

    expect(weeks.currentWeek.position).toBeNull();
    expect(weeks.currentWeek.totalM).toBeNull();
  });

  it("lists the earlier weeks whose position is still active, so 'recuperar' can appear", async () => {
    const { wallet, session } = await connectedWallet();
    // Week 2 is current, so week 0 is over and past its release window.
    chain.week = 2n;
    chain.positions.set(`${wallet.address}:0`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    chain.positions.set(`${wallet.address}:1`, {
      state: "Returned",
      amount: 200_000_000n,
      goalM: 12_000n,
    });

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.currentWeek.weekId).toBe("2");
    expect(weeks.unsettledWeeks.map((week) => week.weekId)).toEqual(["0"]);
    expect(weeks.unsettledWeeks[0]?.releaseOpensAt).toBe("2026-10-26T03:00:00.000Z");
    expect(weeks.unsettledWeeks[0]?.position?.state).toBe("Active");
  });

  it("finds an unsettled week the wallet reported even when it is older than two weeks", async () => {
    const { wallet, session } = await connectedWallet();
    chain.week = 6n;
    chain.positions.set(`${wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    await registerPosition(
      db,
      {
        chain: "stellar",
        contract: CONTRACT,
        user: wallet.address,
        weekId: 1n,
        athleteId: 777n,
        amount: 200_000_000n,
        goalM: 12_000n,
        commitTxHash: TX,
      },
      clock,
    );

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", session)).json());

    expect(weeks.unsettledWeeks.map((week) => week.weekId)).toEqual(["1"]);
    expect(weeks.unsettledWeeks[0]?.position?.commitTxHash).toBe(TX);
  });

  it("has no unsettled weeks when everything earlier is final, and never another wallet's", async () => {
    const mine = await connectedWallet();
    const other = await connectedWallet();
    chain.week = 3n;
    chain.positions.set(`${mine.wallet.address}:1`, {
      state: "Forfeited",
      amount: 200_000_000n,
      goalM: 12_000n,
    });
    chain.positions.set(`${other.wallet.address}:1`, {
      state: "Active",
      amount: 200_000_000n,
      goalM: 12_000n,
    });

    const weeks = WeeksResponseSchema.parse(await (await get("/weeks/me", mine.session)).json());

    expect(weeks.unsettledWeeks).toEqual([]);
  });

  it("needs a session", async () => {
    expect((await get("/weeks/me")).status).toBe(401);
  });
});

describe("the transactions the wallet signs", () => {
  it("builds next week's commit for the session's wallet", async () => {
    const { wallet, session } = await connectedWallet();

    const response = await app.request(
      "/tx/commit",
      json({ amount: "200000000", goalM: 15_000 }, bearer(session)),
    );

    expect(response.status).toBe(200);
    expect(PreparedTxResponseSchema.parse(await response.json())).toEqual({
      xdr: "AAAA-unsigned-commit",
      networkPassphrase: PASSPHRASE,
      weekId: "2",
    });
    expect(chain.calls).toEqual([`commit:${wallet.address}:2:200000000:15000`]);
  });

  it("refuses to build a commit before Strava is connected: the oracle could not count it", async () => {
    const session = await signIn(stellarWallet());

    const response = await app.request(
      "/tx/commit",
      json({ amount: "200000000", goalM: 15_000 }, bearer(session)),
    );

    expect(response.status).toBe(400);
    expect(chain.calls).toEqual([]);
  });

  it("refuses a commit after the Strava connection was revoked", async () => {
    const { session } = await connectedWallet();
    await app.request("/strava/disconnect", { method: "POST", headers: bearer(session) });

    const response = await app.request(
      "/tx/commit",
      json({ amount: "200000000", goalM: 15_000 }, bearer(session)),
    );

    expect(response.status).toBe(400);
    expect(chain.calls).toEqual([]);
  });

  it("passes on what the contract would refuse, as a 422 that names the error only", async () => {
    const { session } = await connectedWallet();
    chain.reject = new AgentHabitError("ContractRejected", "refused", {
      details: { contractError: "AmountOutOfRange" },
    });

    const response = await app.request(
      "/tx/commit",
      json({ amount: "1", goalM: 15_000 }, bearer(session)),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "ContractRejected" });
  });

  it("builds the release for the wallet's own position", async () => {
    const { wallet, session } = await connectedWallet();

    const response = await app.request("/tx/release", json({ weekId: "1" }, bearer(session)));

    expect(response.status).toBe(200);
    expect(PreparedTxResponseSchema.parse(await response.json()).weekId).toBe("1");
    expect(chain.calls).toEqual([`release:${wallet.address}:1`]);
  });

  it("relays a signed transaction on behalf of the session's wallet only", async () => {
    const { wallet, session } = await connectedWallet();

    const response = await app.request("/tx/submit", json({ xdr: "AAAA-signed" }, bearer(session)));

    expect(SubmitTxResponseSchema.parse(await response.json())).toEqual({
      txHash: TX,
      status: "SUCCESS",
    });
    expect(chain.calls).toEqual([`submit:${wallet.address}:AAAA-signed`]);
  });

  it("answers 400 when the transaction is not one the web is meant to send", async () => {
    const { session } = await connectedWallet();
    chain.reject = new AgentHabitError("TransactionNotAllowed", "not relayed");

    const response = await app.request("/tx/submit", json({ xdr: "AAAA-signed" }, bearer(session)));

    expect(response.status).toBe(400);
  });

  it("tells the outcome of a transaction that was still pending", async () => {
    const { session } = await connectedWallet();

    const response = await get(`/tx/${TX}`, session);

    expect(await response.json()).toEqual({ txHash: TX, status: "PENDING" });
    expect((await get("/tx/not-a-hash", session)).status).toBe(400);
  });

  it("needs a session for every one of them", async () => {
    for (const [path, value] of [
      ["/tx/commit", { amount: "1", goalM: 1 }],
      ["/tx/release", { weekId: "1" }],
      ["/tx/submit", { xdr: "AAAA" }],
    ] as const) {
      expect((await app.request(path, json(value))).status, path).toBe(401);
    }
    expect((await get(`/tx/${TX}`)).status).toBe(401);
    expect(chain.calls).toEqual([]);
  });
});

describe("CORS", () => {
  it("lets the web's origin call with the session header, and answers its preflight", async () => {
    const preflight = await app.request("/weeks/me", {
      method: "OPTIONS",
      headers: {
        origin: WEB,
        "access-control-request-method": "GET",
        "access-control-request-headers": "authorization",
      },
    });

    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(WEB);
    expect(preflight.headers.get("access-control-allow-headers")?.toLowerCase()).toContain(
      "authorization",
    );
  });

  it("answers an error with the CORS header too, so the web can read the code", async () => {
    const response = await get("/me", undefined, { origin: WEB });

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(WEB);
  });

  it("does not echo another origin", async () => {
    const response = await get("/config", undefined, { origin: "https://evil.example" });

    expect(response.headers.get("access-control-allow-origin")).not.toBe("https://evil.example");
  });
});
