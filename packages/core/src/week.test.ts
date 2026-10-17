import { describe, expect, it } from "vitest";
import { hasErrorCode } from "./errors.js";
import {
  committableWeek,
  currentWeek,
  isReleaseOpen,
  isSettleOpen,
  releaseOpensAt,
  settleWindow,
  type WeekParams,
  weekEnd,
} from "./week.js";

const params: WeekParams = {
  weekAnchor: 1_000_000n,
  weekLen: 604_800n,
  grace: 172_800n,
  staleAfter: 604_800n,
};

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return "nothing thrown";
}

describe("currentWeek", () => {
  it("fails with BeforeAnchor one second before the anchor, without underflowing", () => {
    expect(
      hasErrorCode(
        thrown(() => currentWeek(999_999n, params)),
        "BeforeAnchor",
      ),
    ).toBe(true);
    expect(
      hasErrorCode(
        thrown(() => currentWeek(0n, params)),
        "BeforeAnchor",
      ),
    ).toBe(true);
  });

  it("is week 0 from the anchor to the last second of the first week", () => {
    expect(currentWeek(1_000_000n, params)).toBe(0n);
    expect(currentWeek(1_000_000n + 604_799n, params)).toBe(0n);
  });

  it("turns to the next week exactly at the boundary", () => {
    expect(currentWeek(1_000_000n + 604_800n, params)).toBe(1n);
    expect(currentWeek(1_000_000n + 10n * 604_800n + 5n, params)).toBe(10n);
  });

  it("rejects a zero-length week with InvalidConfig instead of dividing by zero", () => {
    const broken = { ...params, weekLen: 0n };
    expect(
      hasErrorCode(
        thrown(() => currentWeek(1_000_000n, broken)),
        "InvalidConfig",
      ),
    ).toBe(true);
  });

  it("only lets users commit to the next week", () => {
    expect(committableWeek(1_000_000n, params)).toBe(1n);
    expect(committableWeek(1_000_000n + 604_799n, params)).toBe(1n);
    expect(committableWeek(1_000_000n + 604_800n, params)).toBe(2n);
  });
});

describe("weekEnd and the windows", () => {
  it("ends week w at anchor + (w + 1) · week_len", () => {
    expect(weekEnd(0n, params)).toBe(1_604_800n);
    expect(weekEnd(1n, params)).toBe(2_209_600n);
  });

  it("opens settle after the grace period and closes it when release opens", () => {
    const end = weekEnd(1n, params);
    expect(settleWindow(1n, params)).toEqual({ opens: end + 172_800n, closes: end + 604_800n });
    expect(releaseOpensAt(1n, params)).toBe(end + 604_800n);
  });

  it("keeps settle closed during the grace period and open until its last second", () => {
    const end = weekEnd(1n, params);
    expect(isSettleOpen(end, 1n, params)).toBe(false);
    expect(isSettleOpen(end + 172_799n, 1n, params)).toBe(false);
    expect(isSettleOpen(end + 172_800n, 1n, params)).toBe(true);
    expect(isSettleOpen(end + 604_799n, 1n, params)).toBe(true);
    expect(isSettleOpen(end + 604_800n, 1n, params)).toBe(false);
  });

  it("opens release exactly when settle closes, with no deadline", () => {
    const end = weekEnd(1n, params);
    expect(isReleaseOpen(end + 604_799n, 1n, params)).toBe(false);
    expect(isReleaseOpen(end + 604_800n, 1n, params)).toBe(true);
    expect(isReleaseOpen(end + 100n * 604_800n, 1n, params)).toBe(true);
  });

  it("never overlaps the settle and release windows", () => {
    for (let offset = -2n; offset <= 2n; offset += 1n) {
      const now = releaseOpensAt(3n, params) + offset;
      expect(isSettleOpen(now, 3n, params) && isReleaseOpen(now, 3n, params)).toBe(false);
    }
  });
});
