// Pure domain: weeks, limits, Strava run filters and the settlement decision (P-2).
// Only zod and relative imports belong here; the domain itself lands with T4.
export {
  AgentHabitError,
  type AgentHabitErrorCode,
  type AgentHabitErrorDetails,
  type AgentHabitErrorOptions,
  hasErrorCode,
  isAgentHabitError,
} from "./errors.js";
