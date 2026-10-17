import { Keypair, Networks, TransactionBuilder } from "@stellar/stellar-sdk";
import type { Hono } from "hono";
import { createMockApp, type MockOptions } from "../dev/mock-app.js";
import { WalletError, type WalletPort } from "../src/wallet/port.js";

// Under jsdom, vitest swaps the global `Uint8Array` for jsdom's own, and the Stellar SDK then
// refuses the Node `Buffer`s it builds itself (an `instanceof` across realms). Putting Node's
// constructor back is a test-only workaround; the browser has a single realm.
const NodeUint8Array = Object.getPrototypeOf(Buffer.prototype).constructor;
if (globalThis.Uint8Array !== NodeUint8Array) globalThis.Uint8Array = NodeUint8Array;

/** A wallet with a real ed25519 key: its SEP-53 signatures are checked by the mock API. */
export class FakeWallet implements WalletPort {
  readonly keypair = Keypair.random();
  readonly signedMessages: string[] = [];
  readonly signedXdrs: string[] = [];
  rejectNext = false;

  get address(): string {
    return this.keypair.publicKey();
  }

  async connect(): Promise<string> {
    return this.address;
  }

  async signMessage(message: string, address: string): Promise<string> {
    if (this.rejectNext) {
      this.rejectNext = false;
      throw new WalletError("WalletRejected", "The user rejected this request.");
    }
    if (address !== this.address) throw new WalletError("WalletFailed", "wrong account");
    this.signedMessages.push(message);
    return Buffer.from(this.keypair.signMessage(message)).toString("base64");
  }

  async signTransaction(xdr: string, networkPassphrase: string, address: string): Promise<string> {
    if (address !== this.address) throw new WalletError("WalletFailed", "wrong account");
    if (networkPassphrase !== Networks.TESTNET) throw new WalletError("WalletFailed", "network");
    this.signedXdrs.push(xdr);
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    tx.sign(this.keypair);
    return tx.toXDR();
  }
}

export interface Harness {
  readonly app: Hono;
  readonly wallet: FakeWallet;
  /** Every URL the web asked for, to prove no secret travels in one. */
  readonly requestedUrls: string[];
  readonly fetch: typeof fetch;
  /** Makes the next request whose URL ends with `suffix` fail like a dropped connection. */
  readonly dropNext: (suffix: string) => void;
}

export function makeHarness(options: MockOptions = {}): Harness {
  const app = createMockApp(options);
  const requestedUrls: string[] = [];
  const drops: string[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    requestedUrls.push(request.url);
    const dropAt = drops.findIndex((suffix) => request.url.endsWith(suffix));
    if (dropAt !== -1) {
      drops.splice(dropAt, 1);
      throw new TypeError("Failed to fetch");
    }
    return app.fetch(request);
  };
  return {
    app,
    wallet: new FakeWallet(),
    requestedUrls,
    fetch: fetchImpl,
    dropNext: (suffix) => {
      drops.push(suffix);
    },
  };
}

export const BASE_URL = "http://api.test";
