import type { PositionState } from "./chain-adapter.js";
import { CONTRACT_ERRORS, type ExpectedFailure, FOREIGN_FAILURES } from "./contract-errors.js";
import { INSTANCES } from "./limits.js";

/**
 * The shared case table (spec 4.3, A-3): the contract both chains must honour. It is data;
 * `scripts/gen-cases.ts` exports it to `contracts/fixtures/cases.json`, which the Rust and
 * Foundry runners read. A difference between chains shows up as a test failing on one of them.
 *
 * Fixture format: flat, every value a decimal string (Foundry's JSON cheatcodes and serde read it
 * the same way), keys sorted when serialized, symbolic actors and amounts relative to the limits.
 */

/** Who signs or calls. `stranger` is anyone else, and may also own a position. */
export type Actor = "oracle" | "stranger" | "user";
export type Owner = "stranger" | "user";

/** Amounts relative to the limits; each runner scales them to its token's decimals. */
export type AmountRef = "above_max" | "below_min" | "max" | "mid" | "min" | "zero";

export type CaseAction =
  | "block"
  | "commit"
  | "current_week"
  | "release_if_stale"
  | "settle"
  | "unblock";

/**
 * One step: the input (time, actor, action and arguments) and the expected output. Unused
 * fields are empty strings so every step has the same shape.
 *
 * - `state` is the state of the position (`owner`, `week_id`) after the step.
 * - `owner_balance` is how the owner's token balance moved, by the position's amount.
 * - `forfeited` is how `total_forfeited` moved, by the position's amount.
 * - After every step, each runner also checks `balance(contract) = Σ Active + total_forfeited`.
 */
export interface CaseStep {
  readonly action: CaseAction;
  readonly actor: Actor;
  readonly amount: AmountRef | "";
  readonly error: ExpectedFailure | "";
  readonly forfeited: "increased" | "unchanged";
  readonly goal_m: string;
  readonly met: "false" | "true" | "";
  readonly owner: Owner;
  readonly owner_balance: "credited" | "debited" | "unchanged";
  readonly result: string;
  readonly state: PositionState;
  readonly time: string;
  readonly week_id: string;
}

export interface ContractCase {
  readonly name: string;
  readonly steps: readonly CaseStep[];
}

/** Constructor parameters with amounts in whole USDC, and the expected outcome. */
export interface ConstructorCase {
  readonly error: "InvalidConfig" | "";
  readonly grace: string;
  readonly max_amount_usdc: string;
  readonly max_goal_m: string;
  readonly min_amount_usdc: string;
  readonly min_goal_m: string;
  readonly name: string;
  readonly stale_after: string;
  readonly week_anchor: string;
  readonly week_len: string;
}

/**
 * The validation order of each function, the same on both chains, so two simultaneous faults
 * give the same error (spec 4.2). The table proves every adjacent pair.
 */
export const VALIDATION_ORDER = {
  commit: [
    "BeforeAnchor",
    "Unauthorized",
    "AlreadyCommitted",
    "WrongWeek",
    "AmountOutOfRange",
    "GoalOutOfRange",
    "TokenFailure",
    "BalanceMismatch",
  ],
  current_week: ["BeforeAnchor"],
  release_if_stale: ["PositionNotFound", "PositionNotActive", "NotStaleYet", "TokenFailure"],
  settle: [
    "Unauthorized",
    "PositionNotFound",
    "PositionNotActive",
    "OutsideSettleWindow",
    "TokenFailure",
  ],
} as const satisfies Record<string, readonly ExpectedFailure[]>;

// The table runs on the production timings, with an anchor both test environments can reach.
const production = INSTANCES.production;
const ANCHOR = 1_000_000n;
const WEEK = production.weekLen;
const GRACE = production.grace;
const STALE = production.staleAfter;
const MIN_GOAL = production.minGoalM;
const MAX_GOAL = production.maxGoalM;

/** Second `offset` of week `week`; negative offsets reach into the previous week. */
function at(week: bigint, offset = 0n): bigint {
  return ANCHOR + week * WEEK + offset;
}

/** `week_end(w)`: the first second after week `w`. */
function end(week: bigint): bigint {
  return at(week + 1n);
}

