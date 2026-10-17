import { randomBytes } from "node:crypto";

import { hasErrorCode } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { decryptToken, encryptToken, parseTokenKey } from "../src/crypto.js";

const key = parseTokenKey(randomBytes(32).toString("base64"));
const otherKey = parseTokenKey(randomBytes(32).toString("base64"));
const SECRET = "synthetic-refresh-token-0123456789";

function failure(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return "no error";
}

describe("token encryption", () => {
  it("round-trips a token", () => {
    expect(decryptToken(encryptToken(SECRET, key), key)).toBe(SECRET);
  });

  it("never stores the plaintext, and encrypts the same token differently each time", () => {
    const first = encryptToken(SECRET, key);
    const second = encryptToken(SECRET, key);

    expect(first).not.toContain(SECRET);
    expect(first).not.toBe(second);
  });

  it("refuses a value sealed with another key, without echoing it", () => {
    const error = failure(() => decryptToken(encryptToken(SECRET, key), otherKey));

    expect(hasErrorCode(error, "TokenDecryptFailed")).toBe(true);
    expect(String(error)).not.toContain(SECRET);
  });

  it("refuses a tampered value", () => {
    const sealed = encryptToken(SECRET, key);
    const parts = sealed.split(".");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const tampered = [...parts.slice(0, 3), ciphertext.toString("base64url")].join(".");

    expect(
      hasErrorCode(
        failure(() => decryptToken(tampered, key)),
        "TokenDecryptFailed",
      ),
    ).toBe(true);
    expect(
      hasErrorCode(
        failure(() => decryptToken("plaintext", key)),
        "TokenDecryptFailed",
      ),
    ).toBe(true);
  });

  it("only accepts a key of exactly 32 bytes in base64", () => {
    for (const bad of ["", "short", randomBytes(16).toString("base64"), "!!!!"]) {
      expect(
        hasErrorCode(
          failure(() => parseTokenKey(bad)),
          "ConfigError",
        ),
        bad,
      ).toBe(true);
    }
  });
});
