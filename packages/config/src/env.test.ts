import { hasErrorCode, isAgentHabitError } from "@agenthabit/core";
import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const STELLAR_SECRET = Keypair.random().secret();
const EVM_KEY = `0x${"ab".repeat(32)}`;
/** secp256k1's order n, as viem prints it: valid keys are 1 to n - 1. */
const ORDER = 115792089237316195423570985008687907852837564279074904382605163141518161494337n;
const evmHex = (scalar: bigint) => `0x${scalar.toString(16).padStart(64, "0")}`;

const BASE = {
  STELLAR_RPC_URL: "https://soroban-testnet.stellar.org",
  AVALANCHE_FUJI_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
};

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return expect.fail("expected the call to throw");
}

describe("parseEnv", () => {
  it("defaults SETTLE_MODE to dry-run, also when the line is empty", () => {
    expect(parseEnv(BASE).SETTLE_MODE).toBe("dry-run");
    expect(parseEnv({ ...BASE, SETTLE_MODE: "" }).SETTLE_MODE).toBe("dry-run");
  });

  it("accepts live only when written out", () => {
    expect(parseEnv({ ...BASE, SETTLE_MODE: "live" }).SETTLE_MODE).toBe("live");
  });

  it("treats an empty key line as a key that is not set yet", () => {
    const env = parseEnv({ ...BASE, STELLAR_ORACLE_SECRET: "", AVALANCHE_ORACLE_PRIVATE_KEY: "" });

    expect(env.STELLAR_ORACLE_SECRET).toBeUndefined();
    expect(env.AVALANCHE_ORACLE_PRIVATE_KEY).toBeUndefined();
  });

  it("accepts well-formed keys for both chains", () => {
    const env = parseEnv({
      ...BASE,
      STELLAR_DEPLOYER_SECRET: STELLAR_SECRET,
      AVALANCHE_DEPLOYER_PRIVATE_KEY: EVM_KEY,
    });

    expect(env.STELLAR_DEPLOYER_SECRET).toBe(STELLAR_SECRET);
    expect(env.AVALANCHE_DEPLOYER_PRIVATE_KEY).toBe(EVM_KEY);
  });

  it("rejects an unknown settle mode with ConfigError", () => {
    expect(
      hasErrorCode(
        captureError(() => parseEnv({ ...BASE, SETTLE_MODE: "yolo" })),
        "ConfigError",
      ),
    ).toBe(true);
  });

  it("rejects a plain-http RPC URL", () => {
    const error = captureError(() => parseEnv({ ...BASE, STELLAR_RPC_URL: "http://example.org" }));

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
  });

  it("names a malformed key without ever echoing its value", () => {
    const malformed = `S${"A".repeat(54)}!`;
    const evmMalformed = `${"cd".repeat(32)}`;
    const error = captureError(() =>
      parseEnv({
        ...BASE,
        STELLAR_TEST_USER_SECRET: malformed,
        AVALANCHE_TEST_USER_PRIVATE_KEY: evmMalformed,
      }),
    );

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    const serialised = JSON.stringify(
      isAgentHabitError(error) ? { message: error.message, details: error.details } : null,
    );
    expect(serialised).toContain("STELLAR_TEST_USER_SECRET");
    expect(serialised).toContain("AVALANCHE_TEST_USER_PRIVATE_KEY");
    expect(serialised).not.toContain(malformed);
    expect(serialised).not.toContain(evmMalformed);
  });

  it("rejects a Stellar seed with the right shape but a broken checksum", () => {
    // Flip the last character: still `S` + 55 base32 characters, no longer a seed.
    const last = STELLAR_SECRET.at(-1) === "A" ? "B" : "A";
    const broken = `${STELLAR_SECRET.slice(0, -1)}${last}`;
    const error = captureError(() => parseEnv({ ...BASE, STELLAR_ORACLE_SECRET: broken }));

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toEqual({
      variables: ["STELLAR_ORACLE_SECRET"],
    });
  });

  it("accepts EVM keys from 1 to n - 1 and rejects 0 and n and above", () => {
    for (const valid of [1n, ORDER - 1n]) {
      expect(parseEnv({ ...BASE, AVALANCHE_ORACLE_PRIVATE_KEY: evmHex(valid) })).toBeDefined();
    }
    for (const invalid of [0n, ORDER, 2n ** 256n - 1n]) {
      const error = captureError(() =>
        parseEnv({ ...BASE, AVALANCHE_ORACLE_PRIVATE_KEY: evmHex(invalid) }),
      );
      expect(hasErrorCode(error, "ConfigError")).toBe(true);
    }
  });
});
