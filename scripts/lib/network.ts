/**
 * Testnet constants for Phase 1 (Stellar testnet and Avalanche Fuji). Each value was checked
 * against an official source on 2026-10-15; the source is next to it. Mainnet values arrive in
 * Phase 2, never here.
 */

export const STELLAR_TESTNET = {
  /** From `getNetwork` on the testnet RPC (2026-10-15). */
  networkPassphrase: "Test SDF Network ; September 2015",
  /** From `getNetwork` on the testnet RPC (2026-10-15). */
  friendbotUrl: "https://friendbot.stellar.org/",
  /** https://developers.circle.com/stablecoins/usdc-contract-addresses (2026-10-15). */
  usdc: {
    code: "USDC",
    issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    decimals: 7,
  },
} as const;

export const AVALANCHE_FUJI = {
  chainId: 43113,
  /** https://developers.circle.com/stablecoins/usdc-contract-addresses (2026-10-15). */
  usdc: {
    address: "0x5425890298aed601595a70AB815c96711a31Bc65",
    decimals: 6,
  },
} as const;

/** Faucets the user drives by hand: bootstrap only prints the addresses to paste. */
export const MANUAL_FAUCETS = {
  /** Circle public faucet: testnet USDC on Stellar testnet and Avalanche Fuji. */
  circleUsdc: "https://faucet.circle.com/",
  /** Test AVAX for gas on Fuji, as linked from Circle's Gateway quickstart (2026-10-15). */
  fujiAvax: "https://core.app/tools/testnet-faucet/",
} as const;
