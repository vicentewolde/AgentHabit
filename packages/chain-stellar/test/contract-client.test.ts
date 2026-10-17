import { hasErrorCode, isAgentHabitError } from "@agenthabit/core";
import {
  Account,
  Address,
  Asset,
  BASE_FEE,
  Contract,
  Keypair,
  nativeToScVal,
  Operation,
  StrKey,
  type Transaction,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import {
  contractErrorFrom,
  decodeContractCall,
  rejectionReason,
  type SorobanServer,
  StellarContractClient,
} from "../src/contract-client.js";

// A simulated RPC and synthetic keys only: nothing here touches a network.
const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const OTHER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 9));
const user = Keypair.random();
const stranger = Keypair.random();

type Reply = Partial<Record<keyof SorobanServer, unknown>>;

interface Fake {
  readonly server: SorobanServer;
  readonly sent: Transaction[];
}

/** A fake server: each method answers from `reply`, and sending is recorded. */
function fakeServer(reply: Reply = {}): Fake {
  const sent: Transaction[] = [];
  const server = {
    getAccount: async (address: string) => {
      if (reply.getAccount instanceof Error) throw reply.getAccount;
      return new Account(address, "5");
    },
    simulateTransaction: async () => reply.simulateTransaction,
    prepareTransaction: async (transaction: Transaction) => {
      if (reply.prepareTransaction instanceof Error) throw reply.prepareTransaction;
      return transaction;
    },
    sendTransaction: async (transaction: Transaction) => {
      sent.push(transaction);
      return reply.sendTransaction ?? { status: "PENDING", hash: "ab".repeat(32) };
    },
    pollTransaction: async () => reply.pollTransaction ?? { status: "SUCCESS" },
    getTransaction: async () => reply.getTransaction ?? { status: "NOT_FOUND" },
  };
  return { server: server as unknown as SorobanServer, sent };
}

const client = (server: SorobanServer) =>
  new StellarContractClient({ contractId: CONTRACT, networkPassphrase: PASSPHRASE, server });

function simulating(value: unknown, type?: Parameters<typeof nativeToScVal>[1]) {
  return { result: { retval: nativeToScVal(value, type), auth: [] } };
}

const positionOf = (state: number, amount = 200_000_000n, goal = 10_000n) =>
  simulating(
    { amount, goal_m: goal, state },
    { type: { amount: ["symbol", "i128"], goal_m: ["symbol", "u64"], state: ["symbol", "u32"] } },
  );

/** A signed commit transaction, as the wallet returns it. */
async function signedCall(options: {
  readonly signer?: Keypair;
  readonly contract?: string;
  readonly fn?: string;
  readonly userArg?: string;
  readonly operations?: number;
}): Promise<string> {
  const signer = options.signer ?? user;
  const contract = new Contract(options.contract ?? CONTRACT);
  const builder = new TransactionBuilder(new Account(signer.publicKey(), "5"), {
    fee: BASE_FEE,
    networkPassphrase: PASSPHRASE,
  });
  for (let i = 0; i < (options.operations ?? 1); i++) {
    builder.addOperation(
      contract.call(
        options.fn ?? "commit",
        new Address(options.userArg ?? user.publicKey()).toScVal(),
        nativeToScVal(3n, { type: "u64" }),
        nativeToScVal(200_000_000n, { type: "i128" }),
        nativeToScVal(10_000n, { type: "u64" }),
      ),
    );
  }
  const transaction = builder.setTimeout(300).build();
  transaction.sign(signer);
  return transaction.toXDR();
}

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return "no error";
}

describe("decodeContractCall", () => {
  it("reads the source, the contract, the function and its arguments", async () => {
    const call = decodeContractCall(await signedCall({}), PASSPHRASE);

    expect(call.source).toBe(user.publicKey());
    expect(call.contract).toBe(CONTRACT);
    expect(call.fn).toBe("commit");
    expect(call.args).toHaveLength(4);
  });

  it("refuses a transaction with more than one operation, and garbage", async () => {
    for (const input of [await signedCall({ operations: 2 }), "not an envelope"]) {
      expect(
        hasErrorCode(
          failure_sync(() => decodeContractCall(input, PASSPHRASE)),
          "TransactionNotAllowed",
        ),
      ).toBe(true);
    }
  });
});

function failure_sync(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return "no error";
}

