// `pnpm run deploy:stellar`: the production instance on Stellar testnet. Takes `--yes` to send
// (without it, only a plan is printed) and `--reset` after a testnet reset. Keys come from
// `.env.local` and never travel through argv.
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { rpc } from "@stellar/stellar-sdk";

import { runDeployStellarCli } from "./lib/deploy-stellar-cli.js";
import { STELLAR_TESTNET } from "./lib/network.js";
import { assertTestnet, createSdkDeployer } from "./lib/stellar-sdk-deployer.js";

const root = resolve(import.meta.dirname, "..");
const wasmPath = resolve(root, "contracts/stellar/target/wasm32v1-none/release/commitment.wasm");
const deploymentsPath = resolve(root, "deployments/stellar-testnet.json");
const envPath = resolve(root, ".env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

process.exitCode = await runDeployStellarCli({
  args: process.argv.slice(2),
  env: process.env,
  readWasm: async () => (existsSync(wasmPath) ? new Uint8Array(readFileSync(wasmPath)) : undefined),
  readDeployments: async () =>
    existsSync(deploymentsPath) ? JSON.parse(readFileSync(deploymentsPath, "utf8")) : undefined,
  writeDeployments: async (file) => {
    // Write beside the target and rename: a crash never leaves a half-written file.
    const temporary = `${deploymentsPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`);
    await rename(temporary, deploymentsPath);
  },
  connect: async (rpcUrl, deployerSecret) => {
    const server = new rpc.Server(rpcUrl);
    await assertTestnet(server);
    return createSdkDeployer({
      server,
      networkPassphrase: STELLAR_TESTNET.networkPassphrase,
      deployerSecret,
    });
  },
  now: () => new Date(),
  print: (line) => process.stdout.write(`${line}\n`),
  printError: (line) => process.stderr.write(`${line}\n`),
});
