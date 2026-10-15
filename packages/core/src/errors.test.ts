import { describe, expect, it } from "vitest";
import { AgentHabitError, hasErrorCode, isAgentHabitError } from "./errors.js";

describe("AgentHabitError", () => {
  it("carries its code, message, details and cause", () => {
    const cause = new Error("underlying");
    const error = new AgentHabitError("ConfigError", "SETTLE_MODE is invalid", {
      cause,
      details: { variable: "SETTLE_MODE" },
    });

    expect(error.name).toBe("AgentHabitError");
    expect(error.code).toBe("ConfigError");
    expect(error.message).toBe("SETTLE_MODE is invalid");
    expect(error.details).toEqual({ variable: "SETTLE_MODE" });
    expect(error.cause).toBe(cause);
  });

  it("defaults to empty details and no cause", () => {
    const error = new AgentHabitError("ConfigError", "missing");

    expect(error.details).toEqual({});
    expect(error.cause).toBeUndefined();
  });
});

describe("hasErrorCode", () => {
  it("recognises an AgentHabitError with the expected code", () => {
    expect(hasErrorCode(new AgentHabitError("ConfigError", "x"), "ConfigError")).toBe(true);
  });

  it("rejects a generic error, even one with a matching code property", () => {
    const impostor = Object.assign(new Error("x"), { code: "ConfigError" });

    expect(hasErrorCode(impostor, "ConfigError")).toBe(false);
    expect(hasErrorCode("ConfigError", "ConfigError")).toBe(false);
    expect(hasErrorCode(undefined, "ConfigError")).toBe(false);
  });

  it("recognises an AgentHabitError from a second copy of the class", () => {
    const fromOtherCopy = Object.assign(new Error("x"), {
      name: "AgentHabitError",
      code: "ConfigError",
      details: {},
    });

    expect(isAgentHabitError(fromOtherCopy)).toBe(true);
    expect(hasErrorCode(fromOtherCopy, "ConfigError")).toBe(true);
  });
});
