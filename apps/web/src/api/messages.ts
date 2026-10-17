import { type AgentHabitErrorCode, isAgentHabitError } from "@agenthabit/core";
import { isWalletError } from "../wallet/port.js";

/**
 * What a person reads for each API error code. A `Record` over the whole union: adding a code to
 * `@agenthabit/core` breaks the build here until it has a sentence.
 */
const MESSAGES: Record<AgentHabitErrorCode, string> = {
  BeforeAnchor: "Los compromisos de este contrato todavía no parten. Intenta más tarde.",
  ConfigError: "El servicio tiene un problema de configuración. Avísale a quien te invitó.",
  InvalidConfig: "El servicio tiene un problema de configuración. Avísale a quien te invitó.",
  InvalidDistance: "La distancia no es válida. Revisa la meta.",
  NetworkError:
    "No pudimos comunicarnos con el servidor ni con la red de Stellar. Revisa tu conexión e intenta de nuevo en un momento.",
  SecretLeak: "Algo falló en el servidor. Intenta de nuevo en un momento.",
  LinkRejected:
    "No pudimos verificar el vínculo. Vincula tu billetera otra vez y, si estabas conectando Strava, vuelve a empezar desde “Conectar Strava”.",
  Unauthenticated: "Tu sesión terminó. Vincula tu billetera de nuevo para seguir.",
  InvalidRequest: "Los datos no son válidos. Revisa el monto y la meta e intenta de nuevo.",
  PositionUnverified:
    "Todavía no vemos tu depósito confirmado en la cadena. Espera un minuto y actualiza la página.",
  StravaRevoked:
    "El acceso a Strava está revocado. Conéctalo de nuevo; mientras tanto, la semana cuenta como no cumplida.",
  StravaScopeMissing:
    "Strava necesita permiso para ver tus actividades. Conecta Strava de nuevo y deja marcada la casilla de actividades.",
  StravaRateLimited: "Strava nos pidió esperar un poco. Intenta de nuevo en unos minutos.",
  StravaResponseInvalid: "Strava respondió algo inesperado. Intenta de nuevo más tarde.",
  StravaIncompleteRead:
    "No pudimos leer todas tus carreras de la semana. Intenta de nuevo más tarde.",
  DatabaseError: "Algo falló en el servidor. Intenta de nuevo en un momento.",
  TokenDecryptFailed: "Algo falló en el servidor. Intenta de nuevo en un momento.",
};

/**
 * Codes the API can answer that are not in `AgentHabitErrorCode` yet. The client keeps them in
 * `details.apiCode`; once they join the union, they move into `MESSAGES` above.
 */
const EXTRA_MESSAGES: Readonly<Record<string, string>> = {
  ContractRejected:
    "El contrato rechazó la operación. Revisa el monto y la meta, y que no tengas ya un compromiso para esa semana.",
  AccountNotFunded:
    "Tu cuenta de Stellar todavía no existe en la red de pruebas: no tiene XLM para pagar la comisión. Cárgala con el faucet (friendbot) de la testnet y vuelve a intentar.",
  TransactionNotAllowed:
    "Esa transacción no está permitida. Vuelve a prepararla desde aquí e intenta de nuevo.",
  DeploymentDrift:
    "El servicio no está listo todavía: hay una diferencia con el contrato desplegado. Intenta más tarde.",
};

const SERVICE_NOT_READY = "El servicio no está listo todavía. Intenta de nuevo más tarde.";

export const KNOWN_ERROR_CODES = Object.keys(MESSAGES) as AgentHabitErrorCode[];

const WALLET_MESSAGES = {
  WalletUnavailable:
    "No encontramos Freighter. Instala la extensión desde freighter.app, desbloquéala y recarga esta página.",
  WalletRejected: "Cancelaste la solicitud en tu billetera. No se hizo nada.",
  WalletFailed: "Tu billetera no pudo completar la solicitud.",
} as const;

/** A sentence in Spanish for any failure the UI can meet. Never includes tokens or raw bodies. */
export function messageFor(error: unknown): string {
  if (isWalletError(error)) {
    return WALLET_MESSAGES[error.code];
  }
  if (isAgentHabitError(error)) {
    const apiCode = error.details.apiCode;
    if (typeof apiCode === "string" && Object.hasOwn(EXTRA_MESSAGES, apiCode)) {
      return EXTRA_MESSAGES[apiCode] ?? MESSAGES[error.code];
    }
    // ConfigError arrives as a 503: the service is up but not ready.
    if (error.code === "ConfigError" && error.details.status === 503) return SERVICE_NOT_READY;
    return MESSAGES[error.code];
  }
  return "Algo salió mal. Intenta de nuevo en un momento.";
}
