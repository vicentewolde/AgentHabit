import { defineConfig } from "drizzle-kit";

// `pnpm run db:generate` only reads the schema: it needs no DATABASE_URL and no network.
// Migrations are applied to Neon with `pnpm run db:migrate`, which validates the environment.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./drizzle",
});
