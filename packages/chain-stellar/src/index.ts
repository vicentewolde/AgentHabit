// Stellar implementation of the AgentHabit chain adapter (P-2): the contract client (reads,
// transactions the wallet signs, relay and verification) and the link-signature check.
export {
  type ContractClientOptions,
  contractErrorFrom,
  type DecodedCall,
  decodeContractCall,
  type OnChainConfig,
  type OnChainPosition,
  POSITION_STATE_BY_INDEX,
  type PreparedTransaction,
  rejectionReason,
  type SorobanServer,
  StellarContractClient,
  type SubmitStatus,
} from "./contract-client.js";
export {
  normalizeStellarAddress,
  normalizeStellarContract,
  verifyStellarLinkSignature,
} from "./link-signature.js";
