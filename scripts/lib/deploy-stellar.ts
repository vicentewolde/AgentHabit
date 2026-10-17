import { createHash } from "node:crypto";

import type { OnChainConfig } from "@agenthabit/chain-stellar";
import {
  AgentHabitError,
  type DeployedInstance,
  type DeployedParams,
  type DeploymentsFile,
  INSTANCES,
  instanceParams,
  isMondayMidnightChile,
  liveInstance,
  mondayMidnightChileAtOrBefore,
} from "@agenthabit/core";

/**
 * Deploys the production instance of the AgentHabit contract to Stellar testnet (spec 4.7, T6a).
 * The logic lives here, behind a `StellarDeployer`, so tests run the whole flow (first deploy,
 * a repeat, drift, a testnet reset) without a network. Nothing in this file touches a key.
 */
export interface StellarDeployer {
  /** Uploads the wasm; returns nothing the caller needs beyond the transaction hash. */
  upload(wasm: Uint8Array): Promise<{ txHash: string }>;
  /** Creates the contract from an uploaded wasm, running its constructor. */
  create(input: {
    readonly wasmHash: string;
    readonly token: string;
    readonly oracle: string;
    readonly params: DeployedParams;
  }): Promise<{ contract: string; txHash: string }>;
  /** The contract's `config()`, or null when no such contract exists on the network. */
  readConfig(contract: string): Promise<OnChainConfig | null>;
}

export interface DeployInput {
  /** `deployments/stellar-testnet.json` as it is now, or null when there is none yet. */
  readonly file: DeploymentsFile | null;
  readonly networkPassphrase: string;
  readonly wasm: Uint8Array;
  /** The testnet USDC Stellar Asset Contract id. */
  readonly token: string;
  readonly oracle: string;
  readonly now: Date;
  /** Overrides the default anchor. Ignored once an instance is recorded: its anchor is kept. */
  readonly anchor?: bigint;
  /** Allows replacing a recorded instance whose contract no longer exists (a testnet reset). */
  readonly allowReset: boolean;
  /** False prints the plan and sends nothing. */
  readonly confirm: boolean;
  readonly deployer: StellarDeployer;
}

export type DeployOutcome =
  | {
      readonly outcome: "unchanged";
      readonly file: DeploymentsFile;
      readonly instance: DeployedInstance;
    }
  | {
      readonly outcome: "planned";
      readonly file: DeploymentsFile | null;
      readonly params: DeployedParams;
    }
  | {
      readonly outcome: "deployed";
      readonly file: DeploymentsFile;
      readonly instance: DeployedInstance;
    };

export function wasmHash(wasm: Uint8Array): string {
  return createHash("sha256").update(wasm).digest("hex");
}

function asStrings(params: ReturnType<typeof instanceParams>): DeployedParams {
  return {
    minAmount: params.minAmount.toString(),
    maxAmount: params.maxAmount.toString(),
    minGoalM: params.minGoalM.toString(),
    maxGoalM: params.maxGoalM.toString(),
    weekAnchor: params.weekAnchor.toString(),
    weekLen: params.weekLen.toString(),
    grace: params.grace.toString(),
    staleAfter: params.staleAfter.toString(),
  };
}

/** What the contract holds, as the strings `deployments/*.json` stores. */
function configAsParams(config: OnChainConfig): DeployedParams {
  return {
    minAmount: config.minAmount.toString(),
    maxAmount: config.maxAmount.toString(),
    minGoalM: config.minGoalM.toString(),
    maxGoalM: config.maxGoalM.toString(),
    weekAnchor: config.weekAnchor.toString(),
    weekLen: config.weekLen.toString(),
    grace: config.grace.toString(),
    staleAfter: config.staleAfter.toString(),
  };
}

function sameConfig(
  config: OnChainConfig,
  expected: { readonly params: DeployedParams; readonly token: string; readonly oracle: string },
): boolean {
  const onChain = configAsParams(config);
  return (
    config.token === expected.token &&
    config.oracle === expected.oracle &&
    (Object.keys(onChain) as (keyof DeployedParams)[]).every(
      (key) => onChain[key] === expected.params[key],
    )
  );
}

function drift(message: string, details: Record<string, unknown> = {}): AgentHabitError {
  return new AgentHabitError("DeploymentDrift", message, { details });
}

export async function deployStellarProduction(input: DeployInput): Promise<DeployOutcome> {
  const localHash = wasmHash(input.wasm);
  const recorded = input.file === null ? null : liveInstance(input.file, "production");
  const nowSeconds = BigInt(Math.floor(input.now.getTime() / 1000));

  // A recorded instance keeps its anchor: week ids must not shift under a running challenge.
  const anchor =
    recorded !== null
      ? BigInt(recorded.params.weekAnchor)
      : (input.anchor ?? mondayMidnightChileAtOrBefore(nowSeconds));
  if (!isMondayMidnightChile(anchor) || anchor > nowSeconds) {
    throw new AgentHabitError(
      "InvalidConfig",
      "The anchor must be a Monday 00:00 in UTC-3 that has already passed",
      { details: { anchor: anchor.toString() } },
    );
  }
  const params = asStrings(instanceParams(INSTANCES.production, "stellar", anchor));
  const expected = { params, token: input.token, oracle: input.oracle };

  let file: DeploymentsFile = input.file ?? {
    schemaVersion: 1,
    network: "stellar-testnet",
    networkPassphrase: input.networkPassphrase,
    instances: [],
  };

  if (recorded !== null) {
    const onChain = await input.deployer.readConfig(recorded.contract);
    if (onChain === null) {
      if (!input.allowReset) {
        throw drift(
          "The recorded contract no longer exists on the network (a testnet reset?). " +
            "Check, then run again with --reset to deploy a new one",
          { contract: recorded.contract },
        );
      }
      file = {
        ...file,
        instances: file.instances.map((instance) =>
          instance === recorded ? { ...instance, status: "reset" as const } : instance,
        ),
      };
    } else {
      if (
        !sameConfig(onChain, {
          params: recorded.params,
          token: recorded.token,
          oracle: recorded.oracle,
        })
      ) {
        throw drift("The contract on the network disagrees with deployments/stellar-testnet.json", {
          contract: recorded.contract,
        });
      }
      if (recorded.codeHash !== localHash) {
        throw drift("The local wasm differs from the deployed one", {
          recorded: recorded.codeHash,
          local: localHash,
        });
      }
      if (!sameConfig(onChain, expected)) {
        throw drift("The recorded parameters differ from the production instance's definition");
      }
      return { outcome: "unchanged", file, instance: recorded };
    }
  }

  if (!input.confirm) return { outcome: "planned", file: input.file, params };

  await input.deployer.upload(input.wasm);
  const created = await input.deployer.create({
    wasmHash: localHash,
    token: input.token,
    oracle: input.oracle,
    params,
  });
  // Trust the network, not the call: read the new contract back before recording it.
  const onChain = await input.deployer.readConfig(created.contract);
  if (onChain === null || !sameConfig(onChain, expected)) {
    throw drift("The new contract does not hold what was deployed; it was not recorded", {
      contract: created.contract,
    });
  }
  const instance: DeployedInstance = {
    kind: "production",
    status: "live",
    contract: created.contract,
    codeHash: localHash,
    token: input.token,
    oracle: input.oracle,
    params,
    txHash: created.txHash,
    deployedAt: input.now.toISOString(),
  };
  return {
    outcome: "deployed",
    file: { ...file, instances: [...file.instances, instance] },
    instance,
  };
}
