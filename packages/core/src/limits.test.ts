import { describe, expect, it } from "vitest";
import { hasErrorCode } from "./errors.js";
import { INSTANCES, instanceParams, usdcToUnits, validateParams } from "./limits.js";
import { goalMet } from "./settlement.js";

describe("usdcToUnits", () => {
  it("uses 7 decimals on Stellar and 6 on Avalanche", () => {
    expect(usdcToUnits(20n, "stellar")).toBe(200_000_000n);
    expect(usdcToUnits(20n, "avalanche")).toBe(20_000_000n);
  });
});

describe("instanceParams", () => {
  it("scales the production limits to each chain's decimals", () => {
    const stellar = instanceParams(INSTANCES.production, "stellar", 1_000_000n);
    const avalanche = instanceParams(INSTANCES.production, "avalanche", 1_000_000n);

    expect(stellar.minAmount).toBe(200_000_000n);
    expect(stellar.maxAmount).toBe(500_000_000n);
    expect(avalanche.minAmount).toBe(20_000_000n);
    expect(avalanche.maxAmount).toBe(50_000_000n);
    expect(stellar.weekLen).toBe(604_800n);
  });

  it("gives the rehearsal one-hour weeks, a 17-minute grace and a 500 m minimum goal", () => {
    const rehearsal = instanceParams(INSTANCES.rehearsal, "avalanche", 0n);

    expect(rehearsal.weekLen).toBe(3_600n);
    expect(rehearsal.grace).toBe(1_020n);
    expect(rehearsal.staleAfter).toBe(3_600n);
    expect(rehearsal.minGoalM).toBe(500n);
  });
});

describe("validateParams", () => {
  const good = instanceParams(INSTANCES.production, "stellar", 1_000_000n);

  function broken(change: Partial<typeof good>): unknown {
    try {
      validateParams({ ...good, ...change });
    } catch (error) {
      return error;
    }
    return "accepted";
  }

  it("accepts the production parameters and equal limits", () => {
    expect(broken({})).toBe("accepted");
    expect(broken({ maxAmount: good.minAmount, maxGoalM: good.minGoalM })).toBe("accepted");
  });

  it("rejects each rule of the constructor with InvalidConfig", () => {
    const cases = [
      { minAmount: 0n },
      { minAmount: good.maxAmount + 1n },
      { minGoalM: 0n },
      { minGoalM: good.maxGoalM + 1n },
      { weekLen: 0n },
      { grace: 0n },
      { grace: good.staleAfter },
      { grace: good.staleAfter + 1n },
      { weekAnchor: -1n },
      { staleAfter: 2n ** 64n },
      { maxGoalM: 2n ** 64n },
      { maxAmount: 2n ** 127n },
    ];
    for (const change of cases) {
      expect(hasErrorCode(broken(change), "InvalidConfig")).toBe(true);
    }
  });
});

describe("goalMet", () => {
  it("counts the goal as met from exactly the goal, in whole metres", () => {
    expect(goalMet(9_999n, 10_000n)).toBe(false);
    expect(goalMet(10_000n, 10_000n)).toBe(true);
    expect(goalMet(12_345n, 10_000n)).toBe(true);
  });

  it("treats no runs as not met", () => {
    expect(goalMet(0n, 500n)).toBe(false);
  });

  it("rejects a negative total", () => {
    let error: unknown;
    try {
      goalMet(-1n, 10_000n);
    } catch (caught) {
      error = caught;
    }
    expect(hasErrorCode(error, "InvalidDistance")).toBe(true);
  });
});
