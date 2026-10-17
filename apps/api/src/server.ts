// `pnpm run api:dev`: the API on API_PORT, with the settings from `.env.local` (never argv).
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { normalizeEvmAddress, verifyEvmLinkSignature } from "@agenthabit/chain-avalanche";
import { normalizeStellarAddress, verifyStellarLinkSignature } from "@agenthabit/chain-stellar";
import { parseApiEnv } from "@agenthabit/config";
import { AgentHabitError } from "@agenthabit/core";
import { createDatabase, parseTokenKey } from "@agenthabit/db";
import { StravaClient } from "@agenthabit/strava";
import { serve } from "@hono/node-server";

import { type CommitReader, createApp } from "./app.js";

const envPath = resolve(import.meta.dirname, "../../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);
const env = parseApiEnv(process.env);

/** On-chain reads land with T6's adapters; until then every reported commit is refused. */
const commitsUntilT6: CommitReader = {
  readCommit: async () => {
    throw new AgentHabitError("NetworkError", "On-chain commit reads land with T6");
  },
};

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
      verifyLinkSignature: verifyStellarLinkSignature,
    },
    avalanche: {
      normalizeAddress: normalizeEvmAddress,
      verifyLinkSignature: verifyEvmLinkSignature,
    },
  },
  commits: commitsUntilT6,
  // Filled from deployments/*.json once T6 deploys the contracts.
  knownContracts: new Set(),
  webOrigin: env.WEB_ORIGIN,
  stravaRedirectUri: env.STRAVA_REDIRECT_URI,
  now: () => new Date(),
  randomBytes,
  log: (line) => process.stdout.write(`${line}\n`),
});

serve({ fetch: app.fetch, port: env.API_PORT });
process.stdout.write(`api listening on http://localhost:${env.API_PORT}\n`);
