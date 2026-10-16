import { readFileSync } from "node:fs";

import { buildCaseFixture, serializeCaseFixture } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { CASES_PATH } from "./lib/cases-path.js";

describe("contracts/fixtures/cases.json", () => {
  // The contract jobs in CI do not run pnpm, so this is the only guard against a stale table.
  it("matches the case table in packages/core (run `pnpm run cases:gen` if it does not)", () => {
    expect(readFileSync(CASES_PATH, "utf8")).toBe(serializeCaseFixture(buildCaseFixture()));
  });
});
