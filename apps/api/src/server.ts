// `pnpm run api:dev`: the API on API_PORT, with the settings from `.env.local` (never argv).
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeEvmAddress, verifyEvmLinkSignature } from "@agenthabit/chain-avalanche";
import {
  normalizeStellarAddress,
  normalizeStellarContract,
  verifyStellarLinkSignature,
} from "@agenthabit/chain-stellar";
import { parseApiEnv, parseEnv } from "@agenthabit/config";
import { AgentHabitError, type ChainId, liveInstance, parseDeployments } from "@agenthabit/core";
import { createDatabase, parseTokenKey } from "@agenthabit/db";
import { StravaClient } from "@agenthabit/strava";
import { serve } from "@hono/node-server";
import { rpc } from "@stellar/stellar-sdk";

import { type ChainBackend, createApp } from "./app.js";
import { createStellarBackend } from "./stellar-backend.js";

const root = resolve(import.meta.dirname, "../../..");
const envPath = resolve(root, ".env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);
const env = parseApiEnv(process.env);
const chainEnv = parseEnv(process.env);

/** The production instance each deployments file records, if there is one. */
const backends: Partial<Record<ChainId, ChainBackend>> = {};
const stellarFile = resolve(root, "deployments/stellar-testnet.json");
if (existsSync(stellarFile)) {
  const file = parseDeployments(JSON.parse(readFileSync(stellarFile, "utf8")));
  const instance = liveInstance(file, "production");
  if (instance !== null) {
    backends.stellar = createStellarBackend({
      file,
      instance,
      server: new rpc.Server(chainEnv.STELLAR_RPC_URL),
    });
  }
}
if (Object.keys(backends).length === 0) {
  throw new AgentHabitError(
    "ConfigError",
    "No deployed instance: run `pnpm run deploy:stellar -- --yes` first",
  );
}

const { db } = createDatabase(env.DATABASE_URL);
const app = createApp({
  db,
  tokenKey: parseTokenKey(env.TOKEN_ENCRYPTION_KEY),
  strava: new StravaClient({
    clientId: env.STRAVA_CLIENT_ID,
    clientSecret: env.STRAVA_CLIENT_SECRET,
    apiBaseUrl: env.STRAVA_API_BASE_URL,
    oauthBaseUrl: env.STRAVA_OAUTH_BASE_URL,
  }),
  chains: {
    stellar: {
      normalizeAddress: normalizeStellarAddress,
      normalizeContract: normalizeStellarContract,
      verifyLinkSignature: verifyStellarLinkSignature,
    },
    avalanche: {
      normalizeAddress: normalizeEvmAddress,
      normalizeContract: normalizeEvmAddress,
      verifyLinkSignature: verifyEvmLinkSignature,
    },
  },
  backends,
  webOrigin: env.WEB_ORIGIN,
  stravaRedirectUri: env.STRAVA_REDIRECT_URI,
  now: () => new Date(),
  randomBytes,
  log: (line) => process.stdout.write(`${line}\n`),
});

serve({ fetch: app.fetch, port: env.API_PORT });
process.stdout.write(`api listening on http://localhost:${env.API_PORT}\n`);
