import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { AgentHabitError } from "@agenthabit/core";

/**
 * Strava tokens at rest: AES-256-GCM with TOKEN_ENCRYPTION_KEY (spec 4.5). Each value gets a
 * fresh 12-byte IV, and the auth tag makes a tampered or wrongly-keyed value fail loudly instead
 * of decrypting to garbage. Format: `v1.<iv>.<tag>.<ciphertext>`, each part base64url.
 */
const VERSION = "v1";
const KEY_BYTES = 32;
const IV_BYTES = 12;

export type TokenKey = Buffer & { readonly __tokenKey: unique symbol };

/** TOKEN_ENCRYPTION_KEY is 32 random bytes in base64. Anything else is a config error. */
export function parseTokenKey(base64: string): TokenKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== KEY_BYTES || key.toString("base64") !== base64.trim()) {
    throw new AgentHabitError("ConfigError", "TOKEN_ENCRYPTION_KEY must be 32 bytes in base64", {
      details: { variable: "TOKEN_ENCRYPTION_KEY" },
    });
  }
  return key as TokenKey;
}

export function encryptToken(plaintext: string, key: TokenKey): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv, tag, ciphertext]
    .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
    .join(".");
}

export function decryptToken(sealed: string, key: TokenKey): string {
  const [version, iv, tag, ciphertext, ...rest] = sealed.split(".");
  if (
    version !== VERSION ||
    iv === undefined ||
    tag === undefined ||
    ciphertext === undefined ||
    rest.length > 0
  ) {
    throw new AgentHabitError("TokenDecryptFailed", "A stored token has an unknown format");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (cause) {
    // Never echo the value: it is a secret even when it fails to decrypt.
    throw new AgentHabitError(
      "TokenDecryptFailed",
      "A stored token does not decrypt with this key",
      {
        cause,
      },
    );
  }
}
