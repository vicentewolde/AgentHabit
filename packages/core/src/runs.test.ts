import { describe, expect, it } from "vitest";
import {
  type ActivitySummary,
  type ActivityVerdict,
  judgeActivity,
  weekStart,
  weekTotal,
} from "./runs.js";
import { goalMet } from "./settlement.js";
import { type WeekParams, weekEnd } from "./week.js";

// Synthetic fixtures only: no real Strava data enters git or a prompt (CLAUDE.md, rule 5).
const params: WeekParams = {
  weekAnchor: 1_000_000n,
  weekLen: 604_800n,
  grace: 172_800n,
  staleAfter: 604_800n,
};
const WEEK = 1n;
const start = Number(weekStart(WEEK, params));
const end = Number(weekEnd(WEEK, params));

/** A clean 10 km outdoor run in 50 minutes, a second into week 1, recorded by a watch. */
function run(overrides: Partial<ActivitySummary> = {}): ActivitySummary {
  return {
    id: "1001",
    sportType: "Run",
    distanceM: 10_000,
    movingTimeS: 3_000,
    startDate: new Date((start + 1) * 1000),
    trainer: false,
    manual: false,
    deviceName: "Synthetic Watch 1",
    uploadId: "9001",
    ...overrides,
  };
}

const at = (seconds: number) => new Date(seconds * 1000);
const judge = (overrides: Partial<ActivitySummary>) => judgeActivity(run(overrides), WEEK, params);
const COUNTED: ActivityVerdict = { kind: "counted" };
const rejected = (reason: string) => ({ kind: "rejected", reason });
const incomplete = (missing: string) => ({ kind: "incomplete", missing });

describe("judgeActivity", () => {
  it("counts a clean outdoor run", () => {
    expect(judge({})).toEqual(COUNTED);
  });

  describe("the half-open window over start_date in UTC", () => {
    it("counts a run that starts exactly at week_start", () => {
      expect(judge({ startDate: at(start) })).toEqual(COUNTED);
    });

    it("counts a run that starts in the last second of the week", () => {
      expect(judge({ startDate: at(end - 1) })).toEqual(COUNTED);
    });

    it("leaves out a run that starts exactly at week_end", () => {
      expect(judge({ startDate: at(end) })).toEqual(rejected("outside_week"));
    });

    it("leaves out a run of the previous week that ends inside this one", () => {
      expect(judge({ startDate: at(start - 1), movingTimeS: 7_200, distanceM: 20_000 })).toEqual(
        rejected("outside_week"),
      );
    });

    it("cannot judge a run with no start date or an invalid one", () => {
      expect(judge({ startDate: undefined })).toEqual(incomplete("start_date"));
      expect(judge({ startDate: new Date(Number.NaN) })).toEqual(incomplete("start_date"));
    });
  });

  describe("the sport type (A-9)", () => {
    it("counts Run and TrailRun", () => {
      expect(judge({ sportType: "TrailRun" })).toEqual(COUNTED);
    });

    it("leaves out VirtualRun and other sports", () => {
      for (const sportType of ["VirtualRun", "Ride", "Walk", "Hike", "run"]) {
        expect(judge({ sportType }), sportType).toEqual(rejected("not_a_run"));
      }
    });

    it("cannot judge an activity with no sport type", () => {
      expect(judge({ sportType: undefined })).toEqual(incomplete("sport_type"));
    });

    it("does not ask a ride for the fields only a run needs", () => {
      expect(judge({ sportType: "Ride", manual: undefined, distanceM: undefined })).toEqual(
        rejected("not_a_run"),
      );
    });
  });

  it("leaves out a treadmill run, and counts one whose trainer flag is missing", () => {
    expect(judge({ trainer: true })).toEqual(rejected("trainer"));
    expect(judge({ trainer: undefined })).toEqual(COUNTED);
  });

  it("leaves out a manual run, and cannot judge one whose manual flag is missing", () => {
    expect(judge({ manual: true })).toEqual(rejected("manual"));
    expect(judge({ manual: undefined })).toEqual(incomplete("manual"));
  });

  describe("the recording device", () => {
    it("counts a run with only a device name or only an upload id", () => {
      expect(judge({ uploadId: null })).toEqual(COUNTED);
      expect(judge({ deviceName: undefined })).toEqual(COUNTED);
    });

    it("leaves out a run with neither, blank strings included", () => {
      const cases: Partial<ActivitySummary>[] = [
        { deviceName: null, uploadId: null },
        { deviceName: undefined, uploadId: undefined },
        { deviceName: "  ", uploadId: "" },
      ];
      for (const overrides of cases) {
        expect(judge(overrides)).toEqual(rejected("no_device"));
      }
    });
  });

  it("leaves out a run with zero or negative distance or moving time", () => {
    for (const overrides of [{ distanceM: 0 }, { movingTimeS: 0 }, { distanceM: -5 }]) {
      expect(judge(overrides)).toEqual(rejected("no_distance_or_time"));
    }
  });

  it("cannot judge a run whose distance or moving time is missing or not a number", () => {
    expect(judge({ distanceM: undefined })).toEqual(incomplete("distance"));
    expect(judge({ distanceM: Number.NaN })).toEqual(incomplete("distance"));
    expect(judge({ movingTimeS: undefined })).toEqual(incomplete("moving_time"));
  });

  describe("the pace, measured with moving_time", () => {
    it("counts exactly 2:30 min/km", () => {
      expect(judge({ distanceM: 10_000, movingTimeS: 1_500 })).toEqual(COUNTED);
    });

    it("leaves out anything faster than 2:30 min/km", () => {
      expect(judge({ distanceM: 10_000, movingTimeS: 1_499 })).toEqual(rejected("too_fast"));
      // A car tagged as a run: 30 km in 20 minutes.
      expect(judge({ distanceM: 30_000, movingTimeS: 1_200 })).toEqual(rejected("too_fast"));
    });
  });
});

describe("weekTotal", () => {
  it("truncates each run to the metre before summing", () => {
    const total = weekTotal(
      [run({ id: "1", distanceM: 5_000.6 }), run({ id: "2", distanceM: 4_999.6 })],
      WEEK,
      params,
    );

    expect(total.totalM).toBe(9_999n);
    expect(goalMet(total.totalM, 10_000n)).toBe(false);
  });

  it("returns the ids it used, why the others did not count, and what it could not judge", () => {
    const total = weekTotal(
      [
        run({ id: "1", distanceM: 8_000.9 }),
        run({ id: "2", sportType: "Ride" }),
        run({ id: "3", startDate: at(end) }),
        run({ id: "4", distanceM: 2_000 }),
        run({ id: "5", manual: undefined }),
      ],
      WEEK,
      params,
    );

    expect(total.totalM).toBe(10_000n);
    expect(total.countedIds).toEqual(["1", "4"]);
    expect(total.rejected).toEqual([
      { id: "2", reason: "not_a_run" },
      { id: "3", reason: "outside_week" },
    ]);
    expect(total.incomplete).toEqual([{ id: "5", missing: "manual" }]);
  });

  it("counts an activity listed twice only once", () => {
    const total = weekTotal([run({ id: "7" }), run({ id: "7" })], WEEK, params);

    expect(total.totalM).toBe(10_000n);
    expect(total.countedIds).toEqual(["7"]);
  });

  it("is zero for a week with no activities", () => {
    expect(weekTotal([], WEEK, params)).toEqual({
      totalM: 0n,
      countedIds: [],
      rejected: [],
      incomplete: [],
    });
  });
});
