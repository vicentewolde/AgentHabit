// @vitest-environment jsdom
import { AgentHabitError, hasErrorCode } from "@agenthabit/core";
import { beforeEach, describe, expect, it } from "vitest";
import { createApiClient } from "../src/api/client.js";
import { messageFor } from "../src/api/messages.js";
import { isWebError } from "../src/errors.js";
import {
  linkWallet,
  type PollOptions,
  reconcilePendingCommit,
  runCommit,
  runRelease,
  waitForTx,
} from "../src/flows.js";
import { clearPending, loadPending, savePending } from "../src/pending.js";
import { WalletError } from "../src/wallet/port.js";
import { BASE_URL, makeHarness } from "./helpers.js";

/** Ten instant tries instead of 20 waits of 3 s. */
const FAST_POLL: PollOptions = { intervalMs: 1, timeoutMs: 10, sleep: async () => undefined };

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
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

async function commitArgs(t: ReturnType<typeof setup>, amount = 200_000_000n, goalM = 5000) {
  const session = await t.login();
  const weeks = await t.api.weeks();
  return {
    api: t.api,
    wallet: t.wallet,
    address: session.address,
    instance: weeks.instance,
    weekId: weeks.nextWeek.weekId,
    amount,
    goalM,
  };
}

describe("commit flow", () => {
  it("signs for the API's passphrase, submits, and reports the hash", async () => {
    const t = setup();
    const args = await commitArgs(t, 250_000_000n, 15_000);
    const steps: string[] = [];

    const outcome = await runCommit({ ...args, onStep: (step) => steps.push(step) });

    expect(outcome.status).toBe("SUCCESS");
    expect(outcome.mirrored).toBe(true);
    expect(steps).toEqual(["preparing", "signing", "sending", "recording"]);
    expect(loadPending(args.address)).toBeNull();

    const weeks = await t.api.weeks();
    expect(weeks.nextWeek.position).toEqual({
      state: "Active",
      amount: "250000000",
      goalM: 15_000,
      commitTxHash: outcome.txHash,
    });
  });

  it("returns FAILED, records nothing and clears the stored commit", async () => {
    const t = setup({ scenario: "tx-failed" });
    const args = await commitArgs(t);
    const outcome = await runCommit(args);
    expect(outcome.status).toBe("FAILED");
    expect(loadPending(args.address)).toBeNull();
    expect((await t.api.weeks()).nextWeek.position).toBeNull();
  });

  it("polls GET /tx/{hash} after PENDING and carries on when it lands", async () => {
    const t = setup({ scenario: "tx-pending" });
    const args = await commitArgs(t);
    const steps: string[] = [];
    const outcome = await runCommit({ ...args, poll: FAST_POLL, onStep: (s) => steps.push(s) });
    expect(outcome).toMatchObject({ status: "SUCCESS", mirrored: true });
    expect(steps).toContain("confirming");
    expect(loadPending(args.address)).toBeNull();
    expect((await t.api.weeks()).nextWeek.position?.commitTxHash).toBe(outcome.txHash);
  });

  it("falls back to PENDING after the polling window and keeps the hash for later", async () => {
    const t = setup({ scenario: "tx-stuck" });
    const args = await commitArgs(t);
    const outcome = await runCommit({ ...args, poll: FAST_POLL });
    expect(outcome.status).toBe("PENDING");
    expect(loadPending(args.address)?.txHash).toBe(outcome.txHash);
    // Still PENDING: the record stays, and nobody may sign a second commit meanwhile.
    const again = await reconcilePendingCommit({ api: t.api, address: args.address });
    expect(again.result).toBe("waiting");
    expect(again.pending?.txHash).toBe(outcome.txHash);
    const second = await runCommit({ ...args, poll: FAST_POLL }).catch((e: unknown) => e);
    expect(isWebError(second) && second.code === "CommitPending").toBe(true);
    expect(t.wallet.signedXdrs).toHaveLength(1);
  });

  it("keeps the hash when the position report fails after a SUCCESS, then reports it", async () => {
    const t = setup();
    const args = await commitArgs(t);
    const failingApi = {
      ...t.api,
      reportPosition: () => Promise.reject(new AgentHabitError("NetworkError", "down")),
    };
    const outcome = await runCommit({ ...args, api: failingApi });
    expect(outcome).toMatchObject({ status: "SUCCESS", mirrored: false });
    expect(loadPending(args.address)?.txHash).toBe(outcome.txHash);

    const next = await reconcilePendingCommit({ api: t.api, address: args.address });
    expect(next.result).toBe("mirrored");
    expect(loadPending(args.address)).toBeNull();
    expect((await t.api.weeks()).nextWeek.position?.commitTxHash).toBe(outcome.txHash);
  });

  it("survives the network dropping after signing: the signed transaction is sent again", async () => {
    const t = setup();
    const args = await commitArgs(t);
    t.dropNext("/tx/submit");

    const failure = await runCommit(args).catch((error: unknown) => error);
    expect(hasErrorCode(failure, "NetworkError")).toBe(true);
    // Signed once, never confirmed as received: the signed XDR is kept, with no hash yet.
    const stored = loadPending(args.address);
    expect(stored?.signedXdr).toBeDefined();
    expect(stored?.txHash).toBeUndefined();
    expect((await t.api.weeks()).nextWeek.position).toBeNull();

    // The next load submits that same XDR (no new signature) and then reports the position.
    const next = await reconcilePendingCommit({ api: t.api, address: args.address });
    expect(next.result).toBe("mirrored");
    expect(t.wallet.signedXdrs).toHaveLength(1);
    expect(loadPending(args.address)).toBeNull();
    expect((await t.api.weeks()).nextWeek.position?.commitTxHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("drops a stored commit once the API refuses it for good, but not on a server error", async () => {
    const t = setup();
    const args = await commitArgs(t);
    const refuse = (status: number) => ({
      ...t.api,
      submit: () =>
        Promise.reject(new AgentHabitError("ContractRejected", "no", { details: { status } })),
    });
    await runCommit({ ...args, api: refuse(502) }).catch(() => undefined);
    expect(loadPending(args.address)).not.toBeNull();
    clearPending(args.address);
    await runCommit({ ...args, api: refuse(422) }).catch(() => undefined);
    expect(loadPending(args.address)).toBeNull();
  });

  it("drops a stored hash that later turns out FAILED, with no phantom warning", async () => {
    const t = setup();
    const args = await commitArgs(t);
    // A hash the chain never confirmed: the API answers FAILED for it.
    savePending({
      address: args.address,
      chain: "stellar",
      contract: args.instance.contract,
      weekId: args.weekId,
      txHash: "c".repeat(64),
    });
    const reconciled = await reconcilePendingCommit({ api: t.api, address: args.address });
    expect(reconciled).toEqual({ result: "none", pending: null });
    expect(loadPending(args.address)).toBeNull();
  });

  it("does not touch another wallet's stored commit", async () => {
    const t = setup();
    const args = await commitArgs(t);
    const failingApi = {
      ...t.api,
      reportPosition: () => Promise.reject(new AgentHabitError("NetworkError", "down")),
    };
    await runCommit({ ...args, api: failingApi });
    const other = await reconcilePendingCommit({ api: t.api, address: "GOTHERWALLET" });
    expect(other).toEqual({ result: "none", pending: null });
    expect(loadPending(args.address)).not.toBeNull();
  });

  it("refuses to sign when the week changed between confirming and signing", async () => {
    let clock = Date.now();
    const t = setup({ scenario: "no-position", now: () => new Date(clock) });
    const args = await commitArgs(t);
    // The user read next week as `args.weekId`; a week later the API builds for the one after.
    clock += 7 * 24 * 60 * 60 * 1000;
    const before = t.requestedUrls.length;

    const failure = await runCommit(args).catch((error: unknown) => error);

    expect(isWebError(failure) && failure.code === "WeekChanged").toBe(true);
    expect(messageFor(failure)).toBe(
      "La semana cambió mientras confirmabas. Revisa las fechas y confirma de nuevo.",
    );
    // Nothing was signed and nothing was sent or stored.
    expect(t.wallet.signedXdrs).toHaveLength(0);
    expect(t.requestedUrls.slice(before).filter((u) => u.endsWith("/tx/submit"))).toHaveLength(0);
    expect(loadPending(args.address)).toBeNull();
  });

  it("refuses to sign a transaction for another network", async () => {
    const t = setup();
    const args = await commitArgs(t);
    const failure = await runCommit({
      ...args,
      instance: {
        ...args.instance,
        networkPassphrase: "Public Global Stellar Network ; September 2015",
      },
    }).catch((error: unknown) => error);
    expect(hasErrorCode(failure, "TransactionNotAllowed")).toBe(true);
    expect(t.wallet.signedXdrs).toHaveLength(0);
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
    const { unsettledWeeks, instance } = await t.api.weeks();
    expect(unsettledWeeks).toHaveLength(1);
    const week = unsettledWeeks[0];
    if (week === undefined) throw new Error("unreachable");
    expect(Date.parse(week.releaseOpensAt)).toBeLessThan(Date.now());
    const outcome = await runRelease({
      api: t.api,
      wallet: t.wallet,
      address: session.address,
      instance,
      weekId: week.weekId,
    });
    expect(outcome.status).toBe("SUCCESS");
    expect((await t.api.weeks()).unsettledWeeks).toHaveLength(0);
  });

  it("refuses to sign when the prepared transaction is for another week", async () => {
    const t = setup({ scenario: "expired" });
    const session = await t.login();
    const { unsettledWeeks, instance } = await t.api.weeks();
    const week = unsettledWeeks[0];
    if (week === undefined) throw new Error("unreachable");
    const lying = {
      ...t.api,
      buildRelease: async (weekId: string) => ({
        ...(await t.api.buildRelease(weekId)),
        weekId: "999",
      }),
    };
    const failure = await runRelease({
      api: lying,
      wallet: t.wallet,
      address: session.address,
      instance,
      weekId: week.weekId,
    }).catch((error: unknown) => error);
    expect(isWebError(failure) && failure.code === "ReleaseWeekMismatch").toBe(true);
    expect(t.wallet.signedXdrs).toHaveLength(0);
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
    // The server answered: this is not a connection failure.
    expect(isWebError(failure) && failure.code === "ServerResponse").toBe(true);
    expect(messageFor(failure)).toBe(
      "El servidor no respondió bien, intenta de nuevo en un minuto.",
    );
  });

  it("calls a 5xx with no known code a bad server answer, not a network failure", async () => {
    const api = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => new Response("<html>Bad gateway</html>", { status: 502 }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    const failure = await api.weeks().catch((error: unknown) => error);
    expect(isWebError(failure) && failure.code === "ServerResponse").toBe(true);
    expect(isWebError(failure) && failure.status).toBe(502);
  });

  it("reserves the connection message for real network failures, including a timeout", async () => {
    const down = createApiClient({
      baseUrl: BASE_URL,
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    const failure = await down.weeks().catch((error: unknown) => error);
    expect(hasErrorCode(failure, "NetworkError")).toBe(true);
    expect(messageFor(failure)).toContain("Revisa tu conexión");

    // A server that never answers: the request is aborted when the timeout passes.
    const silent = createApiClient({
      baseUrl: BASE_URL,
      timeoutMs: 20,
      fetch: (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timeout", "TimeoutError")),
          );
        }),
      getToken: () => "t",
      onUnauthorized: () => undefined,
    });
    expect(hasErrorCode(await silent.weeks().catch((e: unknown) => e), "NetworkError")).toBe(true);
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
