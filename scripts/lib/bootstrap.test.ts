import { copyFile, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseEnv } from "@agenthabit/config";
import { AgentHabitError, hasErrorCode } from "@agenthabit/core";
import { Keypair } from "@stellar/stellar-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type BootstrapOptions, guardSecrets, runBootstrap, runBootstrapCli } from "./bootstrap.js";
import { parseEnv as parseEnvFile } from "./env-file.js";
import { ROLES } from "./keys.js";
import type { StellarTestnet } from "./stellar-testnet.js";

const EXAMPLE = resolve(import.meta.dirname, "../../.env.example");

/** An in-memory testnet: accounts and trustlines exist once created, like the real one. */
class FakeTestnet implements StellarTestnet {
  readonly accounts = new Set<string>();
  readonly trustlines = new Set<string>();
  readonly calls: string[] = [];
  servesTestnet = true;

  async assertTestnet(): Promise<void> {
    this.calls.push("assertTestnet");
    if (!this.servesTestnet) {
      throw new AgentHabitError("ConfigError", "STELLAR_RPC_URL does not serve testnet");
    }
  }
  async accountExists(address: string): Promise<boolean> {
    return this.accounts.has(address);
  }
  async fund(address: string): Promise<void> {
    this.calls.push("fund");
    this.accounts.add(address);
  }
  async hasUsdcTrustline(address: string): Promise<boolean> {
    return this.trustlines.has(address);
  }
  async addUsdcTrustline(secret: string): Promise<string> {
    this.calls.push("addUsdcTrustline");
    this.trustlines.add(Keypair.fromSecret(secret).publicKey());
    return "ab".repeat(32);
  }
}

async function workspace(): Promise<{ envPath: string; examplePath: string }> {
  const dir = await mkdtemp(join(tmpdir(), "agenthabit-bootstrap-"));
  const examplePath = join(dir, ".env.example");
  await copyFile(EXAMPLE, examplePath);
  return { envPath: join(dir, ".env.local"), examplePath };
}

function options(
  paths: { envPath: string; examplePath: string },
  testnet: StellarTestnet,
  lines: string[],
): BootstrapOptions {
  return { ...paths, connectStellar: () => testnet, print: (line) => lines.push(line) };
}

