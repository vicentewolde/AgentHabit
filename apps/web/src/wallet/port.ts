/**
 * What the app needs from a wallet, so the UI and the flows do not depend on the kit and tests
 * can use a fake. Freighter through `@creit.tech/stellar-wallets-kit` is the only implementation
 * (P-7, A-22).
 */
export interface WalletPort {
  /** Asks the wallet for the active account; opens its permission prompt the first time. */
  connect(): Promise<string>;
  /**
   * SEP-53 message signature of `message` exactly as given, base64 (64 bytes). Rejects with a
   * `WalletError` when the user declines or the wallet answers something else.
   */
  signMessage(message: string, address: string): Promise<string>;
  /** Signs a transaction envelope (base64 XDR) for `networkPassphrase`; returns the signed XDR. */
  signTransaction(xdr: string, networkPassphrase: string, address: string): Promise<string>;
}

export type WalletErrorCode = "WalletUnavailable" | "WalletRejected" | "WalletFailed";

/** A wallet failure with a code the UI can turn into a sentence. */
export class WalletError extends Error {
  override readonly name = "WalletError";
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }
}

export function isWalletError(value: unknown): value is WalletError {
  return value instanceof WalletError;
}