const blank = {
  amount: "",
  error: "",
  forfeited: "unchanged",
  goal_m: "",
  met: "",
  owner_balance: "unchanged",
  result: "",
} as const;

interface CommitStep {
  readonly time: bigint;
  readonly week: bigint;
  readonly actor?: Actor;
  readonly owner?: Owner;
  readonly amount?: AmountRef;
  readonly goal?: bigint;
  readonly error?: ExpectedFailure;
  /** Expected state after a failure; `None` unless a position already existed. */
  readonly state?: PositionState;
}

function commit(step: CommitStep): CaseStep {
  const owner = step.owner ?? "user";
  const ok = step.error === undefined;
  return {
    ...blank,
    action: "commit",
    actor: step.actor ?? owner,
    amount: step.amount ?? "min",
    error: step.error ?? "",
    goal_m: (step.goal ?? MIN_GOAL).toString(),
    owner,
    owner_balance: ok ? "debited" : "unchanged",
    state: ok ? "Active" : (step.state ?? "None"),
    time: step.time.toString(),
    week_id: step.week.toString(),
  };
}

interface SettleStep {
  readonly time: bigint;
  readonly week: bigint;
  readonly met: boolean;
  readonly actor?: Actor;
  readonly owner?: Owner;
  readonly error?: ExpectedFailure;
  readonly state?: PositionState;
}

function settle(step: SettleStep): CaseStep {
  const ok = step.error === undefined;
  return {
    ...blank,
    action: "settle",
    actor: step.actor ?? "oracle",
    error: step.error ?? "",
    forfeited: ok && !step.met ? "increased" : "unchanged",
    met: step.met ? "true" : "false",
    owner: step.owner ?? "user",
    owner_balance: ok && step.met ? "credited" : "unchanged",
    state: ok ? (step.met ? "Returned" : "Forfeited") : (step.state ?? "Active"),
    time: step.time.toString(),
    week_id: step.week.toString(),
  };
}

interface ReleaseStep {
  readonly time: bigint;
  readonly week: bigint;
  readonly actor?: Actor;
  readonly owner?: Owner;
  readonly error?: ExpectedFailure;
  readonly state?: PositionState;
}

function release(step: ReleaseStep): CaseStep {
  const ok = step.error === undefined;
  return {
    ...blank,
    action: "release_if_stale",
    actor: step.actor ?? "stranger",
    error: step.error ?? "",
    owner: step.owner ?? "user",
    owner_balance: ok ? "credited" : "unchanged",
    state: ok ? "ReleasedStale" : (step.state ?? "Active"),
    time: step.time.toString(),
    week_id: step.week.toString(),
  };
}

function currentWeekStep(time: bigint, expected: bigint | "BeforeAnchor"): CaseStep {
  return {
    ...blank,
    action: "current_week",
    actor: "stranger",
    error: expected === "BeforeAnchor" ? "BeforeAnchor" : "",
    owner: "user",
    result: expected === "BeforeAnchor" ? "" : expected.toString(),
    state: "None",
    time: time.toString(),
    week_id: "0",
  };
}

/** The token starts or stops refusing transfers to and from `owner` (blacklist or trustline). */
function token(
  action: "block" | "unblock",
  time: bigint,
  owner: Owner,
  week: bigint,
  state: PositionState,
): CaseStep {
  return {
    ...blank,
    action,
    actor: owner,
    owner,
    state,
    time: time.toString(),
    week_id: week.toString(),
  };
}

const settleOpens = end(1n) + GRACE;
const settleCloses = end(1n) + STALE;
const releaseOpens = end(1n) + STALE;
const committed = commit({ time: at(0n, 10n), week: 1n });

