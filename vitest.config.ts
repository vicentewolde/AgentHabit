import { defineConfig } from "vitest/config";

// Internal packages resolve to their source, like AgentSales. Each list replaces Vite's default
// conditions, so they are repeated by hand (`vite` is not a root dependency).
export default defineConfig({
  resolve: {
    conditions: ["@agenthabit/source", "module", "browser", "development|production"],
  },
  ssr: {
    resolve: { conditions: ["@agenthabit/source", "node", "development|production"] },
  },
  test: {
    include: ["{apps,packages}/*/{src,test}/**/*.test.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
