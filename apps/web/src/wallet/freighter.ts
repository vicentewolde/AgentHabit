import { FREIGHTER_ID, FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk";
import { Networks } from "@creit.tech/stellar-wallets-kit/types";
import { WalletError, type WalletPort } from "./port.js";
import { normalizeSignature } from "./signature.js";

/**
 * Freighter through the wallets kit, bundled with the app (P-7: no CDN). The kit's own modal is
 * not used: it loads wallet icons from a third-party host, and this app talks to one wallet only.
 * The kit still resolves the wallet, so another module can be added later.
 */

let initialized = false;

function ensureKit(): void {
  if (initialized) return;
  StellarWalletsKit.init({
    modules: [new FreighterModule()],
    selectedWalletId: FREIGHTER_ID,
    network: Networks.TESTNET,
  });
  initialized = true;
}

/** The kit rejects with plain `{ code, message }` objects, not `Error`s. */
function describe(error: unknown): { code: number | undefined; message: string } {
  if (typeof error === "object" && error !== null) {
    const code = "code" in error && typeof error.code === "number" ? error.code : undefined;
    const message = "message" in error && typeof error.message === "string" ? error.message : "";
    return { code, message };
  }
  return { code: undefined, message: typeof error === "string" ? error : "" };
}

function toWalletError(error: unknown): WalletError {
  if (error instanceof WalletError) return error;
  const { message } = describe(error);
  if (/not connected|not installed|not available/i.test(message)) {
    return new WalletError("WalletUnavailable", message, { cause: error });
  }
  if (/reject|denied|declin|cancel/i.test(message)) {
    return new WalletError("WalletRejected", message, { cause: error });
  }
  return new WalletError("WalletFailed", message || "Unhandled error from the wallet", {
    cause: error,
  });
}

export function createFreighterWallet(): WalletPort {
  return {
    async connect() {
      try {
        ensureKit();
        const { address } = await StellarWalletsKit.fetchAddress();
        return address;
      } catch (error) {
        throw toWalletError(error);
      }
    },

    async signMessage(message, address) {
      try {
        ensureKit();
        const result = await StellarWalletsKit.signMessage(message, { address });
        // The signer must be the account we are linking: Freighter signs with its active account,
        // which the user may have switched since connecting.
        if (result.signerAddress !== undefined && result.signerAddress !== address) {
          throw new WalletError(
            "WalletFailed",
            "Freighter signed with a different account than the one connected",
          );
        }
        return normalizeSignature(result.signedMessage);
      } catch (error) {
        throw toWalletError(error);
      }
    },

    async signTransaction(xdr, networkPassphrase, address) {
      try {
        ensureKit();
        const result = await StellarWalletsKit.signTransaction(xdr, { networkPassphrase, address });
        if (typeof result.signedTxXdr !== "string" || result.signedTxXdr === "") {
          throw new WalletError("WalletFailed", "The wallet returned no signed transaction");
        }
        return result.signedTxXdr;
      } catch (error) {
        throw toWalletError(error);
      }
    },
  };
}
