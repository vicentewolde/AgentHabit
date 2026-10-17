import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { verifyEvmLinkSignature } from "../src/link-signature.js";

// A key generated for each run, signed locally with no network (firmas.md, 5.3).
const account = privateKeyToAccount(generatePrivateKey());
const other = privateKeyToAccount(generatePrivateKey());
const message = "localhost:5173 wants you to sign in with your Ethereum account:\nPeñalolén, ñandú";

describe("verifyEvmLinkSignature", () => {
  it("accepts a personal_sign signature by the address, multibyte UTF-8 included", async () => {
    const signature = await account.signMessage({ message });

    expect(await verifyEvmLinkSignature({ address: account.address, message, signature })).toBe(
      true,
    );
    // The address may arrive in lowercase from a wallet.
    expect(
      await verifyEvmLinkSignature({ address: account.address.toLowerCase(), message, signature }),
    ).toBe(true);
  });

  it("refuses a signature by someone else, or over another message", async () => {
    const signature = await other.signMessage({ message });
    const own = await account.signMessage({ message });

    expect(await verifyEvmLinkSignature({ address: account.address, message, signature })).toBe(
      false,
    );
    expect(
      await verifyEvmLinkSignature({
        address: account.address,
        message: `${message}!`,
        signature: own,
      }),
    ).toBe(false);
  });

  it("refuses malformed input instead of throwing", async () => {
    const signature = await account.signMessage({ message });
    for (const signed of [
      { address: "0x123", message, signature },
      { address: account.address, message, signature: "0x" },
      { address: account.address, message, signature: signature.slice(0, -2) },
      { address: account.address, message, signature: `0x${"zz".repeat(65)}` },
    ]) {
      expect(await verifyEvmLinkSignature(signed)).toBe(false);
    }
  });
});
