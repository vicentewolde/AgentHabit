import { describe, expect, it } from "vitest";
import {
  isMondayMidnightChile,
  liveInstance,
  mondayMidnightChileAtOrBefore,
  parseDeployments,
} from "./deployments.js";
import { hasErrorCode, isAgentHabitError } from "./errors.js";

const instance = {
  kind: "production",
  status: "live",
  contract: "CSYNTHETICCONTRACT",
  codeHash: "ab".repeat(32),
  token: "CSYNTHETICTOKEN",
  oracle: "GSYNTHETICORACLE",
  params: {
    minAmount: "200000000",
    maxAmount: "500000000",
    minGoalM: "10000",
    maxGoalM: "300000",
    weekAnchor: "1791774000",
    weekLen: "604800",
    grace: "172800",
    staleAfter: "604800",
  },
  txHash: "cd".repeat(32),
  deployedAt: "2026-10-19T12:00:00.000Z",
};
const file = { schemaVersion: 1, network: "stellar-testnet", instances: [instance] };

describe("parseDeployments", () => {
  it("accepts a well-formed file", () => {
    expect(parseDeployments(file).instances).toHaveLength(1);
  });

  it("refuses a malformed file, naming only the paths", () => {
    let error: unknown;
    try {
      parseDeployments({ ...file, instances: [{ ...instance, codeHash: "nope" }] });
    } catch (caught) {
      error = caught;
    }
    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toEqual({
      issues: ["instances.0.codeHash"],
    });
  });
});

describe("liveInstance", () => {
  it("ignores an instance that a testnet reset erased", () => {
    const parsed = parseDeployments({
      ...file,
      instances: [{ ...instance, status: "reset", contract: "COLD" }, instance],
    });

    expect(liveInstance(parsed, "production")?.contract).toBe("CSYNTHETICCONTRACT");
    expect(liveInstance(parsed, "rehearsal")).toBeNull();
  });
});

describe("isMondayMidnightChile", () => {
  it("knows Monday 12 Oct 2026 00:00 in UTC-3 and nothing else", () => {
    const monday = BigInt(Date.parse("2026-10-12T03:00:00Z") / 1000);

    expect(isMondayMidnightChile(monday)).toBe(true);
    expect(isMondayMidnightChile(monday + 1n)).toBe(false);
    expect(isMondayMidnightChile(monday + 86_400n)).toBe(false);
    expect(isMondayMidnightChile(monday + 604_800n)).toBe(true);
  });
});

describe("mondayMidnightChileAtOrBefore", () => {
  const seconds = (iso: string) => BigInt(Date.parse(iso) / 1000);

  it("finds the Monday that started the current week", () => {
    const monday = seconds("2026-10-19T03:00:00Z");

    expect(mondayMidnightChileAtOrBefore(seconds("2026-10-21T15:00:00Z"))).toBe(monday);
    expect(mondayMidnightChileAtOrBefore(monday)).toBe(monday);
    expect(mondayMidnightChileAtOrBefore(monday - 1n)).toBe(monday - 604_800n);
  });

  it("always lands on a Monday midnight in Chile", () => {
    for (const iso of ["2026-10-17T12:00:00Z", "2026-11-04T03:00:00Z", "2026-12-31T23:59:59Z"]) {
      expect(isMondayMidnightChile(mondayMidnightChileAtOrBefore(seconds(iso)))).toBe(true);
    }
  });
});
