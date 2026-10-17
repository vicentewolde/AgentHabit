import type { SorobanServer } from "@agenthabit/chain-stellar";
import type { DeployedInstance, DeploymentsFile } from "@agenthabit/core";
import { hasErrorCode, isAgentHabitError } from "@agenthabit/core";
import { Address, Keypair, nativeToScVal, StrKey } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { createStellarBackend } from "../src/stellar-backend.js";

// A simulated RPC that answers `config()`; synthetic addresses only.
const PASSPHRASE = "Test SDF Network ; September 2015";
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 7));
const TOKEN = StrKey.encodeContract(Buffer.alloc(32, 1));
const ORACLE = Keypair.random().publicKey();

const params = {
  minAmount: "200000000",
  maxAmount: "500000000",
  minGoalM: "10000",
  maxGoalM: "300000",
  weekAnchor: "1791774000",
  weekLen: "604800",
  grace: "172800",
  staleAfter: "604800",
};
const instance: DeployedInstance = {
  kind: "production",
  status: "live",
  contract: CONTRACT,
  codeHash: "ab".repeat(32),
  token: TOKEN,
  oracle: ORACLE,
  params,
  txHash: "cd".repeat(32),
  deployedAt: "2026-10-19T12:00:00.000Z",
};
const file: DeploymentsFile = {
  schemaVersion: 1,
  network: "stellar-testnet",
  networkPassphrase: PASSPHRASE,
  instances: [instance],
};

/** What the contract says about itself, with `overrides` standing for a different deployment. */
function serverSaying(overrides: Partial<Record<keyof typeof params, string>> = {}) {
  const held = { ...params, ...overrides };
  const retval = nativeToScVal(
    {
      token: new Address(TOKEN),
      oracle: new Address(ORACLE),
      min_amount: BigInt(held.minAmount),
      max_amount: BigInt(held.maxAmount),
      min_goal_m: BigInt(held.minGoalM),
      max_goal_m: BigInt(held.maxGoalM),
      week_anchor: BigInt(held.weekAnchor),
      week_len: BigInt(held.weekLen),
      grace: BigInt(held.grace),
      stale_after: BigInt(held.staleAfter),
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
  );
  return {
    simulateTransaction: async () => ({ result: { retval, auth: [] } }),
  } as unknown as SorobanServer;
}

describe("the Stellar backend", () => {
  it("describes the instance from the deployments file, in the units the web needs", () => {
    const backend = createStellarBackend({ file, instance, server: serverSaying() });

    expect(backend.instance).toMatchObject({
      chain: "stellar",
      kind: "production",
      contract: CONTRACT,
      tokenDecimals: 7,
      networkPassphrase: PASSPHRASE,
      minAmount: "200000000",
      maxGoalM: 300_000,
      weekLenS: 604_800,
    });
    expect(backend.weekParams).toEqual({
      weekAnchor: 1_791_774_000n,
      weekLen: 604_800n,
      grace: 172_800n,
      staleAfter: 604_800n,
    });
  });

  it("verifies when the file and the contract agree", async () => {
    const backend = createStellarBackend({ file, instance, server: serverSaying() });

    await expect(backend.verify()).resolves.toBeUndefined();
  });

  it("refuses to start when the file disagrees with the contract, naming the fields", async () => {
    const backend = createStellarBackend({
      file,
      instance,
      server: serverSaying({ grace: "3600", maxAmount: "400000000" }),
    });

    let error: unknown;
    try {
      await backend.verify();
    } catch (caught) {
      error = caught;
    }

    expect(hasErrorCode(error, "DeploymentDrift")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toMatchObject({
      contract: CONTRACT,
      fields: ["maxAmount", "grace"],
    });
  });

  it("needs the network passphrase in the file", () => {
    const withoutPassphrase = { ...file, networkPassphrase: undefined };
    let error: unknown;
    try {
      createStellarBackend({ file: withoutPassphrase, instance, server: serverSaying() });
    } catch (caught) {
      error = caught;
    }
    expect(hasErrorCode(error, "ConfigError")).toBe(true);
  });
});
