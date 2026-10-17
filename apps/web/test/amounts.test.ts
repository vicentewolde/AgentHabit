import { usdcToUnits } from "@agenthabit/core";
import { describe, expect, it } from "vitest";
import {
  formatKm,
  formatUsdc,
  parseKmToMetres,
  parseUsdc,
  validateCommit,
} from "../src/amounts.js";

const limits = {
  minAmount: usdcToUnits(20n, "stellar"),
  maxAmount: usdcToUnits(50n, "stellar"),
  minGoalM: 1000,
  maxGoalM: 100_000,
};

describe("USDC amounts (7 decimals, bigint)", () => {
  it("converts whole and decimal amounts exactly", () => {
    expect(parseUsdc("20")).toBe(200_000_000n);
    expect(parseUsdc("50")).toBe(500_000_000n);
    expect(parseUsdc("20.10")).toBe(201_000_000n);
    expect(parseUsdc("20,5")).toBe(205_000_000n);
    expect(parseUsdc(" 0.01 ")).toBe(100_000n);
  });

  it("refuses what is not an amount", () => {
    for (const bad of ["", "abc", "-5", "1e3", "20.123", "20.", ".5", "1 000", "20 USDC"]) {
      expect(parseUsdc(bad), bad).toBeNull();
    }
  });

  it("does not lose precision where a float would", () => {
    // 0.1 + 0.2 style traps: 33.33 must be exactly 333_300_000 units.
    expect(parseUsdc("33.33")).toBe(333_300_000n);
    expect(parseUsdc("999999999999.99")).toBe(9_999_999_999_999_900_000n);
  });

  it("formats units back for people", () => {
    expect(formatUsdc(200_000_000n)).toBe("20");
    expect(formatUsdc(205_000_000n)).toBe("20,5");
    expect(formatUsdc(201_000_000n)).toBe("20,1");
  });
});

describe("goals in km to whole metres", () => {
  it("converts exactly", () => {
    expect(parseKmToMetres("1")).toBe(1000);
    expect(parseKmToMetres("10,5")).toBe(10_500);
    expect(parseKmToMetres("0.999")).toBe(999);
    expect(parseKmToMetres("100")).toBe(100_000);
    expect(parseKmToMetres("12.345")).toBe(12_345);
  });

  it("refuses sub-metre precision and junk", () => {
    for (const bad of ["", "x", "1.2345", "-1", "1,", "1 km"]) {
      expect(parseKmToMetres(bad), bad).toBeNull();
    }
  });

  it("formats metres as km", () => {
    expect(formatKm(10_500)).toBe("10,5");
    expect(formatKm(1000)).toBe("1");
    expect(formatKm(999)).toBe("0,999");
  });
});

describe("validateCommit at the limits", () => {
  it("accepts exactly the minimum and the maximum", () => {
    expect(validateCommit("20", "1", limits)).toEqual({
      ok: true,
      amount: 200_000_000n,
      goalM: 1000,
    });
    expect(validateCommit("50", "100", limits)).toEqual({
      ok: true,
      amount: 500_000_000n,
      goalM: 100_000,
    });
  });

  it("rejects one step outside the amount range", () => {
    for (const amount of ["19.99", "50.01", "0", "1000"]) {
      const result = validateCommit(amount, "10", limits);
      expect(result.ok, amount).toBe(false);
      if (!result.ok) expect(result.errors.amount).toContain("entre 20 y 50 USDC");
    }
  });

  it("rejects one step outside the goal range", () => {
    for (const goal of ["0.999", "100.001", "0"]) {
      const result = validateCommit("25", goal, limits);
      expect(result.ok, goal).toBe(false);
      if (!result.ok) expect(result.errors.goal).toContain("entre 1 y 100 km");
    }
  });

  it("reports both fields at once", () => {
    const result = validateCommit("", "", limits);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.amount).toBeDefined();
      expect(result.errors.goal).toBeDefined();
    }
  });
});