describe("rejectionReason", () => {
  it("names our own errors and the token errors a user can act on, and leaves the rest", () => {
    expect(rejectionReason(contractErrorFrom("Error(Contract, #106)"))).toBe("WrongWeek");
    expect(rejectionReason(contractErrorFrom("Error(Contract, #10)"))).toBe("InsufficientBalance");
    expect(rejectionReason(contractErrorFrom("Error(Contract, #11)"))).toBe("TokenBlocked");
    expect(rejectionReason(contractErrorFrom("Error(Contract, #13)"))).toBe("NoUsdcTrustline");
    expect(rejectionReason(contractErrorFrom("Error(Contract, #4)"))).toBeNull();
    expect(rejectionReason(contractErrorFrom("a network hiccup"))).toBeNull();
  });

  it("travels with a refused simulation, so the web can explain it", async () => {
    const fake = fakeServer({ prepareTransaction: new Error("HostError: Error(Contract, #10)") });

    const error = await failure(
      client(fake.server).prepareCommit({
        user: user.publicKey(),
        weekId: 3n,
        amount: 1n,
        goalM: 1n,
      }),
    );

    expect(isAgentHabitError(error) && error.details).toMatchObject({
      contractErrorCode: 10,
      reason: "InsufficientBalance",
    });
  });
});

describe("contractErrorFrom", () => {
  it("names our own errors by their number and leaves another contract's as a bare code", () => {
    expect(contractErrorFrom("HostError: Error(Contract, #106)\n\nEvent log")).toEqual({
      name: "WrongWeek",
      code: 106,
    });
    expect(contractErrorFrom("HostError: Error(Contract, #10)")).toEqual({ name: null, code: 10 });
    expect(contractErrorFrom("a network hiccup")).toBeNull();
  });
});

