import {
  AgentHabitError,
  hasErrorCode,
  type InstanceInfo,
  isAgentHabitError,
  type PreparedTxResponse,
  type VerifyResponse,
} from "@agenthabit/core";
import type { ApiClient } from "./api/client.js";
import { WebError } from "./errors.js";
import { clearPending, loadPending, type PendingCommit, savePending } from "./pending.js";
import type { WalletPort } from "./wallet/port.js";

/**
 * The multi-step flows, kept out of the components so they can be tested with a fake wallet and
 * a fake API. Each one is a straight line: ask the API, have the wallet sign, send.
 */

/** Connect the wallet, sign the API's message exactly as returned, and open a session. */
export async function linkWallet(deps: {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
}): Promise<VerifyResponse> {
  const address = await deps.wallet.connect();
  const challenge = await deps.api.challenge(address);
  // `message` is signed byte for byte: no trimming, no line-ending changes (api-contract.ts).
  const signature = await deps.wallet.signMessage(challenge.message, address);
  return deps.api.verify(challenge.nonce, signature);
}

export type CommitStep = "preparing" | "signing" | "sending" | "confirming" | "recording";

export interface PollOptions {
  readonly intervalMs: number;
  readonly timeoutMs: number;
  /** Injected for tests. */
  readonly sleep?: (ms: number) => Promise<void>;
}

/** After `/tx/submit` answers PENDING: ask `GET /tx/{hash}` every 3 s for up to 60 s. */
export const DEFAULT_POLL: PollOptions = { intervalMs: 3000, timeoutMs: 60_000 };

/**
 * Waits for a submitted transaction to leave PENDING. A transient failure of the status call is
 * not fatal (the next try may work); a lost session is. Still PENDING at the deadline stays
 * PENDING: the caller then asks the user to refresh in a minute.
 */
export async function waitForTx(
  api: ApiClient,
  txHash: string,
  poll: PollOptions = DEFAULT_POLL,
): Promise<"SUCCESS" | "FAILED" | "PENDING"> {
  const sleep = poll.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  const tries = Math.max(1, Math.floor(poll.timeoutMs / Math.max(1, poll.intervalMs)));
  for (let attempt = 0; attempt < tries; attempt++) {
    await sleep(poll.intervalMs);
    try {
      const { status } = await api.txStatus(txHash);
      if (status !== "PENDING") return status;
    } catch (error) {
      if (hasErrorCode(error, "Unauthenticated")) throw error;
    }
  }
  return "PENDING";
}

export interface TxOutcome {
  readonly status: "SUCCESS" | "FAILED" | "PENDING";
  readonly txHash: string;
  /** Commit only: the API has the position in its mirror. */
  readonly mirrored: boolean;
}

/**
 * Sign only what the app expects: the transaction must be for the network the instance names
 * (`/config`), and for the week the user confirmed. The API builds a commit for "next week" at
 * request time, so a page left open across Monday 00:00 (UTC-3) would otherwise lock the money in
 * a week other than the one on screen.
 */
function assertPrepared(
  prepared: PreparedTxResponse,
  expected: {
    readonly weekId: string;
    readonly instance: InstanceInfo;
    readonly kind: "commit" | "release";
  },
): void {
  if (prepared.weekId !== expected.weekId) {
    throw new WebError(
      expected.kind === "commit" ? "WeekChanged" : "ReleaseWeekMismatch",
      `The API prepared week ${prepared.weekId}, not the confirmed week ${expected.weekId}`,
    );
  }
  const passphrase = expected.instance.networkPassphrase;
  if (passphrase === undefined || prepared.networkPassphrase !== passphrase) {
    throw new AgentHabitError(
      "TransactionNotAllowed",
      "The API prepared a transaction for another network",
      {
        details: { expected: passphrase, got: prepared.networkPassphrase },
      },
    );
  }
}

/** A 4xx the API means for good (not a lost session, a timeout or a rate limit): do not retry. */
function isDefinitiveRefusal(error: unknown): boolean {
  if (!isAgentHabitError(error)) return false;
  const status = error.details.status;
  return (
    typeof status === "number" && status >= 400 && status < 500 && ![401, 408, 429].includes(status)
  );
}

export interface CommitRequest {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
  readonly address: string;
  readonly instance: InstanceInfo;
  /** The week the user read and confirmed; the API's transaction must be for this one. */
  readonly weekId: string;
  /** In the token's smallest unit. */
  readonly amount: bigint;
  readonly goalM: number;
  readonly onStep?: (step: CommitStep) => void;
  readonly poll?: PollOptions;
}

/**
 * Commit: the API builds the unsigned transaction, the wallet signs it, the API sends it, and on
 * `SUCCESS` the web reports the hash so the API can read it on-chain and mirror the position.
 *
 * Nothing is lost on the way: the signed transaction is stored before it is sent, the hash is
 * stored once it is known, and the record is cleared only when `POST /positions` answers 200 or
 * the transaction is confirmed FAILED (or the API refused it for good). Every load of the status
 * page picks up from wherever it stopped (`reconcilePendingCommit`).
 */
