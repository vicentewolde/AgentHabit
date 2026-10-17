/**
 * DEV ONLY. Runs the mock API (`mock-app.ts`) on a local port.
 *
 *   pnpm run web:mock-api            # port 3000, scenario "no-position"
 *   MOCK_SCENARIO=active pnpm run web:mock-api
 *
 * Open http://localhost:3000/__mock to switch scenario while the web is running.
 */
import { serve } from "@hono/node-server";
import { createMockApp, SCENARIOS, type ScenarioName } from "./mock-app.js";

const port = Number(process.env.PORT ?? 3000);
const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:5173";
const requested = process.env.MOCK_SCENARIO ?? "no-position";
const scenario = SCENARIOS.find((s) => s.name === requested)?.name satisfies
  | ScenarioName
  | undefined;

if (scenario === undefined) {
  console.error(
    `Unknown MOCK_SCENARIO "${requested}". Use one of: ${SCENARIOS.map((s) => s.name).join(", ")}`,
  );
  process.exit(1);
}

serve({ fetch: createMockApp({ webOrigin, scenario }).fetch, port, hostname: "127.0.0.1" }, () => {
  console.log(`Mock API (dev only) on http://localhost:${port}  scenario=${scenario}`);
  console.log(`Switch scenarios at http://localhost:${port}/__mock  (web origin: ${webOrigin})`);
});
