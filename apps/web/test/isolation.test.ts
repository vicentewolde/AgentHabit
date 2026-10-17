import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe("the app bundle stays clean", () => {
  const files = sourceFiles(join(import.meta.dirname, "..", "src")).filter((f) =>
    /\.(ts|tsx)$/.test(f),
  );

  it("never imports the dev mock, hono or the Stellar SDK", () => {
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/from\s+["'][^"']*\/dev\//);
      expect(text, file).not.toMatch(/from\s+["'](hono|@hono|@stellar\/stellar-sdk)/);
    }
  });

  it("loads nothing from a CDN or a font host", () => {
    for (const file of [...files, join(import.meta.dirname, "..", "index.html")]) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/https?:\/\/(fonts\.|cdn|unpkg|cdnjs|www\.google)/);
    }
  });

  it("does not log, and keeps localStorage to the public pending commit", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/console\.(log|info|debug|warn|error)/);
      // Only `pending.ts` may touch it: public chain data keyed by address, never the token.
      if (!file.endsWith("/pending.ts")) {
        expect(text, file).not.toMatch(/localStorage\s*[.[]/);
      }
    }
  });
});