describe("reads", () => {
  it("decodes the config", async () => {
    const fake = fakeServer({
      simulateTransaction: simulating(
        {
          token: new Address(StrKey.encodeContract(Buffer.alloc(32, 1))),
          oracle: new Address(user.publicKey()),
          min_amount: 200_000_000n,
          max_amount: 500_000_000n,
          min_goal_m: 10_000n,
          max_goal_m: 300_000n,
          week_anchor: 1_791_774_000n,
          week_len: 604_800n,
          grace: 172_800n,
          stale_after: 604_800n,
        },
        {
          type: {
            token: ["symbol", "address"],
            oracle: ["symbol", "address"],
            min_amount: ["symbol", "i128"],
            max_amount: ["symbol", "i128"],
            min_goal_m: ["symbol", "u64"],
            max_goal_m: ["symbol", "u64"],
            week_anchor: ["symbol", "u64"],
            week_len: ["symbol", "u64"],
            grace: ["symbol", "u64"],
            stale_after: ["symbol", "u64"],
          },
        },
      ),
    });

    const config = await client(fake.server).config();

    expect(config).toMatchObject({
      oracle: user.publicKey(),
      minAmount: 200_000_000n,
      maxGoalM: 300_000n,
      weekAnchor: 1_791_774_000n,
      staleAfter: 604_800n,
    });
  });

  it("reads the current week and the forfeited total as bigints", async () => {
    expect(
      await client(
        fakeServer({ simulateTransaction: simulating(2n, { type: "u64" }) }).server,
      ).currentWeek(),
    ).toBe(2n);
    expect(
      await client(
        fakeServer({ simulateTransaction: simulating(0n, { type: "i128" }) }).server,
      ).totalForfeited(),
    ).toBe(0n);
  });

  it("decodes a position's state from its u32", async () => {
    for (const [index, name] of [
      [0, "None"],
      [1, "Active"],
      [2, "Returned"],
      [3, "Forfeited"],
      [4, "ReleasedStale"],
    ] as const) {
      const fake = fakeServer({ simulateTransaction: positionOf(index) });
      expect((await client(fake.server).getPosition(user.publicKey(), 3n)).state).toBe(name);
    }
  });

  it("turns a contract error in a simulation into ContractRejected, naming the error", async () => {
    const fake = fakeServer({
      simulateTransaction: { error: "HostError: Error(Contract, #104)\n\nEvent log" },
    });

    const error = await failure(client(fake.server).getPosition(user.publicKey(), 3n));

    expect(hasErrorCode(error, "ContractRejected")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toMatchObject({
      contractError: "PositionNotFound",
    });
  });

  it("flags a config of an unexpected shape as drift", async () => {
    const fake = fakeServer({ simulateTransaction: simulating({ token: "x" }) });
    expect(hasErrorCode(await failure(client(fake.server).config()), "DeploymentDrift")).toBe(true);
  });
});

describe("prepareCommit and prepareRelease", () => {
  it("builds a transaction whose source is the wallet and whose call is the commit", async () => {
    const prepared = await client(fakeServer().server).prepareCommit({
      user: user.publicKey(),
      weekId: 3n,
      amount: 200_000_000n,
      goalM: 10_000n,
    });

    expect(prepared.networkPassphrase).toBe(PASSPHRASE);
    const call = decodeContractCall(prepared.xdr, PASSPHRASE);
    expect(call).toMatchObject({ source: user.publicKey(), contract: CONTRACT, fn: "commit" });
  });

  it("builds the release for the wallet's own position", async () => {
    const prepared = await client(fakeServer().server).prepareRelease({
      user: user.publicKey(),
      weekId: 3n,
    });

    expect(decodeContractCall(prepared.xdr, PASSPHRASE)).toMatchObject({ fn: "release_if_stale" });
  });

  it("says the account is not funded when the network does not know the wallet", async () => {
    const fake = fakeServer({ getAccount: new Error("account not found") });
    const error = await failure(
      client(fake.server).prepareCommit({
        user: user.publicKey(),
        weekId: 3n,
        amount: 1n,
        goalM: 1n,
      }),
    );
    expect(hasErrorCode(error, "AccountNotFunded")).toBe(true);
  });

  it("reports what the contract would refuse, before the wallet is asked to sign", async () => {
    const fake = fakeServer({ prepareTransaction: new Error("HostError: Error(Contract, #109)") });
    const error = await failure(
      client(fake.server).prepareCommit({
        user: user.publicKey(),
        weekId: 3n,
        amount: 1n,
        goalM: 1n,
      }),
    );

    expect(hasErrorCode(error, "ContractRejected")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toMatchObject({
      contractError: "AmountOutOfRange",
    });
  });
});

describe("submit (the relay rule)", () => {
  it("relays the wallet's own commit and waits for the ledger", async () => {
    const fake = fakeServer({ pollTransaction: { status: "SUCCESS" } });

    const result = await client(fake.server).submit(await signedCall({}), user.publicKey());

    expect(result).toEqual({ txHash: "ab".repeat(32), status: "SUCCESS" });
    expect(fake.sent).toHaveLength(1);
  });

  it("reports a rejected transaction as FAILED, and a slow one as PENDING", async () => {
    const rejected = fakeServer({ sendTransaction: { status: "ERROR", hash: "cd".repeat(32) } });
    expect(
      (await client(rejected.server).submit(await signedCall({}), user.publicKey())).status,
    ).toBe("FAILED");

    const slow = fakeServer({ pollTransaction: { status: "NOT_FOUND" } });
    expect((await client(slow.server).submit(await signedCall({}), user.publicKey())).status).toBe(
      "PENDING",
    );
  });

  it("sends nothing that is not the owner's commit or release on this contract", async () => {
    const cases: Record<string, Parameters<typeof signedCall>[0]> = {
      "another contract": { contract: OTHER_CONTRACT },
      "another function": { fn: "config" },
      "another wallet's transaction": { signer: stranger, userArg: stranger.publicKey() },
      "a position of someone else": { userArg: stranger.publicKey() },
      "two operations": { operations: 2 },
    };
    for (const [label, options] of Object.entries(cases)) {
      const fake = fakeServer();
      const error = await failure(
        client(fake.server).submit(await signedCall(options), user.publicKey()),
      );

      expect(hasErrorCode(error, "TransactionNotAllowed"), label).toBe(true);
      expect(fake.sent, label).toHaveLength(0);
    }
  });
});

describe("verifyCommit (spec 4.4, step 2)", () => {
  const envelope = async (options: Parameters<typeof signedCall>[0] = {}) =>
    xdr.TransactionEnvelope.fromXDR(await signedCall(options), "base64");
  const input = { user: user.publicKey(), weekId: 3n, txHash: "ab".repeat(32) };

  it("returns what the chain holds when the transaction was this user's commit", async () => {
    const fake = fakeServer({
      getTransaction: { status: "SUCCESS", envelopeXdr: await envelope() },
      simulateTransaction: positionOf(1, 200_000_000n, 12_000n),
    });

    expect(await client(fake.server).verifyCommit(input)).toEqual({
      amount: 200_000_000n,
      goalM: 12_000n,
    });
  });

  it("returns null for a failed or unknown transaction", async () => {
    for (const getTransaction of [{ status: "FAILED" }, { status: "NOT_FOUND" }]) {
      const fake = fakeServer({ getTransaction, simulateTransaction: positionOf(1) });
      expect(await client(fake.server).verifyCommit(input)).toBeNull();
    }
  });

  it("returns null when the transaction is another week, another contract or another call", async () => {
    const cases = [
      { ...input, weekId: 4n },
      { ...input, user: stranger.publicKey() },
    ];
    for (const wrong of cases) {
      const fake = fakeServer({
        getTransaction: { status: "SUCCESS", envelopeXdr: await envelope() },
        simulateTransaction: positionOf(1),
      });
      expect(await client(fake.server).verifyCommit(wrong)).toBeNull();
    }
    for (const options of [{ contract: OTHER_CONTRACT }, { fn: "release_if_stale" }]) {
      const fake = fakeServer({
        getTransaction: { status: "SUCCESS", envelopeXdr: await envelope(options) },
        simulateTransaction: positionOf(1),
      });
      expect(await client(fake.server).verifyCommit(input)).toBeNull();
    }
  });

  it("returns null when the position is no longer active", async () => {
    const fake = fakeServer({
      getTransaction: { status: "SUCCESS", envelopeXdr: await envelope() },
      simulateTransaction: positionOf(2),
    });
    expect(await client(fake.server).verifyCommit(input)).toBeNull();
  });
});

describe("the relay rule, case by case", () => {
  const owner = user.publicKey();
  const callArgs = () => [
    new Address(owner).toScVal(),
    nativeToScVal(3n, { type: "u64" }),
    nativeToScVal(200_000_000n, { type: "i128" }),
    nativeToScVal(10_000n, { type: "u64" }),
  ];
  const wrap = (operation: xdr.Operation, signer = user) => {
    const transaction = new TransactionBuilder(new Account(signer.publicKey(), "5"), {
      fee: BASE_FEE,
      networkPassphrase: PASSPHRASE,
    })
      .addOperation(operation)
      .setTimeout(300)
      .build();
    transaction.sign(signer);
    return transaction;
  };

  async function refused(signedXdr: string) {
    const fake = fakeServer();
    const error = await failure(client(fake.server).submit(signedXdr, owner));
    expect(hasErrorCode(error, "TransactionNotAllowed")).toBe(true);
    expect(fake.sent).toHaveLength(0);
  }

  it("refuses a fee-bump transaction wrapping the wallet's own commit", async () => {
    const inner = wrap(new Contract(CONTRACT).call("commit", ...callArgs()));
    const bump = TransactionBuilder.buildFeeBumpTransaction(stranger, "200", inner, PASSPHRASE);
    bump.sign(stranger);

    await refused(bump.toXDR());
  });

  it("refuses an operation that is not a contract call", async () => {
    await refused(
      wrap(
        Operation.payment({
          destination: stranger.publicKey(),
          asset: Asset.native(),
          amount: "1",
        }),
      ).toXDR(),
    );
  });

  it("refuses an operation that borrows another account as its source", async () => {
    const operation = Operation.invokeContractFunction({
      contract: CONTRACT,
      function: "commit",
      args: callArgs(),
      source: stranger.publicKey(),
    });

    await refused(wrap(operation).toXDR());
  });

  it("refuses a first argument that is not an address at all", async () => {
    const contract = new Contract(CONTRACT);
    const operation = contract.call(
      "commit",
      nativeToScVal("not-an-address"),
      nativeToScVal(3n, { type: "u64" }),
    );

    await refused(wrap(operation).toXDR());
  });

  it("relays the wallet's own release_if_stale and says which function it is", async () => {
    const release = wrap(
      new Contract(CONTRACT).call(
        "release_if_stale",
        callArgs()[0] as xdr.ScVal,
        nativeToScVal(3n, { type: "u64" }),
      ),
    ).toXDR();
    const fake = fakeServer();

    expect(client(fake.server).relayedFunction(release, owner)).toBe("release_if_stale");
    expect((await client(fake.server).submit(release, owner)).status).toBe("SUCCESS");
    expect(fake.sent).toHaveLength(1);
  });
});

describe("telling an unfunded account from a network failure", () => {
  it("does not tell the user to fund a wallet when the RPC itself is down", async () => {
    const fake = fakeServer({ getAccount: new TypeError("fetch failed") });

    const error = await failure(
      client(fake.server).prepareCommit({
        user: user.publicKey(),
        weekId: 3n,
        amount: 1n,
        goalM: 1n,
      }),
    );

    expect(hasErrorCode(error, "NetworkError")).toBe(true);
  });
});
