import { AgentHabitError } from "./errors.js";

/**
 * The settlement decision, written once (A-4): the oracle compares here and only `met` goes
 * on-chain, never the distance (Strava API terms, spec 4.8).
 *
 * `totalDistanceM` is the sum of the week's valid runs in metres, as Strava reports them
 * (fractional). `goalM` is the whole-metre goal stored in the position.
 */
export function goalMet(totalDistanceM: number, goalM: bigint): boolean {
  if (!Number.isFinite(totalDistanceM) || totalDistanceM < 0) {
    throw new AgentHabitError("InvalidDistance", "A distance must be finite and non-negative", {
      details: { totalDistanceM },
    });
  }
  // Exact for every goal in range: goals are at most 300 km, far below 2^53.
  return totalDistanceM >= Number(goalM);
}
