import { describe, expect, it } from "vitest";

import {
  BuildCommitRequestSchema,
  BuildReleaseRequestSchema,
  DecimalStringSchema,
  PositionViewSchema,
  ReportPositionRequestSchema,
  SubmitTxResponseSchema,
  WeekViewSchema,
} from "./api-contract.js";

describe("the API contract", () => {
  it("keeps amounts as decimal strings: an i128 does not fit a JS number", () => {
    expect(DecimalStringSchema.safeParse("500000000").success).toBe(true);
    expect(DecimalStringSchema.safeParse(500000000).success).toBe(false);
    expect(DecimalStringSchema.safeParse("-1").success).toBe(false);
    expect(DecimalStringSchema.safeParse("1.5").success).toBe(false);
  });

  it("accepts a week with no position and no Strava reading", () => {
    const week = {
      weekId: "3",
      startsAt: "2026-10-26T03:00:00.000Z",
      endsAt: "2026-11-02T03:00:00.000Z",
      settleOpensAt: "2026-11-04T03:00:00.000Z",
      releaseOpensAt: "2026-11-09T03:00:00.000Z",
      position: null,
      totalM: null,
      readAt: null,
    };

    expect(WeekViewSchema.parse(week).position).toBeNull();
  });

  it("refuses a negative distance and an unknown position state", () => {
    expect(
      PositionViewSchema.safeParse({ state: "Lost", amount: "1", goalM: 1, commitTxHash: "x" })
        .success,
    ).toBe(false);
    expect(BuildCommitRequestSchema.safeParse({ amount: "200000000", goalM: -5 }).success).toBe(
      false,
    );
  });

  it("knows a transaction can still be pending after the wait", () => {
    expect(SubmitTxResponseSchema.parse({ txHash: "ab", status: "PENDING" }).status).toBe(
      "PENDING",
    );
  });
});

describe("the numbers a request may carry", () => {
  it("refuses a week id or an amount the contract could not hold, before the SDK sees it", () => {
    expect(BuildReleaseRequestSchema.safeParse({ weekId: "18446744073709551615" }).success).toBe(
      true,
    );
    expect(BuildReleaseRequestSchema.safeParse({ weekId: "18446744073709551616" }).success).toBe(
      false,
    );
    expect(
      BuildCommitRequestSchema.safeParse({
        amount: "170141183460469231731687303715884105727",
        goalM: 1,
      }).success,
    ).toBe(true);
    expect(
      BuildCommitRequestSchema.safeParse({
        amount: "170141183460469231731687303715884105728",
        goalM: 1,
      }).success,
    ).toBe(false);
    expect(
      ReportPositionRequestSchema.safeParse({
        chain: "stellar",
        contract: "C",
        weekId: "99999999999999999999999",
        txHash: "ab".repeat(32),
      }).success,
    ).toBe(false);
  });

  it("refuses a goal beyond a safe integer", () => {
    expect(BuildCommitRequestSchema.safeParse({ amount: "1", goalM: 2 ** 60 }).success).toBe(false);
  });
});
