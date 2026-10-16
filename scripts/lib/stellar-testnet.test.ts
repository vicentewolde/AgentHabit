import { hasErrorCode } from "@agenthabit/core";
import { describe, expect, it } from "vitest";

import { fundAndConfirm } from "./stellar-testnet.js";

/** A request that never answers until aborted, like Friendbot on 2026-10-15. */
const hangingRequest = (signal: AbortSignal) =>
  new Promise<void>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });

describe("fundAndConfirm", () => {
  it("succeeds once the account is on the ledger, even if Friendbot never answers", async () => {
    let checks = 0;

    await fundAndConfirm({
      request: hangingRequest,
      exists: async () => ++checks >= 3,
      intervalMs: 1,
    });

    expect(checks).toBe(3);
  });

  it("succeeds when Friendbot fails but the account was created anyway", async () => {
    await expect(
      fundAndConfirm({
        request: async () => {
          throw new Error("socket hang up");
        },
        exists: async () => true,
        intervalMs: 1,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails with NetworkError when the account never appears", async () => {
    await expect(
      fundAndConfirm({
        request: async () => undefined,
        exists: async () => false,
        attempts: 3,
        intervalMs: 1,
      }),
    ).rejects.toSatisfy((error) => hasErrorCode(error, "NetworkError"));
  });
});
