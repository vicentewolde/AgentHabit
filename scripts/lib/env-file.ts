import { chmod, readFile, rename, rm, writeFile } from "node:fs/promises";

import { AgentHabitError } from "@agenthabit/core";

/**
 * A deliberately small `.env` reader/writer, adapted from AgentPey. The format is ours: one
 * `KEY=value` per line, `#` comments, no interpolation. Editing keeps every other line exactly
 * as it was, so the user's comments and values survive any number of bootstrap runs.
 */

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/;

function unquote(raw: string): string {
  const value = raw.trim();
  const first = value[0];
  const quoted =
    value.length >= 2 && (first === '"' || first === "'") && value[value.length - 1] === first;
  return quoted ? value.slice(1, -1) : value;
}

/**
 * A variable defined twice is rejected, not resolved: with `KEY=real` above a pasted `KEY=`,
 * "last one wins" would read the key as unset, and filling it in would overwrite the real one.
 */
export function parseEnv(contents: string): Map<string, string> {
  const entries = new Map<string, string>();
  for (const line of contents.split("\n")) {
    const match = LINE.exec(line);
    if (match === null || line.trim().startsWith("#")) continue;
    const [, key, rawValue] = match;
    if (key === undefined || rawValue === undefined) continue;
    if (entries.has(key)) {
      throw new AgentHabitError("ConfigError", `${key} is defined more than once; keep one line`, {
        details: { key },
      });
    }
    entries.set(key, unquote(rawValue));
  }
  return entries;
}

/**
 * Sets each key in `values` that is missing or empty: an empty `KEY=` line is filled in place,
 * a missing key is appended. A key that already holds a value is never replaced; asking to do
 * so is a bug in the caller and stops with `ConfigError` (naming the key, never a value).
 */
export function fillEnvValues(contents: string, values: ReadonlyMap<string, string>): string {
  const existing = parseEnv(contents);
  for (const key of values.keys()) {
    if ((existing.get(key) ?? "") !== "") {
      throw new AgentHabitError("ConfigError", `refusing to replace ${key}, which is already set`, {
        details: { key },
      });
    }
  }

  const pending = new Map(values);
  const lines = contents.split("\n").map((line) => {
    const key = LINE.exec(line)?.[1];
    if (key === undefined || line.trim().startsWith("#")) return line;
    const value = pending.get(key);
    if (value === undefined) return line;
    pending.delete(key);
    return `${key}=${value}`;
  });

  if (pending.size === 0) return lines.join("\n");

  const body = lines.join("\n");
  const separator = body === "" || body.endsWith("\n") ? "" : "\n";
  const appended = [...pending].map(([key, value]) => `${key}=${value}\n`).join("");
  return `${body}${separator}${appended}`;
}

/** The file's contents, or `undefined` when it does not exist. Anything else is a ConfigError. */
export async function readEnvFile(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw new AgentHabitError("ConfigError", `could not read ${path}`, {
      cause: error,
      details: { path },
    });
  }
}

/**
 * Writes owner-only (0600) through a temporary file and a rename, so an interrupted run never
 * leaves a half-written file of keys behind. A failed write removes its temporary copy: a stray
 * file of keys is a leak waiting to happen, even a git-ignored one.
 */
export async function writeEnvFile(path: string, contents: string): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    // `flag: "wx"` refuses a leftover file, which could carry looser permissions than 0600.
    await writeFile(temporary, contents, { mode: 0o600, flag: "wx" });
    await rename(temporary, path);
    await chmod(path, 0o600);
  } catch (error) {
    await rm(temporary, { force: true });
    throw new AgentHabitError("ConfigError", `could not write ${path}`, {
      cause: error,
      details: { path },
    });
  }
}
