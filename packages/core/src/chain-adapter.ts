import type { ChainId, ContractParams } from "./limits.js";

/**
 * The pure types of the `ChainAdapter` interface (spec 4.7). `chain-stellar` and
 * `chain-avalanche` implement it; nothing above the adapters knows which chain it talks to.
 * Amounts are `bigint` in the token's smallest unit of that chain.
 */

/** A position's lifecycle. `None` means it does not exist; the last three are final. */
export const POSITION_STATES = [
  "None",
  "Active",
  "Returned",
  "Forfeited",
  "ReleasedStale",
] as const;
export type PositionState = (typeof POSITION_STATES)[number];

export interface Position {
  readonly state: PositionState;
  readonly amount: bigint;
  readonly goalM: bigint;
}

/** What `config` returns: the immutable constructor arguments. */
export interface ContractConfig extends ContractParams {
  readonly token: string;
  readonly oracle: string;
}

/** A transaction built for a wallet to sign, serialized in the chain's own format. */
export interface PreparedTransaction {
  readonly chain: ChainId;
  readonly label: "approve" | "commit" | "release_if_stale";
  readonly encoded: string;
}

export interface SubmittedTransaction {
  readonly chain: ChainId;
  readonly hash: string;
}

/**
 * The oracle's signing key, handed to an adapter only in `live` mode (A-7). Each adapter defines
 * its own concrete signer; this is the part every caller may see.
 */
export interface ChainSigner {
  readonly chain: ChainId;
  readonly address: string;
}

export interface CommitInput {
  readonly user: string;
  readonly weekId: bigint;
  readonly amount: bigint;
  readonly goalM: bigint;
}

export interface PositionRef {
  readonly user: string;
  readonly weekId: bigint;
}

export interface SettleInput extends PositionRef {
  readonly met: boolean;
}

export interface SignedLinkMessage {
  readonly address: string;
  readonly message: string;
  readonly signature: string;
}

export interface ChainAdapter {
  readonly chain: ChainId;

  config(): Promise<ContractConfig>;
  currentWeek(): Promise<bigint>;
  getPosition(ref: PositionRef): Promise<Position>;
  totalForfeited(): Promise<bigint>;

  /** On Avalanche this is the `approve` followed by the `commit`; on Stellar, the `commit`. */
  buildCommit(input: CommitInput): Promise<readonly PreparedTransaction[]>;
  buildReleaseIfStale(caller: string, ref: PositionRef): Promise<PreparedTransaction>;

  settle(signer: ChainSigner, input: SettleInput): Promise<SubmittedTransaction>;
  releaseIfStale(signer: ChainSigner, ref: PositionRef): Promise<SubmittedTransaction>;

  /** Verifies the wallet ↔ athlete link message (spec 4.4). */
  verifyLinkSignature(signed: SignedLinkMessage): Promise<boolean>;
}
