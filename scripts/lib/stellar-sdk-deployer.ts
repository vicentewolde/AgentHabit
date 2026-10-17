import { randomBytes } from "node:crypto";

import { type OnChainConfig, StellarContractClient } from "@agenthabit/chain-stellar";
import { AgentHabitError, type DeployedParams } from "@agenthabit/core";
import {
  Address,
  BASE_FEE,
  Keypair,
  nativeToScVal,
  Operation,
  type rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";

import type { StellarDeployer } from "./deploy-stellar.js";
import { STELLAR_TESTNET } from "./network.js";

/**
 * The real `StellarDeployer`: signs with the deployer key and sends to the RPC. It prints nothing
 * and returns only public data (hashes and addresses); every failure is a typed error that never
 * carries the key or a raw response.
 */
export interface SdkDeployerOptions {
  readonly server: rpc.Server;
  readonly networkPassphrase: string;
  /** STELLAR_DEPLOYER_SECRET. Held only to sign. */
  readonly deployerSecret: string;
}

/** The constructor's arguments, in the order of `__constructor` (spec 4.2). */
export function constructorArgs(input: {
  readonly token: string;
  readonly oracle: string;
  readonly params: DeployedParams;
}): xdr.ScVal[] {
  const { params } = input;
  return [
    new Address(input.token).toScVal(),
    new Address(input.oracle).toScVal(),
    nativeToScVal(BigInt(params.minAmount), { type: "i128" }),
    nativeToScVal(BigInt(params.maxAmount), { type: "i128" }),
    nativeToScVal(BigInt(params.minGoalM), { type: "u64" }),
    nativeToScVal(BigInt(params.maxGoalM), { type: "u64" }),
    nativeToScVal(BigInt(params.weekAnchor), { type: "u64" }),
    nativeToScVal(BigInt(params.weekLen), { type: "u64" }),
    nativeToScVal(BigInt(params.grace), { type: "u64" }),
    nativeToScVal(BigInt(params.staleAfter), { type: "u64" }),
  ];
}

function networkError(action: string, cause?: unknown): AgentHabitError {
  return new AgentHabitError("NetworkError", `Stellar testnet: could not ${action}`, {
    ...(cause === undefined ? {} : { cause }),
    details: { action },
  });
}

/** Fails unless the RPC really serves testnet: nothing here ever touches another network. */
export async function assertTestnet(server: rpc.Server): Promise<void> {
  let passphrase: string;
  try {
    passphrase = (await server.getNetwork()).passphrase;
  } catch (cause) {
    throw networkError("read the network", cause);
  }
  if (passphrase !== STELLAR_TESTNET.networkPassphrase) {
    throw new AgentHabitError("ConfigError", "STELLAR_RPC_URL does not serve Stellar testnet", {
      details: { variable: "STELLAR_RPC_URL" },
    });
  }
}

export function createSdkDeployer(options: SdkDeployerOptions): StellarDeployer {
  const { server, networkPassphrase } = options;
  const keypair = Keypair.fromSecret(options.deployerSecret);

  async function send(action: string, operation: xdr.Operation) {
    try {
      const account = await server.getAccount(keypair.publicKey());
      const transaction = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase })
        .addOperation(operation)
        .setTimeout(300)
        .build();
      const prepared = await server.prepareTransaction(transaction);
      prepared.sign(keypair);
      const sent = await server.sendTransaction(prepared);
      if (sent.status === "ERROR" || sent.status === "TRY_AGAIN_LATER") {
        throw networkError(`${action}: the network refused the transaction`);
      }
      const final = await server.pollTransaction(sent.hash, { attempts: 60 });
      if (final.status !== "SUCCESS") {
        throw networkError(`${action}: the transaction did not succeed`);
      }
      return { txHash: sent.hash, returnValue: final.returnValue };
    } catch (error) {
      if (error instanceof AgentHabitError) throw error;
      throw networkError(action, error);
    }
  }

  return {
    async upload(wasm) {
      const { txHash } = await send("upload the wasm", Operation.uploadContractWasm({ wasm }));
      return { txHash };
    },

    async create(input) {
      const { txHash, returnValue } = await send(
        "create the contract",
        Operation.createCustomContract({
          address: new Address(keypair.publicKey()),
          wasmHash: Buffer.from(input.wasmHash, "hex"),
          constructorArgs: constructorArgs(input),
          salt: randomBytes(32),
        }),
      );
      if (returnValue === undefined) throw networkError("read the new contract's address");
      return { contract: Address.fromScVal(returnValue).toString(), txHash };
    },

    async readConfig(contract): Promise<OnChainConfig | null> {
      try {
        await server.getContractData(
          contract,
          xdr.ScVal.scvLedgerKeyContractInstance(),
          "persistent" as rpc.Durability.Persistent,
        );
      } catch (error) {
        // The SDK throws `{ code: 404 }` for a ledger entry that does not exist. Any other failure
        // is a network problem, never a sign that the contract is gone.
        if (typeof error === "object" && error !== null && "code" in error && error.code === 404) {
          return null;
        }
        throw networkError("look the contract up", error);
      }
      return new StellarContractClient({
        contractId: contract,
        networkPassphrase,
        server,
      }).config();
    },
  };
}
