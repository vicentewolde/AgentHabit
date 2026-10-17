import { AgentHabitError, CONTRACT_ERRORS, type PositionState } from "@agenthabit/core";
import {
  Account,
  Address,
  BASE_FEE,
  Contract,
  FeeBumpTransaction,
  Keypair,
  nativeToScVal,
  rpc,
  scValToNative,
  type Transaction,
  TransactionBuilder,
  type xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";

/**
 * Reads and builds calls for one deployed AgentHabit contract on Soroban (spec 4.7, T6a). It
 * never holds a key: the wallet signs what `prepare*` returns, and `submit` only relays the two
 * calls the web is meant to make, for the wallet that owns the session.
 */

/** The part of the RPC server this client uses, so tests can run without a network. */
export type SorobanServer = Pick<
  rpc.Server,
  | "getAccount"
  | "simulateTransaction"
  | "prepareTransaction"
  | "sendTransaction"
  | "pollTransaction"
  | "getTransaction"
>;

export interface ContractClientOptions {
  readonly contractId: string;
  readonly networkPassphrase: string;
  readonly server: SorobanServer;
}

export const POSITION_STATE_BY_INDEX: readonly PositionState[] = [
  "None",
  "Active",
  "Returned",
  "Forfeited",
  "ReleasedStale",
];

const PositionSchema = z.object({
  amount: z.bigint(),
  goal_m: z.bigint(),
  // `#[repr(u32)]` enums travel as a u32; a symbol vector is accepted too.
  state: z.union([z.number().int().min(0).max(4), z.tuple([z.string()])]),
});

const ConfigSchema = z.object({
  token: z.string(),
  oracle: z.string(),
  min_amount: z.bigint(),
  max_amount: z.bigint(),
  min_goal_m: z.bigint(),
  max_goal_m: z.bigint(),
  week_anchor: z.bigint(),
  week_len: z.bigint(),
  grace: z.bigint(),
  stale_after: z.bigint(),
});

export interface OnChainPosition {
  readonly state: PositionState;
  readonly amount: bigint;
  readonly goalM: bigint;
}

export interface OnChainConfig {
  readonly token: string;
  readonly oracle: string;
  readonly minAmount: bigint;
  readonly maxAmount: bigint;
  readonly minGoalM: bigint;
  readonly maxGoalM: bigint;
  readonly weekAnchor: bigint;
  readonly weekLen: bigint;
  readonly grace: bigint;
  readonly staleAfter: bigint;
}

/** A transaction as the wallet will see it: unsigned, simulated and ready to sign. */
export interface PreparedTransaction {
  readonly xdr: string;
  readonly networkPassphrase: string;
}

export interface DecodedCall {
  /** The transaction's source account. */
  readonly source: string;
  /** The operation's own source, when it sets one (it then needs that account's signature too). */
  readonly operationSource: string | undefined;
  readonly contract: string;
  readonly fn: string;
  readonly args: readonly xdr.ScVal[];
}

export type SubmitStatus = "SUCCESS" | "FAILED" | "PENDING";

/**
 * Reads the single contract call a transaction makes. Refuses anything else: a fee bump, several
 * operations, or an operation that is not a contract call. Pure, so the relay rule is testable.
 */
export function decodeContractCall(
  envelope: string | xdr.TransactionEnvelope,
  networkPassphrase: string,
): DecodedCall {
  let parsed: Transaction | FeeBumpTransaction;
  try {
    parsed = TransactionBuilder.fromXDR(envelope, networkPassphrase);
  } catch (cause) {
    throw new AgentHabitError("TransactionNotAllowed", "The transaction cannot be read", { cause });
  }
  if (parsed instanceof FeeBumpTransaction) {
    throw new AgentHabitError("TransactionNotAllowed", "Fee-bump transactions are not relayed");
  }
  const [operation, ...rest] = parsed.operations;
  if (operation === undefined || rest.length > 0 || operation.type !== "invokeHostFunction") {
    throw new AgentHabitError("TransactionNotAllowed", "Only a single contract call is relayed");
  }
  const func = operation.func;
  if (func.type !== "hostFunctionTypeInvokeContract") {
    throw new AgentHabitError("TransactionNotAllowed", "Only a single contract call is relayed");
  }
  const call = func.invokeContract;
  return {
    source: parsed.source,
    operationSource: operation.source,
    contract: Address.fromScAddress(call.contractAddress).toString(),
    fn: call.functionName.toString(),
    args: call.args,
  };
}

/** `HostError: Error(Contract, #106)` → our error's name, or the bare code of another contract. */
export function contractErrorFrom(message: string): { name: string | null; code: number } | null {
  const match = /Error\(Contract, #(\d+)\)/.exec(message);
  if (match?.[1] === undefined) return null;
  const code = Number(match[1]);
  return { name: CONTRACT_ERRORS.find((error) => error.code === code)?.name ?? null, code };
}

/** The SDK reports a missing ledger entry as `{ code: 404 }` or as an error saying "not found". */
function isNotFound(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error && error.code === 404) {
    return true;
  }
  return error instanceof Error && /not found/i.test(error.message);
}

function networkError(action: string, cause: unknown): AgentHabitError {
  return new AgentHabitError("NetworkError", `Stellar: could not ${action}`, {
    cause,
    details: { action },
  });
}

export class StellarContractClient {
  readonly #server: SorobanServer;
  readonly #contract: Contract;
  readonly contractId: string;
  readonly networkPassphrase: string;

  constructor(options: ContractClientOptions) {
    this.#server = options.server;
    this.contractId = options.contractId;
    this.networkPassphrase = options.networkPassphrase;
    this.#contract = new Contract(options.contractId);
  }

  async config(): Promise<OnChainConfig> {
    const raw = await this.#read("config", []);
    const parsed = ConfigSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentHabitError(
        "DeploymentDrift",
        "The contract's config has an unexpected shape",
        {
          details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
        },
      );
    }
    const c = parsed.data;
    return {
      token: c.token,
      oracle: c.oracle,
      minAmount: c.min_amount,
      maxAmount: c.max_amount,
      minGoalM: c.min_goal_m,
      maxGoalM: c.max_goal_m,
      weekAnchor: c.week_anchor,
      weekLen: c.week_len,
      grace: c.grace,
      staleAfter: c.stale_after,
    };
  }

  /** The chain's own `current_week`: the authority for what week a commit may target. */
  async currentWeek(): Promise<bigint> {
    const week = await this.#read("current_week", []);
    if (typeof week !== "bigint") {
      throw new AgentHabitError("DeploymentDrift", "current_week did not return a number");
    }
    return week;
  }

  async totalForfeited(): Promise<bigint> {
    const total = await this.#read("total_forfeited", []);
    if (typeof total !== "bigint") {
      throw new AgentHabitError("DeploymentDrift", "total_forfeited did not return a number");
    }
    return total;
  }

  /** A week with no position reads as `None`, with zero amount and goal. */
  async getPosition(user: string, weekId: bigint): Promise<OnChainPosition> {
    const raw = await this.#read("get_position", [
      new Address(user).toScVal(),
      nativeToScVal(weekId, { type: "u64" }),
    ]);
    const parsed = PositionSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AgentHabitError("DeploymentDrift", "get_position has an unexpected shape", {
        details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
      });
    }
    const { amount, goal_m: goalM, state } = parsed.data;
    const name = typeof state === "number" ? POSITION_STATE_BY_INDEX[state] : state[0];
    const known = POSITION_STATE_BY_INDEX.find((candidate) => candidate === name);
    if (known === undefined) {
      throw new AgentHabitError("DeploymentDrift", "get_position returned an unknown state");
    }
    return { state: known, amount, goalM };
  }

  /**
   * The unsigned `commit` for `user`, simulated so the wallet only has to sign. The wallet is the
   * transaction's source, so signing it also authorizes the token transfer inside.
   */
  prepareCommit(input: {
    readonly user: string;
    readonly weekId: bigint;
    readonly amount: bigint;
    readonly goalM: bigint;
  }): Promise<PreparedTransaction> {
    return this.#prepare(input.user, "commit", [
      new Address(input.user).toScVal(),
      nativeToScVal(input.weekId, { type: "u64" }),
      nativeToScVal(input.amount, { type: "i128" }),
      nativeToScVal(input.goalM, { type: "u64" }),
    ]);
  }

  /** The unsigned `release_if_stale` ("recuperar") for `user`'s own position. */
  prepareRelease(input: {
    readonly user: string;
    readonly weekId: bigint;
  }): Promise<PreparedTransaction> {
    return this.#prepare(input.user, "release_if_stale", [
      new Address(input.user).toScVal(),
      nativeToScVal(input.weekId, { type: "u64" }),
    ]);
  }

  /**
   * Relays a transaction the wallet signed, and only if it is one of the two calls the web makes,
   * on this contract, from the session's wallet and about its own position. The API is not a free
   * relay for anything else. Waits for the ledger; a transaction still unknown after the wait is
   * `PENDING`, and `transactionStatus` can ask again.
   */
  async submit(
    signedXdr: string,
    owner: string,
  ): Promise<{ txHash: string; status: SubmitStatus }> {
    this.relayedFunction(signedXdr, owner);
    const transaction = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);
    let sent: Awaited<ReturnType<SorobanServer["sendTransaction"]>>;
    try {
      sent = await this.#server.sendTransaction(transaction);
    } catch (cause) {
      throw networkError("send the transaction", cause);
    }
    if (sent.status === "ERROR") return { txHash: sent.hash, status: "FAILED" };
    if (sent.status === "TRY_AGAIN_LATER") {
      throw networkError("send the transaction, the network asked to try again", sent.status);
    }
    return { txHash: sent.hash, status: await this.#wait(sent.hash) };
  }

  /**
   * The relay rule: a single contract call, on this contract, to `commit` or `release_if_stale`,
   * from the session's wallet (the transaction and the operation) and about that wallet's own
   * position. Returns which function it is; throws `TransactionNotAllowed` for anything else.
   */
  relayedFunction(signedXdr: string, owner: string): "commit" | "release_if_stale" {
    const call = decodeContractCall(signedXdr, this.networkPassphrase);
    let aboutOwner = false;
    try {
      aboutOwner = call.args[0] !== undefined && scValToNative(call.args[0]) === owner;
    } catch {
      // An argument of a type these calls never take: not relayed.
    }
    const ownOperation = call.operationSource === undefined || call.operationSource === owner;
    if (
      call.contract !== this.contractId ||
      (call.fn !== "commit" && call.fn !== "release_if_stale") ||
      call.source !== owner ||
      !ownOperation ||
      !aboutOwner
    ) {
      throw new AgentHabitError("TransactionNotAllowed", "This call is not relayed", {
        details: { fn: call.fn },
      });
    }
    return call.fn;
  }

  async transactionStatus(txHash: string): Promise<SubmitStatus> {
    let result: Awaited<ReturnType<SorobanServer["getTransaction"]>>;
    try {
      result = await this.#server.getTransaction(txHash);
    } catch (cause) {
      throw networkError("read the transaction", cause);
    }
    return result.status === "SUCCESS"
      ? "SUCCESS"
      : result.status === "FAILED"
        ? "FAILED"
        : "PENDING";
  }

  /**
   * The position a confirmed `commit` created (spec 4.4, step 2): the transaction succeeded, it
   * is a `commit` on this contract for this user and week, and the chain now holds the position
   * as `Active`. Null when the chain does not confirm all of that.
   */
  async verifyCommit(input: {
    readonly user: string;
    readonly weekId: bigint;
    readonly txHash: string;
  }): Promise<{ amount: bigint; goalM: bigint } | null> {
    let result: Awaited<ReturnType<SorobanServer["getTransaction"]>>;
    try {
      result = await this.#server.getTransaction(input.txHash);
    } catch (cause) {
      throw networkError("read the transaction", cause);
    }
    if (result.status !== "SUCCESS") return null;
    let call: DecodedCall;
    try {
      call = decodeContractCall(result.envelopeXdr, this.networkPassphrase);
    } catch {
      return null;
    }
    const [userArg, weekArg] = call.args;
    if (
      call.contract !== this.contractId ||
      call.fn !== "commit" ||
      userArg === undefined ||
      weekArg === undefined ||
      scValToNative(userArg) !== input.user ||
      scValToNative(weekArg) !== input.weekId
    ) {
      return null;
    }
    const position = await this.getPosition(input.user, input.weekId);
    return position.state === "Active" ? { amount: position.amount, goalM: position.goalM } : null;
  }

  async #read(method: string, args: xdr.ScVal[]): Promise<unknown> {
    // A read needs no real account: simulation only runs the contract at the latest ledger.
    const source = new Account(Keypair.random().publicKey(), "0");
    const transaction = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.#contract.call(method, ...args))
      .setTimeout(30)
      .build();
    let simulation: Awaited<ReturnType<SorobanServer["simulateTransaction"]>>;
    try {
      simulation = await this.#server.simulateTransaction(transaction);
    } catch (cause) {
      throw networkError(`read ${method}`, cause);
    }
    if (rpc.Api.isSimulationError(simulation)) {
      throw this.#rejected(method, simulation.error);
    }
    const retval = "result" in simulation ? simulation.result?.retval : undefined;
    if (retval === undefined) {
      throw new AgentHabitError("DeploymentDrift", `${method} returned nothing`);
    }
    return scValToNative(retval);
  }

  async #prepare(user: string, method: string, args: xdr.ScVal[]): Promise<PreparedTransaction> {
    let account: Account;
    try {
      account = await this.#server.getAccount(user);
    } catch (cause) {
      // Only "the network does not know this account" means it is not funded: an RPC that is
      // down is a network problem, and telling the user to fund a wallet would be wrong.
      if (isNotFound(cause)) {
        throw new AgentHabitError(
          "AccountNotFunded",
          "The wallet has no account on the network yet: it needs XLM for fees",
          { cause },
        );
      }
      throw networkError("read the wallet's account", cause);
    }
    const transaction = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(this.#contract.call(method, ...args))
      .setTimeout(300)
      .build();
    try {
      const prepared = await this.#server.prepareTransaction(transaction);
      return { xdr: prepared.toXDR(), networkPassphrase: this.networkPassphrase };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (contractErrorFrom(message) !== null) throw this.#rejected(method, message);
      throw networkError(`prepare ${method}`, cause);
    }
  }

  #rejected(method: string, message: string): AgentHabitError {
    const known = contractErrorFrom(message);
    return new AgentHabitError("ContractRejected", `The contract refused ${method}`, {
      // The name or number only: the raw message can carry an event log.
      details: {
        method,
        contractError: known?.name ?? null,
        contractErrorCode: known?.code ?? null,
      },
    });
  }

  async #wait(txHash: string): Promise<SubmitStatus> {
    try {
      const final = await this.#server.pollTransaction(txHash, { attempts: 25 });
      return final.status === "SUCCESS"
        ? "SUCCESS"
        : final.status === "FAILED"
          ? "FAILED"
          : "PENDING";
    } catch {
      // The transaction was sent; not knowing its outcome is "pending", not a failure.
      return "PENDING";
    }
  }
}