const CASES: readonly ContractCase[] = [
  // Week arithmetic: the anchor, before it, and the last second of a week.
  {
    name: "current_week_fails_before_the_anchor",
    steps: [currentWeekStep(ANCHOR - 1n, "BeforeAnchor")],
  },
  {
    name: "current_week_counts_from_the_anchor_to_the_last_second",
    steps: [
      currentWeekStep(ANCHOR, 0n),
      currentWeekStep(at(1n, -1n), 0n),
      currentWeekStep(at(1n), 1n),
      currentWeekStep(at(5n, 3n), 5n),
    ],
  },

  // commit
  {
    name: "commit_locks_the_deposit_for_next_week",
    steps: [committed],
  },
  {
    name: "commit_accepts_the_last_second_of_the_current_week",
    steps: [commit({ time: at(1n, -1n), week: 1n })],
  },
  {
    name: "commit_that_lands_after_the_week_boundary_reverts",
    steps: [commit({ time: at(1n), week: 1n, error: "WrongWeek" })],
  },
  {
    name: "commit_rejects_the_current_week_and_the_week_after_next",
    steps: [
      commit({ time: at(0n, 10n), week: 0n, error: "WrongWeek" }),
      commit({ time: at(0n, 10n), week: 2n, error: "WrongWeek" }),
    ],
  },
  {
    name: "commit_fails_before_the_anchor",
    steps: [commit({ time: ANCHOR - 1n, week: 0n, error: "BeforeAnchor" })],
  },
  {
    name: "commit_enforces_the_amount_limits",
    steps: [
      commit({ time: at(0n, 10n), week: 1n, amount: "zero", error: "AmountOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, amount: "below_min", error: "AmountOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, amount: "above_max", error: "AmountOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, amount: "max" }),
      commit({ time: at(0n, 10n), week: 1n, owner: "stranger", amount: "mid" }),
    ],
  },
  {
    name: "commit_enforces_the_goal_limits",
    steps: [
      commit({ time: at(0n, 10n), week: 1n, goal: MIN_GOAL - 1n, error: "GoalOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, goal: MAX_GOAL + 1n, error: "GoalOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, goal: 0n, error: "GoalOutOfRange" }),
      commit({ time: at(0n, 10n), week: 1n, goal: MAX_GOAL }),
    ],
  },
  {
    name: "commit_allows_one_position_per_user_and_week",
    steps: [
      committed,
      commit({ time: at(0n, 20n), week: 1n, error: "AlreadyCommitted", state: "Active" }),
      commit({ time: at(0n, 20n), week: 1n, owner: "stranger" }),
      commit({ time: at(1n, 10n), week: 2n }),
      settle({ time: settleOpens, week: 1n, met: true }),
      commit({ time: settleOpens + 1n, week: 3n }),
    ],
  },
  {
    name: "commit_after_the_position_is_final_still_fails",
    steps: [
      committed,
      settle({ time: settleOpens, week: 1n, met: false }),
      commit({ time: settleOpens, week: 1n, error: "AlreadyCommitted", state: "Forfeited" }),
    ],
  },
  {
    name: "commit_needs_the_owner_to_sign",
    steps: [
      commit({ time: at(0n, 10n), week: 1n, actor: "stranger", error: "Unauthorized" }),
      commit({ time: at(0n, 10n), week: 1n, actor: "oracle", error: "Unauthorized" }),
    ],
  },
  {
    name: "commit_fails_when_the_token_refuses_the_owner",
    steps: [
      token("block", at(0n, 5n), "user", 1n, "None"),
      commit({ time: at(0n, 10n), week: 1n, error: "TokenFailure" }),
      token("unblock", at(0n, 15n), "user", 1n, "None"),
      commit({ time: at(0n, 20n), week: 1n }),
    ],
  },

  // commit: validation order, one case per adjacent pair.
  {
    name: "commit_order_before_anchor_comes_before_authorization",
    steps: [commit({ time: ANCHOR - 1n, week: 0n, actor: "stranger", error: "BeforeAnchor" })],
  },
  {
    name: "commit_order_authorization_comes_before_position_state",
    steps: [
      committed,
      commit({
        time: at(0n, 20n),
        week: 1n,
        actor: "stranger",
        error: "Unauthorized",
        state: "Active",
      }),
    ],
  },
  {
    name: "commit_order_position_state_comes_before_the_week",
    steps: [
      committed,
      commit({ time: at(1n, 10n), week: 1n, error: "AlreadyCommitted", state: "Active" }),
    ],
  },
  {
    name: "commit_order_the_week_comes_before_the_limits",
    steps: [
      commit({
        time: at(0n, 10n),
        week: 0n,
        amount: "above_max",
        goal: 0n,
        error: "WrongWeek",
      }),
    ],
  },
  {
    name: "commit_order_the_amount_comes_before_the_goal",
    steps: [
      commit({ time: at(0n, 10n), week: 1n, amount: "zero", goal: 0n, error: "AmountOutOfRange" }),
    ],
  },
  {
    name: "commit_order_the_limits_come_before_the_token",
    steps: [
      token("block", at(0n, 5n), "user", 1n, "None"),
      commit({ time: at(0n, 10n), week: 1n, goal: 0n, error: "GoalOutOfRange" }),
    ],
  },

  // settle
  {
    name: "settle_met_returns_the_deposit",
    steps: [committed, settle({ time: settleOpens, week: 1n, met: true })],
  },
  {
    name: "settle_missed_keeps_the_deposit_in_the_contract",
    steps: [committed, settle({ time: settleOpens, week: 1n, met: false })],
  },
  {
    name: "settle_opens_after_the_grace_period",
    steps: [
      committed,
      settle({ time: end(1n) - 1n, week: 1n, met: true, error: "OutsideSettleWindow" }),
      settle({ time: settleOpens - 1n, week: 1n, met: true, error: "OutsideSettleWindow" }),
      settle({ time: settleOpens, week: 1n, met: true }),
    ],
  },
  {
    name: "settle_accepts_the_last_second_of_its_window",
    steps: [committed, settle({ time: settleCloses - 1n, week: 1n, met: false })],
  },
  {
    name: "settle_closes_when_release_opens",
    steps: [
      committed,
      settle({ time: settleCloses, week: 1n, met: false, error: "OutsideSettleWindow" }),
    ],
  },
  {
    name: "settle_is_only_for_the_oracle",
    steps: [
      committed,
      settle({ time: settleOpens, week: 1n, met: true, actor: "user", error: "Unauthorized" }),
      settle({ time: settleOpens, week: 1n, met: false, actor: "stranger", error: "Unauthorized" }),
    ],
  },
  {
    name: "settle_happens_once",
    steps: [
      committed,
      settle({ time: settleOpens, week: 1n, met: true }),
      settle({
        time: settleOpens + 1n,
        week: 1n,
        met: false,
        error: "PositionNotActive",
        state: "Returned",
      }),
    ],
  },
  {
    name: "settle_needs_a_position",
    steps: [
      settle({ time: settleOpens, week: 1n, met: true, error: "PositionNotFound", state: "None" }),
    ],
  },

  // settle: validation order.
  {
    name: "settle_order_authorization_comes_before_position_state",
    steps: [
      settle({
        time: settleOpens,
        week: 1n,
        met: true,
        actor: "stranger",
        error: "Unauthorized",
        state: "None",
      }),
    ],
  },
  {
    name: "settle_order_position_state_comes_before_the_window",
    steps: [
      settle({ time: at(0n, 10n), week: 1n, met: true, error: "PositionNotFound", state: "None" }),
      committed,
      settle({ time: settleOpens, week: 1n, met: false }),
      settle({
        time: settleCloses + 10n,
        week: 1n,
        met: true,
        error: "PositionNotActive",
        state: "Forfeited",
      }),
    ],
  },
  {
    name: "settle_order_the_window_comes_before_the_token",
    steps: [
      committed,
      token("block", at(0n, 20n), "user", 1n, "Active"),
      settle({ time: settleOpens - 1n, week: 1n, met: true, error: "OutsideSettleWindow" }),
    ],
  },

  // The token refuses the refund: everything reverts and the position stays Active.
  {
    name: "settle_met_reverts_whole_when_the_token_refuses_the_owner",
    steps: [
      committed,
      token("block", at(0n, 20n), "user", 1n, "Active"),
      settle({ time: settleOpens, week: 1n, met: true, error: "TokenFailure" }),
      token("unblock", settleOpens + 1n, "user", 1n, "Active"),
      settle({ time: settleOpens + 2n, week: 1n, met: true }),
    ],
  },
  {
    name: "settle_missed_needs_no_transfer_and_works_while_blocked",
    steps: [
      committed,
      token("block", at(0n, 20n), "user", 1n, "Active"),
      settle({ time: settleOpens, week: 1n, met: false }),
    ],
  },
  {
    name: "a_blocked_owner_recovers_through_release_with_no_deadline",
    steps: [
      committed,
      token("block", at(0n, 20n), "user", 1n, "Active"),
      settle({ time: settleOpens, week: 1n, met: true, error: "TokenFailure" }),
      release({ time: releaseOpens, week: 1n, error: "TokenFailure" }),
      token("unblock", releaseOpens + 10n * WEEK, "user", 1n, "Active"),
      release({ time: releaseOpens + 10n * WEEK + 1n, week: 1n }),
    ],
  },
  {
    name: "a_blocked_owner_does_not_touch_other_positions",
    steps: [
      committed,
      commit({ time: at(0n, 20n), week: 1n, owner: "stranger", amount: "max" }),
      token("block", at(0n, 30n), "user", 1n, "Active"),
      settle({ time: settleOpens, week: 1n, met: true, error: "TokenFailure" }),
      settle({ time: settleOpens, week: 1n, met: true, owner: "stranger" }),
    ],
  },

  // release_if_stale
  {
    name: "release_returns_a_stale_deposit_to_its_owner",
    steps: [committed, release({ time: releaseOpens, week: 1n })],
  },
  {
    name: "release_does_not_work_before_time",
    steps: [
      committed,
      release({ time: releaseOpens - 1n, week: 1n, error: "NotStaleYet" }),
      release({ time: releaseOpens, week: 1n, actor: "oracle" }),
    ],
  },
  {
    name: "release_has_no_deadline",
    steps: [committed, release({ time: releaseOpens + 52n * WEEK, week: 1n, actor: "user" })],
  },
  {
    name: "release_needs_a_position",
    steps: [release({ time: releaseOpens, week: 1n, error: "PositionNotFound", state: "None" })],
  },
  {
    name: "release_after_settle_fails",
    steps: [
      committed,
      settle({ time: settleOpens, week: 1n, met: true }),
      release({ time: releaseOpens, week: 1n, error: "PositionNotActive", state: "Returned" }),
    ],
  },
  {
    name: "release_happens_once",
    steps: [
      committed,
      release({ time: releaseOpens, week: 1n }),
      release({
        time: releaseOpens + 1n,
        week: 1n,
        error: "PositionNotActive",
        state: "ReleasedStale",
      }),
      settle({
        time: releaseOpens + 1n,
        week: 1n,
        met: true,
        error: "PositionNotActive",
        state: "ReleasedStale",
      }),
    ],
  },
  {
    name: "forfeited_deposits_never_move",
    steps: [
      committed,
      commit({ time: at(0n, 20n), week: 1n, owner: "stranger", amount: "max" }),
      settle({ time: settleOpens, week: 1n, met: false }),
      settle({
        time: settleOpens + 1n,
        week: 1n,
        met: true,
        error: "PositionNotActive",
        state: "Forfeited",
      }),
      release({ time: releaseOpens, week: 1n, error: "PositionNotActive", state: "Forfeited" }),
      release({ time: releaseOpens, week: 1n, owner: "stranger" }),
    ],
  },

  // release_if_stale: validation order.
  {
    name: "release_order_position_state_comes_before_the_window",
    steps: [
      release({ time: at(0n, 10n), week: 1n, error: "PositionNotFound", state: "None" }),
      committed,
      settle({ time: settleOpens, week: 1n, met: true }),
      release({ time: settleOpens + 1n, week: 1n, error: "PositionNotActive", state: "Returned" }),
    ],
  },
  {
    name: "release_order_the_window_comes_before_the_token",
    steps: [
      committed,
      token("block", at(0n, 20n), "user", 1n, "Active"),
      release({ time: releaseOpens - 1n, week: 1n, error: "NotStaleYet" }),
    ],
  },

  // A whole season: several weeks, both owners, every outcome, the invariant after each step.
  {
    name: "several_weeks_keep_the_balance_invariant",
    steps: [
      commit({ time: at(0n, 10n), week: 1n, amount: "min" }),
      commit({ time: at(0n, 11n), week: 1n, owner: "stranger", amount: "max" }),
      commit({ time: at(1n, 10n), week: 2n, amount: "mid" }),
      settle({ time: settleOpens, week: 1n, met: true }),
      settle({ time: settleOpens, week: 1n, met: false, owner: "stranger" }),
      commit({ time: settleOpens + 10n, week: 3n, owner: "stranger", amount: "min" }),
      settle({ time: end(2n) + GRACE, week: 2n, met: false }),
      release({ time: end(3n) + STALE, week: 3n, owner: "stranger" }),
    ],
  },
];

const CONSTRUCTOR_BASE: ConstructorCase = {
  error: "",
  grace: GRACE.toString(),
  max_amount_usdc: production.maxAmountUsdc.toString(),
  max_goal_m: MAX_GOAL.toString(),
  min_amount_usdc: production.minAmountUsdc.toString(),
  min_goal_m: MIN_GOAL.toString(),
  name: "",
  stale_after: STALE.toString(),
  week_anchor: ANCHOR.toString(),
  week_len: WEEK.toString(),
};

function ctor(name: string, overrides: Partial<ConstructorCase>): ConstructorCase {
  return { ...CONSTRUCTOR_BASE, error: "InvalidConfig", ...overrides, name };
}

const CONSTRUCTOR_CASES: readonly ConstructorCase[] = [
  { ...CONSTRUCTOR_BASE, name: "constructor_accepts_the_production_parameters" },
  {
    ...CONSTRUCTOR_BASE,
    name: "constructor_accepts_equal_limits",
    max_amount_usdc: "20",
    max_goal_m: MIN_GOAL.toString(),
  },
  ctor("constructor_rejects_a_zero_min_amount", { min_amount_usdc: "0" }),
  ctor("constructor_rejects_min_amount_above_max", { min_amount_usdc: "51" }),
  ctor("constructor_rejects_a_zero_min_goal", { min_goal_m: "0" }),
  ctor("constructor_rejects_min_goal_above_max", { min_goal_m: (MAX_GOAL + 1n).toString() }),
  ctor("constructor_rejects_a_zero_week", { week_len: "0" }),
  ctor("constructor_rejects_a_zero_grace", { grace: "0" }),
  ctor("constructor_rejects_grace_equal_to_stale_after", { grace: STALE.toString() }),
  ctor("constructor_rejects_grace_above_stale_after", { grace: (STALE + 1n).toString() }),
];

export interface CaseFixture {
  readonly cases: readonly ContractCase[];
  readonly config: {
    readonly grace: string;
    readonly max_amount_usdc: string;
    readonly max_goal_m: string;
    readonly min_amount_usdc: string;
    readonly min_goal_m: string;
    readonly stale_after: string;
    readonly week_anchor: string;
    readonly week_len: string;
  };
  readonly constructor_cases: readonly ConstructorCase[];
  readonly contract_errors: readonly { readonly code: string; readonly name: string }[];
  readonly foreign_failures: readonly string[];
  readonly schema_version: string;
  readonly validation_order: Readonly<Record<keyof typeof VALIDATION_ORDER, readonly string[]>>;
}

/** The fixture both contract runners read, in plain JSON-ready data. */
export function buildCaseFixture(): CaseFixture {
  const { name: _name, error: _error, ...config } = CONSTRUCTOR_BASE;
  return {
    cases: CASES,
    config,
    constructor_cases: CONSTRUCTOR_CASES,
    contract_errors: CONTRACT_ERRORS.map(({ code, name }) => ({ code: code.toString(), name })),
    foreign_failures: [...FOREIGN_FAILURES],
    schema_version: "1",
    validation_order: VALIDATION_ORDER,
  };
}

/** Deterministic JSON: keys sorted at every level, two-space indent, trailing newline. */
export function serializeCaseFixture(fixture: CaseFixture): string {
  return `${JSON.stringify(sortKeys(fixture), null, 2)}\n`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, inner]) => [key, sortKeys(inner)]),
    );
  }
  return value;
}
