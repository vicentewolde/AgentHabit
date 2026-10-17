import { describe, expect, it } from "vitest";

import { buildLinkMessage } from "./link-message.js";

const base = {
  domain: "localhost:5173",
  uri: "http://localhost:5173",
  nonce: "a1b2c3d4e5f6",
  issuedAt: new Date("2026-10-17T12:00:00.000Z"),
  expiresAt: new Date("2026-10-17T12:05:00.000Z"),
};

describe("buildLinkMessage", () => {
  it("uses the EIP-4361 layout on Avalanche, with Fuji's chain id", () => {
    const message = buildLinkMessage({
      ...base,
      chain: "avalanche",
      address: "0x5425890298aed601595a70AB815c96711a31Bc65",
    });

    expect(message).toBe(
      [
        "localhost:5173 wants you to sign in with your Ethereum account:",
        "0x5425890298aed601595a70AB815c96711a31Bc65",
        "",
        "Link this wallet to a Strava account on AgentHabit. This does not move funds.",
        "",
        "URI: http://localhost:5173",
        "Version: 1",
        "Chain ID: 43113",
        "Nonce: a1b2c3d4e5f6",
        "Issued At: 2026-10-17T12:00:00.000Z",
        "Expiration Time: 2026-10-17T12:05:00.000Z",
      ].join("\n"),
    );
  });

  it("uses the same layout on Stellar, naming the network instead of a chain id", () => {
    const message = buildLinkMessage({
      ...base,
      chain: "stellar",
      address: "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L",
    });

    expect(message.split("\n")[0]).toBe(
      "localhost:5173 wants you to sign in with your Stellar account:",
    );
    expect(message).toContain("\nNetwork: Stellar Testnet\n");
  });

  it("uses only \\n and leaves no trailing spaces", () => {
    const message = buildLinkMessage({ ...base, chain: "stellar", address: "GABC" });

    expect(message).not.toContain("\r");
    for (const line of message.split("\n")) expect(line).toBe(line.trimEnd());
  });
});
