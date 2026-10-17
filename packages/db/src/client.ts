import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool } from "pg";

import * as schema from "./schema.js";

/** Any Drizzle Postgres database with this schema: Neon through `pg`, or PGlite in tests. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

/**
 * The production database (Neon, P-5). `url` is DATABASE_URL, validated by @agenthabit/config;
 * it is a secret and is never logged.
 */
export function createDatabase(url: string): { db: Database; close: () => Promise<void> } {
  const pool = new Pool({ connectionString: url });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}
