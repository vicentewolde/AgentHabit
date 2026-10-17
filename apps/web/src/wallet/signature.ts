import { WalletError } from "./port.js";

const BASE64_64_BYTES = /^[A-Za-z0-9+/]{86}==$/;
const HEX_64_BYTES = /^[0-9a-fA-F]{128}$/;

function hexToBase64(hex: string): string {
  let binary = "";
  for (let i = 0; i < hex.length; i += 2) {
    binary += String.fromCharCode(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return btoa(binary);
}

/**
 * The API expects an ed25519 signature as base64 of exactly 64 bytes (SEP-53, firmas.md 5.2).
 * Freighter returns base64, but the kit's changelog records that older versions answered in
 * another shape, so a hex signature is converted rather than refused. Anything else is a wallet
 * we do not understand: better to stop here than to send a signature the API will reject.
 */
export function normalizeSignature(signed: unknown): string {
  if (typeof signed !== "string") {
    throw new WalletError("WalletFailed", "The wallet returned a signature that is not text");
  }
  const text = signed.trim();
  if (BASE64_64_BYTES.test(text)) return text;
  if (HEX_64_BYTES.test(text)) return hexToBase64(text);
  throw new WalletError("WalletFailed", "The wallet returned a signature in an unknown format");
}
