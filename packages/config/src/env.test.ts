import { hasErrorCode } from "@agenthabit/core";
import { describe, expect, it } from "vitest";
import { parseEnv } from "./env.js";

const STELLAR_SECRET = `S${"A".repeat(55)}`;
const EVM_KEY = `0x${"ab".repeat(32)}`;

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
    const serialised = JSON.stringify({
      message: (error as Error).message,
      details: (error as { details: unknown }).details,
    });
    expect(serialised).toContain("STELLAR_TEST_USER_SECRET");
    expect(serialised).toContain("AVALANCHE_TEST_USER_PRIVATE_KEY");
    expect(serialised).not.toContain(malformed);
    expect(serialised).not.toContain(evmMalformed);
  });
});
