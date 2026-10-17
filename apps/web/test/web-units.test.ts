import { describe, expect, it } from "vitest";
import { mockInstance } from "../dev/mock-app.js";
import { assertStellarUsdc, formatUsdc } from "../src/amounts.js";
import { parseApiUrl } from "../src/api-url.js";
import { isAllowedStravaUrl } from "../src/components/StravaCard.js";
import { isWebError } from "../src/errors.js";
import { formatMoment } from "../src/time.js";

describe("VITE_API_URL", () => {
  it("defaults to localhost only outside production", () => {
    expect(parseApiUrl(undefined, false)).toBe("http://localhost:3000");
    expect(parseApiUrl("http://localhost:3000/", false)).toBe("http://localhost:3000");
  });

  it("fails a production build that has no URL or a non-https one", () => {
    for (const raw of [undefined, "", "http://api.example.com", "ftp://x", "not a url"]) {
      const failure = (() => {
        try {
          return parseApiUrl(raw, true);
        } catch (error) {
          return error;
        }
      })();
      expect(isWebError(failure) && failure.code === "WebConfig", String(raw)).toBe(true);
    }
    expect(parseApiUrl("https://api.example.com/", true)).toBe("https://api.example.com");
  });

  it("refuses a malformed URL in development too, instead of falling back silently", () => {
    expect(() => parseApiUrl("::::", false)).toThrow();
  });
});

describe("Strava redirect allow-list", () => {
  const web = "http://localhost:5173";
  it("allows Strava over https and the web's own callback", () => {
    expect(isAllowedStravaUrl("https://www.strava.com/oauth/authorize?client_id=1", web)).toBe(
      true,
    );
    expect(isAllowedStravaUrl(`${web}/strava/callback?code=x`, web)).toBe(true);
  });

  it("refuses everything else", () => {
    for (const bad of [
      "http://www.strava.com/oauth/authorize",
      "https://strava.com/oauth/authorize",
      "https://www.strava.com.evil.example/oauth/authorize",
      "https://evil.example/strava/callback",
      `${web}/other`,
      "javascript:alert(1)",
      "not a url",
    ]) {
      expect(isAllowedStravaUrl(bad, web), bad).toBe(false);
    }
  });
});

describe("amounts and dates on screen", () => {
  it("never truncates an amount", () => {
    expect(formatUsdc(200_000_001n)).toBe("20,0000001");
    expect(formatUsdc(205_000_000n)).toBe("20,5");
    expect(formatUsdc(201_230_000n)).toBe("20,123");
  });

  it("refuses an instance whose token does not have 7 decimals", () => {
    expect(assertStellarUsdc(mockInstance()).tokenDecimals).toBe(7);
    expect(() => assertStellarUsdc({ ...mockInstance(), tokenDecimals: 6 })).toThrow();
  });

  it("writes dates in UTC-3 and says so", () => {
    const text = formatMoment("2026-10-26T03:00:00.000Z");
    expect(text).toContain("26 de octubre");
    expect(text).toContain("00:00");
    expect(text).toContain("(UTC-3)");
  });
});
