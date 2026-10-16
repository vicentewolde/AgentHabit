// `pnpm run bootstrap`: testnet keys in .env.local, Friendbot, the USDC trustline and the
// addresses for the manual faucets. Takes no arguments: keys never travel through argv.
import { resolve } from "node:path";

import { isAgentHabitError } from "@agenthabit/core";

import { runBootstrap } from "./lib/bootstrap.js";
import { connectStellarTestnet } from "./lib/stellar-testnet.js";

const root = resolve(import.meta.dirname, "..");

try {
  await runBootstrap({
    envPath: resolve(root, ".env.local"),
    examplePath: resolve(root, ".env.example"),
    connectStellar: connectStellarTestnet,
    print: (line) => process.stdout.write(`${line}\n`),
  });
} catch (error) {
  // Only the code and our own message: a cause from a dependency is never echoed, since nothing
  // guarantees it is free of secrets.
  const summary = isAgentHabitError(error)
    ? `${error.code}: ${error.message}`
    : "unexpected failure";
  process.stderr.write(`bootstrap failed. ${summary}\n`);
  process.exitCode = 1;
}
