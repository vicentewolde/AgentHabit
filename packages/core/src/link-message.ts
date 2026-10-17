import type { ChainId } from "./limits.js";

/**
 * The text a wallet signs to link itself to a Strava athlete (spec 4.4, A-16). The API builds it,
 * stores it with the nonce, and later verifies the signature against the stored text, never
 * against one the web sends back, so no parser is needed.
 *
 * Avalanche uses the EIP-4361 (Sign-In with Ethereum) layout, which wallets check against the
 * page's origin. Stellar has no equivalent standard: it gets the same layout, adapted
 * (docs/integraciones/firmas.md, 5.4). Only `\n`, no trailing spaces, dates in UTC with `Z`.
 */
export interface LinkMessageInput {
  readonly chain: ChainId;
  /** The web's host, e.g. `localhost:5173` until T8 (A-6). */
  readonly domain: string;
  /** The web's origin, e.g. `http://localhost:5173`. */
  readonly uri: string;
  /** A Stellar `G…` key, or an EVM address in EIP-55 checksum form. */
  readonly address: string;
  /** At least 8 alphanumeric characters (EIP-4361). */
  readonly nonce: string;
  readonly issuedAt: Date;
  readonly expiresAt: Date;
}

export const LINK_STATEMENT =
  "Link this wallet to a Strava account on AgentHabit. This does not move funds.";

/** Avalanche Fuji's chain id (`eth_chainId` = 0xa869, spec 4.1). */
export const FUJI_CHAIN_ID = 43_113;

export function buildLinkMessage(input: LinkMessageInput): string {
  const account = input.chain === "avalanche" ? "Ethereum" : "Stellar";
  const network =
    input.chain === "avalanche" ? `Chain ID: ${FUJI_CHAIN_ID}` : "Network: Stellar Testnet";
  return [
    `${input.domain} wants you to sign in with your ${account} account:`,
    input.address,
    "",
    LINK_STATEMENT,
    "",
    `URI: ${input.uri}`,
    "Version: 1",
    network,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt.toISOString()}`,
    `Expiration Time: ${input.expiresAt.toISOString()}`,
  ].join("\n");
}
