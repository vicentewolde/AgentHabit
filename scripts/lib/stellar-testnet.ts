import { AgentHabitError } from "@agenthabit/core";
import {
  Asset,
  BASE_FEE,
  Keypair,
  Operation,
  rpc,
  TransactionBuilder,
  xdr,
} from "@stellar/stellar-sdk";
import { z } from "zod";

import { STELLAR_TESTNET } from "./network.js";

/**
 * The Stellar testnet operations bootstrap needs, behind an interface so tests can run the
 * whole flow without a network. Every method is safe to repeat: the callers check before they
 * act, and nothing here ever prints.
 */
export interface StellarTestnet {
  /** Fails unless the RPC really serves testnet: bootstrap never touches another network. */
  assertTestnet(): Promise<void>;
  accountExists(address: string): Promise<boolean>;
  /** Creates the account with Friendbot's testnet XLM. */
  fund(address: string): Promise<void>;
  hasUsdcTrustline(address: string): Promise<boolean>;
  /** Signs and sends a `changeTrust` for testnet USDC; returns the transaction hash. */
  addUsdcTrustline(secret: string): Promise<string>;
}

const USDC = new Asset(STELLAR_TESTNET.usdc.code, STELLAR_TESTNET.usdc.issuer);

// Only the fields this file reads are validated; the SDK already decoded the XDR.
const NetworkResponse = z.object({ passphrase: z.string() });
const LedgerEntriesResponse = z.object({ entries: z.array(z.unknown()) });
const SendResponse = z.object({ status: z.string(), hash: z.string() });
const FinalResponse = z.object({ status: z.string() });

function networkError(action: string, cause: unknown): AgentHabitError {
  return new AgentHabitError("NetworkError", `Stellar testnet: could not ${action}`, {
    cause,
    details: { action },
  });
}

/** Runs one RPC step; any failure becomes a NetworkError naming the step, never a raw error. */
async function step<T>(action: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AgentHabitError) throw error;
    throw networkError(action, error);
  }
}

function accountKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.account(
    new xdr.LedgerKeyAccount({ accountId: Keypair.fromPublicKey(address).xdrAccountId() }),
  );
}

function usdcTrustlineKey(address: string): xdr.LedgerKey {
  return xdr.LedgerKey.trustline(
    new xdr.LedgerKeyTrustLine({
      accountId: Keypair.fromPublicKey(address).xdrAccountId(),
      asset: USDC.toTrustLineXDRObject(),
    }),
  );
}

export interface FundAndConfirmOptions {
  /** Sends the Friendbot request. Its answer is ignored: only the ledger is trusted. */
  readonly request: (signal: AbortSignal) => Promise<void>;
  readonly exists: () => Promise<boolean>;
  readonly attempts?: number;
  readonly intervalMs?: number;
  readonly requestTimeoutMs?: number;
}

/**
 * Asks Friendbot for testnet XLM and then waits until the account is on the ledger. Friendbot's
 * HTTP answer is not trusted either way: on 2026-10-15 it created accounts and then held the
 * connection open for about five minutes without answering, and the SDK's `fundAddress` reads
 * the transaction once, before the RPC has seen it. The ledger is the only source of truth.
 */
export async function fundAndConfirm(options: FundAndConfirmOptions): Promise<void> {
  const attempts = options.attempts ?? 45;
  const intervalMs = options.intervalMs ?? 2_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs ?? 90_000);
  // A failed or hung request is not an error by itself: the ledger check below decides.
  const pending = options.request(controller.signal).catch(() => undefined);

  try {
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (await options.exists()) return;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw networkError("see the Friendbot account on the ledger", undefined);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await pending;
  }
}

export function connectStellarTestnet(rpcUrl: string): StellarTestnet {
  const server = new rpc.Server(rpcUrl);

  const exists = (action: string, key: xdr.LedgerKey) =>
    step(action, async () => {
      const response = LedgerEntriesResponse.parse(await server.getLedgerEntries(key));
      return response.entries.length > 0;
    });

  return {
    assertTestnet: () =>
      step("read the network", async () => {
        const { passphrase } = NetworkResponse.parse(await server.getNetwork());
        if (passphrase !== STELLAR_TESTNET.networkPassphrase) {
          throw new AgentHabitError("ConfigError", "STELLAR_RPC_URL does not serve testnet", {
            details: { variable: "STELLAR_RPC_URL" },
          });
        }
      }),

    accountExists: (address) => exists("look up an account", accountKey(address)),

    fund: (address) =>
      step("fund an account with Friendbot", () =>
        fundAndConfirm({
          request: async (signal) => {
            const url = `${STELLAR_TESTNET.friendbotUrl}?addr=${encodeURIComponent(address)}`;
            await fetch(url, { signal });
          },
          exists: () => exists("look up an account", accountKey(address)),
        }),
      ),

    hasUsdcTrustline: (address) => exists("look up a trustline", usdcTrustlineKey(address)),

    addUsdcTrustline: (secret) =>
      step("create the USDC trustline", async () => {
        const signer = Keypair.fromSecret(secret);
        const account = await server.getAccount(signer.publicKey());
        const transaction = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase: STELLAR_TESTNET.networkPassphrase,
        })
          .addOperation(Operation.changeTrust({ asset: USDC }))
          .setTimeout(60)
          .build();
        transaction.sign(signer);

        const sent = SendResponse.parse(await server.sendTransaction(transaction));
        if (sent.status !== "PENDING") {
          throw networkError(`submit the trustline (status ${sent.status})`, undefined);
        }
        const final = FinalResponse.parse(
          await server.pollTransaction(sent.hash, { attempts: 30 }),
        );
        if (final.status !== "SUCCESS") {
          throw networkError(`confirm the trustline (status ${final.status})`, undefined);
        }
        return sent.hash;
      }),
  };
}
