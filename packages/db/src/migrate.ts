// `pnpm run db:migrate`: applies packages/db/drizzle to the Neon database in DATABASE_URL, read
// from `.env.local` (never argv). Touches the network; it moves no funds.
import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { ApiEnvSchema } from "@agenthabit/config";
import { AgentHabitError } from "@agenthabit/core";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const envPath = resolve(import.meta.dirname, "../../../.env.local");
if (existsSync(envPath)) process.loadEnvFile(envPath);

const parsed = ApiEnvSchema.pick({ DATABASE_URL: true }).safeParse(process.env);
if (!parsed.success) {
  // The URL holds a password: name the variable, never the value.
  throw new AgentHabitError("ConfigError", "invalid environment: DATABASE_URL", {
    details: { variables: ["DATABASE_URL"] },
  });
}

const pool = new Pool({ connectionString: parsed.data.DATABASE_URL });
try {
  await migrate(drizzle(pool), { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });
  process.stdout.write("migrations applied\n");
} finally {
  await pool.end();
}
