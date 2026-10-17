import type { SignedLinkMessage } from "@agenthabit/core";
import { getAddress, isAddress, isHex, verifyMessage } from "viem";

/**
 * Verifies an EIP-191 `personal_sign` signature (docs/integraciones/firmas.md, 4.2), as Core and
 * MetaMask produce it for an EIP-4361 message. Externally owned accounts only: viem's standalone
 * `verifyMessage` recovers the signer offline and does not cover contract wallets (ERC-1271),
 * which the MVP does not accept.
 *
 * Returns false for anything that is not a valid signature by `address`, malformed input
 * included: a bad signature is an answer, not an error.
 */
export async function verifyEvmLinkSignature(signed: SignedLinkMessage): Promise<boolean> {
  if (!isAddress(signed.address, { strict: false })) return false;
  // 65 bytes: r ‖ s ‖ v.
  if (!isHex(signed.signature) || signed.signature.length !== 2 + 65 * 2) return false;
  try {
    return await verifyMessage({
      address: signed.address,
      message: signed.message,
      signature: signed.signature,
    });
  } catch {
    return false;
  }
}

/**
 * An EVM address in EIP-55 checksum form, as EIP-4361 requires in the message and the link
 * stores it, or null if it is not an address. A wallet may report it in lowercase.
 */
export function normalizeEvmAddress(address: string): `0x${string}` | null {
  return isAddress(address, { strict: false }) ? getAddress(address) : null;
}
