import { Keypair } from "@stellar/stellar-sdk";
import { describe, expect, it } from "vitest";

import { verifyStellarLinkSignature } from "../src/link-signature.js";

// SEP-53's own public test vectors (docs/integraciones/firmas.md, 5.3): a test key of the
// standard, not of the project.
const SEP53_ADDRESS = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
const VECTORS = [
  {
    message: "Hello, World!",
    signature:
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
  },
  {
    message: "こんにちは、世界！",
    signature:
      "CDU265Xs8y3OWbB/56H9jPgUss5G9A0qFuTqH2zs2YDgTm+++dIfmAEceFqB7bhfN3am59lCtDXrCtwH2k1GBA==",
  },
];

describe("verifyStellarLinkSignature", () => {
  it("accepts SEP-53's official vectors, multibyte UTF-8 included", () => {
    for (const vector of VECTORS) {
      expect(
        verifyStellarLinkSignature({ address: SEP53_ADDRESS, ...vector }),
        vector.message,
      ).toBe(true);
    }
  });

  it("accepts a signature made with signMessage, the way Freighter signs", () => {
    const keypair = Keypair.random();
    const message = "localhost:5173 wants you to sign in with your Stellar account:\nñandú";
    const signature = Buffer.from(keypair.signMessage(message)).toString("base64");

    expect(verifyStellarLinkSignature({ address: keypair.publicKey(), message, signature })).toBe(
      true,
    );
  });

  it("refuses a signature by someone else", () => {
    const other = Keypair.random().publicKey();
    const [vector] = VECTORS;
    if (vector === undefined) throw new TypeError("no SEP-53 vector");
    expect(verifyStellarLinkSignature({ address: other, ...vector })).toBe(false);
  });

  it("refuses a valid signature over a different message", () => {
    const signature = VECTORS[0]?.signature ?? "";
    expect(
      verifyStellarLinkSignature({ address: SEP53_ADDRESS, message: "Hello, World?", signature }),
    ).toBe(false);
  });

  it("refuses a raw ed25519 signature without the SEP-53 prefix", () => {
    const keypair = Keypair.random();
    const message = "Hello, World!";
    const raw = Buffer.from(keypair.sign(Buffer.from(message))).toString("base64");

    expect(
      verifyStellarLinkSignature({ address: keypair.publicKey(), message, signature: raw }),
    ).toBe(false);
  });

  it("refuses malformed input instead of throwing", () => {
    const message = "Hello, World!";
    for (const signed of [
      { address: "not-a-key", message, signature: VECTORS[0]?.signature ?? "" },
      { address: SEP53_ADDRESS, message, signature: "" },
      { address: SEP53_ADDRESS, message, signature: "!!not base64!!" },
      { address: SEP53_ADDRESS, message, signature: Buffer.alloc(32).toString("base64") },
    ]) {
      expect(verifyStellarLinkSignature(signed)).toBe(false);
    }
  });
});
