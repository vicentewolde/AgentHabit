import { AgentHabitError } from "./errors.js";
import type { WeekParams } from "./week.js";

/** The two chains AgentHabit runs on, with the same behaviour (P-2). */
export type ChainId = "stellar" | "avalanche";

/** USDC decimals per chain: Stellar's SAC uses 7, Circle's FiatToken on Avalanche uses 6. */
export const USDC_DECIMALS: Readonly<Record<ChainId, number>> = { stellar: 7, avalanche: 6 };

/** Whole USDC to the token's smallest unit on `chain`, e.g. 20 → 200_000_000 on Stellar. */
export function usdcToUnits(wholeUsdc: bigint, chain: ChainId): bigint {
  return wholeUsdc * 10n ** BigInt(USDC_DECIMALS[chain]);
}

/** Everything a contract fixes at deployment except the token and oracle addresses. */
export interface ContractParams extends WeekParams {
  /** In the token's smallest unit. */
  readonly minAmount: bigint;
  readonly maxAmount: bigint;
  /** In metres. */
  readonly minGoalM: bigint;
  readonly maxGoalM: bigint;
}

/** The two instances deployed per chain (spec 4.2). */
export type InstanceKind = "production" | "rehearsal";

/** An instance's parameters, chain-neutral: amounts in whole USDC, no anchor yet (chosen at deploy). */
export interface InstanceTemplate {
  readonly kind: InstanceKind;
  readonly minAmountUsdc: bigint;
  readonly maxAmountUsdc: bigint;
  readonly minGoalM: bigint;
  readonly maxGoalM: bigint;
  readonly weekLen: bigint;
  readonly grace: bigint;
  readonly staleAfter: bigint;
}

const U64_MAX = 2n ** 64n - 1n;
const I128_MAX = 2n ** 127n - 1n;

const DAY = 86_400n;
const HOUR = 3_600n;

export const INSTANCES: Readonly<Record<InstanceKind, InstanceTemplate>> = {
  production: {
    kind: "production",
    minAmountUsdc: 20n,
    maxAmountUsdc: 50n,
    minGoalM: 10_000n,
    maxGoalM: 300_000n,
    weekLen: 7n * DAY,
    grace: 2n * DAY,
    staleAfter: 7n * DAY,
  },
  // One-hour weeks with real Strava runs, hence the 500 m minimum goal (A-11).
  rehearsal: {
    kind: "rehearsal",
    minAmountUsdc: 20n,
    maxAmountUsdc: 50n,
    minGoalM: 500n,
    maxGoalM: 300_000n,
    weekLen: HOUR,
    grace: 17n * 60n,
    staleAfter: HOUR,
  },
};

/** The concrete parameters of an instance on one chain, given its anchor. */
export function instanceParams(
  template: InstanceTemplate,
  chain: ChainId,
  weekAnchor: bigint,
): ContractParams {
  const params: ContractParams = {
    weekAnchor,
    weekLen: template.weekLen,
    grace: template.grace,
    staleAfter: template.staleAfter,
    minAmount: usdcToUnits(template.minAmountUsdc, chain),
    maxAmount: usdcToUnits(template.maxAmountUsdc, chain),
    minGoalM: template.minGoalM,
    maxGoalM: template.maxGoalM,
  };
  validateParams(params);
  return params;
}

/**
 * The constructor rules of spec 4.2, checked before anything is deployed:
 * `0 < min_amount ≤ max_amount`, `0 < min_goal_m ≤ max_goal_m`, `week_len > 0` and
 * `0 < grace < stale_after`.
 */
export function validateParams(params: ContractParams): void {
  const broken: string[] = [];
  if (!(0n < params.minAmount && params.minAmount <= params.maxAmount)) {
    broken.push("0 < minAmount <= maxAmount");
  }
  if (!(0n < params.minGoalM && params.minGoalM <= params.maxGoalM)) {
    broken.push("0 < minGoalM <= maxGoalM");
  }
  if (!(params.weekLen > 0n)) {
    broken.push("weekLen > 0");
  }
  if (!(0n < params.grace && params.grace < params.staleAfter)) {
    broken.push("0 < grace < staleAfter");
  }
  // Both contracts store times and goals as u64, and Soroban stores amounts as i128.
  for (const [name, value] of Object.entries({
    weekAnchor: params.weekAnchor,
    weekLen: params.weekLen,
    grace: params.grace,
    staleAfter: params.staleAfter,
    minGoalM: params.minGoalM,
    maxGoalM: params.maxGoalM,
  })) {
    if (value < 0n || value > U64_MAX) broken.push(`${name} fits in u64`);
  }
  for (const [name, value] of Object.entries({
    minAmount: params.minAmount,
    maxAmount: params.maxAmount,
  })) {
    if (value > I128_MAX) broken.push(`${name} fits in i128`);
  }
  if (broken.length > 0) {
    throw new AgentHabitError("InvalidConfig", "Contract parameters break the constructor rules", {
      details: { broken },
    });
  }
}
