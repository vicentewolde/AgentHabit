import { AgentHabitError } from "@agenthabit/core";
import { z } from "zod";

/**
 * The typed AgentHabit environment. Every value read from `.env.local` or `process.env` goes
 * through {@link parseEnv}; nothing downstream reads raw strings.
 *
 * Strava and database variables are added by T9, when something reads them.
 */

/** A Stellar secret seed: `S` followed by 55 base32 characters (StrKey). */
export const StellarSecretSchema = z.string().regex(/^S[A-Z2-7]{55}$/);

const EVM_PRIVATE_KEY = /^0x[0-9a-fA-F]{64}$/;

/** An EVM private key: `0x` followed by 32 bytes of hex, typed the way viem expects it. */
export const EvmPrivateKeySchema = z.custom<`0x${string}`>(
  (value) => typeof value === "string" && EVM_PRIVATE_KEY.test(value),
);

/** `dry-run` computes and prints; `live` signs. Live needs the user's explicit instruction. */
export const SettleModeSchema = z.enum(["dry-run", "live"]);
export type SettleMode = z.infer<typeof SettleModeSchema>;

/** The keys `pnpm run bootstrap` generates: deployer, oracle and a test user per chain. */
export const STELLAR_KEY_VARIABLES = [
  "STELLAR_DEPLOYER_SECRET",
  "STELLAR_ORACLE_SECRET",
  "STELLAR_TEST_USER_SECRET",
] as const;
export const AVALANCHE_KEY_VARIABLES = [
  "AVALANCHE_DEPLOYER_PRIVATE_KEY",
  "AVALANCHE_ORACLE_PRIVATE_KEY",
  "AVALANCHE_TEST_USER_PRIVATE_KEY",
] as const;

export type StellarKeyVariable = (typeof STELLAR_KEY_VARIABLES)[number];
export type AvalancheKeyVariable = (typeof AVALANCHE_KEY_VARIABLES)[number];

/** `KEY=` in a dotenv file means "not set yet", exactly like a missing line. */
const emptyAsUnset = (value: unknown) => (value === "" ? undefined : value);

const optional = <T extends z.ZodType>(schema: T) => z.preprocess(emptyAsUnset, schema.optional());

export const EnvSchema = z.object({
  SETTLE_MODE: z.preprocess(emptyAsUnset, SettleModeSchema.default("dry-run")),
  STELLAR_RPC_URL: z.url({ protocol: /^https$/ }),
  STELLAR_DEPLOYER_SECRET: optional(StellarSecretSchema),
  STELLAR_ORACLE_SECRET: optional(StellarSecretSchema),
  STELLAR_TEST_USER_SECRET: optional(StellarSecretSchema),
  AVALANCHE_FUJI_RPC_URL: z.url({ protocol: /^https$/ }),
  AVALANCHE_DEPLOYER_PRIVATE_KEY: optional(EvmPrivateKeySchema),
  AVALANCHE_ORACLE_PRIVATE_KEY: optional(EvmPrivateKeySchema),
  AVALANCHE_TEST_USER_PRIVATE_KEY: optional(EvmPrivateKeySchema),
});

export type Env = z.infer<typeof EnvSchema>;

/**
 * Validates an environment. On failure the error names the offending variables only: the
 * values may be secrets, so neither the message nor the details ever include them.
 */
export function parseEnv(source: Readonly<Record<string, string | undefined>>): Env {
  const result = EnvSchema.safeParse(source);
  if (result.success) {
    return result.data;
  }

  const variables = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new AgentHabitError("ConfigError", `invalid environment: ${variables.join(", ")}`, {
    details: { variables },
  });
}
