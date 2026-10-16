import type { AvalancheKeyVariable, Env, StellarKeyVariable } from "@agenthabit/config";
import { Keypair } from "@stellar/stellar-sdk";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

/** The three testnet identities per chain (CLAUDE.md, T2). */
export const ROLES = [
  {
    name: "deployer",
    stellar: "STELLAR_DEPLOYER_SECRET",
    avalanche: "AVALANCHE_DEPLOYER_PRIVATE_KEY",
  },
  {
    name: "oracle",
    stellar: "STELLAR_ORACLE_SECRET",
    avalanche: "AVALANCHE_ORACLE_PRIVATE_KEY",
  },
  {
    name: "test user",
    stellar: "STELLAR_TEST_USER_SECRET",
    avalanche: "AVALANCHE_TEST_USER_PRIVATE_KEY",
  },
] as const satisfies readonly {
  name: string;
  stellar: StellarKeyVariable;
  avalanche: AvalancheKeyVariable;
}[];

export type Role = (typeof ROLES)[number];

/** Where fresh keys come from. Tests swap it for a deterministic source. */
export interface KeyGenerator {
  stellarSecret(): string;
  evmPrivateKey(): string;
}

export const randomKeys: KeyGenerator = {
  stellarSecret: () => Keypair.random().secret(),
  evmPrivateKey: () => generatePrivateKey(),
};

/** A fresh key for every variable that is not set yet; set variables are left out entirely. */
export function missingKeys(env: Env, generate: KeyGenerator): Map<string, string> {
  const fresh = new Map<string, string>();
  for (const role of ROLES) {
    if (env[role.stellar] === undefined) fresh.set(role.stellar, generate.stellarSecret());
    if (env[role.avalanche] === undefined) fresh.set(role.avalanche, generate.evmPrivateKey());
  }
  return fresh;
}

export function stellarAddress(secret: string): string {
  return Keypair.fromSecret(secret).publicKey();
}

/** Takes a key already validated by `parseEnv` (`@agenthabit/config`). */
export function evmAddress(privateKey: `0x${string}`): string {
  return privateKeyToAddress(privateKey);
}
