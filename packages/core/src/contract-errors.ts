/**
 * The contracts' own errors, by name (spec 4.3). Solidity identifies custom errors by selector;
 * Soroban's `#[contracterror]` needs a number, and this table fixes it. Both contracts' tests
 * check their errors against the exported fixture.
 *
 * The numbers start at 101 (A-12): a Stellar Asset Contract error (codes 1 to 13) propagates
 * through `commit`, `settle` and `release_if_stale` with its own number, and must never read as
 * one of ours. With 1 to 11, the SAC's `BalanceDeauthorizedError` (11) read as `BalanceMismatch`.
 */
export const CONTRACT_ERRORS = [
  { code: 101, name: "BeforeAnchor" },
  { code: 102, name: "InvalidConfig" },
  { code: 103, name: "AlreadyCommitted" },
  { code: 104, name: "PositionNotFound" },
  { code: 105, name: "PositionNotActive" },
  { code: 106, name: "WrongWeek" },
  { code: 107, name: "OutsideSettleWindow" },
  { code: 108, name: "NotStaleYet" },
  { code: 109, name: "AmountOutOfRange" },
  { code: 110, name: "GoalOutOfRange" },
  { code: 111, name: "BalanceMismatch" },
] as const;

export type ContractErrorName = (typeof CONTRACT_ERRORS)[number]["name"];

/**
 * Failures that do not come from the contract's own error enum, in two categories each runner
 * translates to its chain: `Unauthorized` (Soroban's host `require_auth`, or the EVM contract's
 * own error) and `TokenFailure` (an SAC error, or a revert bubbled up through `SafeERC20`).
 */
export const FOREIGN_FAILURES = ["TokenFailure", "Unauthorized"] as const;

export type ForeignFailure = (typeof FOREIGN_FAILURES)[number];

export type ExpectedFailure = ContractErrorName | ForeignFailure;
