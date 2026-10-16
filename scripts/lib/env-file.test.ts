import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasErrorCode, isAgentHabitError } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { fillEnvValues, parseEnv, readEnvFile, writeEnvFile } from "./env-file.js";

function captureError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return expect.fail("expected the call to throw");
}

describe("parseEnv", () => {
  it("reads keys, skips comments and unquotes values", () => {
    const entries = parseEnv('# comment\nA=1\nexport B="two"\nC=\n  # D=4\n');

    expect([...entries]).toEqual([
      ["A", "1"],
      ["B", "two"],
      ["C", ""],
    ]);
  });

  it("rejects a variable defined twice, naming it without its values", () => {
    const error = captureError(() => parseEnv("A=real-value\nB=1\nA=\n"));

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toEqual({ key: "A" });
    expect(isAgentHabitError(error) && error.message).not.toContain("real-value");
  });
});

describe("fillEnvValues", () => {
  it("fills an empty line in place and keeps every other line as it was", () => {
    const before = "# keys\nA=\n# keep me\nB=kept\n";

    expect(fillEnvValues(before, new Map([["A", "new"]]))).toBe(
      "# keys\nA=new\n# keep me\nB=kept\n",
    );
  });

  it("appends a key that has no line yet", () => {
    expect(fillEnvValues("A=1\n", new Map([["B", "2"]]))).toBe("A=1\nB=2\n");
    expect(fillEnvValues("A=1", new Map([["B", "2"]]))).toBe("A=1\nB=2\n");
    expect(fillEnvValues("", new Map([["B", "2"]]))).toBe("B=2\n");
  });

  it("refuses to replace a key that already has a value, naming the key only", () => {
    const error = captureError(() => fillEnvValues("A=secret-value\n", new Map([["A", "other"]])));

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
    expect(isAgentHabitError(error) && error.details).toEqual({ key: "A" });
    expect(isAgentHabitError(error) && error.message).not.toContain("secret-value");
  });

  it("never overwrites a set key when a pasted empty duplicate follows it", () => {
    const error = captureError(() =>
      fillEnvValues("A=real-value\nA=\n", new Map([["A", "fresh-value"]])),
    );

    expect(hasErrorCode(error, "ConfigError")).toBe(true);
  });
});

describe("readEnvFile and writeEnvFile", () => {
  it("returns undefined for a file that does not exist", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthabit-env-"));

    expect(await readEnvFile(join(dir, "missing"))).toBeUndefined();
  });

  it("writes the file readable by its owner only", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthabit-env-"));
    const path = join(dir, ".env.local");
    await writeFile(path, "OLD=1\n", { mode: 0o644 });

    await writeEnvFile(path, "A=1\n");

    expect(await readFile(path, "utf8")).toBe("A=1\n");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("leaves no temporary copy of the keys behind when the write fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agenthabit-env-"));
    const path = join(dir, ".env.local");
    // A directory in the way makes the final rename fail after the temporary file exists.
    await mkdir(path);

    await expect(writeEnvFile(path, "A=1\n")).rejects.toSatisfy((error) =>
      hasErrorCode(error, "ConfigError"),
    );
    expect(await readdir(dir)).toEqual([".env.local"]);
  });
});
