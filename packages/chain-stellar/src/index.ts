// Stellar implementation of ChainAdapter (P-2). T5 brings the link-signature check; the rest of
// the adapter lands with T6.
export {
  normalizeStellarAddress,
  normalizeStellarContract,
  verifyStellarLinkSignature,
} from "./link-signature.js";
