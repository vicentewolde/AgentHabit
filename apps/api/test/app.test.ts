import { randomBytes } from "node:crypto";

import { normalizeEvmAddress, verifyEvmLinkSignature } from "@agenthabit/chain-avalanche";
import { normalizeStellarAddress, verifyStellarLinkSignature } from "@agenthabit/chain-stellar";
import { AgentHabitError } from "@agenthabit/core";
import {
  type Database,
  findMirroredPosition,
  findStravaConnection,
  findWalletLink,
  parseTokenKey,
  upsertWalletLink,
} from "@agenthabit/db";
import { createTestDatabase } from "@agenthabit/db/testing";
import type { Connection } from "@agenthabit/strava";
import { Keypair } from "@stellar/stellar-sdk";
import type { Hono } from "hono";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type CommitReader, createApp, type StravaGateway } from "../src/app.js";

// Synthetic wallets, tokens and athletes only (CLAUDE.md, rule 5).
const ACCESS = "synthetic-access-token-AAAA";
const REFRESH = "synthetic-refresh-token-RRRR";
const CONTRACT = "CSYNTHETICPRODUCTIONCONTRACT";
const TX = "ab".repeat(32);
const WEB = "http://localhost:5173";
const REDIRECT = "http://localhost:3000/auth/strava/callback";

let db: Database;
let close: () => Promise<void>;
let clock: Date;
let logs: string[];
let revoked: string[];
let commits: Map<string, { amount: bigint; goalM: bigint }>;
let exchange: (code: string, scope: string) => Promise<Connection>;
let app: Hono;
const tokenKey = parseTokenKey(randomBytes(32).toString("base64"));

const strava: StravaGateway = {
  authorizeUrl: (redirectUri, state) =>
    `https://www.strava.com/oauth/authorize?redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`,
  exchangeCode: (code, scope) => exchange(code, scope),
  revoke: async (accessToken) => {
    revoked.push(accessToken);
  },
};

const commitReader: CommitReader = {
  readCommit: async ({ chain, contract, user, weekId, txHash }) =>
    commits.get(`${chain}:${contract}:${user}:${weekId}:${txHash}`) ?? null,
};

beforeEach(async () => {
  ({ db, close } = await createTestDatabase());
  clock = new Date("2026-10-19T03:00:00.000Z");
  logs = [];
  revoked = [];
  commits = new Map();
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
        verifyLinkSignature: verifyStellarLinkSignature,
      },
      avalanche: {
        normalizeAddress: normalizeEvmAddress,
        verifyLinkSignature: verifyEvmLinkSignature,
      },
    },
    commits: commitReader,
    knownContracts: new Set([`stellar:${CONTRACT}`, `avalanche:${CONTRACT}`]),
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
    for (const secret of [ACCESS, REFRESH, "code-1"]) expect(line).not.toContain(secret);
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
  const response = await app.request(
    "/link/verify",
    json({ nonce, signature: await wallet.sign(message) }),
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { sessionToken: string }).sessionToken;
}

async function connectStrava(session: string, scope = "read,activity:read_all"): Promise<string> {
  const connect = await app.request("/strava/connect", { headers: bearer(session) });
  const { url } = (await connect.json()) as { url: string };
  const state = new URL(url).searchParams.get("state") ?? "";
  const callback = await app.request(
    `/auth/strava/callback?code=code-1&scope=${encodeURIComponent(scope)}&state=${state}`,
  );
  expect(callback.status).toBe(302);
  return callback.headers.get("location") ?? "";
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
  });

  it("stores the tokens encrypted and links the wallet to the athlete", async () => {
    const wallet = stellarWallet();
    const location = await connectStrava(await signIn(wallet));

    expect(location).toBe(`${WEB}/?strava=connected`);
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
    const location = await connectStrava(await signIn(wallet), "read,activity:read");

    expect(location).toBe(`${WEB}/?strava=scope`);
    expect(await findWalletLink(db, "avalanche", wallet.address)).toBeNull();
  });

  it("refuses an unknown or reused state, and a denied authorization", async () => {
    const session = await signIn(stellarWallet());
    const connect = await app.request("/strava/connect", { headers: bearer(session) });
    const state = new URL(((await connect.json()) as { url: string }).url).searchParams.get(
      "state",
    );
    const callback = `/auth/strava/callback?code=code-1&scope=read,activity:read_all&state=${state}`;

    expect((await app.request(callback)).headers.get("location")).toBe(`${WEB}/?strava=connected`);
    expect((await app.request(callback)).headers.get("location")).toBe(`${WEB}/?strava=expired`);
    expect(
      (await app.request("/auth/strava/callback?code=c&scope=x&state=forged")).headers.get(
        "location",
      ),
    ).toBe(`${WEB}/?strava=expired`);
    expect(
      (await app.request("/auth/strava/callback?error=access_denied")).headers.get("location"),
    ).toBe(`${WEB}/?strava=denied`);
  });

  it("disconnecting revokes at Strava and deletes the tokens (A-10)", async () => {
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
  });

  it("disconnecting still deletes the tokens when Strava cannot be reached", async () => {
    strava.revoke = async () => {
      throw new AgentHabitError("NetworkError", "down");
    };
    const session = await signIn(evmWallet());
    await connectStrava(session);

    await app.request("/strava/disconnect", { method: "POST", headers: bearer(session) });

    expect((await findStravaConnection(db, 777n))?.revokedAt).toEqual(clock);
    strava.revoke = async (accessToken) => {
      revoked.push(accessToken);
    };
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
    commits.set(`stellar:${CONTRACT}:${wallet.address}:3:${TX}`, {
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
    commits.set(`stellar:${CONTRACT}:${wallet.address}:3:${TX}`, {
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
