import { fileURLToPath } from "node:url";

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Database } from "./client.js";
import * as schema from "./schema.js";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

/**
 * An in-memory Postgres with every migration applied (A-15): tests exercise the same SQL that
 * Neon runs, and `pnpm check` never touches the network.
 */
export async function createTestDatabase(): Promise<{ db: Database; close: () => Promise<void> }> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db, close: () => client.close() };
}
