import { randomBytes } from "node:crypto";

import { hasErrorCode } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { parseApiEnv } from "./api-env.js";

const SECRET = "synthetic-strava-client-secret";
const BASE = {
  DATABASE_URL:
    "postgresql://user:synthetic-password@ep-synthetic.neon.tech/agenthabit?sslmode=require",
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
  STRAVA_CLIENT_ID: "12345",
  STRAVA_CLIENT_SECRET: SECRET,
  STRAVA_REDIRECT_URI: "http://localhost:3000/auth/strava/callback",
};

function failure(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return "no error";
}

describe("parseApiEnv", () => {
  it("accepts the API settings and fills in the defaults", () => {
    const env = parseApiEnv(BASE);

    expect(env.STRAVA_API_BASE_URL).toBe("https://www.strava.com/api/v3");
    expect(env.WEB_ORIGIN).toBe("http://localhost:5173");
    expect(env.API_PORT).toBe(3000);
  });

  it("names the broken variables, never their values", () => {
    const error = failure(() =>
      parseApiEnv({
        ...BASE,
        TOKEN_ENCRYPTION_KEY: "too-short",
        STRAVA_CLIENT_SECRET: "",
        DATABASE_URL: "mysql://x",
      }),
    );

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    expect(String(error)).toContain("TOKEN_ENCRYPTION_KEY");
    expect(String(error)).toContain("STRAVA_CLIENT_SECRET");
    expect(String(error)).toContain("DATABASE_URL");
    expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(
      "synthetic-password",
    );
  });

  it("treats an empty line as unset", () => {
    expect(
      hasErrorCode(
        failure(() => parseApiEnv({ ...BASE, STRAVA_CLIENT_ID: "" })),
        "ConfigError",
      ),
    ).toBe(true);
    expect(parseApiEnv({ ...BASE, WEB_ORIGIN: "" }).WEB_ORIGIN).toBe("http://localhost:5173");
  });
});