async function secretsIn(envPath: string): Promise<string[]> {
  const env = parseEnv(Object.fromEntries(parseEnvFile(await readFile(envPath, "utf8"))));
  return ROLES.flatMap((role) => [env[role.stellar], env[role.avalanche]]).filter(
    (value) => value !== undefined,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runBootstrap", () => {
  it("creates the six testnet keys on the first run, owner-only, seeded from .env.example", async () => {
    const paths = await workspace();
    const testnet = new FakeTestnet();

    const report = await runBootstrap(options(paths, testnet, []));

    const contents = await readFile(paths.envPath, "utf8");
    expect(report.created).toHaveLength(6);
    expect(await secretsIn(paths.envPath)).toHaveLength(6);
    expect(contents).toContain("SETTLE_MODE=dry-run");
    expect(contents).toContain("# --- Stellar testnet (Phase 1)");
    expect((await stat(paths.envPath)).mode & 0o777).toBe(0o600);
  });

  it("funds the three Stellar accounts and adds the test user's USDC trustline once", async () => {
    const paths = await workspace();
    const testnet = new FakeTestnet();

    const report = await runBootstrap(options(paths, testnet, []));

    expect(report.funded).toHaveLength(3);
    expect(report.trustline).toBe("created");
    expect(testnet.calls).toEqual(["assertTestnet", "fund", "fund", "fund", "addUsdcTrustline"]);
  });

  it("a second run keeps every key and touches neither Friendbot nor the trustline", async () => {
    const paths = await workspace();
    const testnet = new FakeTestnet();
    await runBootstrap(options(paths, testnet, []));
    const afterFirst = await readFile(paths.envPath, "utf8");
    testnet.calls.length = 0;

    const second = await runBootstrap(options(paths, testnet, []));

    expect(await readFile(paths.envPath, "utf8")).toBe(afterFirst);
    expect(second).toEqual({ created: [], funded: [], trustline: "already in place" });
    expect(testnet.calls).toEqual(["assertTestnet"]);
  });

  it("fills only the missing keys and keeps the user's own lines and values", async () => {
    const paths = await workspace();
    const ownSecret = Keypair.random().secret();
    const example = await readFile(paths.examplePath, "utf8");
    await writeFile(
      paths.envPath,
      `${example.replace("STELLAR_ORACLE_SECRET=", `STELLAR_ORACLE_SECRET=${ownSecret}`)}# mine\nFOO=bar\n`,
    );

    const report = await runBootstrap(options(paths, new FakeTestnet(), []));

    const contents = await readFile(paths.envPath, "utf8");
    expect(report.created).toHaveLength(5);
    expect(report.created).not.toContain("STELLAR_ORACLE_SECRET");
    expect(contents).toContain(`STELLAR_ORACLE_SECRET=${ownSecret}`);
    expect(contents).toContain("# mine\nFOO=bar\n");
  });

  it("stops with ConfigError on a malformed key and leaves the file untouched", async () => {
    const paths = await workspace();
    const broken =
      "STELLAR_RPC_URL=https://soroban-testnet.stellar.org\nAVALANCHE_FUJI_RPC_URL=https://api.avax-test.network/ext/bc/C/rpc\nSTELLAR_DEPLOYER_SECRET=not-a-key\n";
    await writeFile(paths.envPath, broken);
    const testnet = new FakeTestnet();

    await expect(runBootstrap(options(paths, testnet, []))).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(await readFile(paths.envPath, "utf8")).toBe(broken);
    expect(testnet.calls).toEqual([]);
  });

  it("refuses to fund anything when the RPC does not serve testnet", async () => {
    const paths = await workspace();
    const testnet = new FakeTestnet();
    testnet.servesTestnet = false;

    await expect(runBootstrap(options(paths, testnet, []))).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(testnet.calls).toEqual(["assertTestnet"]);
  });

  it("never prints a secret, on the first run or the second", async () => {
    const paths = await workspace();
    const testnet = new FakeTestnet();
    const lines: string[] = [];
    const written: string[] = [];
    const capture = (chunk: unknown) => {
      written.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args) => capture(args.join(" ")));
    }

    await runBootstrap(options(paths, testnet, lines));
    await runBootstrap(options(paths, testnet, lines));

    const output = [...lines, ...written].join("\n").toLowerCase();
    const secrets = await secretsIn(paths.envPath);
    expect(secrets).toHaveLength(6);
    expect(lines.length).toBeGreaterThan(20);
    for (const secret of secrets) {
      expect(output).not.toContain(secret.toLowerCase());
      expect(output).not.toContain(secret.replace(/^0x/, "").toLowerCase());
    }
  });

  it("prints the public addresses the manual faucets need", async () => {
    const paths = await workspace();
    const lines: string[] = [];

    await runBootstrap(options(paths, new FakeTestnet(), lines));

    const output = lines.join("\n");
    expect(output).toContain("https://faucet.circle.com/");
    expect(output).toContain("https://core.app/tools/testnet-faucet/");
    expect(output.match(/0x[0-9a-fA-F]{40}\b/g)?.length).toBeGreaterThanOrEqual(6);
    expect(output.match(/\bG[A-Z2-7]{55}\b/g)?.length).toBeGreaterThanOrEqual(4);
  });
});

describe("runBootstrap never loses an existing key", () => {
  it("stops on a set key followed by a pasted empty duplicate, leaving the file as it was", async () => {
    const paths = await workspace();
    const realOracle = Keypair.random().secret();
    const example = await readFile(paths.examplePath, "utf8");
    const before = `${example.replace(
      "STELLAR_ORACLE_SECRET=",
      `STELLAR_ORACLE_SECRET=${realOracle}`,
    )}\n# pasted again\nSTELLAR_ORACLE_SECRET=\n`;
    await writeFile(paths.envPath, before);
    const testnet = new FakeTestnet();

    await expect(runBootstrap(options(paths, testnet, []))).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(await readFile(paths.envPath, "utf8")).toBe(before);
    expect(testnet.calls).toEqual([]);
  });

  it("stops before writing anything on a seed with a broken checksum", async () => {
    const paths = await workspace();
    const seed = Keypair.random().secret();
    const broken = `${seed.slice(0, -1)}${seed.endsWith("A") ? "B" : "A"}`;
    const example = await readFile(paths.examplePath, "utf8");
    const before = example.replace("STELLAR_DEPLOYER_SECRET=", `STELLAR_DEPLOYER_SECRET=${broken}`);
    await writeFile(paths.envPath, before);

    await expect(runBootstrap(options(paths, new FakeTestnet(), []))).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(await readFile(paths.envPath, "utf8")).toBe(before);
  });
});

