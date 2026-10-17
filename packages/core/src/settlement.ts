import { AgentHabitError } from "./errors.js";

/**
 * The settlement decision, written once (A-4): `met = total ≥ goal_m`. The oracle compares here
 * and only `met` goes on-chain, never the distance (Strava API terms, spec 4.8).
 *
 * `totalM` is in whole metres: each valid run is truncated to the metre before summing (spec 4.5;
 * the sum itself lands with T5). `goalM` is the goal stored in the position.
 */
export function goalMet(totalM: bigint, goalM: bigint): boolean {
  if (totalM < 0n) {
    throw new AgentHabitError("InvalidDistance", "A weekly total cannot be negative", {
      details: { totalM: totalM.toString() },
    });
  }
  return totalM >= goalM;
}
