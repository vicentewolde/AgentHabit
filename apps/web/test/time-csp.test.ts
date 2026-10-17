import type { WeekView } from "@agenthabit/core";
import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "../src/csp.js";
import { canRelease, daysLeft, describeDaysLeft } from "../src/time.js";

function week(overrides: Partial<WeekView>): WeekView {
  return {
    weekId: "3",
    startsAt: "2026-10-26T03:00:00.000Z",
    endsAt: "2026-11-02T03:00:00.000Z",
    settleOpensAt: "2026-11-02T06:00:00.000Z",
    releaseOpensAt: "2026-11-11T03:00:00.000Z",
    position: { state: "Active", amount: "200000000", goalM: 10_000, commitTxHash: "a".repeat(64) },
    totalM: null,
    readAt: null,
    ...overrides,
  };
}

const AFTER = Date.parse("2026-11-11T03:00:00.000Z");

describe("canRelease: the button rule", () => {
  it("is true only when the window opened and the position is Active", () => {
    expect(canRelease(week({}), AFTER)).toBe(true);
    expect(canRelease(week({}), AFTER - 1)).toBe(false);
  });

  it("is false for every other state and for no position", () => {
    for (const state of ["Returned", "Forfeited", "ReleasedStale"] as const) {
      const position = { state, amount: "1", goalM: 1, commitTxHash: null };
      expect(canRelease(week({ position }), AFTER + 1000), state).toBe(false);
    }
    expect(canRelease(week({ position: null }), AFTER + 1000)).toBe(false);
  });
});

describe("days left", () => {
  const end = "2026-11-02T03:00:00.000Z";
  it("rounds up and never goes negative", () => {
    expect(daysLeft(end, Date.parse("2026-10-30T04:00:00Z"))).toBe(3);
    expect(daysLeft(end, Date.parse("2026-11-03T00:00:00Z"))).toBe(0);
    expect(describeDaysLeft(end, Date.parse("2026-10-28T03:00:00Z"))).toBe("Quedan 5 días");
    expect(describeDaysLeft(end, Date.parse("2026-11-03T00:00:00Z"))).toBe("La semana ya terminó");
  });
});

describe("content security policy", () => {
  it("allows only itself and the API, and nothing inline", () => {
    const policy = contentSecurityPolicy("https://api.example.com/some/path");
    expect(policy.meta).toContain("default-src 'none'");
    expect(policy.meta).toContain("connect-src 'self' https://api.example.com");
    expect(policy.meta).not.toContain("unsafe-inline");
    expect(policy.meta).not.toContain("frame-ancestors");
    expect(policy.header).toContain("frame-ancestors 'none'");
  });
});