export async function runCommit(request: CommitRequest): Promise<TxOutcome> {
  const { api, wallet, address, instance } = request;
  if (loadPending(address) !== null) {
    throw new WebError("CommitPending", "A signed commit of this wallet is still unresolved");
  }

  request.onStep?.("preparing");
  const prepared = await api.buildCommit({
    amount: request.amount.toString(),
    goalM: request.goalM,
  });
  assertPrepared(prepared, { weekId: request.weekId, instance, kind: "commit" });

  request.onStep?.("signing");
  const signedXdr = await wallet.signTransaction(prepared.xdr, prepared.networkPassphrase, address);
  const record: PendingCommit = {
    address,
    chain: "stellar",
    contract: instance.contract,
    weekId: prepared.weekId,
    signedXdr,
  };
  savePending(record);

  request.onStep?.("sending");
  const sent = await submitRecord(api, record);
  let status = sent.status;
  if (status === "PENDING") {
    request.onStep?.("confirming");
    status = await waitForTx(api, sent.txHash, request.poll);
  }
  if (status === "FAILED") {
    clearPending(address);
    return { status: "FAILED", txHash: sent.txHash, mirrored: false };
  }
  if (status === "PENDING") {
    return { status: "PENDING", txHash: sent.txHash, mirrored: false };
  }

  request.onStep?.("recording");
  const mirrored = await report(api, { ...record, txHash: sent.txHash });
  return { status: "SUCCESS", txHash: sent.txHash, mirrored };
}

/** Sends the stored signed transaction and records its hash; keeps the record unless refused. */
async function submitRecord(api: ApiClient, record: PendingCommit) {
  if (record.signedXdr === undefined) {
    throw new WebError("ServerResponse", "There is no signed transaction to send");
  }
  try {
    const sent = await api.submit(record.signedXdr);
    savePending({ ...record, txHash: sent.txHash });
    return sent;
  } catch (error) {
    if (isDefinitiveRefusal(error)) clearPending(record.address);
    throw error;
  }
}

/** `POST /positions`; the record goes away only on a 200. */
async function report(
  api: ApiClient,
  record: PendingCommit & { txHash: string },
): Promise<boolean> {
  try {
    await api.reportPosition({
      chain: record.chain,
      contract: record.contract,
      weekId: record.weekId,
      txHash: record.txHash,
    });
    clearPending(record.address);
    return true;
  } catch {
    // The deposit is on-chain; only the API's copy is missing. The record stays for the next load.
    return false;
  }
}

export interface ReleaseRequest {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
  readonly address: string;
  readonly instance: InstanceInfo;
  readonly weekId: string;
  readonly onStep?: (step: CommitStep) => void;
  readonly poll?: PollOptions;
}

/** "Recuperar": `release_if_stale` for a week whose window has passed, signed by the wallet. */
export async function runRelease(request: ReleaseRequest): Promise<TxOutcome> {
  const prepared = await request.api.buildRelease(request.weekId);
  assertPrepared(prepared, { weekId: request.weekId, instance: request.instance, kind: "release" });
  const signedXdr = await request.wallet.signTransaction(
    prepared.xdr,
    prepared.networkPassphrase,
    request.address,
  );
  const sent = await request.api.submit(signedXdr);
  let status = sent.status;
  if (status === "PENDING") {
    request.onStep?.("confirming");
    status = await waitForTx(request.api, sent.txHash, request.poll);
  }
  return { status, txHash: sent.txHash, mirrored: false };
}

export type ReconcileResult = "none" | "mirrored" | "waiting";

/**
 * Picks up a stored commit of `address` from wherever it stopped, once per load (no long waits):
 * - signed but never confirmed as received: send it again (idempotent by hash);
 * - sent: ask for its status first. FAILED drops it (no phantom warning), PENDING keeps waiting,
 *   SUCCESS reports it, and the record goes only when `POST /positions` answers 200.
 * `pending` is what is still stored afterwards, so the page can say a transaction is waiting.
 */
export async function reconcilePendingCommit(deps: {
  readonly api: ApiClient;
  readonly address: string;
}): Promise<{ readonly result: ReconcileResult; readonly pending: PendingCommit | null }> {
  const { api, address } = deps;
  const stored = loadPending(address);
  if (stored === null) return { result: "none", pending: null };
  const waiting = () => ({ result: "waiting" as const, pending: loadPending(address) });

  let hash = stored.txHash;
  let status: "SUCCESS" | "FAILED" | "PENDING";
  try {
    if (hash === undefined) {
      const sent = await submitRecord(api, stored);
      hash = sent.txHash;
      status = sent.status;
    } else {
      status = (await api.txStatus(hash)).status;
    }
  } catch {
    return loadPending(address) === null ? { result: "none", pending: null } : waiting();
  }

  if (status === "FAILED") {
    clearPending(address);
    return { result: "none", pending: null };
  }
  if (status === "PENDING") return waiting();
  const mirrored = await report(api, { ...stored, txHash: hash });
  return mirrored ? { result: "mirrored", pending: null } : waiting();
}
