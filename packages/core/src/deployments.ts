import { z } from "zod";

import { AgentHabitError } from "./errors.js";

/**
 * The shape of `deployments/<network>.json` (spec 4.7), the only bridge between the TypeScript
 * side and the contracts (P-2). Everything that reads it goes through here, so a hand-edited or
 * stale file fails loudly at start-up instead of pointing the API at the wrong contract.
 * Numbers are decimal strings: an amount does not fit a JS number.
 */
const Decimal = z.string().regex(/^\d{1,40}$/);

export const DeployedParamsSchema = z.object({
  minAmount: Decimal,
  maxAmount: Decimal,
  minGoalM: Decimal,
  maxGoalM: Decimal,
  weekAnchor: Decimal,
  weekLen: Decimal,
  grace: Decimal,
  staleAfter: Decimal,
});
export type DeployedParams = z.infer<typeof DeployedParamsSchema>;

export const DeployedInstanceSchema = z.object({
  kind: z.enum(["production", "rehearsal"]),
  /** `live`, or `reset` once a testnet reset erased the contract (spec 4.7). */
  status: z.enum(["live", "reset"]),
  /** A Soroban contract id (`C…`) or an EVM address. */
  contract: z.string().min(1),
  /** SHA-256 of the wasm, or the keccak of the EVM bytecode, as lowercase hex. */
  codeHash: z.string().regex(/^[0-9a-f]{64}$/),
  token: z.string().min(1),
  oracle: z.string().min(1),
  params: DeployedParamsSchema,
  txHash: z.string().min(1),
  deployedAt: z.string(),
});
export type DeployedInstance = z.infer<typeof DeployedInstanceSchema>;

export const DeploymentsFileSchema = z.object({
  schemaVersion: z.literal(1),
  network: z.enum(["stellar-testnet", "avalanche-fuji"]),
  /** Stellar only: the passphrase the contracts were deployed under. */
  networkPassphrase: z.string().optional(),
  instances: z.array(DeployedInstanceSchema),
});
export type DeploymentsFile = z.infer<typeof DeploymentsFileSchema>;

export function parseDeployments(json: unknown): DeploymentsFile {
  const parsed = DeploymentsFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new AgentHabitError("ConfigError", "deployments file does not match its shape", {
      details: { issues: parsed.error.issues.map((issue) => issue.path.join(".")) },
    });
  }
  return parsed.data;
}

/** The live instance of `kind`, or null. A `reset` entry is history, never an answer. */
export function liveInstance(file: DeploymentsFile, kind: DeployedInstance["kind"]) {
  return (
    file.instances.find((instance) => instance.kind === kind && instance.status === "live") ?? null
  );
}

/** Monday 00:00 in UTC-3, as a Unix timestamp, is 356400 s into a 604800-s cycle (spec 4.2). */
export function isMondayMidnightChile(weekAnchor: bigint): boolean {
  return weekAnchor % 604_800n === 356_400n;
}

/**
 * The latest Monday 00:00 in UTC-3 at or before `nowSeconds`: the default anchor of a new
 * deployment, since `commit` fails with `BeforeAnchor` while the anchor is still in the future.
 */
export function mondayMidnightChileAtOrBefore(nowSeconds: bigint): bigint {
  const cycle = 604_800n;
  const sinceAnchor = (((nowSeconds - 356_400n) % cycle) + cycle) % cycle;
  return nowSeconds - sinceAnchor;
}
