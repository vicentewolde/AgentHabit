import { type SorobanServer, StellarContractClient } from "@agenthabit/chain-stellar";
import {
  AgentHabitError,
  type DeployedInstance,
  type DeploymentsFile,
  type InstanceInfo,
} from "@agenthabit/core";

import type { ChainBackend } from "./app.js";

/** Stellar USDC has 7 decimals; the explorer is stellar.expert's testnet view. */
const STELLAR_USDC_DECIMALS = 7;
const EXPLORER_TX_URL = "https://stellar.expert/explorer/testnet/tx/{hash}";

/**
 * The Stellar side of the API: one deployed instance, read through the RPC. It describes itself
 * from `deployments/stellar-testnet.json` (the only bridge to the contract, P-2), and every call
 * goes to that contract and no other.
 */
export function createStellarBackend(input: {
  readonly file: DeploymentsFile;
  readonly instance: DeployedInstance;
  readonly server: SorobanServer;
}): ChainBackend {
  const { file, instance, server } = input;
  if (file.networkPassphrase === undefined) {
    throw new AgentHabitError(
      "ConfigError",
      "deployments/stellar-testnet.json has no network passphrase",
    );
  }
  const networkPassphrase = file.networkPassphrase;
  const client = new StellarContractClient({
    contractId: instance.contract,
    networkPassphrase,
    server,
  });
  const { params } = instance;

  const info: InstanceInfo = {
    chain: "stellar",
    kind: instance.kind,
    contract: instance.contract,
    token: instance.token,
    tokenDecimals: STELLAR_USDC_DECIMALS,
    networkPassphrase,
    explorerTxUrl: EXPLORER_TX_URL,
    minAmount: params.minAmount,
    maxAmount: params.maxAmount,
    minGoalM: Number(params.minGoalM),
    maxGoalM: Number(params.maxGoalM),
    weekLenS: Number(params.weekLen),
    graceS: Number(params.grace),
    staleAfterS: Number(params.staleAfter),
  };

  return {
    instance: info,
    weekParams: {
      weekAnchor: BigInt(params.weekAnchor),
      weekLen: BigInt(params.weekLen),
      grace: BigInt(params.grace),
      staleAfter: BigInt(params.staleAfter),
    },
    currentWeek: () => client.currentWeek(),
    getPosition: (user, weekId) => client.getPosition(user, weekId),
    prepareCommit: (call) => client.prepareCommit(call),
    prepareRelease: (call) => client.prepareRelease(call),
    submit: (signedXdr, owner) => client.submit(signedXdr, owner),
    relayedFunction: (signedXdr, owner) => client.relayedFunction(signedXdr, owner),
    verify: async () => {
      // The deployments file is what the web shows (dates, limits); the contract is what decides.
      // They must agree, or the page would promise a time the contract refuses.
      const onChain = await client.config();
      const mismatches = (
        [
          ["token", onChain.token === instance.token],
          ["oracle", onChain.oracle === instance.oracle],
          ["minAmount", onChain.minAmount.toString() === params.minAmount],
          ["maxAmount", onChain.maxAmount.toString() === params.maxAmount],
          ["minGoalM", onChain.minGoalM.toString() === params.minGoalM],
          ["maxGoalM", onChain.maxGoalM.toString() === params.maxGoalM],
          ["weekAnchor", onChain.weekAnchor.toString() === params.weekAnchor],
          ["weekLen", onChain.weekLen.toString() === params.weekLen],
          ["grace", onChain.grace.toString() === params.grace],
          ["staleAfter", onChain.staleAfter.toString() === params.staleAfter],
        ] as const
      )
        .filter(([, same]) => !same)
        .map(([name]) => name);
      if (mismatches.length > 0) {
        throw new AgentHabitError(
          "DeploymentDrift",
          "deployments/stellar-testnet.json disagrees with the contract on the network",
          { details: { contract: instance.contract, fields: mismatches } },
        );
      }
    },
    transactionStatus: (txHash) => client.transactionStatus(txHash),
    verifyCommit: (call) => client.verifyCommit(call),
  };
}
