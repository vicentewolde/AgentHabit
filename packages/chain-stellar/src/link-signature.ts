import type { SignedLinkMessage } from "@agenthabit/core";
import { Keypair, StrKey } from "@stellar/stellar-sdk";

const ED25519_SIGNATURE_BYTES = 64;

/**
 * Verifies a SEP-53 signed message (docs/integraciones/firmas.md, 4.1): ed25519 over
 * `SHA-256("Stellar Signed Message:\n" ‖ message)`. Freighter and stellar-wallets-kit return
 * the signature in base64. `Keypair#verify` checks a raw signature and would always say no
 * here; `verifyMessage` adds the prefix and the hash itself.
 *
 * Returns false for anything that is not a valid signature by `address`, malformed input
 * included: a bad signature is an answer, not an error.
 */
export function verifyStellarLinkSignature(signed: SignedLinkMessage): boolean {
  if (!StrKey.isValidEd25519PublicKey(signed.address)) return false;
  const signature = Buffer.from(signed.signature, "base64");
  // Buffer.from silently drops invalid base64; the round trip catches it.
  if (
    signature.length !== ED25519_SIGNATURE_BYTES ||
    signature.toString("base64") !== signed.signature
  ) {
    return false;
  }
  try {
    return Keypair.fromPublicKey(signed.address).verifyMessage(
      signed.message,
      new Uint8Array(signature),
    );
  } catch {
    return false;
  }
}

/** A Soroban contract address (`C…`), or null if it is not one. */
export function normalizeStellarContract(contract: string): string | null {
  return StrKey.isValidContract(contract) ? contract : null;
}

/** A Stellar account key (`G…`) as the link stores it, or null if it is not one. */
export function normalizeStellarAddress(address: string): string | null {
  return StrKey.isValidEd25519PublicKey(address) ? address : null;
}
