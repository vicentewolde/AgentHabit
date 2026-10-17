// `pnpm run smoke:stellar`: a read-only check of the deployed contract on Stellar testnet. It
// reads the config, the current week, the forfeited total and the test user's position, and asks
// the network whether a commit for next week would be accepted, without sending anything. It moves
// no funds and prints only public data. Keys come from `.env.local`.
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { StellarContractClient } from "@agenthabit/chain-stellar";
import { parseEnv } from "@agenthabit/config";
import {
  AgentHabitError,
  hasErrorCode,
  isAgentHabitError,
  liveInstance,
  parseDeployments,
  usdcToUnits,
} from "@agenthabit/core";
import { rpc } from "@stellar/stellar-sdk";

import { stellarAddress } from "./lib/keys.js";
import { assertTestnet } from "./lib/stellar-sdk-deployer.js";

const root = resolve(import.meta.dirname, "..");
const envPath = resolve(root, ".env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

function say(line: string) {
  process.stdout.write(`${line}\n`);
}

async function check<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const value = await run();
    say(`ok   ${label}`);
    return value;
  } catch (error) {
    // The code and the contract error's name: never the raw message.
    const code = isAgentHabitError(error) ? error.code : "Unexpected";
    const detail = isAgentHabitError(error) ? JSON.stringify(error.details) : "";
    say(`FAIL ${label}: ${code} ${detail}`);
    process.exitCode = 1;
    return undefined;
  }
}

const env = parseEnv(process.env);
const deploymentsPath = resolve(root, "deployments/stellar-testnet.json");
if (!existsSync(deploymentsPath)) {
  throw new AgentHabitError("ConfigError", "No deployments/stellar-testnet.json: deploy first");
}
const file = parseDeployments(JSON.parse(readFileSync(deploymentsPath, "utf8")));
const instance = liveInstance(file, "production");
if (instance === null || file.networkPassphrase === undefined) {
  throw new AgentHabitError("ConfigError", "No live production instance in the deployments file");
}

const server = new rpc.Server(env.STELLAR_RPC_URL);
await assertTestnet(server);
const client = new StellarContractClient({
  contractId: instance.contract,
  networkPassphrase: file.networkPassphrase,
  server,
});

say(`contract ${instance.contract}`);
const config = await check("config() matches deployments/stellar-testnet.json", async () => {
  const onChain = await client.config();
  const same =
    onChain.token === instance.token &&
    onChain.oracle === instance.oracle &&
    onChain.weekAnchor.toString() === instance.params.weekAnchor &&
    onChain.maxAmount.toString() === instance.params.maxAmount;
  if (!same) throw new AgentHabitError("DeploymentDrift", "config() differs from the file");
  return onChain;
});
const week = await check("current_week()", () => client.currentWeek());
if (week !== undefined) say(`     week ${week}`);
const forfeited = await check("total_forfeited()", () => client.totalForfeited());
if (forfeited !== undefined) say(`     forfeited ${forfeited}`);

const secret = env.STELLAR_TEST_USER_SECRET;
if (secret !== undefined && week !== undefined && config !== undefined) {
  const user = stellarAddress(secret);
  const position = await check("get_position(test user, next week)", () =>
    client.getPosition(user, week + 1n),
  );
  if (position !== undefined) say(`     state ${position.state}`);
  // Simulation only: the network says whether it would accept the commit; nothing is sent.
  try {
    await client.prepareCommit({
      user,
      weekId: week + 1n,
      amount: usdcToUnits(20n, "stellar"),
      goalM: config.minGoalM,
    });
    say("ok   a 20 USDC commit for next week would be accepted (simulation)");
  } catch (error) {
    // A wallet with no USDC, or no USDC trustline, is the normal state before the faucet: the
    // contract and the token answered, which is what this check is for.
    const reason = isAgentHabitError(error) ? error.details.reason : undefined;
    if (hasErrorCode(error, "ContractRejected") && typeof reason === "string") {
      say(`ok   the network answered the commit simulation: refused with reason ${reason}`);
    } else {
      say(`FAIL the commit simulation: ${isAgentHabitError(error) ? error.code : "Unexpected"}`);
      process.exitCode = 1;
    }
  }
}
