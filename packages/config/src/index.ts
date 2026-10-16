// Typed, zod-validated environment (SETTLE_MODE, RPC URLs, keys).
export {
  AVALANCHE_KEY_VARIABLES,
  type AvalancheKeyVariable,
  type Env,
  EnvSchema,
  EvmPrivateKeySchema,
  parseEnv,
  type SettleMode,
  SettleModeSchema,
  STELLAR_KEY_VARIABLES,
  type StellarKeyVariable,
  StellarSecretSchema,
} from "./env.js";
