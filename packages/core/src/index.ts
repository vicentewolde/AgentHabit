// Pure domain: weeks, limits, the settlement decision, the shared case table and the
// ChainAdapter types (P-2). Only zod and relative imports belong here.

export * from "./api-contract.js";
export {
  type Actor,
  type AmountRef,
  buildCaseFixture,
  type CaseAction,
  type CaseFixture,
  type CaseStep,
  type ConstructorCase,
  type ContractCase,
  type Owner,
  serializeCaseFixture,
  VALIDATION_ORDER,
} from "./cases.js";
export {
  type ChainAdapter,
  type ChainSigner,
  type CommitInput,
  type ContractConfig,
  POSITION_STATES,
  type Position,
  type PositionRef,
  type PositionState,
  type PreparedTransaction,
  type SettleInput,
  type SignedLinkMessage,
  type SubmittedTransaction,
} from "./chain-adapter.js";
export {
  CONTRACT_ERRORS,
  type ContractErrorName,
  type ExpectedFailure,
  FOREIGN_FAILURES,
  type ForeignFailure,
} from "./contract-errors.js";
export {
  AgentHabitError,
  type AgentHabitErrorCode,
  type AgentHabitErrorDetails,
  type AgentHabitErrorOptions,
  hasErrorCode,
  isAgentHabitError,
} from "./errors.js";
export {
  type ChainId,
  type ContractParams,
  INSTANCES,
  type InstanceKind,
  type InstanceTemplate,
  instanceParams,
  USDC_DECIMALS,
  usdcToUnits,
  validateParams,
} from "./limits.js";
export {
  buildLinkMessage,
  FUJI_CHAIN_ID,
  LINK_STATEMENT,
  type LinkMessageInput,
} from "./link-message.js";
export {
  type ActivitySummary,
  type ActivityVerdict,
  COUNTED_SPORT_TYPES,
  FASTEST_PACE_S_PER_KM,
  judgeActivity,
  type MissingField,
  type RejectionReason,
  type WeekTotal,
  weekStart,
  weekTotal,
} from "./runs.js";
export { goalMet } from "./settlement.js";
export {
  committableWeek,
  currentWeek,
  isReleaseOpen,
  isSettleOpen,
  releaseOpensAt,
  settleWindow,
  type TimeWindow,
  type WeekParams,
  weekEnd,
} from "./week.js";
