import { hasErrorCode, type InstanceInfo, type VerifyResponse } from "@agenthabit/core";
import type { ApiClient } from "./api/client.js";
import { clearPendingCommit, loadPendingCommit, savePendingCommit } from "./session.js";
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

export interface CommitRequest {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
  readonly address: string;
  readonly instance: InstanceInfo;
  /** In the token's smallest unit. */
  readonly amount: bigint;
  readonly goalM: number;
  readonly onStep?: (step: CommitStep) => void;
  readonly poll?: PollOptions;
}

/**
 * Commit: the API builds the unsigned transaction, the wallet signs it for the passphrase the API
 * names, the API sends it, and on `SUCCESS` the web reports the hash so the API can read it
 * on-chain and mirror the position. A transaction that is on the way, or confirmed but not yet
 * mirrored, is remembered for this tab so the next visit can report it.
 */
export async function runCommit(request: CommitRequest): Promise<TxOutcome> {
  const { api, wallet, address, instance } = request;
  request.onStep?.("preparing");
  const prepared = await api.buildCommit({
    amount: request.amount.toString(),
    goalM: request.goalM,
  });

  request.onStep?.("signing");
  const signedXdr = await wallet.signTransaction(prepared.xdr, prepared.networkPassphrase, address);

  request.onStep?.("sending");
  const sent = await api.submit(signedXdr);
  let status = sent.status;
  if (status === "PENDING") {
    request.onStep?.("confirming");
    status = await waitForTx(api, sent.txHash, request.poll);
  }
  if (status === "FAILED") {
    return { status: "FAILED", txHash: sent.txHash, mirrored: false };
  }

  const report = {
    chain: "stellar" as const,
    contract: instance.contract,
    weekId: prepared.weekId,
    txHash: sent.txHash,
  };
  if (status === "PENDING") {
    savePendingCommit({ ...report, address });
    return { status: "PENDING", txHash: sent.txHash, mirrored: false };
  }

  // Keep the hash before asking the API to record it, so a closed tab or a failed call cannot
  // lose it. It stays until `POST /positions` answers 200, and every load of the status page
  // retries it (the oracle cannot settle a position the API never mirrored).
  savePendingCommit({ ...report, address });
  request.onStep?.("recording");
  try {
    await api.reportPosition(report);
    clearPendingCommit();
    return { status: "SUCCESS", txHash: sent.txHash, mirrored: true };
  } catch {
    // The deposit is on-chain; only the API's copy is missing.
    return { status: "SUCCESS", txHash: sent.txHash, mirrored: false };
  }
}

export interface ReleaseRequest {
  readonly api: ApiClient;
  readonly wallet: WalletPort;
  readonly address: string;
  readonly weekId: string;
  readonly onStep?: (step: CommitStep) => void;
  readonly poll?: PollOptions;
}

/** "Recuperar": `release_if_stale` for a week whose window has passed, signed by the wallet. */
export async function runRelease(request: ReleaseRequest): Promise<TxOutcome> {
  const prepared = await request.api.buildRelease(request.weekId);
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
 * Reports a commit left over from an earlier attempt in this tab, if it belongs to `address`.
 * It is kept until the API answers 200, whatever the refusal: `waiting` means it is still being
 * retried, and the next load of the status page tries again.
 */
export async function reconcilePendingCommit(deps: {
  readonly api: ApiClient;
  readonly address: string;
}): Promise<ReconcileResult> {
  const pending = loadPendingCommit();
  if (pending === null || pending.address !== deps.address) return "none";
  try {
    await deps.api.reportPosition({
      chain: pending.chain,
      contract: pending.contract,
      weekId: pending.weekId,
      txHash: pending.txHash,
    });
    clearPendingCommit();
    return "mirrored";
  } catch {
    return "waiting";
  }
}
