import { describe, expect, it } from "vitest";

import { isExhausted, parseReadLimit } from "../src/rate-limit.js";

describe("parseReadLimit", () => {
  it("reads the 15-minute and daily windows, whatever the header case", () => {
    const headers = new Headers({
      "X-Ratelimit-Limit": "200,2000",
      "x-READRATELIMIT-limit": "100,1000",
    });
    headers.set("X-ReadRateLimit-Usage", " 7, 42 ");

    expect(parseReadLimit(headers)).toEqual({
      shortLimit: 100,
      dailyLimit: 1000,
      shortUsage: 7,
      dailyUsage: 42,
    });
  });

  it("ignores missing or malformed headers", () => {
    expect(parseReadLimit(new Headers())).toBeNull();
    expect(
      parseReadLimit(
        new Headers({ "X-ReadRateLimit-Limit": "100", "X-ReadRateLimit-Usage": "1,1" }),
      ),
    ).toBeNull();
    expect(
      parseReadLimit(
        new Headers({ "X-ReadRateLimit-Limit": "a,b", "X-ReadRateLimit-Usage": "1,1" }),
      ),
    ).toBeNull();
  });
});

describe("isExhausted", () => {
  it("is true when either window is used up", () => {
    expect(isExhausted({ shortLimit: 100, dailyLimit: 1000, shortUsage: 99, dailyUsage: 10 })).toBe(
      false,
    );
    expect(
      isExhausted({ shortLimit: 100, dailyLimit: 1000, shortUsage: 100, dailyUsage: 10 }),
    ).toBe(true);
    expect(
      isExhausted({ shortLimit: 100, dailyLimit: 1000, shortUsage: 5, dailyUsage: 1000 }),
    ).toBe(true);
  });
});
