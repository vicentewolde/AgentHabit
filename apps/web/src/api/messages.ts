import { type AgentHabitErrorCode, isAgentHabitError } from "@agenthabit/core";
import { isWebError, type WebErrorCode } from "../errors.js";
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
  ContractRejected: "El contrato no aceptó la operación. Revisa el monto, la meta y la semana.",
  AccountNotFunded:
    "Tu cuenta de Stellar todavía no existe en la red de pruebas: no tiene XLM para pagar la comisión. Cárgala con el faucet (friendbot) de la testnet y vuelve a intentar.",
  DeploymentDrift:
    "El servicio no está listo todavía: hay una diferencia con el contrato desplegado. Intenta más tarde.",
  TransactionNotAllowed:
    "Esa transacción no está permitida. Vuelve a prepararla desde aquí e intenta de nuevo.",
};

const SERVICE_NOT_READY = "El servicio no está listo todavía. Intenta de nuevo más tarde.";

export const KNOWN_ERROR_CODES = Object.keys(MESSAGES) as AgentHabitErrorCode[];

const WALLET_MESSAGES = {
  WalletUnavailable:
    "No encontramos Freighter. Instala la extensión desde freighter.app, desbloquéala y recarga esta página.",
  WalletRejected: "Cancelaste la solicitud en tu billetera. No se hizo nada.",
  WalletFailed: "Tu billetera no pudo completar la solicitud.",
} as const;

/**
 * Why the contract or the token refused an operation (`ContractRejected` + `reason`). Anything not
 * listed here (including the contract's other error names) falls back to the generic message.
 */
const REASON_MESSAGES: Readonly<Record<string, string>> = {
  InsufficientBalance:
    "No tienes suficiente USDC de prueba en esta wallet. Pide USDC en el faucet de Circle y vuelve a intentarlo.",
  NoUsdcTrustline:
    "Tu wallet todavía no puede guardar USDC. En Freighter agrega el activo USDC de testnet y pide USDC en el faucet de Circle.",
  AlreadyCommitted: "Ya tienes un compromiso para esa semana.",
  AmountOutOfRange: "El monto o la meta están fuera de los límites. Revisa el rango permitido.",
  GoalOutOfRange: "El monto o la meta están fuera de los límites. Revisa el rango permitido.",
  WrongWeek: "La semana cambió. Revisa las fechas y confirma de nuevo.",
  NotStaleYet: "Todavía no se puede recuperar este depósito: espera la fecha indicada.",
  PositionNotFound: "No hay un depósito activo para recuperar en esa semana.",
  PositionNotActive: "No hay un depósito activo para recuperar en esa semana.",
  TokenBlocked: "El token bloqueó esta wallet; no se puede completar la operación.",
};

/** The reasons for which the user needs USDC of test: they get a link to the faucet. */
const FAUCET_REASONS: readonly string[] = ["InsufficientBalance", "NoUsdcTrustline"];

export const CIRCLE_FAUCET_URL = "https://faucet.circle.com/";

/** The `reason` an API refusal carried, if it is a contract rejection that has one. */
export function reasonOf(error: unknown): string | undefined {
  if (isAgentHabitError(error) && error.code === "ContractRejected") {
    const reason = error.details.reason;
    return typeof reason === "string" ? reason : undefined;
  }
  return undefined;
}

const WEB_MESSAGES: Record<WebErrorCode, string> = {
  WeekChanged: "La semana cambió mientras confirmabas. Revisa las fechas y confirma de nuevo.",
  ReleaseWeekMismatch:
    "La transacción preparada no corresponde a la semana que elegiste. Actualiza la página e intenta de nuevo.",
  CommitPending:
    "Tienes una transacción en espera. Cuando se confirme, tu compromiso aparecerá aquí; no hace falta firmar de nuevo.",
  ServerResponse: "El servidor no respondió bien, intenta de nuevo en un minuto.",
  WebConfig: "La web no está bien configurada. Avísale a quien te invitó.",
};

/** A sentence in Spanish for any failure the UI can meet. Never includes tokens or raw bodies. */
export function messageFor(error: unknown): string {
  if (isWalletError(error)) {
    return WALLET_MESSAGES[error.code];
  }
  if (isWebError(error)) {
    return WEB_MESSAGES[error.code];
  }
  if (isAgentHabitError(error)) {
    const reason = reasonOf(error);
    if (reason !== undefined && Object.hasOwn(REASON_MESSAGES, reason)) {
      return REASON_MESSAGES[reason] ?? MESSAGES[error.code];
    }
    // ConfigError arrives as a 503: the service is up but not ready.
    if (error.code === "ConfigError" && error.details.status === 503) return SERVICE_NOT_READY;
    return MESSAGES[error.code];
  }
  return "Algo salió mal. Intenta de nuevo en un momento.";
}

/** The text to show for a failure, and whether to put the Circle faucet link next to it. */
export function describeError(error: unknown): { message: string; faucet: boolean } {
  const reason = reasonOf(error);
  return {
    message: messageFor(error),
    faucet: reason !== undefined && FAUCET_REASONS.includes(reason),
  };
}
