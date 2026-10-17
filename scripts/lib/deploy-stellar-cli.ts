import { parseEnv } from "@agenthabit/config";
import {
  AgentHabitError,
  type DeploymentsFile,
  isAgentHabitError,
  parseDeployments,
} from "@agenthabit/core";
import { Asset } from "@stellar/stellar-sdk";

import { deployStellarProduction, type StellarDeployer, wasmHash } from "./deploy-stellar.js";
import { stellarAddress } from "./keys.js";
import { STELLAR_TESTNET } from "./network.js";

/**
 * `pnpm run deploy:stellar`: deploys the production instance to Stellar testnet.
 *
 * Without `--yes` it only prints what it would do and sends nothing. `--reset` allows replacing
 * a recorded contract that a testnet reset erased. Keys come from `.env.local`, never from argv,
 * and every line printed passes a guard that stops the run rather than print a secret.
 */
export interface DeployCliDeps {
  readonly args: readonly string[];
  /** The environment, with `.env.local` already loaded by the entry point. */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly readWasm: () => Promise<Uint8Array | undefined>;
  readonly readDeployments: () => Promise<unknown | undefined>;
  readonly writeDeployments: (file: DeploymentsFile) => Promise<void>;
  /** Checks the RPC really serves testnet, then returns the deployer that signs with the key. */
  readonly connect: (rpcUrl: string, deployerSecret: string) => Promise<StellarDeployer>;
  readonly now: () => Date;
  readonly print: (line: string) => void;
  readonly printError: (line: string) => void;
}

/** The testnet USDC Stellar Asset Contract: derived from the asset, never typed in. */
export function stellarUsdcContractId(): string {
  const { code, issuer } = STELLAR_TESTNET.usdc;
  return new Asset(code, issuer).contractId(STELLAR_TESTNET.networkPassphrase);
}

const EXPLORER = "https://stellar.expert/explorer/testnet";

export async function runDeployStellarCli(deps: DeployCliDeps): Promise<number> {
  const secrets: string[] = [];
  const guarded = (write: (line: string) => void) => (line: string) => {
    if (secrets.some((secret) => secret !== "" && line.includes(secret))) {
      throw new AgentHabitError("SecretLeak", "An output line was about to carry a secret");
    }
    write(line);
  };
  const print = guarded(deps.print);
  const printError = guarded(deps.printError);

  try {
    const flags = new Set(deps.args);
    const unknown = [...flags].filter((flag) => flag !== "--yes" && flag !== "--reset");
    if (unknown.length > 0) {
      throw new AgentHabitError("InvalidRequest", `Unknown option: ${unknown.join(", ")}`);
    }

    const env = parseEnv(deps.env);
    const { STELLAR_DEPLOYER_SECRET: deployerSecret, STELLAR_ORACLE_SECRET: oracleSecret } = env;
    if (deployerSecret === undefined || oracleSecret === undefined) {
      throw new AgentHabitError(
        "ConfigError",
        "STELLAR_DEPLOYER_SECRET and STELLAR_ORACLE_SECRET are missing: run `pnpm run bootstrap`",
        { details: { variables: ["STELLAR_DEPLOYER_SECRET", "STELLAR_ORACLE_SECRET"] } },
      );
    }
    secrets.push(deployerSecret, oracleSecret);

    const wasm = await deps.readWasm();
    if (wasm === undefined) {
      throw new AgentHabitError(
        "ConfigError",
        "The wasm is not built: run `pnpm run contracts:build:stellar`",
      );
    }
    const raw = await deps.readDeployments();
    const file = raw === undefined ? null : parseDeployments(raw);
    if (file !== null && file.network !== "stellar-testnet") {
      throw new AgentHabitError(
        "ConfigError",
        "deployments/stellar-testnet.json is for another network",
      );
    }

    const deployer = await deps.connect(env.STELLAR_RPC_URL, deployerSecret);
    const result = await deployStellarProduction({
      file,
      networkPassphrase: STELLAR_TESTNET.networkPassphrase,
      wasm,
      token: stellarUsdcContractId(),
      oracle: stellarAddress(oracleSecret),
      now: deps.now(),
      allowReset: flags.has("--reset"),
      confirm: flags.has("--yes"),
      deployer,
    });

    print(`wasm sha256: ${wasmHash(wasm)}`);
    if (result.outcome === "planned") {
      print("Plan (nothing was sent): deploy the production instance with");
      for (const [name, value] of Object.entries(result.params)) print(`  ${name} = ${value}`);
      print("Run again with --yes to send it.");
      return 0;
    }
    if (result.outcome === "unchanged") {
      print(`Already deployed, nothing to do: ${result.instance.contract}`);
      return 0;
    }
    await deps.writeDeployments(result.file);
    print(`Deployed the production instance: ${result.instance.contract}`);
    print(`  contract: ${EXPLORER}/contract/${result.instance.contract}`);
    print(`  transaction: ${EXPLORER}/tx/${result.instance.txHash}`);
    print("Recorded in deployments/stellar-testnet.json");
    return 0;
  } catch (error) {
    const code = isAgentHabitError(error) ? error.code : "Unexpected";
    const message = isAgentHabitError(error) ? error.message : "an unexpected error";
    try {
      printError(`${code}: ${message}`);
    } catch {
      printError("SecretLeak: an error line was about to carry a secret");
    }
    return 1;
  }
}