describe("the bootstrap lock", () => {
  it("refuses to run while another live bootstrap holds the lock", async () => {
    const paths = await workspace();
    await writeFile(`${paths.envPath}.lock`, `${process.pid}\n`);
    const testnet = new FakeTestnet();

    await expect(runBootstrap(options(paths, testnet, []))).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(testnet.calls).toEqual([]);
    expect(await readFile(`${paths.envPath}.lock`, "utf8")).toBe(`${process.pid}\n`);
  });

  it("takes over a lock left by a bootstrap that died, and removes it when done", async () => {
    const paths = await workspace();
    // Far above any real pid on macOS and Linux, so no live process can own it.
    await writeFile(`${paths.envPath}.lock`, "2147483646\n");

    const report = await runBootstrap(options(paths, new FakeTestnet(), []));

    expect(report.created).toHaveLength(6);
    expect(await readdir(join(paths.envPath, ".."))).not.toContain(".env.local.lock");
  });
});

describe("runBootstrapCli", () => {
  /** A testnet whose trustline step fails with an error that quotes the signing key. */
  class LeakyTestnet extends FakeTestnet {
    constructor(private readonly failure: (secret: string) => unknown) {
      super();
    }
    override async addUsdcTrustline(secret: string): Promise<string> {
      throw this.failure(secret);
    }
  }

  async function runCli(failure: (secret: string) => unknown) {
    const paths = await workspace();
    const errors: string[] = [];
    const code = await runBootstrapCli(options(paths, new LeakyTestnet(failure), []), (line) =>
      errors.push(line),
    );
    return { code, errors, secrets: await secretsIn(paths.envPath) };
  }

  it("exits 1 and withholds an AgentHabitError whose message quotes a key", async () => {
    const { code, errors, secrets } = await runCli(
      (secret) =>
        new AgentHabitError("NetworkError", `rejected ${secret}`, { cause: new Error(secret) }),
    );

    expect(code).toBe(1);
    expect(errors).toEqual(["bootstrap failed. (message withheld: it contained a secret)"]);
    for (const secret of secrets) {
      expect(errors.join("\n")).not.toContain(secret);
    }
  });

  it("never echoes a dependency's error, even one carrying a key", async () => {
    const { code, errors } = await runCli((secret) => new Error(`sdk exploded on ${secret}`));

    expect(code).toBe(1);
    expect(errors).toEqual(["bootstrap failed. unexpected failure"]);
  });

  it("shows the code and message of an ordinary failure", async () => {
    const { code, errors } = await runCli(
      () => new AgentHabitError("NetworkError", "Stellar testnet: could not create the trustline"),
    );

    expect(code).toBe(1);
    expect(errors).toEqual([
      "bootstrap failed. NetworkError: Stellar testnet: could not create the trustline",
    ]);
  });

  it("exits 0 when everything is in place", async () => {
    const paths = await workspace();
    const errors: string[] = [];

    expect(
      await runBootstrapCli(options(paths, new FakeTestnet(), []), (l) => errors.push(l)),
    ).toBe(0);
    expect(errors).toEqual([]);
  });
});

describe("guardSecrets", () => {
  const evmKey = `0x${"c0ffee".repeat(10)}abcd`;

  it("passes a line without secrets through", () => {
    const lines: string[] = [];
    guardSecrets([evmKey], (line) => lines.push(line))("address 0x1234");

    expect(lines).toEqual(["address 0x1234"]);
  });

  it("refuses a line carrying a secret, even without its 0x or in another case", () => {
    const lines: string[] = [];
    const print = guardSecrets([evmKey], (line) => lines.push(line));

    for (const leak of [evmKey, evmKey.slice(2), evmKey.toUpperCase()]) {
      let caught: unknown;
      try {
        print(`oops ${leak}`);
      } catch (error) {
        caught = error;
      }
      expect(hasErrorCode(caught, "SecretLeak")).toBe(true);
    }
    expect(lines).toEqual([]);
  });
});
