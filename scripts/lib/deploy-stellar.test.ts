import type { OnChainConfig } from "@agenthabit/chain-stellar";
import { type DeploymentsFile, hasErrorCode, isAgentHabitError } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { deployStellarProduction, type StellarDeployer, wasmHash } from "./deploy-stellar.js";

// A simulated network and synthetic addresses only.
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 7, 7, 7]);
const TOKEN = "CSYNTHETICUSDCTOKEN";
const ORACLE = "GSYNTHETICORACLE";
const PASSPHRASE = "Test SDF Network ; September 2015";
const NOW = new Date("2026-10-21T15:00:00.000Z");
// Monday 19 Oct 2026, 00:00 in UTC-3: the default anchor for NOW.
const ANCHOR = BigInt(Date.parse("2026-10-19T03:00:00Z") / 1000);

class FakeNetwork implements StellarDeployer {
  readonly calls: string[] = [];
  readonly contracts = new Map<string, OnChainConfig>();
  /** Make the next created contract hold something else, as a broken constructor would. */
  corruptNext = false;
  private counter = 0;

  async upload(): Promise<{ txHash: string }> {
    this.calls.push("upload");
    return { txHash: "aa".repeat(32) };
  }

  async create(input: Parameters<StellarDeployer["create"]>[0]) {
    this.calls.push("create");
    const contract = `CNEW${++this.counter}`;
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

  async readConfig(contract: string): Promise<OnChainConfig | null> {
    return this.contracts.get(contract) ?? null;
  }
}

const base = (network: FakeNetwork) => ({
  networkPassphrase: PASSPHRASE,
  wasm: WASM,
  token: TOKEN,
  oracle: ORACLE,
  now: NOW,
  allowReset: false,
  confirm: true,
  deployer: network,
});

async function failure(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return "no error";
}

async function firstDeploy(network = new FakeNetwork()) {
  const result = await deployStellarProduction({ ...base(network), file: null });
  if (result.outcome !== "deployed") throw new TypeError("expected a deployment");
  return { network, file: result.file, instance: result.instance };
}

describe("the first deployment", () => {
  it("records the production instance with the Chile-Monday anchor and the Stellar limits", async () => {
    const { instance, network } = await firstDeploy();

    expect(network.calls).toEqual(["upload", "create"]);
    expect(instance).toMatchObject({
      kind: "production",
      status: "live",
      codeHash: wasmHash(WASM),
      token: TOKEN,
      oracle: ORACLE,
      deployedAt: NOW.toISOString(),
      params: {
        // 20 and 50 USDC at 7 decimals, the 10 and 300 km goals, a week of 7 days.
        minAmount: "200000000",
        maxAmount: "500000000",
        minGoalM: "10000",
        maxGoalM: "300000",
        weekAnchor: ANCHOR.toString(),
        weekLen: "604800",
        grace: "172800",
        staleAfter: "604800",
      },
    });
  });

  it("sends nothing until it is confirmed, and only prints the plan", async () => {
    const network = new FakeNetwork();

    const result = await deployStellarProduction({ ...base(network), confirm: false, file: null });

    expect(result.outcome).toBe("planned");
    expect(network.calls).toEqual([]);
  });

  it("refuses an anchor that is not a Monday midnight in Chile, or is still in the future", async () => {
    for (const anchor of [ANCHOR + 3_600n, ANCHOR + 604_800n * 2n]) {
      const network = new FakeNetwork();
      const error = await failure(
        deployStellarProduction({ ...base(network), file: null, anchor }),
      );
      expect(hasErrorCode(error, "InvalidConfig")).toBe(true);
      expect(network.calls).toEqual([]);
    }
  });

  it("does not record a contract that does not hold what was deployed", async () => {
    const network = new FakeNetwork();
    network.corruptNext = true;

    const error = await failure(deployStellarProduction({ ...base(network), file: null }));

    expect(hasErrorCode(error, "DeploymentDrift")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toMatchObject({ contract: "CNEW1" });
  });
});

describe("running it again", () => {
  it("deploys nothing when the recorded contract is on the network and matches", async () => {
    const { network, file } = await firstDeploy();
    network.calls.length = 0;

    const again = await deployStellarProduction({
      ...base(network),
      file,
      now: new Date(NOW.getTime() + 86_400_000 * 9),
    });

    expect(again.outcome).toBe("unchanged");
    expect(network.calls).toEqual([]);
  });

  it("keeps the recorded anchor even when a new default would differ", async () => {
    const { network, file, instance } = await firstDeploy();
    const nextWeek = new Date(NOW.getTime() + 7 * 86_400_000);

    const again = await deployStellarProduction({ ...base(network), file, now: nextWeek });

    expect(again.outcome).toBe("unchanged");
    expect(instance.params.weekAnchor).toBe(ANCHOR.toString());
  });
});

describe("drift", () => {
  it("stops when the contract on the network disagrees with the file", async () => {
    const { network, file, instance } = await firstDeploy();
    const onChain = network.contracts.get(instance.contract);
    if (onChain === undefined) throw new TypeError("the fake lost its contract");
    network.contracts.set(instance.contract, { ...onChain, grace: 1n });
    network.calls.length = 0;

    const error = await failure(deployStellarProduction({ ...base(network), file }));

    expect(hasErrorCode(error, "DeploymentDrift")).toBe(true);
    expect(network.calls).toEqual([]);
  });

  it("stops when the local wasm is not the deployed one", async () => {
    const { network, file } = await firstDeploy();
    network.calls.length = 0;

    const error = await failure(
      deployStellarProduction({ ...base(network), file, wasm: new Uint8Array([1, 2, 3]) }),
    );

    expect(hasErrorCode(error, "DeploymentDrift")).toBe(true);
    expect(network.calls).toEqual([]);
  });
});

describe("a testnet reset", () => {
  async function afterReset(): Promise<{ network: FakeNetwork; file: DeploymentsFile }> {
    const { network, file } = await firstDeploy();
    // Same file, but a network that has forgotten every contract.
    network.contracts.clear();
    network.calls.length = 0;
    return { network, file };
  }

  it("refuses to redeploy without --reset, because the user must say so", async () => {
    const { network, file } = await afterReset();

    const error = await failure(deployStellarProduction({ ...base(network), file }));

    expect(hasErrorCode(error, "DeploymentDrift")).toBe(true);
    expect(network.calls).toEqual([]);
  });

  it("archives the erased instance and deploys a new one with the same anchor", async () => {
    const { network, file } = await afterReset();

    const result = await deployStellarProduction({ ...base(network), file, allowReset: true });

    if (result.outcome !== "deployed") throw new TypeError("expected a deployment");
    expect(result.file.instances.map((instance) => instance.status)).toEqual(["reset", "live"]);
    expect(result.instance.params.weekAnchor).toBe(ANCHOR.toString());
    expect(result.instance.contract).not.toBe(file.instances[0]?.contract);
  });
});
