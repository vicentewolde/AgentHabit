import type { OnChainConfig } from "@agenthabit/chain-stellar";
import type { DeploymentsFile } from "@agenthabit/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import type { StellarDeployer } from "./deploy-stellar.js";
import {
  type DeployCliDeps,
  runDeployStellarCli,
  stellarUsdcContractId,
} from "./deploy-stellar-cli.js";

// Synthetic keys and a simulated network: nothing here touches a real one.
const deployerKey = Keypair.random();
const oracleKey = Keypair.random();
const ENV = {
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  AVALANCHE_FUJI_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
  STELLAR_DEPLOYER_SECRET: deployerKey.secret(),
  STELLAR_ORACLE_SECRET: oracleKey.secret(),
};
const NOW = new Date("2026-10-21T15:00:00.000Z");
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);

class FakeDeployer implements StellarDeployer {
  readonly calls: string[] = [];
  readonly contracts = new Map<string, OnChainConfig>();
  /** Make the contract it creates hold something else, as a broken constructor would. */
  corruptNext = false;

  async upload() {
    this.calls.push("upload");
    return { txHash: "aa".repeat(32) };
  }

  async create(input: Parameters<StellarDeployer["create"]>[0]) {
    this.calls.push("create");
    const contract = "CNEWCONTRACT";
    this.contracts.set(contract, {
      token: input.token,
      oracle: input.oracle,
      minAmount: BigInt(input.params.minAmount),
      maxAmount: BigInt(input.params.maxAmount) + (this.corruptNext ? 1n : 0n),
      minGoalM: BigInt(input.params.minGoalM),
      maxGoalM: BigInt(input.params.maxGoalM),
      weekAnchor: BigInt(input.params.weekAnchor),
      weekLen: BigInt(input.params.weekLen),
      grace: BigInt(input.params.grace),
      staleAfter: BigInt(input.params.staleAfter),
    });
    return { contract, txHash: "bb".repeat(32) };
  }

  async readConfig(contract: string) {
    return this.contracts.get(contract) ?? null;
  }
}

interface Harness {
  readonly deps: DeployCliDeps;
  readonly deployer: FakeDeployer;
  readonly out: string[];
  readonly err: string[];
  readonly written: DeploymentsFile[];
}

function harness(overrides: Partial<DeployCliDeps> = {}, stored?: DeploymentsFile): Harness {
  const deployer = new FakeDeployer();
  const out: string[] = [];
  const err: string[] = [];
  const written: DeploymentsFile[] = [];
  let current: unknown = stored;
  return {
    deployer,
    out,
    err,
    written,
    deps: {
      args: [],
      env: ENV,
      readWasm: async () => WASM,
      readDeployments: async () => current,
      writeDeployments: async (file) => {
        written.push(file);
        current = file;
      },
      connect: async () => deployer,
      now: () => NOW,
      print: (line) => out.push(line),
      printError: (line) => err.push(line),
      ...overrides,
    },
  };
}

describe("the testnet USDC token", () => {
  it("is the Stellar Asset Contract the spec derived from Circle's issuer on 16 Oct", () => {
    expect(stellarUsdcContractId()).toBe(
      "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
    );
  });
});

describe("pnpm run deploy:stellar", () => {
  it("only prints the plan without --yes, and sends and writes nothing", async () => {
    const { deps, deployer, out, written } = harness();

    expect(await runDeployStellarCli(deps)).toBe(0);

    expect(deployer.calls).toEqual([]);
    expect(written).toEqual([]);
    expect(out.join("\n")).toContain("Run again with --yes");
    expect(out.join("\n")).toContain("minAmount = 200000000");
  });

  it("shows the anchor and which week a commit made now would target", async () => {
    const { deps, out } = harness();

    await runDeployStellarCli(deps);

    const text = out.join("\n");
    // NOW is Wednesday 21 Oct 2026: the default anchor is Monday 19 Oct, 00:00 in UTC-3.
    expect(text).toContain("anchor (week 0 starts): 2026-10-19T03:00:00.000Z");
    expect(text).toContain("now is week 0, which started 2026-10-19T03:00:00.000Z");
    expect(text).toContain(
      "a commit made now targets week 1, which starts 2026-10-26T03:00:00.000Z",
    );
  });

  it("keeps the address of a contract it created but could not confirm, so it is not lost", async () => {
    const { deps, deployer, err } = harness({ args: ["--yes"] });
    deployer.corruptNext = true;

    expect(await runDeployStellarCli(deps)).toBe(1);

    expect(err.join("\n")).toContain("DeploymentDrift");
    expect(err.join("\n")).toContain("contract: CNEWCONTRACT");
  });

  it("deploys and records with --yes, then does nothing on a second run", async () => {
    const first = harness({ args: ["--yes"] });
    expect(await runDeployStellarCli(first.deps)).toBe(0);
    expect(first.deployer.calls).toEqual(["upload", "create"]);
    expect(first.written).toHaveLength(1);
    expect(first.out.join("\n")).toContain("stellar.expert/explorer/testnet/contract/CNEWCONTRACT");

    const second = harness({ args: ["--yes"] }, first.written[0]);
    second.deployer.contracts.set(
      "CNEWCONTRACT",
      first.deployer.contracts.get("CNEWCONTRACT") as OnChainConfig,
    );
    expect(await runDeployStellarCli(second.deps)).toBe(0);
    expect(second.deployer.calls).toEqual([]);
    expect(second.out.join("\n")).toContain("Already deployed");
  });

  it("never prints a key, in the plan, after a deployment or in an error", async () => {
    const secrets = [ENV.STELLAR_DEPLOYER_SECRET, ENV.STELLAR_ORACLE_SECRET];
    const runs = [
      harness(),
      harness({ args: ["--yes"] }),
      harness({ readWasm: async () => undefined }),
      harness({
        connect: async () => {
          throw new Error(`could not connect with ${ENV.STELLAR_DEPLOYER_SECRET}`);
        },
      }),
    ];
    for (const run of runs) {
      await runDeployStellarCli(run.deps);
      const output = [...run.out, ...run.err].join("\n");
      for (const secret of secrets) expect(output).not.toContain(secret);
    }
  });

  it("stops before anything is sent when the keys or the wasm are missing", async () => {
    const noKeys = harness({ args: ["--yes"], env: { ...ENV, STELLAR_DEPLOYER_SECRET: "" } });
    expect(await runDeployStellarCli(noKeys.deps)).toBe(1);
    expect(noKeys.err.join("\n")).toContain("bootstrap");

    const noWasm = harness({ args: ["--yes"], readWasm: async () => undefined });
    expect(await runDeployStellarCli(noWasm.deps)).toBe(1);
    expect(noWasm.err.join("\n")).toContain("contracts:build:stellar");
    expect(noWasm.deployer.calls).toEqual([]);
  });

  it("refuses an option it does not know", async () => {
    const { deps, deployer, err } = harness({ args: ["--force"] });

    expect(await runDeployStellarCli(deps)).toBe(1);
    expect(deployer.calls).toEqual([]);
    expect(err.join("\n")).toContain("--force");
  });

  it("names the failure by its code and nothing more", async () => {
    const { deps, err } = harness({
      args: ["--yes"],
      connect: async () => {
        throw new Error("raw RPC failure with details");
      },
    });

    expect(await runDeployStellarCli(deps)).toBe(1);
    expect(err).toEqual(["Unexpected: an unexpected error"]);
  });
});
