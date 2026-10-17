// @vitest-environment jsdom
import { AgentHabitError, hasErrorCode } from "@agenthabit/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "../src/api/client.js";
import { messageFor } from "../src/api/messages.js";
import {
  linkWallet,
  type PollOptions,
  reconcilePendingCommit,
  runCommit,
  runRelease,
  waitForTx,
} from "../src/flows.js";
import { loadPendingCommit } from "../src/session.js";
import { WalletError } from "../src/wallet/port.js";
import { BASE_URL, makeHarness } from "./helpers.js";

/** Ten instant tries instead of 20 waits of 3 s. */
const FAST_POLL: PollOptions = { intervalMs: 1, timeoutMs: 10, sleep: async () => undefined };

beforeEach(() => {
  window.sessionStorage.clear();
});

function setup(scenario: Parameters<typeof makeHarness>[0] = { scenario: "no-position" }) {
  const harness = makeHarness(scenario);
  let token: string | null = null;
  let unauthorized = 0;
  const api = createApiClient({
    baseUrl: BASE_URL,
    fetch: harness.fetch,
    getToken: () => token,
    onUnauthorized: () => {
      unauthorized++;
      token = null;
    },
  });
  return {
    ...harness,
    api,
    unauthorizedCount: () => unauthorized,
    async login() {
      const session = await linkWallet({ api, wallet: harness.wallet });
      token = session.sessionToken;
      return session;
    },
  };
}

describe("link flow with a fake wallet", () => {
  it("signs the challenge message exactly as returned and opens a session", async () => {
    const t = setup();
    const challenge = await t.api.challenge(t.wallet.address);
    expect(challenge.message).toContain(t.wallet.address);

    const session = await t.login();
    expect(session.address).toBe(t.wallet.address);
    expect(session.chain).toBe("stellar");
    // The message the wallet signed is a message the API issued, byte for byte (the mock checks
    // the SEP-53 signature against its stored text; a changed byte would have been LinkRejected).
    expect(t.wallet.signedMessages).toHaveLength(1);
    expect(t.wallet.signedMessages[0]).toMatch(/^localhost:5173 wants you to sign in/);
  });

  it("surfaces a wallet rejection as a typed error and a Spanish sentence", async () => {
    const t = setup();
    t.wallet.rejectNext = true;
    const failure = await t.login().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(WalletError);
    expect(messageFor(failure)).toBe("Cancelaste la solicitud en tu billetera. No se hizo nada.");
  });

  it("is refused when the signature does not match the message", async () => {
    const t = setup();
    const challenge = await t.api.challenge(t.wallet.address);
    const other = await t.wallet.signMessage("something else", t.wallet.address);
    const failure = await t.api.verify(challenge.nonce, other).catch((error: unknown) => error);
    expect(hasErrorCode(failure, "LinkRejected")).toBe(true);
  });
});

describe("commit flow", () => {
  it("signs for the API's passphrase, submits, and reports the hash", async () => {
    const t = setup();
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const steps: string[] = [];

    const outcome = await runCommit({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 250_000_000n,
      goalM: 15_000,
      onStep: (step) => steps.push(step),
    });

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.mirrored).toBe(true);
    expect(steps).toEqual(["preparing", "signing", "sending", "recording"]);
    expect(loadPendingCommit()).toBeNull();

    const weeks = await t.api.weeks();
    expect(weeks.nextWeek.position).toEqual({
      state: "Active",
      amount: "250000000",
      goalM: 15_000,
      commitTxHash: outcome.txHash,
    });
  });

  it("returns FAILED without recording anything", async () => {
    const t = setup({ scenario: "tx-failed" });
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const outcome = await runCommit({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 200_000_000n,
      goalM: 5000,
    });
    expect(outcome.status).toBe("FAILED");
    expect(loadPendingCommit()).toBeNull();
    expect((await t.api.weeks()).nextWeek.position).toBeNull();
  });

  it("polls GET /tx/{hash} after PENDING and carries on when it lands", async () => {
    const t = setup({ scenario: "tx-pending" });
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const steps: string[] = [];
    const outcome = await runCommit({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 200_000_000n,
      goalM: 5000,
      poll: FAST_POLL,
      onStep: (step) => steps.push(step),
    });
    expect(outcome).toMatchObject({ status: "SUCCESS", mirrored: true });
    expect(steps).toContain("confirming");
    expect(loadPendingCommit()).toBeNull();
    expect((await t.api.weeks()).nextWeek.position?.commitTxHash).toBe(outcome.txHash);
  });

  it("falls back to PENDING after the polling window and keeps the hash for later", async () => {
    const t = setup({ scenario: "tx-stuck" });
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const outcome = await runCommit({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 200_000_000n,
      goalM: 5000,
      poll: FAST_POLL,
    });
    expect(outcome.status).toBe("PENDING");
    expect(loadPendingCommit()?.txHash).toBe(outcome.txHash);
    // Still unseen on-chain: the retry stays queued instead of dropping the hash.
    expect(await reconcilePendingCommit({ api: t.api, address: session.address })).toBe("waiting");
    expect(loadPendingCommit()).not.toBeNull();
  });

  it("keeps the hash when the position report fails after a SUCCESS", async () => {
    const t = setup();
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const failingApi = {
      ...t.api,
      reportPosition: () => Promise.reject(new AgentHabitError("NetworkError", "down")),
    };
    const outcome = await runCommit({
      api: failingApi,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 200_000_000n,
      goalM: 5000,
    });
    expect(outcome).toMatchObject({ status: "SUCCESS", mirrored: false });
    expect(loadPendingCommit()?.txHash).toBe(outcome.txHash);
    // The next load reports it with the real API.
    expect(await reconcilePendingCommit({ api: t.api, address: session.address })).toBe("mirrored");
    expect((await t.api.weeks()).nextWeek.position?.commitTxHash).toBe(outcome.txHash);
  });

  it("does not report another wallet's pending commit", async () => {
    const t = setup();
    const session = await t.login();
    const { instance } = await t.api.weeks();
    const failingApi = {
      ...t.api,
      reportPosition: () => Promise.reject(new AgentHabitError("NetworkError", "down")),
    };
    await runCommit({
      api: failingApi,
      wallet: t.wallet,
      address: session.address,
      instance,
      amount: 200_000_000n,
      goalM: 5000,
    });
    expect(await reconcilePendingCommit({ api: t.api, address: "GOTHERWALLET" })).toBe("none");
    expect(loadPendingCommit()).not.toBeNull();
  });

  it("maps a contract rejection from the API to a friendly sentence", async () => {
    const t = setup();
    await t.login();
    const failure = await t.api.buildCommit({ amount: "1", goalM: 5000 }).catch((e: unknown) => e);
    expect(messageFor(failure)).toContain("El contrato no aceptó la operación");
  });
});

