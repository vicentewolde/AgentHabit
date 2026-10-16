// `pnpm run cases:gen`: exports the shared case table from packages/core to
// contracts/fixtures/cases.json, which the Rust and Foundry runners read (A-3). The JSON is
// committed; a test in `pnpm check` fails when it drifts from the table.
import { writeFileSync } from "node:fs";

import { buildCaseFixture, serializeCaseFixture } from "@agenthabit/core";

import { CASES_PATH } from "./lib/cases-path.js";

writeFileSync(CASES_PATH, serializeCaseFixture(buildCaseFixture()));
process.stdout.write(`wrote ${CASES_PATH}\n`);
