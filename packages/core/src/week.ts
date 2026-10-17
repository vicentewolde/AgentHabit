import { AgentHabitError } from "./errors.js";

/**
 * The time parameters a commitment contract is deployed with (spec 4.2). Both contracts
 * reimplement exactly this arithmetic; the shared case table proves they agree.
 *
 * All values are seconds of chain time (ledger or block timestamp), kept as `bigint` so the
 * arithmetic never loses precision, like the `u64` the contracts use.
 */
export interface WeekParams {
  /** A fixed Monday 00:00 in UTC-3: the first second of week 0. */
  readonly weekAnchor: bigint;
  readonly weekLen: bigint;
  /** Seconds after a week ends before the oracle may settle it. */
  readonly grace: bigint;
  /** Seconds after a week ends from which anyone may release a position to its owner. */
  readonly staleAfter: bigint;
}

/** The half-open interval `[opens, closes)` in chain time. */
export interface TimeWindow {
  readonly opens: bigint;
  readonly closes: bigint;
}

/**
 * `floor((now − week_anchor) / week_len)`. Before the anchor there is no week: it fails with
 * `BeforeAnchor` instead of underflowing, like the contracts.
 */
export function currentWeek(now: bigint, params: WeekParams): bigint {
  if (params.weekLen <= 0n) {
    throw new AgentHabitError("InvalidConfig", "A week must last at least one second", {
      details: { weekLen: params.weekLen.toString() },
    });
  }
  if (now < params.weekAnchor) {
    throw new AgentHabitError("BeforeAnchor", "There is no week before the anchor", {
      details: { now: now.toString(), weekAnchor: params.weekAnchor.toString() },
    });
  }
  return (now - params.weekAnchor) / params.weekLen;
}

/** The only week a user may commit to at `now`: the next one (A-8). */
export function committableWeek(now: bigint, params: WeekParams): bigint {
  return currentWeek(now, params) + 1n;
}

/** `week_anchor + (w + 1) · week_len`: the first second after week `w`. */
export function weekEnd(weekId: bigint, params: WeekParams): bigint {
  return params.weekAnchor + (weekId + 1n) * params.weekLen;
}

/** The oracle may settle week `w` in `[week_end + grace, week_end + stale_after)`. */
export function settleWindow(weekId: bigint, params: WeekParams): TimeWindow {
  const end = weekEnd(weekId, params);
  return { opens: end + params.grace, closes: end + params.staleAfter };
}

/** Anyone may release week `w` from `week_end + stale_after` on, with no deadline. */
export function releaseOpensAt(weekId: bigint, params: WeekParams): bigint {
  return weekEnd(weekId, params) + params.staleAfter;
}

export function isSettleOpen(now: bigint, weekId: bigint, params: WeekParams): boolean {
  const window = settleWindow(weekId, params);
  return window.opens <= now && now < window.closes;
}

export function isReleaseOpen(now: bigint, weekId: bigint, params: WeekParams): boolean {
  return now >= releaseOpensAt(weekId, params);
}