describe("release flow", () => {
  it("builds, signs and submits the release of an expired week", async () => {
    const t = setup({ scenario: "expired" });
    const session = await t.login();
    const { unsettledWeeks } = await t.api.weeks();
    expect(unsettledWeeks).toHaveLength(1);
    const week = unsettledWeeks[0];
    if (week === undefined) throw new Error("unreachable");
    expect(Date.parse(week.releaseOpensAt)).toBeLessThan(Date.now());
    const outcome = await runRelease({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      weekId: week.weekId,
    });
    expect(outcome.status).toBe("SUCCESS");
    expect((await t.api.weeks()).unsettledWeeks).toHaveLength(0);
  });
});

describe("401 handling in the client", () => {
  it("calls onUnauthorized when an authenticated request gets a 401", async () => {
    const t = setup({ scenario: "session-expired" });
    await t.login();
    const failure = await t.api.me().catch((error: unknown) => error);
    expect(hasErrorCode(failure, "Unauthenticated")).toBe(true);
    expect(t.unauthorizedCount()).toBe(1);
  });

  it("never sends a token to public endpoints", async () => {
    const t = setup();
    await t.login();
    await t.api.config();
    expect(t.requestedUrls.some((url) => url.includes("sessionToken"))).toBe(false);
  });

  it("rejects a body that does not match the contract", async () => {
    const api = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => Response.json({ weeks: "nope" }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    const failure = await api.weeks().catch((error: unknown) => error);
    expect(hasErrorCode(failure, "NetworkError")).toBe(true);
  });

  it("maps codes the contract does not list yet", async () => {
    const api = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => Response.json({ error: "AccountNotFunded" }, { status: 422 }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    const failure = await api.buildCommit({ amount: "1", goalM: 1 }).catch((e: unknown) => e);
    expect(messageFor(failure)).toContain("friendbot");
    const notReady = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => Response.json({ error: "ConfigError" }, { status: 503 }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    expect(messageFor(await notReady.weeks().catch((e: unknown) => e))).toContain("no está listo");
  });
});

describe("waitForTx", () => {
  it("keeps asking through a failed status call and stops on a final status", async () => {
    const answers = ["boom", "PENDING", "SUCCESS"];
    const api = {
      txStatus: async (txHash: string) => {
        const next = answers.shift();
        if (next === "boom") throw new AgentHabitError("NetworkError", "down");
        return { txHash, status: next as "PENDING" | "SUCCESS" };
      },
    } as unknown as Parameters<typeof waitForTx>[0];
    expect(await waitForTx(api, "a".repeat(64), FAST_POLL)).toBe("SUCCESS");
    expect(answers).toHaveLength(0);
  });

  it("gives up with PENDING at the deadline, asking every interval", async () => {
    let asked = 0;
    const api = {
      txStatus: async (txHash: string) => {
        asked++;
        return { txHash, status: "PENDING" as const };
      },
    } as unknown as Parameters<typeof waitForTx>[0];
    const sleeps: number[] = [];
    const outcome = await waitForTx(api, "a".repeat(64), {
      intervalMs: 3000,
      timeoutMs: 60_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(outcome).toBe("PENDING");
    expect(asked).toBe(20);
    expect(new Set(sleeps)).toEqual(new Set([3000]));
  });

  it("stops at once when the session is lost", async () => {
    const api = {
      txStatus: async () => {
        throw new AgentHabitError("Unauthenticated", "gone");
      },
    } as unknown as Parameters<typeof waitForTx>[0];
    const failure = await waitForTx(api, "a".repeat(64), FAST_POLL).catch((e: unknown) => e);
    expect(hasErrorCode(failure, "Unauthenticated")).toBe(true);
  });
});
