// `pnpm run bootstrap`: testnet keys in .env.local, Friendbot, the USDC trustline and the
// addresses for the manual faucets. Takes no arguments: keys never travel through argv.
import { resolve } from "node:path";

import { runBootstrapCli } from "./lib/bootstrap.js";
import { connectStellarTestnet } from "./lib/stellar-testnet.js";

const root = resolve(import.meta.dirname, "..");

process.exitCode = await runBootstrapCli(
  {
    envPath: resolve(root, ".env.local"),
    examplePath: resolve(root, ".env.example"),
    connectStellar: connectStellarTestnet,
    print: (line) => process.stdout.write(`${line}\n`),
  },
  (line) => process.stderr.write(`${line}\n`),
);
